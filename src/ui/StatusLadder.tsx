"use client";

import { LADDER_STEPS, ladderRungs } from "./caseHelpers";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";
import { LADDER_LABEL, LADDER_TONE } from "./labels";

export function StatusLadder() {
  const { state } = useDemo();
  const c = state?.case;
  if (!c) return null;
  const { ladder } = c;
  const rungs = ladderRungs(ladder.state);
  return (
    <section className="panel ladder" aria-label="Case status">
      <div className="panel-head between">
        <h2>Case status</h2>
        <span className={`badge ${LADDER_TONE[ladder.state]}`}>
          <i className="dot" />
          {LADDER_LABEL[ladder.state]}
          {ladder.chip ? `, ${ladder.chip}` : ""}
        </span>
      </div>
      <ol className="workflow">
        {LADDER_STEPS.map((s, i) => (
          <li
            key={s}
            className={`step ${rungs[i] === "todo" ? "" : rungs[i]}`}
            aria-current={rungs[i] === "current" ? "step" : undefined}
          >
            <span className="step-circle">
              {rungs[i] === "done" ? <Icon name="check" /> : i + 1}
            </span>
            {LADDER_LABEL[s]}
            {rungs[i] === "done" && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>
      <div className="ladder-badges">
        {ladder.state === "remedied" && (
          <span className="badge green">
            <i className="dot" />
            Remedied: full refund
          </span>
        )}
        {ladder.exception && (
          <span className="badge red">
            <i className="dot" />
            Exception: {ladder.exception.nextAction} · {ladder.exception.owner}
          </span>
        )}
        {!ladder.exception && ladder.state !== "remedied" && (
          <span className="muted">
            Derived from records and Stripe objects, never stored.
          </span>
        )}
      </div>
    </section>
  );
}
