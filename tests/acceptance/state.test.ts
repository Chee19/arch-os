import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadState } from "@/engine/state";
import { col } from "@/engine/store";
import { closeDb, testDb } from "./helpers";

describe("state payload", () => {
  let d: Db;
  beforeAll(async () => {
    d = await testDb();
  });
  afterAll(closeDb);

  it("lazily resets to Scene 1 and strips simulator fields", async () => {
    await col.demo(d).deleteMany({});
    const st = await loadState(d);
    expect(st.demo).toMatchObject({
      scenario: "provider-cancel",
      step: -1,
      status: "ready",
      focusTab: null,
    });
    expect(st.steps.every((x) => x.result === "")).toBe(true);
    expect(st.case).toMatchObject({
      caseId: "CASE-1042",
      bookingId: "BK-1042",
      status: "booked",
      candidates: [],
    });
    expect(st.case?.tiles).toEqual({
      atRiskPence: 0,
      provisionalPence: null,
      settledPence: null,
    });
    expect(st.records.map((r) => r.target)).toEqual(["BK-1042"]);
    expect(st).toMatchObject({
      payments: [],
      journal: [],
      incident: null,
      recovery: null,
      exceptions: [],
      operator: "Sam Okafor",
      workspace: "Larkspur Home Services",
    });
    expect(JSON.stringify(st)).not.toContain("_sim");
  });
});
