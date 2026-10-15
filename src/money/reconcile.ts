import type { PaymentOp } from "@/engine/docs";
import type { StripeClient } from "./stripe";

export const transferGroupOf = (bookingId: string, runId: string): string =>
  `booking_${bookingId}_${runId}`;

type Tagged = { id: string; metadata: Record<string, string> | null };
const mine = (op: PaymentOp, xs: Tagged[]): string | null =>
  xs.find((x) => x.metadata?.opId === op.opId)?.id ?? null;

// Only metadata.opId counts, so an earlier run's identical amount or destination is never adopted.
export async function findExisting(
  s: StripeClient,
  op: PaymentOp,
): Promise<string | null> {
  const req = op.request as {
    payment_intent?: string;
    destination?: string;
    metadata?: Record<string, string>;
  };
  if (op.kind === "charge") {
    // Search lags, so callers act on null only before a same-key resend or after a definitive rejection.
    const res = await s.paymentIntents.search({
      query: `metadata['opId']:'${op.opId}'`,
    });
    return mine(op, res.data);
  }
  if (op.kind === "transfer") {
    const group = transferGroupOf(
      req.metadata?.bookingId ?? "",
      req.metadata?.runId ?? "",
    );
    const byGroup = mine(
      op,
      (await s.transfers.list({ transfer_group: group, limit: 100 })).data,
    );
    // Destination covers a transfer that did not inherit the charge's group.
    return (
      byGroup ??
      mine(
        op,
        (
          await s.transfers.list({
            destination: req.destination ?? "",
            limit: 100,
          })
        ).data,
      )
    );
  }
  const res = await s.refunds.list({
    payment_intent: req.payment_intent ?? "",
    limit: 100,
  });
  return mine(op, res.data);
}
