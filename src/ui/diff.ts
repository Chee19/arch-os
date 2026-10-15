import type { UiRecord } from "@/engine/state";

export type RecordDiff = { changed: string[]; entered: string[] };

export function diffRecords(
  prev: UiRecord[] | null,
  next: UiRecord[],
): RecordDiff {
  if (!prev) return { changed: [], entered: next.map((r) => r.target) };
  const before = new Map(prev.map((r) => [r.target, r]));
  const changed: string[] = [];
  const entered: string[] = [];
  for (const r of next) {
    const p = before.get(r.target);
    if (!p) entered.push(r.target);
    else if (
      p.version !== r.version ||
      p.tone !== r.tone ||
      p.plan !== r.plan ||
      p.itemStatus !== r.itemStatus ||
      p.outcome !== r.outcome
    )
      changed.push(r.target);
  }
  return { changed, entered };
}
