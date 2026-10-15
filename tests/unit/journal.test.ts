import { describe, expect, it } from "vitest";
import type { CaseData } from "@/engine/case";
import type { OpKind, OpState, PaymentOp } from "@/engine/docs";
import { buildJournal, isBalanced } from "@/ledger/journal";
import { splitFor } from "@/money/math";

const NOW = new Date("2026-10-16T09:00:00Z");
const fulfilment: CaseData["fulfilment"] = {
  at: "2026-10-16T10:00:00Z",
  simulated: true,
};

const op = (
  kind: OpKind,
  state: OpState,
  attempt: number,
  amountPence: number,
  feePence: number | null = null,
): PaymentOp => ({
  opId: `run1:CASE-1042:${kind}:${attempt}`,
  runId: "run1",
  caseId: "CASE-1042",
  kind,
  attempt,
  amountPence,
  request: {},
  state,
  stripeId: state === "intended" ? null : `${kind}_id${attempt}`,
  observed:
    state === "succeeded"
      ? {
          status: "succeeded",
          amountRefunded: null,
          balanceTransaction: null,
          feePence,
          reversed: kind === "transfer" ? false : null,
          checkedAt: NOW,
        }
      : null,
  error: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const scripted = (fee: number | null = 470) => [
  op("charge", "succeeded", 1, 30000, fee),
  op("refund", "succeeded", 1, 2000),
  op("transfer", "succeeded", 1, 22400),
];

const line = (
  e:
    { lines: { account: string; debit: number; credit: number }[] } | undefined,
  account: string,
) => e?.lines.find((l) => l.account === account);

describe("buildJournal scripted case", () => {
  const entries = buildJournal({
    split: splitFor(30000, 28000),
    ops: scripted(),
    fulfilment,
  });

  it("has five balanced entries in order", () => {
    expect(entries.map((e) => e.key)).toEqual([
      "paid",
      "refund",
      "fulfilled",
      "provider_paid",
      "fee",
    ]);
    expect(entries.every(isBalanced)).toBe(true);
  });

  it("books the amounts from the split", () => {
    const by = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(line(by.paid, "Stripe clearing")).toMatchObject({
      debit: 30000,
      credit: 0,
    });
    expect(line(by.paid, "Customer deposits")).toMatchObject({
      debit: 0,
      credit: 30000,
    });
    expect(line(by.refund, "Customer deposits")).toMatchObject({ debit: 2000 });
    expect(line(by.refund, "Stripe clearing")).toMatchObject({ credit: 2000 });
    expect(line(by.fulfilled, "Customer deposits")).toMatchObject({
      debit: 28000,
    });
    expect(line(by.fulfilled, "Provider payable")).toMatchObject({
      credit: 22400,
    });
    expect(
      line(by.fulfilled, "Gross commission (simulated fulfilment, unsettled)"),
    ).toMatchObject({ credit: 5600 });
    expect(line(by.fulfilled, "Subsidy expense")).toBeUndefined();
    expect(line(by.provider_paid, "Provider payable")).toMatchObject({
      debit: 22400,
    });
    expect(line(by.provider_paid, "Stripe clearing")).toMatchObject({
      credit: 22400,
    });
    expect(line(by.fee, "Payment fees")).toMatchObject({ debit: 470 });
    expect(line(by.fee, "Stripe clearing")).toMatchObject({ credit: 470 });
  });

  it("cites the Stripe id or the simulated fulfilment event", () => {
    expect(entries.map((e) => e.source)).toEqual([
      "charge_id1",
      "refund_id1",
      "fulfilment event (simulated)",
      "transfer_id1",
      "charge_id1",
    ]);
  });
});

describe("buildJournal edge cases", () => {
  it("skips the fee entry for a null, zero or fractional fee", () => {
    for (const fee of [null, 0, 4.5]) {
      const keys = buildJournal({
        split: splitFor(30000, 28000),
        ops: scripted(fee),
        fulfilment,
      }).map((e) => e.key);
      expect(keys).toEqual(["paid", "refund", "fulfilled", "provider_paid"]);
    }
  });

  it("balances with a subsidy at price 31000 and skips the zero refund entry", () => {
    const split = splitFor(30000, 31000);
    const ops = [
      op("charge", "succeeded", 1, 30000, 470),
      op("transfer", "succeeded", 1, split.transfer),
    ];
    const entries = buildJournal({ split, ops, fulfilment });
    expect(entries.map((e) => e.key)).toEqual([
      "paid",
      "fulfilled",
      "provider_paid",
      "fee",
    ]);
    expect(entries.every(isBalanced)).toBe(true);
    const f = entries.find((e) => e.key === "fulfilled");
    expect(line(f, "Subsidy expense")).toMatchObject({
      debit: 1000,
      credit: 0,
    });
    expect(line(f, "Customer deposits")).toMatchObject({ debit: 30000 });
    expect(line(f, "Provider payable")).toMatchObject({ credit: 24800 });
    expect(
      line(f, "Gross commission (simulated fulfilment, unsettled)"),
    ).toMatchObject({ credit: 6200 });
  });

  it("has no entry for a pending op", () => {
    const ops = [
      op("charge", "succeeded", 1, 30000, 470),
      op("refund", "pending", 1, 2000),
      op("transfer", "pending", 1, 22400),
    ];
    expect(
      buildJournal({ split: splitFor(30000, 28000), ops, fulfilment }).map(
        (e) => e.key,
      ),
    ).toEqual(["paid", "fulfilled", "fee"]);
  });

  it("has no entry for an intended or failed op", () => {
    const ops = [
      op("charge", "failed", 1, 30000),
      op("refund", "intended", 1, 2000),
    ];
    expect(
      buildJournal({ split: splitFor(30000, 28000), ops, fulfilment: null }),
    ).toEqual([]);
  });

  it("has no fulfilled entry without the fulfilment event", () => {
    const keys = buildJournal({
      split: splitFor(30000, 28000),
      ops: scripted(),
      fulfilment: null,
    }).map((e) => e.key);
    expect(keys).toEqual(["paid", "refund", "provider_paid", "fee"]);
  });

  it("uses the latest attempt only", () => {
    const ops = [
      op("charge", "succeeded", 1, 30000, 470),
      op("refund", "failed", 1, 2000),
      { ...op("refund", "succeeded", 2, 2000), stripeId: "refund_retry" },
    ];
    const entries = buildJournal({
      split: splitFor(30000, 28000),
      ops,
      fulfilment: null,
    });
    expect(entries.find((e) => e.key === "refund")?.source).toBe(
      "refund_retry",
    );
  });
});

describe("isBalanced", () => {
  it("detects an unbalanced entry", () => {
    expect(
      isBalanced({
        key: "paid",
        title: "x",
        source: "s",
        lines: [
          { account: "A", debit: 100, credit: 0 },
          { account: "B", debit: 0, credit: 99 },
        ],
      }),
    ).toBe(false);
  });
});
