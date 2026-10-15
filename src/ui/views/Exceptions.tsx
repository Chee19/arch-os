"use client";

import { useState } from "react";
import type { UiException } from "@/engine/state";
import { when } from "@/lib/format";
import { useDemo } from "../DemoProvider";
import { sortExceptions } from "../exceptionHelpers";
import { Icon } from "../Icon";

const OWNERS = ["Sam Okafor", "Priya Shah"];

function ExceptionCard({ e }: { e: UiException }) {
  const { state, busy, act } = useDemo();
  const [note, setNote] = useState("");
  const off = busy || Boolean(state?.demo.busy);
  const open = e.status === "open";
  const late = open && e.overdue;
  const run = (what: "refund" | "retry") =>
    void act({ action: "exception", exceptionId: e.exceptionId, do: what });
  return (
    <article
      className={`exception-card ${open ? "" : "closed"}`}
      aria-label={`Exception for ${e.caseId ?? e.target ?? "this run"}`}
    >
      <div className="between">
        <h3>{e.reason}</h3>
        <span className={`badge ${open ? "amber" : "green"}`}>
          <i className="dot" />
          {open ? "Open" : "Closed"}
        </span>
      </div>
      <dl className="facts">
        <div>
          <dt>Record</dt>
          <dd className="mono">{e.caseId ?? e.target ?? "-"}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{e.owner}</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{e.nextAction}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd className={late ? "red" : ""}>
            {when(e.dueAt)}
            {late && " · Overdue"}
          </dd>
        </div>
        {e.opId && (
          <div>
            <dt>Payment op</dt>
            <dd className="mono">{e.opId}</dd>
          </div>
        )}
        {e.note && (
          <div>
            <dt>Closing note</dt>
            <dd>{e.note}</dd>
          </div>
        )}
      </dl>
      {open && (
        <div className="exception-actions">
          <label className="field">
            Owner
            <select
              className="mode-select"
              value={e.owner}
              disabled={off}
              onChange={(ev) =>
                void act({
                  action: "assign",
                  exceptionId: e.exceptionId,
                  owner: ev.target.value,
                })
              }
            >
              {[...new Set([e.owner, ...OWNERS])].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          {e.action === "refund" && (
            <button
              className="btn primary small"
              disabled={off}
              onClick={() => run("refund")}
            >
              <Icon name="refund" /> Refund now
            </button>
          )}
          {e.action === "retry" && (
            <button
              className="btn primary small"
              disabled={off}
              onClick={() => run("retry")}
            >
              <Icon name="reset" /> Retry
            </button>
          )}
          <form
            className="close-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              const text = note.trim();
              if (text)
                void act({
                  action: "exception",
                  exceptionId: e.exceptionId,
                  do: "close",
                  note: text,
                });
            }}
          >
            <input
              className="search"
              required
              maxLength={300}
              placeholder="Closing note (required)"
              aria-label="Closing note"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
            <button
              className="btn ghost small"
              type="submit"
              disabled={off || !note.trim()}
            >
              Close
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

export function ExceptionsView() {
  const { state } = useDemo();
  if (!state) return null;
  const list = sortExceptions(state.exceptions);
  const open = list.filter((e) => e.status === "open").length;
  return (
    <section className="panel">
      <div className="panel-head between">
        <h2>Owned exceptions</h2>
        <span className={`badge ${open ? "amber" : "green"}`}>
          <i className="dot" />
          {open} open
        </span>
      </div>
      <div className="panel-body">
        <p className="intro">
          ArchOS never resolves these on its own. Each one has an owner, a next
          action and a due time. Assigning records who owns it; it resolves
          nothing.
        </p>
        {list.length ? (
          list.map((e) => <ExceptionCard key={e.exceptionId} e={e} />)
        ) : (
          <div className="empty-state">
            <Icon name="shield" />
            <h2>No exceptions</h2>
            <p>Every case in this run stayed within policy.</p>
          </div>
        )}
      </div>
    </section>
  );
}
