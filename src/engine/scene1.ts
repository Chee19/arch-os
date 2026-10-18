import type { ClientSession, Db } from "mongodb";
import type { Extractor } from "@/agent/extract";
import { money, when } from "@/lib/format";
import { splitFor } from "@/money/math";
import {
  chargeFacts,
  chargeRef,
  chargeRequest,
  insertIntent,
  opsFor,
  recheckOp,
  refundRequest,
  retryOp,
  runOp,
  transferRequest,
  type OpDeps,
  type OpSpec,
} from "@/money/ops";
import { SCENARIOS } from "@/scenarios";
import {
  CANCELLATION_TEXT,
  CUSTOMER_TEXT,
  rejectedFrom,
  scriptedConstraintsFor,
} from "@/scenarios/provider-cancel";
import {
  isPolicyReason,
  type Change,
  type PolicyDeny,
  type Rec,
  type StepKey,
} from "@/scenarios/types";
import {
  bookingOf,
  CASE_SYSTEM,
  caseOf,
  MARKET,
  providersOf,
  slotsOf,
  withMessage,
  type CaseData,
  type Consent,
  type Offer,
} from "./case";
import type { DemoDoc, DemoStatus, OpKind, PaymentOp } from "./docs";
import { ConfigError, Conflict, StepError } from "./errors";
import { closeException, openException, openExceptions } from "./exceptions";
import { callTool, runScript } from "./gateway";
import { ladderOf, latestOps } from "./ladder";
import { holdValid, revalidate } from "./policy";
import { find } from "./records";
import { reassignChanges } from "./rescue";
import {
  audit,
  col,
  getDemo,
  loadRecords,
  OPERATOR,
  persist,
  tx,
} from "./store";

export type StepEnd = { status?: DemoStatus; outcome?: string };
export const CASE_ID = "CASE-1042";

const ACCOUNTS = "Priya Shah";
const ARCHOS = "ArchOS";
const MARKETPLACE = "Larkspur Home Services";
const NEXT_ACTION: Record<OpKind, string> = {
  charge: "Retry the charge",
  refund: "Retry refund",
  transfer: "Retry provider payment",
  full_refund: "Retry customer refund",
};

type Extracted = Awaited<ReturnType<Extractor>>;
type NewException = Parameters<typeof openException>[1];
type RequestBase = Parameters<typeof chargeRequest>[0];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const inTwoHours = () => new Date(Date.now() + 2 * 3_600_000);

function ctxOf(recs: Rec[]) {
  const c = caseOf(recs, CASE_ID);
  return { c, booking: bookingOf(recs, c.data.bookingId) };
}
const caseChange = (data: CaseData): Change => ({
  system: CASE_SYSTEM,
  recordId: CASE_ID,
  data,
});
const recChange = (r: Rec, data: Rec["data"]): Change => ({
  system: r.system,
  recordId: r.recordId,
  data,
});
const nameOf = (recs: Rec[], providerId: string) =>
  providersOf(recs).find((p) => p.data.providerId === providerId)?.data.name ??
  providerId;
const secured = (c: CaseData) => c.offers.some((o) => o.state === "secured");

function offerIn(
  c: CaseData,
  state: Offer["state"],
): Offer & { pricePence: number } {
  const o = c.offers.find((x) => x.state === state);
  if (!o || o.pricePence === null)
    throw new StepError(`${CASE_ID} has no ${state} offer.`);
  return { ...o, pricePence: o.pricePence };
}

// What the customer can still get back: paid minus every refund that has not failed.
function refundable(paid: number, ops: PaymentOp[]): number {
  return (
    paid -
    ops
      .filter(
        (o) =>
          (o.kind === "refund" || o.kind === "full_refund") &&
          o.state !== "failed",
      )
      .reduce((sum, o) => sum + o.amountPence, 0)
  );
}

function specOf(
  demo: DemoDoc,
  bookingId: string,
  kind: OpKind,
  amountPence: number,
  build: (b: RequestBase) => Record<string, unknown>,
): OpSpec {
  return {
    runId: demo.runId,
    caseId: CASE_ID,
    kind,
    attempt: 1,
    amountPence,
    request: build({ runId: demo.runId, bookingId, amountPence }),
  };
}

