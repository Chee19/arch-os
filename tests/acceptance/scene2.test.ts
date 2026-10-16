import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handle } from "@/engine/actions";
import { MARKET } from "@/engine/case";
import type { DemoDoc } from "@/engine/docs";
import { find } from "@/engine/records";
import { rescueRecovery } from "@/engine/rescue";
import { advance } from "@/engine/run";
import { loadState } from "@/engine/state";
import { col, getDemo, loadRecords, persist, tx } from "@/engine/store";
import { money } from "@/lib/format";
import { closeDb, runToEnd, testDb } from "./helpers";

const hook = vi.hoisted(() => ({
  afterRead: null as null | (() => Promise<void>),
}));

// Lets a test change records after the rescue reads its plan inputs and before it commits.
vi.mock("@/engine/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/engine/store")>();
  return {
    ...real,
    loadRecords: async (...args: Parameters<typeof real.loadRecords>) => {
      const recs = await real.loadRecords(...args);
      const fn = hook.afterRead;
      hook.afterRead = null;
      if (fn) await fn();
      return recs;
    },
  };
});

async function runScene2(d: Db): Promise<DemoDoc> {
  await handle(d, {
    action: "configure",
    scenario: "bulk-cancel",
    source: "scripted",
  });
  return runToEnd(d);
}

