import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { OpKind, OpState, PaymentOp } from "@/engine/docs";
import {
  chargeRequest,
  intentDoc,
  nextAttempt,
  opIdOf,
  refundRequest,
  sendOp,
  transferRequest,
} from "@/money/ops";
import { findExisting, transferGroupOf } from "@/money/reconcile";
import type { StripeClient } from "@/money/stripe";
import { classify, nextState, outcomeOf, verifyOp } from "@/money/verify";

const NOW = new Date("2026-10-16T09:00:00.000Z");
const RUN = "run-a";
const CASE = "CASE-1042";
const BOOKING = "BK-1042";
const ACCT = "acct_clearhome";

type Obj = { id: string; metadata: Record<string, string> } & Record<
  string,
  unknown
>;
type Opts = { idempotencyKey?: string } | undefined;

// In-memory Stripe: one object per idempotency key; list and search filter like the real API.
function fakeStripe(
  seed: { intents?: Obj[]; refunds?: Obj[]; transfers?: Obj[] } = {},
) {
  const intents = [...(seed.intents ?? [])];
  const refunds = [...(seed.refunds ?? [])];
  const transfers = [...(seed.transfers ?? [])];
  const calls: { params: Record<string, unknown>; key: string | undefined }[] =
    [];
  const failures: unknown[] = [];
  const byKey = new Map<string, Obj>();
  const create =
    (bucket: Obj[], prefix: string) =>
    async (params: Record<string, unknown>, opts: Opts) => {
      calls.push({ params, key: opts?.idempotencyKey });
      if (failures.length > 0) throw failures.shift();
      const key = opts?.idempotencyKey ?? `no-key-${calls.length}`;
      const hit = byKey.get(key);
      if (hit) return hit;
      const obj: Obj = {
        ...params,
        id: `${prefix}_${byKey.size + 1}`,
        metadata: { ...(params.metadata as Record<string, string>) },
      };
      byKey.set(key, obj);
      bucket.push(obj);
      return obj;
    };
  const retrieve = (bucket: Obj[]) => async (id: string) => {
    const found = bucket.find((o) => o.id === id);
    if (!found)
      throw new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        message: `No such object: ${id}`,
        statusCode: 404,
      });
    return found;
  };
  const client = {
    paymentIntents: {
      create: create(intents, "pi"),
      retrieve: retrieve(intents),
      search: async (p: { query: string }) => ({
        data: intents.filter((o) => p.query.includes(`'${o.metadata.opId}'`)),
      }),
    },
    refunds: {
      create: create(refunds, "re"),
      retrieve: retrieve(refunds),
      list: async (p: { payment_intent?: string }) => ({
        data: refunds.filter((o) => o.payment_intent === p.payment_intent),
      }),
    },
    transfers: {
      create: create(transfers, "tr"),
      retrieve: retrieve(transfers),
      list: async (p: { transfer_group?: string; destination?: string }) => ({
        data: transfers.filter(
          (o) =>
            (p.transfer_group === undefined ||
              o.transfer_group === p.transfer_group) &&
            (p.destination === undefined || o.destination === p.destination),
        ),
      }),
    },
    balance: {},
    accounts: {},
  } as unknown as StripeClient;
  return { client, calls, failures };
}

const opOf = (
  kind: OpKind,
  amountPence: number,
  request: Record<string, unknown>,
  attempt = 1,
): PaymentOp =>
  intentDoc(
    { runId: RUN, caseId: CASE, kind, attempt, amountPence, request },
    NOW,
  );
const chargeOp = () =>
  opOf(
    "charge",
    30000,
    chargeRequest({ runId: RUN, bookingId: BOOKING, amountPence: 30000 }),
  );
const refundOp = () =>
  opOf(
    "refund",
    2000,
    refundRequest({
      runId: RUN,
      bookingId: BOOKING,
      amountPence: 2000,
      paymentIntent: "pi_1",
    }),
  );
const transferOp = () =>
  opOf(
    "transfer",
    22400,
    transferRequest({
      runId: RUN,
      bookingId: BOOKING,
      amountPence: 22400,
      destination: ACCT,
      chargeId: "ch_1",
    }),
  );
const sent = (op: PaymentOp, stripeId: string): PaymentOp => ({
  ...op,
  state: "pending",
  stripeId,
});
const noSleep = async () => {};

