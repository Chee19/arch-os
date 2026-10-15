import type { BookingData, CaseData } from "@/engine/case";
import type { ExceptionDoc, OpKind, PaymentOp } from "@/engine/docs";
import { splitFor } from "@/money/math";

export type LadderState =
  | "investigating"
  | "offered"
  | "secured"
  | "fulfilled"
  | "settled"
  | "remedied";
export type Ladder = {
  state: LadderState;
  chip: string | null;
  exception: { exceptionId: string; owner: string; nextAction: string } | null;
  simulatedFulfilment: boolean;
};

export function latestOps<T extends { kind: OpKind; attempt: number }>(
  ops: T[],
): Partial<Record<OpKind, T>> {
  const out: Partial<Record<OpKind, T>> = {};
  for (const o of ops) {
    const cur = out[o.kind];
    if (!cur || o.attempt > cur.attempt) out[o.kind] = o;
  }
  return out;
}

const ok = (o: PaymentOp | undefined) => o?.state === "succeeded";

export function ladderOf(x: {
  caseData: CaseData;
  booking: BookingData;
  ops: PaymentOp[];
  exceptions: ExceptionDoc[];
}): Ladder {
  const { caseData, booking } = x;
  const L = latestOps(x.ops);
  const open = x.exceptions.find(
    (e) => e.status === "open" && e.caseId === caseData.caseId,
  );
  const exception = open
    ? {
        exceptionId: open.exceptionId,
        owner: open.owner,
        nextAction: open.nextAction,
      }
    : null;
  const simulatedFulfilment = caseData.fulfilment?.simulated === true;
  const reconciling = Object.values(L).some(
    (o) => o?.state === "requested" && o.stripeId === null,
  );
  const out = (state: LadderState, chip: string | null): Ladder => ({
    state,
    chip: reconciling ? "reconciling" : chip,
    exception,
    simulatedFulfilment,
  });

  if (caseData.status === "declined" || L.full_refund) {
    const fr = L.full_refund;
    if (ok(fr)) return out("remedied", null);
    return out(
      "investigating",
      fr?.state === "failed" ? "refund failed" : "refund pending (remedy)",
    );
  }

  const secured = caseData.offers.find((o) => o.state === "secured");
  const price = secured?.pricePence ?? null;
  const replacement = caseData.replacementProviderId;
  if (
    price === null ||
    replacement === null ||
    booking.providerId !== replacement ||
    booking.status !== "confirmed"
  ) {
    const proposed = caseData.offers.some(
      (o) => o.state === "proposed" || o.state === "secured",
    );
    return out(proposed ? "offered" : "investigating", null);
  }

  const { refund } = splitFor(caseData.paidPence, price);
  const r = L.refund;
  const refundChip =
    refund === 0 || ok(r)
      ? refund === 0
        ? null
        : "refund done"
      : r?.state === "failed"
        ? "refund failed"
        : "refund pending";
  if (!caseData.fulfilment) return out("secured", refundChip);

  const t = L.transfer;
  if (
    ok(L.charge) &&
    ok(t) &&
    t?.observed?.reversed === false &&
    (refund === 0 || ok(r))
  )
    return out("settled", null);

  const payoutChip =
    t && !ok(t)
      ? t.state === "failed"
        ? "payout failed"
        : "payout pending"
      : null;
  const refundOpen = refund > 0 && !ok(r) ? refundChip : null;
  return out("fulfilled", payoutChip ?? refundOpen);
}
