"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";
import { canSubmit, hasOpenException } from "./labels";
import { Modal } from "./Modal";

const pad = (n: number) => String(n).padStart(2, "0");

export function ApprovalDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, busy, act } = useDemo();
  const [checked, setChecked] = useState(false);
  if (!state) return null;
  const { metrics: m, scenario: s, incident } = state;
  const approved = s.task?.approvedTargets ?? [];
  const allowed =
    canSubmit(busy || state.demo.busy, state.demo.status) === "approve";
  const close = () => {
    setChecked(false);
    onClose();
  };
  const approve = () => {
    close();
    void act({ action: "approve", confirmed: true });
  };
  return (
    <Modal open={open} onClose={close} labelledBy="approve-title">
      <div className="dialog-head">
        <div className="between">
          <span className="eyebrow">
            RECOVERY PLAN / {incident?.incidentId}
          </span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <h2 id="approve-title">Approve {m.restore} restores and the rescue</h2>
      </div>
      <div className="dialog-body">
        <p>
          Each booking is re-checked before it is written. Nothing outside this
          plan changes, and no money moves.
        </p>
        <div className="plan-row">
          <div className="plan-count green">{pad(m.restore)}</div>
          <div>
            <h3>Restore</h3>
            <p>The original slot is still free, so the booking goes back.</p>
          </div>
        </div>
        <div className="plan-row">
          <div className="plan-count amber">{pad(m.manual)}</div>
          <div>
            <h3>Rescue or hand to an owner</h3>
            <p>
              The slot was taken since the cancellation. Free qualified slots
              are allocated within the {money(incident?.budgetPence ?? 0)}{" "}
              incident budget. Anything left gets a named owner.
            </p>
          </div>
        </div>
        <div className="plan-row">
          <div className="plan-count muted">{pad(approved.length)}</div>
          <div>
            <h3>Keep the authorised cancellations</h3>
            <p className="mono">{approved.join(" · ")}</p>
          </div>
        </div>
        <label className="approval-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            I approve this plan as <strong>{state.operator}</strong>,
            Marketplace Operations Lead.
          </span>
        </label>
      </div>
      <div className="dialog-actions">
        <button className="btn ghost" onClick={close}>
          Back to incident
        </button>
        <button
          className="btn primary"
          disabled={!checked || !allowed}
          onClick={approve}
        >
          <Icon name="shield" /> Approve and recover
        </button>
      </div>
    </Modal>
  );
}

export function ResumeDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, act } = useDemo();
  if (!state) return null;
  return (
    <Modal open={open} onClose={onClose} labelledBy="resume-title">
      <div className="dialog-head">
        <span className="eyebrow">AGENT PERMISSION</span>
        <h2 id="resume-title">
          Resume {state.scenario.agentName}&apos;s write access?
        </h2>
      </div>
      <div className="dialog-body">
        <p>
          The agent will be able to change bookings again.
          {hasOpenException(state.exceptions)
            ? " This incident still has open exceptions."
            : ""}
        </p>
      </div>
      <div className="dialog-actions">
        <button className="btn ghost" onClick={onClose}>
          Keep contained
        </button>
        <button
          className="btn"
          onClick={() => {
            onClose();
            void act({ action: "resume" });
          }}
        >
          Resume agent
        </button>
      </div>
    </Modal>
  );
}
