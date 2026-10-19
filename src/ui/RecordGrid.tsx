"use client";

import { useRef } from "react";
import type { UiRecord } from "@/engine/state";
import { useWorkspace } from "./WorkspaceProvider";
import { diffRecords } from "./diff";
import { LANE_LABEL, LANES, laneOf, type Lane } from "./incidentHelpers";
import { TONE_GLYPH, TONE_LABEL } from "./labels";
import { Flip, gsap, useGSAP } from "./motion";

const TONES: UiRecord["tone"][] = [
  "idle",
  "scope",
  "changed",
  "bad",
  "ok",
  "warn",
];
const GROUPS: (Lane | null)[] = [...LANES, null];

export function RecordGrid() {
  const { state } = useWorkspace();
  const root = useRef<HTMLDivElement>(null);
  const prev = useRef<UiRecord[] | null>(null);
  const layout = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const order = useRef("");
  const hadIncident = useRef(false);
  const records = state?.records;
  const incident = Boolean(state?.incident);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || !records) return;
      // Capture before any tween starts so the pop's scale frame is not recorded as layout.
      const nextLayout = Flip.getState(el.querySelectorAll("[data-flip-id]"));
      const key = Array.from(el.querySelectorAll("[data-flip-id]"))
        .map((c) => c.getAttribute("data-flip-id"))
        .join("|");
      // Only lane moves need Flip; polls that change nothing visible must not replay it.
      if (layout.current && key !== order.current)
        Flip.from(layout.current, { duration: 0.6, ease: "power2.inOut" });
      order.current = key;
      const cells = diffRecords(prev.current, records)
        .changed.map((id) =>
          el.querySelector(`[data-flip-id="${CSS.escape(id)}"]`),
        )
        .filter((c): c is Element => c !== null);
      if (prev.current && cells.length)
        gsap.fromTo(
          cells,
          { scale: 0.55, autoAlpha: 0.4 },
          {
            scale: 1,
            autoAlpha: 1,
            duration: 0.45,
            ease: "back.out(2)",
            stagger: Math.min(0.03, 1.2 / cells.length),
          },
        );
      const scan = el.querySelector(".scanline");
      if (scan && incident && !hadIncident.current && prev.current)
        gsap.fromTo(
          scan,
          { left: "0%", autoAlpha: 1 },
          {
            left: "100%",
            duration: 1.2,
            ease: "none",
            onComplete: () => void gsap.set(scan, { autoAlpha: 0 }),
          },
        );
      hadIncident.current = incident;
      prev.current = records;
      layout.current = nextLayout;
    },
    { scope: root, dependencies: [records, incident] },
  );

  if (!state || !records) return null;
  const count = (tone: UiRecord["tone"]) =>
    records.filter((r) => r.tone === tone).length;
  return (
    <div ref={root} className="lane-grid">
      <i className="scanline" aria-hidden="true" />
      {GROUPS.map((lane) => {
        const rows = records.filter((r) => laneOf(r) === lane);
        if (!rows.length) return null;
        return (
          <div className="lane-row" key={lane ?? "open"}>
            <span className="lane-label">
              {lane
                ? LANE_LABEL[lane]
                : incident
                  ? "Awaiting recovery"
                  : "Other bookings"}
              <b>{rows.length}</b>
            </span>
            <div className="record-strip auto">
              {rows.map((r) => (
                <span
                  key={r.target}
                  data-flip-id={r.target}
                  role="img"
                  className={`record-cell tone-${r.tone} ${r.inScope ? "in-scope" : ""}`}
                  title={`${r.title}: ${r.status}`}
                  aria-label={`${r.title}: ${r.status}, ${TONE_LABEL[r.tone]}`}
                >
                  {TONE_GLYPH[r.tone]}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <div className="record-legend">
        {TONES.filter((t) => count(t)).map((t) => (
          <span key={t}>
            <i className={`legend-cell record-cell tone-${t}`}>
              {TONE_GLYPH[t]}
            </i>
            {TONE_LABEL[t]}
            <b>{count(t)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