const cardError = () =>
  new Stripe.errors.StripeCardError({
    type: "card_error",
    message: "Your card was declined.",
    statusCode: 402,
  });
const invalid = (statusCode: number) =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    message: "Invalid request",
    statusCode,
  });
const keyInUse = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "idempotency_key_in_use",
    message: "Key in use",
    statusCode: 409,
  });
const mismatch = () =>
  new Stripe.errors.StripeIdempotencyError({
    type: "idempotency_error",
    message:
      "Keys for idempotent requests can only be used with the same parameters",
    statusCode: 400,
  });
const connection = () =>
  new Stripe.errors.StripeConnectionError({
    type: "api_error",
    message: "socket hang up",
  });
const serverError = () =>
  new Stripe.errors.StripeAPIError({
    type: "api_error",
    message: "Server error",
    statusCode: 500,
  });
const rateLimited = () =>
  new Stripe.errors.StripeRateLimitError({
    type: "rate_limit_error",
    message: "Too many requests",
    statusCode: 429,
  });

describe("classify and outcomeOf", () => {
  it("treats card, invalid request, not found and idempotency mismatch as definitive", () => {
    for (const e of [cardError(), invalid(400), invalid(404), mismatch()])
      expect(classify(e)).toBe("definitive");
  });

  it("treats connection, 5xx, 429, 409 key in use and unknown errors as ambiguous", () => {
    for (const e of [
      connection(),
      serverError(),
      rateLimited(),
      keyInUse(),
      new Error("boom"),
    ])
      expect(classify(e)).toBe("ambiguous");
  });

  it("names an idempotency mismatch and keeps Stripe's message otherwise", () => {
    expect(outcomeOf(mismatch())).toEqual({
      kind: "rejected",
      message: "idempotency mismatch",
    });
    expect(outcomeOf(cardError())).toEqual({
      kind: "rejected",
      message: "Your card was declined.",
    });
    expect(outcomeOf(serverError())).toEqual({
      kind: "ambiguous",
      message: "Server error",
    });
  });
});

describe("nextState", () => {
  const requested: PaymentOp = { ...chargeOp(), state: "requested" };

  it("saves the id and waits for verification after a create", () =>
    expect(nextState(requested, { kind: "created", stripeId: "pi_9" })).toEqual(
      {
        state: "pending",
        stripeId: "pi_9",
        error: null,
      },
    ));

  it("fails on a definitive rejection", () =>
    expect(
      nextState(requested, { kind: "rejected", message: "declined" }),
    ).toEqual({
      state: "failed",
      stripeId: null,
      error: "declined",
    }));

  it("stays requested while the outcome is ambiguous", () =>
    expect(
      nextState(requested, { kind: "ambiguous", message: "timeout" }),
    ).toEqual({
      state: "requested",
      stripeId: null,
      error: "Reconciling: timeout",
    }));

  it("never moves an op that already finished", () => {
    const done: PaymentOp = {
      ...requested,
      state: "succeeded",
      stripeId: "pi_1",
    };
    expect(nextState(done, { kind: "rejected", message: "late" })).toEqual({
      state: "succeeded",
      stripeId: "pi_1",
      error: null,
    });
  });
});

describe("sendOp", () => {
  it("sends the stored request with opId as the idempotency key", async () => {
    const f = fakeStripe();
    const op = transferOp();
    expect(await sendOp(f.client, op, noSleep)).toEqual({
      kind: "created",
      stripeId: "tr_1",
    });
    expect(f.calls).toEqual([{ params: op.request, key: op.opId }]);
  });

  it("retries ambiguous errors with the same key and backoff", async () => {
    const f = fakeStripe();
    f.failures.push(connection(), keyInUse());
    const slept: number[] = [];
    const op = refundOp();
    const out = await sendOp(f.client, op, async (ms) => {
      slept.push(ms);
    });
    expect(out).toEqual({ kind: "created", stripeId: "re_1" });
    expect(f.calls.map((c) => c.key)).toEqual([op.opId, op.opId, op.opId]);
    expect(slept).toEqual([500, 1000]);
  });

  it("gives up after three same-key retries and stays ambiguous", async () => {
    const f = fakeStripe();
    f.failures.push(serverError(), serverError(), serverError(), serverError());
    const slept: number[] = [];
    const out = await sendOp(f.client, chargeOp(), async (ms) => {
      slept.push(ms);
    });
    expect(out).toEqual({ kind: "ambiguous", message: "Server error" });
    expect(f.calls).toHaveLength(4);
    expect(slept).toEqual([500, 1000, 2000]);
  });

  it("stops at the first definitive rejection", async () => {
    const f = fakeStripe();
    f.failures.push(cardError());
    expect(await sendOp(f.client, chargeOp(), noSleep)).toEqual({
      kind: "rejected",
      message: "Your card was declined.",
    });
    expect(f.calls).toHaveLength(1);
  });

  it("a second send with the same key returns the same object", async () => {
    const f = fakeStripe();
    const op = transferOp();
    const first = await sendOp(f.client, op, noSleep);
    expect(await sendOp(f.client, op, noSleep)).toEqual(first);
  });
});