function refundSpec(
  demo: DemoDoc,
  bookingId: string,
  kind: "refund" | "full_refund",
  amountPence: number,
  ops: PaymentOp[],
): OpSpec {
  const paymentIntent = latestOps(ops).charge?.stripeId;
  if (!paymentIntent)
    throw new StepError("There is no verified charge to refund.");
  return specOf(demo, bookingId, kind, amountPence, (b) =>
    refundRequest({ ...b, paymentIntent }),
  );
}

function secureException(
  demo: DemoDoc,
  c: CaseData,
  reason: string,
): NewException {
  return {
    runId: demo.runId,
    caseId: CASE_ID,
    target: null,
    owner: OPERATOR,
    reason,
    nextAction: `Re-offer or refund the full ${money(c.paidPence)}`,
    action: "refund",
    dueAt: new Date(c.rescueDeadline),
    opId: null,
    reasonKey: "secure",
  };
}

function settleException(demo: DemoDoc, reason: string): NewException {
  return {
    runId: demo.runId,
    caseId: CASE_ID,
    target: null,
    owner: OPERATOR,
    reason,
    nextAction: "Check the booking and retry the provider payment",
    action: "retry",
    dueAt: inTwoHours(),
    opId: null,
    reasonKey: "settle",
  };
}

function opException(op: PaymentOp): NewException {
  return {
    runId: op.runId,
    caseId: CASE_ID,
    target: null,
    owner: ACCOUNTS,
    reason: op.error ?? `Stripe ${op.kind} failed.`,
    nextAction: NEXT_ACTION[op.kind],
    action: "retry",
    dueAt: inTwoHours(),
    opId: op.opId,
    reasonKey: op.kind,
  };
}

// Pending or reconciling ops only get a chip; a definitive failure gets an owner (spec 3.5).
async function owned(d: Db, op: PaymentOp): Promise<PaymentOp> {
  if (op.state === "failed") await openException(d, opException(op));
  return op;
}

async function execute(
  d: Db,
  opId: string,
  deps?: OpDeps,
  retry = false,
): Promise<PaymentOp> {
  return owned(
    d,
    retry ? await retryOp(d, opId, deps) : await runOp(d, opId, deps),
  );
}

// verifyAndSave already closes the op's exceptions on success; a failure read here needs an owner too.
export async function recheck(
  d: Db,
  opId: string,
  deps?: OpDeps,
): Promise<PaymentOp> {
  const op = await col.payments(d).findOne({ opId });
  // Maybe never reached Stripe: runOp reconciles, then resends with the same key (spec 6.3), so it cannot duplicate.
  const unsent = op?.state === "requested" && op.stripeId === null;
  return owned(
    d,
    unsent ? await runOp(d, opId, deps) : await recheckOp(d, opId, deps),
  );
}

// Checking runId inside the transaction keeps a reset run's late writes out of the new run.
async function sameRun(
  d: Db,
  demo: DemoDoc,
  session: ClientSession,
): Promise<void> {
  const cur = await col.demo(d).findOne({ _id: "demo" }, { session });
  if (cur?.runId !== demo.runId)
    throw new StepError("This run was reset. Nothing was written.");
}

async function write(
  d: Db,
  demo: DemoDoc,
  fn: (recs: Rec[], session: ClientSession) => Promise<Change[]> | Change[],
): Promise<void> {
  await tx(async (session) => {
    await sameRun(d, demo, session);
    const recs = await loadRecords(d, demo.scenario, session);
    await persist(d, demo.scenario, recs, await fn(recs, session), session);
  });
}

async function say(
  d: Db,
  runId: string,
  text: string,
  call: { id: string; tool: string; args: unknown },
): Promise<void> {
  const last = await col.messages(d).findOne({ runId }, { sort: { seq: -1 } });
  await col.messages(d).insertOne({
    runId,
    seq: (last?.seq ?? 0) + 1,
    role: "assistant",
    text,
    reasoning: null,
    toolCalls: [
      { id: call.id, name: call.tool, args: JSON.stringify(call.args) },
    ],
    toolCallId: null,
    usage: null,
    at: new Date(),
  });
}

