"use client";

import { plural } from "@/lib/format";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";
import { isSuspended } from "./incidentHelpers";

export function Containment({ onResume }: { onResume: () => void }) {
  const { state, busy, act } = useWorkspace();
  if (!state) return null;
  const suspended = isSuspended(state);
  return (
    <section className="glass padded containment">
      <div className="between">
        <h3 className="flex">
          <Icon name="shield" /> Agent access
        </h3>
        <span className={`badge ${suspended ? "peach" : "green"}`}>
          <i />
          {suspended ? "Write access paused" : "Write access active"}
        </span>
      </div>
      <p>
        {suspended
          ? "Read access stays on for investigation."
          : `${state.scenario.agentName} can still change bookings.`}{" "}
        {plural(state.metrics.blocked, "call")} blocked by the gateway.
      </p>
      <button
        className="btn soft small"
        disabled={busy}
        onClick={() =>
          suspended ? onResume() : void act({ action: "contain" })
        }
      >
        {suspended ? "Resume write access" : "Pause write access"}
      </button>
    </section>
  );
}