describe("verifyOp", () => {
  const pi = (over: Record<string, unknown> = {}): Obj => ({
    id: "pi_1",
    amount: 30000,
    status: "succeeded",
    metadata: {},
    latest_charge: {
      id: "ch_1",
      amount_refunded: 2000,
      balance_transaction: { id: "txn_1", fee: 470 },
    },
    ...over,
  });
  const refund = (status: string): Obj => ({
    id: "re_1",
    amount: 2000,
    status,
    balance_transaction: "txn_2",
    metadata: {},
  });
  const transfer = (over: Record<string, unknown> = {}): Obj => ({
    id: "tr_1",
    amount: 22400,
    destination: ACCT,
    reversed: false,
    transfer_group: transferGroupOf(BOOKING, RUN),
    balance_transaction: { id: "txn_3" },
    metadata: {},
    ...over,
  });

  it("charge: succeeded, with the fee from the expanded balance transaction", async () => {
    const f = fakeStripe({ intents: [pi()] });
    expect(await verifyOp(f.client, sent(chargeOp(), "pi_1"), NOW)).toEqual({
      state: "succeeded",
      observed: {
        status: "succeeded",
        amountRefunded: 2000,
        balanceTransaction: "txn_1",
        feePence: 470,
        reversed: null,
        checkedAt: NOW,
      },
    });
  });

  it("charge: processing is pending; canceled or a wrong amount is failed", async () => {
    const cases: [Record<string, unknown>, OpState][] = [
      [{ status: "processing" }, "pending"],
      [{ status: "canceled" }, "failed"],
      [{ amount: 29999 }, "failed"],
    ];
    for (const [over, state] of cases) {
      const f = fakeStripe({ intents: [pi(over)] });
      expect(
        (await verifyOp(f.client, sent(chargeOp(), "pi_1"), NOW)).state,
      ).toBe(state);
    }
  });

  it("refund: only succeeded counts; failed and canceled fail; the rest stay pending", async () => {
    const cases: [string, OpState][] = [
      ["succeeded", "succeeded"],
      ["pending", "pending"],
      ["requires_action", "pending"],
      ["failed", "failed"],
      ["canceled", "failed"],
    ];
    for (const [status, state] of cases) {
      const f = fakeStripe({ refunds: [refund(status)] });
      const v = await verifyOp(f.client, sent(refundOp(), "re_1"), NOW);
      expect(v.state).toBe(state);
      expect(v.observed).toMatchObject({
        status,
        balanceTransaction: "txn_2",
        reversed: null,
      });
    }
  });

  it("transfer: succeeded only when not reversed and amount and destination match", async () => {
    const cases: [Record<string, unknown>, OpState][] = [
      [{}, "succeeded"],
      [{ reversed: true }, "failed"],
      [{ amount: 22000 }, "failed"],
      [{ destination: "acct_other" }, "failed"],
    ];
    for (const [over, state] of cases) {
      const f = fakeStripe({ transfers: [transfer(over)] });
      const v = await verifyOp(f.client, sent(transferOp(), "tr_1"), NOW);
      expect(v.state).toBe(state);
      expect(v.observed.balanceTransaction).toBe("txn_3");
    }
  });
});

