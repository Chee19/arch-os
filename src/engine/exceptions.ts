import type { ClientSession, Db } from "mongodb";
import type { ExceptionDoc } from "./docs";
import { StepError } from "./errors";
import { audit, col } from "./store";

const ARCHOS = "ArchOS";

export async function openException(
  d: Db,
  e: Omit<ExceptionDoc, "exceptionId" | "status" | "createdAt" | "note"> & {
    reasonKey: string;
  },
  session?: ClientSession,
): Promise<ExceptionDoc> {
  const { reasonKey, ...fields } = e;
  const exceptionId = `EXC:${e.runId}:${e.caseId ?? e.target}:${reasonKey}`;
  // $setOnInsert keeps the first owner and due time, so opening twice changes nothing.
  const res = await col.exceptions(d).updateOne(
    { exceptionId },
    {
      $setOnInsert: {
        ...fields,
        status: "open",
        note: null,
        createdAt: new Date(),
      },
    },
    { upsert: true, session },
  );
  if (res.upsertedCount)
    await audit(
      d,
      {
        runId: e.runId,
        actor: ARCHOS,
        action: "exception.open",
        detail: `${e.owner}: ${e.nextAction} (${e.reason})`,
        decision: "Exception opened",
        operationId: null,
      },
      session,
    );
  const doc = await col.exceptions(d).findOne({ exceptionId }, { session });
  if (!doc) throw new Error(`Exception ${exceptionId} was not saved.`);
  return doc;
}

// A closed exception ignores repeat clicks; an unknown id is a caller error.
async function updateOpen(
  d: Db,
  exceptionId: string,
  set: Partial<ExceptionDoc>,
): Promise<ExceptionDoc | null> {
  const before = await col
    .exceptions(d)
    .findOneAndUpdate({ exceptionId, status: "open" }, { $set: set });
  if (!before && !(await col.exceptions(d).countDocuments({ exceptionId })))
    throw new StepError(`Unknown exception ${exceptionId}.`);
  return before;
}

export async function closeException(
  d: Db,
  exceptionId: string,
  note: string,
  actor: string,
): Promise<void> {
  const e = await updateOpen(d, exceptionId, { status: "closed", note });
  if (e)
    await audit(d, {
      runId: e.runId,
      actor,
      action: "exception.close",
      detail: `${exceptionId}: ${note}`,
      decision: "Closed",
      operationId: null,
    });
}

export async function autoCloseForOp(d: Db, opId: string): Promise<void> {
  const op = await col.payments(d).findOne({ opId });
  if (op?.state !== "succeeded") return;
  // A retry is attempt n+1 with a new opId, so exceptions raised on any attempt of this op close too.
  const attempts = await col
    .payments(d)
    .distinct("opId", { runId: op.runId, caseId: op.caseId, kind: op.kind });
  const open = await col
    .exceptions(d)
    .find({ status: "open", opId: { $in: attempts } })
    .toArray();
  for (const e of open)
    await closeException(
      d,
      e.exceptionId,
      "Resolved: operation succeeded",
      ARCHOS,
    );
}

export async function assignException(
  d: Db,
  exceptionId: string,
  owner: string,
  actor: string,
): Promise<void> {
  const e = await updateOpen(d, exceptionId, { owner });
  if (e?.target)
    await col
      .items(d)
      .updateOne(
        { runId: e.runId, target: e.target },
        { $set: { assignedTo: owner } },
      );
  if (e)
    await audit(d, {
      runId: e.runId,
      actor,
      action: "exception.assign",
      detail: `${exceptionId} assigned to ${owner}.`,
      decision: "Assigned",
      operationId: null,
    });
}

export async function openExceptions(
  d: Db,
  runId: string,
): Promise<ExceptionDoc[]> {
  return col
    .exceptions(d)
    .find({ runId, status: "open" })
    .sort({ createdAt: 1 })
    .toArray();
}
