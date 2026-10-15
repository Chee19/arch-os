import type { Db } from "mongodb";
import {
  bookingOf,
  caseOf,
  providersOf,
  slotsOf,
  type BookingData,
  type CaseData,
  type CaseMessage,
  type Consent,
  type Constraints,
  type Extraction,
  type Offer,
  type ProviderData,
  type Rejected,
  type SlotData,
} from "@/engine/case";
import { buildJournal, isBalanced, type JournalEntry } from "@/ledger/journal";
import { money, plural, when } from "@/lib/format";
import { splitFor, type Split } from "@/money/math";
import { opsFor } from "@/money/ops";
import { dashboardUrl } from "@/money/stripe";
import { SCENARIOS } from "@/scenarios";
import type {
  FocusTab,
  PlanKind,
  Rec,
  RecordView,
  Scenario,
  ScenarioId,
  Source,
  StepKey,
} from "@/scenarios/types";
import type {
  ActionDoc,
  AuditDoc,
  DemoStatus,
  ExceptionDoc,
  IncidentDoc,
  ItemDoc,
  ItemStatus,
  MessageDoc,
  OpKind,
  PaymentOp,
  RecoveryDoc,
} from "./docs";
import { ladderOf, latestOps, type Ladder } from "./ladder";
import { matchConstraints } from "./policy";
import { byTarget, stripSim } from "./records";
import { CASE_ID } from "./scene1";
import { beforeStates, changedTargets } from "./scope";
import { STEP_META } from "./steps";
import {
  DEFAULT_CONFIG,
  OPERATOR,
  col,
  getDemo,
  loadRecords,
  resetDemo,
} from "./store";

const WORKSPACE = "Larkspur Home Services";
// The order searchProviders returns (spec 3.1, step 3); loadRecords sorts by record ID instead.
const SEARCH_ORDER = [
  "PROV-brightnest",
  "PROV-clearhome",
  "PROV-sparkle",
  "PROV-freshco",
];
const SECURED_OR_LATER = ["secured", "fulfilled", "settled"];

export type Tone = "idle" | "scope" | "changed" | "bad" | "ok" | "warn";
export type UiRecord = RecordView & {
  target: string;
  tone: Tone;
  inScope: boolean;
  version: number;
  plan: PlanKind | null;
  itemStatus: ItemStatus | null;
  outcome: "restored" | "replaced" | null;
};
export type UiStep = {
  key: StepKey;
  label: string;
  actor: string;
  title: string;
  check: string;
  result: string;
  focusTab: FocusTab;
};
export type UiCandidate = {
  providerId: string;
  name: string;
  eligible: boolean;
  why: string;
  state: "potential" | "confirmed" | "held" | "secured" | "rejected";
  quotePence: number | null;
  pricePence: number | null;
  holdExpiresAt: string | null;
  slotLabel: string | null;
  rejectReason: string | null;
};
export type UiCase = {
  caseId: string;
  bookingId: string;
  status: CaseData["status"];
  booking: {
    service: string;
    customer: string;
    address: string;
    startsAt: string;
    pricePence: number;
    providerName: string;
    status: BookingData["status"];
  };
  paidPence: number;
  originalProviderPaid: boolean;
  rescueDeadline: string;
  cancellationText: string | null;
  customerText: string | null;
  constraints: Constraints | null;
  extraction: Extraction | null;
  candidates: UiCandidate[];
  messages: CaseMessage[];
  proposal: {
    offerId: string;
    providerName: string;
    startsAt: string;
    split: Split;
    expiresAt: string;
  } | null;
  consent: Consent | null;
  fulfilment: CaseData["fulfilment"];
  ladder: Ladder;
  split: Split | null;
  tiles: {
    atRiskPence: number;
    provisionalPence: number | null;
    settledPence: number | null;
  };
};
export type UiPaymentOp = Pick<
  PaymentOp,
  "opId" | "kind" | "attempt" | "amountPence" | "state" | "stripeId" | "error"
