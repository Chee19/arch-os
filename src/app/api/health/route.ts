import { connection } from "next/server";
import { DEFAULT_MODEL, NEBIUS_BASE } from "@/agent/config";
import { db } from "@/db";
import { assertTestKey, stripe } from "@/money/stripe";

// Caps a probe so a stalled dependency reads as false instead of hanging the route.
const within = <T>(p: Promise<T>, ms = 8000) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);

export async function GET() {
  // Without it a build with no MONGODB_URI would freeze one health result into a static response.
  await connection();
  const key = process.env.NEBIUS_API_KEY;
  const model = process.env.NEBIUS_MODEL ?? DEFAULT_MODEL;
  const checks = {
    mongo: false,
    stripe: false,
    stripeTestKey: false,
    clearhomeTransfers: false,
    nebius: false,
    model,
    modelAvailable: false,
    presenterKey: Boolean(process.env.DEMO_KEY),
  };
  try {
    await within((async () => (await db()).command({ ping: 1 }))());
    checks.mongo = true;
  } catch {
    // Reported as mongo: false.
  }
  try {
    // A live key fails here and never reaches Stripe.
    assertTestKey(process.env.STRIPE_SECRET_KEY);
    checks.stripeTestKey = true;
    const s = stripe();
    await within(s.balance.retrieve());
    checks.stripe = true;
    const acct = process.env.STRIPE_ACCT_CLEARHOME;
    if (acct)
      checks.clearhomeTransfers =
        (await within(s.accounts.retrieve(acct))).capabilities?.transfers ===
        "active";
  } catch {
    // Every check after the failing one stays false.
  }
  if (key) {
    try {
      const res = await fetch(`${NEBIUS_BASE}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        checks.nebius = true;
        const body = (await res.json()) as { data?: { id: string }[] };
        checks.modelAvailable = Boolean(body.data?.some((m) => m.id === model));
      }
    } catch {
      // Reported as nebius: false.
    }
  }
  return Response.json(checks, {
    status: checks.mongo && checks.stripe ? 200 : 503,
  });
}
