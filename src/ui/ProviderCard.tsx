"use client";

import type { UiCandidate } from "@/engine/state";
import { money } from "@/lib/format";
import { HoldCountdown } from "./HoldCountdown";
import { Icon } from "./Icon";
import { CANDIDATE_LABEL } from "./labels";

const BADGE: Record<UiCandidate["state"], string> = {
  secured: "green",
  held: "purple",
  confirmed: "blue",
  potential: "neutral",
  rejected: "peach",
};
const AVATAR = ["mint", "apricot", "lavender", "blue"];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export function ProviderCard({ c }: { c: UiCandidate }) {
  const price = c.pricePence ?? c.quotePence;
  return (
    <article
      className={`provider-option ${c.state}`}
      aria-label={`${c.name}, ${CANDIDATE_LABEL[c.state]}`}
    >
      <div className="section-heading">
        <span className={`avatar ${avatarTone(c.name)}`}>
          {initials(c.name)}
        </span>
        <strong>{price === null ? "—" : money(price)}</strong>
      </div>
      <h3>{c.name}</h3>
      <span className={`badge ${BADGE[c.state]}`}>
        <i />
        {CANDIDATE_LABEL[c.state]}
      </span>
      <p>{c.state === "rejected" ? (c.rejectReason ?? c.why) : c.why}</p>
      {c.slotLabel && (
        <p className="provider-slot">
          <Icon name="clock" /> {c.slotLabel}
        </p>
      )}
      {c.state === "held" && c.holdExpiresAt && (
        <HoldCountdown expiresAt={c.holdExpiresAt} />
      )}
    </article>
  );
}