> & {
  observed:
    | (Omit<NonNullable<PaymentOp["observed"]>, "checkedAt"> & {
        checkedAt: string;
      })
    | null;
  dashboardUrl: string | null;
};
export type UiException = Pick<
  ExceptionDoc,
  | "exceptionId"
  | "caseId"
  | "target"
  | "owner"
  | "reason"
  | "nextAction"
  | "action"
  | "opId"
  | "status"
  | "note"
> & { dueAt: string; overdue: boolean };
export type UiItem = Pick<
  ItemDoc,
  | "target"
  | "kind"
  | "action"
  | "reason"
  | "owner"
  | "why"
  | "status"
  | "detail"
  | "assignedTo"
  | "outcome"
  | "replacement"
> & { title: string };
export type UiAction = Pick<
  ActionDoc,
  "operationId" | "tool" | "kind" | "decision" | "reason" | "targets" | "source"
> & { at: string; changed: number };
export type UiMessage = Pick<
  MessageDoc,
  "seq" | "role" | "text" | "reasoning" | "toolCalls" | "toolCallId" | "usage"
> & { at: string };
export type UiAudit = Pick<
  AuditDoc,
  "seq" | "actor" | "action" | "detail" | "decision" | "operationId"
> & { at: string };
export type Metrics = {
  mutated: number;
  outOfScope: number;
  restore: number;
  manual: number;
  done: number;
  failed: number;
  recovered: number;
  replaced: number;
  unresolved: number;
  blocked: number;
};

export type DemoState = {
  demo: {
    scenario: ScenarioId;
    source: Source;
    runId: string;
    steps: StepKey[];
    step: number;
    status: DemoStatus;
    outcome: string | null;
    error: string | null;
    busy: boolean;
    focusTab: FocusTab | null;
  };
  scenario: {
    id: ScenarioId;
    name: string;
    short: string;
    agentId: string;
    agentName: string;
    agentRole: string;
    targetLabel: string;
    systemsLabel: string;
    task: Scenario["task"];
  };
  scenarios: {
    id: ScenarioId;
    short: string;
    name: string;
    agentName: string;
    agentRole: string;
    status: "active" | "suspended";
  }[];
  steps: UiStep[];
  records: UiRecord[];
  actions: UiAction[];
  messages: UiMessage[];
  case: UiCase | null;
  payments: UiPaymentOp[];
  journal: JournalEntry[];
  incident:
    | (Omit<IncidentDoc, "openedAt"> & {
        openedAt: string;
        values: {
          atRiskPence: number;
          restoredPence: number;
          replacedPence: number;
          unresolvedPence: number;
        };
      })
    | null;
  recovery: {
    status: RecoveryDoc["status"];
    approvedBy: string | null;
    approvedAt: string | null;
    items: UiItem[];
  } | null;
  exceptions: UiException[];
  audit: UiAudit[];
  metrics: Metrics;
  operator: string;
  workspace: string;
};

function toneOf(o: {
  changed: boolean;
  inScope: boolean;
  flagged: boolean;
  item: ItemDoc | undefined;
  verified: boolean;
}): Tone {
  if (!o.changed) return "idle";
  if (o.inScope) return "scope";
  if (o.verified || o.item?.status === "done") return "ok";
  if (o.item && o.item.status !== "pending") return "warn";
  return o.flagged ? "bad" : "changed";
}

const rank = (providerId: string) =>
  SEARCH_ORDER.includes(providerId)
    ? SEARCH_ORDER.indexOf(providerId)
    : SEARCH_ORDER.length;

function candidateState(
  o: Offer | undefined,
  rejected: Rejected | undefined,
  now: Date,
): UiCandidate["state"] {
  if (rejected) return "rejected";
  if (!o || o.state === "released") return "potential";
  if (o.state === "secured") return "secured";
  const holding = o.state === "held" || o.state === "proposed";
  if (
    holding &&
    o.holdExpiresAt !== null &&
    Date.parse(o.holdExpiresAt) > now.getTime()
  )
    return "held";
  // A lapsed hold still leaves the provider's quote on record.
  return "confirmed";
}

