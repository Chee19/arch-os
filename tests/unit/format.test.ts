import { describe, expect, it } from "vitest";
import { clock, money, plural, when } from "@/lib/format";

describe("money", () => {
  it("shows whole pounds when there are no pence", () => {
    expect(money(30000)).toBe("£300");
    expect(money(810000)).toBe("£8,100");
    expect(money(0)).toBe("£0");
  });
  it("shows two decimals when there are pence", () => {
    expect(money(470)).toBe("£4.70");
    expect(money(5)).toBe("£0.05");
    expect(money(22405)).toBe("£224.05");
  });
  it("uses a leading minus for negatives", () => {
    expect(money(-2000)).toBe("-£20");
    expect(money(-470)).toBe("-£4.70");
  });
});

describe("plural", () => {
  it("handles one and many", () => {
    expect(plural(1, "call")).toBe("1 call");
    expect(plural(3, "call")).toBe("3 calls");
  });
});

describe("when and clock", () => {
  it("formats in Europe/London during BST", () => {
    expect(when("2026-10-16T12:00:00Z")).toBe("Fri 13:00");
    expect(clock("2026-10-16T12:00:00Z")).toBe("13:00");
  });
  it("formats in Europe/London during GMT and accepts a Date", () => {
    expect(when(new Date("2026-12-04T12:00:00Z"))).toBe("Fri 12:00");
    expect(clock(new Date("2026-12-04T12:05:00Z"))).toBe("12:05");
  });
});
