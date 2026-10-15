import { describe, expect, it } from "vitest";
import type {
  BookingData,
  CaseData,
  Offer,
  ProviderData,
  SlotData,
} from "@/engine/case";
import type { ExceptionDoc } from "@/engine/docs";
import {
  buildCase,
  candidatesOf,
  stepResult,
  toUiException,
  type Metrics,
  type ResultInput,
  type UiAction,
  type UiPaymentOp,
} from "@/engine/state";
import { money } from "@/lib/format";
import type { Data, Rec } from "@/scenarios/types";

const NOW = new Date("2026-10-16T08:00:00Z");
const HOLD_END = "2026-10-16T08:30:00Z";

const provider = (
  providerId: string,
  name: string,
  o: Partial<ProviderData> = {},
): ProviderData => ({
  providerId,
  name,
  petFriendly: true,
  oven: true,
  rating: 4.6,
  connected: false,
  ...o,
});
// Deliberately not in search order.
const PROVIDERS = [
  provider("PROV-quickshine", "QuickShine Cleaning"),
  provider("PROV-freshco", "FreshCo"),
  provider("PROV-sparkle", "Sparkle & Co", { oven: false }),
  provider("PROV-clearhome", "ClearHome Cleaning", {
    connected: true,
    _sim: { quotePence: 29000, floorPence: 28000 },
  }),
  provider("PROV-brightnest", "BrightNest", {
    _sim: { quotePence: 34000, floorPence: 34000 },
  }),
];

const slot = (
  slotId: string,
  providerId: string,
  startsAt: string,
  endsAt: string,
  o: Partial<SlotData> = {},
): SlotData => ({
  slotId,
  providerId,
  startsAt,
  endsAt,
  status: "free",
  bookingId: null,
  ...o,
});
const slots = (clearhome: Partial<SlotData> = {}): SlotData[] => [
  slot(
    "SLOT-brightnest-fri10",
    "PROV-brightnest",
    "2026-10-16T09:00:00Z",
    "2026-10-16T11:00:00Z",
  ),
  slot(
    "SLOT-clearhome-fri13",
    "PROV-clearhome",
    "2026-10-16T12:00:00Z",
    "2026-10-16T14:00:00Z",
    clearhome,
  ),
  slot(
    "SLOT-sparkle-fri09",
    "PROV-sparkle",
    "2026-10-16T08:00:00Z",
    "2026-10-16T10:00:00Z",
  ),
  slot(
    "SLOT-quickshine-fri10",
    "PROV-quickshine",
    "2026-10-16T09:00:00Z",
    "2026-10-16T11:00:00Z",
    { status: "booked", bookingId: "BK-1042" },
  ),
];

const offer = (o: Partial<Offer> = {}): Offer => ({
  offerId: "OFR-PROV-clearhome",
  providerId: "PROV-clearhome",
  slotId: "SLOT-clearhome-fri13",
  quotePence: 29000,
  pricePence: null,
  state: "quoted",
  slotVersion: null,
  holdExpiresAt: null,
  createdAt: "2026-10-16T07:50:00Z",
  ...o,
});
const held = offer({
  state: "held",
  pricePence: 28000,
  slotVersion: 2,
  holdExpiresAt: HOLD_END,
});
const brightQuote = offer({
  offerId: "OFR-PROV-brightnest",
  providerId: "PROV-brightnest",
  slotId: "SLOT-brightnest-fri10",
  quotePence: 34000,
});
const rejected = {
  providerId: "PROV-brightnest",
  pricePence: 34000,
  reason: "over_subsidy" as const,
  message: "Needs a subsidy above the cap",
  at: "2026-10-16T07:55:00Z",
};

const caseData = (o: Partial<CaseData> = {}): CaseData => ({
  caseId: "CASE-1042",
  bookingId: "BK-1042",
  status: "open",
  paidPence: 30000,
  originalProviderId: "PROV-quickshine",
  originalProviderPaid: false,
  cancellationText: "Van broke down",
  customerText: "Done by 3pm please",
  rescueDeadline: "2026-10-16T10:00:00Z",
  constraints: {
    doneBy: "2026-10-16T14:00:00Z",
    petFriendly: true,
    oven: true,
    maxPricePence: 30000,
    preferSameTime: true,
    notes: "",
  },
  extraction: { source: "scripted", model: null, reason: "fixture", raw: null },
  offers: [],
  rejected: [],
  consent: null,
  messages: [],
  fulfilment: null,
  replacementProviderId: null,
  ...o,
});
const booking = (o: Partial<BookingData> = {}): BookingData => ({
  bookingId: "BK-1042",
  customer: "Maya Chen",
  client: null,
  service: "End-of-tenancy clean",
  address: "Flat 3, 12 Mare Street",
  startsAt: "2026-10-16T09:00:00Z",
  endsAt: "2026-10-16T11:00:00Z",
  pricePence: 30000,
  providerId: "PROV-quickshine",
  slotId: "SLOT-quickshine-fri10",
  status: "provider_cancelled",
  ...o,
});
const rec = (
  system: string,
  recordId: string,
  target: string | null,
  data: Data,
): Rec => ({ system, recordId, target, data, version: 1 });
const recsFor = (
  c: CaseData,
  b: BookingData = booking(),
  s: SlotData[] = slots(),
): Rec[] => [
  rec("archos", "CASE-1042", null, c),
  rec("marketplace", "BK-1042", "BK-1042", b),
  ...PROVIDERS.map((p) => rec("marketplace", p.providerId, null, p)),
  ...s.map((x) => rec("marketplace", x.slotId, null, x)),
];
const exc = (o: Partial<ExceptionDoc> = {}): ExceptionDoc => ({
  exceptionId: "EXC:run1:BK-2026:no_slot",
  runId: "run1",
  caseId: null,
  target: "BK-2026",
  owner: "Priya Shah",
  reason: "No qualified slot",
  nextAction: "Credit BK-2026",
  action: null,
  dueAt: new Date("2026-10-16T07:00:00Z"),
  opId: null,
  status: "open",
  note: null,
  createdAt: new Date("2026-10-16T06:00:00Z"),
  ...o,
});
const states = (c: CaseData, s: SlotData[] = slots(), now = NOW) =>
  candidatesOf(c, PROVIDERS, s, now).map((k) => [
    k.providerId,
    k.state,
    k.eligible,
  ]);

