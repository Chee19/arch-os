"use client";

import Link from "next/link";
import { useState } from "react";
import { money, when } from "@/lib/format";
import { firstName } from "../caseHelpers";
import { CountUp } from "../CountUp";
import { CustomerDialog } from "../CustomerDialog";
import { EvidenceTabs } from "../EvidenceTabs";
import { Icon } from "../Icon";
import { LADDER_LABEL, LADDER_TONE } from "../labels";
import { PageHeading } from "../PageHeading";
import { ProviderJobDialog } from "../ProviderJobDialog";
import { StatCard } from "../StatCard";
import { StatusLadder } from "../StatusLadder";
import { SwitchScene } from "../SwitchScene";
import { useWorkspace } from "../WorkspaceProvider";

const BADGE = { "": "neutral", amber: "peach", green: "green", red: "red" };

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

export function CaseView() {
  const { state } = useWorkspace();
  const [dialog, setDialog] = useState<"customer" | "provider" | null>(null);
  if (!state) return null;
  const c = state.case;
  if (state.demo.scenario !== "provider-cancel" || !c)
    return <SwitchScene scenario="provider-cancel" />;
  const { ladder, tiles: t } = c;
  const exc = ladder.exception;
  const first = firstName(c.booking.customer);
  const cancelled = c.booking.status !== "confirmed";
  const close = () => setDialog(null);
  const value = (pence: number | null) =>
    pence === null ? "Not yet" : <CountUp value={pence} format={money} />;
  return (
    <>
      <Link className="text-link back-link" href="/">
        <Icon name="back" /> Back to overview
      </Link>
      <PageHeading
        eyebrow={`${c.bookingId} · ${cancelled ? "PROVIDER CANCELLATION" : "BOOKING"}`}
        title={`Keep ${first}'s ${c.booking.service} on track.`}
        subtitle={
          !cancelled
            ? `${c.booking.providerName} is booked for ${when(c.booking.startsAt)}.`
            : c.cancellationText
              ? `${c.booking.providerName} cancelled: ${c.cancellationText}`
              : `${c.booking.providerName} cancelled this booking.`
        }
        actions={
          <button className="btn soft" onClick={() => setDialog("customer")}>
            Customer booking <Icon name="external" />
          </button>
        }
      />
      <div className="case-meta">
        <span className={`badge ${BADGE[LADDER_TONE[ladder.state]]}`}>
          <i />
          {LADDER_LABEL[ladder.state]}
          {ladder.chip ? `, ${ladder.chip}` : ""}
        </span>
        <span>
          <Icon name="clock" /> {when(c.booking.startsAt)}
        </span>
        <span>
          <Icon name="pin" /> {c.booking.address}
        </span>
        <span className="owner-chip">
          <span className="avatar tiny lavender">
            {initials(state.operator)}
          </span>{" "}
          {state.operator}
        </span>
      </div>
      {exc && (
        <Link className="case-warning" href="/exceptions">
          <Icon name="warning" />
          <span>
            Exception open: {exc.nextAction}. Owner {exc.owner}.
          </span>
          <Icon name="arrow" />
        </Link>
      )}
      <StatusLadder />
      <div className="stats-grid case-stats">
        <StatCard
          icon="warning"
          tone="peach"
          title="Booking value at risk"
          value={value(t.atRiskPence)}
          note="Value at risk, not lost revenue"
        />
        <StatCard
          icon="handshake"
          tone="blue"
          title="Provisional rescued value"
          value={value(t.provisionalPence)}
          note="Agreed price, before service and settlement"
        />
        <StatCard
          icon="check"
          tone="mint"
          title="Settled value"
          value={value(t.settledPence)}
          note="Counted only when Stripe confirms every operation"
        />
      </div>
      <EvidenceTabs
        onCustomer={() => setDialog("customer")}
        onProvider={() => setDialog("provider")}
      />
      <CustomerDialog open={dialog === "customer"} onClose={close} />
      <ProviderJobDialog open={dialog === "provider"} onClose={close} />
    </>
  );
}
