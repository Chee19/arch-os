"use client";

import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";

export function ScopePanel() {
  const { state } = useDemo();
  const task = state?.scenario.task;
  if (!state || !task) return null;
  const { scenario: s, metrics: m } = state;
  return (
    <div className="scope">
      <div className="scope-box">
        <div className="eyebrow">Authorised task · {task.id}</div>
        <p>
          {task.approvedTargets.length} {s.targetLabel}s
        </p>
        <div className="mono">{task.approvedTargets.join(", ")}</div>
      </div>
      <div className="scope-arrow">
        <Icon name="arrow" />
      </div>
      <div className={`scope-box ${m.outOfScope ? "bad" : ""}`}>
        <div className="eyebrow">Observed changes</div>
        <p>
          {m.mutated} {s.targetLabel}s changed
        </p>
        <div className="mono">
          {m.outOfScope
            ? `${m.outOfScope} outside the task`
            : "All inside the task"}
        </div>
      </div>
    </div>
  );
}
