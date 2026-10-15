import { describe, expect, it } from "vitest";
import type { BookingData, CaseData, Offer } from "@/engine/case";
import type { ExceptionDoc, OpKind, OpState, PaymentOp } from "@/engine/docs";
import { ladderOf, latestOps } from "@/engine/ladder";

const NOW = new Date("2026-10-16T09:00:00Z");

const offer = (o: Partial<Offer> = {}): Offer => ({
  offerId: "OFR-clearhome",
  providerId: "clearhome",
  slotId: "SLOT-clearhome-fri13",
  quotePence: 29000,
  pricePence: 28000,
  state: "secured",
  slotVersion: 3,
  holdExpiresAt: "2026-10-16T09:30:00Z",
  createdAt: "2026-10-16T09:00:00Z",
  ...o,
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
  constraints: null,
  extraction: null,
  offers: [offer()],
  rejected: [],
  consent: null,
  messages: [],
  fulfilment: null,
  replacementProviderId: "clearhome",
  ...o,
});
const fulfilled = caseData({
  fulfilment: { at: "2026-10-16T10:00:00Z", simulated: true },
});

const prefix: Record<OpKind, string> = {
  charge: "pi",
  refund: "re",
  full_refund: "re",
  transfer: "tr",
};
const op = (
  kind: OpKind,
  state: OpState,
  attempt: number,
  amountPence: number,
  over: Partial<PaymentOp> = {},
): PaymentOp => ({
  opId: `run1:CASE-1042:${kind}:${attempt}`,
  runId: "run1",
  caseId: "CASE-1042",
  kind,
  attempt,
  amountPence,
  request: {},
  state,
  stripeId:
    state === "intended" || state === "requested"
      ? null
      : `${prefix[kind]}_${kind}${attempt}`,
  observed:
    state === "succeeded"
      ? {
          status: "succeeded",
          amountRefunded: null,
          balanceTransaction: null,
          feePence: null,
          reversed: kind === "transfer" ? false : null,
          checkedAt: NOW,
        }
      : null,
  error: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const exception = (o: Partial<ExceptionDoc> = {}): ExceptionDoc => ({
  exceptionId: "EXC:run1:CASE-1042:refund_failed",
  runId: "run1",
  caseId: "CASE-1042",
  target: null,
  owner: "Priya Shah",
  reason: "Refund failed",
  nextAction: "Retry refund",
  action: "retry",
  dueAt: NOW,
  opId: "run1:CASE-1042:refund:1",
  status: "open",
  note: null,
  createdAt: NOW,
  ...o,
});

const charge = op("charge", "succeeded", 1, 30000);
const refund = op("refund", "succeeded", 1, 2000);
const transfer = op("transfer", "succeeded", 1, 22400);
const input = (o: Partial<Parameters<typeof ladderOf>[0]> = {}) => ({
  caseData: caseData(),
  booking: booking(),
  ops: [charge],
  exceptions: [] as ExceptionDoc[],
  ...o,
});

describe("latestOps", () => {
  it("keeps the highest attempt per kind", () => {
    const l = latestOps([
      op("refund", "failed", 1, 2000),
      op("refund", "succeeded", 2, 2000),
      op("charge", "succeeded", 1, 30000),
    ]);
    expect(l.refund?.attempt).toBe(2);
    expect(l.charge?.attempt).toBe(1);
    expect(l.transfer).toBeUndefined();
  });
});

describe("ladderOf states", () => {
  it("investigating with no offers or only quoted and held offers", () => {
    const b = booking({
      providerId: "quickshine",
      status: "provider_cancelled",
    });
    expect(
      ladderOf(
        input({
          caseData: caseData({ offers: [], replacementProviderId: null }),
          booking: b,
        }),
      ),
    ).toMatchObject({ state: "investigating", chip: null });
    const early = caseData({
      offers: [
        offer({ state: "quoted" }),
        offer({ offerId: "OFR-b", state: "held" }),
      ],
      replacementProviderId: null,
    });
    expect(ladderOf(input({ caseData: early, booking: b })).state).toBe(
      "investigating",
    );
  });

  it("offered when an offer is proposed", () => {
    const c = caseData({
      offers: [offer({ state: "proposed" })],
      replacementProviderId: null,
    });
    const b = booking({
      providerId: "quickshine",
      status: "provider_cancelled",
    });
    expect(ladderOf(input({ caseData: c, booking: b })).state).toBe("offered");
  });

  it("secured with a pending refund", () => {
    const l = ladderOf(
      input({ ops: [charge, op("refund", "intended", 1, 2000)] }),
    );
    expect(l).toMatchObject({
      state: "secured",
      chip: "refund pending",
      simulatedFulfilment: false,
    });
  });

  it("secured with a done refund", () => {
    expect(ladderOf(input({ ops: [charge, refund] }))).toMatchObject({
      state: "secured",
      chip: "refund done",
    });
  });

  it("secured with a failed refund shows the chip, not a downgrade", () => {
    expect(
      ladderOf(input({ ops: [charge, op("refund", "failed", 1, 2000)] })),
    ).toMatchObject({ state: "secured", chip: "refund failed" });
  });

  it("secured with zero refund (price above what was paid)", () => {
    const c = caseData({ offers: [offer({ pricePence: 31000 })] });
    expect(ladderOf(input({ caseData: c }))).toMatchObject({
      state: "secured",
      chip: null,
    });
  });

  it("a secured offer without booking evidence is only offered", () => {
    const b = booking({
      providerId: "quickshine",
      status: "provider_cancelled",
    });
    expect(ladderOf(input({ booking: b })).state).toBe("offered");
    expect(
      ladderOf(input({ booking: booking({ status: "cancelled" }) })).state,
    ).toBe("offered");
  });

  it("fulfilled needs secured and a fulfilment event, and shows the simulated flag", () => {
    const l = ladderOf(input({ caseData: fulfilled, ops: [charge, refund] }));
    expect(l).toMatchObject({
      state: "fulfilled",
      chip: null,
      simulatedFulfilment: true,
    });
    const notSecured = caseData({
      offers: [offer({ state: "proposed" })],
      replacementProviderId: null,
      fulfilment: fulfilled.fulfilment,
    });
    expect(
      ladderOf(
        input({
          caseData: notSecured,
          booking: booking({ providerId: "quickshine" }),
        }),
      ).state,
    ).toBe("offered");
  });

  it("fulfilled shows payout chips", () => {
    expect(
      ladderOf(
        input({
          caseData: fulfilled,
          ops: [charge, refund, op("transfer", "pending", 1, 22400)],
        }),
      ).chip,
    ).toBe("payout pending");
    expect(
      ladderOf(
        input({
          caseData: fulfilled,
          ops: [charge, refund, op("transfer", "failed", 1, 22400)],
        }),
      ).chip,
    ).toBe("payout failed");
  });

  it("settled when charge, refund and transfer all succeeded and the transfer is not reversed", () => {
    expect(
      ladderOf(input({ caseData: fulfilled, ops: [charge, refund, transfer] })),
    ).toMatchObject({ state: "settled", chip: null });
  });

  it("settled with zero refund needs no refund op", () => {
    const c = caseData({
      offers: [offer({ pricePence: 31000 })],
      fulfilment: fulfilled.fulfilment,
    });
    expect(
      ladderOf(
        input({
          caseData: c,
          ops: [charge, op("transfer", "succeeded", 1, 24800)],
        }),
      ).state,
    ).toBe("settled");
  });

  it("remedied when declined and the full refund succeeded", () => {
    const c = caseData({
      status: "declined",
      offers: [offer({ state: "released" })],
      replacementProviderId: null,
    });
    const b = booking({
      providerId: "quickshine",
      status: "provider_cancelled",
    });
    const l = ladderOf(
      input({
        caseData: c,
        booking: b,
        ops: [charge, op("full_refund", "succeeded", 1, 30000)],
      }),
    );
    expect(l).toMatchObject({ state: "remedied", chip: null });
  });

  it("declined with a pending full refund is not remedied yet", () => {
    const c = caseData({
      status: "declined",
      offers: [offer({ state: "released" })],
      replacementProviderId: null,
    });
    const b = booking({
      providerId: "quickshine",
      status: "provider_cancelled",
    });
    for (const state of ["intended", "requested", "pending"] as const) {
      const l = ladderOf(
        input({
          caseData: c,
          booking: b,
          ops: [
            charge,
            op("full_refund", state, 1, 30000, {
              stripeId: state === "pending" ? "re_x" : null,
            }),
          ],
        }),
      );
      expect(l.state).toBe("investigating");
      expect(l.chip).toBe(
        state === "requested" ? "reconciling" : "refund pending (remedy)",
      );
    }
  });
});

describe("remedy refund on an open case", () => {
  const openRemedy = caseData({
    status: "open",
    offers: [offer({ state: "proposed" })],
    replacementProviderId: null,
  });
  const b = booking({ providerId: "quickshine", status: "provider_cancelled" });
  it("remedied once the full refund succeeded", () => {
    const l = ladderOf(
      input({
        caseData: openRemedy,
        booking: b,
        ops: [charge, op("full_refund", "succeeded", 1, 30000)],
      }),
    );
    expect(l).toMatchObject({ state: "remedied", chip: null });
  });
  it("shows the pending remedy chip while the full refund is pending", () => {
    const l = ladderOf(
      input({
        caseData: openRemedy,
        booking: b,
        ops: [
          charge,
          op("full_refund", "pending", 1, 30000, { stripeId: "re_x" }),
        ],
      }),
    );
    expect(l).toMatchObject({
      state: "investigating",
      chip: "refund pending (remedy)",
    });
  });
});

describe("Settled is impossible without evidence", () => {
  const base = { caseData: fulfilled };
  it("with no transfer op", () => {
    expect(ladderOf(input({ ...base, ops: [charge, refund] })).state).toBe(
      "fulfilled",
    );
  });
  it("with a pending transfer", () => {
    expect(
      ladderOf(
        input({
          ...base,
          ops: [charge, refund, op("transfer", "pending", 1, 22400)],
        }),
      ).state,
    ).toBe("fulfilled");
  });
  it("with a reversed transfer", () => {
    const reversed = op("transfer", "succeeded", 1, 22400, {
      observed: {
        status: "succeeded",
        amountRefunded: null,
        balanceTransaction: null,
        feePence: null,
        reversed: true,
        checkedAt: NOW,
      },
    });
    expect(
      ladderOf(input({ ...base, ops: [charge, refund, reversed] })).state,
    ).toBe("fulfilled");
  });
  it("with a transfer that was never observed", () => {
    expect(
      ladderOf(
        input({
          ...base,
          ops: [
            charge,
            refund,
            op("transfer", "succeeded", 1, 22400, { observed: null }),
          ],
        }),
      ).state,
    ).toBe("fulfilled");
  });
  it("with a pending refund", () => {
    const l = ladderOf(
      input({
        ...base,
        ops: [charge, op("refund", "pending", 1, 2000), transfer],
      }),
    );
    expect(l).toMatchObject({ state: "fulfilled", chip: "refund pending" });
  });
  it("with no charge op", () => {
    expect(ladderOf(input({ ...base, ops: [refund, transfer] })).state).toBe(
      "fulfilled",
    );
  });
});

describe("retries", () => {
  it("a failed attempt 1 then a succeeded attempt 2 reaches Settled", () => {
    const ops = [
      charge,
      op("refund", "failed", 1, 2000),
      op("refund", "succeeded", 2, 2000),
      op("transfer", "failed", 1, 22400),
      op("transfer", "succeeded", 2, 22400),
    ];
    expect(ladderOf(input({ caseData: fulfilled, ops })).state).toBe("settled");
  });
  it("a succeeded attempt 1 followed by a failed attempt 2 does not settle", () => {
    const ops = [charge, refund, transfer, op("transfer", "failed", 2, 22400)];
    expect(ladderOf(input({ caseData: fulfilled, ops })).state).toBe(
      "fulfilled",
    );
  });
});

describe("exception badge", () => {
  it("is a badge only and never changes the state", () => {
    const ops = [charge, op("refund", "failed", 1, 2000)];
    const without = ladderOf(input({ ops }));
    const withExc = ladderOf(input({ ops, exceptions: [exception()] }));
    expect(withExc.state).toBe(without.state);
    expect(withExc.chip).toBe(without.chip);
    expect(withExc.exception).toEqual({
      exceptionId: "EXC:run1:CASE-1042:refund_failed",
      owner: "Priya Shah",
      nextAction: "Retry refund",
    });
  });
  it("ignores closed exceptions and other cases", () => {
    expect(
      ladderOf(input({ exceptions: [exception({ status: "closed" })] }))
        .exception,
    ).toBeNull();
    expect(
      ladderOf(input({ exceptions: [exception({ caseId: "CASE-9999" })] }))
        .exception,
    ).toBeNull();
    expect(
      ladderOf(
        input({ exceptions: [exception({ caseId: null, target: "BK-2026" })] }),
      ).exception,
    ).toBeNull();
  });
  it("uses the first open exception for the case", () => {
    const l = ladderOf(
      input({
        exceptions: [
          exception({ status: "closed" }),
          exception({ exceptionId: "EXC:2", owner: "Sam Okafor" }),
          exception({ exceptionId: "EXC:3" }),
        ],
      }),
    );
    expect(l.exception?.exceptionId).toBe("EXC:2");
  });
});

describe("reconciling chip", () => {
  it("shows when a latest op is requested with no Stripe id", () => {
    const l = ladderOf(
      input({ ops: [charge, op("refund", "requested", 1, 2000)] }),
    );
    expect(l).toMatchObject({ state: "secured", chip: "reconciling" });
  });
  it("does not show for a requested op that already has an id", () => {
    const l = ladderOf(
      input({
        ops: [charge, op("refund", "requested", 1, 2000, { stripeId: "re_1" })],
      }),
    );
    expect(l.chip).toBe("refund pending");
  });
});
