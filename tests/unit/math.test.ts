import { describe, expect, it } from "vitest";
import { splitFor } from "@/money/math";

describe("splitFor", () => {
  it("scripted price 28000 refunds 2000", () => {
    expect(splitFor(30000, 28000)).toEqual({
      paid: 30000,
      price: 28000,
      customerNet: 28000,
      refund: 2000,
      subsidy: 0,
      commission: 5600,
      transfer: 22400,
    });
  });

  it("live price 29000 refunds 1000", () => {
    const s = splitFor(30000, 29000);
    expect([s.refund, s.subsidy, s.commission, s.transfer]).toEqual([
      1000, 0, 5800, 23200,
    ]);
  });

  it("price 31000 needs a subsidy of 1000 and no refund", () => {
    const s = splitFor(30000, 31000);
    expect([
      s.customerNet,
      s.refund,
      s.subsidy,
      s.commission,
      s.transfer,
    ]).toEqual([30000, 0, 1000, 6200, 24800]);
  });

  it.each([28000, 29000, 31000, 29005, 28001, 1])(
    "price %i keeps integers and balances",
    (price) => {
      const s = splitFor(30000, price);
      for (const v of Object.values(s))
        expect(Number.isSafeInteger(v)).toBe(true);
      expect(s.customerNet + s.subsidy).toBe(s.transfer + s.commission);
      expect(s.customerNet + s.subsidy).toBe(price);
      expect(s.refund + s.customerNet).toBe(30000);
    },
  );

  it.each([
    [30000, 0],
    [30000, -1],
    [30000, 1.5],
    [30000, Number.NaN],
    [0, 28000],
    [-5, 28000],
    [30000.5, 28000],
  ])("throws on paid %s price %s", (paid, price) => {
    expect(() => splitFor(paid, price)).toThrow();
  });
});
