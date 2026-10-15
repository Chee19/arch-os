import Stripe from "stripe";
import {
  STRIPE_API_VERSION,
  TEST_PAYMENT_METHOD,
  stripe,
} from "@/money/stripe";

const gbp = (xs: { currency: string; amount: number }[]) =>
  xs.find((x) => x.currency === "gbp")?.amount ?? 0;

async function main() {
  const acct = process.env.STRIPE_ACCT_CLEARHOME;
  if (!acct)
    throw new Error(
      "Set STRIPE_ACCT_CLEARHOME in .env.local (printed by npm run stripe:setup).",
    );
  const s = stripe();
  const run = `spike-${Date.now().toString(36)}`;
  // Same format as transferGroupOf in src/money/reconcile.ts (Task 9).
  const group = `booking_BK-SPIKE_${run}`;
  const meta = (kind: string) => ({
    opId: `${run}:CASE-SPIKE:${kind}:1`,
    bookingId: "BK-SPIKE",
    runId: run,
  });

  const sdkDefault =
    (Stripe as unknown as { API_VERSION?: string }).API_VERSION ?? "unknown";
  console.log("1 api version", {
    sdkDefault,
    pinned: STRIPE_API_VERSION,
    match: sdkDefault === STRIPE_API_VERSION,
  });

  const account = await s.accounts.retrieve(acct);
  console.log(
    "2 clearhome transfers",
    account.capabilities?.transfers ?? "missing",
  );

  const charge = (pm: string, kind: string) =>
    s.paymentIntents.create(
      {
        amount: 30000,
        currency: "gbp",
        payment_method: pm,
        allowed_payment_method_types: ["card"],
        confirm: true,
        transfer_group: group,
        metadata: meta(kind),
      },
      { idempotencyKey: meta(kind).opId },
    );
  let pi: Stripe.PaymentIntent;
  let bypass = true;
  try {
    pi = await charge(TEST_PAYMENT_METHOD, "charge");
  } catch (e) {
    bypass = false;
    console.log("  bypass rejected:", e instanceof Error ? e.message : e);
    pi = await charge("pm_card_visa", "charge-visa");
  }
  console.log("3 payment intent", { id: pi.id, status: pi.status, bypass });

  const full = await s.paymentIntents.retrieve(pi.id, {
    expand: ["latest_charge.balance_transaction"],
  });
  const ch = typeof full.latest_charge === "object" ? full.latest_charge : null;
  if (!ch) throw new Error("The PaymentIntent has no charge.");
  const bt =
    typeof ch.balance_transaction === "object" ? ch.balance_transaction : null;
  console.log("4 charge and fee", {
    charge: ch.id,
    feePence: bt?.fee ?? null,
    btStatus: bt?.status ?? null,
  });

  const platform = await s.balance.retrieve();
  console.log("5 platform balance gbp", {
    available: gbp(platform.available),
    pending: gbp(platform.pending),
  });

  const refund = await s.refunds.create(
    { payment_intent: pi.id, amount: 2000, metadata: meta("refund") },
    { idempotencyKey: meta("refund").opId },
  );
  console.log("6 refund", { id: refund.id, status: refund.status });

  // No transfer_group here: the point is to see whether source_transaction inherits it.
  const transferParams: Stripe.TransferCreateParams = {
    amount: 22400,
    currency: "gbp",
    destination: acct,
    source_transaction: ch.id,
    metadata: meta("transfer"),
  };
  const tr = await s.transfers.create(transferParams, {
    idempotencyKey: meta("transfer").opId,
  });
  console.log("7 transfer", {
    id: tr.id,
    reversed: tr.reversed,
    transferGroup: tr.transfer_group,
    inherited: tr.transfer_group === group,
  });

  const connected = await s.balance.retrieve({}, { stripeAccount: acct });
  console.log("8 clearhome balance gbp", {
    available: gbp(connected.available),
    pending: gbp(connected.pending),
  });

  const replay = await s.transfers.create(transferParams, {
    idempotencyKey: meta("transfer").opId,
  });
  console.log("9 replay same key", {
    id: replay.id,
    same: replay.id === tr.id,
  });

  const listed = await s.transfers.list({ transfer_group: group, limit: 100 });
  const found = await s.paymentIntents.search({
    query: `metadata['opId']:'${pi.metadata.opId}'`,
  });
  console.log("10 reconciliation reads", {
    transfersInGroup: listed.data.length,
    searchHits: found.data.length,
  });

  console.log("SUMMARY", {
    apiVersion: sdkDefault,
    bypass,
    feePence: bt?.fee ?? null,
    inherited: tr.transfer_group === group,
    replaySame: replay.id === tr.id,
  });
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
