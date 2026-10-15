import type {
  BookingData,
  CaseData,
  Consent,
  Constraints,
  Offer,
  ProviderData,
  SlotData,
} from "@/engine/case";
import type { PaymentOp } from "@/engine/docs";
import { ConfigError } from "@/engine/errors";
import { money, when } from "@/lib/format";
import type { PolicyDeny, Rec } from "@/scenarios/types";

export type ChargeFacts = {
  amount: number;
  amountRefunded: number;
  succeeded: boolean;
};
export type Match = {
  providerId: string;
  eligible: boolean;
  why: string;
  slotId: string | null;
};

const envNumber = (
  name: string,
  fallback: number,
  valid: (n: number) => boolean,
  rule: string,
): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (raw.trim() === "" || !valid(n))
    throw new ConfigError(`${name} must be ${rule}, got "${raw}"`);
  return n;
};

// A malformed value must fail loudly; NaN would silently disable the cap.
export const SUBSIDY_CAP_PENCE = () =>
  envNumber(
    "SUBSIDY_CAP_PENCE",
    2000,
    (n) => Number.isSafeInteger(n) && n >= 0,
    "a whole number of pence, 0 or more",
  );
export const HOLD_MINUTES = () =>
  envNumber(
    "HOLD_MINUTES",
    30,
    (n) => Number.isFinite(n) && n > 0,
    "a number of minutes above 0",
  );

const ms = (iso: string) => new Date(iso).getTime();
const deny = (reason: PolicyDeny["reason"], message: string): PolicyDeny => ({
  reason,
  message,
});

export function matchConstraints(
  c: Constraints,
  p: ProviderData,
  slots: SlotData[],
): Match {
  const no = (why: string): Match => ({
    providerId: p.providerId,
    eligible: false,
    why,
    slotId: null,
  });
  if (c.petFriendly && !p.petFriendly) return no("Not pet friendly");
  if (c.oven && !p.oven) return no("No oven cleaning");
  const fit = slots
    .filter(
      (s) =>
        s.providerId === p.providerId &&
        s.status === "free" &&
        ms(s.endsAt) <= ms(c.doneBy),
    )
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt))[0];
  if (!fit) return no(`No free slot before ${when(c.doneBy)}`);
  return {
    providerId: p.providerId,
    eligible: true,
    why: `Free ${when(fit.startsAt)}`,
    slotId: fit.slotId,
  };
}

// Subsidy is what the platform pays beyond what the customer paid (spec 3.2).
export function priceAllowed(
  c: Constraints,
  pricePence: number,
  capPence: number,
  paidPence: number,
): PolicyDeny | null {
  const subsidy = Math.max(
    0,
    pricePence - Math.min(c.maxPricePence, paidPence),
  );
  if (subsidy > capPence)
    return deny(
      "over_subsidy",
      `Needs ${money(subsidy)} subsidy, cap is ${money(capPence)}`,
    );
  return null;
}

export function holdValid(o: Offer, now: Date): PolicyDeny | null {
  if (!o.holdExpiresAt || now.getTime() >= ms(o.holdExpiresAt)) {
    return deny(
      "hold_expired",
      o.holdExpiresAt
        ? `Hold expired at ${when(o.holdExpiresAt)}`
        : "Offer has no hold",
    );
  }
  return null;
}

export function consentValid(
  consent: Consent | null,
  o: Offer,
  now: Date,
): PolicyDeny | null {
  if (!consent) return deny("consent_expired", "No customer consent");
  if (consent.decision !== "accept")
    return deny("consent_expired", "Customer did not accept");
  if (consent.offerId !== o.offerId || consent.pricePence !== o.pricePence) {
    return deny("consent_expired", "Consent does not match the current offer");
  }
  if (now.getTime() >= ms(consent.expiresAt))
    return deny(
      "consent_expired",
      `Consent expired at ${when(consent.expiresAt)}`,
    );
  return null;
}

export function slotFree(o: Offer, slot: Rec | undefined): PolicyDeny | null {
  if (!slot) return deny("slot_taken", "Slot no longer exists");
  if (slot.version !== o.slotVersion)
    return deny("slot_taken", "Slot changed since the hold");
  return null;
}

