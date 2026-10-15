"use client";

import type { UiCase } from "@/engine/state";
import { clock, money, when } from "@/lib/format";
import { canAccept } from "./caseHelpers";
import { useDemo } from "./DemoProvider";
import { HoldCountdown } from "./HoldCountdown";
import { Icon, type IconName } from "./Icon";
import { canSubmit } from "./labels";
import { useNow } from "./useNow";

type Proposal = NonNullable<UiCase["proposal"]>;

const FROM_ICON: Record<UiCase["messages"][number]["from"], IconName> = {
  agent: "agent",
  customer: "user",
  provider: "handshake",
  system: "info",
};

function ProposalCard({ p }: { p: Proposal }) {
  const s = p.split;
  return (
    <div className="proposal-card">
      <div className="eyebrow">Proposal · {p.offerId}</div>
      <p>
        {p.providerName}, {when(p.startsAt)}
      </p>
      <dl className="facts">
        <div>
          <dt>Price</dt>
          <dd>{money(s.price)}</dd>
        </div>
        <div>
          <dt>Refund to customer</dt>
          <dd>{money(s.refund)}</dd>
        </div>
        <div>
          <dt>Paid to {p.providerName}</dt>
          <dd>{money(s.transfer)}</dd>
        </div>
        <div>
          <dt>Gross commission</dt>
          <dd>{money(s.commission)}</dd>
        </div>
        <div>
          <dt>Subsidy</dt>
          <dd>{money(s.subsidy)}</dd>
        </div>
        <div>
          <dt>Offer expires</dt>
          <dd>{clock(p.expiresAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MessagesPanel() {
  const { state, busy, act } = useDemo();
  const now = useNow();
  const c = state?.case;
  if (!state || !c) return null;
  const working = busy || state.demo.busy;
  const p = c.proposal;
  const respondOpen = canSubmit(working, state.demo.status) === "respond";
  const acceptOpen = canAccept(
    working,
    state.demo.status,
    p?.expiresAt ?? null,
    now,
  );
  const respond = (decision: "accept" | "decline") =>
    void act({ action: "respond", decision });

  return (
    <div className="messages">
      <section className="panel">
        <div className="panel-head between">
          <h2>Messages</h2>
          <span className="mono muted">{c.messages.length} MESSAGES</span>
        </div>
        <ol className="thread" aria-live="polite">
          {c.messages.map((m) => (
            <li key={m.seq} className={`msg ${m.from}`}>
              <div className="msg-meta">
                <Icon name={FROM_ICON[m.from]} /> {m.party}
                {m.to ? ` to ${m.to}` : ""} · {clock(m.at)}
              </div>
              {m.kind === "proposal" && p ? (
                <ProposalCard p={p} />
              ) : (
                <p>{m.text}</p>
              )}
            </li>
          ))}
          {!c.messages.length && <li className="muted">No messages yet.</li>}
        </ol>
      </section>
      <section className="panel sim-customer" aria-label="Simulated customer">
        <div className="panel-head between">
          <h2 className="flex">
            <Icon name="user" /> Simulated customer
          </h2>
          <span className="mono muted">{c.booking.customer}</span>
        </div>
        <div className="panel-body">
          {c.consent ? (
            <p>
              {c.booking.customer}{" "}
              {c.consent.decision === "accept" ? "accepted" : "declined"} at{" "}
              {clock(c.consent.at)}.
            </p>
          ) : p ? (
            <>
              <p className="muted">
                This click stands in for {c.booking.customer}&apos;s reply.
                Fictional customer.
              </p>
              <HoldCountdown expiresAt={p.expiresAt} label="Offer expires in" />
              <div className="flex">
                <button
                  className="btn primary"
                  disabled={!acceptOpen}
                  onClick={() => respond("accept")}
                >
                  <Icon name="handshake" /> Accept
                </button>
                <button
                  className="btn ghost"
                  disabled={!respondOpen}
                  onClick={() => respond("decline")}
                >
                  Decline
                </button>
              </div>
              {!respondOpen && (
                <p className="muted">The buttons unlock at the consent step.</p>
              )}
            </>
          ) : (
            <p className="muted">Waiting for a proposal.</p>
          )}
        </div>
      </section>
    </div>
  );
}
