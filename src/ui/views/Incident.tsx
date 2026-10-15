"use client";

import Link from "next/link";
import { useState } from "react";
import { money } from "@/lib/format";
import { AffectedTable } from "../AffectedTable";
import { AgentConsole } from "../AgentConsole";
import { Containment } from "../Containment";
import { CountUp } from "../CountUp";
import { useDemo } from "../DemoProvider";
import { ApprovalDialog, ResumeDialog } from "../dialogs";
import { Icon } from "../Icon";
import { IncidentBudget } from "../IncidentBudget";
import { hasOpenException, type ToneClass } from "../labels";
import { Metrics } from "../Metrics";
import { RecordGrid } from "../RecordGrid";
import { ScopePanel } from "../ScopePanel";
import { SwitchScene } from "../SwitchScene";
import { Walkthrough } from "../Walkthrough";

type Dialog = "approve" | "resume" | null;

function ValueTiles() {
  const { state } = useDemo();
  const v = state?.incident?.values;
  if (!v) return null;
  const tiles: [string, number, string, ToneClass][] = [
    ["Booking value at risk", v.atRiskPence, "Value at risk, not loss", "red"],
    ["Restored", v.restoredPence, "Original bookings back in place", "green"],
    ["Replaced", v.replacedPence, "Secured, service pending", "green"],
    ["Unresolved", v.unresolvedPence, "With a named owner", "amber"],
  ];
  return (
    <div className="metrics wide-panel">
      {tiles.map(([label, pence, note, tone]) => (
        <div className="metric" key={label}>
          <div className="metric-label">{label}</div>
          <div className={`metric-value ${pence ? tone : ""}`}>
            <CountUp value={pence} format={money} />
          </div>
          <div className="metric-note">{note}</div>
        </div>
      ))}
    </div>
  );
}

export function IncidentView() {
  const { state } = useDemo();
  const [dialog, setDialog] = useState<Dialog>(null);
  if (!state) return null;
  if (state.demo.scenario !== "bulk-cancel")
    return <SwitchScene scenario="bulk-cancel" />;
  const close = () => setDialog(null);
  const s = state.scenario;
  return (
    <>
      <Walkthrough onReview={() => setDialog("approve")} />
      <div className="focus-row">
        <section className="panel focus-records">
          <h2>
            {state.records.length} {s.targetLabel}s{" "}
            <span>· each square is one {s.targetLabel}</span>
          </h2>
          <RecordGrid />
        </section>
        <Metrics />
      </div>
      <ValueTiles />
      <div className="incident-grid">
        <div className="incident-side">
          <section className="panel">
            <ScopePanel />
            <div className="table-heading between">
              <h2>Affected bookings</h2>
              {hasOpenException(state.exceptions) && (
                <Link className="text-btn" href="/exceptions">
                  Open exceptions <Icon name="arrow" />
                </Link>
              )}
            </div>
            <AffectedTable />
          </section>
          <AgentConsole />
        </div>
        <div className="incident-side">
          <Containment onResume={() => setDialog("resume")} />
          <IncidentBudget />
        </div>
      </div>
      <ApprovalDialog open={dialog === "approve"} onClose={close} />
      <ResumeDialog open={dialog === "resume"} onClose={close} />
    </>
  );
}
