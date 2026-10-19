"use client";

import { money, when } from "@/lib/format";
import { CountUp } from "./CountUp";
import { StatCard } from "./StatCard";
import { useWorkspace } from "./WorkspaceProvider";
import { laneCounts } from "./incidentHelpers";

const count = (v: number) => <CountUp value={v} format={String} />;

export function Metrics() {
  const { state } = useWorkspace();
  if (!state?.incident) return null;
  const { metrics: m, records, incident: inc, exceptions } = state;
  const lanes = laneCounts(records);
  const done = state.demo.status === "done";
  const open = exceptions.filter((e) => e.status === "open");
  return (
    <div className="stats-grid incident-stats">
      <StatCard
        icon="inbox"
        tone="purple"
        title="Unauthorised changes"
        value={count(m.outOfScope)}
        note={`${money(inc.values.atRiskPence)} booking value at risk`}
      />
      <StatCard
        icon="check"
        tone="mint"
        title={done ? "Original bookings restored" : "Safe to restore"}
        value={count(done ? lanes.restored : m.restore)}
        note={
          done
            ? "Restored, delivery not confirmed"
            : "Original capacity still available"
        }
      />
      <StatCard
        icon="people"
        tone="blue"
        title={done ? "Replacements secured" : "Replacement options"}
        value={count(done ? m.replaced : m.manual)}
        note={
          done
            ? "Rebooked, delivery pending"
            : "Placed only where a slot is free"
        }
      />
      <StatCard
        icon="clock"
        tone="peach"
        title="Needs a person"
        value={count(open.length)}
        note={
          open[0]
            ? `${open[0].owner} · due ${when(open[0].dueAt)}`
            : "Nothing waiting on a person"
        }
      />
    </div>
  );
}
