import { MongoServerError, type ClientSession, type Db } from "mongodb";
import type Stripe from "stripe";
import type { OpKind, PaymentOp } from "@/engine/docs";
import { Conflict, StepError } from "@/engine/errors";
import { autoCloseForOp } from "@/engine/exceptions";
import { latestOps } from "@/engine/ladder";
import type { ChargeFacts } from "@/engine/policy";
import { col } from "@/engine/store";
import { findExisting, transferGroupOf } from "./reconcile";
import { stripe, TEST_PAYMENT_METHOD, type StripeClient } from "./stripe";
import {
  nextState,
  outcomeOf,
  verifyOp,
  type CallOutcome,
  type Verified,
} from "./verify";

type Sleep = (ms: number) => Promise<void>;
export type OpSpec = {
  runId: string;
  caseId: string;
  kind: OpKind;
  attempt: number;
  amountPence: number;
  request: Record<string, unknown>;
};
export type OpDeps = { stripe?: StripeClient; sleep?: Sleep; now?: () => Date };

const BACKOFF_MS = [500, 1000, 2000];
const verifyTries = () => Number(process.env.STRIPE_VERIFY_TRIES) || 5;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STALE_RUN =
  "The demo was reset while this payment was running. Nothing was saved to the new run.";

export const opIdOf = (
  s: Pick<OpSpec, "runId" | "caseId" | "kind" | "attempt">,
): string => `${s.runId}:${s.caseId}:${s.kind}:${s.attempt}`;

// Request builders. insertIntent adds metadata.opId.
type Base = { runId: string; bookingId: string; amountPence: number };
const metaOf = (x: Base) => ({ bookingId: x.bookingId, runId: x.runId });

export const chargeRequest = (x: Base): Record<string, unknown> => ({
  amount: x.amountPence,
  currency: "gbp",
  payment_method: TEST_PAYMENT_METHOD,
  // Card only, so a server-side confirm never needs a return_url.
  allowed_payment_method_types: ["card"],
  confirm: true,
  transfer_group: transferGroupOf(x.bookingId, x.runId),
  metadata: metaOf(x),
});

export const refundRequest = (
  x: Base & { paymentIntent: string },
): Record<string, unknown> => ({
  payment_intent: x.paymentIntent,
  amount: x.amountPence,
  metadata: metaOf(x),
});

// No transfer_group: source_transaction inherits the charge's group.
export const transferRequest = (
  x: Base & { destination: string; chargeId: string },
): Record<string, unknown> => ({
  amount: x.amountPence,
  currency: "gbp",
  destination: x.destination,
  source_transaction: x.chargeId,
  metadata: metaOf(x),
});

