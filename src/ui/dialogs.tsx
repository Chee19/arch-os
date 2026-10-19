"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";
import { canSubmit, hasOpenException } from "./labels";
import { Modal } from "./Modal";

export function ApprovalDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, busy, proceed } = useWorkspace();
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
    void proceed({ action: "approve", confirmed: true });
  };
  return (
    <Modal open={open} onClose={close} labelledBy="approve-title">
      <div className="dialog-head">
        <div className="between">
          <span className="eyebrow">
            Recovery plan · {incident?.incidentId}
          </span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <h2 id="approve-title">Approve this recovery plan?</h2>
      </div>
      <div className="dialog-body">
        <p>
          As {state.operator}, you authorise the following. Each booking is
          re-checked before it is written.
        </p>
        <ul className="incident-approvals">
          <li>
            <strong>Restore {m.restore}</strong> original {s.targetLabel}s with
            valid capacity.
          </li>
          <li>
            <strong>Reserve budget</strong> of{" "}
            {money(incident?.budgetPence ?? 0)} for up to {m.manual} replacement
            offers.
          </li>
          <li>
            <strong>Assign an owner</strong> to every {s.targetLabel} that
            cannot be placed.
          </li>
          <li>
            <strong>Preserve {approved.length}</strong> authorised
            cancellations.
          </li>
        </ul>
        <div className="callout">
          <p>
            Approval does not replace customer consent. Replacement bookings
            stay unconfirmed until each customer accepts.
          </p>
        </div>
        <label className="approval-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            I approve this plan as <strong>{state.operator}</strong>.
          </span>
        </label>
      </div>
      <div className="dialog-actions">
        <button className="btn soft" onClick={close}>
          Back to incident
        </button>
        <button
          className="btn primary"
          disabled={!checked || !allowed}
          onClick={approve}
        >
          <Icon name="shield" /> Approve plan
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
  const { state, act } = useWorkspace();
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
        <button className="btn soft" onClick={onClose}>
          Keep contained
        </button>
        <button
          className="btn primary"
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
