import { describe, expect, it } from "vitest";
import { MARKET, type BookingData, type SlotData } from "@/engine/case";
import { StepError } from "@/engine/errors";
import { reassignChanges } from "@/engine/rescue";
import type { Rec } from "@/scenarios/types";

const booking: BookingData = {
  bookingId: "BK-1042",
  customer: "Maya Chen",
  client: null,
  service: "2-bed flat move",
  address: "Flat 3, 12 Larkspur Road, London",
  startsAt: "2026-10-16T09:00:00.000Z",
  endsAt: "2026-10-16T13:00:00.000Z",
  pricePence: 30000,
  providerId: "PROV-quickmove",
  slotId: null,
  status: "provider_cancelled",
};
const slot = (
  slotId: string,
  status: SlotData["status"],
  bookingId: string | null,
): SlotData => ({
  slotId,
  providerId: "PROV-clearhome",
  startsAt: "2026-10-16T12:00:00.000Z",
  endsAt: "2026-10-16T14:00:00.000Z",
  status,
  bookingId,
});
const recs = (s: SlotData): Rec[] => [
  {
    system: MARKET,
    recordId: "BK-1042",
    target: "BK-1042",
    version: 2,
    data: booking,
  },
  { system: MARKET, recordId: s.slotId, target: null, version: 3, data: s },
];
const x = {
  bookingId: "BK-1042",
  slotId: "SLOT-clearhome-fri13",
  providerId: "PROV-clearhome",
};

describe("reassignChanges", () => {
  it("confirms the booking with the new provider and books the held slot", () => {
    const held = slot("SLOT-clearhome-fri13", "held", "BK-1042");
    const input = recs(held);
    expect(reassignChanges(input, x)).toEqual([
      {
        system: MARKET,
        recordId: "BK-1042",
        data: {
          ...booking,
          providerId: "PROV-clearhome",
          slotId: "SLOT-clearhome-fri13",
          status: "confirmed",
        },
      },
      {
        system: MARKET,
        recordId: "SLOT-clearhome-fri13",
        data: { ...held, status: "booked", bookingId: "BK-1042" },
      },
    ]);
    expect(input[0].data).toEqual(booking);
  });

  it("refuses a slot already booked for another booking", () => {
    expect(() =>
      reassignChanges(
        recs(slot("SLOT-clearhome-fri13", "booked", "BK-9999")),
        x,
      ),
    ).toThrow(StepError);
  });

  it("refuses a slot that does not exist", () => {
    expect(() =>
      reassignChanges(recs(slot("SLOT-other", "free", null)), x),
    ).toThrow(StepError);
  });
});
