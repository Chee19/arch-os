import type {
  DemoStatus,
  IncidentStatus,
  OpKind,
  OpState,
} from "@/engine/docs";
import type { LadderState } from "@/engine/ladder";
import type { Tone, UiCandidate, UiException } from "@/engine/state";

export type ToneClass = "" | "green" | "amber" | "red";

export const TONE_LABEL: Record<Tone, string> = {
  idle: "untouched",
  scope: "cancelled as authorised",
  changed: "changed, not yet checked",
  bad: "cancelled outside the task",
  ok: "recovered",
  warn: "with a named owner",
};
export const TONE_CLASS: Record<Tone, ToneClass> = {
  idle: "",
  scope: "green",
  changed: "red",
  bad: "red",
  ok: "green",
  warn: "amber",
};
export const TONE_GLYPH: Record<Tone, string> = {
  idle: "",
  scope: "•",
  changed: "•",
  bad: "×",
  ok: "✓",
  warn: "!",
};

export const INCIDENT_LABEL: Record<IncidentStatus, string> = {
  open: "Open",
  contained: "Contained",
  resolved: "Resolved",
  open_with_exceptions: "Open with exceptions",
};

export const REASON_LABEL: Record<string, string> = {
  suspended: "Agent suspended by containment.",
  out_of_scope: "Targets outside the task. Nothing executed.",
  invalid_args: "Invalid arguments, returned to the agent.",
  unknown_tool: "Unknown tool.",
  tool_error: "Records changed during the call.",
  stale_run: "Made before the workspace was reset. Not executed.",
  over_subsidy: "Over the subsidy cap. Denied by policy.",
  hard_constraint: "Fails a hard constraint. Denied by policy.",
  hold_expired: "The provider hold expired.",
  consent_expired: "Consent is missing, expired or for another offer.",
  slot_taken: "The slot changed since the hold.",
  conflicting_change: "Money moved outside ArchOS. Stopped for review.",
  unfunded: "Not enough verified customer money for this payout.",
};

export const LADDER_LABEL: Record<LadderState, string> = {
  investigating: "Investigating",
  offered: "Offered",
  secured: "Secured",
  fulfilled: "Fulfilled",
  settled: "Settled",
  remedied: "Remedied",
};
export const LADDER_TONE: Record<LadderState, ToneClass> = {
  investigating: "",
  offered: "amber",
  secured: "green",
  fulfilled: "green",
  settled: "green",
  remedied: "green",
};

export const CANDIDATE_LABEL: Record<UiCandidate["state"], string> = {
  potential: "Potential match",
  confirmed: "Confirmed offer",
  held: "Held",
  secured: "Secured",
  rejected: "Rejected",
};

export const OP_KIND_LABEL: Record<OpKind, string> = {
  charge: "Customer charge",
  refund: "Partial refund",
  full_refund: "Full refund",
  transfer: "Transfer to provider",
};
export const OP_STATE_LABEL: Record<OpState, string> = {
  intended: "Intended",
  requested: "Reconciling",
  pending: "Pending",
  succeeded: "Succeeded",
  failed: "Failed",
};
export const OP_STATE_TONE: Record<OpState, ToneClass> = {
  intended: "",
  requested: "amber",
  pending: "amber",
  succeeded: "green",
  failed: "red",
};

// Audit decisions are free text written by the engine; anything not listed stays neutral.
export const DECISION_TONE: Record<string, ToneClass> = {
  Blocked: "red",
  Rejected: "red",
  "Critical incident": "red",
  Failed: "red",
  Stopped: "red",
  Skipped: "amber",
  "Open with exceptions": "amber",
  "Exception opened": "amber",
  Assigned: "amber",
  "Access resumed": "amber",
  Pending: "amber",
  Reconciling: "amber",
};
export const decisionTone = (decision: string): ToneClass =>
  DECISION_TONE[decision] ?? "";

export type Submit = "advance" | "respond" | "approve" | null;

// One gate for every submit button, so a second click while busy never posts.
export function canSubmit(busy: boolean, status: DemoStatus): Submit {
  if (busy) return null;
  if (status === "awaiting_customer") return "respond";
  if (status === "awaiting_approval") return "approve";
  return status === "done" ? null : "advance";
}

export function hasOpenException(xs: UiException[], key?: string): boolean {
  return xs.some(
    (e) =>
      e.status === "open" &&
      (key === undefined || e.target === key || e.caseId === key),
  );
}
