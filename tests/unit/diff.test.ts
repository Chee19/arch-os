import { describe, expect, it } from "vitest";
import type { UiRecord } from "@/engine/state";
import { diffRecords } from "@/ui/diff";

const rec = (target: string, over: Partial<UiRecord> = {}): UiRecord => ({
  target,
  title: target,
  subtitle: "",
  status: "",
  stage: "draft",
  lane: null,
  tone: "idle",
  inScope: false,
  version: 1,
  plan: null,
  itemStatus: null,
  outcome: null,
  ...over,
});

describe("diffRecords", () => {
  it("treats the first render as all entered", () =>
    expect(diffRecords(null, [rec("a")])).toEqual({
      changed: [],
      entered: ["a"],
    }));

  it("reports version, tone, plan, item and outcome changes in list order", () => {
    const prev = [rec("a"), rec("b"), rec("c"), rec("d"), rec("e")];
    const next = [
      rec("a", { version: 2 }),
      rec("b"),
      rec("c", { tone: "bad" }),
      rec("d", { plan: "restore" }),
      rec("e", { outcome: "replaced" }),
    ];
    expect(diffRecords(prev, next).changed).toEqual(["a", "c", "d", "e"]);
  });
});
