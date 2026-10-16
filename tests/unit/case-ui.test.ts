import { describe, expect, it } from "vitest";
import type { UiPaymentOp } from "@/engine/state";
import { splitFor } from "@/money/math";
import {
  canAccept,
  ladderRungs,
  latestOf,
  mmss,
  observedText,
  remaining,
  sumCheck,
} from "@/ui/caseHelpers";

const expiresAt = "2026-10-16T10:30:00.000Z";
const at = Date.parse(expiresAt);

describe("remaining", () => {
  it("counts whole seconds down to the hold expiry", () => {
    expect(remaining(expiresAt, at - 90_500)).toBe(90);
    expect(mmss(90)).toBe("1:30");
  });

  it("is 0 at and after the expiry", () => {
    expect(remaining(expiresAt, at)).toBe(0);
    expect(remaining(expiresAt, at + 5_000)).toBe(0);
    expect(mmss(0)).toBe("0:00");
  });
});

describe("canAccept", () => {
  const soon = at - 60_000;

  it("allows Accept while waiting for the customer, idle and inside the hold", () =>
    expect(canAccept(false, "awaiting_customer", expiresAt, soon)).toBe(true));

  it("disables Accept once the hold has expired", () =>
    expect(canAccept(false, "awaiting_customer", expiresAt, at)).toBe(false));

  it("disables Accept while busy, outside the consent step, or before the clock is known", () => {
    expect(canAccept(true, "awaiting_customer", expiresAt, soon)).toBe(false);
    expect(canAccept(false, "running", expiresAt, soon)).toBe(false);
    expect(canAccept(false, "awaiting_customer", expiresAt, null)).toBe(false);
    expect(canAccept(false, "awaiting_customer", null, soon)).toBe(false);
  });
});

describe("ladderRungs", () => {
  it("marks the reached rung current and earlier rungs done", () => {
    expect(ladderRungs("investigating")).toEqual([
      "current",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    expect(ladderRungs("secured")).toEqual([
      "done",
      "done",
      "current",
      "todo",
      "todo",
    ]);
  });

  it("completes every rung when settled", () =>
    expect(ladderRungs("settled")).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]));

  it("stops a remedied case after Offered with no current rung", () =>
    expect(ladderRungs("remedied")).toEqual([
      "done",
      "done",
      "todo",
      "todo",
      "todo",
    ]));
});

describe("sumCheck", () => {
  it("shows the scripted split as paid = refund + transfer + commission", () =>
    expect(sumCheck(splitFor(30000, 28000))).toEqual({
      ok: true,
      text: "£300 = £20 + £224 + £56",
    }));

  it("subtracts a subsidy when the price is above what was paid", () =>
    expect(sumCheck(splitFor(30000, 31000))).toEqual({
      ok: true,
      text: "£300 = £0 + £248 + £62 - £10 subsidy",
    }));

  it("flags a split that does not add up", () =>
    expect(sumCheck({ ...splitFor(30000, 28000), transfer: 22300 }).ok).toBe(
      false,
    ));
});

describe("latestOf", () => {
  const op = (kind: UiPaymentOp["kind"], attempt: number) =>
    ({ opId: `${kind}:${attempt}`, kind, attempt }) as UiPaymentOp;

  it("picks the highest attempt of one kind", () => {
    expect(
      latestOf([op("charge", 1), op("transfer", 3), op("charge", 2)], "charge")
        ?.opId,
    ).toBe("charge:2");
    expect(latestOf([op("charge", 1)], "refund")).toBeNull();
  });
});

describe("observedText", () => {
  const observed = (
    status: string | null,
    reversed: boolean | null,
  ): UiPaymentOp["observed"] => ({
    status,
    reversed,
    amountRefunded: null,
    balanceTransaction: null,
    feePence: null,
    checkedAt: expiresAt,
  });

  it("shows reversed: no for a transfer, which has no Stripe status", () =>
    expect(observedText(observed(null, false))).toBe("reversed: no"));

  it("shows the Stripe status alone, or both parts together", () => {
    expect(observedText(observed("succeeded", null))).toBe(
      "Stripe says succeeded",
    );
    expect(observedText(observed("succeeded", true))).toBe(
      "Stripe says succeeded, reversed: yes",
    );
  });

  it("shows nothing before Stripe was read or when it reported neither", () => {
    expect(observedText(null)).toBeNull();
    expect(observedText(observed(null, null))).toBeNull();
  });
});
