import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/demo/route";
import { ActionSchema } from "@/engine/actions";
import { Conflict, StepError, Unauthorized } from "@/engine/errors";
import { checkKey, errorResponse } from "@/engine/http";

const req = (body: unknown, key?: string) =>
  new Request("http://test/api/demo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-demo-key": key } : {}),
    },
    body: JSON.stringify(body),
  });

describe("presenter key", () => {
  afterEach(() => {
    delete process.env.DEMO_KEY;
  });

  it("is optional when DEMO_KEY is unset", () =>
    expect(() => checkKey(req({}))).not.toThrow());
  it("rejects a missing or wrong key", () => {
    expect(() => checkKey(req({}), "secret")).toThrow(Unauthorized);
    expect(() => checkKey(req({}, "nope"), "secret")).toThrow(Unauthorized);
  });
  it("accepts the right key", () =>
    expect(() => checkKey(req({}, "secret"), "secret")).not.toThrow());

  it("POST without the key returns 401 before touching state", async () => {
    process.env.DEMO_KEY = "secret";
    expect((await POST(req({ action: "reset" }))).status).toBe(401);
  });
  it("POST with an invalid body returns 400", async () => {
    process.env.DEMO_KEY = "secret";
    expect((await POST(req({ action: "explode" }, "secret"))).status).toBe(400);
  });
});

describe("actions and errors", () => {
  it("requires explicit approval confirmation", () => {
    expect(ActionSchema.safeParse({ action: "approve" }).success).toBe(false);
    expect(
      ActionSchema.safeParse({ action: "approve", confirmed: true }).success,
    ).toBe(true);
  });
  it("maps engine errors to status codes", () => {
    expect(errorResponse(new Conflict("x")).status).toBe(409);
    expect(errorResponse(new StepError("x")).status).toBe(400);
    const down = Object.assign(new Error("timeout"), {
      name: "MongoServerSelectionError",
    });
    expect(errorResponse(down).status).toBe(503);
  });
  it("maps Stripe errors to 502 with the message", async () => {
    const res = errorResponse(
      new Stripe.errors.StripeError({
        type: "api_error",
        message: "card declined upstream",
      }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "card declined upstream" });
  });
});