// The gateway aborts a denied call's transaction, so the engine records the rejection itself.
async function recordRejection(
  d: Db,
  demo: DemoDoc,
  args: unknown,
  deny: PolicyDeny,
): Promise<void> {
  const { providerId, pricePence } = args as {
    providerId?: string;
    pricePence?: number;
  };
  if (!providerId || pricePence === undefined) return;
  const now = new Date();
  await write(d, demo, (recs) => {
    const c = caseOf(recs, CASE_ID).data;
    if (
      c.rejected.some(
        (x) => x.providerId === providerId && x.pricePence === pricePence,
      )
    )
      return [];
    return [
      caseChange({
        ...c,
        rejected: [
          ...c.rejected,
          rejectedFrom(deny, providerId, pricePence, now),
        ],
      }),
    ];
  });
}

async function fullRefund(
  d: Db,
  demo: DemoDoc,
  deps?: OpDeps,
): Promise<PaymentOp | null> {
  const ops = await opsFor(d, demo.runId, CASE_ID);
  const prior = latestOps(ops).full_refund;
  if (prior) return execute(d, prior.opId, deps, prior.state === "failed");
  const { c } = ctxOf(await loadRecords(d, demo.scenario));
  // A refund made in the Stripe dashboard is not in ops, and Stripe rejects an over-refund forever.
  const charge = await chargeFacts(d, demo.runId, CASE_ID, deps);
  const amount = Math.min(
    refundable(c.data.paidPence, ops),
    charge.amount - charge.amountRefunded,
  );
  if (amount <= 0) return null;
  const op = await insertIntent(
    d,
    refundSpec(demo, c.data.bookingId, "full_refund", amount, ops),
  );
  return execute(d, op.opId, deps);
}

async function ladderState(d: Db, demo: DemoDoc) {
  const { c, booking } = ctxOf(await loadRecords(d, demo.scenario));
  return ladderOf({
    caseData: c.data,
    booking: booking.data,
    ops: await opsFor(d, demo.runId, CASE_ID),
    exceptions: await openExceptions(d, demo.runId),
  }).state;
}

export async function runCharge(
  d: Db,
  demo: DemoDoc,
  deps?: OpDeps,
): Promise<StepEnd> {
  const { c } = ctxOf(await loadRecords(d, demo.scenario));
  const prior = latestOps(await opsFor(d, demo.runId, CASE_ID)).charge;
  const opId =
    prior?.opId ??
    (
      await insertIntent(
        d,
        specOf(
          demo,
          c.data.bookingId,
          "charge",
          c.data.paidPence,
          chargeRequest,
        ),
      )
    ).opId;
  // Stripe replays a failed key's cached error, so a failed charge needs retryOp's new attempt and key.
  const op =
    prior?.state === "failed"
      ? await retryOp(d, opId, deps)
      : await runOp(d, opId, deps);
  if (op.state === "failed")
    throw new StepError(
      `Stripe rejected the charge: ${op.error ?? "no reason given"}. Press Retry.`,
    );
  if (op.state !== "succeeded")
    throw new StepError(
      `The charge is ${op.state} at Stripe. Press Retry to check again.`,
    );
  return {};
}

export async function runFailure(d: Db, demo: DemoDoc): Promise<StepEnd> {
  const now = new Date();
  await write(d, demo, async (recs, session) => {
    const { c, booking } = ctxOf(recs);
    if (c.data.status !== "booked") return [];
    const provider = nameOf(recs, booking.data.providerId);
    const slot = booking.data.slotId
      ? find(recs, MARKET, booking.data.slotId)
      : undefined;
    let next: CaseData = {
      ...c.data,
      status: "open",
      cancellationText: CANCELLATION_TEXT,
      customerText: CUSTOMER_TEXT,
    };
    next = withMessage(
      next,
      {
        from: "provider",
        to: null,
        party: provider,
        text: CANCELLATION_TEXT,
        kind: "text",
      },
      now,
    );
    next = withMessage(
      next,
      {
        from: "customer",
        to: "agent",
        party: booking.data.customer,
        text: CUSTOMER_TEXT,
        kind: "text",
      },
      now,
    );
    next = withMessage(
      next,
      {
        from: "system",
        to: null,
        party: MARKETPLACE,
        text: `${provider} cancelled ${booking.data.bookingId}. ${CASE_ID} is open.`,
        kind: "text",
      },
      now,
    );
    await audit(
      d,
      {
        runId: demo.runId,
        actor: provider,
        action: "booking.provider_cancelled",
        detail: `${provider} cancelled ${booking.data.bookingId}. ${money(c.data.paidPence)} booking value at risk.`,
        decision: "Cancelled",
        operationId: null,
      },
      session,
    );
    return [
      recChange(booking, {
        ...booking.data,
        status: "provider_cancelled",
        slotId: null,
      }),
      ...(slot
        ? [recChange(slot, { ...slot.data, status: "free", bookingId: null })]
        : []),
      caseChange(next),
    ];
  });
  return {};
}

