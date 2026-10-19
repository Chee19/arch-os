"use client";

import type { UiCase } from "@/engine/state";
import { clock, money, when } from "@/lib/format";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon, type IconName } from "./Icon";

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
      <span className="eyebrow">Proposal · {p.offerId}</span>
      <p>
        {p.providerName}, {when(p.startsAt)}
      </p>
      <dl className="mini-facts">
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
  const { state } = useWorkspace();
  const c = state?.case;
  if (!c) return null;
  const p = c.proposal;
  return (
    <section className="glass padded">
      <ol className="chat" aria-live="polite">
        {c.messages.map((m) => (
          <li key={m.seq} className={`bubble ${m.from}`}>
            <div className="bubble-meta">
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
        {!c.messages.length && (
          <li className="muted">
            No messages yet. Messages appear once the search starts.
          </li>
        )}
      </ol>
    </section>
  );
}
