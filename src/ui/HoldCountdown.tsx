"use client";

import { mmss, remaining } from "./caseHelpers";
import { Icon } from "./Icon";
import { useNow } from "./useNow";

export function HoldCountdown({
  expiresAt,
  label = "Hold expires in",
}: {
  expiresAt: string;
  label?: string;
}) {
  const now = useNow();
  if (now === null) return null;
  const left = remaining(expiresAt, now);
  return (
    <p className={`countdown ${left === 0 ? "expired" : ""}`}>
      <Icon name="clock" />
      <span aria-hidden="true">
        {left === 0 ? "Expired" : `${label} ${mmss(left)}`}
      </span>
      {/* Announces once a minute; a per-second live region floods screen readers. */}
      <span className="sr-only" aria-live="polite">
        {left === 0 ? "Expired" : `${label} ${Math.ceil(left / 60)} minutes`}
      </span>
    </p>
  );
}
