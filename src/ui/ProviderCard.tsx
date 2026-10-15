"use client";

import type { UiCandidate } from "@/engine/state";
import { money } from "@/lib/format";
import { HoldCountdown } from "./HoldCountdown";
import { Icon } from "./Icon";
import { CANDIDATE_LABEL, CANDIDATE_TONE } from "./labels";

export function ProviderCard({ c }: { c: UiCandidate }) {
  return (
    <article
      className={`provider-card ${c.state}`}
      aria-label={`${c.name}, ${CANDIDATE_LABEL[c.state]}`}
    >
      <div className="between">
        <h3>{c.name}</h3>
        <span className={`badge ${CANDIDATE_TONE[c.state]}`}>
          <i className="dot" />
          {CANDIDATE_LABEL[c.state]}
        </span>
      </div>
      <p className="provider-why">
        {c.eligible ? "Meets every hard constraint." : "Does not qualify."}{" "}
        {c.why}
      </p>
      <dl className="facts">
        <div>
          <dt>Slot</dt>
          <dd>{c.slotLabel ?? "None before the deadline"}</dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd>{c.quotePence === null ? "Not asked" : money(c.quotePence)}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{c.pricePence === null ? "Not agreed" : money(c.pricePence)}</dd>
        </div>
      </dl>
      {c.state === "held" && c.holdExpiresAt && (
        <HoldCountdown expiresAt={c.holdExpiresAt} />
      )}
      {c.state === "rejected" && (
        <p className="provider-reject">
          <Icon name="lock" /> {c.rejectReason ?? "Rejected by policy."}
        </p>
      )}
    </article>
  );
}
