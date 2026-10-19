"use client";

import Link from "next/link";
import { money } from "@/lib/format";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";
import { hasOpenException } from "./labels";
import { nextAction } from "./nextStep";

export function NextButton({ onApprove }: { onApprove: () => void }) {
  const { state, busy, proceed } = useWorkspace();
  if (!state) return null;
  const next = nextAction(state);
  if (next.kind === "done")
    return (
      <Link
        className="btn primary"
        href={hasOpenException(state.exceptions) ? "/exceptions" : "/history"}
      >
        {next.label} <Icon name="arrow" />
      </Link>
    );
  return (
    <>
      {state.demo.error && (
        <p className="inline-error" role="alert">
          {state.demo.error}
        </p>
      )}
      <button
        className="btn primary"
        disabled={busy}
        onClick={() =>
          next.kind === "approve"
            ? onApprove()
            : void proceed({ action: "advance", step: state.demo.step })
        }
      >
        {busy ? "Working…" : next.label} <Icon name="arrow" />
      </button>
    </>
  );
}

export function IncidentBudget({ onApprove }: { onApprove: () => void }) {
  const { state } = useWorkspace();
  const inc = state?.incident;
  if (!state || !inc) return null;
  const caps = (state.recovery?.items ?? []).flatMap((i) =>
    i.replacement ? [i.replacement.incentivePence] : [],
  );
  const perBooking = caps.length ? Math.max(...caps) : null;
  const pct = inc.budgetPence
    ? Math.min(100, (inc.committedPence / inc.budgetPence) * 100)
    : 0;
  const label = state.demo.status === "done" ? "Committed" : "Reserved";
  return (
    <section className="glass next-step">
      <span className="eyebrow">INCIDENT BUDGET</span>
      <div className="budget-amount">
        {money(inc.committedPence)}
        <span> / {money(inc.budgetPence)}</span>
      </div>
      <p>
        {label} for replacement incentives.{" "}
        {money(Math.max(0, inc.budgetPence - inc.committedPence))} remains
        available.
      </p>
      <div
        className="budget-track"
        role="meter"
        aria-label={`${money(inc.committedPence)} of ${money(inc.budgetPence)} used`}
        aria-valuemin={0}
        aria-valuemax={inc.budgetPence}
        aria-valuenow={inc.committedPence}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="safe-note">
        <Icon name="shield" />
        {perBooking !== null && `Per-booking incentive ${money(perBooking)}. `}
        Total incident cap {money(inc.budgetPence)}.
      </div>
      <NextButton onApprove={onApprove} />
    </section>
  );
}
