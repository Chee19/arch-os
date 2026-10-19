"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { UiItem } from "@/engine/state";
import { money } from "@/lib/format";
import { useWorkspace } from "./WorkspaceProvider";
import { itemTab, type ItemTab } from "./incidentHelpers";
import { hasOpenException, TONE_CLASS } from "./labels";
import { gsap, useGSAP } from "./motion";

type Tab = "all" | ItemTab;

const TABS: [Tab, string][] = [
  ["all", "All affected"],
  ["restore", "Restore"],
  ["replace", "Replace"],
  ["exception", "Exception"],
];
const PAGE = 8;

const inTab = (tab: Tab, item: UiItem | undefined) =>
  tab === "all" || (item !== undefined && itemTab(item) === tab);

export function AffectedTable() {
  const { state } = useWorkspace();
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const body = useRef<HTMLTableSectionElement>(null);
  const verifiedCount = state?.incident?.verified.length ?? 0;

  useGSAP(
    () => {
      if (verifiedCount)
        gsap.from(".check-draw path", {
          drawSVG: 0,
          duration: 0.5,
          stagger: 0.04,
          ease: "power1.inOut",
        });
    },
    { scope: body, dependencies: [verifiedCount, page, tab] },
  );

  if (!state) return null;
  const items = new Map(
    (state.recovery?.items ?? []).map((i) => [i.target, i]),
  );
  const affected = new Set(
    state.incident?.affected ??
      state.records.filter((r) => r.tone === "bad").map((r) => r.target),
  );
  const verified = new Set(state.incident?.verified ?? []);
  const rowsFor = (t: Tab) =>
    state.records.filter(
      (r) => affected.has(r.target) && inTab(t, items.get(r.target)),
    );
  const rows = rowsFor(tab);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);

  return (
    <>
      <div className="tabs" role="group" aria-label="Affected booking filters">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => {
              setTab(id);
              setPage(1);
            }}
          >
            {label}
            <span>{rowsFor(id).length}</span>
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Booking</th>
              <th>Current state</th>
              <th>Recovery decision</th>
              <th>Replacement</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody ref={body}>
            {rows.slice((current - 1) * PAGE, current * PAGE).map((r) => {
              const it = items.get(r.target);
              return (
                <tr key={r.target}>
                  <td>
                    <span className="record-id">{r.target}</span>
                    <span className="minor strong">{r.title}</span>
                    <span className="minor">{r.subtitle}</span>
                  </td>
                  <td>
                    <span className={`status ${TONE_CLASS[r.tone]}`}>
                      <i className="dot" />
                      {r.status}
                    </span>
                  </td>
                  <td>
                    {verified.has(r.target) ? (
                      <span className="status green">
                        <svg
                          className="check-draw"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                        Verified
                      </span>
                    ) : it ? (
                      <span
                        className={`status ${it.status === "done" ? "green" : itemTab(it) === "exception" ? "amber" : ""}`}
                      >
                        {it.detail ?? it.reason}
                      </span>
                    ) : (
                      <span className="muted">
                        {state.incident ? "Awaiting plan" : "Not assessed"}
                      </span>
                    )}
                  </td>
                  <td>
                    {it?.replacement ? (
                      <>
                        <span className="mono">
                          {it.replacement.providerId}
                        </span>
                        <span className="minor">
                          Consent: {it.replacement.consentBasis}
                        </span>
                        <span className="minor">
                          Incentive {money(it.replacement.incentivePence)}
                        </span>
                      </>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>
                    {it?.assignedTo ?? it?.owner ?? "-"}
                    {hasOpenException(state.exceptions, r.target) && (
                      <span className="minor">
                        <Link className="text-link" href="/exceptions">
                          Exception open
                        </Link>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer between">
        <span>
          {rows.length
            ? `${(current - 1) * PAGE + 1} to ${Math.min(current * PAGE, rows.length)} of ${rows.length}`
            : "No bookings"}
        </span>
        <div className="pagination">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              className={current === i + 1 ? "selected" : ""}
              aria-label={`Page ${i + 1}`}
              aria-current={current === i + 1 ? "page" : undefined}
              onClick={() => setPage(i + 1)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