export async function runUnderstand(
  d: Db,
  demo: DemoDoc,
  extract?: Extractor,
): Promise<StepEnd> {
  const { c, booking } = ctxOf(await loadRecords(d, demo.scenario));
  // Policy reads only the stored fields, so any extraction failure falls back to the scripted values.
  const fallback = (reason: string): Extracted => ({
    constraints: scriptedConstraintsFor(c.data, booking.data),
    extraction: { source: "scripted", model: null, reason, raw: null },
  });
  let got: Extracted;
  if (!extract) got = fallback("Live extraction is off.");
  else {
    try {
      got = await extract(c.data, booking.data);
    } catch (e) {
      got = fallback(errText(e));
    }
  }
  const { constraints: k, extraction } = got;
  const label =
    extraction.source === "live"
      ? `Live, ${extraction.model}`
      : `Scripted fallback: ${extraction.reason}`;
  const operationId = `${demo.runId}:agent:understand:0`;
  const args = { caseId: CASE_ID, ...k };
  await say(
    d,
    demo.runId,
    `Read both messages (${label}). Done by ${when(k.doneBy)}, ${k.twoMovers ? "two movers" : "one mover is fine"}, ${k.luton ? "Luton van" : "any van size"}, at most ${money(k.maxPricePence)} in total.`,
    { id: operationId, tool: "recordConstraints", args },
  );
  const r = await callTool(d, {
    runId: demo.runId,
    tool: "recordConstraints",
    args,
    operationId,
  });
  if (!r.ok) throw new StepError(r.message);
  await write(d, demo, (recs) => [
    caseChange({ ...caseOf(recs, CASE_ID).data, extraction }),
  ]);
  return {};
}

export async function runScripted(
  d: Db,
  demo: DemoDoc,
  key: StepKey,
): Promise<StepEnd> {
  const calls = SCENARIOS[demo.scenario].script.filter((c) => c.step === key);
  // runScript returns one result per script entry of this step, in order.
  for (const [i, r] of (await runScript(d, demo, key)).entries()) {
    if (r.ok) continue;
    // Only a policy deny is an expected scripted outcome; anything else is a fault the presenter must see.
    if (!isPolicyReason(r.reason)) throw new StepError(r.message);
    await recordRejection(d, demo, calls[i].args, {
      reason: r.reason,
      message: r.message,
    });
  }
  return {};
}

export async function runConsentWait(d: Db, demo: DemoDoc): Promise<StepEnd> {
  offerIn(ctxOf(await loadRecords(d, demo.scenario)).c.data, "proposed");
  return { status: "awaiting_customer" };
}

export async function respond(
  d: Db,
  decision: "accept" | "decline",
  deps?: OpDeps,
): Promise<void> {
  // The CAS makes a double click or a second tab run the response once.
  const demo = await col
    .demo(d)
    .findOneAndUpdate(
      { _id: "demo", status: "awaiting_customer", busyAt: null },
      { $set: { status: "running", busyAt: new Date(), error: null } },
      { returnDocument: "after" },
    );
  if (!demo) {
    const cur = await getDemo(d);
    if (cur.steps[cur.step] === "consent")
      throw new Conflict("The customer already responded.");
    throw new StepError("Nothing is waiting for the customer.");
  }
  const mine = { _id: "demo" as const, runId: demo.runId };
  try {
    const end =
      decision === "accept"
        ? await accept(d, demo)
        : await decline(d, demo, deps);
    await col.demo(d).updateOne(mine, { $set: { busyAt: null, ...end } });
  } catch (e) {
    // Hand the decision back so the presenter can press Accept or Decline again.
    await col.demo(d).updateOne(mine, {
      $set: { busyAt: null, status: "awaiting_customer", error: errText(e) },
    });
    throw e;
  }
}