const securedCase = caseData({
  offers: [{ ...held, state: "secured" }],
  replacementProviderId: "PROV-clearhome",
});
const securedBooking = booking({
  providerId: "PROV-clearhome",
  slotId: "SLOT-clearhome-fri13",
  status: "confirmed",
});
const securedSlots = slots({ status: "booked", bookingId: "BK-1042" });

describe("candidatesOf", () => {
  it("is empty until constraints exist", () => {
    expect(
      candidatesOf(caseData({ constraints: null }), PROVIDERS, slots(), NOW),
    ).toEqual([]);
  });
  it("search: four potential matches in search order, without the original provider", () => {
    expect(states(caseData())).toEqual([
      ["PROV-brightnest", "potential", true],
      ["PROV-clearhome", "potential", true],
      ["PROV-sparkle", "potential", false],
      ["PROV-freshco", "potential", false],
    ]);
    const list = candidatesOf(caseData(), PROVIDERS, slots(), NOW);
    expect(list[2].why).toBe("No oven cleaning");
    expect(list[3].slotLabel).toBeNull();
  });
  it("boundary: a quote is a confirmed offer and a policy denial is a rejected card", () => {
    expect(states(caseData({ offers: [brightQuote] }))[0]).toEqual([
      "PROV-brightnest",
      "confirmed",
      true,
    ]);
    const [bright] = candidatesOf(
      caseData({ offers: [brightQuote], rejected: [rejected] }),
      PROVIDERS,
      slots(),
      NOW,
    );
    expect(bright).toMatchObject({
      state: "rejected",
      quotePence: 34000,
      pricePence: 34000,
      rejectReason: "Needs a subsidy above the cap",
    });
  });
  it("negotiate: held while the hold runs, and still eligible on its own held slot", () => {
    const c = caseData({ offers: [brightQuote, held], rejected: [rejected] });
    expect(states(c, slots({ status: "held" }))[1]).toEqual([
      "PROV-clearhome",
      "held",
      true,
    ]);
    const clear = candidatesOf(c, PROVIDERS, slots({ status: "held" }), NOW)[1];
    expect(clear).toMatchObject({ pricePence: 28000, holdExpiresAt: HOLD_END });
    expect(clear.slotLabel).not.toBeNull();
  });
  it("a lapsed hold falls back to a confirmed offer", () => {
    expect(
      states(
        caseData({ offers: [held] }),
        slots({ status: "held" }),
        new Date("2026-10-16T09:00:00Z"),
      )[1],
    ).toEqual(["PROV-clearhome", "confirmed", true]);
  });
  it("secure: secured and still eligible on its booked slot", () => {
    expect(states(securedCase, securedSlots)[1]).toEqual([
      "PROV-clearhome",
      "secured",
      true,
    ]);
  });
});

