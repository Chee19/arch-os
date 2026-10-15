import type { UiException } from "@/engine/state";

// Open work first and soonest due first, so an overdue item is always on top.
export function sortExceptions(xs: UiException[]): UiException[] {
  return [...xs].sort(
    (a, b) =>
      Number(a.status !== "open") - Number(b.status !== "open") ||
      Date.parse(a.dueAt) - Date.parse(b.dueAt),
  );
}
