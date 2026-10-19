"use client";

import type { UiPaymentOp } from "@/engine/state";
import { money } from "@/lib/format";
import { latestOf, observedText, sumCheck } from "./caseHelpers";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";
import { OP_KIND_LABEL, OP_STATE_LABEL, OP_STATE_TONE } from "./labels";

const BADGE = {
  "": "neutral",
  amber: "peach",
  green: "green",
  red: "red",
} as const;

function OpRow({ op }: { op: UiPaymentOp }) {
  const { state, busy, act, notify } = useWorkspace();
  const off = busy || Boolean(state?.demo.busy);
  const seen = observedText(op.observed);
  const copy = (id: string) =>
    void navigator.clipboard.writeText(id).then(
      () => notify(`Copied ${id}`),
      () => notify("Copy failed. Select the ID instead."),
    );
  return (
    <tr>
      <td>
        {OP_KIND_LABEL[op.kind]}
        {op.attempt > 1 && <span className="minor">Attempt {op.attempt}</span>}
      </td>
      <td className="mono">{money(op.amountPence)}</td>
      <td>
        <span className={`badge ${BADGE[OP_STATE_TONE[op.state]]}`}>
          <i />
          {OP_STATE_LABEL[op.state]}
        </span>
        {seen && <span className="minor">{seen}</span>}
        {op.error && <span className="minor red">{op.error}</span>}
      </td>
      <td>
        {op.stripeId ? (
          <span className="op-id">
            <code>{op.stripeId}</code>
            <button
              className="text-btn"
              aria-label={`Copy ${op.stripeId}`}
              onClick={() => copy(op.stripeId ?? "")}
            >
              Copy
            </button>
            {op.dashboardUrl && (
              <a
                className="text-btn"
                href={op.dashboardUrl}
                target="_blank"
                rel="noreferrer"
              >
                Dashboard <Icon name="external" />
              </a>
            )}
          </span>
        ) : (
          <span className="muted">No Stripe object yet</span>
        )}

        <div className="row-actions">
          {op.state !== "intended" && (
            <button
              className="btn ghost small"
              disabled={off}
              onClick={() => void act({ action: "recheck", opId: op.opId })}
            >
              Recheck
            </button>
          )}
          {op.state === "succeeded" && (
            <button
              className="btn ghost small"
              disabled={off}
              onClick={() => void act({ action: "replay", opId: op.opId })}
            >
              Replay
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function MoneyPanel() {
  const { state } = useWorkspace();
  const c = state?.case;
  if (!state || !c) return null;
  const split = c.split ?? c.proposal?.split ?? null;
  const check = c.split ? sumCheck(c.split) : null;
  const fee = latestOf(state.payments, "charge")?.observed?.feePence ?? null;
  const remedied = c.ladder.state === "remedied";
  const provider = remedied || !split ? 0 : split.transfer;
  const commission = remedied || !split ? 0 : split.commission;
  const refund = remedied ? c.paidPence : (split?.refund ?? 0);
  const hasFlow = remedied || split !== null;
  return (
    <section className="glass padded money-panel">
      <div className="section-heading">
        <div>
          <h2>Every pound, accounted for.</h2>
          <p>
            {remedied
              ? `The full original payment returns to ${c.booking.customer}.`
              : `How the original ${money(c.paidPence)} is allocated if the replacement completes.`}
          </p>
        </div>
        <span className="badge purple">
          <i />
          Booking {c.bookingId}
        </span>
      </div>
      {!state.payments.length ? (
        <div className="empty-state">
          <Icon name="wallet" />
          <h3>No money has moved yet</h3>
          <p>
            Payments and refunds appear here once the customer&apos;s payment is
            recorded.
          </p>
        </div>
      ) : (
        <>
          <div className="money-flow">
            <div>
              <span className="money-icon">
                <Icon name="wallet" />
              </span>
              <small>Original customer payment</small>
              <strong>{money(c.paidPence)}</strong>
            </div>
            <Icon name="arrow" />
            {hasFlow ? (
              <div className="allocation">
                <div className="allocation-bar" aria-hidden="true">
                  <span className="provider-part" style={{ flex: provider }} />
                  <span
                    className="commission-part"
                    style={{ flex: commission }}
                  />
                  <span className="refund-part" style={{ flex: refund }} />
                </div>
                <div className="allocation-labels">
                  <span>
                    <i className="provider-part" />
                    Provider <b>{money(provider)}</b>
                  </span>
                  <span>
                    <i className="commission-part" />
                    Gross commission <b>{money(commission)}</b>
                  </span>
                  <span>
                    <i className="refund-part" />
                    Customer refund <b>{money(refund)}</b>
                  </span>
                </div>
              </div>
            ) : (
              <p className="muted allocation">
                The split appears once a price is agreed.
              </p>
            )}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Movement</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {state.payments.map((op) => (
                  <OpRow key={op.opId} op={op} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {split && check && (
        <>
          <dl className="facts money-facts">
            <div>
              <dt>Gross commission</dt>
              <dd>{money(split.commission)}</dd>
            </div>
            <div>
              <dt>Stripe fee</dt>
              <dd>{fee === null ? "fee pending" : money(fee)}</dd>
            </div>
            <div>
              <dt>Contribution</dt>
              <dd>
                {fee === null ? "pending fee" : money(split.commission - fee)}
              </dd>
            </div>
            <div>
              <dt>Subsidy</dt>
              <dd>{money(split.subsidy)}</dd>
            </div>
            <div>
              <dt>Original provider paid</dt>
              <dd>{c.originalProviderPaid ? "Yes" : "No"}</dd>
            </div>
          </dl>
          <div className="sum-check">
            <span>{check.text}</span>
            <span className={`badge ${check.ok ? "green" : "red"}`}>
              <i />
              {check.ok ? "Adds up" : "Does not add up"}
            </span>
          </div>
        </>
      )}
      <div className="callout">
        <Icon name="help" />
        <p>
          {split && !remedied ? money(split.commission) : "Commission"} is{" "}
          <strong>gross commission, not profit</strong>. Payment fees, subsidies
          and recovery costs must be deducted before calculating contribution.
        </p>
      </div>
    </section>
  );
}
