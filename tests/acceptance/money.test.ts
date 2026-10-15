import type { Db } from "mongodb";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PaymentOp } from "@/engine/docs";
import { Conflict, StepError } from "@/engine/errors";
import { col, DEFAULT_CONFIG, getDemo, resetDemo } from "@/engine/store";
import {
  chargeFacts,
  chargeRef,
  chargeRequest,
  insertIntent,
  opsFor,
  refundRequest,
  replayOp,
  retryOp,
  runOp,
  transferRequest,
  type OpDeps,
  type OpSpec,
} from "@/money/ops";
import { findExisting, transferGroupOf } from "@/money/reconcile";
import { stripe, type StripeClient } from "@/money/stripe";
import { fakeStripe } from "./fakeStripe";
import { closeDb, testDb } from "./helpers";

const ACCT = process.env.STRIPE_ACCT_CLEARHOME ?? "";
const ready = Boolean(process.env.STRIPE_SECRET_KEY && ACCT);
if (!ready)
  console.warn(
    "Skipping tests/acceptance/money.test.ts: set STRIPE_SECRET_KEY and STRIPE_ACCT_CLEARHOME in .env.local to run it against the Stripe sandbox.",
  );

const CASE = "CASE-1042";
const BOOKING = "BK-1042";

// Both blocks share the cached Mongo client, so it is opened and closed once per file.
let d: Db;
beforeAll(async () => {
  d = await testDb();
});
afterAll(closeDb);

describe.skipIf(!process.env.MONGODB_URI)(
  "money outbox state machine with a fake Stripe",
  () => {
    const PI = "pi_fake";
    let run: string;

    beforeEach(async () => {
      await resetDemo(d, DEFAULT_CONFIG);
      run = (await getDemo(d)).runId;
    });

    const deps = (s: StripeClient): OpDeps => ({
      stripe: s,
      sleep: async () => {},
    });
    const refundSpec = (): OpSpec => ({
      runId: run,
      caseId: CASE,
      kind: "refund",
      attempt: 1,
      amountPence: 2000,
      request: refundRequest({
        runId: run,
        bookingId: BOOKING,
        amountPence: 2000,
        paymentIntent: PI,
      }),
    });
    const setOp = (opId: string, set: Partial<PaymentOp>) =>
      col.payments(d).updateOne({ opId }, { $set: set });
    const rows = () =>
      col.payments(d).find({ runId: run }).sort({ attempt: 1 }).toArray();
    const moveRun = () =>
      col
        .demo(d)
        .updateOne({ _id: "demo" }, { $set: { runId: `${run}-next` } });

    it("(a) refuses a stale run before calling Stripe", async () => {
      const f = fakeStripe();
      const op = await insertIntent(d, refundSpec());
      await moveRun();
      await expect(runOp(d, op.opId, deps(f.s))).rejects.toBeInstanceOf(
        Conflict,
      );
      expect(f.calls).toEqual([]);
      expect(await col.payments(d).findOne({ opId: op.opId })).toMatchObject({
        state: "intended",
        stripeId: null,
      });
    });

    it("(b) refuses the save when a reset lands during the Stripe call", async () => {
      const f = fakeStripe(() => resetDemo(d, DEFAULT_CONFIG));
      const op = await insertIntent(d, refundSpec());
      await expect(runOp(d, op.opId, deps(f.s))).rejects.toBeInstanceOf(
        Conflict,
      );
      expect(f.calls).toEqual([`create:${op.opId}`]);
      expect((await getDemo(d)).runId).not.toBe(op.runId);
      expect(await col.payments(d).countDocuments({ runId: op.runId })).toBe(0);
    });

    it("(c) a requested row adopts the object Stripe already has for its opId", async () => {
      const f = fakeStripe();
      const op = await insertIntent(d, refundSpec());
      await setOp(op.opId, { state: "requested" });
      const existing = f.seed(op.opId);
      expect(await runOp(d, op.opId, deps(f.s))).toMatchObject({
        state: "succeeded",
        stripeId: existing.id,
      });
      expect(f.calls).toEqual(["list", `retrieve:${existing.id}`]);
      expect(await rows()).toHaveLength(1);
    });

    it("(c) a requested row Stripe never saw is resent with the same key", async () => {
      const f = fakeStripe();
      const op = await insertIntent(d, refundSpec());
      await setOp(op.opId, { state: "requested" });
      expect(await runOp(d, op.opId, deps(f.s))).toMatchObject({
        state: "succeeded",
        stripeId: "re_fake1",
      });
      expect(f.calls).toEqual([
        "list",
        `create:${op.opId}`,
        "retrieve:re_fake1",
      ]);
      expect(await rows()).toHaveLength(1);
    });

    it("(d) retryOp adopts the object reconciliation finds and makes no attempt 2", async () => {
      const f = fakeStripe();
      const op = await insertIntent(d, refundSpec());
      await setOp(op.opId, { state: "failed", error: "Server error" });
      const existing = f.seed(op.opId);
      expect(await retryOp(d, op.opId, deps(f.s))).toMatchObject({
        opId: op.opId,
        state: "succeeded",
        stripeId: existing.id,
      });
      expect(f.calls).toEqual(["list", `retrieve:${existing.id}`]);
      expect(await rows()).toHaveLength(1);
    });

    it("(e) retryOp makes exactly one attempt 2 with a new key when nothing is found", async () => {
      const f = fakeStripe();
      const op = await insertIntent(d, refundSpec());
      await setOp(op.opId, { state: "failed", error: "Declined" });
      const next = await retryOp(d, op.opId, deps(f.s));
      expect(next).toMatchObject({
        opId: `${run}:${CASE}:refund:2`,
        attempt: 2,
        state: "succeeded",
        stripeId: "re_fake1",
      });
      expect(f.calls).toEqual([
        "list",
        `create:${next.opId}`,
        "retrieve:re_fake1",
      ]);
      expect((await rows()).map((o) => [o.attempt, o.state])).toEqual([
        [1, "failed"],
        [2, "succeeded"],
      ]);
    });

    it("(f) retryOp on an op that has not failed changes nothing", async () => {
      const f = fakeStripe();
      const op = await insertIntent(d, refundSpec());
      await setOp(op.opId, { state: "succeeded", stripeId: "re_done" });
      expect(await retryOp(d, op.opId, deps(f.s))).toMatchObject({
        opId: op.opId,
        state: "succeeded",
        stripeId: "re_done",
      });
      expect(f.calls).toEqual([]);
      expect(await rows()).toHaveLength(1);
    });

    it("(g) replayOp refuses an op older than 23 hours without calling Stripe", async () => {
      const f = fakeStripe();
      const op = await runOp(
        d,
        (await insertIntent(d, refundSpec())).opId,
        deps(f.s),
      );
      expect(await replayOp(d, op.opId, deps(f.s))).toEqual({
        stripeId: op.stripeId,
        same: true,
      });
      const before = f.calls.length;
      await setOp(op.opId, {
        createdAt: new Date(Date.now() - 24 * 3_600_000),
      });
      const err = await replayOp(d, op.opId, deps(f.s)).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(StepError);
      expect((err as Error).message).toBe(
        "Replay only works within 24 hours; reset the demo.",
      );
      expect(f.calls).toHaveLength(before);
    });

    it("(g) replayOp refuses a stale run without calling Stripe", async () => {
      const f = fakeStripe();
      const op = await runOp(
        d,
        (await insertIntent(d, refundSpec())).opId,
        deps(f.s),
      );
      const before = f.calls.length;
      await moveRun();
      await expect(replayOp(d, op.opId, deps(f.s))).rejects.toBeInstanceOf(
        Conflict,
      );
      expect(f.calls).toHaveLength(before);
    });
  },
);

