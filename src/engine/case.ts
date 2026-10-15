import type { PolicyReason, Rec } from "@/scenarios/types";
import { StepError } from "./errors";
import { find } from "./records";

export type BookingData = {
  bookingId: string;
  customer: string;
  client: string | null;
  service: string;
  address: string;
  startsAt: string;
  endsAt: string;
  pricePence: number;
  providerId: string;
  slotId: string | null;
  status: "confirmed" | "provider_cancelled" | "cancelled";
};
export type ProviderData = {
  providerId: string;
  name: string;
  petFriendly: boolean;
  oven: boolean;
  rating: number;
  connected: boolean; // has a Stripe connected account
  _sim?: { quotePence: number; floorPence: number };
};
export type SlotData = {
  slotId: string;
  providerId: string;
  startsAt: string;
  endsAt: string;
  status: "free" | "held" | "booked";
  bookingId: string | null;
};
export type Constraints = {
  doneBy: string;
  petFriendly: boolean;
  oven: boolean;
  maxPricePence: number;
  preferSameTime: boolean;
  notes: string;
};
export type Offer = {
  offerId: string; // `OFR-${providerId}`
  providerId: string;
  slotId: string;
  quotePence: number;
  pricePence: number | null;
  state: "quoted" | "held" | "proposed" | "secured" | "released";
  slotVersion: number | null;
  holdExpiresAt: string | null;
  createdAt: string;
};
export type Rejected = {
  providerId: string;
  pricePence: number;
  reason: PolicyReason;
  message: string;
  at: string;
};
export type Consent = {
  offerId: string;
  pricePence: number;
  decision: "accept" | "decline";
  at: string;
  expiresAt: string;
};
export type CaseMessage = {
  seq: number;
  from: "agent" | "customer" | "provider" | "system";
  to: "customer" | "provider" | "agent" | null;
  party: string;
  text: string;
  at: string;
  kind: "text" | "proposal";
};
export type Extraction = {
  source: "live" | "scripted";
  model: string | null;
  reason: string | null;
  raw: string | null;
};
export type CaseData = {
  caseId: string;
  bookingId: string;
  status: "booked" | "open" | "declined" | "closed";
  paidPence: number;
  originalProviderId: string;
  originalProviderPaid: boolean;
  cancellationText: string | null;
  customerText: string | null;
  rescueDeadline: string;
  constraints: Constraints | null;
  extraction: Extraction | null;
  offers: Offer[];
  rejected: Rejected[];
  consent: Consent | null;
  messages: CaseMessage[];
  fulfilment: { at: string; simulated: true } | null;
  replacementProviderId: string | null;
};

export const CASE_SYSTEM = "archos";
export const MARKET = "marketplace";

export function caseOf(recs: Rec[], caseId?: string): Rec & { data: CaseData } {
  const r = recs.find(
    (x) =>
      x.system === CASE_SYSTEM &&
      (caseId === undefined || x.recordId === caseId),
  );
  if (!r)
    throw new StepError(
      caseId ? `Case ${caseId} not found.` : "No case record found.",
    );
  return r as Rec & { data: CaseData };
}

export function bookingOf(
  recs: Rec[],
  bookingId: string,
): Rec & { data: BookingData } {
  const r = find(recs, MARKET, bookingId);
  if (!r) throw new StepError(`Booking ${bookingId} not found.`);
  return r as Rec & { data: BookingData };
}

export function providersOf(recs: Rec[]): (Rec & { data: ProviderData })[] {
  return recs.filter(
    (r) => r.system === MARKET && r.recordId.startsWith("PROV-"),
  ) as (Rec & { data: ProviderData })[];
}

export function slotsOf(recs: Rec[]): (Rec & { data: SlotData })[] {
  return recs.filter(
    (r) => r.system === MARKET && r.recordId.startsWith("SLOT-"),
  ) as (Rec & { data: SlotData })[];
}

export function withMessage(
  c: CaseData,
  m: Omit<CaseMessage, "seq" | "at">,
  now: Date,
): CaseData {
  const seq = c.messages.reduce((n, x) => Math.max(n, x.seq), 0) + 1;
  return {
    ...c,
    messages: [...c.messages, { ...m, seq, at: now.toISOString() }],
  };
}

// Whitelist rather than omit, so a new simulator field can never leak into a tool result.
export function publicProvider(p: ProviderData): Omit<ProviderData, "_sim"> {
  const { providerId, name, petFriendly, oven, rating, connected } = p;
  return { providerId, name, petFriendly, oven, rating, connected };
}
