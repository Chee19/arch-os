import type { Mutation, Rec } from "@/scenarios/types";

type WithMutations = { mutations: Mutation[] };

export function outOfScope(targets: string[], approved: string[]): string[] {
  const ok = new Set(approved);
  return [...new Set(targets)].filter((t) => !ok.has(t)).sort();
}

export function changedTargets(actions: WithMutations[]): string[] {
  const ids = actions
    .flatMap((a) => a.mutations.map((m) => m.target))
    .filter((t): t is string => t !== null);
  return [...new Set(ids)].sort();
}

export function beforeStates(actions: WithMutations[]): Map<string, Rec[]> {
  const first = new Map<string, { target: string; rec: Rec }>();
  for (const a of actions)
    for (const m of a.mutations) {
      const key = `${m.system}:${m.recordId}`;
      if (m.target && !first.has(key))
        first.set(key, {
          target: m.target,
          rec: {
            system: m.system,
            recordId: m.recordId,
            target: m.target,
            data: m.before,
            version: 0,
          },
        });
    }
  const out = new Map<string, Rec[]>();
  for (const { target, rec } of first.values())
    out.set(target, [...(out.get(target) ?? []), rec]);
  return out;
}
