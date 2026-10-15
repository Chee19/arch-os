"use client";

import { useRef, useState } from "react";
import type { FocusTab } from "@/scenarios/types";
import { AgentConsole } from "./AgentConsole";
import { useDemo } from "./DemoProvider";
import { JournalPreview } from "./JournalPreview";
import { MessagesPanel } from "./MessagesPanel";
import { MoneyPanel } from "./MoneyPanel";
import { gsap, useGSAP } from "./motion";
import { ProviderCard } from "./ProviderCard";

type CaseTab = Exclude<FocusTab, "incident">;

const LABEL: Record<CaseTab, string> = {
  reasoning: "Reasoning",
  candidates: "Candidates",
  messages: "Messages",
  money: "Money",
  ledger: "Ledger",
};
const TABS = Object.keys(LABEL) as CaseTab[];

const caseTab = (t: FocusTab | null | undefined): CaseTab =>
  t && t !== "incident" ? t : "reasoning";

export function EvidenceTabs() {
  const { state } = useDemo();
  const panel = useRef<HTMLDivElement>(null);
  // A clicked tab holds until the walkthrough moves to another step.
  const [picked, setPicked] = useState<{ tab: CaseTab; step: number } | null>(
    null,
  );
  const demo = state?.demo;
  // While a step runs, show the evidence for the step being run.
  const auto = caseTab(
    demo?.busy
      ? (state?.steps[demo.step + 1]?.focusTab ?? demo.focusTab)
      : demo?.focusTab,
  );
  const tab = picked && picked.step === demo?.step ? picked.tab : auto;

  useGSAP(
    () => {
      if (panel.current)
        gsap.from(panel.current, { autoAlpha: 0, y: 6, duration: 0.25 });
    },
    { dependencies: [tab] },
  );

  const c = state?.case;
  if (!state || !demo || !c) return null;
  const count: Record<CaseTab, number> = {
    reasoning: 0,
    candidates: c.candidates.length,
    messages: c.messages.length,
    money: state.payments.length,
    ledger: state.journal.length,
  };
  return (
    <section id="evidence" className="evidence" aria-label="Evidence">
      <div className="tabs evidence-tabs" role="tablist">
        <span className="eyebrow">Evidence</span>
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            className={`tab ${t === tab ? "active" : ""}`}
            onClick={() => setPicked({ tab: t, step: demo.step })}
          >
            {LABEL[t]}
            {count[t] > 0 && <span>{count[t]}</span>}
          </button>
        ))}
      </div>
      <div ref={panel} role="tabpanel" className="evidence-panel">
        {tab === "reasoning" && <AgentConsole />}
        {tab === "candidates" && (
          <section className="panel">
            <div className="panel-head between">
              <h2>Candidates</h2>
              <span className="mono muted">
                {c.candidates.length} PROVIDERS
              </span>
            </div>
            {c.candidates.length ? (
              <div className="candidate-grid">
                {c.candidates.map((p) => (
                  <ProviderCard key={p.providerId} c={p} />
                ))}
              </div>
            ) : (
              <p className="panel-body muted">No search yet.</p>
            )}
          </section>
        )}
        {tab === "messages" && <MessagesPanel />}
        {tab === "money" && <MoneyPanel />}
        {tab === "ledger" && <JournalPreview />}
      </div>
    </section>
  );
}