export function candidatesOf(
  c: CaseData,
  providers: ProviderData[],
  slots: SlotData[],
  now: Date,
): UiCandidate[] {
  const constraints = c.constraints;
  if (!constraints) return [];
  return providers
    .filter((p) => p.providerId !== c.originalProviderId)
    .sort((a, b) => rank(a.providerId) - rank(b.providerId))
    .map((p) => {
      const offer = c.offers.find((o) => o.providerId === p.providerId);
      const rejected = c.rejected.find((r) => r.providerId === p.providerId);
      // The provider's own held or booked slot still counts towards its match.
      const own = slots.map((s) =>
        s.slotId === offer?.slotId ? { ...s, status: "free" as const } : s,
      );
      const match = matchConstraints(constraints, p, own);
      const slotId = offer?.slotId ?? match.slotId;
      const startsAt = slots.find((s) => s.slotId === slotId)?.startsAt;
      return {
        providerId: p.providerId,
        name: p.name,
        eligible: match.eligible,
        why: match.why,
        state: candidateState(offer, rejected, now),
        quotePence: offer?.quotePence ?? null,
        pricePence: rejected?.pricePence ?? offer?.pricePence ?? null,
        holdExpiresAt: offer?.holdExpiresAt ?? null,
        slotLabel: startsAt ? when(startsAt) : null,
        rejectReason: rejected?.message ?? null,
      };
    });
}

// Whitelists every field, so simulator data cannot reach the payload even from unstripped records.
export function buildCase(
  recs: Rec[],
  ops: PaymentOp[],
  exceptions: ExceptionDoc[],
  now: Date,
  searched = true,
): UiCase {
  const c = caseOf(recs).data;
  const booking = bookingOf(recs, c.bookingId).data;
  const providers = providersOf(recs).map((p) => p.data);
  const slots = slotsOf(recs).map((s) => s.data);
  const nameOf = (id: string) =>
    providers.find((p) => p.providerId === id)?.name ?? id;
  const ladder = ladderOf({ caseData: c, booking, ops, exceptions });
  const active = c.offers.find(
    (o) =>
      (o.state === "held" || o.state === "proposed" || o.state === "secured") &&
      o.pricePence !== null,
  );
  const price = active?.pricePence ?? null;
  const split = price ? splitFor(c.paidPence, price) : null;
  const shown = active && active.state !== "held" ? active : undefined;
  const secured = SECURED_OR_LATER.includes(ladder.state);
  return {
    caseId: c.caseId,
    bookingId: c.bookingId,
    status: c.status,
    booking: {
      service: booking.service,
      customer: booking.customer,
      address: booking.address,
      startsAt: booking.startsAt,
      pricePence: booking.pricePence,
      providerName: nameOf(booking.providerId),
      status: booking.status,
    },
    paidPence: c.paidPence,
    originalProviderPaid: c.originalProviderPaid,
    rescueDeadline: c.rescueDeadline,
    cancellationText: c.cancellationText,
    customerText: c.customerText,
    constraints: c.constraints,
    extraction: c.extraction,
    candidates: searched ? candidatesOf(c, providers, slots, now) : [],
    messages: c.messages,
    proposal:
      shown && split && shown.holdExpiresAt
        ? {
            offerId: shown.offerId,
            providerName: nameOf(shown.providerId),
            startsAt:
              slots.find((s) => s.slotId === shown.slotId)?.startsAt ??
              booking.startsAt,
            split,
            expiresAt: shown.holdExpiresAt,
          }
        : null,
    consent: c.consent,
    fulfilment: c.fulfilment,
    ladder,
    split,
    tiles: {
      atRiskPence: c.status === "booked" ? 0 : c.paidPence,
      provisionalPence: split && secured ? split.price : null,
      settledPence: split && ladder.state === "settled" ? split.price : null,
    },
  };
}

export function toUiException(e: ExceptionDoc, now: Date): UiException {
  return {
    exceptionId: e.exceptionId,
    caseId: e.caseId,
    target: e.target,
    owner: e.owner,
    reason: e.reason,
    nextAction: e.nextAction,
    action: e.action,
    opId: e.opId,
    status: e.status,
    note: e.note,
    dueAt: e.dueAt.toISOString(),
    overdue: e.status === "open" && e.dueAt.getTime() < now.getTime(),
  };
}

