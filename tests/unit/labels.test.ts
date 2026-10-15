import { describe, expect, it } from "vitest";
import type { UiException } from "@/engine/state";
import { canSubmit, decisionTone, hasOpenException } from "@/ui/labels";

const exc = (over: Partial<UiException>): UiException =>
  ({
    exceptionId: "EXC:run:x:reason",
    caseId: null,
    target: null,
    status: "open",
    ...over,
  }) as UiException;

describe("canSubmit", () => {
  it("blocks every submit while a request or step is in flight", () => {
    for (const s of [
      "ready",
      "running",
      "awaiting_customer",
      "awaiting_approval",
      "done",
    ] as const)
      expect(canSubmit(true, s)).toBeNull();
  });

  it("allows exactly one kind of submit per idle status", () => {
    expect(canSubmit(false, "ready")).toBe("advance");
    expect(canSubmit(false, "running")).toBe("advance");
    expect(canSubmit(false, "awaiting_customer")).toBe("respond");
    expect(canSubmit(false, "awaiting_approval")).toBe("approve");
    expect(canSubmit(false, "done")).toBeNull();
  });
});

describe("hasOpenException", () => {
  it("ignores closed exceptions", () =>
    expect(hasOpenException([exc({ status: "closed" })])).toBe(false));

  it("matches any open exception, or one by booking target or case id", () => {
    const xs = [exc({ target: "BK-2026" }), exc({ caseId: "CASE-1042" })];
    expect(hasOpenException(xs)).toBe(true);
    expect(hasOpenException(xs, "BK-2026")).toBe(true);
    expect(hasOpenException(xs, "CASE-1042")).toBe(true);
    expect(hasOpenException(xs, "BK-2009")).toBe(false);
  });
});

describe("decisionTone", () => {
  it("uses the lookup table and leaves unknown decisions neutral", () => {
    expect(decisionTone("Blocked")).toBe("red");
    expect(decisionTone("Exception opened")).toBe("amber");
    expect(decisionTone("Executed")).toBe("");
    // A regex would have matched this; the table does not.
    expect(decisionTone("Not Blocked")).toBe("");
  });
});
