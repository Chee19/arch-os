import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handle } from "@/engine/actions";
import { slotsOf } from "@/engine/case";
import { Conflict } from "@/engine/errors";
import { ladderOf, latestOps } from "@/engine/ladder";
import { CASE_ID, secureCase } from "@/engine/scene1";
import { col, getDemo } from "@/engine/store";
import { stripe } from "@/money/stripe";
import {
  closeDb,
  editCase,
  expireHold,
  runToEnd,
  runUntil,
  snapshot,
  testDb,
} from "./helpers";

const hook = vi.hoisted(() => ({
  onCreate: (async () => {}) as (x: Record<string, unknown>) => Promise<void>,
  beforeCreate: (() => {}) as (key: string) => void,
}));

// Runs the real engine without the Stripe sandbox; only stripe() is swapped.
vi.mock("@/money/stripe", async (importOriginal) => {
  const { fakeStripe } = await import("./fakeStripe");
  const fake = fakeStripe(
    (x) => hook.onCreate(x),
    (k) => hook.beforeCreate(k),
  );
  return {
    ...(await importOriginal<typeof import("@/money/stripe")>()),
    stripe: () => fake.s,
  };
});

const configure = (d: Db) =>
  handle(d, {
    action: "configure",
    scenario: "provider-cancel",
    source: "scripted",
  });
const accept = (d: Db) => handle(d, { action: "respond", decision: "accept" });
const stripeError = (type: string, message: string) =>
  Object.assign(new Error(message), { type });

