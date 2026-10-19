"use client";

import { useState } from "react";
import type { UiException } from "@/engine/state";
import { when } from "@/lib/format";
import { useWorkspace } from "../WorkspaceProvider";
import { sortExceptions } from "../exceptionHelpers";
import { Icon } from "../Icon";
import { PageHeading } from "../PageHeading";

function ExceptionCard({ e }: { e: UiException }) {
  const { state, busy, act } = useWorkspace();
  const [note, setNote] = useState("");
  const off = busy || Boolean(state?.demo.busy);
  const open = e.status === "open";
  const late = open && e.overdue;
  const run = (what: "refund" | "retry") =>
    void act({ action: "exception", exceptionId: e.exceptionId, do: what });
  const id = `owner-${e.exceptionId}`;
  const noteId = `note-${e.exceptionId}`;
  return (
    <article
      className={`glass exception-card ${open ? "" : "closed"}`}
      aria-label={`Exception for ${e.caseId ?? e.target ?? "this case"}`}
    >
      <div className="between">
        <h3>{e.reason}</h3>
        <span className={`badge ${open ? "peach" : "green"}`}>
          <i />
          {open ? "Open" : "Closed"}
        </span>
      </div>
      <dl className="mini-facts exception-facts">
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
          <dd>
            {when(e.dueAt)}
            {late && (
              <span className="badge peach">
                <i />
                Overdue
              </span>
            )}
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
          <div>
            <label className="form-label" htmlFor={id}>
              Accountable owner
            </label>
            <select
              id={id}
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
              {[
                ...new Set([
                  e.owner,
                  state?.operator ?? e.owner,
                  ...(state?.exceptions.map((x) => x.owner) ?? []),
                ]),
              ].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          {(e.action === "refund" || e.action === "retry") && (
            <button
              className="btn primary small"
              disabled={off}
              onClick={() => run(e.action as "refund" | "retry")}
            >
              <Icon name={e.action === "refund" ? "refund" : "reset"} />{" "}
              {e.action === "refund" ? "Refund now" : "Retry"}
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
            <div>
              <label className="form-label" htmlFor={noteId}>
                Closing note
              </label>
              <input
                id={noteId}
                required
                maxLength={300}
                placeholder="Required to close"
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
              />
            </div>
            <button
              className="btn soft small"
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
  const { state } = useWorkspace();
  if (!state) return null;
  const list = sortExceptions(state.exceptions);
  const open = list.filter((e) => e.status === "open").length;
  return (
    <>
      <PageHeading
        eyebrow="EVERY CASE HAS AN OWNER"
        title="Nothing slips through."
        subtitle="ArchOS never resolves these on its own. Each one has an owner, a next action and a due time."
        actions={
          <span className={`badge ${open ? "peach" : "green"}`}>
            <i />
            {open} open
          </span>
        }
      />
      {list.length ? (
        <div className="exception-list">
          {list.map((e) => (
            <ExceptionCard key={e.exceptionId} e={e} />
          ))}
        </div>
      ) : (
        <section className="glass padded empty-state">
          <Icon name="shield" />
          <h2>No exceptions</h2>
          <p>Every case stayed within your rules.</p>
        </section>
      )}
    </>
  );
}
