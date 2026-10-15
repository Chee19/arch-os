import type { Db } from "mongodb";
import { money } from "@/lib/format";
import { SCENARIOS } from "@/scenarios";
import type { Rec } from "@/scenarios/types";
import type { IncidentDoc, IncidentStatus, ItemDoc } from "./docs";
import { StepError } from "./errors";
import { allowedMutations } from "./incident";
import { byTarget, keyOf, stripSim, versionsOf } from "./records";
import { beforeStates } from "./scope";
import { audit, col, getDemo, loadRecords, persist, tx } from "./store";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const only = (recs: Rec[], system: string) =>
  recs.filter((r) => r.system === system);

export async function planRecovery(d: Db): Promise<void> {
  const demo = await getDemo(d);
  const s = SCENARIOS[demo.scenario];
  const incident = await col.incidents(d).findOne({ runId: demo.runId });
  if (!incident)
    throw new StepError("There is no incident to plan a recovery for.");
  if (await col.recovery(d).findOne({ runId: demo.runId })) return;
  const befores = beforeStates(await allowedMutations(d, demo.runId));
  const all = await loadRecords(d, demo.scenario);
  // The planner gets current state and before-snapshots without simulator-only fields.
  const clean = stripSim(all);
  const now = new Date();
  const items: ItemDoc[] = incident.affected.map((target) => {
    const decision = s.plan(
      target,
      stripSim(befores.get(target) ?? []),
      byTarget(clean, target),
      clean,
      now,
    );
    return {
      runId: demo.runId,
      operationId: `${demo.runId}:recover:${target}`,
      target,
      ...decision,
      versions: versionsOf(byTarget(all, target)),
      status: decision.kind === "manual" ? "manual" : "pending",
      detail: null,
      assignedTo: null,
      outcome: null,
      replacement: null,
    };
  });
  await col.items(d).insertMany(items);
  const approvedTargets = s.task?.approvedTargets ?? [];
  const approved = all.filter(
    (r) => r.target !== null && approvedTargets.includes(r.target),
  );
  await col.recovery(d).insertOne({
    runId: demo.runId,
    incidentId: incident.incidentId,
    status: "awaiting_approval",
    approvedBy: null,
    approvedAt: null,
    approvedVersions: versionsOf(approved),
  });
  const count = (k: ItemDoc["kind"]) =>
    items.filter((i) => i.kind === k).length;
  await audit(d, {
    runId: demo.runId,
    actor: "ArchOS planner",
    action: "recovery.plan",
    detail: `${count("restore")} restore · ${count("request")} request · ${count("manual")} need a person.`,
    decision: "Plan ready",
    operationId: null,
  });
}

export async function approveRecovery(d: Db, by: string): Promise<void> {
  const demo = await getDemo(d);
  const res = await col
    .recovery(d)
    .updateOne(
      { runId: demo.runId, approvedBy: null },
      { $set: { status: "approved", approvedBy: by, approvedAt: new Date() } },
    );
  if (!res.matchedCount) {
    if (!(await col.recovery(d).findOne({ runId: demo.runId })))
      throw new StepError("There is no recovery plan to approve.");
    return;
  }
  const actions = await col
    .items(d)
    .countDocuments({ runId: demo.runId, status: "pending" });
  await audit(d, {
    runId: demo.runId,
    actor: by,
    action: "recovery.approve",
    detail: `${actions} recovery actions approved.`,
    decision: "Approved",
    operationId: null,
  });
}