describe.skipIf(!ready)("money outbox against the Stripe sandbox", () => {
  // A fresh runId per test keeps idempotency keys unique across sandbox runs.
  async function newRun(): Promise<string> {
    const runId = `run-t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await col.payments(d).deleteMany({});
    await col.demo(d).replaceOne(
      { _id: "demo" },
      {
        scenario: "provider-cancel",
        mode: "monitor",
        source: "scripted",
        runId,
        steps: [],
        step: -1,
        status: "running",
        outcome: null,
        error: null,
        busyAt: null,
        denial: null,
      },
      { upsert: true },
    );
    return runId;
  }

  const chargeSpec = (runId: string): OpSpec => ({
    runId,
    caseId: CASE,
    kind: "charge",
    attempt: 1,
    amountPence: 30000,
    request: chargeRequest({ runId, bookingId: BOOKING, amountPence: 30000 }),
  });
  const refundSpec = (runId: string, paymentIntent: string): OpSpec => ({
    runId,
    caseId: CASE,
    kind: "refund",
    attempt: 1,
    amountPence: 2000,
    request: refundRequest({
      runId,
      bookingId: BOOKING,
      amountPence: 2000,
      paymentIntent,
    }),
  });
  const transferSpec = (runId: string, chargeId: string): OpSpec => ({
    runId,
    caseId: CASE,
    kind: "transfer",
    attempt: 1,
    amountPence: 22400,
    request: transferRequest({
      runId,
      bookingId: BOOKING,
      amountPence: 22400,
      destination: ACCT,
      chargeId,
    }),
  });

  async function charged(runId: string) {
    const op = await runOp(d, (await insertIntent(d, chargeSpec(runId))).opId);
    expect(op.state).toBe("succeeded");
    return chargeRef(d, runId, CASE);
  }
  const transfersIn = async (runId: string) =>
    (
      await stripe().transfers.list({
        transfer_group: transferGroupOf(BOOKING, runId),
        limit: 100,
      })
    ).data;

  it("charges, refunds and pays out with verified objects, and Replay creates nothing new", async () => {
    const runId = await newRun();
    const ref = await charged(runId);
    expect(ref.paymentIntent).toMatch(/^pi_/);

    const refund = await runOp(
      d,
      (await insertIntent(d, refundSpec(runId, ref.paymentIntent))).opId,
    );
    expect(refund).toMatchObject({ state: "succeeded", amountPence: 2000 });
    expect(refund.stripeId).toMatch(/^re_/);

    const transfer = await runOp(
      d,
      (await insertIntent(d, transferSpec(runId, ref.chargeId))).opId,
    );
    expect(transfer).toMatchObject({ state: "succeeded", amountPence: 22400 });
    expect(transfer.stripeId).toMatch(/^tr_/);
    expect(transfer.observed?.reversed).toBe(false);

    expect(await chargeFacts(d, runId, CASE)).toEqual({
      amount: 30000,
      amountRefunded: 2000,
      succeeded: true,
    });
    expect(
      (await opsFor(d, runId, CASE)).map((o) => [o.kind, o.state]),
    ).toEqual([
      ["charge", "succeeded"],
      ["refund", "succeeded"],
      ["transfer", "succeeded"],
    ]);

    const count = await col.payments(d).countDocuments();
    expect(await replayOp(d, transfer.opId)).toEqual({
      stripeId: transfer.stripeId,
      same: true,
    });
    expect(await runOp(d, transfer.opId)).toMatchObject({
      state: "succeeded",
      stripeId: transfer.stripeId,
    });
    expect(await col.payments(d).countDocuments()).toBe(count);
    expect((await transfersIn(runId)).map((t) => t.id)).toEqual([
      transfer.stripeId,
    ]);
  });

  it("a row left requested with no stripeId recovers the same Stripe object", async () => {
    const runId = await newRun();
    // Simulate a crash after Stripe answered but before Mongo saved the id.
    const op = await insertIntent(d, chargeSpec(runId));
    const pi = await stripe().paymentIntents.create(
      op.request as unknown as Stripe.PaymentIntentCreateParams,
      { idempotencyKey: op.opId },
    );
    await col
      .payments(d)
      .updateOne({ opId: op.opId }, { $set: { state: "requested" } });
    expect(await runOp(d, op.opId)).toMatchObject({
      state: "succeeded",
      stripeId: pi.id,
    });

    const rop = await insertIntent(d, refundSpec(runId, pi.id));
    const re = await stripe().refunds.create(
      rop.request as unknown as Stripe.RefundCreateParams,
      {
        idempotencyKey: rop.opId,
      },
    );
    await col
      .payments(d)
      .updateOne({ opId: rop.opId }, { $set: { state: "requested" } });
    expect(await findExisting(stripe(), { ...rop, state: "requested" })).toBe(
      re.id,
    );
    expect(await runOp(d, rop.opId)).toMatchObject({
      state: "succeeded",
      stripeId: re.id,
    });
    expect(
      (await stripe().refunds.list({ payment_intent: pi.id, limit: 100 })).data,
    ).toHaveLength(1);
  });

  it("two concurrent inserts and runOp calls on one opId give one row and one Stripe object", async () => {
    const runId = await newRun();
    const ref = await charged(runId);
    const spec = transferSpec(runId, ref.chargeId);
    const [a, b] = await Promise.all([
      insertIntent(d, spec),
      insertIntent(d, spec),
    ]);
    expect(a.opId).toBe(b.opId);
    expect(await col.payments(d).countDocuments({ opId: a.opId })).toBe(1);

    const [x, y] = await Promise.all([runOp(d, a.opId), runOp(d, a.opId)]);
    expect(x.stripeId).toMatch(/^tr_/);
    expect(y.stripeId).toBe(x.stripeId);
    expect(await transfersIn(runId)).toHaveLength(1);
    expect((await runOp(d, a.opId)).state).toBe("succeeded");
  });

  it("refuses to call Stripe or write once the demo moved to a new run", async () => {
    const runId = await newRun();
    const op = await insertIntent(d, chargeSpec(runId));
    await col
      .demo(d)
      .updateOne({ _id: "demo" }, { $set: { runId: `${runId}-next` } });
    await expect(runOp(d, op.opId)).rejects.toBeInstanceOf(Conflict);
    expect(await col.payments(d).findOne({ opId: op.opId })).toMatchObject({
      state: "intended",
      stripeId: null,
    });
  });

  it("a reset during the Stripe call leaves no late write behind", async () => {
    const runId = await newRun();
    const op = await insertIntent(d, chargeSpec(runId));
    const real = stripe();
    // Stripe answers, then the presenter resets before the outbox saves the result.
    const resetMidCall = {
      ...real,
      paymentIntents: {
        create: async (
          params: Stripe.PaymentIntentCreateParams,
          opts?: Stripe.RequestOptions,
        ) => {
          const pi = await real.paymentIntents.create(params, opts);
          await col.payments(d).deleteMany({});
          await col
            .demo(d)
            .updateOne({ _id: "demo" }, { $set: { runId: `${runId}-next` } });
          return pi;
        },
      },
    } as unknown as StripeClient;
    await expect(
      runOp(d, op.opId, { stripe: resetMidCall }),
    ).rejects.toBeInstanceOf(Conflict);
    expect(await col.payments(d).countDocuments()).toBe(0);
  });
});
