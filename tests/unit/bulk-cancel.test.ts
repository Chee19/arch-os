import { describe, expect, it } from "vitest";
import type { BookingData } from "@/engine/case";
import { INCIDENT_BUDGET_PENCE } from "@/engine/incident";
import { allocate } from "@/engine/policy";
import { applyChanges, byTarget, find, stripSim } from "@/engine/records";
import { exceptionDueAt, reassignChanges, rescueInputs } from "@/engine/rescue";
import { outOfScope } from "@/engine/scope";
import { bulkCancel as s } from "@/scenarios/bulk-cancel";
import type { Rec, ScriptCall } from "@/scenarios/types";

const NOW = new Date("2026-10-15T09:00:00Z");
const APPROVED = s.task?.approvedTargets ?? [];

const callOf = (step: ScriptCall["step"]) => {
  const c = s.script.find((x) => x.step === step);
  if (!c) throw new Error(`No script call for ${step}`);
  return c;
};
const run = (recs: Rec[], c: ScriptCall) => {
  const tool = s.tools[c.tool];
  const args = tool.args.parse(c.args);
  return { targets: tool.targets(args, recs), out: tool.run(args, recs, NOW) };
};
const bookingIn = (recs: Rec[], id: string) =>
  find(recs, "marketplace", id)?.data as BookingData;

// Adapted from RecoverOS tests/unit/simulate.ts, plus the rescue allocation.
function simulate() {
  const seed = s.seed(NOW);
  const { targets, out } = run(seed, callOf("agentActs"));
  const cancelled = applyChanges(seed, out.changes);
  let recs = cancelled;
  const affected = outOfScope(targets, APPROVED);
  // The bulk cancel is the first mutation, so the seed holds every before-state.
  const before = (t: string) => byTarget(seed, t);
  const plans = affected.map((t) => ({
    target: t,
    ...s.plan(t, before(t), stripSim(byTarget(recs, t)), stripSim(recs), NOW),
  }));
  for (const p of plans) {
    if (!p.action) continue;
    recs = applyChanges(
      recs,
      s.compensate(
        p.action,
        p.target,
        before(p.target),
        byTarget(recs, p.target),
        recs,
      ).changes,
    );
  }
  const manual = plans.filter((p) => p.kind === "manual").map((p) => p.target);
  const { cases, slots } = rescueInputs(recs, manual);
  const allocation = allocate(cases, slots, {
    budgetPence: INCIDENT_BUDGET_PENCE,
    committedPence: 0,
  });
  for (const a of allocation.assigned)
    recs = applyChanges(
      recs,
      reassignChanges(recs, {
        bookingId: a.target,
        slotId: a.slotId,
        providerId: a.providerId,
      }),
    );
  const verified = affected.filter((t) =>
    s.verify(t, before(t), byTarget(recs, t)),
  );
  return {
    seed,
    targets,
    out,
    cancelled,
    affected,
    plans,
    allocation,
    recs,
    verified,
  };
}