describe("scene 2: 30 cancelled instead of 3", () => {
  let d: Db;
  let demo: DemoDoc;
  beforeAll(async () => {
    d = await testDb();
    demo = await runScene2(d);
  });
  afterAll(closeDb);

  it("detects 27 unauthorised cancellations and blocks the tenant emails", async () => {
    const incident = await col.incidents(d).findOne({ runId: demo.runId });
    expect(incident?.affected).toHaveLength(27);
    expect(incident).toMatchObject({
      incidentId: `INC-${demo.runId}`,
      exposure: 810000,
      budgetPence: 6000,
    });
    expect(
      await col
        .actions(d)
        .findOne({ runId: demo.runId, tool: "notifyCustomers" }),
    ).toMatchObject({
      decision: "blocked",
      reason: "suspended",
    });
  });

  it("restores 24, replaces BK-2009 and BK-2019, and commits 4000 of 6000", async () => {
    const items = await col
      .items(d)
      .find({ runId: demo.runId })
      .sort({ target: 1 })
      .toArray();
    expect(
      items.filter((i) => i.status === "done" && i.outcome === "restored"),
    ).toHaveLength(24);
    const replaced = items.filter(
      (i) => i.status === "done" && i.outcome === "replaced",
    );
    expect(
      replaced.map((i) => [
        i.target,
        i.replacement?.providerId,
        i.replacement?.slotId,
      ]),
    ).toEqual([
      ["BK-2009", "PROV-clearhome", "SLOT-clearhome-r1"],
      ["BK-2019", "PROV-freshco", "SLOT-freshco-r1"],
    ]);
    for (const i of replaced)
      expect(i.replacement).toMatchObject({
        incentivePence: 2000,
        consentBasis: "Client contract clause 4.2 (like-for-like)",
      });
    expect(items.find((i) => i.target === "BK-2026")).toMatchObject({
      status: "manual",
      outcome: null,
      assignedTo: "Priya Shah",
    });
    expect(
      (await col.incidents(d).findOne({ runId: demo.runId }))?.committedPence,
    ).toBe(4000);
  });

  it("hands BK-2026 to Priya Shah as the only open exception", async () => {
    const open = await col
      .exceptions(d)
      .find({ runId: demo.runId, status: "open" })
      .toArray();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      target: "BK-2026",
      caseId: null,
      owner: "Priya Shah",
      action: null,
      opId: null,
    });
    expect(open[0].nextAction).toMatch(
      /^Credit BK-2026 on Harbour Lettings' \w+ invoice and tell the tenant$/,
    );
    expect(open[0].dueAt.getTime()).toBeGreaterThan(
      open[0].createdAt.getTime(),
    );
  });

  it("verifies 26, keeps the 3 authorised cancellations and ends with exceptions", async () => {
    expect(demo.outcome).toBe("recovered_with_exceptions");
    const incident = await col.incidents(d).findOne({ runId: demo.runId });
    expect(incident?.verified).toHaveLength(26);
    expect(incident).toMatchObject({
      unresolved: ["BK-2026"],
      approvedIntact: true,
      status: "open_with_exceptions",
    });
    const recs = await loadRecords(d, "bulk-cancel");
    for (const id of ["BK-2003", "BK-2011", "BK-2017"])
      expect(recs.find((r) => r.recordId === id)?.data.status).toBe(
        "cancelled",
      );
  });

  it("serves the split in the state payload", async () => {
    const st = await loadState(d);
    expect(st.metrics).toMatchObject({
      outOfScope: 27,
      restore: 24,
      manual: 3,
      replaced: 2,
      recovered: 26,
      unresolved: 1,
      blocked: 1,
    });
    expect(st.incident?.values).toEqual({
      atRiskPence: 810000,
      restoredPence: 720000,
      replacedPence: 60000,
      unresolvedPence: 30000,
    });
    const result = (key: string) => st.steps.find((x) => x.key === key)?.result;
    expect(result("detect")).toBe("27 bookings changed outside OPS-311");
    expect(result("contain")).toBe("notifyCustomers blocked: suspended");
    expect(result("restore")).toBe("24 bookings restored");
    expect(result("rescue")).toBe(
      `2 replaced, 1 exception, ${money(4000)} of ${money(6000)} committed`,
    );
    expect(
      st.exceptions.filter((e) => e.status === "open").map((e) => e.target),
    ).toEqual(["BK-2026"]);
    expect(JSON.stringify(st)).not.toContain("_sim");
  });

  it("assigning the BK-2026 exception to Sam Okafor updates the item", async () => {
    const exc = await col
      .exceptions(d)
      .findOne({ runId: demo.runId, target: "BK-2026" });
    await handle(d, {
      action: "assign",
      exceptionId: exc!.exceptionId,
      owner: "Sam Okafor",
    });
    expect(
      await col.items(d).findOne({ runId: demo.runId, target: "BK-2026" }),
    ).toMatchObject({ assignedTo: "Sam Okafor" });
  });

  it("re-running the rescue changes nothing", async () => {
    const snapshot = async () =>
      JSON.stringify({
        versions: (await loadRecords(d, "bulk-cancel")).map(
          (r) => `${r.recordId}:${r.version}`,
        ),
        items: await col
          .items(d)
          .find({ runId: demo.runId }, { projection: { _id: 0 } })
          .sort({ target: 1 })
          .toArray(),
        committed: (await col.incidents(d).findOne({ runId: demo.runId }))
          ?.committedPence,
        exceptions: await col
          .exceptions(d)
          .countDocuments({ runId: demo.runId }),
        audit: await col.audit(d).countDocuments({ runId: demo.runId }),
      });
    const before = await snapshot();
    await rescueRecovery(d);
    expect(await snapshot()).toBe(before);
  });

  it("hands a booking whose planned slot is taken mid-rescue to Priya Shah", async () => {
    await handle(d, {
      action: "configure",
      scenario: "bulk-cancel",
      source: "scripted",
    });
    let cur = await getDemo(d);
    while (cur.steps[cur.step] !== "restore") {
      if (cur.status === "awaiting_approval")
        await handle(d, { action: "approve", confirmed: true });
      else await advance(d, cur.step);
      cur = await getDemo(d);
    }
    // Another client books BK-2009's planned slot after the rescue planned it.
    hook.afterRead = () =>
      tx(async (session) => {
        const recs = await loadRecords(d, "bulk-cancel", session);
        const slot = find(recs, MARKET, "SLOT-clearhome-r1");
        if (!slot) throw new Error("SLOT-clearhome-r1 is missing.");
        await persist(
          d,
          "bulk-cancel",
          recs,
          [
            {
              system: MARKET,
              recordId: slot.recordId,
              data: { ...slot.data, status: "booked", bookingId: "BK-9001" },
            },
          ],
          session,
        );
      });
    await advance(d, cur.step);
    expect(hook.afterRead).toBeNull();

    const { runId } = cur;
    const item = (target: string) => col.items(d).findOne({ runId, target });
    expect(await item("BK-2009")).toMatchObject({
      status: "manual",
      outcome: null,
      assignedTo: "Priya Shah",
    });
    expect(await item("BK-2019")).toMatchObject({ outcome: "replaced" });
    expect(
      await col.exceptions(d).findOne({ runId, target: "BK-2009" }),
    ).toMatchObject({ owner: "Priya Shah", status: "open" });
    expect((await col.incidents(d).findOne({ runId }))?.committedPence).toBe(
      2000,
    );
    expect(
      (await col.audit(d).findOne({ runId, action: "rescue.allocate" }))
        ?.detail,
    ).toMatch(/^1 replaced, 2 handed to a person\./);
  });
});
