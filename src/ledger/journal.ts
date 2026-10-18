import type { CaseData } from "@/engine/case";
import type { PaymentOp } from "@/engine/docs";
import { latestOps } from "@/engine/ladder";
import type { Split } from "@/money/math";

export type JournalLine = { account: string; debit: number; credit: number };
export type JournalEntry = {
  key:
    "paid" | "full_refund" | "refund" | "fulfilled" | "provider_paid" | "fee";
  title: string;
  lines: JournalLine[];
  source: string;
};

const FULFILMENT_SOURCE = "fulfilment event";
// fulfilment.simulated is always true in this demo
const COMMISSION = "Gross commission (unsettled)";

const dr = (account: string, debit: number): JournalLine => ({
  account,
  debit,
  credit: 0,
});
const cr = (account: string, credit: number): JournalLine => ({
  account,
  debit: 0,
  credit,
});
const sourceOf = (o: PaymentOp) => o.stripeId ?? o.opId;

export function buildJournal(input: {
  split: Split;
  ops: PaymentOp[];
  fulfilment: CaseData["fulfilment"];
}): JournalEntry[] {
  const { split, fulfilment } = input;
  const L = latestOps(input.ops);
  const good = (o: PaymentOp | undefined) =>
    o?.state === "succeeded" ? o : undefined;
  const charge = good(L.charge);
  const refund = good(L.refund);
  const fullRefund = good(L.full_refund);
  const transfer = good(L.transfer);
  const out: JournalEntry[] = [];

  if (charge) {
    out.push({
      key: "paid",
      title: "Booking paid",
      source: sourceOf(charge),
      lines: [
        dr("Stripe clearing", split.paid),
        cr("Customer deposits", split.paid),
      ],
    });
  }
  if (fullRefund) {
    out.push({
      key: "full_refund",
      title: "Customer refunded in full",
      source: sourceOf(fullRefund),
      lines: [
        dr("Customer deposits", fullRefund.amountPence),
        cr("Stripe clearing", fullRefund.amountPence),
      ],
    });
  }
  if (refund && split.refund > 0) {
    out.push({
      key: "refund",
      title: "Partial refund",
      source: sourceOf(refund),
      lines: [
        dr("Customer deposits", split.refund),
        cr("Stripe clearing", split.refund),
      ],
    });
  }
  if (fulfilment) {
    const debits = [
      dr("Customer deposits", split.customerNet),
      ...(split.subsidy > 0 ? [dr("Subsidy expense", split.subsidy)] : []),
    ];
    out.push({
      key: "fulfilled",
      title: "Service fulfilled",
      source: FULFILMENT_SOURCE,
      lines: [
        ...debits,
        cr("Provider payable", split.transfer),
        cr(COMMISSION, split.commission),
      ],
    });
  }
  if (transfer) {
    out.push({
      key: "provider_paid",
      title: "Provider paid",
      source: sourceOf(transfer),
      lines: [
        dr("Provider payable", split.transfer),
        cr("Stripe clearing", split.transfer),
      ],
    });
  }
  const fee = charge?.observed?.feePence;
  if (charge && typeof fee === "number" && Number.isInteger(fee) && fee > 0) {
    out.push({
      key: "fee",
      title: "Processing fee",
      source: sourceOf(charge),
      lines: [dr("Payment fees", fee), cr("Stripe clearing", fee)],
    });
  }
  return out;
}

export function isBalanced(e: JournalEntry): boolean {
  const sum = (k: "debit" | "credit") => e.lines.reduce((n, l) => n + l[k], 0);
  return sum("debit") === sum("credit");
}