function toUiOp(o: PaymentOp): UiPaymentOp {
  return {
    opId: o.opId,
    kind: o.kind,
    attempt: o.attempt,
    amountPence: o.amountPence,
    state: o.state,
    stripeId: o.stripeId,
    error: o.error,
    observed: o.observed
      ? { ...o.observed, checkedAt: o.observed.checkedAt.toISOString() }
      : null,
    dashboardUrl: o.stripeId ? dashboardUrl(o.stripeId) : null,
  };
}

export type ResultInput = {
  kase: UiCase | null;
  payments: UiPaymentOp[];
  journal: JournalEntry[];
  task: Scenario["task"];
  records: number;
  metrics: Metrics;
  incident: Pick<IncidentDoc, "budgetPence" | "committedPence"> | null;
  approvedBy: string | null;
  actions: UiAction[];
  exceptions: UiException[];
};

const latestOp = (ops: UiPaymentOp[], kind: OpKind) => latestOps(ops)[kind];
const opLine = (label: string, o: UiPaymentOp | undefined) =>
  !o
    ? ""
    : o.stripeId
      ? `${label} ${o.stripeId} ${o.state}`
      : `${label} ${o.state}`;

export function stepResult(key: StepKey, x: ResultInput): string {
  const c = x.kase;
  const m = x.metrics;
  const exception = c?.ladder.exception
    ? `Exception: ${c.ladder.exception.nextAction}`
    : "";
  switch (key) {
    case "charge":
      return opLine("Charge", latestOp(x.payments, "charge"));
    case "failure":
      return c ? `${money(c.paidPence)} booking at risk` : "";
    case "understand":
      return c?.constraints
        ? `Done by ${when(c.constraints.doneBy)}, max ${money(c.constraints.maxPricePence)} (${c.extraction?.source ?? "scripted"})`
        : "";
    case "search":
      return c
        ? `${c.candidates.filter((k) => k.eligible).length} of ${plural(c.candidates.length, "provider")} eligible`
        : "";
    case "boundary": {
      const r = c?.candidates.find((k) => k.state === "rejected");
      return r ? `${r.name} rejected: ${r.rejectReason ?? "policy"}` : "";
    }
    case "negotiate": {
      const h = c?.candidates.find(
        (k) => k.state !== "rejected" && k.pricePence !== null,
      );
      return h?.pricePence ? `${h.name} agreed ${money(h.pricePence)}` : "";
    }
    case "propose":
      return c?.proposal
        ? `${c.proposal.providerName} at ${money(c.proposal.split.price)}, ${money(c.proposal.split.refund)} back to the customer`
        : "";
    case "consent":
      return c?.consent
        ? `Customer ${c.consent.decision === "accept" ? "accepted" : "declined"}`
        : "Waiting for the customer";
    case "secure":
      return (
        opLine("Refund", latestOp(x.payments, "refund")) ||
        exception ||
        (c && SECURED_OR_LATER.includes(c.ladder.state)
          ? "Booking secured, no refund due"
          : "")
      );
    case "fulfil":
      return c?.fulfilment ? "Fulfilment recorded (simulated)" : "";
    case "settle":
      return opLine("Transfer", latestOp(x.payments, "transfer")) || exception;
    case "ledger":
      return `${x.journal.length} journal entries, ${x.journal.every(isBalanced) ? "all balanced" : "not balanced"}, not posted`;
    case "agent":
      return c?.proposal
        ? `Proposed ${c.proposal.providerName} at ${money(c.proposal.split.price)}`
        : plural(x.actions.length, "tool call");
    case "brief":
      return x.task
        ? `${plural(x.task.approvedTargets.length, "booking")} approved by ${x.task.approvedBy}`
        : "";
    case "agentReads":
      return `${plural(x.records, "booking")} listed`;
    case "agentActs":
      return `${plural(m.mutated, "booking")} cancelled`;
    case "detect":
      return m.outOfScope && x.task
        ? `${plural(m.outOfScope, "booking")} changed outside ${x.task.id}`
        : "No changes outside the task";
    case "contain": {
      const b = x.actions.filter((a) => a.decision === "blocked").at(-1);
      return b
        ? `${b.tool} blocked: ${b.reason ?? "suspended"}`
        : "Agent suspended";
    }
    case "plan":
      return `${m.restore} to restore, ${plural(m.manual, "conflict")}`;
    case "approve":
      return x.approvedBy
        ? `Approved by ${x.approvedBy}`
        : "Waiting for approval";
    case "restore":
      return `${plural(m.done - m.replaced, "booking")} restored`;
    case "rescue": {
      const open = x.exceptions.filter((e) => e.status === "open").length;
      const budget = x.incident
        ? `, ${money(x.incident.committedPence)} of ${money(x.incident.budgetPence)} committed`
        : "";
      return `${m.replaced} replaced, ${plural(open, "exception")}${budget}`;
    }
    case "verify":
      return `${m.recovered} verified, ${m.unresolved} unresolved`;
  }
}