describe.skipIf(!process.env.MONGODB_URI)(
  "Scene 1 engine with a fake Stripe",
  () => {
    let d: Db;
    beforeAll(async () => {
      vi.stubEnv("STRIPE_ACCT_CLEARHOME", "acct_fake_clearhome");
      // Task 13 wires live extraction into understand; this suite must stay offline.
      vi.stubEnv("LIVE_EXTRACTION", "off");
      d = await testDb();
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      await closeDb();
    });

    it("(a) settles with one op per kind, and Replay suppresses the duplicate transfer", async () => {
      await configure(d);
      // runToEnd accepts for the customer when the run waits at consent.
      expect(await runToEnd(d)).toMatchObject({
        status: "done",
        outcome: "settled",
        error: null,
      });
      const { runId, ops, exceptions } = await snapshot(d);
      expect(ops.map((o) => [o.kind, o.amountPence, o.state])).toEqual([
        ["charge", 30000, "succeeded"],
        ["refund", 2000, "succeeded"],
        ["transfer", 22400, "succeeded"],
      ]);
      expect(exceptions).toEqual([]);

      const transfer = latestOps(ops).transfer;
      const rows = await col.payments(d).countDocuments({ runId });
      expect(
        await handle(d, { action: "replay", opId: transfer?.opId ?? "" }),
      ).toEqual({
        notice: `Duplicate suppressed: Stripe returned the same ${transfer?.stripeId}`,
      });
      expect(await col.payments(d).countDocuments({ runId })).toBe(rows);
    });

    it("(b) a double Accept records consent once and answers the second with a conflict", async () => {
      await configure(d);
      await runUntil(d, "consent");
      const [x, y] = await Promise.allSettled([accept(d), accept(d)]);
      expect([x.status, y.status].sort()).toEqual(["fulfilled", "rejected"]);
      const lost = [x, y].find((r) => r.status === "rejected");
      expect(lost?.reason).toBeInstanceOf(Conflict);
      const { c, ops } = await snapshot(d);
      expect(c.consent).toMatchObject({
        decision: "accept",
        pricePence: 28000,
      });
      expect(ops.map((o) => o.kind)).toEqual(["charge"]);
      expect(await getDemo(d)).toMatchObject({
        status: "running",
        busyAt: null,
      });
    });

    it("(c) Accept after the hold expired opens Sam's exception, moves no money, and Refund now remedies", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await editCase(d, expireHold);
      await accept(d);
      const { runId, c, ops, exceptions } = await snapshot(d);
      expect(c.consent).toBeNull();
      expect(ops.map((o) => o.kind)).toEqual(["charge"]);
      expect(exceptions).toEqual([
        expect.objectContaining({
          exceptionId: `EXC:${runId}:${CASE_ID}:secure`,
          owner: "Sam Okafor",
          reason: "hold_expired",
          action: "refund",
          status: "open",
        }),
      ]);

      await handle(d, {
        action: "exception",
        exceptionId: exceptions[0].exceptionId,
        do: "refund",
      });
      const after = await snapshot(d);
      // The case is still open, but a succeeded full refund is evidence enough for Remedied.
      expect(after.c.status).toBe("open");
      expect(
        ladderOf({
          caseData: after.c,
          booking: after.booking,
          ops: after.ops,
          exceptions: after.exceptions,
        }).state,
      ).toBe("remedied");
    });

    it("(d) decline frees the slot, refunds £300 in full and derives Remedied", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await handle(d, { action: "respond", decision: "decline" });
      const { recs, c, booking, ops, exceptions } = await snapshot(d);
      expect(await getDemo(d)).toMatchObject({
        status: "done",
        outcome: "remedied",
      });
      expect(latestOps(ops).full_refund).toMatchObject({
        state: "succeeded",
        amountPence: 30000,
      });
      expect(
        slotsOf(recs).find((s) => s.recordId === "SLOT-clearhome-fri13")?.data,
      ).toMatchObject({ status: "free", bookingId: null });
      expect(ladderOf({ caseData: c, booking, ops, exceptions }).state).toBe(
        "remedied",
      );
    });

    it("(e) concurrent and repeated secure runs create one refund op", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      const demo = await getDemo(d);
      await Promise.all([secureCase(d, demo), secureCase(d, demo)]);
      // The real step runs secure a third time.
      await handle(d, { action: "advance", step: demo.step });
      const { booking, ops } = await snapshot(d);
      expect(booking).toMatchObject({
        status: "confirmed",
        providerId: "PROV-clearhome",
      });
      expect(
        ops
          .filter((o) => o.kind === "refund")
          .map((o) => [o.attempt, o.amountPence, o.state]),
      ).toEqual([[1, 2000, "succeeded"]]);
    });

    it("(f) a refund that reads failed on Recheck gets Priya's retry exception", async () => {
      // One read per verify, so the pending refund does not poll with real sleeps.
      vi.stubEnv("STRIPE_VERIFY_TRIES", "1");
      let refund: Record<string, unknown> | undefined;
      hook.onCreate = async (x) => {
        if (String(x.id).startsWith("re_")) {
          x.status = "pending";
          refund = x;
        }
      };
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      await runUntil(d, "secure");
      hook.onCreate = async () => {};
      const pending = latestOps((await snapshot(d)).ops).refund;
      expect(pending?.state).toBe("pending");
      expect((await snapshot(d)).exceptions).toEqual([]);

      if (refund) refund.status = "failed";
      await handle(d, { action: "recheck", opId: pending?.opId ?? "" });
      const { ops, exceptions } = await snapshot(d);
      expect(latestOps(ops).refund).toMatchObject({
        opId: pending?.opId,
        state: "failed",
      });
      expect(exceptions).toEqual([
        expect.objectContaining({
          owner: "Priya Shah",
          nextAction: "Retry refund",
          action: "retry",
          opId: pending?.opId,
          status: "open",
        }),
      ]);
    });

    it("(g) Recheck re-sends a refund Stripe never received, with the same key and one op row", async () => {
      const keys: string[] = [];
      hook.beforeCreate = (k) => {
        if (!k.includes(":refund:")) return;
        keys.push(k);
        throw stripeError("StripeConnectionError", "Connection reset");
      };
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      await runUntil(d, "secure");
      const stuck = latestOps((await snapshot(d)).ops).refund;
      expect(stuck).toMatchObject({ state: "requested", stripeId: null });

      hook.beforeCreate = (k) => void keys.push(k);
      await handle(d, { action: "recheck", opId: stuck?.opId ?? "" });
      const { ops } = await snapshot(d);
      const refunds = ops.filter((o) => o.kind === "refund");
      expect(refunds).toEqual([
        expect.objectContaining({ opId: stuck?.opId, state: "succeeded" }),
      ]);
      expect(keys.length).toBeGreaterThan(1);
      expect(new Set(keys)).toEqual(new Set([stuck?.opId]));
      hook.beforeCreate = () => {};
    });

    it("(h) Refund now leaves out what staff already refunded in the Stripe dashboard", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await editCase(d, expireHold);
      await accept(d);
      const { ops, exceptions } = await snapshot(d);
      await stripe().refunds.create(
        { payment_intent: latestOps(ops).charge?.stripeId ?? "", amount: 1000 },
        { idempotencyKey: "staff-dashboard-refund" },
      );
      await handle(d, {
        action: "exception",
        exceptionId: exceptions[0].exceptionId,
        do: "refund",
      });
      expect(latestOps((await snapshot(d)).ops).full_refund).toMatchObject({
        state: "succeeded",
        amountPence: 29000,
      });
    });

    it("(i) a refund Stripe rejects is never told to the customer as processing or done", async () => {
      hook.beforeCreate = (k) => {
        if (k.includes(":refund:"))
          throw stripeError("StripeInvalidRequestError", "Refund declined");
      };
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      await runUntil(d, "secure");
      hook.beforeCreate = () => {};
      const { c, ops } = await snapshot(d);
      expect(latestOps(ops).refund?.state).toBe("failed");
      const told = c.messages.filter((m) => m.to === "customer").at(-1)?.text;
      expect(told).toContain(
        "Your £20 refund did not go through. Our team will retry it.",
      );
      expect(told).not.toMatch(/refunded|being processed/);
    });

    it("(j) retrying a failed transfer revalidates settle and moves no money on a deny", async () => {
      hook.onCreate = async (x) => {
        if (String(x.id).startsWith("tr_")) x.reversed = true;
      };
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      await runUntil(d, "settle");
      hook.onCreate = async () => {};
      const failed = await snapshot(d);
      const transfer = latestOps(failed.ops).transfer;
      expect(transfer?.state).toBe("failed");
      const priya = failed.exceptions.find((e) => e.opId === transfer?.opId);

      await editCase(d, (c) => ({ ...c, originalProviderPaid: true }));
      await handle(d, {
        action: "exception",
        exceptionId: priya?.exceptionId ?? "",
        do: "retry",
      });
      const { runId, ops, exceptions } = await snapshot(d);
      expect(
        ops.filter((o) => o.kind === "transfer").map((o) => o.attempt),
      ).toEqual([1]);
      expect(exceptions).toContainEqual(
        expect.objectContaining({
          exceptionId: `EXC:${runId}:${CASE_ID}:settle`,
          owner: "Sam Okafor",
          reason: "unfunded",
          action: "retry",
          status: "open",
        }),
      );
    });
  },
);
