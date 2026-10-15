import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handle } from "@/engine/actions";
import { slotsOf } from "@/engine/case";
import { Conflict, StepError } from "@/engine/errors";
import { ladderOf, latestOps } from "@/engine/ladder";
import { col, getDemo } from "@/engine/store";
import { buildJournal, isBalanced } from "@/ledger/journal";
import { splitFor } from "@/money/math";
import {
  closeDb,
  editCase,
  expireHold,
  runToEnd,
  runUntil,
  snapshot,
  testDb,
} from "./helpers";

const SCENE = "provider-cancel" as const;
const READY = Boolean(
  process.env.STRIPE_SECRET_KEY && process.env.STRIPE_ACCT_CLEARHOME,
);

const configure = (d: Db) =>
  handle(d, { action: "configure", scenario: SCENE, source: "scripted" });
const accept = (d: Db) => handle(d, { action: "respond", decision: "accept" });

describe.skipIf(!READY)(
  READY
    ? "Scene 1 against the Stripe sandbox"
    : "Scene 1 (skipped: set STRIPE_SECRET_KEY and STRIPE_ACCT_CLEARHOME)",
  () => {
    let d: Db;
    beforeAll(async () => {
      // Deterministic constraints here; Task 13 covers the live path.
      vi.stubEnv("LIVE_EXTRACTION", "off");
      d = await testDb();
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      await closeDb();
    });

    it("runs the scripted rescue to Settled with real Stripe objects", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      const demo = await runToEnd(d);
      expect(demo).toMatchObject({
        status: "done",
        outcome: "settled",
        error: null,
      });

      const { runId, c, booking, ops, exceptions } = await snapshot(d);
      const latest = latestOps(ops);
      expect(latest.charge).toMatchObject({
        state: "succeeded",
        amountPence: 30000,
      });
      expect(latest.refund).toMatchObject({
        state: "succeeded",
        amountPence: 2000,
      });
      expect(latest.transfer).toMatchObject({
        state: "succeeded",
        amountPence: 22400,
      });
      expect(latest.transfer?.observed?.reversed).toBe(false);
      expect(c.rejected).toEqual([
        expect.objectContaining({
          providerId: expect.stringMatching(/brightnest/i),
          pricePence: 34000,
          reason: "over_subsidy",
        }),
      ]);
      expect(c.replacementProviderId).toMatch(/clearhome/i);
      expect(booking).toMatchObject({
        status: "confirmed",
        providerId: c.replacementProviderId,
      });
      expect(exceptions).toHaveLength(0);
      expect(ladderOf({ caseData: c, booking, ops, exceptions }).state).toBe(
        "settled",
      );
      expect(
        c.messages.some(
          (m) =>
            m.to === "customer" &&
            m.text.includes(String(latest.refund?.stripeId)),
        ),
      ).toBe(true);

      const journal = buildJournal({
        split: splitFor(30000, 28000),
        ops,
        fulfilment: c.fulfilment,
      });
      expect(journal).toHaveLength(latest.charge?.observed?.feePence ? 5 : 4);
      expect(journal.every(isBalanced)).toBe(true);

      // Replay re-sends the stored request with the same key: same object, no new row.
      const count = await col.payments(d).countDocuments({ runId });
      const { notice } = await handle(d, {
        action: "replay",
        opId: latest.transfer?.opId ?? "",
      });
      expect(notice).toBe(
        `Duplicate suppressed: Stripe returned the same ${latest.transfer?.stripeId}`,
      );
      expect(await col.payments(d).countDocuments({ runId })).toBe(count);
    });

    it("waits for the customer: Next is blocked and a double Accept runs once", async () => {
      await configure(d);
      const demo = await runUntil(d, "consent");
      expect(demo.status).toBe("awaiting_customer");
      const blocked = await handle(d, {
        action: "advance",
        step: demo.step,
      }).catch((e: unknown) => e);
      expect(blocked).toBeInstanceOf(StepError);
      expect((blocked as Error).message).toBe(
        "Waiting for the customer to respond.",
      );

      const results = await Promise.allSettled([accept(d), accept(d)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
        Conflict,
      );
      const { c } = await snapshot(d);
      expect(c.consent).toMatchObject({
        decision: "accept",
        pricePence: 28000,
      });
      expect(c.messages.filter((m) => m.text === "Yes, go ahead")).toHaveLength(
        1,
      );
      expect(await getDemo(d)).toMatchObject({
        status: "running",
        busyAt: null,
        error: null,
      });
    });

    it("refuses an Accept after the hold expired: Sam owns it and no money moves", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await editCase(d, expireHold);
      await accept(d);
      const { c, ops, exceptions } = await snapshot(d);
      expect(c.consent).toBeNull();
      expect(ops.map((o) => o.kind)).toEqual(["charge"]);
      expect(exceptions).toEqual([
        expect.objectContaining({
          owner: "Sam Okafor",
          reason: "hold_expired",
          action: "refund",
          status: "open",
          nextAction: "Re-offer or refund the full £300",
        }),
      ]);

      const exceptionId = exceptions[0].exceptionId;
      await expect(
        handle(d, { action: "exception", exceptionId, do: "close" }),
      ).rejects.toBeInstanceOf(StepError);
      await handle(d, { action: "exception", exceptionId, do: "refund" });
      const after = await snapshot(d);
      expect(latestOps(after.ops).full_refund).toMatchObject({
        state: "succeeded",
        amountPence: 30000,
      });
      expect(after.exceptions[0]).toMatchObject({ status: "closed" });
    });

    it("secure revalidation fails on an expired hold and commits nothing", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      await editCase(d, expireHold);
      const demo = await runUntil(d, "secure");
      const { c, booking, ops, exceptions } = await snapshot(d);
      expect(booking.status).toBe("provider_cancelled");
      expect(c.offers.some((o) => o.state === "secured")).toBe(false);
      expect(ops.some((o) => o.kind === "refund")).toBe(false);
      expect(exceptions).toEqual([
        expect.objectContaining({
          owner: "Sam Okafor",
          reason: "hold_expired",
          action: "refund",
        }),
      ]);
      // Nothing was secured, so fulfil refuses until someone acts on the exception.
      await expect(
        handle(d, { action: "advance", step: demo.step }),
      ).rejects.toBeInstanceOf(StepError);
    });

    it("slow presenter: settle succeeds after the hold has expired", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await accept(d);
      await runUntil(d, "secure");
      await editCase(d, expireHold);
      const demo = await runToEnd(d);
      expect(demo.outcome).toBe("settled");
      const { ops } = await snapshot(d);
      expect(latestOps(ops).transfer).toMatchObject({
        state: "succeeded",
        amountPence: 22400,
      });
    });

    it("decline releases the hold, refunds in full and ends Remedied", async () => {
      await configure(d);
      await runUntil(d, "consent");
      await handle(d, { action: "respond", decision: "decline" });
      expect(await getDemo(d)).toMatchObject({
        status: "done",
        outcome: "remedied",
      });
      const { recs, c, booking, ops, exceptions } = await snapshot(d);
      expect(c.status).toBe("declined");
      expect(c.consent).toMatchObject({ decision: "decline" });
      expect(latestOps(ops).full_refund).toMatchObject({
        state: "succeeded",
        amountPence: 30000,
      });
      const released = c.offers.find((o) => o.state === "released");
      expect(
        slotsOf(recs).find((s) => s.recordId === released?.slotId)?.data.status,
      ).toBe("free");
      expect(
        c.messages.some(
          (m) => m.to === "provider" && m.text.startsWith("Hold released"),
        ),
      ).toBe(true);
      expect(ladderOf({ caseData: c, booking, ops, exceptions }).state).toBe(
        "remedied",
      );
    });
  },
);
