import { describe, expect, it } from "vitest";
import type { UiItem, UiRecord } from "@/engine/state";
import { itemTab, laneCounts, laneOf } from "@/ui/incidentHelpers";

const rec = (target: string, over: Partial<UiRecord> = {}): UiRecord => ({
  target,
  title: target,
  subtitle: "",
  status: "",
  stage: "",
  lane: null,
  tone: "idle",
  inScope: false,
  version: 1,
  plan: null,
  itemStatus: null,
  outcome: null,
  ...over,
});

const item = (over: Partial<UiItem>): UiItem =>
  ({
    target: "BK-2001",
    kind: "restore",
    status: "pending",
    outcome: null,
    ...over,
  }) as UiItem;

describe("laneOf", () => {
  it("keeps authorised bookings in their own lane whatever else happens", () =>
    expect(laneOf(rec("BK-2003", { inScope: true, plan: "manual" }))).toBe(
      "authorised",
    ));

  it("uses the recorded outcome", () => {
    expect(laneOf(rec("a", { plan: "restore", outcome: "restored" }))).toBe(
      "restored",
    );
    expect(laneOf(rec("b", { plan: "manual", outcome: "replaced" }))).toBe(
      "replaced",
    );
  });

  it("sends conflicts and failed or skipped restores to exception", () => {
    expect(laneOf(rec("a", { plan: "manual", itemStatus: "manual" }))).toBe(
      "exception",
    );
    expect(laneOf(rec("b", { plan: "restore", itemStatus: "failed" }))).toBe(
      "exception",
    );
    expect(laneOf(rec("c", { plan: "restore", itemStatus: "skipped" }))).toBe(
      "exception",
    );
  });

  it("leaves planned but not yet restored bookings unsorted", () =>
    expect(
      laneOf(rec("a", { plan: "restore", itemStatus: "pending" })),
    ).toBeNull());
});

describe("laneCounts", () => {
  it("matches the scripted Scene 2 split 3 / 24 / 2 / 1", () => {
    const records = [
      ...Array.from({ length: 3 }, (_, i) => rec(`A${i}`, { inScope: true })),
      ...Array.from({ length: 24 }, (_, i) =>
        rec(`R${i}`, {
          plan: "restore",
          itemStatus: "done",
          outcome: "restored",
        }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        rec(`P${i}`, {
          plan: "manual",
          itemStatus: "done",
          outcome: "replaced",
        }),
      ),
      rec("BK-2026", { plan: "manual", itemStatus: "manual" }),
    ];
    expect(laneCounts(records)).toEqual({
      authorised: 3,
      restored: 24,
      replaced: 2,
      exception: 1,
    });
  });
});

describe("itemTab", () => {
  it("files each recovery item under one tab", () => {
    expect(
      itemTab(item({ kind: "manual", status: "done", outcome: "replaced" })),
    ).toBe("replace");
    expect(
      itemTab(item({ kind: "restore", status: "done", outcome: "restored" })),
    ).toBe("restore");
    expect(itemTab(item({ kind: "restore", status: "pending" }))).toBe(
      "restore",
    );
    expect(itemTab(item({ kind: "restore", status: "failed" }))).toBe(
      "exception",
    );
    expect(itemTab(item({ kind: "manual", status: "manual" }))).toBe(
      "exception",
    );
  });
});
