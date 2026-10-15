import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { callTool } from "@/engine/gateway";
import { col, getDemo, resetDemo } from "@/engine/store";
import { SCENARIOS } from "@/scenarios";
import { defineTool } from "@/scenarios/types";
import { closeDb, testDb } from "./helpers";

// SCENARIOS is a fixed registry, so this file adds a probe tool for its own run only.
const tools = SCENARIOS["provider-cancel"].tools;

describe("gateway", () => {
  let d: Db;
  let runId = "";
  const call = (args: unknown, op: string, tool = "__probe") =>
    callTool(d, { runId, tool, args, operationId: op });
  const rows = (op: string) =>
    col.actions(d).countDocuments({ operationId: op });

  beforeAll(async () => {
    d = await testDb();
    tools.__probe = defineTool({
      kind: "mutate",
      description: "Test probe.",
      args: z.object({
        deny: z.boolean().optional(),
        fail: z.boolean().optional(),
      }),
      policy: ({ deny }) =>
        deny ? { reason: "over_subsidy", message: "Probe denied." } : null,
      run: ({ fail }) => {
        if (fail) throw new Error("Probe failed.");
        return { result: { probed: true }, changes: [] };
      },
    });
  });
  afterAll(async () => {
    delete tools.__probe;
    await closeDb();
  });
  beforeEach(async () => {
    await resetDemo(d, {
      scenario: "provider-cancel",
      mode: "monitor",
      source: "scripted",
    });
    runId = (await getDemo(d)).runId;
  });

  it("replays a repeated operationId with the stored response", async () => {
    const first = await call({}, "same");
    expect(first).toEqual({ ok: true, result: { probed: true }, targets: [] });
    expect(await call({}, "same")).toEqual(first);
    expect(await rows("same")).toBe(1);
  });

  it("answers concurrent identical operationIds once without throwing", async () => {
    const [a, b] = await Promise.all([call({}, "race"), call({}, "race")]);
    expect(b).toEqual(a);
    expect(await rows("race")).toBe(1);
    const [c, e] = await Promise.all([
      call({}, "race-deny", "noSuchTool"),
      call({}, "race-deny", "noSuchTool"),
    ]);
    expect(e).toEqual(c);
    expect(await rows("race-deny")).toBe(1);
  });

  it("blocks a policy denial inside the transaction and records it", async () => {
    expect(await call({ deny: true }, "deny")).toEqual({
      ok: false,
      reason: "over_subsidy",
      message: "Probe denied.",
    });
    expect(await col.actions(d).findOne({ operationId: "deny" })).toMatchObject(
      { decision: "blocked", reason: "over_subsidy", mutations: [] },
    );
    expect(await col.audit(d).findOne({ operationId: "deny" })).toMatchObject({
      actor: "ArchOS gateway",
      decision: "Blocked",
    });
  });

  it("turns a throwing tool into tool_error", async () => {
    expect(await call({ fail: true }, "fail")).toEqual({
      ok: false,
      reason: "tool_error",
      message: "Probe failed.",
    });
    expect(await col.actions(d).findOne({ operationId: "fail" })).toMatchObject(
      { decision: "error", reason: "tool_error" },
    );
  });
});
