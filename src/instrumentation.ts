export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertTestKey } = await import("@/money/stripe");
  // Fail at boot, not at the first payment, if the key is live or missing.
  assertTestKey(process.env.STRIPE_SECRET_KEY);
}
