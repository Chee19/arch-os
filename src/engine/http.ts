import { timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { ConfigError, Conflict, StepError, Unauthorized } from "./errors";

export function checkKey(req: Request, expected = process.env.DEMO_KEY): void {
  if (!expected) return;
  const got = Buffer.from(req.headers.get("x-demo-key") ?? "");
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want))
    throw new Unauthorized("Access key required.");
}

export function errorResponse(e: unknown): Response {
  if (e instanceof Unauthorized)
    return Response.json({ error: e.message }, { status: 401 });
  if (e instanceof Conflict)
    return Response.json({ error: e.message }, { status: 409 });
  if (e instanceof StepError)
    return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof ConfigError)
    return Response.json({ error: e.message }, { status: 500 });
  if (
    e instanceof Error &&
    /MongoServerSelectionError|MongoNetwork/.test(e.name)
  )
    return Response.json(
      { error: "Database unreachable. Check Atlas and retry." },
      { status: 503 },
    );
  if (e instanceof Stripe.errors.StripeError)
    return Response.json({ error: e.message }, { status: 502 });
  console.error(e);
  return Response.json({ error: "Unexpected server error." }, { status: 500 });
}
