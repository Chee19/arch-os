import type { Db } from "mongodb";
import { z } from "zod";
import { SCENARIOS } from "@/scenarios";
import {
  isPolicyReason,
  type PolicyDeny,
  type StepKey,
} from "@/scenarios/types";
import type { ActionDoc, CallResult, DemoDoc, MessageDoc } from "./docs";
import { VersionConflict } from "./errors";
import { detectAndContain } from "./incident";
import { audit, col, getDemo, loadRecords, persist, tx } from "./store";

export type CallInput = {
  runId: string;
  tool: string;
  args: unknown;
  operationId: string;
};
type Denial = Extract<CallResult, { ok: false }>;
class StaleRun extends Error {}
class PolicyDenied extends Error {
  constructor(readonly deny: PolicyDeny) {
    super(deny.message);
  }
}
class ToolFailed extends Error {}
const STALE: Denial = {
  ok: false,
  reason: "stale_run",
  message: "The workspace was reset. The call was not executed.",
};

export { isPolicyReason } from "@/scenarios/types";
const isBlocked = (reason: Denial["reason"]) =>
  reason === "suspended" || reason === "out_of_scope" || isPolicyReason(reason);
const isDuplicateKey = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && e.code === 11000;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Tools are pure, so a throw means bad input or state, never a database fault.
function pure<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new ToolFailed(messageOf(e));
  }
}

export async function callTool(d: Db, input: CallInput): Promise<CallResult> {
  const demo = await getDemo(d);
  if (demo.runId !== input.runId) return STALE;
  const prior = await col
    .actions(d)
    .findOne({ operationId: input.operationId });
  if (prior) return prior.response;

  const s = SCENARIOS[demo.scenario];
  const tool = Object.hasOwn(s.tools, input.tool)
    ? s.tools[input.tool]
    : undefined;
  const base = {
    operationId: input.operationId,
    runId: demo.runId,
    agentId: s.agent.id,
    tool: input.tool,
    args: input.args,
    source: demo.source,
  };
  // A duplicate key means a concurrent call with this operationId won the insert, so its response is the answer.
  const replayed = async (e: unknown): Promise<CallResult> => {
    const won = isDuplicateKey(e)
      ? await col.actions(d).findOne({ operationId: input.operationId })
      : null;
    if (!won) throw e;
    return won.response;
  };
  const record = async (
    doc: Omit<ActionDoc, keyof typeof base | "at">,
    decision: string,
    detail: string,
  ): Promise<CallResult> => {
    try {
      await col.actions(d).insertOne({ ...base, ...doc, at: new Date() });
    } catch (e) {
      return replayed(e);
    }
    await audit(d, {
      runId: demo.runId,
      actor: doc.decision === "allowed" ? s.agent.name : "ArchOS gateway",
      action: input.tool,
      detail,
      decision,
      operationId: input.operationId,
    });
    return doc.response;
  };
  const deny = (r: Denial, targets: string[] = []) => {
    const blocked = isBlocked(r.reason);
    return record(
      {
        kind: tool?.kind ?? "mutate",
        targets,
        decision: blocked ? "blocked" : "error",
        reason: r.reason,
        response: r,
        mutations: [],
      },
      blocked ? "Blocked" : "Rejected",
      r.message,
    );
  };
  const toolError = (message: string, targets: string[] = []) =>
    deny({ ok: false, reason: "tool_error", message }, targets);

  if (!tool)
    return deny({
      ok: false,
      reason: "unknown_tool",
      message: `Unknown tool ${input.tool}.`,
    });
  const parsed = tool.args.safeParse(input.args);
  if (!parsed.success)
    return deny({
      ok: false,
      reason: "invalid_args",
      message: z.prettifyError(parsed.error),
    });
  const now = new Date();

  if (tool.kind === "read") {
    const recs = await loadRecords(d, demo.scenario);
    let result: unknown;
    try {
      result = tool.run(parsed.data, recs, now).result;
    } catch (e) {
      return toolError(messageOf(e));
    }
    return record(
      {
        kind: "read",
        targets: [],
        decision: "allowed",
        reason: null,
        response: { ok: true, result, targets: [] },
        mutations: [],
      },
      "Read",
      `${s.agent.name} read ${input.tool}.`,
    );
  }

  const targets = tool.targets(
    parsed.data,
    await loadRecords(d, demo.scenario),
  );
  const agent = await col.agents(d).findOne({ agentId: s.agent.id });
  if (agent?.status === "suspended")
    return deny(
      {
        ok: false,
        reason: "suspended",
        message: `${s.agent.name} is suspended, so ${input.tool} was blocked.`,
      },
      targets,
    );

  let response: CallResult;
  try {
    response = await tx(async (session) => {
      const cur = await col.demo(d).findOne({ _id: "demo" }, { session });
      if (cur?.runId !== input.runId) throw new StaleRun();
      const recs = await loadRecords(d, demo.scenario, session);
      // Checked inside the transaction so holds, slots and money facts cannot change before the write.
      const denied = pure(() => tool.policy(parsed.data, recs, now));
      if (denied) throw new PolicyDenied(denied);
      const { result, changes } = pure(() => tool.run(parsed.data, recs, now));
      const mutations = await persist(d, demo.scenario, recs, changes, session);
      const ok: CallResult = { ok: true, result, targets };
      const changed = new Set(mutations.map((m) => m.target).filter(Boolean))
        .size;
      await col.actions(d).insertOne(
        {
          ...base,
          kind: "mutate",
          targets,
          decision: "allowed",
          reason: null,
          response: ok,
          mutations,
          at: now,
        },
        { session },
      );
      await audit(
        d,
        {
          runId: demo.runId,
          actor: s.agent.name,
          action: input.tool,
          detail: changed
            ? `${changed} ${s.targetLabel}s changed.`
            : `${s.agent.name} ran ${input.tool}.`,
          decision: "Executed",
          operationId: input.operationId,
        },
        session,
      );
      return ok;
    });
  } catch (e) {
    if (e instanceof StaleRun) return STALE;
    if (e instanceof PolicyDenied)
      return deny(
        { ok: false, reason: e.deny.reason, message: e.deny.message },
        targets,
      );
    if (e instanceof ToolFailed) return toolError(e.message, targets);
    if (e instanceof VersionConflict)
      return toolError("Records changed during the call. Try again.", targets);
    return replayed(e);
  }
  // Only a scenario with an approved task can drift out of scope.
  if (demo.source === "live" && s.task !== null) await detectAndContain(d);
  return response;
}

