"use client";

import { useRef } from "react";
import type { UiAction, UiCase, UiMessage } from "@/engine/state";
import { money, plural, when } from "@/lib/format";
import { isPolicyReason } from "@/scenarios/types";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";
import { REASON_LABEL } from "./labels";
import { gsap, useGSAP } from "./motion";

type Entry = { at: string; m: UiMessage } | { at: string; a: UiAction };

function toolResult(text: string | null): {
  label: string;
  blocked: boolean;
  detail: string;
} {
  try {
    const r = JSON.parse(text ?? "") as {
      ok?: boolean;
      reason?: string;
      message?: string;
    };
    if (r.ok)
      return {
        label: "EXECUTED",
        blocked: false,
        detail: "Allowed by the gateway.",
      };
    const reason = r.reason ?? "";
    const blocked =
      reason === "suspended" ||
      reason === "out_of_scope" ||
      isPolicyReason(reason);
    return {
      label: blocked ? "BLOCKED" : "REJECTED",
      blocked,
      detail: r.message ?? REASON_LABEL[r.reason ?? ""] ?? "Rejected.",
    };
  } catch {
    // Long read results are truncated when stored, so they are shown as text.
    return { label: "RESULT", blocked: false, detail: text ?? "" };
  }
}

function ActionEntry({
  a,
  i,
  label,
}: {
  a: UiAction;
  i: number;
  label: string;
}) {
  const tag =
    a.decision === "blocked"
      ? "BLOCKED"
      : a.decision === "error"
        ? "REJECTED"
        : a.kind === "read"
          ? "READ"
          : "EXECUTED";
  return (
    <div className={`agent-item ${a.decision}`} data-i={i}>
      <div className="between">
        <span className="mono">{a.tool}()</span>
        <span
          className={`badge ${a.decision === "blocked" ? "red" : a.decision === "error" ? "peach" : "neutral"}`}
        >
          {a.decision === "blocked" && <Icon name="lock" />}
          {tag}
        </span>
      </div>
      <p>
        {a.decision === "allowed"
          ? a.kind === "read"
            ? "Read only."
            : a.changed
              ? `${plural(a.changed, label)} changed.`
              : "Case record updated."
          : (REASON_LABEL[a.reason ?? ""] ?? a.reason)}
      </p>
    </div>
  );
}

function SayEntry({ m, i, agent }: { m: UiMessage; i: number; agent: string }) {
  return (
    <div className="agent-item model" data-i={i}>
      <div className="between">
        <span className="mono">{agent}</span>
        <span className="badge neutral">NOTE</span>
      </div>
      {m.text && <p>{m.text}</p>}
    </div>
  );
}

function LiveEntry({
  m,
  i,
  model,
}: {
  m: UiMessage;
  i: number;
  model: string;
}) {
  if (m.role === "error")
    return (
      <div className="agent-item blocked" data-i={i}>
        <div className="between">
          <span className="mono">{model}</span>
          <span className="badge red">STOPPED</span>
        </div>
        <p>{m.text}</p>
      </div>
    );
  if (m.role === "tool") {
    const r = toolResult(m.text);
    return (
      <div className={`agent-item ${r.blocked ? "blocked" : ""}`} data-i={i}>
        <div className="between">
          <span className="mono">ArchOS gateway</span>
          <span
            className={`badge ${r.blocked ? "red" : r.label === "REJECTED" ? "peach" : r.label === "EXECUTED" ? "green" : "neutral"}`}
          >
            {r.blocked && <Icon name="lock" />}
            {r.label}
          </span>
        </div>
        <p>{r.detail}</p>
      </div>
    );
  }
  return (
    <div className="agent-item model" data-i={i}>
      <div className="between">
        <span className="mono">{model}</span>
        <span className="badge purple">TURN</span>
      </div>
      {m.reasoning && <p className="muted">{m.reasoning}</p>}
      {m.text && <p>{m.text}</p>}
      {m.toolCalls.map((c) => (
        <p key={c.id} className="mono">
          {c.name}({c.args})
        </p>
      ))}
    </div>
  );
}