async function accept(d: Db, demo: DemoDoc): Promise<StepEnd> {
  const now = new Date();
  const { c, booking } = ctxOf(await loadRecords(d, demo.scenario));
  if (c.data.consent) return {};
  const offer = offerIn(c.data, "proposed");
  const deny = holdValid(offer, now);
  if (deny) {
    // Consent to an expired hold is worthless: no money moves and Sam owns the case.
    await openException(d, secureException(demo, c.data, deny.reason));
    await audit(d, {
      runId: demo.runId,
      actor: ARCHOS,
      action: "customer.accept",
      detail: deny.message,
      decision: "Refused: hold expired",
      operationId: null,
    });
    return {};
  }
  const consent: Consent = {
    offerId: offer.offerId,
    pricePence: offer.pricePence,
    decision: "accept",
    at: now.toISOString(),
    expiresAt: offer.holdExpiresAt ?? now.toISOString(),
  };
  await write(d, demo, async (recs, session) => {
    await audit(
      d,
      {
        runId: demo.runId,
        actor: booking.data.customer,
        action: "customer.accept",
        detail: `Accepted ${nameOf(recs, offer.providerId)} at ${money(offer.pricePence)}. Consent valid until ${when(consent.expiresAt)}.`,
        decision: "Consent recorded",
        operationId: null,
      },
      session,
    );
    const fresh = caseOf(recs, CASE_ID).data;
    return [
      caseChange(
        withMessage(
          { ...fresh, consent },
          {
            from: "customer",
            to: "agent",
            party: booking.data.customer,
            text: "Yes, go ahead",
            kind: "text",
          },
          now,
        ),
      ),
    ];
  });
  return {};
}

async function decline(d: Db, demo: DemoDoc, deps?: OpDeps): Promise<StepEnd> {
  const now = new Date();
  await write(d, demo, async (recs, session) => {
    const { c, booking } = ctxOf(recs);
    if (c.data.status === "declined") return [];
    const offer = c.data.offers.find((o) => o.state === "proposed");
    const slot = offer ? find(recs, MARKET, offer.slotId) : undefined;
    let next: CaseData = {
      ...c.data,
      status: "declined",
      offers: c.data.offers.map((o) =>
        o.offerId === offer?.offerId ? { ...o, state: "released" as const } : o,
      ),
      consent: offer
        ? {
            offerId: offer.offerId,
            pricePence: offer.pricePence ?? 0,
            decision: "decline",
            at: now.toISOString(),
            expiresAt: offer.holdExpiresAt ?? now.toISOString(),
          }
        : c.data.consent,
    };
    next = withMessage(
      next,
      {
        from: "customer",
        to: "agent",
        party: booking.data.customer,
        text: "No thanks, please refund me.",
        kind: "text",
      },
      now,
    );
    if (offer)
      next = withMessage(
        next,
        {
          from: "agent",
          to: "provider",
          party: nameOf(recs, offer.providerId),
          text: `Hold released: ${booking.data.customer} declined the booking.`,
          kind: "text",
        },
        now,
      );
    await audit(
      d,
      {
        runId: demo.runId,
        actor: booking.data.customer,
        action: "customer.decline",
        detail:
          "Declined the replacement. Hold released and a full refund started.",
        decision: "Declined",
        operationId: null,
      },
      session,
    );
    return [
      caseChange(next),
      ...(slot
        ? [recChange(slot, { ...slot.data, status: "free", bookingId: null })]
        : []),
    ];
  });
  // The brief forbids delaying a rightful refund, so the remedy runs now rather than as an exception.
  await fullRefund(d, demo, deps);
  // Remedied only once Stripe confirms the refund (spec 3.7), so the outcome is derived, not assumed.
  return { status: "done", outcome: await ladderState(d, demo) };
}