// Failed ops never count; refund and full_refund both reduce what is left on the charge.
const live = (ops: PaymentOp[], kinds: PaymentOp["kind"][]) =>
  ops
    .filter((o) => o.state !== "failed" && kinds.includes(o.kind))
    .reduce((n, o) => n + o.amountPence, 0);

export function noConflictingMoney(
  charge: ChargeFacts,
  ops: PaymentOp[],
): PolicyDeny | null {
  const recorded = live(ops, ["refund", "full_refund"]);
  if (charge.amountRefunded > recorded) {
    return deny(
      "conflicting_change",
      `Stripe shows ${money(charge.amountRefunded)} refunded but ArchOS recorded ${money(recorded)}`,
    );
  }
  return null;
}

export function fundingOk(x: {
  originalProviderPaid: boolean;
  charge: ChargeFacts;
  ops: PaymentOp[];
  amount: number;
}): PolicyDeny | null {
  if (x.originalProviderPaid)
    return deny("unfunded", "The original provider was already paid");
  if (!x.charge.succeeded)
    return deny("unfunded", "The customer charge has not succeeded");
  const refunded = Math.max(
    x.charge.amountRefunded,
    live(x.ops, ["refund", "full_refund"]),
  );
  const left = x.charge.amount - refunded - live(x.ops, ["transfer"]);
  if (left < x.amount)
    return deny(
      "unfunded",
      `Needs ${money(x.amount)} but only ${money(Math.max(0, left))} is left on the charge`,
    );
  return null;
}

export type RevalidateCtx = {
  now: Date;
  caseData: CaseData;
  offer: Offer;
  slot: Rec | undefined;
  booking: BookingData;
  charge: ChargeFacts;
  ops: PaymentOp[];
  amount: number;
};

export function revalidate(
  kind: "secure" | "settle",
  x: RevalidateCtx,
): PolicyDeny | null {
  const money_ = () =>
    noConflictingMoney(x.charge, x.ops) ??
    fundingOk({
      originalProviderPaid: x.caseData.originalProviderPaid,
      charge: x.charge,
      ops: x.ops,
      amount: x.amount,
    });

  if (kind === "secure") {
    return (
      holdValid(x.offer, x.now) ??
      consentValid(x.caseData.consent, x.offer, x.now) ??
      slotFree(x.offer, x.slot) ??
      money_()
    );
  }
  if (
    x.booking.providerId !== x.offer.providerId ||
    x.booking.status !== "confirmed"
  ) {
    return deny(
      "slot_taken",
      "The booking is no longer assigned to the replacement provider",
    );
  }
  if (!x.caseData.fulfilment)
    return deny("conflicting_change", "No fulfilment event");
  return money_();
}

export type AllocCase = {
  target: string;
  startsAt: string;
  deadline: string;
  incentivePence: number;
};
export type AllocSlot = {
  slotId: string;
  providerId: string;
  startsAt: string;
  endsAt: string;
};
export type Allocation = {
  assigned: {
    target: string;
    slotId: string;
    providerId: string;
    incentivePence: number;
  }[];
  unassigned: { target: string; reason: "no_slot" | "over_budget" }[];
  committedPence: number;
};

// Earliest service time first; commission is not an input so it cannot affect order.
export function allocate(
  cases: AllocCase[],
  slots: AllocSlot[],
  budget: { budgetPence: number; committedPence: number },
): Allocation {
  const used = new Set<string>();
  const out: Allocation = {
    assigned: [],
    unassigned: [],
    committedPence: budget.committedPence,
  };
  let stopped = false;
  for (const c of [...cases].sort((a, b) => ms(a.startsAt) - ms(b.startsAt))) {
    const slot = slots
      .filter((s) => !used.has(s.slotId) && ms(s.endsAt) <= ms(c.deadline))
      .sort((a, b) => ms(a.startsAt) - ms(b.startsAt))[0];
    if (!slot) {
      out.unassigned.push({ target: c.target, reason: "no_slot" });
      continue;
    }
    if (stopped || out.committedPence + c.incentivePence > budget.budgetPence) {
      stopped = true;
      out.unassigned.push({ target: c.target, reason: "over_budget" });
      continue;
    }
    used.add(slot.slotId);
    out.committedPence += c.incentivePence;
    out.assigned.push({
      target: c.target,
      slotId: slot.slotId,
      providerId: slot.providerId,
      incentivePence: c.incentivePence,
    });
  }
  return out;
}
