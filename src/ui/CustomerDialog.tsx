"use client";

import { useState } from "react";
import { money, when } from "@/lib/format";
import { canAccept, chosenCandidate, firstName } from "./caseHelpers";
import { HoldCountdown } from "./HoldCountdown";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { useNow } from "./useNow";
import { useWorkspace } from "./WorkspaceProvider";

export function CustomerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, busy, proceed } = useWorkspace();
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const c = state?.case;
  if (!state || !c) return null;
  const first = firstName(c.booking.customer);
  const p = c.proposal;
  const ladder = c.ladder.state;
  const chosen = chosenCandidate(c);
  const provider = p?.providerName ?? chosen?.name ?? "your new provider";
  const refund = p?.split.refund ?? c.split?.refund ?? 0;
  const working = busy || state.demo.busy;
  const awaiting = state.demo.status === "awaiting_customer" && p !== null;
  const expired =
    awaiting &&
    now !== null &&
    !canAccept(false, "awaiting_customer", p.expiresAt, now);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  const respond = (decision: "accept" | "decline") => {
    close();
    void proceed({ action: "respond", decision });
  };

  let body;
  if (ladder === "remedied") {
    body = (
      <>
        <div className="success-mark">
          <Icon name="check" />
        </div>
        <h3 className="dialog-big-title">Your refund is recorded.</h3>
        <p>
          The full {money(c.paidPence)} is marked refunded. The provider hold
          has been released.
        </p>
      </>
    );
  } else if (ladder === "settled") {
    body = (
      <>
        <div className="success-mark">
          <Icon name="check" />
        </div>
        <h3 className="dialog-big-title">All done.</h3>
        <p>
          {provider} completed the booking
          {refund > 0 ? ` and your ${money(refund)} refund is complete` : ""}.
          Their payment has been released.
        </p>
      </>
    );
  } else if (ladder === "fulfilled") {
    body = (
      <>
        <div className="success-mark">
          <Icon name="check" />
        </div>
        <h3 className="dialog-big-title">Service completed.</h3>
        <p>
          {provider} reported the booking complete. Their payment is being
          released.
        </p>
      </>
    );
  } else if (ladder === "secured") {
    body = (
      <>
        <div className="success-mark">
          <Icon name="check" />
        </div>
        <h3 className="dialog-big-title">Your booking is back on.</h3>
        <p>
          {provider} is booked for {when(c.booking.startsAt)}.
          {refund > 0
            ? ` ${money(refund)} goes back to your original payment method.`
            : ""}
        </p>
        <div className="callout">
          <p>
            Your service is still upcoming. We will confirm once your provider
            reports completion.
          </p>
        </div>
      </>
    );
  } else if (awaiting) {
    body = (
      <>
        <div className="customer-intro">
          <span className="customer-mark">
            <Icon name="truck" />
          </span>
          <p className="eyebrow">
            HI {first.toUpperCase()}, WE HAVE AN OPTION FOR YOU
          </p>
          <h3>Your booking can still go ahead.</h3>
          <p>
            {c.booking.providerName} cancelled
            {c.cancellationText ? `: ${c.cancellationText}` : ""}.{" "}
            {p.providerName} can take it on instead.
          </p>
        </div>
        <div className="offer-comparison">
          <div>
            <small>Original provider</small>
            <strong className="muted">{c.booking.providerName}</strong>
            <span className="muted">
              {money(c.booking.pricePence)} · Cancelled
            </span>
          </div>
          <Icon name="arrow" />
          <div>
            <small>Your replacement</small>
            <strong>{p.providerName}</strong>
            <span>{money(p.split.price)}</span>
          </div>
        </div>
        <div className="customer-details">
          <span>
            <Icon name="clock" /> {when(p.startsAt)}
          </span>
          {c.constraints && (
            <span>
              <Icon name="truck" />{" "}
              {[
                c.constraints.twoMovers && "Two movers",
                c.constraints.luton && "Luton van",
              ]
                .filter(Boolean)
                .join(" + ") || "Meets your requirements"}
            </span>
          )}
          <span>
            <Icon name="pin" /> {c.booking.address}
          </span>
        </div>
        <div className="refund-highlight">
          <span>You get back</span>
          <strong>{money(p.split.refund)}</strong>
          <small>
            No extra charge. The refund goes to your original payment method.
          </small>
        </div>
        <div className="hold-note">
          <HoldCountdown expiresAt={p.expiresAt} label="Offer expires in" />
        </div>
        {state.demo.error && (
          <p className="inline-error" role="alert">
            {state.demo.error}
          </p>
        )}
        <div className="dialog-actions">
          {expired ? (
            <p className="expiry-message">
              This offer has expired. A full refund is available below.
            </p>
          ) : (
            <button
              className="btn primary"
              disabled={
                !canAccept(working, state.demo.status, p.expiresAt, now)
              }
              onClick={() => respond("accept")}
            >
              <Icon name="check" /> Accept replacement
            </button>
          )}
          {confirming ? (
            <div className="callout" role="alert">
              <p>
                Cancel the replacement and refund {money(c.paidPence)}? This
                cannot be undone.
              </p>
              <div className="flex">
                <button
                  className="btn soft"
                  disabled={working}
                  onClick={() => respond("decline")}
                >
                  Yes, refund me
                </button>
                <button
                  className="btn text-btn"
                  onClick={() => setConfirming(false)}
                >
                  Keep the offer
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn soft"
              disabled={working}
              onClick={() => setConfirming(true)}
            >
              Choose a full {money(c.paidPence)} refund
            </button>
          )}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="customer-intro">
          <span className="customer-mark">
            <Icon name="truck" />
          </span>
          {c.booking.status === "confirmed" ? (
            <>
              <h3>Your booking is confirmed.</h3>
              <p>
                {c.booking.providerName} is booked for{" "}
                {when(c.booking.startsAt)}.
              </p>
            </>
          ) : (
            <>
              <h3>Your provider cancelled.</h3>
              <p>We are finding you a replacement.</p>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <Modal open={open} onClose={close} labelledBy="customer-title">
      <div className="dialog-header">
        <h2 id="customer-title">{state.workspace} · Your booking</h2>
        <button className="icon-btn" aria-label="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <div className="perspective-label">YOUR BOOKING · {c.bookingId}</div>
      {body}
    </Modal>
  );
}