export async function loadState(d: Db): Promise<DemoState> {
  if (!(await col.demo(d).findOne({ _id: "demo" })))
    await resetDemo(d, DEFAULT_CONFIG);
  const demo = await getDemo(d);
  const s = SCENARIOS[demo.scenario];
  const { runId } = demo;
  const scene1 = demo.scenario === "provider-cancel";
  const [
    raw,
    actionDocs,
    messageDocs,
    incident,
    recovery,
    items,
    auditDocs,
    agents,
    exceptionDocs,
    ops,
  ] = await Promise.all([
    loadRecords(d, demo.scenario),
    col.actions(d).find({ runId }).sort({ at: 1, _id: 1 }).toArray(),
    col.messages(d).find({ runId }).sort({ seq: 1 }).toArray(),
    col.incidents(d).findOne({ runId }, { projection: { _id: 0 } }),
    col.recovery(d).findOne({ runId }),
    col.items(d).find({ runId }).sort({ target: 1 }).toArray(),
    col.audit(d).find({ runId }).sort({ seq: -1 }).limit(200).toArray(),
    col.agents(d).find().toArray(),
    col.exceptions(d).find({ runId }).sort({ createdAt: 1 }).toArray(),
    scene1 ? opsFor(d, runId, CASE_ID) : Promise.resolve<PaymentOp[]>([]),
  ]);
  // Provider floors live under _sim and must never reach the browser.
  const recs = stripSim(raw);
  const now = new Date();

  const allowed = actionDocs.filter(
    (a) => a.decision === "allowed" && a.kind === "mutate",
  );
  const mutated = changedTargets(allowed);
  const changed = new Set(mutated);
  const approved = new Set(s.task?.approvedTargets ?? []);
  const befores = beforeStates(allowed);
  const itemOf = new Map(items.map((i) => [i.target, i]));
  const verified = new Set(incident?.verified ?? []);

  const targets = [
    ...new Set(
      recs.map((r) => r.target).filter((t): t is string => t !== null),
    ),
  ].sort();
  const records: UiRecord[] = targets.map((target) => {
    const mine = byTarget(recs, target);
    const item = itemOf.get(target);
    return {
      target,
      ...s.view(target, mine),
      tone: toneOf({
        changed: changed.has(target),
        inScope: approved.has(target),
        flagged: Boolean(incident),
        item,
        verified: verified.has(target),
      }),
      inScope: approved.has(target),
      version: mine.reduce((v, r) => v + r.version, 0),
      plan: item?.kind ?? null,
      itemStatus: item?.status ?? null,
      outcome: item?.outcome ?? null,
    };
  });

  const count = (f: (i: ItemDoc) => boolean) => items.filter(f).length;
  const metrics: Metrics = {
    mutated: mutated.length,
    outOfScope: incident?.affected.length ?? 0,
    restore: count((i) => i.kind === "restore"),
    manual: count((i) => i.kind === "manual"),
    done: count((i) => i.status === "done"),
    failed: count((i) => i.status === "failed"),
    recovered: incident?.verified.length ?? 0,
    replaced: count((i) => i.outcome === "replaced"),
    unresolved: incident?.unresolved.length ?? 0,
    blocked: actionDocs.filter((a) => a.decision === "blocked").length,
  };

  const actions: UiAction[] = actionDocs.map((a) => ({
    operationId: a.operationId,
    tool: a.tool,
    kind: a.kind,
    decision: a.decision,
    reason: a.reason,
    targets: a.targets,
    source: a.source,
    at: a.at.toISOString(),
    changed: new Set(a.mutations.map((m) => m.target).filter(Boolean)).size,
  }));
  const exceptions = exceptionDocs.map((e) => toUiException(e, now));
  const searched = actionDocs.some(
    (a) => a.tool === "searchProviders" && a.decision === "allowed",
  );
  const kase = scene1
    ? buildCase(recs, ops, exceptionDocs, now, searched)
    : null;
  const payments = ops.map(toUiOp);
  const journal = kase
    ? buildJournal({
        split: kase.split ?? splitFor(kase.paidPence, kase.paidPence),
        ops,
        fulfilment: kase.fulfilment,
      })
    : [];
  const value = (f: (i: ItemDoc) => boolean) =>
    items
      .filter(f)
      .reduce(
        (n, i) => n + s.exposure(i.target, befores.get(i.target) ?? []),
        0,
      );

  const input: ResultInput = {
    kase,
    payments,
    journal,
    task: s.task,
    records: records.length,
    metrics,
    incident,
    approvedBy: recovery?.approvedBy ?? null,
    actions,
    exceptions,
  };
  const current = demo.steps[demo.step] as StepKey | undefined;

  return {
    demo: {
      scenario: demo.scenario,
      source: demo.source,
      runId,
      steps: demo.steps,
      step: demo.step,
      status: demo.status,
      outcome: demo.outcome,
      error: demo.error,
      busy: demo.busyAt !== null,
      focusTab: current ? STEP_META[current].focusTab : null,
    },
    scenario: {
      id: s.id,
      name: s.name,
      short: s.short,
      agentId: s.agent.id,
      agentName: s.agent.name,
      agentRole: s.agent.role,
      targetLabel: s.targetLabel,
      systemsLabel: s.systemsLabel,
      task: s.task,
    },
    scenarios: Object.values(SCENARIOS).map((x) => ({
      id: x.id,
      short: x.short,
      name: x.name,
      agentName: x.agent.name,
      agentRole: x.agent.role,
      status: agents.find((a) => a.agentId === x.agent.id)?.status ?? "active",
    })),
    steps: demo.steps.map((key, i) => ({
      key,
      ...STEP_META[key],
      result: i <= demo.step ? stepResult(key, input) : "",
    })),
    records,
    actions,
    messages: messageDocs.map((m) => ({
      seq: m.seq,
      role: m.role,
      text: m.text,
      reasoning: m.reasoning,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      usage: m.usage,
      at: m.at.toISOString(),
    })),
    case: kase,
    payments,
    journal,
    // The projection drops _id, so the spread carries only IncidentDoc fields.
    incident: incident
      ? {
          ...incident,
          openedAt: incident.openedAt.toISOString(),
          values: {
            atRiskPence: incident.exposure,
            restoredPence: value(
              (i) => i.status === "done" && i.outcome === "restored",
            ),
            replacedPence: value(
              (i) => i.status === "done" && i.outcome === "replaced",
            ),
            unresolvedPence: value((i) => i.status !== "done"),
          },
        }
      : null,
    recovery: recovery
      ? {
          status: recovery.status,
          approvedBy: recovery.approvedBy,
          approvedAt: recovery.approvedAt?.toISOString() ?? null,
          items: items.map((i) => ({
            target: i.target,
            kind: i.kind,
            action: i.action,
            reason: i.reason,
            owner: i.owner,
            why: i.why,
            status: i.status,
            detail: i.detail,
            assignedTo: i.assignedTo,
            outcome: i.outcome,
            replacement: i.replacement,
            title: s.view(i.target, byTarget(recs, i.target)).title,
          })),
        }
      : null,
    exceptions,
    audit: auditDocs.map((a) => ({
      seq: a.seq,
      actor: a.actor,
      action: a.action,
      detail: a.detail,
      decision: a.decision,
      operationId: a.operationId,
      at: a.at.toISOString(),
    })),
    metrics,
    operator: OPERATOR,
    workspace: WORKSPACE,
  };
}
