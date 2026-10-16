import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { ConfigError } from "@/engine/errors";
import { assertTestKey, dashboardUrl, stripe } from "@/money/stripe";

describe("stripe client", () => {
  it("caps each request at 15 s and keeps two network retries", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    const s = stripe() as Stripe;
    vi.unstubAllEnvs();
    expect(s.getApiField("timeout")).toBe(15_000);
    expect(s.getApiField("maxNetworkRetries")).toBe(2);
  });
});

describe("assertTestKey", () => {
  it("accepts secret and restricted test keys", () => {
    expect(assertTestKey("sk_test_x")).toBe("sk_test_x");
    expect(assertTestKey("rk_test_x")).toBe("rk_test_x");
  });

  it("rejects live, publishable, missing and empty keys", () => {
    for (const key of ["sk_live_x", "rk_live_x", "pk_test_x", undefined, ""])
      expect(() => assertTestKey(key)).toThrow(ConfigError);
  });

  it("never echoes the rejected key", () => {
    let message = "";
    try {
      assertTestKey("sk_live_secret");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/test key/);
    expect(message).not.toContain("sk_live_secret");
  });
});

describe("dashboardUrl", () => {
  it("links each object type to its test-mode dashboard page", () => {
    expect(dashboardUrl("pi_123")).toBe(
      "https://dashboard.stripe.com/test/payments/pi_123",
    );
    expect(dashboardUrl("re_123")).toBe(
      "https://dashboard.stripe.com/test/refunds/re_123",
    );
    expect(dashboardUrl("tr_123")).toBe(
      "https://dashboard.stripe.com/test/connect/transfers/tr_123",
    );
  });

  it("falls back to dashboard search for any other prefix", () => {
    expect(dashboardUrl("po_123")).toBe(
      "https://dashboard.stripe.com/test/search?query=po_123",
    );
  });
});
