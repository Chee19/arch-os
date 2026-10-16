import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { CallResult, DemoDoc } from "@/engine/docs";
import { StepError } from "@/engine/errors";
import { runScripted } from "@/engine/scene1";

const results = vi.hoisted(() => ({ next: [] as CallResult[] }));
vi.mock("@/engine/gateway", () => ({
  callTool: async () => ({ ok: true, result: null, targets: [] }),
  runScript: async () => results.next,
}));

const demo = { scenario: "provider-cancel", runId: "run1" } as DemoDoc;

describe("runScripted", () => {
  it("throws a StepError when a script call fails for a non-policy reason", async () => {
    for (const reason of [
      "invalid_args",
      "tool_error",
      "unknown_tool",
      "suspended",
    ] as const) {
      results.next = [{ ok: false, reason, message: `call failed: ${reason}` }];
      await expect(runScripted({} as Db, demo, "search")).rejects.toThrow(
        new StepError(`call failed: ${reason}`),
      );
    }
  });
});
