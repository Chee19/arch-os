"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { gsap, useGSAP } from "./motion";
import {
  HelpDialog,
  NotificationsDialog,
  ProfileDialog,
  initials,
  needsAttention,
} from "./ShellDialogs";
import { useWorkspace } from "./WorkspaceProvider";

type NavItem = [href: string, icon: IconName, label: string];

const WORKSPACE_NAV: NavItem[] = [
  ["/", "grid", "Overview"],
  ["/case", "inbox", "Recoveries"],
  ["/incident", "shield", "Incidents"],
  ["/exceptions", "warning", "Exceptions"],
  ["/history", "clock", "Activity"],
];
const MANAGE_NAV: NavItem[] = [["/rules", "sliders", "Recovery rules"]];
const LABELS = new Map(
  [...WORKSPACE_NAV, ...MANAGE_NAV].map((n) => [n[0], n[2]]),
);

type Health = { mongo?: boolean; stripe?: boolean };
type Dialog = "help" | "profile" | "notifications" | null;

const CELLS: [number, number, number][] = [
  [5.2, 5.2, 1],
  [11.8, 5.2, 1],
  [18.4, 5.2, 0.25],
  [5.2, 11.8, 1],
  [11.8, 11.8, 1],
  [18.4, 11.8, 0.55],
  [5.2, 18.4, 1],
  [11.8, 18.4, 0.55],
  [18.4, 18.4, 0.25],
];

function Logo() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="#e6ddf8" />
      {CELLS.map(([x, y, o]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="4.4"
          height="4.4"
          rx="0.7"
          fill="#7460ca"
          opacity={o}
        />
      ))}
    </svg>
  );
}

// The body is JSON even on a 503, so it is read regardless of status.
function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  return health;
}

export function Shell({ children }: { children: ReactNode }) {
  const { state, error, toast, retry } = useWorkspace();
  const pathname = usePathname();
  const main = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const health = useHealth();
  const ready = state !== null;

  useGSAP(
    () => {
      // Skip while the skeleton shows, or GSAP logs a missing-target warning.
      const cards = main.current?.querySelectorAll(
        ".glass, .panel, .stat-card, .metric",
      );
      if (!cards?.length) return;
      gsap.from(cards, {
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

  const openCount =
    state?.exceptions.filter((e) => e.status === "open").length ?? 0;
  const workspace = state?.workspace ?? "Workspace";
  const operator = state?.operator ?? "Operator";
  const label = LABELS.get(pathname) ?? "ArchOS";
  const crumbExtra =
    pathname === "/case"
      ? state?.case?.booking.customer
      : pathname === "/incident"
        ? state?.incident?.incidentId
        : undefined;

  const failing = health
    ? [!health.mongo && "database", !health.stripe && "payments"].filter(
        Boolean,
      )
    : [];
  const tone = !health
    ? ""
    : failing.length === 0
      ? "ok"
      : failing.length === 2
        ? "bad"
        : "warn";
  const statusTitle = !health
    ? "Checking connections"
    : failing.length === 0
      ? "All connections healthy"
      : `${failing.join(" and ")} unavailable`;

  const close = () => setDialog(null);
  const navItem = ([href, icon, text]: NavItem) => (
    <Link
      key={href}
      href={href}
      className={`nav-item ${pathname === href ? "active" : ""}`}
      aria-current={pathname === href ? "page" : undefined}
      onClick={() => setMenu(false)}
    >
      <Icon name={icon} />
      <span>{text}</span>
      {href === "/exceptions" && openCount > 0 && <b>{openCount}</b>}
    </Link>
  );

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <Link className="brand" href="/" aria-label="ArchOS overview">
          <Logo />
          <span>
            Arch<span className="brand-os">OS</span>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-icon" aria-hidden="true">
            {workspace.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{workspace}</strong>
            <small>Marketplace workspace</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">{WORKSPACE_NAV.map(navItem)}</nav>
        <p className="nav-label second">MANAGE</p>
        <nav aria-label="Configuration">{MANAGE_NAV.map(navItem)}</nav>
        <div className="sidebar-bottom">
          <div className="quiet-card">
            <Icon name="leaf" />
            <strong>One booking at a time.</strong>
            <p>Calm, clear next steps for every recovery.</p>
            <button
              className="btn text-btn"
              onClick={() => {
                setMenu(false);
                setDialog("help");
              }}
            >
              How ArchOS works <Icon name="arrow" />
            </button>
          </div>
          <button
            className="profile"
            onClick={() => {
              setMenu(false);
              setDialog("profile");
            }}
          >
            <span className="avatar lavender">{initials(operator)}</span>
            <span>
              <strong>{operator}</strong>
              <small>Operations lead</small>
            </span>
            <Icon name="down" />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
            <Icon name="chevron" />
            <strong>
              {label}
              {crumbExtra ? ` / ${crumbExtra}` : ""}
            </strong>
          </div>
          <div className="top-tools">
            <span className="workspace-status" title={statusTitle}>
              {workspace}
              <i className={`status-dot ${tone}`} aria-hidden="true" />
              <span className="sr-only">{statusTitle}</span>
            </span>
            <button
              className="icon-btn"
              aria-label="View notifications"
              onClick={() => setDialog("notifications")}
            >
              <Icon name="bell" />
              {state && needsAttention(state) && (
                <span className="notification-dot" aria-hidden="true" />
              )}
            </button>
            <span className="avatar small lavender" aria-hidden="true">
              {initials(operator)}
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1} ref={main}>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="warning" /> {error}
              <button className="btn soft small" onClick={() => void retry()}>
                Retry
              </button>
            </div>
          )}
          {state ? children : <Skeleton />}
        </main>
        <footer className="app-footer">
          <span>
            <Icon name="shield" /> Every booking deserves a way forward.
          </span>
          <button onClick={() => setDialog("help")}>
            Help &amp; support <Icon name="arrow" />
          </button>
        </footer>
      </div>
      <HelpDialog open={dialog === "help"} onClose={close} />
      <ProfileDialog open={dialog === "profile"} onClose={close} />
      <NotificationsDialog open={dialog === "notifications"} onClose={close} />
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
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
      <div className="stats-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 110 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  );
}