describe("findExisting", () => {
  it("adopts a refund only by metadata.opId, never a leftover with the same amount", async () => {
    const op = refundOp();
    const leftover: Obj = {
      id: "re_old",
      amount: 2000,
      payment_intent: "pi_1",
      status: "succeeded",
      metadata: { opId: "run-old:CASE-1042:refund:1" },
    };
    expect(
      await findExisting(fakeStripe({ refunds: [leftover] }).client, op),
    ).toBeNull();
    const mine: Obj = {
      ...leftover,
      id: "re_mine",
      metadata: { opId: op.opId },
    };
    expect(
      await findExisting(fakeStripe({ refunds: [leftover, mine] }).client, op),
    ).toBe("re_mine");
  });

  it("ignores an earlier run's identical 22400 transfer to ClearHome", async () => {
    const op = transferOp();
    const old: Obj = {
      id: "tr_old",
      amount: 22400,
      destination: ACCT,
      reversed: false,
      transfer_group: transferGroupOf(BOOKING, "run-old"),
      metadata: { opId: "run-old:CASE-1042:transfer:1" },
    };
    expect(
      await findExisting(fakeStripe({ transfers: [old] }).client, op),
    ).toBeNull();
    const mine: Obj = {
      ...old,
      id: "tr_mine",
      transfer_group: transferGroupOf(BOOKING, RUN),
      metadata: { opId: op.opId },
    };
    expect(
      await findExisting(fakeStripe({ transfers: [old, mine] }).client, op),
    ).toBe("tr_mine");
  });

  it("finds a transfer by destination when it did not inherit the group", async () => {
    const op = transferOp();
    const mine: Obj = {
      id: "tr_mine",
      amount: 22400,
      destination: ACCT,
      transfer_group: null,
      metadata: { opId: op.opId },
    };
    expect(
      await findExisting(fakeStripe({ transfers: [mine] }).client, op),
    ).toBe("tr_mine");
  });

  it("finds a charge through search on metadata.opId only", async () => {
    const op = chargeOp();
    const old: Obj = {
      id: "pi_old",
      amount: 30000,
      status: "succeeded",
      metadata: { opId: "run-old:CASE-1042:charge:1" },
    };
    expect(
      await findExisting(fakeStripe({ intents: [old] }).client, op),
    ).toBeNull();
    const mine: Obj = { ...old, id: "pi_mine", metadata: { opId: op.opId } };
    expect(
      await findExisting(fakeStripe({ intents: [old, mine] }).client, op),
    ).toBe("pi_mine");
  });
});

describe("intentDoc and request builders", () => {
  it("builds the opId and stamps it into the stored request metadata", () => {
    const op = transferOp();
    expect(op.opId).toBe("run-a:CASE-1042:transfer:1");
    expect(opIdOf(op)).toBe(op.opId);
    expect(op).toMatchObject({
      state: "intended",
      stripeId: null,
      observed: null,
      error: null,
      attempt: 1,
    });
    expect(op.request).toEqual({
      amount: 22400,
      currency: "gbp",
      destination: ACCT,
      source_transaction: "ch_1",
      metadata: { bookingId: BOOKING, runId: RUN, opId: op.opId },
    });
  });

  it("charges by card only, confirmed server side, grouped by booking and run", () => {
    expect(chargeOp().request).toMatchObject({
      amount: 30000,
      currency: "gbp",
      allowed_payment_method_types: ["card"],
      confirm: true,
      transfer_group: "booking_BK-1042_run-a",
    });
  });

  it("rejects a request amount that differs from amountPence, and non-integer pence", () => {
    expect(() =>
      opOf(
        "refund",
        2000,
        refundRequest({
          runId: RUN,
          bookingId: BOOKING,
          amountPence: 1999,
          paymentIntent: "pi_1",
        }),
      ),
    ).toThrow();
    expect(() =>
      opOf(
        "refund",
        20.5,
        refundRequest({
          runId: RUN,
          bookingId: BOOKING,
          amountPence: 20.5,
          paymentIntent: "pi_1",
        }),
      ),
    ).toThrow();
  });

  it("the next attempt keeps the request and gets a new opId", () => {
    const op = refundOp();
    const next = intentDoc(nextAttempt(op), NOW);
    expect(next.opId).toBe("run-a:CASE-1042:refund:2");
    expect(next.request).toEqual({
      ...op.request,
      metadata: {
        ...(op.request.metadata as Record<string, string>),
        opId: next.opId,
      },
    });
  });
});
