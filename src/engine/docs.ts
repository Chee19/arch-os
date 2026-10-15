import type { Unit } from "@/lib/format";
import type {
  Mode,
  Mutation,
  PlanKind,
  PolicyReason,
  Rec,
  ScenarioId,
  Source,
  StepKey,
} from "@/scenarios/types";

export type CallResult =
  | { ok: true; result: unknown; targets: string[] }
  | {
      ok: false;
      reason:
        | "unknown_tool"
        | "invalid_args"
        | "suspended"
        | "out_of_scope"
        | "tool_error"
        | "stale_run"
        | PolicyReason;
      message: string;
      approvedTargets?: string[];
      outOfScope?: string[];
    };

export type DemoStatus =
  "ready" | "running" | "awaiting_approval" | "awaiting_customer" | "done";
export type DemoDoc = {
  _id: "demo";
  scenario: ScenarioId;
  mode: Mode;
  source: Source;
  runId: string;
  steps: StepKey[];
  step: number;
  status: DemoStatus;
  outcome: string | null;
  error: string | null;
  busyAt: Date | null;
  denial: string[] | null;
};
export type RecordDoc = Rec & { scenario: ScenarioId };
export type AgentDoc = {
  agentId: string;
  scenario: ScenarioId;
  name: string;
  status: "active" | "suspended";
};
export type TaskDoc = {
  taskId: string;
  runId: string;
  scenario: ScenarioId;
  text: string;
  approvedTargets: string[];
  approvedBy: string;
  at: Date;
};
export type ActionDoc = {
  operationId: string;
  runId: string;
  agentId: string;
  tool: string;
  kind: "read" | "mutate";
  args: unknown;
  targets: string[];
  decision: "allowed" | "blocked" | "error";
  reason: string | null;
  response: CallResult;
  mutations: Mutation[];
  source: Source;
  at: Date;
};
export type IncidentStatus =
  "open" | "contained" | "resolved" | "open_with_exceptions";
export type IncidentDoc = {
  incidentId: string;
  runId: string;
  scenario: ScenarioId;
  affected: string[];
  exposure: number;
  unit: Unit;
  severity: "critical";
  status: IncidentStatus;
  openedAt: Date;
  exposureRemaining: number | null;
  verified: string[];
  unresolved: string[];
  approvedIntact: boolean | null;
  budgetPence: number;
  committedPence: number;
};
export type RecoveryDoc = {
  runId: string;
  incidentId: string;
  status: "awaiting_approval" | "approved" | "executed" | "verified";
  approvedBy: string | null;
  approvedAt: Date | null;
  approvedVersions: Record<string, number>;
};
export type ItemStatus = "pending" | "manual" | "done" | "failed" | "skipped";
export type ItemDoc = {
  runId: string;
  operationId: string;
  target: string;
  kind: PlanKind;
  action: string | null;
  reason: string;
  owner: string | null;
  why: "conflict" | "irreversible" | null;
  versions: Record<string, number>;
  status: ItemStatus;
  detail: string | null;
  assignedTo: string | null;
  outcome: "restored" | "replaced" | null;
  replacement: {
    providerId: string;
    slotId: string;
    incentivePence: number;
    consentBasis: string;
  } | null;
};
export type MessageDoc = {
  runId: string;
  seq: number;
  role: "assistant" | "tool" | "error";
  text: string | null;
  reasoning: string | null;
  toolCalls: { id: string; name: string; args: string }[];
  toolCallId: string | null;
  usage: { prompt: number; completion: number } | null;
  at: Date;
};
export type AuditDoc = {
  seq: number;
  runId: string;
  at: Date;
  actor: string;
  action: string;
  detail: string;
  decision: string;
  operationId: string | null;
};

export type OpKind = "charge" | "refund" | "full_refund" | "transfer";
export type OpState =
  "intended" | "requested" | "pending" | "succeeded" | "failed";
export type PaymentOp = {
  opId: string; // `${runId}:${caseId}:${kind}:${attempt}`, also the Stripe idempotency key and metadata.opId
  runId: string;
  caseId: string;
  kind: OpKind;
  attempt: number; // starts at 1
  amountPence: number;
  request: Record<string, unknown>; // exact Stripe params, never recomputed
  state: OpState;
  stripeId: string | null;
  observed: {
    status: string | null;
    amountRefunded: number | null;
    balanceTransaction: string | null;
    feePence: number | null;
    reversed: boolean | null;
    checkedAt: Date;
  } | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExceptionDoc = {
  exceptionId: string; // `EXC:${runId}:${caseId ?? target}:${reasonKey}`, deterministic so re-opening is idempotent
  runId: string;
  caseId: string | null;
  target: string | null;
  owner: string;
  reason: string;
  nextAction: string;
  action: "refund" | "retry" | null; // extra button on the exceptions view besides Close
  dueAt: Date;
  opId: string | null; // auto-closes when this op reaches succeeded
  status: "open" | "closed";
  note: string | null;
  createdAt: Date;
};