export async function secureCase(
  d: Db,
  demo: DemoDoc,
  deps?: OpDeps,
): Promise<StepEnd> {
  const before = ctxOf(await loadRecords(d, demo.scenario)).c.data;
  // The refund intent commits with the reassignment, so a re-run only runs and verifies that refund.
  if (!secured(before)) {
    const now = new Date();
    const ops = await opsFor(d, demo.runId, CASE_ID);
    const charge = await chargeFacts(d, demo.runId, CASE_ID, deps);
    const deny = await tx(async (session): Promise<PolicyDeny | null> => {
      await sameRun(d, demo, session);
      const recs = await loadRecords(d, demo.scenario, session);
      const { c, booking } = ctxOf(recs);
      // A concurrent secure won the write conflict; inserting its refund again would abort on E11000.
      if (secured(c.data)) return null;
      const offer = offerIn(c.data, "proposed");
      const split = splitFor(c.data.paidPence, offer.pricePence);
      const denied = revalidate("secure", {
        now,
        caseData: c.data,
        offer,
        slot: find(recs, MARKET, offer.slotId),
        booking: booking.data,
        charge,
        ops,
        amount: split.refund,
      });
      if (denied) return denied;
      const next: CaseData = {
        ...c.data,
        replacementProviderId: offer.providerId,
        offers: c.data.offers.map((o) =>
          o.offerId === offer.offerId ? { ...o, state: "secured" as const } : o,
        ),
      };
      await persist(
        d,
        demo.scenario,
        recs,
        [
          ...reassignChanges(recs, {
            bookingId: booking.data.bookingId,
            slotId: offer.slotId,
            providerId: offer.providerId,
          }),
          caseChange(next),
        ],
        session,
      );
      // Same transaction as the reassignment, so a secured booking never lacks its refund intent.
      if (split.refund > 0)
        await insertIntent(
          d,
          refundSpec(demo, booking.data.bookingId, "refund", split.refund, ops),
          session,
        );
      await audit(
        d,
        {
          runId: demo.runId,
          actor: ARCHOS,
          action: "case.secured",
          detail: `${booking.data.bookingId} reassigned to ${nameOf(recs, offer.providerId)} at ${money(split.price)}. Refund ${money(split.refund)}.`,
          decision: "Secured",
          operationId: null,
        },
        session,
      );
      return null;
    });
    if (deny) {
      await openException(d, secureException(demo, before, deny.reason));
      return {};
    }
  }
  const pending = latestOps(await opsFor(d, demo.runId, CASE_ID)).refund;
  const refund = pending ? await execute(d, pending.opId, deps) : null;
  const recs = await loadRecords(d, demo.scenario);
  const offer = offerIn(ctxOf(recs).c.data, "secured");
  const slot = slotsOf(recs).find((s) => s.recordId === offer.slotId);
  const refunded = !refund
    ? ""
    : refund.state === "succeeded"
      ? ` We've refunded ${money(refund.amountPence)} (Stripe ${refund.stripeId}).`
      : refund.state === "failed"
        ? ` Your ${money(refund.amountPence)} refund did not go through. Our team will retry it.`
        : ` Your ${money(refund.amountPence)} refund is being processed.`;
  await callTool(d, {
    runId: demo.runId,
    tool: "sendMessage",
    args: {
      caseId: CASE_ID,
      to: "customer",
      text: `You're booked with ${nameOf(recs, offer.providerId)}${slot ? ` on ${when(slot.data.startsAt)}` : ""}.${refunded}`,
    },
    operationId: `${demo.runId}:engine:secure:0`,
  });
  return {};
}

export async function fulfilCase(d: Db, demo: DemoDoc): Promise<StepEnd> {
  const at = new Date();
  await write(d, demo, async (recs, session) => {
    const { c, booking } = ctxOf(recs);
    if (c.data.fulfilment) return [];
    if (!secured(c.data))
      throw new StepError(
        "Nothing is secured, so there is nothing to fulfil. Check the open exception.",
      );
    await audit(
      d,
      {
        runId: demo.runId,
        actor: MARKETPLACE,
        action: "booking.fulfilled",
        detail: `${nameOf(recs, booking.data.providerId)} completed ${booking.data.bookingId}.`,
        decision: "Fulfilled",
        operationId: null,
      },
      session,
    );
    return [
      caseChange({
        ...c.data,
        fulfilment: { at: at.toISOString(), simulated: true },
      }),
    ];
  });
  return {};
}

