import type { Db } from "mongodb";
import { bookingOf, MARKET, slotsOf, type SlotData } from "@/engine/case";
import { money, when } from "@/lib/format";
import { SCENARIOS } from "@/scenarios";
import type { Change, Rec } from "@/scenarios/types";
import { StepError } from "./errors";
import { openException } from "./exceptions";
import { allocate, type AllocCase, type AllocSlot } from "./policy";
import { applyChanges, byTarget, find } from "./records";
import { audit, col, getDemo, loadRecords, persist, tx } from "./store";

export function reassignChanges(
  recs: Rec[],
  x: { bookingId: string; slotId: string; providerId: string },
): Change[] {
  const booking = bookingOf(recs, x.bookingId);
  const slot = slotsOf(recs).find((s) => s.recordId === x.slotId);
  if (!slot) throw new StepError(`Slot ${x.slotId} does not exist.`);
  // Shared by Scene 1 and Scene 2, so the one-slot-one-booking rule lives here.
  if (slot.data.status === "booked" && slot.data.bookingId !== x.bookingId)
    throw new StepError(
      `Slot ${x.slotId} is already booked for ${slot.data.bookingId}.`,
    );
  return [
    {
      system: booking.system,
      recordId: booking.recordId,
      data: {
        ...booking.data,
        providerId: x.providerId,
        slotId: x.slotId,
        status: "confirmed",
      },
    },
    {
      system: slot.system,
      recordId: slot.recordId,
      data: { ...slot.data, status: "booked", bookingId: x.bookingId },
    },
  ];
}

export const RESCUE_INCENTIVE_PENCE = 2000;
export const CONSENT_BASIS = "Client contract clause 4.2 (like-for-like)";
export const RESCUE_OWNER = "Priya Shah";
const RESCUER = "ArchOS rescue";
const HOUR = 3_600_000;

export function rescueInputs(
  recs: Rec[],
  targets: string[],
): { cases: AllocCase[]; slots: AllocSlot[] } {
  const cases = targets.map((target) => {
    const b = bookingOf(recs, target).data;
    // The replacement must be finished by the time the original job was due to start.
    return {
      target,
      startsAt: b.startsAt,
      deadline: b.startsAt,
      incentivePence: RESCUE_INCENTIVE_PENCE,
    };
  });
  const slots = slotsOf(recs)
    .filter((s) => s.data.status === "free")
    .map(({ data: s }) => ({
      slotId: s.slotId,
      providerId: s.providerId,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    }));
  return { cases, slots };
}

// London is UTC or UTC+1, so the hour read back at 18:00 UTC gives the offset.
export function exceptionDueAt(now: Date): Date {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const guess = new Date(`${day}T18:00:00Z`);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(guess),
  );
  const sixPm = guess.getTime() - (hour - 18) * HOUR;
  return new Date(sixPm > now.getTime() ? sixPm : now.getTime() + HOUR);
}

export async function rescueRecovery(d: Db): Promise<void> {
  const demo = await getDemo(d);
  const { runId } = demo;
  const s = SCENARIOS[demo.scenario];
  const [incident, rec] = await Promise.all([
    col.incidents(d).findOne({ runId }),
    col.recovery(d).findOne({ runId }),
  ]);
  if (!incident || !rec?.approvedBy)
    throw new StepError("Rescue needs an approved recovery plan.");
  const conflicts = await col
    .items(d)
    .find({ runId, status: "manual", why: "conflict" })
    .sort({ target: 1 })
    .toArray();
  const recs = await loadRecords(d, demo.scenario);
  const { cases, slots } = rescueInputs(
    recs,
    conflicts.map((i) => i.target),
  );
  const plan = allocate(cases, slots, incident);
  const handOver = [...plan.unassigned];
  let replaced = 0;

  for (const a of plan.assigned) {
    // One transaction per booking: reassignment, item and budget commit together or not at all.
    const done = await tx(async (session) => {
      const item = await col
        .items(d)
        .findOne({ runId, target: a.target, status: "manual" }, { session });
      if (!item) return "gone";
      const all = await loadRecords(d, demo.scenario, session);
      const slot = find(all, MARKET, a.slotId)?.data as SlotData | undefined;
      if (
        bookingOf(all, a.target).data.status !== "cancelled" ||
        slot?.status !== "free"
      )
        return "taken";
      const changes = reassignChanges(all, {
        bookingId: a.target,
        slotId: a.slotId,
        providerId: a.providerId,
      });
      await persist(d, demo.scenario, all, changes, session);
      const where = s.view(
        a.target,
        byTarget(applyChanges(all, changes), a.target),
      ).subtitle;
      const detail = `Replaced: ${where}. ${money(a.incentivePence)} incentive. Consent: ${CONSENT_BASIS}.`;
      await col.items(d).updateOne(
        { operationId: item.operationId },
        {
          $set: {
            status: "done",
            outcome: "replaced",
            replacement: {
              providerId: a.providerId,
              slotId: a.slotId,
              incentivePence: a.incentivePence,
              consentBasis: CONSENT_BASIS,
            },
            detail,
          },
        },
        { session },
      );
      await col
        .incidents(d)
        .updateOne(
          { runId },
          { $inc: { committedPence: a.incentivePence } },
          { session },
        );
      await audit(
        d,
        {
          runId,
          actor: RESCUER,
          action: "rescue.reassign",
          detail: `${a.target}: ${detail}`,
          decision: "Replaced",
          operationId: item.operationId,
        },
        session,
      );
      return "replaced";
    });
    if (done === "replaced") replaced++;
    // The planned slot or booking changed before commit, so a person owns it like an unplaced booking.
    if (done === "taken")
      handOver.push({ target: a.target, reason: "no_slot" });
  }

  let changed = replaced;
  for (const u of handOver) {
    // An existing exception, open or closed by its owner, is never opened again.
    if (await col.exceptions(d).findOne({ runId, target: u.target })) continue;
    const b = bookingOf(recs, u.target).data;
    const month = new Intl.DateTimeFormat("en-GB", {
      month: "long",
      timeZone: "Europe/London",
    }).format(new Date(b.startsAt));
    const reason =
      u.reason === "no_slot"
        ? `No qualified slot before ${when(b.startsAt)}`
        : "Incident budget used up";
    await openException(d, {
      runId,
      caseId: null,
      target: u.target,
      owner: RESCUE_OWNER,
      reason,
      nextAction: `Credit ${u.target} on Harbour Lettings' ${month} invoice and tell the tenant`,
      action: null,
      dueAt: exceptionDueAt(new Date()),
      opId: null,
      reasonKey: u.reason,
    });
    await col.items(d).updateOne(
      { runId, target: u.target, status: "manual" },
      {
        $set: {
          assignedTo: RESCUE_OWNER,
          detail: `${reason}. Exception opened for ${RESCUE_OWNER}.`,
        },
      },
    );
    changed++;
  }

  if (!changed) return;
  const after = await col.incidents(d).findOne({ runId });
  await audit(d, {
    runId,
    actor: RESCUER,
    action: "rescue.allocate",
    detail: `${replaced} replaced, ${handOver.length} handed to a person. ${money(after?.committedPence ?? 0)} of ${money(incident.budgetPence)} committed.`,
    decision: handOver.length ? "Rescued with exceptions" : "Rescued",
    operationId: null,
  });
}
