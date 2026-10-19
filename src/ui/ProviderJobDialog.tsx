"use client";

import { money, when } from "@/lib/format";
import { chosenCandidate, firstName } from "./caseHelpers";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { nextAction } from "./nextStep";
import { useWorkspace } from "./WorkspaceProvider";

const STATUS = {
  investigating: ["Hold requested", "neutral"],
  offered: ["Hold confirmed · awaiting customer", "peach"],
  secured: ["Booking secured", "green"],
  fulfilled: ["Completion reported", "green"],
  settled: ["Payment recorded", "green"],
  remedied: ["Job released", "neutral"],
} as const;

const NOTE = {
  investigating: "The customer has not been offered this job yet.",
  offered: "You agreed to these terms. The customer still needs to accept.",
  secured: "The customer has accepted. Report completion after the service.",
  fulfilled: "Completion is reported. Payment is being released.",
  settled: "The job is complete and payment is recorded.",
  remedied: "The customer chose a refund, so this job was released.",
} as const;

export function ProviderJobDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, busy, proceed } = useWorkspace();
  const c = state?.case;
  if (!state || !c) return null;
  const name =
    c.proposal?.providerName ?? chosenCandidate(c)?.name ?? "Provider";
  const ladder = c.ladder.state;
  const [label, tone] = STATUS[ladder];
  const split = c.split;
  const canReport = nextAction(state).kind === "provider";
  const working = busy || state.demo.busy;
  const report = () => {
    onClose();
    void proceed({ action: "advance", step: state.demo.step });
  };
  return (
    <Modal open={open} onClose={onClose} labelledBy="provider-title">
      <div className="dialog-header">
        <h2 id="provider-title">{state.workspace} · Partner workspace</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="perspective-label">
        {name.toUpperCase()} · JOB {c.bookingId}
      </div>
      <span className="tile-icon mint">
        <Icon name="truck" />
      </span>
      <h3 className="dialog-big-title">
        {firstName(c.booking.customer)}&apos;s {c.booking.service}
      </h3>
      <p>
        {when(c.booking.startsAt)} · {c.booking.address}
        {c.constraints && (
          <>
            <br />
            {[
              c.constraints.twoMovers && "Two movers",
              c.constraints.luton && "Luton van",
            ]
              .filter(Boolean)
              .join(" and ")}
          </>
        )}
      </p>
      {split && (
        <div className="refund-highlight">
          <span>Your agreed earnings</span>
          <strong>{money(split.transfer)}</strong>
          <small>Paid after confirmed service completion.</small>
        </div>
      )}
      <span className={`badge ${tone}`}>
        <i />
        {label}
      </span>
      <p>{NOTE[ladder]}</p>
      {canReport && state.demo.error && (
        <p className="inline-error" role="alert">
          {state.demo.error}
        </p>
      )}
      {canReport && (
        <button className="btn primary" disabled={working} onClick={report}>
          <Icon name="check" /> Report job complete
        </button>
      )}
    </Modal>
  );
}
