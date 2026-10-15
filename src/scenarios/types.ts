import type { z } from "zod";
import type { CaseData } from "@/engine/case";
import type { Unit } from "@/lib/format";

export type ScenarioId = "provider-cancel" | "bulk-cancel";
export type Mode = "monitor";
export type Source = "scripted" | "live";
export type StepKey =
  | "charge"
  | "failure"
  | "understand"
  | "search"
  | "boundary"
  | "negotiate"
  | "propose"
  | "consent"
  | "secure"
  | "fulfil"
  | "settle"
  | "ledger"
  | "brief"
  | "agentReads"
  | "agentActs"
  | "detect"
  | "contain"
  | "plan"
  | "approve"
  | "restore"
  | "rescue"
  | "verify"
  | "agent";
export type FocusTab =
  "reasoning" | "candidates" | "messages" | "money" | "ledger" | "incident";

export type Data = Record<string, unknown>;
export type Rec = {
  system: string;
  recordId: string;
  target: string | null;
  data: Data;
  version: number;
};
export type Change = { system: string; recordId: string; data: Data };
export type Mutation = {
  system: string;
  recordId: string;
  target: string | null;
  before: Data;
  after: Data;
};

export type PolicyReason =
  | "over_subsidy"
  | "hard_constraint"
  | "hold_expired"
  | "consent_expired"
  | "slot_taken"
  | "conflicting_change"
  | "unfunded";
export type PolicyDeny = { reason: PolicyReason; message: string };

// A Record makes typecheck fail when a new PolicyReason is not listed here.
export const POLICY_REASONS: Record<PolicyReason, true> = {
  over_subsidy: true,
  hard_constraint: true,
  hold_expired: true,
  consent_expired: true,
  slot_taken: true,
  conflicting_change: true,
  unfunded: true,
};
export const isPolicyReason = (reason: string): reason is PolicyReason =>
  Object.hasOwn(POLICY_REASONS, reason);

export type ToolOutput = { result: unknown; changes: Change[] };
export type Tool = {
  kind: "read" | "mutate";
  description: string;
  args: z.ZodType;
  targets(args: unknown, recs: Rec[]): string[];
  policy(args: unknown, recs: Rec[], now: Date): PolicyDeny | null;
  run(args: unknown, recs: Rec[], now: Date): ToolOutput;
};

export function defineTool<S extends z.ZodType>(t: {
  kind: "read" | "mutate";
  description: string;
  args: S;
  targets?: (args: z.infer<S>, recs: Rec[]) => string[];
  policy?: (args: z.infer<S>, recs: Rec[], now: Date) => PolicyDeny | null;
  run: (args: z.infer<S>, recs: Rec[], now: Date) => ToolOutput;
}): Tool {
  return {
    kind: t.kind,
    description: t.description,
    args: t.args,
    targets: (args, recs) => t.targets?.(args as z.infer<S>, recs) ?? [],
    policy: (args, recs, now) =>
      t.policy?.(args as z.infer<S>, recs, now) ?? null,
    run: (args, recs, now) => t.run(args as z.infer<S>, recs, now),
  };
}

export type PlanKind = "restore" | "request" | "manual";
export type PlanDecision = {
  kind: PlanKind;
  action: string | null;
  reason: string;
  owner: string | null;
  why: "conflict" | "irreversible" | null;
};
export type Compensation = { ok: boolean; detail: string; changes: Change[] };
export type Call = { tool: string; args: unknown };
export type ScriptCall = {
  step: StepKey;
  tool: string;
  args: unknown;
  say: string;
};
export type RecordView = {
  title: string;
  subtitle: string;
  status: string;
  stage: string;
  lane: string | null;
};

export type Scenario = {
  id: ScenarioId;
  name: string;
  short: string;
  agent: { id: string; name: string; role: string };
  task: {
    id: string;
    text: string;
    approvedTargets: string[];
    approvedBy: string;
  } | null;
  targetLabel: string;
  systemsLabel: string;
  authoritative: string;
  unit: Unit;
  live: ((caseData: CaseData) => { system: string; user: string }) | null;
  seed(now: Date): Rec[];
  tools: Record<string, Tool>;
  script: ScriptCall[];
  plan(
    target: string,
    before: Rec[],
    current: Rec[],
    all: Rec[],
    now: Date,
  ): PlanDecision;
  compensate(
    action: string,
    target: string,
    before: Rec[],
    current: Rec[],
    all: Rec[],
  ): Compensation;
  verify(target: string, before: Rec[], current: Rec[]): boolean;
  // Pence.
  exposure(target: string, before: Rec[]): number;
  view(target: string, current: Rec[]): RecordView;
};
