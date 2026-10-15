"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { plural } from "@/lib/format";
import type { ScenarioId, Source } from "@/scenarios/types";
import { useDemo } from "./DemoProvider";
import { Icon, type IconName } from "./Icon";
import { gsap, useGSAP } from "./motion";

const NAV: [string, IconName, string][] = [
  ["/", "grid", "Overview"],
  ["/case", "card", "Case"],
  ["/incident", "incident", "Incident"],
  ["/exceptions", "warning", "Exceptions"],
  ["/history", "history", "History"],
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function Shell({ children }: { children: ReactNode }) {
  const { state, busy, error, toast, act, retry } = useDemo();
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const ready = state !== null;

  useGSAP(
    () => {
      const active = nav.current?.querySelector<HTMLElement>("a.active");
      if (active)
        gsap.to(".nav-indicator", {
          y: active.offsetTop,
          height: active.offsetHeight,
          duration: 0.35,
          ease: "power3.out",
        });
    },
    { scope: nav, dependencies: [pathname] },
  );

  useGSAP(
    () => {
      gsap.from(".panel, .metric", {
        y: 12,
        autoAlpha: 0,
        duration: 0.4,
        stagger: 0.04,
        ease: "power2.out",
        clearProps: "transform,opacity,visibility",
      });
    },
    { scope: main, dependencies: [pathname, ready] },
  );

  const configure = (
    patch: Partial<{ scenario: ScenarioId; source: Source }>,
  ) => {
    if (!state) return;
    void act({
      action: "configure",
      scenario: state.demo.scenario,
      source: state.demo.source,
      ...patch,
      // Scene 2 is scripted only.
      ...(patch.scenario === "bulk-cancel"
        ? { source: "scripted" as const }
        : {}),
    });
  };
  const openCount =
    state?.exceptions.filter((e) => e.status === "open").length ?? 0;
  const title = NAV.find(([href]) => href === pathname)?.[2] ?? "ArchOS";
  const crumbId =
    pathname === "/case"
      ? state?.case?.caseId
      : pathname === "/incident"
        ? state?.incident?.incidentId
        : undefined;
  const workspace = state?.workspace ?? "Workspace";
  const operator = state?.operator ?? "Operator";

  return (
    <>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="ArchOS overview">
          <div className="brand-mark">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <span>
            Arch<span style={{ fontWeight: 400, color: "#a6b69a" }}>OS</span>
          </span>
        </Link>
        <div className="workspace">
          <div className="workspace-icon">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M3.5 11 12 3.8l8.5 7.2v9.2h-17Z"
                fill="none"
                stroke="#86bcb0"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M12 19.5v-8"
                stroke="#c4e6a0"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <g fill="#b8a6e8">
                <circle cx="12" cy="10" r="1.6" />
                <circle cx="10.2" cy="13" r="1.5" />
                <circle cx="13.8" cy="14.6" r="1.5" />
              </g>
            </svg>
          </div>
          <div>
            <div className="name">{workspace}</div>
            <div className="muted">Marketplace workspace</div>
          </div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="nav" aria-label="Main navigation" ref={nav}>
          <span className="nav-indicator" aria-hidden="true" />
          {NAV.map(([href, icon, label]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : ""}
              aria-current={pathname === href ? "page" : undefined}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {href === "/exceptions" && openCount > 0 && (
                <span className="nav-count">{openCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="integration">
            <div className="flex">
              <i className={`dot ${error ? "red" : "green"}`} />{" "}
              {state?.scenario.systemsLabel ?? "Systems"}
            </div>
            <p>
              {state
                ? `${plural(state.records.length, state.scenario.targetLabel)} tracked`
                : "Connecting"}
            </p>
          </div>
          <div className="profile">
            <div className="avatar">{initials(operator)}</div>
            <div>
              <strong>{operator}</strong>
              <div className="muted">Operator</div>
            </div>
          </div>
        </div>
      </aside>
      <main className="main" ref={main}>
        <header className="topbar">
          <div className="crumb">
            <span>{workspace}</span>
            <span>/</span>
            <span className="current">{title}</span>
            {crumbId && (
              <>
                <span>/</span>
                <span className="mono">{crumbId}</span>
              </>
            )}
          </div>
          <div className="top-meta">
            <span className="sandbox">Stripe test mode · fictional data</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading between">
            <h1>{title}</h1>
            {state && (
              <div className="heading-actions">
                <select
                  className="mode-select"
                  aria-label="Scene"
                  value={state.demo.scenario}
                  disabled={busy}
                  onChange={(e) =>
                    configure({ scenario: e.target.value as ScenarioId })
                  }
                >
                  {state.scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.short}
                    </option>
                  ))}
                </select>
                <select
                  className="mode-select"
                  aria-label="Agent source"
                  title="The full live agent loop is a stretch goal"
                  value={state.demo.source}
                  disabled={busy}
                  onChange={(e) =>
                    configure({ source: e.target.value as Source })
                  }
                >
                  <option value="scripted">Scripted agent</option>
                  <option value="live" disabled={state.demo.source !== "live"}>
                    Live agent (stretch)
                  </option>
                </select>
                <button
                  className="icon-btn"
                  title="Reset demo"
                  aria-label="Reset demo"
                  disabled={busy}
                  onClick={() => void act({ action: "reset" })}
                >
                  <Icon name="reset" />
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="warning" /> {error}
              <button className="btn ghost small" onClick={() => void retry()}>
                Retry
              </button>
            </div>
          )}
          {state ? children : <Skeleton />}
          <footer className="footer">
            <span>
              Fictional companies and people · Stripe test mode only · Scripted
              agent with live constraint extraction
            </span>
          </footer>
        </div>
      </main>
      <div
        id="toast"
        role="status"
        aria-live="polite"
        className={toast ? "visible" : ""}
      >
        {toast}
      </div>
    </>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 230, marginBottom: 16 }} />
      <div className="metrics">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 110 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 320, marginTop: 16 }} />
    </div>
  );
}
