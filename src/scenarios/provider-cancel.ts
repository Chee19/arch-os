import { z } from "zod";
import {
  bookingOf,
  CASE_SYSTEM,
  caseOf,
  MARKET,
  providersOf,
  publicProvider,
  slotsOf,
  withMessage,
  type BookingData,
  type CaseData,
  type Constraints,
  type Offer,
  type ProviderData,
  type Rejected,
  type SlotData,
} from "@/engine/case";
import {
  HOLD_MINUTES,
  holdValid,
  matchConstraints,
  priceAllowed,
  SUBSIDY_CAP_PENCE,
} from "@/engine/policy";
import { clock } from "@/lib/format";
import {
  defineTool,
  type Change,
  type Data,
  type PolicyDeny,
  type Rec,
  type Scenario,
} from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BOOKING = "BK-1042";
const CASE = "CASE-1042";
const PAID = 30000;
const ORIGINAL = "PROV-quickmove";

export const CANCELLATION_TEXT =
  "Van broke down, can't do Friday's job at Flat 3.";
export const CUSTOMER_TEXT =
  "I hand the keys back Friday 5pm so everything must be out by 3pm. It's a full 2-bed on the 3rd floor with no lift, so I need two movers and the Luton. I can't pay more.";

// Search returns providers in this order, minus the one that cancelled.
const PROVIDERS: ProviderData[] = [
  {
    providerId: "PROV-brightnest",
    name: "BrightNest",
    twoMovers: true,
    luton: true,
    rating: 4.9,
    connected: false,
    _sim: { quotePence: 34000, floorPence: 34000 },
  },
  {
    providerId: "PROV-clearhome",
    name: "ClearHome Removals",
    twoMovers: true,
    luton: true,
    rating: 4.8,
    connected: true,
    _sim: { quotePence: 29000, floorPence: 28000 },
  },
  {
    providerId: "PROV-pronto",
    name: "Pronto Vans",
    twoMovers: true,
    luton: false,
    rating: 4.7,
    connected: false,
  },
  {
    providerId: "PROV-freshco",
    name: "FreshCo",
    twoMovers: true,
    luton: true,
    rating: 4.6,
    connected: false,
  },
  {
    providerId: ORIGINAL,
    name: "QuickMove Vans",
    twoMovers: true,
    luton: true,
    rating: 4.4,
    connected: false,
  },
];

// [slotId, providerId, start hour, end hour] on the booking's Friday, London time.
// FreshCo has no slot because it is fully booked.
const SLOTS: [string, string, number, number][] = [
  ["SLOT-brightnest-fri10", "PROV-brightnest", 10, 12],
  ["SLOT-clearhome-fri13", "PROV-clearhome", 13, 15],
  ["SLOT-pronto-fri09", "PROV-pronto", 9, 11],
  ["SLOT-quickmove-fri10", ORIGINAL, 10, 12],
];

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
});
function londonParts(t: Date) {
  const p = Object.fromEntries(
    LONDON.formatToParts(t).map((x) => [x.type, x.value]),
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
  };
}
// London is UTC or UTC+1, so the hour read back at the UTC guess gives the offset.
// ponytail: wrong only inside the 1am clock-change hour; every slot is between 9am and 3pm.
function londonAt(y: number, m: number, d: number, hour: number): Date {
  const guess = Date.UTC(y, m - 1, d, hour);
  const offset = (londonParts(new Date(guess)).h - hour + 24) % 24;
  return new Date(guess - offset * HOUR);
}

export function nextFriday(now: Date, hour: number): Date {
  const { y, m, d } = londonParts(now);
  const ahead = (5 - new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 7) % 7;
  const at = londonAt(y, m, d + ahead, hour);
  return at.getTime() - now.getTime() >= DAY
    ? at
    : londonAt(y, m, d + ahead + 7, hour);
}

