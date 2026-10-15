import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/db", () => ({
  db: async () => ({ command: () => new Promise(() => {}) }),
}));
vi.mock("@/money/stripe", () => ({
  assertTestKey: () => {},
  stripe: () => ({}),
}));

import { GET } from "@/app/api/health/route";

afterEach(() => vi.useRealTimers());

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
