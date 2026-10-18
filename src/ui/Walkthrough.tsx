"use client";

import Link from "next/link";
import { useState } from "react";
import type { LadderState } from "@/engine/ladder";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";
import {
  canSubmit,
  hasOpenException,
  LADDER_LABEL,
  OUTCOME_LABEL,
  SCENE_INTRO,
  STATUS_LABEL,
  STATUS_TONE,
} from "./labels";

export function Walkthrough({ onReview }: { onReview?: () => void }) {
  const { state, busy, act } = useDemo();
  const [inspected, setInspected] = useState<number | null>(null);
  if (!state) return null;
  const { demo, steps } = state;
  const current = demo.step;
  const shown = inspected ?? current;
  const step = steps[shown];
  const working = busy || demo.busy;
  const submit = canSubmit(working, demo.status);
  const waitingCustomer = demo.status === "awaiting_customer";
  const waitingApproval = demo.status === "awaiting_approval";
  const finished = demo.status === "done";
  const history = inspected !== null && inspected !== current;
  const nextStep = steps[current + 1];
  const next = () => {
    setInspected(null);
    void act({ action: "advance", step: current });
  };
  const ref =
    state.case?.caseId ??
    state.incident?.incidentId ??
    state.scenario.task?.id ??
    "";
  const eyebrow = !step
    ? `THE SCENE / ${state.scenario.name.toUpperCase()}`
    : `${history ? "PAST STEP" : STATUS_LABEL[demo.status].toUpperCase()} / ${step.actor}`;
  const hint = history
    ? "Past explanation. Current records are unchanged."
    : current < 0
      ? "Advance at your own pace."
      : waitingCustomer
        ? "Accept or decline in the Customer response panel (Messages tab)."
        : waitingApproval
          ? "Nothing is restored until you approve."
          : finished
            ? "Reset to run the scene again."
            : `Next: ${nextStep?.label ?? ""}`;

  return (
    <section className="walkthrough panel" aria-label="Case steps">
      <div className="walkthrough-header between">
        <div className="flex">
          <span className={`badge ${STATUS_TONE[demo.status]}`}>
            <i className="dot" />
            {STATUS_LABEL[demo.status]}
          </span>
          <span className="mono muted">{ref}</span>
        </div>
        <span className="mono muted">
          {current < 0 ? "READY" : `STEP ${current + 1} OF ${steps.length}`}
        </span>
      </div>
      <div className="demo-steps" aria-label="Steps">
        {steps.map((st, i) => (
          <button
            key={st.key}
            disabled={i > current}
            className={`demo-step ${i === shown ? "selected" : ""} ${i < current || (i === current && finished) ? "complete" : ""}`}
            aria-current={i === shown ? "step" : undefined}
            onClick={() => setInspected(i === current ? null : i)}
          >
            <span>
              {i < current ? (
                <Icon name="check" />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            {st.label}
          </button>
        ))}
      </div>
      {demo.error && !working && (
        <div className="error-banner" role="alert">
          <Icon name="warning" /> {demo.error}
          <button
            className="btn ghost small"
            disabled={submit !== "advance"}
            onClick={next}
          >
            Retry step
          </button>
        </div>
      )}
      <div className="demo-body">
        <div className="demo-explanation" aria-live="polite" aria-atomic="true">
          <div className="eyebrow">{eyebrow}</div>
          <h2>{step?.title ?? state.scenario.name}</h2>
          {step ? (
            <>
              {step.result && <p className="demo-result">{step.result}</p>}
              <p className="demo-check">
                <span>CHECK / ACTION</span>
                {step.check}
              </p>
            </>
          ) : (
            <p className="demo-intro">{SCENE_INTRO[demo.scenario]}</p>
          )}
          {finished && demo.outcome && (
            <p className="demo-input">
              <span>OUTCOME</span>
              {OUTCOME_LABEL[demo.outcome] ??
                LADDER_LABEL[demo.outcome as LadderState] ??
                demo.outcome}
            </p>
          )}
        </div>
        <div className="demo-actions">
          <div className="flex">
            {history ? (
              <button
                className="btn ghost small"
                onClick={() => setInspected(null)}
              >
                Return to current step
              </button>
            ) : waitingCustomer ? (
              <button className="btn primary small" disabled>
                Waiting for customer
              </button>
            ) : waitingApproval ? (
              <button
                className="btn primary small"
                disabled={submit !== "approve" || !onReview}
                onClick={onReview}
              >
                Review <Icon name="arrow" />
              </button>
            ) : finished ? (
              <>
                {hasOpenException(state.exceptions) && (
                  <Link className="btn primary small" href="/exceptions">
                    Review open exceptions <Icon name="arrow" />
                  </Link>
                )}
                <button
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => void act({ action: "reset" })}
                >
                  Run again
                </button>
              </>
            ) : (
              <button
                className={`btn primary small ${working ? "loading" : ""}`}
                disabled={submit !== "advance"}
                onClick={next}
              >
                {working ? "Working" : current < 0 ? "Start" : "Next step"}{" "}
                <Icon name="arrow" />
              </button>
            )}
          </div>
          <p>{hint}</p>
        </div>
      </div>
    </section>
  );
}