describe("bulk-cancel scenario", () => {
  const r = simulate();

  it("seeds 30 Harbour Lettings bookings next week at 300 pounds, each on its own slot, plus 2 free slots", () => {
    const bookings = r.seed
      .filter((x) => x.target !== null)
      .map((x) => x.data as BookingData);
    expect(bookings).toHaveLength(30);
    expect(
      bookings.every(
        (b) =>
          b.pricePence === 30000 &&
          b.client === "Harbour Lettings" &&
          b.status === "confirmed",
      ),
    ).toBe(true);
    expect(bookingIn(r.seed, "BK-2001").startsAt).toBe(
      "2026-10-19T08:00:00.000Z",
    );
    expect(bookingIn(r.seed, "BK-2009")).toMatchObject({
      startsAt: "2026-10-20T11:00:00.000Z",
      providerId: "PROV-freshco",
      slotId: "SLOT-2009",
    });
    expect(bookingIn(r.seed, "BK-2026").startsAt).toBe(
      "2026-10-23T09:00:00.000Z",
    );
    expect(bookingIn(r.seed, "BK-2030").startsAt).toBe(
      "2026-10-23T15:00:00.000Z",
    );
    expect(
      r.seed
        .filter(
          (x) => x.recordId.startsWith("SLOT-") && x.data.status === "free",
        )
        .map((x) => x.recordId),
    ).toEqual(["SLOT-clearhome-r1", "SLOT-freshco-r1"]);
  });

  it("the bulk cancel changes all 30, and 27 are outside OPS-311", () => {
    expect(r.targets).toHaveLength(30);
    expect(r.affected).toHaveLength(27);
    for (const id of APPROVED) expect(r.affected).not.toContain(id);
  });

  it("another client takes the three conflict slots the moment they are released", () => {
    const holder = (id: string) =>
      find(r.cancelled, "marketplace", id)?.data.bookingId;
    expect(["SLOT-2009", "SLOT-2019", "SLOT-2026"].map(holder)).toEqual([
      "BK-9109",
      "BK-9119",
      "BK-9126",
    ]);
    expect(holder("SLOT-2010")).toBe("BK-2010");
  });

  it("plans 24 restores and 3 slot conflicts for the rescue", () => {
    expect(r.plans.filter((p) => p.kind === "restore")).toHaveLength(24);
    const manual = r.plans.filter((p) => p.kind === "manual");
    expect(manual.map((p) => p.target)).toEqual([
      "BK-2009",
      "BK-2019",
      "BK-2026",
    ]);
    expect(
      manual.every((p) => p.why === "conflict" && p.owner === "ArchOS rescue"),
    ).toBe(true);
  });

  it("allocates the two free slots to BK-2009 and BK-2019, leaves BK-2026, and commits 4000 of 6000", () => {
    expect(r.allocation.assigned).toEqual([
      {
        target: "BK-2009",
        slotId: "SLOT-clearhome-r1",
        providerId: "PROV-clearhome",
        incentivePence: 2000,
      },
      {
        target: "BK-2019",
        slotId: "SLOT-freshco-r1",
        providerId: "PROV-freshco",
        incentivePence: 2000,
      },
    ]);
    expect(r.allocation.unassigned).toEqual([
      { target: "BK-2026", reason: "no_slot" },
    ]);
    expect(r.allocation.committedPence).toBe(4000);
    expect(INCIDENT_BUDGET_PENCE).toBe(6000);
  });

  it("verifies 24 restored and 2 replaced; BK-2026 stays unresolved", () => {
    expect(r.verified).toHaveLength(26);
    expect(r.affected.filter((t) => !r.verified.includes(t))).toEqual([
      "BK-2026",
    ]);
    expect(bookingIn(r.recs, "BK-2009")).toMatchObject({
      status: "confirmed",
      providerId: "PROV-clearhome",
      slotId: "SLOT-clearhome-r1",
    });
  });

  it("keeps the 3 authorised cancellations cancelled", () => {
    for (const id of APPROVED)
      expect(bookingIn(r.recs, id).status).toBe("cancelled");
  });

  it("returns no lane from view; Task 18 owns lanes", () => {
    const targets = r.recs
      .filter((x) => x.target !== null)
      .map((x) => x.recordId);
    expect(
      targets.every((t) => s.view(t, byTarget(r.recs, t)).lane === null),
    ).toBe(true);
  });

  it("never returns simulator fields from a tool", () => {
    expect(
      JSON.stringify(run(r.seed, callOf("agentReads")).out.result),
    ).not.toContain("_sim");
    expect(JSON.stringify(r.out.result)).not.toContain("_sim");
  });

  it("dates the BK-2026 exception today 18:00 London time, or an hour out once that has passed", () => {
    expect(exceptionDueAt(new Date("2026-10-15T09:00:00Z")).toISOString()).toBe(
      "2026-10-15T17:00:00.000Z",
    );
    expect(exceptionDueAt(new Date("2026-10-15T17:30:00Z")).toISOString()).toBe(
      "2026-10-15T18:30:00.000Z",
    );
    expect(exceptionDueAt(new Date("2026-12-01T09:00:00Z")).toISOString()).toBe(
      "2026-12-01T18:00:00.000Z",
    );
  });
});
