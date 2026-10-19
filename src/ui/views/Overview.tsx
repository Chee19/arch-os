"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { LadderState } from "@/engine/ladder";
import type { DemoState } from "@/engine/state";
import { clock, money, plural, when } from "@/lib/format";
import { Icon } from "../Icon";
import { INCIDENT_LABEL, LADDER_LABEL, REASON_LABEL } from "../labels";
import { nextAction, shouldContinue } from "../nextStep";
import { PageHeading } from "../PageHeading";
import { StatCard } from "../StatCard";
import { Timeline } from "../Timeline";
import { useWorkspace } from "../WorkspaceProvider";

type Tone = "purple" | "blue" | "green" | "mint" | "peach" | "neutral" | "red";
type Filter = "all" | "attention" | "progress";
type Row = {
  key: string;
  href: string;
  name: string;
  service: string;
  ref: string;
  status: string;
  tone: Tone;
  reason: string;
  time: string;
  owner: string;
  attention: boolean;
  avatar: "lavender" | "apricot" | "blue" | "mint";
};

const FILTERS: [Filter, string][] = [
  ["all", "All cases"],
  ["attention", "Needs attention"],
  ["progress", "In progress"],
];

const LADDER_BADGE: Record<LadderState, Tone> = {
  investigating: "blue",
  offered: "peach",
  secured: "green",
  fulfilled: "mint",
  settled: "green",
  remedied: "green",
};

const INCIDENT_BADGE: Record<keyof typeof INCIDENT_LABEL, Tone> = {
  open: "peach",
  contained: "blue",
  resolved: "green",
  open_with_exceptions: "peach",
};

const subscribeNone = () => () => {};
const dateLabel = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

const initials = (s: string) =>
  s
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const pageOf = (s: DemoState) =>
  s.demo.scenario === "provider-cancel" ? "/case" : "/incident";

function needsPerson(s: DemoState): boolean {
  const { kind } = nextAction(s);
  if (kind === "customer" || kind === "approve" || kind === "provider")
    return true;
  return kind === "advance" && s.demo.status !== "ready" && !shouldContinue(s);
}

function heroCopy(s: DemoState): string {
  const { status } = s.demo;
  if (s.demo.scenario === "provider-cancel") {
    const c = s.case;
    if (!c) return "A booking is waiting for you. Nothing has been done yet.";
    const who = c.booking.customer;
    if (status === "ready")
      return `${who}'s ${c.booking.service} with ${c.booking.providerName} needs a new plan. Nothing has been done yet.`;
    return `${who}'s ${c.booking.service} (${c.bookingId}) is ${LADDER_LABEL[c.ladder.state].toLowerCase()}.`;
  }
  const inc = s.incident;
  if (!inc || status === "ready")
    return `${s.scenario.agentName} is working inside its task. No bookings have changed outside it yet.`;
  return `${plural(inc.affected.length, "booking")} changed outside the task. ${INCIDENT_LABEL[inc.status]}, with ${s.metrics.recovered} verified and ${s.metrics.unresolved} unresolved.`;
}

function buildRows(s: DemoState): Row[] {
  const rows: Row[] = [];
  const attention = needsPerson(s);
  if (s.demo.scenario === "provider-cancel") {
    const c = s.case;
    rows.push({
      key: "case",
      href: "/case",
      name: c?.booking.customer ?? s.scenario.name,
      service: c?.booking.service ?? s.scenario.agentRole,
      ref: c?.bookingId ?? s.scenario.short,
      status: c ? LADDER_LABEL[c.ladder.state] : "Ready",
      tone: c ? LADDER_BADGE[c.ladder.state] : "neutral",
      reason: "Provider cancelled",
      time: c ? when(c.booking.startsAt) : "-",
      owner: s.operator,
      attention,
      avatar: "lavender",
    });
  } else {
    const inc = s.incident;
    rows.push({
      key: "incident",
      href: "/incident",
      name: s.scenario.agentName,
      service: s.scenario.agentRole,
      ref: inc ? plural(inc.affected.length, "booking") : s.scenario.short,
      status: inc ? INCIDENT_LABEL[inc.status] : "Ready",
      tone: inc ? INCIDENT_BADGE[inc.status] : "neutral",
      reason: "Changes outside the task",
      time: inc ? when(inc.openedAt) : "-",
      owner: s.operator,
      attention,
      avatar: "blue",
    });
  }
  for (const e of s.exceptions.filter((x) => x.status === "open")) {
    rows.push({
      key: e.exceptionId,
      href: "/exceptions",
      name: e.target ?? e.caseId ?? "Open exception",
      service: "Needs a person",
      ref: e.exceptionId,
      status: e.overdue ? "Overdue" : "Needs your help",
      tone: e.overdue ? "red" : "peach",
      reason: REASON_LABEL[e.reason] ?? e.reason,
      time: when(e.dueAt),
      owner: e.owner ?? "No one",
      attention: true,
      avatar: "apricot",
    });
  }
  const idle = s.scenarios.find((x) => x.id !== s.demo.scenario);
  if (idle) {
    rows.push({
      key: idle.id,
      href: idle.id === "provider-cancel" ? "/case" : "/incident",
      name: idle.short,
      service: idle.agentRole,
      ref: idle.agentName,
      status: "Not started",
      tone: "neutral",
      reason: "Opens fresh when started",
      time: "-",
      owner: s.operator,
      attention: false,
      avatar: "mint",
    });
  }
  return rows;
}

