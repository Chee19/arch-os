"use client";

import { clock, money } from "@/lib/format";
import { useWorkspace } from "../WorkspaceProvider";
import { Icon } from "../Icon";
import { PageHeading } from "../PageHeading";
import { Timeline } from "../Timeline";
import {
  INCIDENT_LABEL,
  LADDER_LABEL,
  LADDER_TONE,
  decisionTone,
  type ToneClass,
} from "../labels";

const BADGE: Record<ToneClass, string> = {
  "": "neutral",
  green: "green",
  amber: "peach",
  red: "red",
};

export function HistoryView() {
  const { state, notify } = useWorkspace();
  if (!state) return null;
  const { incident, recovery, scenario: s } = state;
  const c = state.case;
  const events = [...state.audit].reverse();
  const exportAudit = () => {
    const data = {
      product: "ArchOS",
      exportedAt: new Date().toISOString(),
      type: s.name,
      workflow: {
        status: state.demo.status,
        outcome: state.demo.outcome,
        stepsCompleted: state.demo.step,
      },
      task: s.task,
      case: c,
      payments: state.payments,
      journal: state.journal,
      exceptions: state.exceptions,
      incident,
      recovery,
      audit: events,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `archos-activity-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Activity report downloaded.");
  };
  const report: [string, string][] = incident
    ? [
        [
          "Original action",
          s.task
            ? `${state.metrics.mutated} ${s.targetLabel}s changed, ${s.task.approvedTargets.length} authorised`
            : `${state.metrics.mutated} ${s.targetLabel}s changed`,
        ],
        ["Approved by", recovery?.approvedBy ?? "-"],
        [
          "Recovered and verified",
          `${incident.verified.length}, checked against ${s.systemsLabel}`,
        ],
        ["Still at risk", money(incident.exposureRemaining ?? 0)],
        ["Unresolved", incident.unresolved.join(" · ") || "None"],
        ["Approved records untouched", incident.approvedIntact ? "Yes" : "No"],
      ]
    : c
      ? [
          ["Case", `${c.caseId} for ${c.bookingId}`],
          [
            "Ladder",
            `${LADDER_LABEL[c.ladder.state]}${c.ladder.chip ? `, ${c.ladder.chip}` : ""}`,
          ],
          [
            "Stripe objects",
            state.payments
              .flatMap((p) => (p.stripeId ? [p.stripeId] : []))
              .join(" · ") || "None yet",
          ],
          ["Original provider paid", c.originalProviderPaid ? "Yes" : "No"],
          [
            "Journal",
            `${state.journal.length} entries, ready to post to Briefcase`,
          ],
        ]
      : [];
  const showReport = incident
    ? incident.exposureRemaining !== null
    : c !== null;
  const [badgeTone, badgeText] = incident
    ? [
        incident.status === "resolved" ? "green" : "amber",
        INCIDENT_LABEL[incident.status],
      ]
    : c
      ? [LADDER_TONE[c.ladder.state], LADDER_LABEL[c.ladder.state]]
      : ["", ""];
  return (
    <>
      <PageHeading
        eyebrow="THE FULL STORY"
        title="A trail you can follow."
        subtitle="Decisions, blocked options and open obligations, all in one place."
        actions={
          <button className="btn soft" onClick={exportAudit}>
            <Icon name="download" /> Download report
          </button>
        }
      />
      {events.length ? (
        <>
          <section className="glass padded">
            <Timeline
              events={events.map((e) => ({
                key: e.seq,
                title: e.detail,
                time: `${clock(e.at)} · ${e.actor}`,
              }))}
            />
          </section>
          <section className="glass padded activity-log">
            <div className="section-heading">
              <h2>
                Detailed log <span className="count">{events.length}</span>
              </h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Action / evidence</th>
                    <th>Decision</th>
                    <th>Actor</th>
                    <th>Operation</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.seq}>
                      <td className="mono muted">{e.seq}</td>
                      <td className="mono muted">{clock(e.at)}</td>
                      <td>
                        {e.action}
                        <span className="minor">{e.detail}</span>
                      </td>
                      <td>
                        <span
                          className={`badge ${BADGE[decisionTone(e.decision)]}`}
                        >
                          <i />
                          {e.decision}
                        </span>
                      </td>
                      <td>{e.actor}</td>
                      <td className="mono muted">{e.operationId ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="audit-note">
              <Icon name="lock" /> Append-only: events are numbered and never
              edited. Showing the latest 200.
            </p>
          </section>
        </>
      ) : (
        <section className="glass padded empty-state">
          <Icon name="shield" />
          <h2>No activity yet</h2>
          <p>Decisions and changes will appear here as they happen.</p>
        </section>
      )}
      {showReport && report.length > 0 && (
        <section className="glass padded report-card">
          <div className="section-heading">
            <h2>{incident ? "Verification report" : "Case report"}</h2>
            <span className={`badge ${BADGE[badgeTone as ToneClass]}`}>
              <i />
              {badgeText}
            </span>
          </div>
          <dl className="mini-facts report-facts">
            {report.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}
