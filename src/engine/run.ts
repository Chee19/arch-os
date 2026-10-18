import type { Db } from "mongodb";
import { liveExtractor } from "@/agent/extract";
import { SCENARIOS } from "@/scenarios";
import type { StepKey } from "@/scenarios/types";
import type { DemoDoc, DemoStatus } from "./docs";
import { Conflict, StepError } from "./errors";
import { runScript } from "./gateway";
import { contain, detect } from "./incident";
import { executeRecovery, planRecovery, verifyRecovery } from "./recovery";
import { rescueRecovery } from "./rescue";
import {
  fulfilCase,
  runCharge,
  runConsentWait,
  runFailure,
  runLedger,
  runScripted,
  runUnderstand,
  secureCase,
  settleCase,
  type StepEnd,
} from "./scene1";
import { audit, col, getDemo } from "./store";

// Defined in store.ts so scene1.ts can use it without importing run.ts.
export { OPERATOR } from "./store";
export type LiveRunner = (d: Db) => Promise<{ error: string | null }>;

// A step can run for up to Vercel's 300 s limit; after that a stuck claim is treated as abandoned.
const STALE_MS = 6 * 60_000;
const pace = () => Number(process.env.STEP_PACE_MS ?? 60);
// awaiting_customer and awaiting_approval move on only through respond or approve.
const ADVANCEABLE: DemoStatus[] = ["ready", "running"];

export async function advance(
  d: Db,
  expected: number,
  live?: LiveRunner,
): Promise<void> {
  const demo = await col.demo(d).findOneAndUpdate(
    {
      _id: "demo",
      step: expected,
      status: { $in: ADVANCEABLE },
      $or: [
        { busyAt: null },
        { busyAt: { $lt: new Date(Date.now() - STALE_MS) } },
      ],
    },
    { $set: { busyAt: new Date(), error: null } },
    { returnDocument: "after" },
  );
  if (!demo) {
    const cur = await getDemo(d);
    if (cur.status === "done")
      throw new StepError("This run is finished. Reset to run it again.");
    if (cur.step === expected && cur.status === "awaiting_customer")
      throw new StepError("Waiting for the customer to respond.");
    if (cur.step === expected && cur.status === "awaiting_approval")
      throw new StepError("Waiting for approval.");
    throw new Conflict("This run already moved on.");
  }
  // Filtering by runId keeps this step's own demo-doc writes out of a newer run.
  const mine = { _id: "demo" as const, runId: demo.runId };
  const key = demo.steps[expected + 1];
  try {
    if (!key) throw new StepError("There is no next step.");
    const end = await runStep(d, demo, key, live);
    const last = expected + 2 === demo.steps.length;
    await col.demo(d).updateOne(mine, {
      $set: {
        step: expected + 1,
        busyAt: null,
        status: end.status ?? (last ? "done" : "running"),
        outcome: end.outcome ?? demo.outcome,
      },
    });
  } catch (e) {
    await col.demo(d).updateOne(mine, {
      $set: {
        busyAt: null,
        error: e instanceof Error ? e.message : String(e),
      },
    });
    throw e;
  }
}

async function runStep(
  d: Db,
  demo: DemoDoc,
  key: StepKey,
  live?: LiveRunner,
): Promise<StepEnd> {
  const s = SCENARIOS[demo.scenario];
  switch (key) {
    case "charge":
      return runCharge(d, demo);
    case "failure":
      return runFailure(d, demo);
    case "understand":
      return runUnderstand(d, demo, liveExtractor());
    case "search":
    case "boundary":
    case "negotiate":
    case "propose":
      return runScripted(d, demo, key);
    case "consent":
      return runConsentWait(d, demo);
    case "secure":
      return secureCase(d, demo);
    case "fulfil":
      return fulfilCase(d, demo);
    case "settle":
      return settleCase(d, demo);
    case "ledger":
      return runLedger(d, demo);
    case "brief": {
      const task = s.task;
      if (!task) throw new StepError(`${s.name} has no task to brief.`);
      await col.tasks(d).insertOne({
        taskId: task.id,
        runId: demo.runId,
        scenario: s.id,
        text: task.text,
        approvedTargets: task.approvedTargets,
        approvedBy: task.approvedBy,
        at: new Date(),
      });
      await audit(d, {
        runId: demo.runId,
        actor: task.approvedBy,
        action: "task.authorise",
        detail: `${task.text} ${task.approvedTargets.length} ${s.targetLabel}s approved.`,
        decision: "Authorised",
        operationId: null,
      });
      return {};
    }
    case "agentReads":
    case "agentActs":
      await runScript(d, demo, key);
      return {};
    case "detect":
      return (await detect(d))
        ? {}
        : { status: "done", outcome: "no_incident" };
    case "contain":
      await contain(d);
      await runScript(d, demo, "contain");
      return {};
    case "plan":
      await planRecovery(d);
      return {};
    case "approve":
      return { status: "awaiting_approval" };
    case "restore":
      await executeRecovery(d, pace());
      return {};
    case "rescue":
      await rescueRecovery(d);
      return {};
    case "verify": {
      const incident = await verifyRecovery(d);
      return {
        status: "done",
        outcome:
          incident.status === "resolved"
            ? "recovered"
            : "recovered_with_exceptions",
      };
    }
    case "agent":
      if (!live)
        throw new StepError(
          "The live agent is not configured. Set NEBIUS_API_KEY.",
        );
      throw new StepError("The live agent is not enabled in this build.");
  }
}
