import type { Db } from "mongodb";
import { z } from "zod";
import { replayOp } from "@/money/ops";
import { Conflict } from "./errors";
import { assignException } from "./exceptions";
import { contain, resume } from "./incident";
import { approveRecovery } from "./recovery";
import { advance, type LiveRunner } from "./run";
import { exceptionAction, recheck, respond } from "./scene1";
import { col, DEFAULT_CONFIG, getDemo, OPERATOR, resetDemo } from "./store";

export const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("configure"),
    scenario: z.enum(["provider-cancel", "bulk-cancel"]),
    source: z.enum(["scripted", "live"]),
  }),
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("advance"), step: z.number().int().min(-1) }),
  z.object({
    action: z.literal("respond"),
    decision: z.enum(["accept", "decline"]),
  }),
  z.object({ action: z.literal("approve"), confirmed: z.literal(true) }),
  z.object({ action: z.literal("contain") }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("assign"),
    exceptionId: z.string().min(1),
    owner: z.string().min(1),
  }),
  z.object({
    action: z.literal("exception"),
    exceptionId: z.string().min(1),
    do: z.enum(["refund", "retry", "close"]),
    note: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal("recheck"), opId: z.string().min(1) }),
  z.object({ action: z.literal("replay"), opId: z.string().min(1) }),
]);
export type Action = z.infer<typeof ActionSchema>;

export async function handle(
  d: Db,
  a: Action,
  live?: LiveRunner,
): Promise<{ notice?: string }> {
  switch (a.action) {
    case "configure":
      await resetDemo(d, {
        scenario: a.scenario,
        mode: "monitor",
        source: a.source,
      });
      return {};
    case "reset": {
      const cur = await col.demo(d).findOne({ _id: "demo" });
      await resetDemo(
        d,
        cur
          ? { scenario: cur.scenario, mode: "monitor", source: cur.source }
          : DEFAULT_CONFIG,
      );
      return {};
    }
    case "advance":
      await advance(d, a.step, live);
      return {};
    case "respond":
      await respond(d, a.decision);
      return {};
    case "approve": {
      // Claiming the status first makes a double click approve once, and lets advance run.
      const demo = await getDemo(d);
      const waiting = {
        _id: "demo" as const,
        runId: demo.runId,
        status: "awaiting_approval" as const,
      };
      const res = await col
        .demo(d)
        .updateOne(waiting, { $set: { status: "running" } });
      if (!res.modifiedCount)
        throw new Conflict("Nothing is waiting for approval.");
      try {
        await approveRecovery(d, OPERATOR);
      } catch (e) {
        // Put the Approve button back rather than leave a running run that skipped approval.
        await col
          .demo(d)
          .updateOne(
            { ...waiting, status: "running" },
            { $set: { status: "awaiting_approval" } },
          );
        throw e;
      }
      await advance(d, demo.step, live);
      return {};
    }
    case "contain":
      await contain(d, OPERATOR);
      return {};
    case "resume":
      await resume(d, OPERATOR);
      return {};
    case "assign":
      await assignException(d, a.exceptionId, a.owner, OPERATOR);
      return {};
    case "exception":
      await exceptionAction(d, a.exceptionId, a.do, a.note);
      return {};
    case "recheck":
      await recheck(d, a.opId);
      return {};
    case "replay": {
      const r = await replayOp(d, a.opId);
      return {
        notice: r.same
          ? `Duplicate suppressed: Stripe returned the same ${r.stripeId}`
          : `Stripe returned a different object: ${r.stripeId}`,
      };
    }
  }
}
