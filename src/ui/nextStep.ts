import type { DemoState } from "@/engine/state";
import type { StepKey } from "@/scenarios/types";

// A person takes each of these, so a chained run stops in front of them.
const CHECKPOINTS: StepKey[] = ["propose", "fulfil", "settle"];

export function shouldContinue(s: DemoState): boolean {
  const { status, step, steps, error } = s.demo;
  if (error || (status !== "ready" && status !== "running")) return false;
  const key = steps[step + 1];
  return key !== undefined && !CHECKPOINTS.includes(key);
}

// advance runs proceed; customer, provider and approve open that party's dialog; done has nothing left to run.
export type NextKind = "advance" | "customer" | "provider" | "approve" | "done";
export type NextAction = { kind: NextKind; label: string };

const SECURED = ["secured", "fulfilled"];

export function nextAction(s: DemoState): NextAction {
  const { status, step, steps, error, scenario } = s.demo;
  const customer = s.case?.booking.customer.split(" ")[0] ?? "the customer";
  const finished: NextAction = s.exceptions.some((e) => e.status === "open")
    ? { kind: "done", label: "Review open exceptions" }
    : {
        kind: "done",
        label:
          scenario === "provider-cancel"
            ? "View money breakdown"
            : "View activity",
      };
  if (status === "done") return finished;
  if (status === "awaiting_customer")
    return { kind: "customer", label: "View customer booking" };
  if (status === "awaiting_approval")
    return { kind: "approve", label: "Review & approve plan" };
  const key = steps[step + 1];
  if (key === "fulfil") {
    // A refused or failed secure leaves nothing to fulfil, so the exception or refund comes next.
    if (!SECURED.includes(s.case?.ladder.state ?? "")) return finished;
    // The provider dialog retries its own step, so an error keeps this kind.
    return { kind: "provider", label: "View provider's job" };
  }
  if (error) return { kind: "advance", label: "Try again" };
  switch (key) {
    case "charge":
      return { kind: "advance", label: "Start recovery" };
    case "brief":
      return {
        kind: "advance",
        label: `Hand the task to ${s.scenario.agentName}`,
      };
    case "propose":
      return { kind: "advance", label: `Send offer to ${customer}` };
    case "settle":
      return { kind: "advance", label: "Release provider payment" };
    default:
      return { kind: "advance", label: "Continue recovery" };
  }
}
