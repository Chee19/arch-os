"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ScenarioId } from "@/scenarios/types";
import { useDemo } from "../DemoProvider";
import { Icon } from "../Icon";
import { SCENE_INTRO, STATUS_LABEL, type ToneClass } from "../labels";

type Health = {
  mongo?: boolean;
  stripe?: boolean;
  stripeTestKey?: boolean;
  nebius?: boolean;
};

const SCENES: {
  id: ScenarioId;
  href: string;
  title: string;
  facts: string[];
}[] = [
  {
    id: "provider-cancel",
    href: "/case",
    title: "The provider cancelled. Save the booking.",
    facts: [
      "£300 booking, BK-1042",
      "Real Stripe test-mode charge, refund and transfer",
      "Live constraint extraction with a scripted fallback",
    ],
  },
  {
    id: "bulk-cancel",
    href: "/incident",
    title: "30 cancelled instead of 3",
    facts: [
      "30 Harbour Lettings bookings",
      "Detect, contain, restore and replace",
      "One exception with a named owner",
    ],
  },
];

export function OverviewView() {
  const { state, busy, act } = useDemo();
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let live = true;
    // The body is JSON on 503 too, so read it regardless of status.
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .catch((): Health => ({}))
      .then((h) => {
        if (live) setHealth(h);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!state) return null;
  const run = async (id: ScenarioId, href: string) => {
    if (await act({ action: "configure", scenario: id, source: "scripted" }))
      router.push(href);
  };
  const checks: [string, boolean, string, ToneClass][] = health
    ? [
        ["MongoDB", health.mongo === true, "down", "red"],
        [
          "Stripe test mode",
          health.stripe === true && health.stripeTestKey !== false,
          "down",
          "red",
        ],
        ["Nebius", health.nebius === true, "off, scripted fallback", "amber"],
      ]
    : [];

  return (
    <>
      <section className="panel">
        <div className="panel-head between">
          <h2>System health</h2>
          <span className="mono muted">/api/health</span>
        </div>
        <div className="health-row" aria-live="polite">
          {health === null ? (
            <span className="muted">Checking services</span>
          ) : (
            checks.map(([label, ok, bad, tone]) => (
              <span key={label} className={ok ? "green" : tone}>
                <i className="dot" />
                {label}: {ok ? "ok" : bad}
              </span>
            ))
          )}
        </div>
      </section>
      <div className="scene-grid wide-panel">
        {SCENES.map((s) => {
          const meta = state.scenarios.find((x) => x.id === s.id);
          const active = state.demo.scenario === s.id;
          return (
            <section className="panel scene-card" key={s.id}>
              <div className="panel-head between">
                <span className="eyebrow">{meta?.short ?? s.id}</span>
                {active && (
                  <span className="badge green">
                    <i className="dot" />
                    Active · {STATUS_LABEL[state.demo.status]}
                  </span>
                )}
              </div>
              <div className="panel-body">
                <h3>{s.title}</h3>
                <p>{SCENE_INTRO[s.id]}</p>
                <ul className="scene-facts">
                  {s.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {meta && (
                  <p className="mono">
                    {meta.agentName} · {meta.agentRole}
                  </p>
                )}
              </div>
              <div className="scene-actions">
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void run(s.id, s.href)}
                >
                  Run from the start <Icon name="arrow" />
                </button>
                {active && (
                  <Link className="btn ghost" href={s.href}>
                    Open current run
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
