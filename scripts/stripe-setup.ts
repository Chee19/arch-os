import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/money/stripe";

const EMAIL = "clearhome@example.com";
const PROFILE = {
  name: "ClearHome Removals",
  mcc: "4214",
  // Stripe's test value that passes website validation; example.com is rejected as url_invalid.
  url: "https://accessible.stripe.com",
  product_description: "Fictional man and van provider for the ArchOS demo.",
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client(): Stripe {
  const key = process.env.STRIPE_SETUP_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new Error(
      "Set STRIPE_SETUP_SECRET_KEY in .env.local to a full sk_test_ key.",
    );
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
  });
}

async function onboardingLink(s: Stripe, account: string): Promise<string> {
  const link = await s.accountLinks.create({
    account,
    type: "account_onboarding",
    refresh_url: "https://example.com/reauth",
    return_url: "https://example.com/return",
  });
  return link.url;
}

// Stripe verifies test values asynchronously, so poll for up to 20 s.
async function waitForTransfers(
  s: Stripe,
  id: string,
): Promise<Stripe.Account> {
  let a = await s.accounts.retrieve(id);
  for (let i = 0; i < 10 && a.capabilities?.transfers !== "active"; i++) {
    await wait(2000);
    a = await s.accounts.retrieve(id);
  }
  return a;
}

async function main() {
  const s = client();
  const [mode, existing] = process.argv.slice(2);
  if (mode === "link" && existing) {
    console.log(
      `Onboarding link for ${existing}: ${await onboardingLink(s, existing)}`,
    );
    return;
  }

  const custom = await s.accounts.create({
    type: "custom",
    country: "GB",
    email: EMAIL,
    business_type: "individual",
    business_profile: PROFILE,
    capabilities: { transfers: { requested: true } },
    individual: {
      first_name: "Clara",
      last_name: "Holm",
      email: EMAIL,
      phone: "+447700900123",
      // Stripe test values: this DOB, address line and file pass verification.
      dob: { day: 1, month: 1, year: 1901 },
      address: {
        line1: "address_full_match",
        city: "London",
        postal_code: "EC1A 1BB",
        country: "GB",
      },
      verification: { document: { front: "file_identity_document_success" } },
    },
    // Stripe's GB test sort code and account number; confirm in Stripe docs if rejected.
    external_account: {
      object: "bank_account",
      country: "GB",
      currency: "gbp",
      routing_number: "108800",
      account_number: "00012345",
      account_holder_name: "ClearHome Removals",
      account_holder_type: "individual",
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
    metadata: { demo: "archos", fictional: "true" },
  });

  const a = await waitForTransfers(s, custom.id);
  console.log(
    `capabilities.transfers=${a.capabilities?.transfers ?? "missing"}`,
  );
  if (a.capabilities?.transfers === "active") {
    console.log(`STRIPE_ACCT_CLEARHOME=${a.id}`);
    return;
  }

  console.log(
    "Custom account is not active. currently_due:",
    a.requirements?.currently_due ?? [],
    "disabled_reason:",
    a.requirements?.disabled_reason ?? null,
  );
  const express = await s.accounts.create({
    type: "express",
    country: "GB",
    email: EMAIL,
    business_type: "individual",
    business_profile: PROFILE,
    capabilities: { transfers: { requested: true } },
    metadata: { demo: "archos", fictional: "true" },
  });
  console.log(
    "Fallback: onboard this Express account by hand, then use its ID.",
  );
  console.log(`Onboarding link: ${await onboardingLink(s, express.id)}`);
  console.log(`STRIPE_ACCT_CLEARHOME=${express.id}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
