import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookingOf, caseOf, slotsOf } from "@/engine/case";
import { callTool } from "@/engine/gateway";
import { col, getDemo, loadRecords, resetDemo } from "@/engine/store";
import { scriptedConstraintsFor } from "@/scenarios/provider-cancel";
import { closeDb, testDb } from "./helpers";

const CASE = "CASE-1042";
const BRIGHTNEST = {
  caseId: CASE,
  providerId: "PROV-brightnest",
  slotId: "SLOT-brightnest-fri10",
};
const CLEARHOME = {
  caseId: CASE,
  providerId: "PROV-clearhome",
  slotId: "SLOT-clearhome-fri13",
};

describe("Scene 1 tools through the gateway", () => {
  let d: Db;
  let runId = "";
  const call = (tool: string, args: unknown, op: string) =>
    callTool(d, { runId, tool, args, operationId: op });
  const recs = () => loadRecords(d, "provider-cancel");
  const recordConstraints = async () => {
    const r = await recs();
    const c = caseOf(r, CASE).data;
    const out = await call(
      "recordConstraints",
      {
        caseId: CASE,
        ...scriptedConstraintsFor(c, bookingOf(r, c.bookingId).data),
      },
      "constraints",
    );
    expect(out.ok).toBe(true);
  };

  beforeAll(async () => {
    d = await testDb();
  });
  afterAll(closeDb);
  beforeEach(async () => {
    await resetDemo(d, {
      scenario: "provider-cancel",
      mode: "monitor",
      source: "scripted",
    });
    runId = (await getDemo(d)).runId;
  });

  it("treats a search before constraints as a tool error", async () =>
    expect(await call("searchProviders", { caseId: CASE }, "s0")).toMatchObject(
      { ok: false, reason: "tool_error" },
    ));

  it("blocks BrightNest at £340 as over_subsidy and changes nothing", async () => {
    await recordConstraints();
    const before = await recs();
    expect(
      await call(
        "requestOffer",
        { ...BRIGHTNEST, pricePence: 34000 },
        "bn-340",
      ),
    ).toMatchObject({ ok: false, reason: "over_subsidy" });
    expect(
      await col.actions(d).findOne({ operationId: "bn-340" }),
    ).toMatchObject({ decision: "blocked", reason: "over_subsidy" });
    expect(await recs()).toEqual(before);
  });

  it("holds ClearHome at £280 with the slot version slotFree will see", async () => {
    await recordConstraints();
    expect(
      await call("requestOffer", { ...CLEARHOME, pricePence: 28000 }, "ch-280"),
    ).toMatchObject({
      ok: true,
      result: { status: "held", pricePence: 28000 },
    });
    const r = await recs();
    const slot = slotsOf(r).find((s) => s.recordId === CLEARHOME.slotId);
    expect(slot?.data.status).toBe("held");
    expect(caseOf(r, CASE).data.offers[0].slotVersion).toBe(slot?.version);
  });

  it("returns tool_error for a proposal without a hold", async () => {
    await recordConstraints();
    expect(
      await call(
        "proposeRecovery",
        { caseId: CASE, offerId: "OFR-PROV-clearhome", summary: "x" },
        "p0",
      ),
    ).toMatchObject({ ok: false, reason: "tool_error" });
  });
});