export function OverviewView() {
  const { state, busy, proceed } = useWorkspace();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const today = useSyncExternalStore(subscribeNone, dateLabel, () => "");

  if (!state) return null;
  const next = nextAction(state);
  const openExceptions = state.exceptions.filter((e) => e.status === "open");
  const page = pageOf(state);
  const heroHref =
    next.kind !== "done"
      ? page
      : openExceptions.length
        ? "/exceptions"
        : state.demo.scenario === "provider-cancel"
          ? "/case"
          : "/history";

  const { case: c, incident: inc, metrics: m } = state;
  const isCase = state.demo.scenario === "provider-cancel";
  const loaded = isCase ? c !== null : inc !== null;
  const secured =
    c !== null && ["secured", "fulfilled", "settled"].includes(c.ladder.state);
  const affected = isCase
    ? c && c.booking.status !== "confirmed"
      ? 1
      : 0
    : (inc?.affected.length ?? m.mutated);
  const restored = isCase ? 0 : Math.max(m.done - m.replaced, 0);
  const replacements = isCase ? (secured ? 1 : 0) : m.replaced;
  const atRisk = isCase ? c?.tiles.atRiskPence : inc?.values.unresolvedPence;

  const rows = buildRows(state);
  const q = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || (filter === "attention") === r.attention) &&
      `${r.name} ${r.ref} ${r.service} ${r.reason}`.toLowerCase().includes(q),
  );

  const waiting =
    next.kind === "approve"
      ? {
          badge: "Your approval needed",
          title: "A recovery plan is ready.",
          body: "The agent is paused. Review the plan and approve it when you are ready.",
          label: "Review recovery plan",
          href: "/incident",
        }
      : next.kind === "customer"
        ? {
            badge: "Waiting on the customer",
            title: "The choice is theirs.",
            body: "An offer is with the customer. Nothing changes until they respond.",
            label: "View customer booking",
            href: "/case",
          }
        : openExceptions.length
          ? {
              badge: "Needs a person",
              title: `${plural(openExceptions.length, "case")} still open.`,
              body: "Each one has a named owner and a due time. They stay open until someone resolves them.",
              label: "Review open exceptions",
              href: "/exceptions",
            }
          : null;

  const events = [...state.audit]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 3)
    .map((a) => ({
      key: a.seq,
      title: a.detail,
      time: `${a.actor} · ${clock(a.at)}`,
    }));

  const go = async () => {
    if (next.kind !== "advance") return;
    if (await proceed({ action: "advance", step: state.demo.step }))
      router.push(page);
  };

  return (
    <>
      <PageHeading
        eyebrow="YOUR RECOVERY WORKSPACE"
        title="Let’s get things back on track."
        subtitle="A clear next step for every booking. A little less to worry about."
        actions={
          <span className="date-label">
            <Icon name="clock" />
            <span suppressHydrationWarning>{today}</span>
            <span>Europe / London</span>
          </span>
        }
      />
      <section className="hero glass">
        <div className="hero-copy">
          <span className="eyebrow">
            <Icon name="spark" /> EVERY BOOKING IS A PROMISE
          </span>
          <h2>
            A change of plans.
            <br />
            Not the end of the story.
          </h2>
          <p>{heroCopy(state)}</p>
          <div className="hero-actions">
            {next.kind === "advance" ? (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void go()}
              >
                {next.label} <Icon name="arrow" />
              </button>
            ) : (
              <Link className="btn primary" href={heroHref}>
                {next.label} <Icon name="arrow" />
              </Link>
            )}
            <span>One clear next step at a time.</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="arch-shape">
            <div className="arch-inner" />
          </div>
          <div className="floating-note note-back">
            <Icon name="truck" /> A change of plans
          </div>
          <div className="floating-note note-front">
            <span className="note-check">
              <Icon name="check" />
            </span>
            <div>
              <strong>A way forward.</strong>
              <small>Same move. Fresh start.</small>
            </div>
          </div>
          <span className="art-star star-one">✧</span>
          <span className="art-star star-two">✦</span>
          <span className="art-dot" />
        </div>
      </section>
      <div className="stats-grid">
        <StatCard
          icon="inbox"
          tone="purple"
          title="Bookings affected"
          value={affected}
          note={
            isCase
              ? "Cancelled by the provider"
              : "Changed outside the agent's task"
          }
        />
        <StatCard
          icon="shield"
          tone="blue"
          title="Original bookings restored"
          value={restored}
          note="Commitments restored · delivery pending"
        />
        <StatCard
          icon="check"
          tone="mint"
          title="Replacements secured"
          value={replacements}
          note="Accepted bookings · not proof of delivery"
        />
        <StatCard
          icon="wallet"
          tone="peach"
          title="Booking value at risk"
          value={loaded && atRisk !== undefined ? money(atRisk) : "—"}
          note="Unresolved booking value · not lost revenue"
        />
      </div>
      <div className="overview-grid">
        <section className="glass queue-panel">
          <div className="section-heading">
            <div>
              <h2>
                Your recovery inbox <span className="count">{rows.length}</span>
              </h2>
              <p>The right attention, in the right order.</p>
            </div>
          </div>
          <div className="queue-controls">
            <div className="segmented" role="group" aria-label="Filter cases">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  className={filter === key ? "selected" : ""}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search-field">
              <Icon name="search" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a booking…"
                aria-label="Search cases"
              />
            </label>
          </div>
          {shown.length === 0 ? (
            <div className="empty-state">
              <Icon name="search" />
              <h3>No matching bookings</h3>
              <p>Try another name, booking ID or filter.</p>
              <button
                type="button"
                className="btn soft"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="queue-labels">
                <span>CASE &amp; BOOKING</span>
                <span>STATUS</span>
                <span>NEXT UP</span>
                <span />
              </div>
              {shown.map((r) => (
                <Link key={r.key} className="queue-row" href={r.href}>
                  <div className="customer-cell">
                    <span className={`avatar ${r.avatar}`}>
                      {initials(r.name)}
                    </span>
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.service} <span>· {r.ref}</span>
                      </small>
                    </span>
                  </div>
                  <div className="row-status">
                    <span className={`badge ${r.tone}`}>
                      <i />
                      {r.status}
                    </span>
                    <small>{r.reason}</small>
                  </div>
                  <div className="row-next">
                    <strong>{r.time}</strong>
                    <small>{r.owner} owns this case</small>
                  </div>
                  <Icon name="chevron" />
                </Link>
              ))}
            </>
          )}
          <div className="queue-footer">
            <Icon name="shield" /> Prioritised by service time and customer
            need.
          </div>
        </section>
        <aside className="right-column">
          {waiting && (
            <section className="attention-card">
              <div className="section-heading">
                <span className="tile-icon peach">
                  <Icon name="shield" />
                </span>
                <span className="badge peach">
                  <i />
                  {waiting.badge}
                </span>
              </div>
              <h3>{waiting.title}</h3>
              <p>{waiting.body}</p>
              <Link className="btn white" href={waiting.href}>
                {waiting.label} <Icon name="arrow" />
              </Link>
            </section>
          )}
          <section className="activity-mini glass">
            <div className="section-heading">
              <h3>Behind the scenes</h3>
              <span className="live-dot" />
            </div>
            {events.length ? (
              <Timeline events={events} compact />
            ) : (
              <p className="muted">Activity appears here as work begins.</p>
            )}
            <Link className="text-link" href="/history">
              See all activity <Icon name="arrow" />
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