describe("buildCase", () => {
  it("never carries simulator fields", () => {
    for (const recs of [
      recsFor(caseData({ offers: [brightQuote, held] })),
      recsFor(securedCase, securedBooking, securedSlots),
    ])
      expect(JSON.stringify(buildCase(recs, [], [], NOW))).not.toContain(
        "_sim",
      );
  });
  it("shows nothing at risk before the provider cancels", () => {
    const k = buildCase(
      recsFor(
        caseData({ status: "booked", constraints: null }),
        booking({ status: "confirmed" }),
      ),
      [],
      [],
      NOW,
    );
    expect(k.tiles).toEqual({
      atRiskPence: 0,
      provisionalPence: null,
      settledPence: null,
    });
    expect(k.candidates).toEqual([]);
  });
  it("hides candidates until the agent has searched", () => {
    expect(
      buildCase(recsFor(caseData()), [], [], NOW, false).candidates,
    ).toEqual([]);
  });
  it("a held offer has a split but no proposal yet", () => {
    const k = buildCase(
      recsFor(
        caseData({ offers: [held] }),
        booking(),
        slots({ status: "held" }),
      ),
      [],
      [],
      NOW,
    );
    expect(k.split?.price).toBe(28000);
    expect(k.proposal).toBeNull();
  });
  it("the proposal carries the split from the proposed price", () => {
    const k = buildCase(
      recsFor(
        caseData({ offers: [{ ...held, state: "proposed" }] }),
        booking(),
        slots({ status: "held" }),
      ),
      [],
      [],
      NOW,
    );
    expect(k.proposal).toMatchObject({
      offerId: "OFR-PROV-clearhome",
      providerName: "ClearHome Cleaning",
      startsAt: "2026-10-16T12:00:00Z",
      expiresAt: HOLD_END,
    });
    expect(k.proposal?.split).toMatchObject({
      price: 28000,
      refund: 2000,
      subsidy: 0,
      commission: 5600,
      transfer: 22400,
    });
    expect(k.ladder.state).toBe("offered");
    expect(k.tiles).toEqual({
      atRiskPence: 30000,
      provisionalPence: null,
      settledPence: null,
    });
  });
  it("secured shows the provisional rescued value and the new provider", () => {
    const k = buildCase(
      recsFor(securedCase, securedBooking, securedSlots),
      [],
      [],
      NOW,
    );
    expect(k.ladder.state).toBe("secured");
    expect(k.booking.providerName).toBe("ClearHome Cleaning");
    expect(k.tiles).toEqual({
      atRiskPence: 30000,
      provisionalPence: 28000,
      settledPence: null,
    });
  });
});

describe("toUiException", () => {
  it("flags only an open exception past its due time", () => {
    expect(toUiException(exc(), NOW)).toMatchObject({
      overdue: true,
      dueAt: "2026-10-16T07:00:00.000Z",
    });
    expect(
      toUiException(exc({ dueAt: new Date("2026-10-16T18:00:00Z") }), NOW)
        .overdue,
    ).toBe(false);
    expect(toUiException(exc({ status: "closed" }), NOW).overdue).toBe(false);
  });
});

describe("stepResult", () => {
  const metrics = (o: Partial<Metrics> = {}): Metrics => ({
    mutated: 0,
    outOfScope: 0,
    restore: 0,
    manual: 0,
    done: 0,
    failed: 0,
    recovered: 0,
    replaced: 0,
    unresolved: 0,
    blocked: 0,
    ...o,
  });
  const input = (o: Partial<ResultInput> = {}): ResultInput => ({
    kase: null,
    payments: [],
    journal: [],
    task: null,
    records: 0,
    metrics: metrics(),
    incident: null,
    approvedBy: null,
    actions: [],
    exceptions: [],
    ...o,
  });
  const task = {
    id: "OPS-311",
    text: "Cancel three",
    approvedTargets: ["BK-2003", "BK-2011", "BK-2017"],
    approvedBy: "Sam Okafor",
  };
  const kase = buildCase(
    recsFor(caseData({ offers: [brightQuote], rejected: [rejected] })),
    [],
    [],
    NOW,
  );

  it("describes Scene 1 steps from the case and the money ops", () => {
    expect(stepResult("failure", input({ kase }))).toBe(
      `${money(30000)} booking at risk`,
    );
    expect(stepResult("boundary", input({ kase }))).toBe(
      "BrightNest rejected: Needs a subsidy above the cap",
    );
    const refund: UiPaymentOp = {
      opId: "run1:CASE-1042:refund:1",
      kind: "refund",
      attempt: 1,
      amountPence: 2000,
      state: "succeeded",
      stripeId: "re_123",
      error: null,
      observed: null,
      dashboardUrl: null,
    };
    expect(stepResult("secure", input({ kase, payments: [refund] }))).toBe(
      "Refund re_123 succeeded",
    );
  });
  it("describes Scene 2 steps from metrics, actions and the incident", () => {
    expect(stepResult("brief", input({ task }))).toBe(
      "3 bookings approved by Sam Okafor",
    );
    expect(
      stepResult(
        "detect",
        input({ task, metrics: metrics({ outOfScope: 27 }) }),
      ),
    ).toBe("27 bookings changed outside OPS-311");
    const blocked: UiAction = {
      operationId: "run1:script:contain:0",
      tool: "notifyCustomers",
      kind: "mutate",
      decision: "blocked",
      reason: "suspended",
      targets: [],
      source: "scripted",
      at: NOW.toISOString(),
      changed: 0,
    };
    expect(stepResult("contain", input({ actions: [blocked] }))).toBe(
      "notifyCustomers blocked: suspended",
    );
    expect(
      stepResult(
        "rescue",
        input({
          metrics: metrics({ replaced: 2 }),
          exceptions: [toUiException(exc(), NOW)],
          incident: { budgetPence: 6000, committedPence: 4000 },
        }),
      ),
    ).toBe(
      `2 replaced, 1 exception, ${money(4000)} of ${money(6000)} committed`,
    );
  });
});
