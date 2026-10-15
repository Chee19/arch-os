import type { Db } from "mongodb";
import { money } from "@/lib/format";
import { SCENARIOS } from "@/scenarios";
import type { IncidentDoc } from "./docs";
import { StepError } from "./errors";
import { beforeStates, changedTargets, outOfScope } from "./scope";
import { audit, col, getDemo } from "./store";

// Scene 2 budget for last-minute incentives (spec 4).
export const INCIDENT_BUDGET_PENCE = 6000;

export function allowedMutations(d: Db, runId: string) {
  return col
    .actions(d)
    .find({ runId, decision: "allowed", kind: "mutate" })
    .sort({ at: 1, _id: 1 })
    .toArray();
}

export async function detect(d: Db): Promise<IncidentDoc | null> {
  const demo = await getDemo(d);
  const existing = await col.incidents(d).findOne({ runId: demo.runId });
  if (existing) return existing;
  const s = SCENARIOS[demo.scenario];
  const task = s.task;
  if (!task)
    throw new StepError(`${s.name} has no task to check scope against.`);
  const actions = await allowedMutations(d, demo.runId);
  const affected = outOfScope(changedTargets(actions), task.approvedTargets);
  if (!affected.length) {
    await audit(d, {
      runId: demo.runId,
      actor: "ArchOS detector",
      action: "scope.check",
      detail: `All changes are inside task ${task.id}.`,
      decision: "No incident",
      operationId: null,
    });
    return null;
  }
  const befores = beforeStates(actions);
  const exposure = affected.reduce(
    (sum, t) => sum + s.exposure(t, befores.get(t) ?? []),
    0,
  );
  const incident: IncidentDoc = {
    incidentId: `INC-${demo.runId}`,
    runId: demo.runId,
    scenario: demo.scenario,
    affected,
    exposure,
    unit: s.unit,
    severity: "critical",
    status: "open",
    openedAt: new Date(),
    exposureRemaining: null,
    verified: [],
    unresolved: [],
    approvedIntact: null,
    budgetPence: INCIDENT_BUDGET_PENCE,
    committedPence: 0,
  };
  await col.incidents(d).insertOne(incident);
  await audit(d, {
    runId: demo.runId,
    actor: "ArchOS detector",
    action: "incident.open",
    detail: `${affected.length} ${s.targetLabel}s changed outside task ${task.id}. ${money(exposure)} at risk.`,
    decision: "Critical incident",
    operationId: null,
  });
  return incident;
}

export async function contain(d: Db, actor = "ArchOS policy"): Promise<void> {
  const demo = await getDemo(d);
  const s = SCENARIOS[demo.scenario];
  const res = await col
    .agents(d)
    .updateOne(
      { agentId: s.agent.id, status: "active" },
      { $set: { status: "suspended" } },
    );
  if (!res.modifiedCount) return;
  await col
    .incidents(d)
    .updateOne(
      { runId: demo.runId, status: "open" },
      { $set: { status: "contained" } },
    );
  await audit(d, {
    runId: demo.runId,
    actor,
    action: "agent.suspend",
    detail: `${s.agent.name}'s write tools are suspended. Read access stays on.`,
    decision: "Contained",
    operationId: null,
  });
}

export async function resume(d: Db, actor: string): Promise<void> {
  const demo = await getDemo(d);
  const s = SCENARIOS[demo.scenario];
  const res = await col
    .agents(d)
    .updateOne(
      { agentId: s.agent.id, status: "suspended" },
      { $set: { status: "active" } },
    );
  if (!res.modifiedCount) return;
  await audit(d, {
    runId: demo.runId,
    actor,
    action: "agent.resume",
    detail: `${s.agent.name}'s write tools are active again.`,
    decision: "Access resumed",
    operationId: null,
  });
}

export async function detectAndContain(d: Db): Promise<void> {
  if (await detect(d)) await contain(d);
}
