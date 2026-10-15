import Stripe from "stripe";
import { ConfigError } from "@/engine/errors";

export type StripeClient = Pick<
  Stripe,
  "paymentIntents" | "refunds" | "transfers" | "balance" | "accounts"
>;

// Must equal the SDK default printed by the spike; typecheck fails if the SDK targets another version.
export const STRIPE_API_VERSION = "2026-09-30.endive";

// Puts funds straight into available balance; the spike says whether to fall back to "pm_card_visa".
export const TEST_PAYMENT_METHOD = "pm_card_bypassPending";

export function assertTestKey(key: string | undefined): string {
  if (!key || !/^(sk|rk)_test_/.test(key))
    throw new ConfigError(
      "STRIPE_SECRET_KEY must be a Stripe test key (sk_test_ or rk_test_).",
    );
  return key;
}

let client: Stripe | undefined;

export function stripe(): StripeClient {
  client ??= new Stripe(assertTestKey(process.env.STRIPE_SECRET_KEY), {
    apiVersion: STRIPE_API_VERSION,
    // Network retries are safe because every money call carries an idempotency key.
    maxNetworkRetries: 2,
  });
  return client;
}

const DASHBOARD = "https://dashboard.stripe.com/test";

export function dashboardUrl(stripeId: string): string {
  if (stripeId.startsWith("pi_")) return `${DASHBOARD}/payments/${stripeId}`;
  if (stripeId.startsWith("re_")) return `${DASHBOARD}/refunds/${stripeId}`;
  if (stripeId.startsWith("tr_"))
    return `${DASHBOARD}/connect/transfers/${stripeId}`;
  return `${DASHBOARD}/search?query=${encodeURIComponent(stripeId)}`;
}