export async function executeRecovery(d: Db, paceMs = 0): Promise<void> {
  const demo = await getDemo(d);
  const s = SCENARIOS[demo.scenario];
  const rec = await col.recovery(d).findOne({ runId: demo.runId });
  if (!rec?.approvedBy) throw new StepError("Recovery needs approval first.");
  const befores = beforeStates(await allowedMutations(d, demo.runId));
  const pending = await col
    .items(d)
    .find({ runId: demo.runId, status: "pending" })
    .sort({ target: 1 })
    .toArray();
  for (const item of pending) {
    // One transaction per item: the record write and the item status commit together or not at all.
    await tx(async (session) => {
      const fresh = await col
        .items(d)
        .findOne(
          { operationId: item.operationId, status: "pending" },
          { session },
        );
      if (!fresh?.action) return;
      const all = await loadRecords(d, demo.scenario, session);
      const mine = byTarget(all, item.target);
      // Everything executeRecovery completes is a restore; rescueRecovery marks replacements.
      const set = (status: ItemDoc["status"], detail: string) =>
        col.items(d).updateOne(
          { operationId: item.operationId },
          {
            $set: {
              status,
              detail,
              outcome: status === "done" ? "restored" : null,
            },
          },
          { session },
        );
      const log = (detail: string, decision: string) =>
        audit(
          d,
          {
            runId: demo.runId,
            actor: "ArchOS executor",
            action: fresh.action ?? "compensate",
            detail: `${item.target}: ${detail}`,
            decision,
            operationId: item.operationId,
          },
          session,
        );
      if (mine.some((r) => fresh.versions[keyOf(r)] !== r.version)) {
        await set("skipped", "Changed after the plan was made. Needs review.");
        await log("changed since the plan, skipped.", "Skipped");
        return;
      }
      const result = s.compensate(
        fresh.action,
        item.target,
        befores.get(item.target) ?? [],
        mine,
        all,
      );
      await persist(d, demo.scenario, all, result.changes, session);
      await set(result.ok ? "done" : "failed", result.detail);
      await log(result.detail, result.ok ? "Compensated" : "Failed");
    });
    if (paceMs) await sleep(paceMs);
  }
  await col
    .recovery(d)
    .updateOne({ runId: demo.runId }, { $set: { status: "executed" } });
}

export async function verifyRecovery(d: Db): Promise<IncidentDoc> {
  const demo = await getDemo(d);
  const s = SCENARIOS[demo.scenario];
  const incident = await col.incidents(d).findOne({ runId: demo.runId });
  const rec = await col.recovery(d).findOne({ runId: demo.runId });
  if (!incident || !rec) throw new StepError("There is no recovery to verify.");
  const befores = beforeStates(await allowedMutations(d, demo.runId));
  const all = await loadRecords(d, demo.scenario);
  const items = await col
    .items(d)
    .find({ runId: demo.runId })
    .sort({ target: 1 })
    .toArray();
  const verified: string[] = [];
  const unresolved: string[] = [];
  for (const it of items) {
    // Only the system of record counts as proof; the ERP can say unpaid while the bank disagrees.
    const ok =
      it.status === "done" &&
      s.verify(
        it.target,
        only(befores.get(it.target) ?? [], s.authoritative),
        only(byTarget(all, it.target), s.authoritative),
      );
    (ok ? verified : unresolved).push(it.target);
  }
  const approvedIntact = Object.entries(rec.approvedVersions).every(
    ([k, v]) => all.find((r) => keyOf(r) === k)?.version === v,
  );
  const exposureRemaining = unresolved.reduce(
    (sum, t) => sum + s.exposure(t, befores.get(t) ?? []),
    0,
  );
  const open = unresolved.length > 0 || !approvedIntact;
  const status: IncidentStatus = open ? "open_with_exceptions" : "resolved";
  await col.incidents(d).updateOne(
    { runId: demo.runId },
    {
      $set: {
        verified,
        unresolved,
        exposureRemaining,
        status,
        approvedIntact,
      },
    },
  );
  await col
    .recovery(d)
    .updateOne({ runId: demo.runId }, { $set: { status: "verified" } });
  await audit(d, {
    runId: demo.runId,
    actor: "ArchOS verifier",
    action: "recovery.verify",
    detail: `${verified.length} verified against ${s.systemsLabel}. ${unresolved.length} unresolved, ${money(exposureRemaining)} still at risk.${approvedIntact ? "" : " Approved records changed during recovery."}`,
    decision: open ? "Open with exceptions" : "Resolved",
    operationId: null,
  });
  return {
    ...incident,
    verified,
    unresolved,
    exposureRemaining,
    status,
    approvedIntact,
  };
}

export async function assign(d: Db, target: string, by: string): Promise<void> {
  const demo = await getDemo(d);
  const res = await col.items(d).updateOne(
    {
      runId: demo.runId,
      target,
      status: { $in: ["manual", "failed", "skipped"] },
    },
    { $set: { assignedTo: by } },
  );
  if (!res.matchedCount)
    throw new StepError(`${target} is not waiting for a person.`);
  await audit(d, {
    runId: demo.runId,
    actor: by,
    action: "exception.assign",
    detail: `${target} assigned to ${by}. Still unresolved.`,
    decision: "Assigned",
    operationId: null,
  });
}