export function scriptedConstraintsFor(
  caseData: CaseData,
  booking: BookingData,
): Constraints {
  const { y, m, d } = londonParts(new Date(booking.startsAt));
  return {
    doneBy: londonAt(y, m, d, 15).toISOString(),
    twoMovers: true,
    luton: true,
    maxPricePence: caseData.paidPence,
    preferSameTime: true,
    notes: "Keys back Fri 17:00. 3rd floor, no lift. Full 2-bed.",
  };
}

export function rejectedFrom(
  deny: PolicyDeny,
  providerId: string,
  pricePence: number,
  now: Date,
): Rejected {
  return {
    providerId,
    pricePence,
    reason: deny.reason,
    message: deny.message,
    at: now.toISOString(),
  };
}

const nameOf = (providerId: string) =>
  PROVIDERS.find((p) => p.providerId === providerId)?.name ?? providerId;
const caseChange = (c: CaseData): Change => ({
  system: CASE_SYSTEM,
  recordId: c.caseId,
  data: c,
});
const putOffer = (offers: Offer[], o: Offer) =>
  offers.some((x) => x.offerId === o.offerId)
    ? offers.map((x) => (x.offerId === o.offerId ? o : x))
    : [...offers, o];
function providerOf(recs: Rec[], providerId: string): ProviderData {
  const p = providersOf(recs).find((r) => r.data.providerId === providerId);
  if (!p) throw new Error(`Unknown provider ${providerId}.`);
  return p.data;
}
const slotsFor = (recs: Rec[], providerId: string): SlotData[] =>
  slotsOf(recs)
    .map((s) => s.data)
    .filter((s) => s.providerId === providerId);

const CaseArgs = z.object({ caseId: z.string() });
const RecordConstraintsArgs = z.object({
  caseId: z.string(),
  doneBy: z.iso.datetime(),
  twoMovers: z.boolean(),
  luton: z.boolean(),
  maxPricePence: z.number().int().positive().max(100000),
  preferSameTime: z.boolean(),
  notes: z.string().max(500),
});
const OfferArgs = z.object({
  caseId: z.string(),
  providerId: z.string(),
  slotId: z.string(),
  pricePence: z.number().int().positive().max(100000).optional(),
});

const BRIGHTNEST = {
  caseId: CASE,
  providerId: "PROV-brightnest",
  slotId: "SLOT-brightnest-fri10",
};
const CLEARHOME = {
  caseId: CASE,
  providerId: "PROV-clearhome",
  slotId: "SLOT-clearhome-fri13",
};
const PROPOSAL =
  "ClearHome Removals can do your move on Friday from 1pm to 3pm, so everything is out before your 3pm deadline. They are sending two movers and a Luton van. The price is £280, so £20 of the £300 you paid comes back to you.";
const TO_MAYA =
  "Hi Maya, sorry, QuickMove had to cancel Friday's move. I have found ClearHome Removals for Friday 1pm to 3pm, done before you hand the keys back. Please accept or decline the proposal before the hold time shown on it. If you decline, your £300 is refunded in full.";
// Floors and the subsidy cap stay out of the prompt so a live run meets the policy denial.
const LIVE_SYSTEM =
  "You are the ArchOS Recovery Agent for Larkspur Home Services, a man and van marketplace in London. A provider cancelled a booking. Read the case, record the customer's constraints, find a replacement provider that meets them, agree a price, and propose the held offer with proposeRecovery. Stop after a successful proposeRecovery. You cannot take payments, give refunds or accept on the customer's behalf. ArchOS handles money after the customer accepts.";

