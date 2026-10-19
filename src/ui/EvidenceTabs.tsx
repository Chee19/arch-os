"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import type { DemoState } from "@/engine/state";
import { clock, money } from "@/lib/format";
import { AgentConsole } from "./AgentConsole";
import { chosenCandidate, firstName } from "./caseHelpers";
import { HoldCountdown } from "./HoldCountdown";
import { Icon } from "./Icon";
import { JournalPreview } from "./JournalPreview";
import { MessagesPanel } from "./MessagesPanel";
import { MoneyPanel } from "./MoneyPanel";
import { gsap, useGSAP } from "./motion";
import { nextAction } from "./nextStep";
import { ProviderCard } from "./ProviderCard";
import { Timeline } from "./Timeline";
import { useWorkspace } from "./WorkspaceProvider";

const TABS = [
  ["story", "Recovery plan"],
  ["providers", "Provider options"],
  ["messages", "Messages"],
  ["money", "Money"],
  ["reasoning", "Agent reasoning"],
  ["history", "Activity"],
] as const;
type Tab = (typeof TABS)[number][0];

type Case = NonNullable<DemoState["case"]>;

function stepCopy(state: DemoState, c: Case): [string, string] {
  const first = firstName(c.booking.customer);
  const { status } = state.demo;
  const ladder = c.ladder.state;
  if (ladder === "remedied")
    return [
      `${first} chose a refund.`,
      `The slot was released and the full ${money(c.paidPence)} refund is recorded. No provider payment.`,
    ];
  if (ladder === "settled")
    return [
      "A promise kept.",
      c.split
        ? `The service and payment obligations are complete. ${money(c.split.commission)} gross commission, before fees and costs.`
        : "The service and payment obligations are complete.",
    ];
  if (status === "done")
    return [
      "A person is taking it from here.",
      "An open exception has a named owner. Provider payment stays on hold until it is resolved.",
    ];
  if (status === "awaiting_customer")
    return [
      `The choice is ${first}'s.`,
      "The replacement details are ready for them. Nothing changes until they accept.",
    ];
  if (ladder === "fulfilled")
    return [
      "The provider reported the job complete.",
      "Release the provider payment once you are ready. Settlement is verified against Stripe.",
    ];
  if (ladder === "secured")
    return [
      "The booking is secured.",
      c.split && c.split.refund > 0
        ? `${first} accepted and a ${money(c.split.refund)} refund is recorded. Provider payment waits for delivery.`
        : `${first} accepted. Provider payment waits for delivery.`,
    ];
  if (state.demo.status === "ready" || !c.candidates.length)
    return [
      "Ready to find a replacement.",
      "ArchOS checks marketplace providers against the customer's needs and your price limits.",
    ];
  if (ladder === "offered")
    return [
      "A good alternative is ready.",
      `Review the details, then let ${first} choose whether it works for them.`,
    ];
  return [
    "Recovery is under way.",
    "ArchOS is checking providers and preparing an offer.",
  ];
}

