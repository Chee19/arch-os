import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BookingData,
  CaseData,
  Consent,
  Constraints,
  Offer,
  ProviderData,
  SlotData,
} from "@/engine/case";
import type { OpKind, OpState, PaymentOp } from "@/engine/docs";
import {
  allocate,
  consentValid,
  fundingOk,
  HOLD_MINUTES,
  holdValid,
  matchConstraints,
  noConflictingMoney,
  priceAllowed,
  revalidate,
  slotFree,
  SUBSIDY_CAP_PENCE,
  type AllocCase,
  type AllocSlot,
  type ChargeFacts,
  type RevalidateCtx,
} from "@/engine/policy";
import { ConfigError } from "@/engine/errors";
import type { Rec } from "@/scenarios/types";

const NOW = new Date("2026-10-16T09:00:00Z");

const constraints = (o: Partial<Constraints> = {}): Constraints => ({
  doneBy: "2026-10-16T14:00:00Z",
  petFriendly: true,
  oven: true,
  maxPricePence: 30000,
  preferSameTime: true,
  notes: "",
  ...o,
});
const provider = (o: Partial<ProviderData> = {}): ProviderData => ({
  providerId: "clearhome",
  name: "ClearHome Cleaning",
  petFriendly: true,
  oven: true,
  rating: 4.8,
  connected: true,
  ...o,
});
const slot = (o: Partial<SlotData> = {}): SlotData => ({
  slotId: "SLOT-clearhome-fri13",
  providerId: "clearhome",
  startsAt: "2026-10-16T12:00:00Z",
  endsAt: "2026-10-16T14:00:00Z",
  status: "free",
  bookingId: null,
  ...o,
});
const offer = (o: Partial<Offer> = {}): Offer => ({
  offerId: "OFR-clearhome",
  providerId: "clearhome",
  slotId: "SLOT-clearhome-fri13",
  quotePence: 29000,
  pricePence: 28000,
  state: "proposed",
  slotVersion: 3,
  holdExpiresAt: "2026-10-16T09:30:00Z",
  createdAt: "2026-10-16T09:00:00Z",
  ...o,
});
const consent = (o: Partial<Consent> = {}): Consent => ({
  offerId: "OFR-clearhome",
  pricePence: 28000,
  decision: "accept",
  at: "2026-10-16T09:05:00Z",
  expiresAt: "2026-10-16T09:30:00Z",
  ...o,
});
const slotRec = (version = 3): Rec => ({
  system: "marketplace",
  recordId: "SLOT-clearhome-fri13",
  target: null,
  data: slot({ status: "held" }),
  version,
});
const booking = (o: Partial<BookingData> = {}): BookingData => ({
  bookingId: "BK-1042",
  customer: "Maya Chen",
  client: null,
  service: "End-of-tenancy clean",
  address: "Flat 3",
  startsAt: "2026-10-16T09:00:00Z",
  endsAt: "2026-10-16T13:00:00Z",
  pricePence: 30000,
  providerId: "clearhome",
  slotId: "SLOT-clearhome-fri13",
  status: "confirmed",
  ...o,
});
const caseData = (o: Partial<CaseData> = {}): CaseData => ({
  caseId: "CASE-1042",
  bookingId: "BK-1042",
  status: "open",
  paidPence: 30000,
  originalProviderId: "quickshine",
  originalProviderPaid: false,
  cancellationText: null,
  customerText: null,
  rescueDeadline: "2026-10-16T11:00:00Z",
  constraints: constraints(),
  extraction: null,
  offers: [offer()],
  rejected: [],
  consent: consent(),
  messages: [],
  fulfilment: null,
  replacementProviderId: "clearhome",
  ...o,
});
const op = (
  kind: OpKind,
  state: OpState,
  attempt: number,
  amountPence: number,
): PaymentOp => ({
  opId: `run1:CASE-1042:${kind}:${attempt}`,
  runId: "run1",
  caseId: "CASE-1042",
  kind,
  attempt,
  amountPence,
  request: {},
  state,
  stripeId: state === "intended" ? null : `x_${kind}${attempt}`,
  observed: null,
  error: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const charge = (o: Partial<ChargeFacts> = {}): ChargeFacts => ({
  amount: 30000,
  amountRefunded: 0,
  succeeded: true,
  ...o,
});

describe("matchConstraints", () => {
  it("is eligible with a free slot ending by doneBy, and says when", () => {
    const m = matchConstraints(constraints(), provider(), [slot()]);
    expect(m).toEqual({
      providerId: "clearhome",
      eligible: true,
      why: "Free Fri 13:00",
      slotId: "SLOT-clearhome-fri13",
    });
  });
  it("rejects a provider without an oven", () => {
    const m = matchConstraints(
      constraints(),
      provider({ providerId: "sparkle", oven: false }),
      [slot({ providerId: "sparkle" })],
    );
    expect(m).toMatchObject({
      eligible: false,
      why: "No oven cleaning",
      slotId: null,
    });
  });
  it("rejects a provider that is not pet friendly only when required", () => {
    const p = provider({ petFriendly: false });
    expect(matchConstraints(constraints(), p, [slot()])).toMatchObject({
      eligible: false,
      why: "Not pet friendly",
    });
    expect(
      matchConstraints(constraints({ petFriendly: false }), p, [slot()])
        .eligible,
    ).toBe(true);
  });
  it("ignores the oven when not required", () => {
    expect(
      matchConstraints(
        constraints({ oven: false }),
        provider({ oven: false }),
        [slot()],
      ).eligible,
    ).toBe(true);
  });
  it("rejects when no slot is free before doneBy", () => {
    const late = slot({ endsAt: "2026-10-16T14:30:00Z" });
    expect(matchConstraints(constraints(), provider(), [late])).toMatchObject({
      eligible: false,
      why: "No free slot before Fri 15:00",
    });
    expect(matchConstraints(constraints(), provider(), [])).toMatchObject({
      eligible: false,
      why: "No free slot before Fri 15:00",
    });
  });
  it("ignores held, booked and other providers' slots", () => {
    const slots = [
      slot({ status: "held" }),
      slot({ status: "booked" }),
      slot({ providerId: "other" }),
    ];
    expect(matchConstraints(constraints(), provider(), slots).eligible).toBe(
      false,
    );
  });
});

describe("priceAllowed", () => {
  it("denies a 4000 subsidy against the 2000 cap with the business message", () => {
    expect(priceAllowed(constraints(), 34000, 2000, 30000)).toEqual({
      reason: "over_subsidy",
      message: "Needs £40 subsidy, cap is £20",
    });
  });
  it.each([28000, 29000, 30000, 31000, 32000])("allows price %i", (price) => {
    expect(priceAllowed(constraints(), price, 2000, 30000)).toBeNull();
  });
  it("denies 32001", () => {
    expect(priceAllowed(constraints(), 32001, 2000, 30000)?.reason).toBe(
      "over_subsidy",
    );
  });
  it("measures subsidy against what was paid, not an inflated max price", () => {
    expect(
      priceAllowed(constraints({ maxPricePence: 32000 }), 34000, 2000, 30000),
    ).toEqual({
      reason: "over_subsidy",
      message: "Needs £40 subsidy, cap is £20",
    });
  });
  it("allows a price one pound over max when paid covers it", () => {
    expect(
      priceAllowed(constraints({ maxPricePence: 30000 }), 31000, 2000, 30000),
    ).toBeNull();
  });
});

describe("holdValid", () => {
  it("passes before expiry", () => expect(holdValid(offer(), NOW)).toBeNull());
  it("denies at and after expiry", () => {
    expect(holdValid(offer(), new Date("2026-10-16T09:30:00Z"))?.reason).toBe(
      "hold_expired",
    );
    expect(holdValid(offer(), new Date("2026-10-16T10:00:00Z"))?.reason).toBe(
      "hold_expired",
    );
  });
  it("denies an offer with no hold", () => {
    expect(holdValid(offer({ holdExpiresAt: null }), NOW)?.reason).toBe(
      "hold_expired",
    );
  });
});

describe("consentValid", () => {
  it("passes for a matching, unexpired accept", () =>
    expect(consentValid(consent(), offer(), NOW)).toBeNull());
  it("denies missing consent", () =>
    expect(consentValid(null, offer(), NOW)?.reason).toBe("consent_expired"));
  it("denies a price mismatch", () => {
    expect(
      consentValid(consent({ pricePence: 29000 }), offer(), NOW)?.reason,
    ).toBe("consent_expired");
  });
  it("denies an offer mismatch", () => {
    expect(
      consentValid(consent({ offerId: "OFR-other" }), offer(), NOW)?.reason,
    ).toBe("consent_expired");
  });
  it("denies a decline", () => {
    expect(
      consentValid(consent({ decision: "decline" }), offer(), NOW)?.reason,
    ).toBe("consent_expired");
  });
  it("denies after expiry", () => {
    expect(
      consentValid(consent(), offer(), new Date("2026-10-16T09:30:00Z"))
        ?.reason,
    ).toBe("consent_expired");
  });
});

describe("slotFree", () => {
  it("passes when the version matches", () =>
    expect(slotFree(offer(), slotRec(3))).toBeNull());
  it("denies on version drift", () =>
    expect(slotFree(offer(), slotRec(4))?.reason).toBe("slot_taken"));
  it("denies a missing slot", () =>
    expect(slotFree(offer(), undefined)?.reason).toBe("slot_taken"));
});

describe("noConflictingMoney", () => {
  it("passes when Stripe matches the ops", () => {
    expect(
      noConflictingMoney(charge({ amountRefunded: 2000 }), [
        op("refund", "succeeded", 1, 2000),
      ]),
    ).toBeNull();
  });
  it("passes when a pending refund is not yet visible in Stripe", () => {
    expect(
      noConflictingMoney(charge({ amountRefunded: 0 }), [
        op("refund", "pending", 1, 2000),
      ]),
    ).toBeNull();
  });
  it("denies a refund made outside the ops", () => {
    const d = noConflictingMoney(charge({ amountRefunded: 1000 }), []);
    expect(d?.reason).toBe("conflicting_change");
  });
  it("counts full_refund ops", () => {
    expect(
      noConflictingMoney(charge({ amountRefunded: 30000 }), [
        op("full_refund", "succeeded", 1, 30000),
      ]),
    ).toBeNull();
  });
  it("never counts failed ops", () => {
    expect(
      noConflictingMoney(charge({ amountRefunded: 2000 }), [
        op("refund", "failed", 1, 2000),
      ])?.reason,
    ).toBe("conflicting_change");
  });
});

describe("fundingOk", () => {
  const base = {
    originalProviderPaid: false,
    charge: charge(),
    ops: [] as PaymentOp[],
    amount: 2000,
  };
  it("passes for a funded refund", () => expect(fundingOk(base)).toBeNull());
  it("denies when the original provider was paid", () => {
    expect(fundingOk({ ...base, originalProviderPaid: true })?.reason).toBe(
      "unfunded",
    );
  });
  it("denies when the charge has not succeeded", () => {
    expect(
      fundingOk({ ...base, charge: charge({ succeeded: false }) })?.reason,
    ).toBe("unfunded");
  });
  it("pending refunds and transfers count against funds", () => {
    const ops = [
      op("refund", "pending", 1, 2000),
      op("transfer", "pending", 1, 22400),
    ];
    expect(fundingOk({ ...base, ops, amount: 5600 })).toBeNull();
    expect(fundingOk({ ...base, ops, amount: 5601 })?.reason).toBe("unfunded");
  });
  it("failed ops do not count", () => {
    const ops = [op("transfer", "failed", 1, 22400)];
    expect(fundingOk({ ...base, ops, amount: 30000 })).toBeNull();
  });
  it("uses the larger of Stripe's refunded amount and the ops", () => {
    const c = charge({ amountRefunded: 3000 });
    const ops = [op("refund", "succeeded", 1, 2000)];
    expect(fundingOk({ ...base, charge: c, ops, amount: 27000 })).toBeNull();
    expect(fundingOk({ ...base, charge: c, ops, amount: 27001 })?.reason).toBe(
      "unfunded",
    );
  });
  it("counts full_refund ops as refunds", () => {
    const ops = [op("full_refund", "pending", 1, 30000)];
    expect(fundingOk({ ...base, ops, amount: 1 })?.reason).toBe("unfunded");
  });
});

describe("revalidate secure", () => {
  const ctx = (o: Partial<RevalidateCtx> = {}): RevalidateCtx => ({
    now: NOW,
    caseData: caseData(),
    offer: offer(),
    slot: slotRec(3),
    booking: booking({
      providerId: "quickshine",
      status: "provider_cancelled",
    }),
    charge: charge(),
    ops: [],
    amount: 2000,
    ...o,
  });
  it("passes when everything holds", () =>
    expect(revalidate("secure", ctx())).toBeNull());
  it("denies an expired hold", () => {
    expect(
      revalidate("secure", ctx({ now: new Date("2026-10-16T09:31:00Z") }))
        ?.reason,
    ).toBe("hold_expired");
  });
  it("denies missing consent", () => {
    expect(
      revalidate("secure", ctx({ caseData: caseData({ consent: null }) }))
        ?.reason,
    ).toBe("consent_expired");
  });
  it("denies slot version drift", () => {
    expect(revalidate("secure", ctx({ slot: slotRec(9) }))?.reason).toBe(
      "slot_taken",
    );
  });
  it("denies a staff refund seen in Stripe", () => {
    expect(
      revalidate("secure", ctx({ charge: charge({ amountRefunded: 500 }) }))
        ?.reason,
    ).toBe("conflicting_change");
  });
  it("denies when the original provider was paid", () => {
    expect(
      revalidate(
        "secure",
        ctx({ caseData: caseData({ originalProviderPaid: true }) }),
      )?.reason,
    ).toBe("unfunded");
  });
});

describe("revalidate settle", () => {
  const fulfilled = caseData({
    fulfilment: { at: "2026-10-16T10:00:00Z", simulated: true },
  });
  const ctx = (o: Partial<RevalidateCtx> = {}): RevalidateCtx => ({
    now: new Date("2026-10-16T11:00:00Z"),
    caseData: fulfilled,
    offer: offer({ state: "secured" }),
    slot: slotRec(4),
    booking: booking(),
    charge: charge({ amountRefunded: 2000 }),
    ops: [
      op("charge", "succeeded", 1, 30000),
      op("refund", "succeeded", 1, 2000),
    ],
    amount: 22400,
    ...o,
  });
  it("passes after the hold has expired (settle does not check the hold)", () =>
    expect(revalidate("settle", ctx())).toBeNull());
  it("denies when the booking moved to another provider", () => {
    expect(
      revalidate(
        "settle",
        ctx({ booking: booking({ providerId: "brightnest" }) }),
      )?.reason,
    ).toBe("slot_taken");
  });
  it("denies when the booking is no longer confirmed", () => {
    expect(
      revalidate("settle", ctx({ booking: booking({ status: "cancelled" }) }))
        ?.reason,
    ).toBe("slot_taken");
  });
  it("denies with no fulfilment event", () => {
    expect(revalidate("settle", ctx({ caseData: caseData() }))).toEqual({
      reason: "conflicting_change",
      message: "No fulfilment event",
    });
  });
  it("denies a conflicting refund", () => {
    expect(
      revalidate("settle", ctx({ charge: charge({ amountRefunded: 5000 }) }))
        ?.reason,
    ).toBe("conflicting_change");
  });
  it("denies an unfunded transfer", () => {
    expect(revalidate("settle", ctx({ amount: 28001 }))?.reason).toBe(
      "unfunded",
    );
  });
});

describe("allocate", () => {
  const kase = (
    target: string,
    startsAt: string,
    deadline: string,
    incentivePence = 2000,
  ): AllocCase => ({ target, startsAt, deadline, incentivePence });
  const aSlot = (slotId: string, endsAt: string): AllocSlot => ({
    slotId,
    providerId: "p",
    startsAt: endsAt.replace(/T\d\d/, "T09"),
    endsAt,
  });
  const cases = [
    kase("BK-2026", "2026-10-22T09:00:00Z", "2026-10-22T15:00:00Z"),
    kase("BK-2019", "2026-10-20T09:00:00Z", "2026-10-20T15:00:00Z"),
    kase("BK-2009", "2026-10-19T09:00:00Z", "2026-10-19T15:00:00Z"),
  ];
  const slots = [
    aSlot("S-B", "2026-10-20T12:00:00Z"),
    aSlot("S-A", "2026-10-19T12:00:00Z"),
  ];
  const budget = { budgetPence: 6000, committedPence: 0 };

  it("serves the earliest service time first regardless of input order", () => {
    const r = allocate(cases, slots, budget);
    expect(r.assigned.map((a) => [a.target, a.slotId])).toEqual([
      ["BK-2009", "S-A"],
      ["BK-2019", "S-B"],
    ]);
    expect(r.unassigned).toEqual([{ target: "BK-2026", reason: "no_slot" }]);
    expect(r.committedPence).toBe(4000);
  });
  it("never assigns a slot twice", () => {
    const one = [aSlot("S-A", "2026-10-19T12:00:00Z")];
    const r = allocate(cases, one, budget);
    expect(new Set(r.assigned.map((a) => a.slotId)).size).toBe(
      r.assigned.length,
    );
    expect(r.assigned).toHaveLength(1);
  });
  it("does not use a slot ending after the deadline", () => {
    const r = allocate(
      [kase("BK-1", "2026-10-19T09:00:00Z", "2026-10-19T15:00:00Z")],
      [aSlot("S-late", "2026-10-19T16:00:00Z")],
      budget,
    );
    expect(r.assigned).toEqual([]);
    expect(r.unassigned).toEqual([{ target: "BK-1", reason: "no_slot" }]);
  });
  it("respects the budget including what is already committed", () => {
    const r = allocate(cases, slots, {
      budgetPence: 3000,
      committedPence: 1000,
    });
    expect(r.assigned.map((a) => a.target)).toEqual(["BK-2009"]);
    expect(r.unassigned).toContainEqual({
      target: "BK-2019",
      reason: "over_budget",
    });
    expect(r.committedPence).toBe(3000);
  });
  it("stops assigning once the budget is hit, even for a zero-incentive later case", () => {
    const three = [
      kase("BK-1", "2026-10-19T09:00:00Z", "2026-10-19T15:00:00Z", 2000),
      kase("BK-2", "2026-10-19T10:00:00Z", "2026-10-19T15:00:00Z", 2000),
      kase("BK-3", "2026-10-19T11:00:00Z", "2026-10-19T15:00:00Z", 0),
    ];
    const s = [
      aSlot("S1", "2026-10-19T12:00:00Z"),
      aSlot("S2", "2026-10-19T13:00:00Z"),
      aSlot("S3", "2026-10-19T14:00:00Z"),
    ];
    const r = allocate(three, s, { budgetPence: 2000, committedPence: 0 });
    expect(r.assigned.map((a) => a.target)).toEqual(["BK-1"]);
    expect(r.unassigned).toEqual([
      { target: "BK-2", reason: "over_budget" },
      { target: "BK-3", reason: "over_budget" },
    ]);
  });
  it("carries the incentive and provider on each assignment", () => {
    const r = allocate([cases[2]], [slots[1]], budget);
    expect(r.assigned[0]).toEqual({
      target: "BK-2009",
      slotId: "S-A",
      providerId: "p",
      incentivePence: 2000,
    });
  });
});

describe("config defaults", () => {
  afterEach(() => {
    delete process.env.SUBSIDY_CAP_PENCE;
    delete process.env.HOLD_MINUTES;
    vi.unstubAllEnvs();
  });
  it("defaults to 2000 pence and 30 minutes", () => {
    expect(SUBSIDY_CAP_PENCE()).toBe(2000);
    expect(HOLD_MINUTES()).toBe(30);
  });
  it("reads the environment at call time", () => {
    process.env.SUBSIDY_CAP_PENCE = "500";
    process.env.HOLD_MINUTES = "5";
    expect(SUBSIDY_CAP_PENCE()).toBe(500);
    expect(HOLD_MINUTES()).toBe(5);
  });
  it("rejects a non-numeric cap instead of allowing every price", () => {
    vi.stubEnv("SUBSIDY_CAP_PENCE", "abc");
    expect(() => SUBSIDY_CAP_PENCE()).toThrow(ConfigError);
  });
  it("rejects a fractional cap", () => {
    vi.stubEnv("SUBSIDY_CAP_PENCE", "12.5");
    expect(() => SUBSIDY_CAP_PENCE()).toThrow(ConfigError);
  });
  it("returns the default when the cap is unset", () => {
    vi.stubEnv("SUBSIDY_CAP_PENCE", undefined);
    expect(SUBSIDY_CAP_PENCE()).toBe(2000);
  });
  it("rejects zero hold minutes", () => {
    vi.stubEnv("HOLD_MINUTES", "0");
    expect(() => HOLD_MINUTES()).toThrow(ConfigError);
  });
});
