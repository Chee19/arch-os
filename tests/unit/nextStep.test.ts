import { describe, expect, it } from "vitest";
import type { DemoStatus } from "@/engine/docs";
import type { DemoState } from "@/engine/state";
import type { StepKey } from "@/scenarios/types";
import { nextAction, shouldContinue } from "@/ui/nextStep";

const RESCUE: StepKey[] = [
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

const at = (
  step: number,
  status: DemoStatus = "running",
  error: string | null = null,
  ladder = "secured",
  open = false,
) =>
  ({
    demo: { scenario: "provider-cancel", steps: RESCUE, step, status, error },
    scenario: { agentName: "Ops Agent" },
    case: { booking: { customer: "Maya Chen" }, ladder: { state: ladder } },
    exceptions: open ? [{ status: "open" }] : [],
  }) as unknown as DemoState;

describe("shouldContinue", () => {
  it("runs the agent's own steps", () => {
    expect(shouldContinue(at(-1, "ready"))).toBe(true);
    expect(shouldContinue(at(2))).toBe(true);
  });

  it("stops in front of each step a person takes", () => {
    expect(shouldContinue(at(5))).toBe(false); // propose
    expect(shouldContinue(at(8))).toBe(false); // fulfil
    expect(shouldContinue(at(9))).toBe(false); // settle
  });

  it("stops while waiting, on an error and when finished", () => {
    expect(shouldContinue(at(7, "awaiting_customer"))).toBe(false);
    expect(shouldContinue(at(2, "running", "Stripe timed out"))).toBe(false);
    expect(shouldContinue(at(11, "done"))).toBe(false);
  });
});

describe("nextAction", () => {
  it("names the decision each checkpoint is waiting on", () => {
    expect(nextAction(at(-1, "ready")).label).toBe("Start recovery");
    expect(nextAction(at(5)).label).toBe("Send offer to Maya");
    expect(nextAction(at(7, "awaiting_customer")).kind).toBe("customer");
    expect(nextAction(at(8)).kind).toBe("provider");
    expect(nextAction(at(9)).label).toBe("Release provider payment");
    expect(nextAction(at(2, "running", "boom")).label).toBe("Try again");
  });

  it("sends a failed fulfil back to the provider dialog to retry", () => {
    expect(nextAction(at(8, "running", "Stripe timed out")).kind).toBe(
      "provider",
    );
  });

  it("never offers the provider's job when nothing was secured", () => {
    const refused = nextAction(at(8, "running", null, "offered", true));
    expect(refused).toEqual({ kind: "done", label: "Review open exceptions" });
  });
});
