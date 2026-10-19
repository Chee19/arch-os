"use client";

import type { ScenarioId } from "@/scenarios/types";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";

export function SwitchScene({ scenario }: { scenario: ScenarioId }) {
  const { state, busy, act } = useWorkspace();
  const target = state?.scenarios.find((s) => s.id === scenario);
  const other = state?.scenarios.find((s) => s.id !== scenario);
  const name = target?.name ?? "This case";
  return (
    <section className="glass padded empty-state">
      <Icon name="inbox" />
      <h2>{name} isn&rsquo;t open in this workspace</h2>
      <p>
        Opening it loads its records fresh and clears the progress on{" "}
        {other?.short ?? "the other case"}.
      </p>
      <button
        className="btn primary"
        disabled={busy}
        onClick={() =>
          void act({ action: "configure", scenario, source: "scripted" })
        }
      >
        Open {target?.short ?? "case"} <Icon name="arrow" />
      </button>
    </section>
  );
}