// Scripted turns go through the gateway like live ones and leave the same console trail.
export async function runScript(
  d: Db,
  demo: DemoDoc,
  key: StepKey,
): Promise<CallResult[]> {
  const s = SCENARIOS[demo.scenario];
  // Continue numbering so a re-run step never hits the unique {runId, seq} index.
  let seq = await col.messages(d).countDocuments({ runId: demo.runId });
  const save = (m: Omit<MessageDoc, "runId" | "seq" | "at">) =>
    col
      .messages(d)
      .insertOne({ ...m, runId: demo.runId, seq: ++seq, at: new Date() });
  const out: CallResult[] = [];
  for (const [i, c] of s.script.filter((x) => x.step === key).entries()) {
    const id = `script_${key}_${i}`;
    await save({
      role: "assistant",
      text: c.say,
      reasoning: null,
      toolCalls: [{ id, name: c.tool, args: JSON.stringify(c.args) }],
      toolCallId: null,
      usage: null,
    });
    const r = await callTool(d, {
      runId: demo.runId,
      tool: c.tool,
      args: c.args,
      operationId: `${demo.runId}:agent:${key}:${i}`,
    });
    await save({
      role: "tool",
      text: JSON.stringify(r).slice(0, 2000),
      reasoning: null,
      toolCalls: [],
      toolCallId: id,
      usage: null,
    });
    out.push(r);
    if (!r.ok && r.reason === "stale_run") break;
  }
  return out;
}