export const providerCancel: Scenario = {
  id: "provider-cancel",
  name: "Provider cancelled",
  short: "Booking rescue",
  agent: {
    id: "agt_archos_01",
    name: "ArchOS Recovery Agent",
    role: "Rescues failed bookings",
  },
  task: null,
  targetLabel: "booking",
  systemsLabel: "the marketplace and Stripe",
  authoritative: "marketplace",
  unit: "GBP",
  live: (c) => ({
    system: LIVE_SYSTEM,
    user: `Case ${c.caseId}, booking ${c.bookingId}. Provider's message: "${c.cancellationText ?? "none"}". Customer's message: "${c.customerText ?? "none"}". Rescue deadline: ${c.rescueDeadline}.`,
  }),

  seed(now) {
    const start = nextFriday(now, 10);
    // Every slot is on the booking's Friday, and no clock change falls between 9am and 3pm.
    const at = (hour: number) =>
      new Date(start.getTime() + (hour - 10) * HOUR).toISOString();
    const rec = (
      recordId: string,
      data: Data,
      system = MARKET,
      target: string | null = null,
    ): Rec => ({ system, recordId, target, data, version: 1 });
    const booking: BookingData = {
      bookingId: BOOKING,
      customer: "Maya Chen",
      client: null,
      service: "2-bed flat move",
      address: "Flat 3, 12 Mare Street, London E8",
      startsAt: at(10),
      endsAt: at(12),
      pricePence: PAID,
      providerId: ORIGINAL,
      slotId: "SLOT-quickmove-fri10",
      status: "confirmed",
    };
    const shell: CaseData = {
      caseId: CASE,
      bookingId: BOOKING,
      status: "booked",
      paidPence: PAID,
      originalProviderId: ORIGINAL,
      originalProviderPaid: false,
      cancellationText: null,
      customerText: null,
      rescueDeadline: new Date(now.getTime() + 2 * HOUR).toISOString(),
      constraints: null,
      extraction: null,
      offers: [],
      rejected: [],
      consent: null,
      messages: [],
      fulfilment: null,
      replacementProviderId: null,
    };
    return [
      rec(BOOKING, booking, MARKET, BOOKING),
      ...PROVIDERS.map((p) => rec(p.providerId, p)),
      ...SLOTS.map(([slotId, providerId, from, to]) => {
        const booked = providerId === ORIGINAL;
        const slot: SlotData = {
          slotId,
          providerId,
          startsAt: at(from),
          endsAt: at(to),
          status: booked ? "booked" : "free",
          bookingId: booked ? BOOKING : null,
        };
        return rec(slotId, slot);
      }),
      rec(CASE, shell, CASE_SYSTEM),
    ];
  },

  tools: {
    readCase: defineTool({
      kind: "read",
      description:
        "Read the case: the booking, what the customer paid, the provider's and the customer's messages, and the rescue deadline.",
      args: CaseArgs,
      run: ({ caseId }, recs) => {
        const c = caseOf(recs, caseId).data;
        const b = bookingOf(recs, c.bookingId).data;
        return {
          result: {
            caseId: c.caseId,
            status: c.status,
            booking: {
              bookingId: b.bookingId,
              customer: b.customer,
              service: b.service,
              address: b.address,
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              pricePence: b.pricePence,
              provider: nameOf(b.providerId),
              status: b.status,
            },
            paidPence: c.paidPence,
            cancellationText: c.cancellationText,
            customerText: c.customerText,
            rescueDeadline: c.rescueDeadline,
            constraints: c.constraints,
          },
          changes: [],
        };
      },
    }),

    recordConstraints: defineTool({
      kind: "mutate",
      description:
        "Store the customer's constraints on the case as structured fields. Later steps read only these fields.",
      args: RecordConstraintsArgs,
      run: ({ caseId, ...constraints }, recs) => ({
        result: { recorded: true, constraints },
        changes: [caseChange({ ...caseOf(recs, caseId).data, constraints })],
      }),
    }),

    searchProviders: defineTool({
      kind: "read",
      description:
        "Search replacement providers. Each result says whether it meets the recorded constraints, why, and which slot fits.",
      args: CaseArgs,
      run: ({ caseId }, recs) => {
        const c = caseOf(recs, caseId).data;
        const constraints = c.constraints;
        if (!constraints)
          throw new Error(
            "Record the customer's constraints before searching.",
          );
        return {
          result: PROVIDERS.filter(
            (p) => p.providerId !== c.originalProviderId,
          ).map((p) => {
            const live = providerOf(recs, p.providerId);
            return {
              ...publicProvider(live),
              ...matchConstraints(
                constraints,
                live,
                slotsFor(recs, p.providerId),
              ),
            };
          }),
          changes: [],
        };
      },
    }),

    requestOffer: defineTool({
      kind: "mutate",
      description:
        "Ask a provider about one of their slots. Without pricePence it returns their quote. With pricePence the provider either accepts and holds the slot, or counters with their quote.",
      args: OfferArgs,
      policy: ({ caseId, providerId, pricePence }, recs) => {
        if (pricePence === undefined) return null;
        const constraints = caseOf(recs, caseId).data.constraints;
        if (!constraints)
          return {
            reason: "hard_constraint",
            message: "No constraints are recorded for this case yet.",
          };
        const over = priceAllowed(
          constraints,
          pricePence,
          SUBSIDY_CAP_PENCE(),
          caseOf(recs, caseId).data.paidPence,
        );
        if (over) return over;
        const p = providerOf(recs, providerId);
        const match = matchConstraints(
          constraints,
          p,
          slotsFor(recs, providerId),
        );
        return match.eligible
          ? null
          : { reason: "hard_constraint", message: `${p.name}: ${match.why}` };
      },
      run: ({ caseId, providerId, slotId, pricePence }, recs, now) => {
        const c = caseOf(recs, caseId).data;
        const p = providerOf(recs, providerId);
        const slot = slotsOf(recs).find(
          (s) => s.recordId === slotId && s.data.providerId === providerId,
        );
        if (!slot) throw new Error(`${p.name} has no slot ${slotId}.`);
        if (slot.data.status !== "free")
          throw new Error(`${p.name}'s slot ${slotId} is ${slot.data.status}.`);
        const sim = p._sim;
        if (!sim) throw new Error(`${p.name} has not shared a price.`);
        const offerId = `OFR-${providerId}`;
        const quoted: Offer = {
          offerId,
          providerId,
          slotId,
          quotePence: sim.quotePence,
          pricePence: null,
          state: "quoted",
          slotVersion: null,
          holdExpiresAt: null,
          createdAt:
            c.offers.find((o) => o.offerId === offerId)?.createdAt ??
            now.toISOString(),
        };
        if (pricePence === undefined || pricePence < sim.floorPence)
          return {
            result: {
              status: pricePence === undefined ? "quoted" : "countered",
              quotePence: sim.quotePence,
            },
            changes: [caseChange({ ...c, offers: putOffer(c.offers, quoted) })],
          };
        // persist bumps the slot's version for the hold write below, and slotFree compares against that new version.
        const held: Offer = {
          ...quoted,
          pricePence,
          state: "held",
          slotVersion: slot.version + 1,
          holdExpiresAt: new Date(
            now.getTime() + HOLD_MINUTES() * 60_000,
          ).toISOString(),
        };
        return {
          result: {
            status: "held",
            offerId,
            pricePence,
            holdExpiresAt: held.holdExpiresAt,
          },
          changes: [
            caseChange({ ...c, offers: putOffer(c.offers, held) }),
            {
              system: MARKET,
              recordId: slot.recordId,
              data: { ...slot.data, status: "held" },
            },
          ],
        };
      },
    }),

    sendMessage: defineTool({
      kind: "mutate",
      description:
        "Send a message to the customer, or to a provider (providerId required).",
      args: z.object({
        caseId: z.string(),
        to: z.enum(["customer", "provider"]),
        providerId: z.string().optional(),
        text: z.string().max(600),
      }),
      run: ({ caseId, to, providerId, text }, recs, now) => {
        const c = caseOf(recs, caseId).data;
        if (to === "provider" && !providerId)
          throw new Error("Say which provider the message is for.");
        const party =
          to === "provider"
            ? providerOf(recs, providerId ?? "").name
            : bookingOf(recs, c.bookingId).data.customer;
        const next = withMessage(
          c,
          { from: "agent", to, party, text, kind: "text" },
          now,
        );
        return {
          result: { sent: true, to: party },
          changes: [caseChange(next)],
        };
      },
    }),

    proposeRecovery: defineTool({
      kind: "mutate",
      description:
        "Propose a held offer to the customer. They accept or decline; money moves only after that.",
      args: z.object({
        caseId: z.string(),
        offerId: z.string(),
        summary: z.string().max(600),
      }),
      run: ({ caseId, offerId, summary }, recs, now) => {
        const c = caseOf(recs, caseId).data;
        const offer = c.offers.find((o) => o.offerId === offerId);
        if (offer?.state !== "held" || !offer.holdExpiresAt)
          throw new Error(`Offer ${offerId} has no hold to propose.`);
        if (holdValid(offer, now))
          throw new Error(
            `The hold on ${offerId} expired at ${clock(offer.holdExpiresAt)}.`,
          );
        const next = withMessage(
          { ...c, offers: putOffer(c.offers, { ...offer, state: "proposed" }) },
          {
            from: "agent",
            to: "customer",
            party: bookingOf(recs, c.bookingId).data.customer,
            text: `${summary} Held for you until ${clock(offer.holdExpiresAt)}.`,
            kind: "proposal",
          },
          now,
        );
        return {
          result: {
            status: "proposed",
            offerId,
            pricePence: offer.pricePence,
            holdExpiresAt: offer.holdExpiresAt,
          },
          changes: [caseChange(next)],
        };
      },
    }),
  },

  script: [
    {
      step: "search",
      tool: "searchProviders",
      args: { caseId: CASE },
      say: "Looking for providers who can clear Flat 3 by 3pm on Friday with two movers and a Luton van.",
    },
    {
      step: "boundary",
      tool: "requestOffer",
      args: BRIGHTNEST,
      say: "BrightNest has the original 10am slot. Asking for their price.",
    },
    {
      step: "boundary",
      tool: "requestOffer",
      args: { ...BRIGHTNEST, pricePence: 34000 },
      say: "BrightNest quoted £340. Trying to book them at that price.",
    },
    {
      step: "negotiate",
      tool: "sendMessage",
      args: {
        caseId: CASE,
        to: "provider",
        providerId: "PROV-clearhome",
        text: "Hi ClearHome, can you do a 2-bed flat move from Flat 3, 12 Mare Street, London E8 this Friday from 1pm to 3pm? It is on the 3rd floor with no lift, so it needs two movers and a Luton van.",
      },
      say: "BrightNest was blocked for going over what Maya paid. Contacting ClearHome, the next provider that meets every constraint.",
    },
    {
      step: "negotiate",
      tool: "requestOffer",
      args: CLEARHOME,
      say: "Asking ClearHome for their price for Friday 1pm.",
    },
    {
      step: "negotiate",
      tool: "requestOffer",
      args: { ...CLEARHOME, pricePence: 28000 },
      say: "ClearHome quoted £290. Offering £280, which gives Maya £20 back.",
    },
    {
      step: "propose",
      tool: "proposeRecovery",
      args: { caseId: CASE, offerId: "OFR-PROV-clearhome", summary: PROPOSAL },
      say: "ClearHome accepted £280 and is holding the slot. Proposing it to Maya.",
    },
    {
      step: "propose",
      tool: "sendMessage",
      args: { caseId: CASE, to: "customer", text: TO_MAYA },
      say: "Telling Maya what happened and what she needs to do.",
    },
  ],

  plan: () => ({
    kind: "manual",
    action: null,
    reason: "Not used for booking rescues.",
    owner: null,
    why: null,
  }),
  compensate: () => ({
    ok: false,
    detail: "Not used for booking rescues.",
    changes: [],
  }),
  verify: () => false,
  exposure: (target) => (target === BOOKING ? PAID : 0),

  view(target, current) {
    const b = bookingOf(current, target).data;
    const status = {
      confirmed: "Confirmed",
      provider_cancelled: "Provider cancelled",
      cancelled: "Cancelled",
    }[b.status];
    return {
      title: `${b.bookingId} ${b.customer}`,
      subtitle: `${b.service}, ${nameOf(b.providerId)}`,
      status,
      stage: b.status,
      lane: null,
    };
  },
};
