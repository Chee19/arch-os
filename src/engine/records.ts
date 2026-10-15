import type { Change, Rec } from "@/scenarios/types";

export const keyOf = (r: { system: string; recordId: string }) =>
  `${r.system}:${r.recordId}`;

export function byTarget(recs: Rec[], target: string): Rec[] {
  return recs.filter((r) => r.target === target);
}

export function bySystem(recs: Rec[], system: string): Rec[] {
  return recs.filter((r) => r.system === system);
}

export function find(
  recs: Rec[],
  system: string,
  recordId: string,
): Rec | undefined {
  return recs.find((r) => r.system === system && r.recordId === recordId);
}

export function dataOf<T>(recs: Rec[], system: string): T {
  const r = recs.find((x) => x.system === system);
  if (!r) throw new Error(`No ${system} record`);
  return r.data as unknown as T;
}

export function applyChanges(recs: Rec[], changes: Change[]): Rec[] {
  const next = new Map(changes.map((c) => [keyOf(c), c.data]));
  return recs.map((r) => {
    const data = next.get(keyOf(r));
    return data ? { ...r, data, version: r.version + 1 } : r;
  });
}

export function stripSim(recs: Rec[]): Rec[] {
  return recs.map((r) => ({
    ...r,
    data: Object.fromEntries(
      Object.entries(r.data).filter(([k]) => k !== "_sim"),
    ),
  }));
}

export function versionsOf(recs: Rec[]): Record<string, number> {
  return Object.fromEntries(recs.map((r) => [keyOf(r), r.version]));
}
