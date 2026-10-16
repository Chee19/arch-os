import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/db", () => ({
  db: async () => ({ command: () => new Promise(() => {}) }),
}));
vi.mock("@/money/stripe", () => ({
  assertTestKey: () => {},
  stripe: () => ({}),
}));

import { GET } from "@/app/api/health/route";

// vitest loads .env.local, and a real key would make the probe call Nebius.
beforeEach(() => vi.stubEnv("NEBIUS_API_KEY", ""));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("health probes", () => {
  it("a probe that never resolves reads as false within the cap", async () => {
    vi.useFakeTimers();
    const res = GET();
    await vi.advanceTimersByTimeAsync(8000);
    const r = await res;
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ mongo: false, stripe: false });
  });
});
