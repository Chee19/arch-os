"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { DemoState } from "@/engine/state";
import { Icon, type IconName } from "./Icon";
import { Modal } from "./Modal";
import { nextAction } from "./nextStep";
import { useWorkspace } from "./WorkspaceProvider";

type DialogProps = { open: boolean; onClose: () => void };

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function pageOf(s: DemoState): {
  href: string;
  icon: IconName;
  label: string;
  title: string;
  noun: string;
} {
  if (s.demo.scenario === "provider-cancel")
    return {
      href: "/case",
      icon: "inbox",
      label: "Open the current recovery",
      title: s.case
        ? `${s.case.booking.customer}'s booking`
        : "Current recovery",
      noun: "recovery",
    };
  return {
    href: "/incident",
    icon: "shield",
    label: "Open the current incident",
    title: s.incident
      ? `Incident ${s.incident.incidentId}`
      : "Current incident",
    noun: "incident",
  };
}

export const openExceptions = (s: DemoState) =>
  s.exceptions.filter((e) => e.status === "open");

export function needsAttention(s: DemoState) {
  const { status } = s.demo;
  return (
    status === "awaiting_approval" ||
    status === "awaiting_customer" ||
    nextAction(s).kind === "provider" ||
    openExceptions(s).length > 0
  );
}

function Frame({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="dialog-header">
        <h2 id={id}>{title}</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </>
  );
}

const STEPS: [string, string][] = [
  [
    "Find what needs attention.",
    "The overview puts the next decision in front of you, ordered by urgency.",
  ],
  [
    "Review a way forward.",
    "See the customer's needs, a suitable provider, timing and money together.",
  ],
  [
    "Let the customer choose.",
    "A new provider needs the customer's acceptance. A timely refund is always a valid remedy.",
  ],
  [
    "Follow through.",
    "Track the booking, delivery and payment separately, and give every unresolved case an owner.",
  ],
];

export function HelpDialog({ open, onClose }: DialogProps) {
  const { state } = useWorkspace();
  const page = state ? pageOf(state) : null;
  return (
    <Modal open={open} onClose={onClose} labelledBy="help-title">
      <Frame id="help-title" title="One problem at a time." onClose={onClose}>
        <div className="help-steps">
          {STEPS.map(([lead, text], i) => (
            <p key={lead}>
              <b>
                {i + 1}. {lead}
              </b>
              <br />
              {text}
            </p>
          ))}
        </div>
        {page && (
          <Link className="btn primary" href={page.href} onClick={onClose}>
            {page.label} <Icon name="arrow" />
          </Link>
        )}
      </Frame>
    </Modal>
  );
}

export function ProfileDialog({ open, onClose }: DialogProps) {
  const { state, busy, act, notify } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  const reset = async () => {
    if (await act({ action: "reset" })) {
      close();
      notify("Workspace reset.");
    }
  };
  const operator = state?.operator ?? "Operator";
  const workspace = state?.workspace ?? "Workspace";
  return (
    <Modal open={open} onClose={close} labelledBy="profile-title">
      <Frame id="profile-title" title="Your profile" onClose={close}>
        <div className="profile-dialog">
          <span className="avatar lavender">{initials(operator)}</span>
          <div>
            <h3>{operator}</h3>
            <p>Operations lead · {workspace}</p>
          </div>
        </div>
        <p style={{ margin: "18px 0", fontSize: 12, lineHeight: 1.8 }}>
          Reviews recoveries and approvals for this workspace, and owns any case
          that needs a person to finish it.
        </p>
        <div className="profile-data">
          <h3>Workspace data</h3>
          {confirming ? (
            <>
              <p>
                Reset all bookings, payments and activity to their starting
                state?
              </p>
              <div className="dialog-actions">
                <button
                  className="btn soft"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void reset()}
                >
                  Reset workspace
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Return every booking, payment and activity record to where it
                started.
              </p>
              <button
                className="btn soft"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                <Icon name="reset" /> Reset workspace
              </button>
            </>
          )}
        </div>
      </Frame>
    </Modal>
  );
}

export function NotificationsDialog({ open, onClose }: DialogProps) {
  const { state } = useWorkspace();
  const page = state ? pageOf(state) : null;
  const open_ = state ? openExceptions(state) : [];
  const next = state ? nextAction(state) : null;
  const waiting = state !== null && needsAttention(state);
  const empty = !waiting;
  return (
    <Modal open={open} onClose={onClose} labelledBy="notifications-title">
      <Frame id="notifications-title" title="Notifications" onClose={onClose}>
        {empty && (
          <div className="empty-state">
            <Icon name="check" />
            <h3>Nothing is waiting on you</h3>
            <p>New items that need a decision will show up here.</p>
          </div>
        )}
        {waiting && page && next && next.kind !== "done" && (
          <div className="notification-item">
            <span className="tile-icon purple">
              <Icon name={page.icon} />
            </span>
            <div>
              <h3>{page.title}</h3>
              <p>{next.label}</p>
              <Link className="text-link" href={page.href} onClick={onClose}>
                Open {page.noun} <Icon name="arrow" />
              </Link>
            </div>
          </div>
        )}
        {open_.length > 0 && (
          <div className="notification-item">
            <span className="tile-icon peach">
              <Icon name="warning" />
            </span>
            <div>
              <h3>
                {open_.length} open exception{open_.length === 1 ? "" : "s"}
              </h3>
              <p>{open_[0].reason}</p>
              <Link className="text-link" href="/exceptions" onClick={onClose}>
                Review exceptions <Icon name="arrow" />
              </Link>
            </div>
          </div>
        )}
      </Frame>
    </Modal>
  );
}