function CaseInputs({ c }: { c: UiCase }) {
  const x = c.extraction;
  const k = c.constraints;
  if (!c.cancellationText && !c.customerText && !x) return null;
  return (
    <div className="extraction">
      <div className="between">
        <h3>What the agent was told</h3>
        {x && (
          <span className={`badge ${x.source === "live" ? "green" : "peach"}`}>
            <i />
            {x.source === "live"
              ? `Live, ${x.model ?? "model"}`
              : `Fallback values: ${x.reason ?? "no reason recorded"}`}
          </span>
        )}
      </div>
      {c.cancellationText && (
        <blockquote className="quote">
          <span className="eyebrow">Provider</span>
          {c.cancellationText}
        </blockquote>
      )}
      {c.customerText && (
        <blockquote className="quote">
          <span className="eyebrow">{c.booking.customer}</span>
          {c.customerText}
        </blockquote>
      )}
      {k && (
        <dl className="facts">
          <div>
            <dt>Done by</dt>
            <dd>{when(k.doneBy)}</dd>
          </div>
          <div>
            <dt>Two movers</dt>
            <dd>{k.twoMovers ? "Required" : "No"}</dd>
          </div>
          <div>
            <dt>Luton van</dt>
            <dd>{k.luton ? "Required" : "No"}</dd>
          </div>
          <div>
            <dt>Most the customer pays</dt>
            <dd>{money(k.maxPricePence)}</dd>
          </div>
          <div>
            <dt>Same time</dt>
            <dd>{k.preferSameTime ? "Preferred" : "No preference"}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>{k.notes || "None"}</dd>
          </div>
        </dl>
      )}
      {x?.raw && (
        <details className="technical">
          <summary>Model output</summary>
          <pre className="raw">{x.raw}</pre>
        </details>
      )}
    </div>
  );
}

export function AgentConsole() {
  const { state, busy } = useWorkspace();
  const list = useRef<HTMLDivElement>(null);
  const seen = useRef(0);
  const size = (state?.actions.length ?? 0) + (state?.messages.length ?? 0);
  const modelWorking =
    busy &&
    state?.demo.source === "live" &&
    state.demo.steps[state.demo.step + 1] === "agent";

  useGSAP(
    () => {
      const all = Array.from(
        list.current?.querySelectorAll<HTMLElement>("[data-i]") ?? [],
      );
      const fresh = all.filter((n) => Number(n.dataset.i) >= seen.current);
      if (fresh.length)
        gsap.from(fresh, { y: 10, autoAlpha: 0, duration: 0.3, stagger: 0.06 });
      const blocked = fresh.filter((n) => n.classList.contains("blocked"));
      if (blocked.length)
        gsap.fromTo(
          blocked,
          { x: -8 },
          { x: 0, duration: 0.6, delay: 0.2, ease: "elastic.out(1, 0.3)" },
        );
      seen.current = all.length;
      if (fresh.length || modelWorking)
        list.current?.scrollTo({
          top: list.current.scrollHeight,
          behavior: "smooth",
        });
    },
    { scope: list, dependencies: [size, modelWorking] },
  );

  if (!state) return null;
  const live = state.demo.source === "live";
  const agent = state.scenario.agentName;
  const tokens = state.messages.reduce(
    (n, m) => n + (m.usage ? m.usage.prompt + m.usage.completion : 0),
    0,
  );
  // Notes and gateway calls read as one story when merged by time.
  const entries: Entry[] = live
    ? state.messages.map((m) => ({ at: m.at, m }))
    : [
        ...state.messages
          .filter((m) => m.role !== "tool")
          .map((m) => ({ at: m.at, m })),
        ...state.actions.map((a) => ({ at: a.at, a })),
      ].sort((x, y) => x.at.localeCompare(y.at));

  return (
    <section className="glass padded agent-console">
      <div className="section-heading">
        <h2>Agent console</h2>
        <span className="mono muted agent-meta">
          {live ? `${agent} · ${tokens.toLocaleString("en-GB")} TOKENS` : agent}
        </span>
      </div>
      {state.case && <CaseInputs c={state.case} />}
      <div className="agent-log" ref={list} aria-live="polite">
        {entries.map((e, i) =>
          "a" in e ? (
            <ActionEntry
              key={e.a.operationId}
              a={e.a}
              i={i}
              label={state.scenario.targetLabel}
            />
          ) : live ? (
            <LiveEntry key={`m${e.m.seq}`} m={e.m} i={i} model={agent} />
          ) : (
            <SayEntry key={`m${e.m.seq}`} m={e.m} i={i} agent={agent} />
          ),
        )}
        {!entries.length && !modelWorking && (
          <p className="muted">No calls yet.</p>
        )}
        {modelWorking && (
          <div
            className="typing"
            role="status"
            aria-label="The model is working"
          >
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    </section>
  );
}
