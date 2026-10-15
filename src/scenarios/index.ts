import { bulkCancel } from "./bulk-cancel";
import { providerCancel } from "./provider-cancel";
import type { Scenario, ScenarioId } from "./types";

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  "provider-cancel": providerCancel,
  "bulk-cancel": bulkCancel,
};
