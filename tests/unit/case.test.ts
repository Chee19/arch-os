import { describe, expect, it } from "vitest";
import {
  bookingOf,
  caseOf,
  providersOf,
  publicProvider,
  slotsOf,
  withMessage,
  type BookingData,
  type CaseData,
  type ProviderData,
  type SlotData,
} from "@/engine/case";
import { StepError } from "@/engine/errors";
import type { Rec } from "@/scenarios/types";

const NOW = new Date("2026-10-16T09:00:00.000Z");

const booking: BookingData = {
  bookingId: "BK-1042",
  customer: "Maya Chen",
  client: null,
  service: "2-bed flat move",
  address: "Flat 3, 12 Larkspur Road, London",
  startsAt: "2026-10-16T09:00:00.000Z",
  endsAt: "2026-10-16T12:00:00.000Z",
  pricePence: 30000,
  providerId: "PROV-quickmove",
  slotId: "SLOT-quickmove-fri10",
  status: "confirmed",
};
const provider: ProviderData = {
  providerId: "PROV-clearhome",
  name: "ClearHome Removals",
  twoMovers: true,
  luton: true,
  rating: 4.8,
  connected: true,
  _sim: { quotePence: 29000, floorPence: 28000 },
};
const slot: SlotData = {
  slotId: "SLOT-clearhome-fri13",
  providerId: "PROV-clearhome",
  startsAt: "2026-10-16T12:00:00.000Z",
  endsAt: "2026-10-16T14:00:00.000Z",
  status: "free",
  bookingId: null,
};
const shell: CaseData = {
  caseId: "CASE-1042",
  bookingId: "BK-1042",
  status: "booked",
  paidPence: 30000,
  originalProviderId: "PROV-quickmove",
  originalProviderPaid: false,
  cancellationText: null,
  customerText: null,
  rescueDeadline: "2026-10-16T11:00:00.000Z",
  constraints: null,
  extraction: null,
  offers: [],
  rejected: [],
  consent: null,
  messages: [],
  fulfilment: null,
  replacementProviderId: null,
};

const rec = (
  system: string,
  recordId: string,
  target: string | null,
  data: Rec["data"],
): Rec => ({ system, recordId, target, data, version: 1 });

const recs: Rec[] = [
  rec("marketplace", "BK-1042", "BK-1042", booking),
  rec("marketplace", "PROV-clearhome", null, provider),
  rec("marketplace", "SLOT-clearhome-fri13", null, slot),
  rec("archos", "CASE-1042", null, shell),
];

describe("record helpers", () => {
  it("finds the case by id or as the only case", () => {
    expect(caseOf(recs, "CASE-1042").data.caseId).toBe("CASE-1042");
    expect(caseOf(recs).data.bookingId).toBe("BK-1042");
  });
  it("throws when the case or booking is missing", () => {
    expect(() => caseOf(recs, "CASE-9999")).toThrow(StepError);
    expect(() => caseOf([])).toThrow(StepError);
    expect(() => bookingOf(recs, "BK-9999")).toThrow(StepError);
  });
  it("finds bookings, providers and slots", () => {
    expect(bookingOf(recs, "BK-1042").data.pricePence).toBe(30000);
    expect(providersOf(recs).map((p) => p.data.providerId)).toEqual([
      "PROV-clearhome",
    ]);
    expect(slotsOf(recs).map((s) => s.data.slotId)).toEqual([
      "SLOT-clearhome-fri13",
    ]);
  });
});

describe("withMessage", () => {
  it("appends with the next seq and the given time, without mutating", () => {
    const one = withMessage(
      shell,
      {
        from: "agent",
        to: "customer",
        party: "Maya Chen",
        text: "We are finding you a new mover.",
        kind: "text",
      },
      NOW,
    );
    const two = withMessage(
      one,
      {
        from: "customer",
        to: "agent",
        party: "Maya Chen",
        text: "Thanks.",
        kind: "text",
      },
      new Date(NOW.getTime() + 60_000),
    );
    expect(two.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(two.messages[0].at).toBe("2026-10-16T09:00:00.000Z");
    expect(two.messages[1].at).toBe("2026-10-16T09:01:00.000Z");
    expect(shell.messages).toEqual([]);
    expect(one.messages).toHaveLength(1);
  });
});

describe("publicProvider", () => {
  it("never exposes simulator floors", () => {
    const p = publicProvider(provider);
    expect(p).not.toHaveProperty("_sim");
    expect(JSON.stringify(p)).not.toContain("_sim");
    expect(p).toEqual({
      providerId: "PROV-clearhome",
      name: "ClearHome Removals",
      twoMovers: true,
      luton: true,
      rating: 4.8,
      connected: true,
    });
  });
});
