import type { DemoState, UiItem, UiRecord } from "@/engine/state";

export const LANES = [
  "authorised",
  "restored",
  "replaced",
  "exception",
] as const;
export type Lane = (typeof LANES)[number];

export const LANE_LABEL: Record<Lane, string> = {
  authorised: "Authorised by the task",
  restored: "Restored",
  replaced: "Replaced",
  exception: "Exception",
};

// A booking moves lane only when its recovery item records an outcome or a hand-off.
export function laneOf(r: UiRecord): Lane | null {
  if (r.inScope) return "authorised";
  if (r.outcome) return r.outcome;
  if (
    r.plan === "manual" ||
    r.itemStatus === "failed" ||
    r.itemStatus === "skipped"
  )
    return "exception";
  return null;
}

export function laneCounts(records: UiRecord[]): Record<Lane, number> {
  const counts: Record<Lane, number> = {
    authorised: 0,
    restored: 0,
    replaced: 0,
    exception: 0,
  };
  for (const r of records) {
    const lane = laneOf(r);
    if (lane) counts[lane] += 1;
  }
  return counts;
}

export type ItemTab = "restore" | "replace" | "exception";

export function itemTab(i: UiItem): ItemTab {
  if (i.outcome === "replaced") return "replace";
  if (i.kind === "restore" && i.status !== "failed" && i.status !== "skipped")
    return "restore";
  return "exception";
}

export const isSuspended = (s: DemoState): boolean =>
  s.scenarios.find((x) => x.id === s.scenario.id)?.status === "suspended";
