"use client";

import Link from "next/link";
import { useState } from "react";
import { plural, when } from "@/lib/format";
import { AffectedTable } from "../AffectedTable";
import { AgentConsole } from "../AgentConsole";
import { Containment } from "../Containment";
import { Icon } from "../Icon";
import { IncidentBudget, NextButton } from "../IncidentBudget";
import { isSuspended, laneCounts } from "../incidentHelpers";
import { Metrics } from "../Metrics";
import { PageHeading } from "../PageHeading";
import { RecordGrid } from "../RecordGrid";
import { ScopePanel } from "../ScopePanel";
import { SwitchScene } from "../SwitchScene";
import { useWorkspace } from "../WorkspaceProvider";
import { ApprovalDialog, ResumeDialog } from "../dialogs";

type Dialog = "approve" | "resume" | null;

function Brief() {
  const { state, busy } = useWorkspace();
  const task = state?.scenario.task;
  if (!state || !task) return null;
  const s = state.scenario;
  return (
    <>
      <PageHeading
        eyebrow={`${task.id} · ${s.agentName}`}
        title="A task waiting to be handed over."
        subtitle={`${s.agentName} is approved for ${plural(task.approvedTargets.length, s.targetLabel)}.`}
      />
      <div className="case-grid">
        <section className="glass padded">
          <div className="section-heading">
            <div>
              <h2>The agent&apos;s task</h2>
              <p>Approved by {task.approvedBy}</p>
            </div>
          </div>
          <p className="task-text">{task.text}</p>
          <dl className="mini-facts">
            <div>
              <dt>Approved {s.targetLabel}s</dt>
              <dd className="mono">{task.approvedTargets.join(", ")}</dd>
            </div>
            <div>
              <dt>Systems</dt>
              <dd>{s.systemsLabel}</dd>
            </div>
          </dl>
        </section>
        <aside>
          <section className="glass next-step">
            <span className="eyebrow">YOUR NEXT STEP</span>
            <h3>
              {busy
                ? `${s.agentName} is working on the task.`
                : `Hand the task to ${s.agentName}.`}
            </h3>
            <p>
              Every change the agent makes goes through the ArchOS gateway and
              is checked against this task.
            </p>
            <NextButton onApprove={() => undefined} />
          </section>
        </aside>
      </div>
    </>
  );
}

export function IncidentView() {
  const { state } = useWorkspace();
  const [dialog, setDialog] = useState<Dialog>(null);
  if (!state) return null;
  if (state.demo.scenario !== "bulk-cancel")
    return <SwitchScene scenario="bulk-cancel" />;
  const inc = state.incident;
  if (!inc || state.demo.status === "ready") return <Brief />;

  const close = () => setDialog(null);
  const { metrics: m, scenario: s, exceptions } = state;
  const approved = s.task?.approvedTargets.length ?? 0;
  const suspended = isSuspended(state);
  const done = state.demo.status === "done";
  const lanes = laneCounts(state.records);
  const restoreDone = m.restore > 0 && lanes.restored >= m.restore;
  const open = exceptions.filter((e) => e.status === "open");
  const total = m.restore + m.manual;
  return (
    <div className="incident-page">
      <PageHeading
        eyebrow={`${inc.incidentId} · ${s.agentName}`}
        title="A small instruction. A bigger mistake."
        subtitle={`${s.agentName} changed ${plural(m.mutated, s.targetLabel)}. Only ${approved} ${approved === 1 ? "was" : "were"} authorised.`}
        actions={
          suspended && (
            <span className="badge peach">
              <i />
              Agent write access paused
            </span>
          )
        }
      />
      {suspended && (
        <div className="incident-banner">
          <Icon name="shield" />
          <div>
            <strong>The mistake is contained.</strong>
            <p>
              {plural(m.blocked, "further call")} blocked at the gateway. Read
              access remains available.
            </p>
          </div>
        </div>
      )}
      <Metrics />
      <div className="case-grid">
        <section className="glass padded">
          <div className="section-heading">
            <div>
              <h2>A plan with clear boundaries.</h2>
              <p>
                {plural(approved, "authorised cancellation")} stay
                {approved === 1 ? "s" : ""} cancelled.
              </p>
            </div>
            <span className={`badge ${done ? "green" : "purple"}`}>
              <i />
              {done ? "Approved" : "Awaiting approval"}
            </span>
          </div>
          <div className="plan-row">
            <span className="step-number mint">1</span>
            <div>
              <h3>
                Restore {m.restore} original {s.targetLabel}s
              </h3>
              <p>
                Same provider, slot and price. No other customer&apos;s booking
                is displaced.
              </p>
            </div>
            {restoreDone && <Icon name="check" />}
          </div>
          <div className="plan-row">
            <span className="step-number blue">2</span>
            <div>
              <h3>
                {done
                  ? `Offer ${m.replaced} replacements`
                  : `Offer up to ${m.manual} replacements`}{" "}
                within the incident budget
              </h3>
              <p>
                Earliest service time first. Replacement is only used where a
                qualified slot is free.
              </p>
            </div>
            {done && m.replaced > 0 && <Icon name="check" />}
          </div>
          <div className="plan-row">
            <span className="step-number apricot">3</span>
            <div>
              <h3>
                {done
                  ? `Give ${plural(m.unresolved, "booking")} a named owner`
                  : "Give any that cannot be placed a named owner"}
              </h3>
              <p>
                A person owns each remedy and is shown on the exceptions page.
              </p>
            </div>
            {done && m.unresolved > 0 && <Icon name="check" />}
          </div>
          <div className="callout">
            <strong>
              {done
                ? `${lanes.restored} + ${m.replaced} + ${m.unresolved} = ${lanes.restored + m.replaced + m.unresolved}`
                : `${m.restore} + ${m.manual} = ${total}`}
            </strong>
            <p>Restoration and rebooking do not prove service delivery.</p>
          </div>
        </section>
        <aside>
          <IncidentBudget onApprove={() => setDialog("approve")} />
          <section className="glass padded mini-facts">
            <h3>Still needs a person</h3>
            {open.length ? (
              open.slice(0, 3).map((e) => (
                <p key={e.exceptionId}>
                  <strong>
                    {e.owner} · {e.target}
                  </strong>
                  <br />
                  {e.nextAction}, due {when(e.dueAt)}
                </p>
              ))
            ) : (
              <p>Nothing is waiting on a person.</p>
            )}
            <Link className="btn soft" href="/exceptions">
              Open exceptions <Icon name="arrow" />
            </Link>
          </section>
        </aside>
      </div>
      <section className="glass padded incident-section">
        <div className="section-heading">
          <div>
            <h2>Affected bookings</h2>
            <p>
              {plural(state.records.length, s.targetLabel)}. Each square is one.
            </p>
          </div>
        </div>
        <RecordGrid />
        <ScopePanel />
        <AffectedTable />
      </section>
      <section className="glass padded incident-section">
        <div className="section-heading">
          <div>
            <h2>Agent activity</h2>
            <p>Every call the agent made, as the gateway saw it.</p>
          </div>
        </div>
        <AgentConsole />
      </section>
      <Containment onResume={() => setDialog("resume")} />
      <ApprovalDialog open={dialog === "approve"} onClose={close} />
      <ResumeDialog open={dialog === "resume"} onClose={close} />
    </div>
  );
}