function Story({ c, onNext }: { c: Case; onNext: () => void }) {
  const { state, busy } = useWorkspace();
  if (!state) return null;
  const first = firstName(c.booking.customer);
  const chosen = chosenCandidate(c);
  const price = chosen?.pricePence ?? c.proposal?.split.price ?? null;
  const k = c.constraints;
  const ladder = c.ladder.state;
  const next = nextAction(state);
  const [title, text] = stepCopy(state, c);
  const working = busy || state.demo.busy;
  const openException = state.exceptions.some((e) => e.status === "open");
  const nextButton = (
    <button className="btn primary" disabled={working} onClick={onNext}>
      {working ? "Working…" : next.label} <Icon name="arrow" />
    </button>
  );
  return (
    <div className="case-grid">
      <div>
        <section className="glass story-card">
          <div className="section-heading">
            <span className="eyebrow">
              <Icon name="spark" /> THE RECOVERY PLAN
            </span>
            {chosen && (
              <span className="badge green">
                <i />
                Within your rules
              </span>
            )}
          </div>
          {chosen && price !== null ? (
            <>
              <h2>A new provider. The same booking.</h2>
              <p>
                {chosen.name} {chosen.slotLabel ? `(${chosen.slotLabel}) ` : ""}
                can do it, and agreed {money(price)}
                {c.paidPence > price
                  ? `, so ${first} gets ${money(c.paidPence - price)} back`
                  : ""}
                .
              </p>
              <div className="provider-feature">
                <span className="tile-icon mint">
                  <Icon name="truck" />
                </span>
                <div>
                  <h3>{chosen.name}</h3>
                  <span className="muted">{chosen.why}</span>
                </div>
                <div className="provider-price">
                  <strong>{money(price)}</strong>
                  <small>
                    {c.paidPence > price
                      ? `${money(c.paidPence - price)} less than the ${money(c.paidPence)} paid`
                      : `Against ${money(c.paidPence)} paid`}
                  </small>
                </div>
              </div>
              {k && (
                <div className="requirements">
                  {[
                    k.twoMovers && "Two movers",
                    k.luton && "Luton van",
                    `Finish before ${clock(k.doneBy)}`,
                    `Within ${money(k.maxPricePence)}`,
                  ]
                    .filter(Boolean)
                    .map((t) => (
                      <span key={String(t)}>
                        <Icon name="check" />
                        {t}
                      </span>
                    ))}
                </div>
              )}
              <div className="hold-note">
                <Icon name="clock" />
                {chosen.state === "held" && chosen.holdExpiresAt ? (
                  <HoldCountdown expiresAt={chosen.holdExpiresAt} />
                ) : ladder === "remedied" ? (
                  "Provider hold released"
                ) : chosen.state === "secured" ? (
                  `Capacity assigned to ${first}'s booking`
                ) : (
                  "Waiting on the provider hold"
                )}
              </div>
            </>
          ) : (
            <>
              <h2>No replacement yet.</h2>
              <p>
                ArchOS checks marketplace providers against {first}&apos;s
                requirements, the{" "}
                {k ? `${money(k.maxPricePence)} price limit` : "price limit"}{" "}
                and the subsidy cap. Nothing is booked until both sides agree.
              </p>
            </>
          )}
        </section>
        {c.customerText && (
          <section className="glass padded customer-need">
            <div className="section-heading">
              <h3>What matters to {first}</h3>
              <span className="avatar lavender">
                {c.booking.customer
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </span>
            </div>
            <blockquote>&ldquo;{c.customerText}&rdquo;</blockquote>
            <p>Customer message</p>
          </section>
        )}
      </div>
      <aside>
        <section className="next-step glass">
          <span className="eyebrow">YOUR NEXT STEP</span>
          <h3>{title}</h3>
          <p>{text}</p>
          {state.demo.error && (
            <p className="inline-error" role="alert">
              {state.demo.error}
            </p>
          )}
          {next.kind === "done" && openException ? (
            <Link className="btn primary" href="/exceptions">
              {next.label} <Icon name="arrow" />
            </Link>
          ) : (
            nextButton
          )}
          <div className="safe-note">
            <Icon name="shield" /> Customer consent, capacity and funds are
            rechecked before a booking is secured.
          </div>
        </section>
        <section className="glass padded mini-facts">
          <h3>The original booking</h3>
          <dl>
            <div>
              <dt>Customer paid</dt>
              <dd>{money(c.paidPence)}</dd>
            </div>
            <div>
              <dt>Original provider</dt>
              <dd>{c.booking.providerName}</dd>
            </div>
            <div>
              <dt>Original provider paid</dt>
              <dd>{c.originalProviderPaid ? "Yes" : money(0)}</dd>
            </div>
            {c.split && (
              <div>
                <dt>Subsidy needed</dt>
                <dd>{money(c.split.subsidy)}</dd>
              </div>
            )}
          </dl>
        </section>
      </aside>
    </div>
  );
}

export function EvidenceTabs({
  onCustomer,
  onProvider,
}: {
  onCustomer: () => void;
  onProvider: () => void;
}) {
  const { state, proceed } = useWorkspace();
  const panel = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tab, setTab] = useState<Tab>("story");

  useGSAP(
    () => {
      if (panel.current)
        gsap.from(panel.current, { autoAlpha: 0, y: 6, duration: 0.25 });
    },
    { dependencies: [tab] },
  );

  const c = state?.case;
  if (!state || !c) return null;
  const count: Partial<Record<Tab, number>> = {
    providers: c.candidates.length,
    messages: c.messages.length,
    money: state.payments.length,
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (i + TABS.length - 1) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to][0]);
    tabs.current[to]?.focus();
  };

  const onNext = () => {
    const next = nextAction(state);
    if (next.kind === "advance")
      void proceed({ action: "advance", step: state.demo.step });
    else if (next.kind === "customer") onCustomer();
    else if (next.kind === "provider") onProvider();
    else setTab("money");
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Booking details">
        {TABS.map(([id, label], i) => (
          <button
            key={id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`tab-${id}`}
            role="tab"
            aria-selected={id === tab}
            aria-controls="case-panel"
            tabIndex={id === tab ? 0 : -1}
            className={id === tab ? "active" : ""}
            onClick={() => setTab(id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {label}
            {!!count[id] && <span className="count">{count[id]}</span>}
          </button>
        ))}
      </div>
      <div
        ref={panel}
        id="case-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "story" && <Story c={c} onNext={onNext} />}
        {tab === "providers" && (
          <section className="glass padded">
            <div className="section-heading">
              <div>
                <h2>The right fit comes first.</h2>
                <p>
                  Timing, capability and cost are checked for each provider.
                </p>
              </div>
            </div>
            {c.candidates.length ? (
              <div className="provider-grid">
                {c.candidates.map((p) => (
                  <ProviderCard key={p.providerId} c={p} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Icon name="search" />
                <h2>No search yet</h2>
                <p>Providers appear here once the recovery starts.</p>
              </div>
            )}
            <div className="safe-note">
              <Icon name="shield" /> A matching profile is not a secured
              booking. Provider commitment and customer acceptance are required.
            </div>
          </section>
        )}
        {tab === "messages" && <MessagesPanel />}
        {tab === "money" && (
          <>
            <MoneyPanel />
            <JournalPreview />
          </>
        )}
        {tab === "reasoning" && <AgentConsole />}
        {tab === "history" && (
          <section className="glass padded">
            <Timeline
              events={state.steps
                .slice(0, state.demo.step + 1)
                .reverse()
                .map((s) => ({
                  key: s.key,
                  title: s.title,
                  detail: s.result,
                  time: s.actor,
                }))}
            />
          </section>
        )}
      </div>
    </>
  );
}
