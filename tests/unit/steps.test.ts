import { describe, expect, it } from "vitest";
import { STEP_META, stepsFor } from "@/engine/steps";
import type { StepKey } from "@/scenarios/types";

const SCENE1: StepKey[] = [
  "charge",
  "failure",
  "understand",
  "search",
  "boundary",
  "negotiate",
  "propose",
  "consent",
  "secure",
  "fulfil",
  "settle",
  "ledger",
];
const SCENE1_LIVE: StepKey[] = [
  "charge",
  "failure",
  "agent",
  "consent",
  "secure",
  "fulfil",
  "settle",
  "ledger",
];
const SCENE2: StepKey[] = [
  "brief",
  "agentReads",
  "agentActs",
  "detect",
  "contain",
  "plan",
  "approve",
  "restore",
  "rescue",
  "verify",
];

describe("stepsFor", () => {
  it("lists Scene 1 scripted steps", () =>
    expect(stepsFor("provider-cancel", "scripted")).toEqual(SCENE1));
  it("lists Scene 1 live steps", () =>
    expect(stepsFor("provider-cancel", "live")).toEqual(SCENE1_LIVE));
  it("runs Scene 2 scripted whatever the source", () => {
    expect(stepsFor("bulk-cancel", "scripted")).toEqual(SCENE2);
    expect(stepsFor("bulk-cancel", "live")).toEqual(SCENE2);
  });
});

describe("STEP_META", () => {
  it("has copy for every step key", () => {
    const keys = [...new Set([...SCENE1, ...SCENE1_LIVE, ...SCENE2])].sort();
    expect(keys).toHaveLength(23);
    expect(Object.keys(STEP_META).sort()).toEqual(keys);
    for (const m of Object.values(STEP_META))
      for (const text of [m.label, m.actor, m.title, m.check])
        expect(text.length).toBeGreaterThan(0);
  });
  it("focuses the tabs from spec 3.1", () =>
    expect(SCENE1.map((k) => STEP_META[k].focusTab)).toEqual([
      "money",
      "reasoning",
      "reasoning",
      "candidates",
      "candidates",
      "candidates",
      "messages",
      "messages",
      "money",
      "money",
      "money",
      "ledger",
    ]));
});
