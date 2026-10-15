"use client";

import Link from "next/link";
import type { UiCase } from "@/engine/state";
import { money, when } from "@/lib/format";
import { CountUp } from "../CountUp";
import { useDemo } from "../DemoProvider";
import { EvidenceTabs } from "../EvidenceTabs";
import { Icon } from "../Icon";
import { StatusLadder } from "../StatusLadder";
import { SwitchScene } from "../SwitchScene";
import { Walkthrough } from "../Walkthrough";

function Tile({
  label,
  icon,
  pence,
  tone,
  note,
}: {
  label: string;
  icon: "warning" | "handshake" | "check";
  pence: number | null;
  tone: string;
  note: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        <Icon name={icon} /> {label}
      </div>
      <div
        className={`metric-value ${pence === null ? "pending" : pence ? tone : ""}`}
      >
        {pence === null ? "Not yet" : <CountUp value={pence} format={money} />}
      </div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

function Tiles({ c }: { c: UiCase }) {
  const t = c.tiles;
  return (
    <div className="metrics three">
      <Tile
        label="Booking value at risk"
        icon="warning"
        pence={t.atRiskPence}
        tone="red"
        note="Value at risk, not loss"
      />
      <Tile
        label="Provisional rescued value"
        icon="handshake"
        pence={t.provisionalPence}
        tone="amber"
        note="Agreed price, before service and settlement"
      />
      <Tile
        label="Settled value"
        icon="check"
        pence={t.settledPence}
        tone="green"
        note="Counted only when Stripe confirms every operation"
      />
    </div>
  );
}

export function CaseView() {
  const { state } = useDemo();
  if (!state) return null;
  const c = state.case;
  if (state.demo.scenario !== "provider-cancel" || !c)
    return <SwitchScene scenario="provider-cancel" />;
  const exc = c.ladder.exception;
  return (
    <>
      <p className="intro">
        <span className="mono">{c.bookingId}</span> · {c.booking.service} for{" "}
        {c.booking.customer} · {when(c.booking.startsAt)} ·{" "}
        {c.booking.providerName} · paid {money(c.paidPence)}
      </p>
      {exc && (
        <Link className="case-alert" href="/exceptions">
          <Icon name="warning" /> Exception open: {exc.nextAction}. Owner{" "}
          {exc.owner}. Open exceptions <Icon name="arrow" />
        </Link>
      )}
      <Tiles c={c} />
      <div className="case-grid">
        <div className="case-left">
          <Walkthrough />
          <StatusLadder />
        </div>
        <EvidenceTabs />
      </div>
    </>
  );
}
