"use client";

import { plural } from "@/lib/format";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";

export function Containment({ onResume }: { onResume: () => void }) {
  const { state, busy, act } = useDemo();
  if (!state) return null;
  const suspended =
    state.scenarios.find((x) => x.id === state.scenario.id)?.status ===
    "suspended";
  return (
    <section className="panel containment">
      <div className="between">
        <h2 className="flex">
          <Icon name="shield" /> Containment
        </h2>
        <button
          className={`toggle ${suspended ? "" : "off"}`}
          role="switch"
          aria-checked={suspended}
          aria-label={`Suspend ${state.scenario.agentName} write tools`}
          disabled={busy}
          onClick={() =>
            suspended ? onResume() : void act({ action: "contain" })
          }
        />
      </div>
      <div className={`status ${suspended ? "green" : "amber"}`}>
        <i className="dot" />
        {suspended ? "Write tools suspended" : "Write tools active"}
      </div>
      <p>
        {suspended
          ? "Read access stays on for investigation."
          : `${state.scenario.agentName} can still change bookings.`}
      </p>
      <p className="mono">
        {plural(state.metrics.blocked, "call")} blocked by the gateway
      </p>
    </section>
  );
}
