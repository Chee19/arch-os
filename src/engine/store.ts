import type { ClientSession, Db } from "mongodb";
import { client } from "@/db";
import { SCENARIOS } from "@/scenarios";
import type {
  Change,
  Mode,
  Mutation,
  Rec,
  ScenarioId,
  Source,
} from "@/scenarios/types";
import type {
  ActionDoc,
  AgentDoc,
  AuditDoc,
  DemoDoc,
  ExceptionDoc,
  IncidentDoc,
  ItemDoc,
  MessageDoc,
  PaymentOp,
  RecordDoc,
  RecoveryDoc,
  TaskDoc,
} from "./docs";
import { StepError, VersionConflict } from "./errors";
import { find } from "./records";
import { stepsFor } from "./steps";

export const col = {
  records: (d: Db) => d.collection<RecordDoc>("records"),
  demo: (d: Db) => d.collection<DemoDoc>("demo"),
  agents: (d: Db) => d.collection<AgentDoc>("agents"),
  tasks: (d: Db) => d.collection<TaskDoc>("tasks"),
  actions: (d: Db) => d.collection<ActionDoc>("agent_actions"),
  messages: (d: Db) => d.collection<MessageDoc>("agent_messages"),
  incidents: (d: Db) => d.collection<IncidentDoc>("incidents"),
  recovery: (d: Db) => d.collection<RecoveryDoc>("recovery_runs"),
  items: (d: Db) => d.collection<ItemDoc>("recovery_items"),
  audit: (d: Db) => d.collection<AuditDoc>("audit_events"),
  liveRuns: (d: Db) => d.collection<{ at: Date }>("live_runs"),
  payments: (d: Db) => d.collection<PaymentOp>("payment_ops"),
  exceptions: (d: Db) => d.collection<ExceptionDoc>("exceptions"),
};

export const OPERATOR = "Sam Okafor";

export type Config = { scenario: ScenarioId; mode: Mode; source: Source };
export const DEFAULT_CONFIG: Config = {
  scenario: "provider-cancel",
  mode: "monitor",
  source: "scripted",
};

// live_runs is deliberately absent so the credit budget survives resets.
const WIPE = [
  "records",
  "demo",
  "agents",
  "tasks",
  "agent_actions",
  "agent_messages",
  "incidents",
  "recovery_runs",
  "recovery_items",
  "audit_events",
  "counters",
  "payment_ops",
  "exceptions",
];

export async function ensureIndexes(d: Db): Promise<void> {
  await col
    .records(d)
    .createIndex({ scenario: 1, system: 1, recordId: 1 }, { unique: true });
  await col.agents(d).createIndex({ agentId: 1 }, { unique: true });
  await col.tasks(d).createIndex({ runId: 1 });
  await col.actions(d).createIndex({ operationId: 1 }, { unique: true });
  await col.actions(d).createIndex({ runId: 1, at: 1 });
  await col.messages(d).createIndex({ runId: 1, seq: 1 }, { unique: true });
  await col.incidents(d).createIndex({ runId: 1 }, { unique: true });
  await col.recovery(d).createIndex({ runId: 1 }, { unique: true });
  await col.items(d).createIndex({ operationId: 1 }, { unique: true });
  await col.items(d).createIndex({ runId: 1, target: 1 });
  await col.audit(d).createIndex({ seq: 1 }, { unique: true });
  await col.liveRuns(d).createIndex({ at: 1 }, { expireAfterSeconds: 86_400 });
  await col.payments(d).createIndex({ opId: 1 }, { unique: true });
  await col.payments(d).createIndex({ runId: 1, caseId: 1 });
  await col.exceptions(d).createIndex({ exceptionId: 1 }, { unique: true });
  await col.exceptions(d).createIndex({ runId: 1, status: 1 });
}

export async function loadRecords(
  d: Db,
  scenario: ScenarioId,
  session?: ClientSession,
): Promise<Rec[]> {
  const docs = await col
    .records(d)
    .find({ scenario }, { session })
    .sort({ system: 1, recordId: 1 })
    .toArray();
  return docs.map(({ system, recordId, target, data, version }) => ({
    system,
    recordId,
    target,
    data,
    version,
  }));
}

export async function persist(
  d: Db,
  scenario: ScenarioId,
  recs: Rec[],
  changes: Change[],
  session: ClientSession,
): Promise<Mutation[]> {
  const out: Mutation[] = [];
  for (const c of changes) {
    const r = find(recs, c.system, c.recordId);
    if (!r)
      throw new VersionConflict(`${c.system}:${c.recordId} does not exist`);
    const res = await col.records(d).updateOne(
      {
        scenario,
        system: c.system,
        recordId: c.recordId,
        version: r.version,
      },
      { $set: { data: c.data }, $inc: { version: 1 } },
      { session },
    );
    if (res.matchedCount !== 1)
      throw new VersionConflict(
        `${c.system}:${c.recordId} changed since it was read`,
      );
    out.push({
      system: c.system,
      recordId: c.recordId,
      target: r.target,
      before: r.data,
      after: c.data,
    });
  }
  return out;
}

export async function tx<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = (await client()).startSession();
  try {
    let out: T | undefined;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out as T;
  } finally {
    await session.endSession();
  }
}

export async function audit(
  d: Db,
  e: Omit<AuditDoc, "seq" | "at">,
  session?: ClientSession,
): Promise<void> {
  const counter = await d
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: "audit" },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after", session },
    );
  await col
    .audit(d)
    .insertOne({ ...e, seq: counter?.seq ?? 0, at: new Date() }, { session });
}

export async function getDemo(d: Db): Promise<DemoDoc> {
  const demo = await col.demo(d).findOne({ _id: "demo" });
  if (!demo)
    throw new StepError("The workspace has not been set up. Reset it first.");
  return demo;
}

export async function resetDemo(
  d: Db,
  cfg: Config,
  now = new Date(),
): Promise<void> {
  await tx(async (session) => {
    for (const name of WIPE)
      await d.collection(name).deleteMany({}, { session });
    const seed = SCENARIOS[cfg.scenario]
      .seed(now)
      .map((r) => ({ ...r, scenario: cfg.scenario }));
    // insertMany rejects an empty batch.
    if (seed.length) await col.records(d).insertMany(seed, { session });
    await col.agents(d).insertMany(
      Object.values(SCENARIOS).map((s) => ({
        agentId: s.agent.id,
        scenario: s.id,
        name: s.agent.name,
        status: "active" as const,
      })),
      { session },
    );
    await col.demo(d).insertOne(
      {
        _id: "demo",
        ...cfg,
        // Scene 2 is scripted only (spec 4); a live source would trigger inline detection a step early.
        source: cfg.scenario === "bulk-cancel" ? "scripted" : cfg.source,
        runId: `run-${now.getTime().toString(36)}`,
        steps: stepsFor(cfg.scenario, cfg.source),
        step: -1,
        status: "ready",
        outcome: null,
        error: null,
        busyAt: null,
        denial: null,
      },
      { session },
    );
  });
}