// Every new transfer attempt moves money, so the first send and a Retry pass the same checks.
async function settleCheck(
  d: Db,
  demo: DemoDoc,
  ops: PaymentOp[],
  deps?: OpDeps,
) {
  const recs = await loadRecords(d, demo.scenario);
  const { c, booking } = ctxOf(recs);
  const offer = offerIn(c.data, "secured");
  const split = splitFor(c.data.paidPence, offer.pricePence);
  const deny = revalidate("settle", {
    now: new Date(),
    caseData: c.data,
    offer,
    slot: find(recs, MARKET, offer.slotId),
    booking: booking.data,
    charge: await chargeFacts(d, demo.runId, CASE_ID, deps),
    ops,
    amount: split.transfer,
  });
  if (deny) await openException(d, settleException(demo, deny.reason));
  return { deny, recs, booking, offer, split };
}

export async function settleCase(
  d: Db,
  demo: DemoDoc,
  deps?: OpDeps,
): Promise<StepEnd> {
  const ops = await opsFor(d, demo.runId, CASE_ID);
  let transfer = latestOps(ops).transfer;
  // Revalidate only before the first intent; an existing transfer op would count against its own funding.
  if (!transfer) {
    const { deny, recs, booking, offer, split } = await settleCheck(
      d,
      demo,
      ops,
      deps,
    );
    if (deny) return { status: "running" };
    const provider = providersOf(recs).find(
      (p) => p.data.providerId === offer.providerId,
    );
    if (!provider?.data.connected)
      throw new StepError(
        `${nameOf(recs, offer.providerId)} has no Stripe connected account.`,
      );
    const destination = process.env.STRIPE_ACCT_CLEARHOME;
    if (!destination)
      throw new ConfigError("STRIPE_ACCT_CLEARHOME is not set.");
    const { chargeId } = await chargeRef(d, demo.runId, CASE_ID, deps);
    transfer = await insertIntent(
      d,
      specOf(demo, booking.data.bookingId, "transfer", split.transfer, (b) =>
        transferRequest({ ...b, destination, chargeId }),
      ),
    );
  }
  await execute(d, transfer.opId, deps);
  return { status: "running" };
}

export async function runLedger(d: Db, demo: DemoDoc): Promise<StepEnd> {
  // The journal is derived in state; the outcome only claims what the evidence supports.
  return { status: "done", outcome: await ladderState(d, demo) };
}

export async function exceptionAction(
  d: Db,
  exceptionId: string,
  act: "refund" | "retry" | "close",
  note: string | undefined,
  deps?: OpDeps,
): Promise<void> {
  const demo = await getDemo(d);
  const e = await col
    .exceptions(d)
    .findOne({ exceptionId, runId: demo.runId, status: "open" });
  if (!e) throw new StepError("That exception is not open in this run.");
  if (act === "close") {
    if (!note?.trim())
      throw new StepError("Add a note to close the exception.");
    return closeException(d, exceptionId, note.trim(), OPERATOR);
  }
  if (e.action !== act)
    throw new StepError(
      `This exception offers ${e.action ?? "no action"}, not ${act}.`,
    );
  if (act === "refund") {
    const op = await fullRefund(d, demo, deps);
    if (!op) throw new StepError("Nothing is left to refund.");
    if (op.state === "succeeded")
      await closeException(
        d,
        exceptionId,
        `Refunded ${money(op.amountPence)} (${op.stripeId}).`,
        ARCHOS,
      );
    return;
  }
  const ops = await opsFor(d, demo.runId, CASE_ID);
  const kind = ops.find((o) => o.opId === e.opId)?.kind ?? "transfer";
  const latest = latestOps(ops)[kind];
  const again = latest?.state === "failed";
  if (
    again &&
    kind === "transfer" &&
    (await settleCheck(d, demo, ops, deps)).deny
  )
    return;
  // The settle exception has no op yet, so retrying it re-runs settle with fresh revalidation.
  if (!latest) await settleCase(d, demo, deps);
  else await execute(d, latest.opId, deps, again);
  const done = latestOps(await opsFor(d, demo.runId, CASE_ID))[kind];
  if (done?.state === "succeeded")
    await closeException(
      d,
      exceptionId,
      `Retried: ${done.stripeId} succeeded.`,
      ARCHOS,
    );
}
