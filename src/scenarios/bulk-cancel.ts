import { z } from "zod";
import { MARKET, type BookingData, type SlotData } from "@/engine/case";
import { dataOf, find } from "@/engine/records";
import { when } from "@/lib/format";
import { defineTool, type Change, type Rec, type Scenario } from "./types";

const CLIENT = "Harbour Lettings";
const PRICE = 30000;
const APPROVED = ["BK-2003", "BK-2011", "BK-2017"];
// The 3 conflicts: another client books these slots as soon as they are released.
const RESOLD: Record<string, string> = {
  "BK-2009": "BK-9109",
  "BK-2019": "BK-9119",
  "BK-2026": "BK-9126",
};
const PROVIDERS = ["PROV-quickshine", "PROV-clearhome", "PROV-freshco"];
const NAMES: Record<string, string> = {
  "PROV-quickshine": "QuickShine Cleaning",
  "PROV-clearhome": "ClearHome Cleaning",
  "PROV-freshco": "FreshCo",
};
// UTC start hours of the six two-hour cleans on each weekday.
const HOURS = [8, 9, 11, 12, 14, 15];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// [slotId, providerId, weekday from Monday]: early slots on the same day as BK-2009 and BK-2019.
const REPLACEMENTS = [
  ["SLOT-clearhome-r1", "PROV-clearhome", 1],
  ["SLOT-freshco-r1", "PROV-freshco", 3],
] as const;
const STATUS_LABEL: Record<BookingData["status"], string> = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  provider_cancelled: "Provider cancelled",
};

const iso = (ms: number) => new Date(ms).toISOString();
const nameOf = (providerId: string) => NAMES[providerId] ?? providerId;
const ownSlot = (bookingId: string) => bookingId.replace("BK-", "SLOT-");
const asBooking = (r: Rec) => r.data as BookingData;

function nextMonday(now: Date): number {
  const ahead = (8 - now.getUTCDay()) % 7 || 7;
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + ahead,
  );
}

const clientBookings = (recs: Rec[], client: string) =>
  recs.filter(
    (r) =>
      r.system === MARKET &&
      r.target !== null &&
      asBooking(r).client === client,
  );
const confirmedIds = (recs: Rec[], client: string) =>
  clientBookings(recs, client)
    .filter((r) => asBooking(r).status === "confirmed")
    .map((r) => r.recordId);

// A cancelled booking keeps its slot reserved, unless the marketplace re-sells it at once.
function cancelChanges(recs: Rec[], ids: string[]): Change[] {
  return ids.flatMap((id) => {
    const r = find(recs, MARKET, id);
    if (!r || asBooking(r).status !== "confirmed") return [];
    const b = asBooking(r);
    const out: Change[] = [
      { system: MARKET, recordId: id, data: { ...b, status: "cancelled" } },
    ];
    const slot = b.slotId ? find(recs, MARKET, b.slotId) : undefined;
    const taker = (
      slot?.data._sim as { reassignedAfterCancel?: string } | undefined
    )?.reassignedAfterCancel;
    if (slot && taker)
      out.push({
        system: MARKET,
        recordId: slot.recordId,
        data: { ...slot.data, status: "booked", bookingId: taker },
      });
    return out;
  });
}

