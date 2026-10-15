"use client";

import { clock, money } from "@/lib/format";
import { useDemo } from "../DemoProvider";
import { Icon } from "../Icon";
import { INCIDENT_LABEL, LADDER_LABEL, LADDER_TONE } from "../labels";

export function HistoryView() {
  const { state, notify } = useDemo();
  if (!state) return null;
  const { incident, recovery, scenario: s } = state;
  const c = state.case;
  const events = [...state.audit].reverse();
  const exportAudit = () => {
    const data = {
      product: "ArchOS",
      fictional: true,
      stripe: "test mode",
      exportedAt: new Date().toISOString(),
      scenario: s.name,
      demo: state.demo,
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
    a.download = `archos-${state.demo.runId}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Audit trail exported.");
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
            `${state.journal.length} entries, preview only, not posted to Briefcase`,
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
      <section className="panel">
        <div className="panel-head between">
          <div className="flex">
            <h2>Audit trail</h2>
            <span className="badge">{events.length} events</span>
          </div>
          <button className="btn ghost small" onClick={exportAudit}>
            <Icon name="download" /> Export JSON
          </button>
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
              {events.length ? (
                events.map((e) => (
                  <tr key={e.seq}>
                    <td className="mono muted">{e.seq}</td>
                    <td className="mono muted">{clock(e.at)}</td>
                    <td>
                      {e.action}
                      <span className="minor">{e.detail}</span>
                    </td>
                    <td>
                      <span className="audit-tag">{e.decision}</span>
                    </td>
                    <td>{e.actor}</td>
                    <td className="mono muted">{e.operationId ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: 45,
                      textAlign: "center",
                      color: "var(--muted)",
                    }}
                  >
                    No events yet. Start the walkthrough.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="audit-note flex">
          <Icon name="lock" /> Append-only: events get a sequence number and are
          never updated. Reset starts a new run. Showing the latest 200.
        </div>
      </section>
      {showReport && report.length > 0 && (
        <section className="panel wide-panel">
          <div className="panel-head between">
            <h2>{incident ? "Verification report" : "Case report"}</h2>
            <span className={`badge ${badgeTone}`}>
              <i className="dot" />
              {badgeText}
            </span>
          </div>
          <div className="agent-detail">
            <div className="detail-list">
              {report.map(([k, v]) => (
                <div className="detail-row" key={k}>
                  <span className="muted">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
