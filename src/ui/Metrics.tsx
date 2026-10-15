"use client";

import { CountUp } from "./CountUp";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";
import { laneCounts } from "./incidentHelpers";

export function Metrics() {
  const { state } = useDemo();
  if (!state) return null;
  const { metrics: m, records, scenario: s } = state;
  const lanes = laneCounts(records);
  const planned = m.restore + m.manual > 0;
  const shown = (v: number) =>
    planned ? <CountUp value={v} format={String} /> : "-";
  return (
    <div className="metrics">
      <div className="metric">
        <div className="metric-label">
          <Icon name="incident" /> Unauthorised changes
        </div>
        <div className={`metric-value ${m.outOfScope ? "red" : ""}`}>
          <CountUp value={m.outOfScope} format={String} />
          <span className="metric-sub">/ {records.length}</span>
        </div>
        <div className="metric-note">
          {m.outOfScope
            ? `${s.task?.approvedTargets.length ?? 0} were authorised`
            : m.mutated
              ? "All changes inside the task"
              : "No changes yet"}
        </div>
      </div>
      <div className="metric">
        <div className="metric-label">
          <Icon name="reset" /> Restored
        </div>
        <div className={`metric-value ${lanes.restored ? "green" : ""}`}>
          {shown(lanes.restored)}
          {planned && <span className="metric-sub">/ {m.restore}</span>}
        </div>
        <div className="metric-note">Original slot still free</div>
      </div>
      <div className="metric">
        <div className="metric-label">
          <Icon name="handshake" /> Replaced
        </div>
        <div className={`metric-value ${lanes.replaced ? "green" : ""}`}>
          {shown(lanes.replaced)}
        </div>
        <div className="metric-note">
          Client contract clause 4.2 (like-for-like)
        </div>
      </div>
      <div className="metric">
        <div className="metric-label">
          <Icon name="user" /> Exceptions
        </div>
        <div className={`metric-value ${lanes.exception ? "amber" : ""}`}>
          {shown(lanes.exception)}
        </div>
        <div className="metric-note">Each with a named owner</div>
      </div>
    </div>
  );
}