export const bulkCancel: Scenario = {
  id: "bulk-cancel",
  name: "30 cancelled instead of 3",
  short: "Scene 2",
  agent: {
    id: "agt_ops_01",
    name: "Ops Agent",
    role: "Marketplace operations",
  },
  task: {
    id: "OPS-311",
    text: "Cancel BK-2003, BK-2011 and BK-2017 (properties withdrawn).",
    approvedTargets: APPROVED,
    approvedBy: "Sam Okafor",
  },
  targetLabel: "booking",
  systemsLabel: "Larkspur marketplace",
  authoritative: MARKET,
  unit: "GBP",
  live: null,

  seed(now) {
    const monday = nextMonday(now);
    const recs: Rec[] = [];
    for (let i = 0; i < 30; i++) {
      const bookingId = `BK-${2001 + i}`;
      const slotId = ownSlot(bookingId);
      const providerId = PROVIDERS[i % 3];
      const start = monday + Math.floor(i / 6) * DAY + HOURS[i % 6] * HOUR;
      const booking: BookingData = {
        bookingId,
        customer: "Harbour Lettings tenant",
        client: CLIENT,
        service: "End-of-tenancy clean",
        address: `Flat ${i + 1}, Harbour Court, London E14`,
        startsAt: iso(start),
        endsAt: iso(start + 2 * HOUR),
        pricePence: PRICE,
        providerId,
        slotId,
        status: "confirmed",
      };
      const slot: SlotData = {
        slotId,
        providerId,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        status: "booked",
        bookingId,
      };
      const taker = RESOLD[bookingId];
      recs.push(
        {
          system: MARKET,
          recordId: bookingId,
          target: bookingId,
          data: booking,
          version: 1,
        },
        {
          system: MARKET,
          recordId: slotId,
          target: null,
          data: taker
            ? { ...slot, _sim: { reassignedAfterCancel: taker } }
            : slot,
          version: 1,
        },
      );
    }
    for (const [slotId, providerId, day] of REPLACEMENTS) {
      const start = monday + day * DAY + 6 * HOUR;
      const slot: SlotData = {
        slotId,
        providerId,
        startsAt: iso(start),
        endsAt: iso(start + 2 * HOUR),
        status: "free",
        bookingId: null,
      };
      recs.push({
        system: MARKET,
        recordId: slotId,
        target: null,
        data: slot,
        version: 1,
      });
    }
    return recs;
  },

  tools: {
    listBookings: defineTool({
      kind: "read",
      description:
        "List a client's bookings with service time, provider and status.",
      args: z.object({ client: z.string() }),
      run: ({ client }, recs) => ({
        result: clientBookings(recs, client).map((r) => {
          const b = asBooking(r);
          return {
            bookingId: b.bookingId,
            address: b.address,
            startsAt: b.startsAt,
            provider: nameOf(b.providerId),
            status: b.status,
          };
        }),
        changes: [],
      }),
    }),
    cancelBookings: defineTool({
      kind: "mutate",
      description: "Cancel every confirmed booking for a client.",
      args: z.object({ client: z.string() }),
      targets: ({ client }, recs) => confirmedIds(recs, client),
      run: ({ client }, recs) => {
        const ids = confirmedIds(recs, client);
        return {
          result: { cancelled: ids.length },
          changes: cancelChanges(recs, ids),
        };
      },
    }),
    cancelBooking: defineTool({
      kind: "mutate",
      description: "Cancel one booking by ID.",
      args: z.object({ bookingId: z.string() }),
      targets: ({ bookingId }) => [bookingId],
      run: ({ bookingId }, recs) => ({
        result: { cancelled: bookingId },
        changes: cancelChanges(recs, [bookingId]),
      }),
    }),
    notifyCustomers: defineTool({
      kind: "mutate",
      description: "Email the tenant of every booking a client has.",
      args: z.object({ client: z.string() }),
      targets: ({ client }, recs) =>
        clientBookings(recs, client).map((r) => r.recordId),
      run: ({ client }, recs) => ({
        result: { notified: clientBookings(recs, client).length },
        changes: [],
      }),
    }),
  },

  script: [
    {
      step: "agentReads",
      tool: "listBookings",
      args: { client: CLIENT },
      say: "Listing Harbour Lettings' bookings for next week.",
    },
    {
      step: "agentActs",
      tool: "cancelBookings",
      args: { client: CLIENT },
      say: "Cancelling the Harbour Lettings bookings.",
    },
    {
      step: "contain",
      tool: "notifyCustomers",
      args: { client: CLIENT },
      say: "Emailing the tenants about the cancellations.",
    },
  ],

  plan(target, _before, current, all) {
    const b = dataOf<BookingData>(current, MARKET);
    const slot = b.slotId ? find(all, MARKET, b.slotId) : undefined;
    const holder = (slot?.data as SlotData | undefined)?.bookingId ?? null;
    if (b.status === "cancelled" && holder === target)
      return {
        kind: "restore",
        action: "restoreBooking",
        reason: `Original slot with ${nameOf(b.providerId)} on ${when(b.startsAt)} is still held for this booking.`,
        owner: null,
        why: null,
      };
    return {
      kind: "manual",
      action: null,
      reason: holder
        ? `Original slot was re-booked by ${holder} after the cancellation.`
        : "Original slot is no longer held for this booking.",
      owner: "ArchOS rescue",
      why: "conflict",
    };
  },

  compensate(action, target, _before, current, all) {
    const r = current.find((x) => x.system === MARKET);
    const b = r ? asBooking(r) : undefined;
    const slot = b?.slotId ? find(all, MARKET, b.slotId) : undefined;
    if (
      action !== "restoreBooking" ||
      !b ||
      b.status !== "cancelled" ||
      (slot?.data as SlotData | undefined)?.bookingId !== target
    )
      return {
        ok: false,
        detail: "The original slot is no longer held for this booking.",
        changes: [],
      };
    return {
      ok: true,
      detail: `Restored with ${nameOf(b.providerId)}, ${when(b.startsAt)}.`,
      changes: [
        {
          system: MARKET,
          recordId: target,
          data: { ...b, status: "confirmed" },
        },
      ],
    };
  },

  // The slot side of a replacement is committed with the booking by reassignChanges in one transaction.
  verify(_target, before, current) {
    const was = dataOf<BookingData>(before, MARKET);
    const cur = dataOf<BookingData>(current, MARKET);
    if (cur.status !== "confirmed") return false;
    const restored =
      cur.providerId === was.providerId && cur.slotId === was.slotId;
    const replaced =
      cur.providerId !== was.providerId &&
      cur.slotId !== null &&
      cur.slotId !== was.slotId;
    return restored || replaced;
  },

  exposure: () => PRICE,

  view(target, current) {
    const r = current.find((x) => x.system === MARKET);
    if (!r) throw new Error(`No booking record for ${target}.`);
    const b = asBooking(r);
    return {
      title: b.address,
      subtitle: `${nameOf(b.providerId)}, ${when(b.startsAt)}`,
      status: STATUS_LABEL[b.status],
      stage: b.status,
      lane: null,
    };
  },
};
