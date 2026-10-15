import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActionSchema } from "@/engine/actions";
import { applyChanges, byTarget, stripSim, versionsOf } from "@/engine/records";
import { beforeStates, changedTargets, outOfScope } from "@/engine/scope";
import { defineTool, type Rec } from "@/scenarios/types";

const recs: Rec[] = [
  {
    system: "a",
    recordId: "1",
    target: "T1",
    data: { v: 1, _sim: { secret: true } },
    version: 1,
  },
  { system: "a", recordId: "2", target: "T2", data: { v: 2 }, version: 1 },
  {
    system: "pool",
    recordId: "p",
    target: null,
    data: { free: 0 },
    version: 3,
  },
];

describe("records", () => {
  it("applies changes and bumps only changed versions", () => {
    const next = applyChanges(recs, [
      { system: "a", recordId: "2", data: { v: 9 } },
    ]);
    expect(next[1]).toMatchObject({ data: { v: 9 }, version: 2 });
    expect(next[0].version).toBe(1);
  });
  it("strips simulator-only fields", () =>
    expect(stripSim(recs)[0].data).toEqual({ v: 1 }));
  it("groups by target and records versions", () => {
    expect(byTarget(recs, "T1")).toHaveLength(1);
    expect(versionsOf(recs)).toEqual({ "a:1": 1, "a:2": 1, "pool:p": 3 });
  });
});

describe("scope", () => {
  it("returns sorted unique out-of-scope targets", () =>
    expect(outOfScope(["c", "a", "b", "c"], ["a"])).toEqual(["b", "c"]));
  it("collects changed targets and the earliest before-state", () => {
    const actions = [
      {
        mutations: [
          {
            system: "a",
            recordId: "1",
            target: "T1",
            before: { v: 1 },
            after: { v: 5 },
          },
          {
            system: "pool",
            recordId: "p",
            target: null,
            before: {},
            after: {},
          },
        ],
      },
      {
        mutations: [
          {
            system: "a",
            recordId: "1",
            target: "T1",
            before: { v: 5 },
            after: { v: 6 },
          },
        ],
      },
    ];
    expect(changedTargets(actions)).toEqual(["T1"]);
    expect(beforeStates(actions).get("T1")?.[0].data).toEqual({ v: 1 });
  });
});

describe("defineTool", () => {
  const args = z.object({ n: z.number() });
  const run = () => ({ result: null, changes: [] });
  it("allows by default", () => {
    const t = defineTool({ kind: "read", description: "", args, run });
    expect(t.policy({ n: 1 }, [], new Date())).toBeNull();
  });
  it("defaults targets to none", () => {
    const t = defineTool({ kind: "mutate", description: "", args, run });
    expect(t.targets({ n: 1 }, [])).toEqual([]);
  });
  it("forwards a policy denial", () => {
    const t = defineTool({
      kind: "mutate",
      description: "",
      args,
      policy: ({ n }) =>
        n > 2 ? { reason: "over_subsidy", message: "Too much." } : null,
      run,
    });
    expect(t.policy({ n: 3 }, [], new Date())).toEqual({
      reason: "over_subsidy",
      message: "Too much.",
    });
    expect(t.policy({ n: 1 }, [], new Date())).toBeNull();
  });
});

const ok = (body: unknown) => ActionSchema.safeParse(body).success;

describe("ActionSchema", () => {
  it("configures scenario and source, and drops any mode", () => {
    expect(
      ok({
        action: "configure",
        scenario: "provider-cancel",
        source: "scripted",
      }),
    ).toBe(true);
    expect(
      ok({ action: "configure", scenario: "bulk-cancel", source: "live" }),
    ).toBe(true);
    expect(
      ok({ action: "configure", scenario: "volumes", source: "scripted" }),
    ).toBe(false);
    expect(ok({ action: "configure", scenario: "bulk-cancel" })).toBe(false);
    expect(
      ActionSchema.parse({
        action: "configure",
        scenario: "bulk-cancel",
        source: "scripted",
        mode: "protect",
      }),
    ).toEqual({
      action: "configure",
      scenario: "bulk-cancel",
      source: "scripted",
    });
  });
  it("accepts reset, contain and resume with no arguments", () => {
    for (const action of ["reset", "contain", "resume"])
      expect(ok({ action })).toBe(true);
  });
  it("advances from step -1 upwards with an integer", () => {
    expect(ok({ action: "advance", step: -1 })).toBe(true);
    expect(ok({ action: "advance", step: 4 })).toBe(true);
    expect(ok({ action: "advance", step: -2 })).toBe(false);
    expect(ok({ action: "advance", step: 1.5 })).toBe(false);
    expect(ok({ action: "advance", step: "1" })).toBe(false);
  });
  it("responds with accept or decline only", () => {
    expect(ok({ action: "respond", decision: "accept" })).toBe(true);
    expect(ok({ action: "respond", decision: "decline" })).toBe(true);
    expect(ok({ action: "respond", decision: "maybe" })).toBe(false);
    expect(ok({ action: "respond" })).toBe(false);
  });
  it("requires explicit approval confirmation", () => {
    expect(ok({ action: "approve", confirmed: true })).toBe(true);
    expect(ok({ action: "approve", confirmed: false })).toBe(false);
    expect(ok({ action: "approve" })).toBe(false);
  });
  it("assigns an exception to a named owner", () => {
    expect(
      ok({
        action: "assign",
        exceptionId: "EXC:run-1:CASE-1042:secure",
        owner: "Priya Shah",
      }),
    ).toBe(true);
    expect(ok({ action: "assign", exceptionId: "EXC:1", owner: "" })).toBe(
      false,
    );
    expect(ok({ action: "assign", target: "BK-2026" })).toBe(false);
  });
  it("acts on an exception with refund, retry or close and a short note", () => {
    for (const act of ["refund", "retry", "close"])
      expect(ok({ action: "exception", exceptionId: "EXC:1", do: act })).toBe(
        true,
      );
    expect(
      ok({
        action: "exception",
        exceptionId: "EXC:1",
        do: "close",
        note: "Credited on the October invoice.",
      }),
    ).toBe(true);
    expect(
      ok({
        action: "exception",
        exceptionId: "EXC:1",
        do: "close",
        note: "x".repeat(301),
      }),
    ).toBe(false);
    expect(
      ok({ action: "exception", exceptionId: "EXC:1", do: "delete" }),
    ).toBe(false);
    expect(ok({ action: "exception", exceptionId: "", do: "close" })).toBe(
      false,
    );
  });
  it("rechecks and replays by op ID", () => {
    for (const action of ["recheck", "replay"]) {
      expect(ok({ action, opId: "run-1:CASE-1042:transfer:1" })).toBe(true);
      expect(ok({ action, opId: "" })).toBe(false);
      expect(ok({ action })).toBe(false);
    }
  });
  it("rejects unknown actions", () => {
    expect(ok({ action: "explode" })).toBe(false);
    expect(ok({})).toBe(false);
  });
});
