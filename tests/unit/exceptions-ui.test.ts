import { describe, expect, it } from "vitest";
import type { UiException } from "@/engine/state";
import { sortExceptions } from "@/ui/exceptionHelpers";

const ex = (
  exceptionId: string,
  status: UiException["status"],
  dueAt: string,
) => ({ exceptionId, status, dueAt }) as UiException;

describe("sortExceptions", () => {
  const input = [
    ex("closed-early", "closed", "2026-10-15T09:00:00.000Z"),
    ex("open-late", "open", "2026-10-15T17:00:00.000Z"),
    ex("open-soon", "open", "2026-10-15T12:00:00.000Z"),
  ];

  it("lists open exceptions first, soonest due first", () =>
    expect(sortExceptions(input).map((e) => e.exceptionId)).toEqual([
      "open-soon",
      "open-late",
      "closed-early",
    ]));

  it("does not reorder the state array it was given", () => {
    sortExceptions(input);
    expect(input[0].exceptionId).toBe("closed-early");
  });
});
