"use client";

import type { UiPaymentOp } from "@/engine/state";
import { money } from "@/lib/format";
import { latestOf, observedText, sumCheck } from "./caseHelpers";
import { useDemo } from "./DemoProvider";
import { Icon } from "./Icon";
import { OP_KIND_LABEL, OP_STATE_LABEL, OP_STATE_TONE } from "./labels";

function OpRow({ op }: { op: UiPaymentOp }) {
  const { state, busy, act, notify } = useDemo();
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
      </td>
      <td>
        <span className={`badge ${OP_STATE_TONE[op.state]}`}>
          <i className="dot" />
          {OP_STATE_LABEL[op.state]}
        </span>
        {seen && <span className="minor">{seen}</span>}
        {op.error && <span className="minor red">{op.error}</span>}
      </td>
      <td>
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
  const { state } = useDemo();
  const c = state?.case;
  if (!state || !c) return null;
  const split = c.split;
  const check = split ? sumCheck(split) : null;
  const fee = latestOf(state.payments, "charge")?.observed?.feePence ?? null;
  return (
    <section className="panel">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Amount</th>
              <th>Stripe object</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.payments.map((op) => (
              <OpRow key={op.opId} op={op} />
            ))}
            {!state.payments.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No money has moved yet. The first step creates the £300
                  charge.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {split && check ? (
        <>
          <dl className="facts panel-body">
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
              <i className="dot" />
              {check.ok ? "Adds up" : "Does not add up"}
            </span>
          </div>
        </>
      ) : (
        <p className="panel-body muted">
          The split appears once a price is agreed. Original provider paid:{" "}
          {c.originalProviderPaid ? "Yes" : "No"}
        </p>
      )}
    </section>
  );
}
