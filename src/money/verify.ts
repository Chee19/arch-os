import type { OpState, PaymentOp } from "@/engine/docs";
import type { StripeClient } from "./stripe";

export type Verified = {
  state: OpState;
  observed: NonNullable<PaymentOp["observed"]>;
};
export type CallOutcome =
  | { kind: "created"; stripeId: string }
  | { kind: "rejected"; message: string }
  | { kind: "ambiguous"; message: string };

type ErrLike = {
  type?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
};
// 401 and 403 are included because Stripe refused the request before doing anything.
const DEFINITIVE_STATUS = [400, 401, 402, 403, 404];

export function classify(e: unknown): "definitive" | "ambiguous" {
  const x = (e ?? {}) as ErrLike;
  // 409 means the same key is still in flight; retrying it returns the first result.
  if (x.statusCode === 409 || x.code === "idempotency_key_in_use")
    return "ambiguous";
  if (
    x.type === "StripeCardError" ||
    x.type === "StripeInvalidRequestError" ||
    x.type === "StripeIdempotencyError"
  )
    return "definitive";
  return DEFINITIVE_STATUS.includes(x.statusCode as number)
    ? "definitive"
    : "ambiguous";
}

export function outcomeOf(e: unknown): CallOutcome {
  const x = (e ?? {}) as ErrLike;
  const message =
    typeof x.message === "string" && x.message ? x.message : String(e);
  if (classify(e) === "ambiguous") return { kind: "ambiguous", message };
  // Same key with different params is a bug in request building, not a payment decision.
  return {
    kind: "rejected",
    message:
      x.type === "StripeIdempotencyError" ? "idempotency mismatch" : message,
  };
}

export function nextState(
  op: PaymentOp,
  o: CallOutcome,
): Pick<PaymentOp, "state" | "stripeId" | "error"> {
  if (op.state === "succeeded" || op.state === "failed")
    return { state: op.state, stripeId: op.stripeId, error: op.error };
  if (o.kind === "created")
    return { state: "pending", stripeId: o.stripeId, error: null };
  if (o.kind === "rejected")
    return { state: "failed", stripeId: op.stripeId, error: o.message };
  return {
    state: "requested",
    stripeId: op.stripeId,
    error: `Reconciling: ${o.message}`,
  };
}

type Ref = string | { id: string } | null | undefined;
const idOf = (x: Ref): string | null =>
  x == null ? null : typeof x === "string" ? x : x.id;

function piState(status: string): OpState {
  if (status === "succeeded") return "succeeded";
  return status === "canceled" || status === "requires_payment_method"
    ? "failed"
    : "pending";
}

function refundState(status: string | null): OpState {
  if (status === "succeeded") return "succeeded";
  return status === "failed" || status === "canceled" ? "failed" : "pending";
}

export async function verifyOp(
  s: StripeClient,
  op: PaymentOp,
  now: Date,
): Promise<Verified> {
  if (!op.stripeId)
    throw new Error(`${op.opId} has no Stripe object to verify.`);
  if (op.kind === "charge") {
    const pi = await s.paymentIntents.retrieve(op.stripeId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const bt =
      ch && typeof ch.balance_transaction === "object"
        ? ch.balance_transaction
        : null;
    return {
      state: pi.amount === op.amountPence ? piState(pi.status) : "failed",
      observed: {
        status: pi.status,
        amountRefunded: ch?.amount_refunded ?? null,
        balanceTransaction: idOf(ch?.balance_transaction),
        feePence: bt?.fee ?? null,
        reversed: null,
        checkedAt: now,
      },
    };
  }
  if (op.kind === "transfer") {
    const t = await s.transfers.retrieve(op.stripeId, {
      expand: ["balance_transaction"],
    });
    const ok =
      !t.reversed &&
      t.amount === op.amountPence &&
      idOf(t.destination) === op.request.destination;
    return {
      state: ok ? "succeeded" : "failed",
      observed: {
        status: null,
        amountRefunded: null,
        balanceTransaction: idOf(t.balance_transaction),
        feePence: null,
        reversed: t.reversed,
        checkedAt: now,
      },
    };
  }
  const r = await s.refunds.retrieve(op.stripeId);
  return {
    state: r.amount === op.amountPence ? refundState(r.status) : "failed",
    observed: {
      status: r.status,
      amountRefunded: null,
      balanceTransaction: idOf(r.balance_transaction),
      feePence: null,
      reversed: null,
      checkedAt: now,
    },
  };
}
