import { describe, expect, it } from "vitest";
import { ConfigError } from "@/engine/errors";
import { assertTestKey, dashboardUrl } from "@/money/stripe";

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
