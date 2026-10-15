"use client";

import { money } from "@/lib/format";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";

export function IncidentBudget() {
  const { state } = useDemo();
  const inc = state?.incident;
  if (!inc) return null;
  const text = `${money(inc.committedPence)} of ${money(inc.budgetPence)} committed`;
  return (
    <section className="panel budget">
      <div className="between">
        <h2 className="flex">
          <Icon name="card" /> Incident budget
        </h2>
        <span className="mono muted">{inc.incidentId}</span>
      </div>
      <meter
        min={0}
        max={inc.budgetPence}
        value={inc.committedPence}
        aria-label={text}
      />
      <p>{text}</p>
      <p className="muted">
        Last-minute incentives for replacement providers. Invoice-side
        commitments; no payment moves in this scene.
      </p>
    </section>
  );
}
