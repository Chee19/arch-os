import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handle } from "@/engine/actions";
import { Conflict, StepError } from "@/engine/errors";
import { advance } from "@/engine/run";
import { col, getDemo, resetDemo } from "@/engine/store";
import { closeDb, testDb } from "./helpers";

let d: Db;

beforeAll(async () => {
  d = await testDb();
});
afterAll(closeDb);
beforeEach(() =>
  resetDemo(d, {
    scenario: "bulk-cancel",
    mode: "monitor",
    source: "scripted",
  }),
);

const waitFor = (status: "awaiting_customer" | "awaiting_approval") =>
  col.demo(d).updateOne({ _id: "demo" }, { $set: { status } });

describe("advance claim", () => {
  it("runs a step once and answers a stale index with a conflict", async () => {
    await advance(d, -1);
    expect((await getDemo(d)).step).toBe(0);
    await expect(advance(d, -1)).rejects.toBeInstanceOf(Conflict);
  });
  it("lets exactly one of two concurrent advances win", async () => {
    const r = await Promise.allSettled([advance(d, -1), advance(d, -1)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rejected = r.find(
      (x) => x.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(Conflict);
    expect((await getDemo(d)).step).toBe(0);
  });
  it("refuses while the customer is awaited", async () => {
    await waitFor("awaiting_customer");
    await expect(advance(d, -1)).rejects.toThrow(StepError);
    await expect(advance(d, -1)).rejects.toThrow(
      "Waiting for the customer to respond.",
    );
  });
  it("refuses while approval is awaited", async () => {
    await waitFor("awaiting_approval");
    await expect(advance(d, -1)).rejects.toThrow("Waiting for approval.");
  });
  it("answers approve with a conflict when nothing waits", async () => {
    await expect(
      handle(d, { action: "approve", confirmed: true }),
    ).rejects.toBeInstanceOf(Conflict);
  });
  it("puts approval back when approving fails, so the run is not stuck", async () => {
    // No recovery plan exists yet, so approveRecovery throws.
    await waitFor("awaiting_approval");
    await expect(
      handle(d, { action: "approve", confirmed: true }),
    ).rejects.toThrow("There is no recovery plan to approve.");
    expect((await getDemo(d)).status).toBe("awaiting_approval");
  });
  it("stores Scene 2 as scripted even when live is requested", async () => {
    await resetDemo(d, {
      scenario: "bulk-cancel",
      mode: "monitor",
      source: "live",
    });
    expect((await getDemo(d)).source).toBe("scripted");
  });
});
