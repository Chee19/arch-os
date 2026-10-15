import type { DemoStatus } from "@/engine/docs";
import { type LadderState, latestOps } from "@/engine/ladder";
import type { UiPaymentOp } from "@/engine/state";
import { money } from "@/lib/format";
import type { Split } from "@/money/math";
import { canSubmit } from "./labels";

export const LADDER_STEPS: LadderState[] = [
  "investigating",
  "offered",
  "secured",
  "fulfilled",
  "settled",
];

export type Rung = "done" | "current" | "todo";

export function ladderRungs(state: LadderState): Rung[] {
  // Remedied is a terminal badge; a declined case stopped after Offered.
  if (state === "remedied")
    return LADDER_STEPS.map((s) =>
      s === "investigating" || s === "offered" ? "done" : "todo",
    );
  const at = LADDER_STEPS.indexOf(state);
  return LADDER_STEPS.map((_, i) =>
    i < at || state === "settled" ? "done" : i === at ? "current" : "todo",
  );
}

export function remaining(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
}

export const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function canAccept(
  busy: boolean,
  status: DemoStatus,
  expiresAt: string | null,
  now: number | null,
): boolean {
  return (
    canSubmit(busy, status) === "respond" &&
    expiresAt !== null &&
    now !== null &&
    remaining(expiresAt, now) > 0
  );
}

// paid = refund + customerNet and customerNet + subsidy = transfer + commission.
export function sumCheck(s: Split): { ok: boolean; text: string } {
  const subsidy = s.subsidy ? ` - ${money(s.subsidy)} subsidy` : "";
  return {
    ok: s.paid === s.refund + s.transfer + s.commission - s.subsidy,
    text: `${money(s.paid)} = ${money(s.refund)} + ${money(s.transfer)} + ${money(s.commission)}${subsidy}`,
  };
}

export const latestOf = (
  ops: UiPaymentOp[],
  kind: UiPaymentOp["kind"],
): UiPaymentOp | null => latestOps(ops)[kind] ?? null;
