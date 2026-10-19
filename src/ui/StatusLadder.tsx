"use client";

import { ladderRungs } from "./caseHelpers";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";

const MILESTONES = [
  ["Offered", "A choice, not a commitment"],
  ["Secured", "Both parties agreed"],
  ["Fulfilled", "Delivery evidence required"],
  ["Settled", "Payment obligations verified"],
] as const;

export function StatusLadder() {
  const { state } = useWorkspace();
  const c = state?.case;
  if (!c) return null;
  const { state: ladder } = c.ladder;
  // The first rung (investigating) is not a milestone.
  const rungs = ladderRungs(ladder).slice(1);
  return (
    <div
      className="milestones glass"
      role="group"
      aria-label="Booking progress"
    >
      {MILESTONES.map(([label, note], i) => (
        <div
          key={label}
          className={`milestone ${rungs[i]}`}
          aria-current={rungs[i] === "current" ? "step" : undefined}
        >
          <span>{rungs[i] === "done" ? <Icon name="check" /> : i + 1}</span>
          <div>
            <strong>{label}</strong>
            <small>{note}</small>
            {rungs[i] === "done" && <span className="sr-only"> (done)</span>}
          </div>
        </div>
      ))}
      {ladder === "remedied" && (
        <span className="badge green milestone-badge">
          <i />
          Remedied: full refund
        </span>
      )}
    </div>
  );
}