export function intentDoc(spec: OpSpec, now: Date): PaymentOp {
  if (!Number.isSafeInteger(spec.amountPence) || spec.amountPence <= 0)
    throw new Error(
      `amountPence must be a positive integer, got ${spec.amountPence}.`,
    );
  // The amount shown in the app and the amount sent to Stripe must never drift apart.
  if (spec.request.amount !== spec.amountPence)
    throw new Error(
      `request.amount ${String(spec.request.amount)} does not match amountPence ${spec.amountPence}.`,
    );
  const opId = opIdOf(spec);
  return {
    opId,
    runId: spec.runId,
    caseId: spec.caseId,
    kind: spec.kind,
    attempt: spec.attempt,
    amountPence: spec.amountPence,
    request: {
      ...spec.request,
      metadata: {
        ...(spec.request.metadata as Record<string, string> | undefined),
        opId,
      },
    },
    state: "intended",
    stripeId: null,
    observed: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const nextAttempt = (op: PaymentOp): OpSpec => ({
  runId: op.runId,
  caseId: op.caseId,
  kind: op.kind,
  attempt: op.attempt + 1,
  amountPence: op.amountPence,
  request: op.request,
});

export async function insertIntent(
  d: Db,
  spec: OpSpec,
  session?: ClientSession,
): Promise<PaymentOp> {
  const op = intentDoc(spec, new Date());
  const existing = await col
    .payments(d)
    .findOne({ opId: op.opId }, { session });
  if (existing) return existing;
  try {
    await col.payments(d).insertOne({ ...op }, { session });
    return op;
  } catch (e) {
    // A duplicate key aborts a transaction, so only the session-less race is recovered here.
    if (session || !(e instanceof MongoServerError && e.code === 11000))
      throw e;
    const winner = await col.payments(d).findOne({ opId: op.opId });
    if (!winner) throw e;
    return winner;
  }
}

// Stripe calls

async function create(s: StripeClient, op: PaymentOp): Promise<string> {
  // Always the stored request: Stripe rejects a reused key whose params changed.
  const params: unknown = op.request;
  const opts = { idempotencyKey: op.opId };
  if (op.kind === "charge")
    return (
      await s.paymentIntents.create(
        params as Stripe.PaymentIntentCreateParams,
        opts,
      )
    ).id;
  if (op.kind === "transfer")
    return (
      await s.transfers.create(params as Stripe.TransferCreateParams, opts)
    ).id;
  return (await s.refunds.create(params as Stripe.RefundCreateParams, opts)).id;
}

export async function sendOp(
  s: StripeClient,
  op: PaymentOp,
  sleep: Sleep,
): Promise<CallOutcome> {
  let last: CallOutcome = {
    kind: "ambiguous",
    message: "Stripe was not reached.",
  };
  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    if (i > 0) await sleep(BACKOFF_MS[i - 1]);
    try {
      return { kind: "created", stripeId: await create(s, op) };
    } catch (e) {
      last = outcomeOf(e);
      if (last.kind === "rejected") return last;
    }
  }
  return last;
}

// Mongo reads and writes

function resolve(deps: OpDeps) {
  return {
    s: deps.stripe ?? stripe(),
    sleep: deps.sleep ?? realSleep,
    now: deps.now ?? (() => new Date()),
  };
}

async function load(d: Db, opId: string): Promise<PaymentOp> {
  const op = await col.payments(d).findOne({ opId });
  if (!op) throw new StepError(`Payment ${opId} was not found.`);
  return op;
}

async function assertCurrent(d: Db, op: PaymentOp): Promise<void> {
  const demo = await col.demo(d).findOne({ _id: "demo" });
  if (demo?.runId !== op.runId) throw new Conflict(STALE_RUN);
}

async function save(
  d: Db,
  op: PaymentOp,
  set: Partial<Omit<PaymentOp, "opId" | "runId">>,
  at: Date,
): Promise<PaymentOp> {
  await assertCurrent(d, op);
  // Reset wipes payment_ops, so a write that loses a race with reset matches nothing.
  const next = await col
    .payments(d)
    .findOneAndUpdate(
      { opId: op.opId, runId: op.runId },
      { $set: { ...set, updatedAt: at } },
      { returnDocument: "after" },
    );
  if (!next) throw new Conflict(STALE_RUN);
  return next;
}

function failMessage(op: PaymentOp, o: Verified["observed"]): string {
  if (o.reversed) return "Stripe shows the transfer as reversed.";
  if (op.kind === "transfer" || o.status === "succeeded")
    return "The Stripe object does not match the stored amount or destination.";
  return `Stripe reports status ${o.status ?? "unknown"}.`;
}

async function verifyAndSave(
  d: Db,
  op: PaymentOp,
  s: StripeClient,
  sleep: Sleep,
  now: () => Date,
  tries: number,
): Promise<PaymentOp> {
  let v: Verified | null = null;
  for (let i = 0; i < tries && (!v || v.state === "pending"); i++) {
    if (i > 0) await sleep(1000);
    try {
      v = await verifyOp(s, op, now());
    } catch (e) {
      // A failed read changes nothing in Stripe; Recheck can read again.
      const why = e instanceof Error ? e.message : String(e);
      return save(
        d,
        op,
        { error: `Could not read from Stripe: ${why}` },
        now(),
      );
    }
  }
  if (!v) return op;
  const done = await save(
    d,
    op,
    {
      state: v.state,
      observed: v.observed,
      error: v.state === "failed" ? failMessage(op, v.observed) : null,
    },
    now(),
  );
  if (done.state === "succeeded") await autoCloseForOp(d, done.opId);
  return done;
}

// Outbox entry points

export async function runOp(
  d: Db,
  opId: string,
  deps: OpDeps = {},
): Promise<PaymentOp> {
  const { s, sleep, now } = resolve(deps);
  let op = await load(d, opId);
  if (op.state === "succeeded" || op.state === "failed") return op;
  if (!op.stripeId && op.state === "requested") {
    // Crash or concurrent call: adopt the object if Stripe has it. The same-key resend below is safe either way.
    const found = await findExisting(s, op).catch(() => null);
    if (found)
      op = await save(
        d,
        op,
        { stripeId: found, state: "pending", error: null },
        now(),
      );
  }
  if (!op.stripeId) {
    // Marking requested also re-checks the run right before the Stripe call.
    op = await save(d, op, { state: "requested" }, now());
    op = await save(d, op, nextState(op, await sendOp(s, op, sleep)), now());
    if (!op.stripeId) return op;
  }
  return verifyAndSave(d, op, s, sleep, now, verifyTries());
}

export async function recheckOp(
  d: Db,
  opId: string,
  deps: OpDeps = {},
): Promise<PaymentOp> {
  const { s, now } = resolve(deps);
  let op = await load(d, opId);
  if (!op.stripeId) {
    if (op.state !== "requested") return op;
    const found = await findExisting(s, op);
    if (!found) return op;
    op = await save(
      d,
      op,
      { stripeId: found, state: "pending", error: null },
      now(),
    );
  }
  // Recheck reads once and never sends anything to Stripe.
  return verifyAndSave(d, op, s, realSleep, now, 1);
}

export async function retryOp(
  d: Db,
  opId: string,
  deps: OpDeps = {},
): Promise<PaymentOp> {
  const { s, now } = resolve(deps);
  const asked = await load(d, opId);
  await assertCurrent(d, asked);
  // Work on the newest attempt, so a double click or an old exception link cannot fork attempts.
  let op =
    latestOps(await opsFor(d, asked.runId, asked.caseId))[asked.kind] ?? asked;
  if (op.state !== "failed") return runOp(d, op.opId, deps);
  if (!op.stripeId) {
    const found = await findExisting(s, op);
    if (found) {
      op = await save(
        d,
        op,
        { stripeId: found, state: "pending", error: null },
        now(),
      );
      op = await runOp(d, op.opId, deps);
      if (op.state !== "failed") return op;
    }
  }
  return runOp(d, (await insertIntent(d, nextAttempt(op))).opId, deps);
}

export async function replayOp(
  d: Db,
  opId: string,
  deps: OpDeps = {},
): Promise<{ stripeId: string; same: boolean }> {
  const { s, now } = resolve(deps);
  const op = await load(d, opId);
  if (!op.stripeId)
    throw new StepError("Only a payment that Stripe accepted can be replayed.");
  // Stripe may prune keys after 24 h, and a replay after that would move money again.
  if (now().getTime() - op.createdAt.getTime() > 23 * 3_600_000)
    throw new StepError("Replay only works within 24 hours; reset the demo.");
  await assertCurrent(d, op);
  const stripeId = await create(s, op);
  return { stripeId, same: stripeId === op.stripeId };
}

export async function opsFor(
  d: Db,
  runId: string,
  caseId: string,
): Promise<PaymentOp[]> {
  return col
    .payments(d)
    .find({ runId, caseId })
    .sort({ kind: 1, attempt: 1 })
    .toArray();
}

async function latestCharge(
  d: Db,
  runId: string,
  caseId: string,
  s: StripeClient,
) {
  const op = latestOps(await opsFor(d, runId, caseId)).charge;
  if (!op?.stripeId) return null;
  const pi = await s.paymentIntents.retrieve(op.stripeId, {
    expand: ["latest_charge"],
  });
  return {
    pi,
    charge: typeof pi.latest_charge === "object" ? pi.latest_charge : null,
  };
}

export async function chargeFacts(
  d: Db,
  runId: string,
  caseId: string,
  deps: OpDeps = {},
): Promise<ChargeFacts> {
  const x = await latestCharge(d, runId, caseId, resolve(deps).s);
  if (!x) return { amount: 0, amountRefunded: 0, succeeded: false };
  return {
    amount: x.pi.amount,
    amountRefunded: x.charge?.amount_refunded ?? 0,
    succeeded: x.pi.status === "succeeded",
  };
}

export async function chargeRef(
  d: Db,
  runId: string,
  caseId: string,
  deps: OpDeps = {},
): Promise<{ paymentIntent: string; chargeId: string }> {
  const x = await latestCharge(d, runId, caseId, resolve(deps).s);
  if (!x?.charge || x.pi.status !== "succeeded")
    throw new StepError("The booking payment has not succeeded in Stripe yet.");
  return { paymentIntent: x.pi.id, chargeId: x.charge.id };
}
