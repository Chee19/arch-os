"use client";

import type { ScenarioId } from "@/scenarios/types";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";

export function SwitchScene({ scenario }: { scenario: ScenarioId }) {
  const { state, busy, act } = useDemo();
  const name =
    state?.scenarios.find((s) => s.id === scenario)?.name ?? scenario;
  return (
    <section className="panel empty-state">
      <Icon name="info" />
      <h2>This page shows {name}</h2>
      <p>The current run is the other scene. Switching resets the demo.</p>
      <button
        className="btn primary"
        disabled={busy}
        onClick={() =>
          void act({ action: "configure", scenario, source: "scripted" })
        }
      >
        Switch scene <Icon name="arrow" />
      </button>
    </section>
  );
}
