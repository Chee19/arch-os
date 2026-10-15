import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PaymentOp } from "@/engine/docs";
import {
  assignException,
  autoCloseForOp,
  closeException,
  openException,
  openExceptions,
} from "@/engine/exceptions";
import { col, resetDemo } from "@/engine/store";
import { closeDb, testDb } from "./helpers";

const RUN = "run-exc";
const opId = (attempt: number) => `${RUN}:CASE-1042:refund:${attempt}`;
const REFUND_FAILED = {
  runId: RUN,
  caseId: "CASE-1042",
  target: null,
  owner: "Priya Shah",
  reason: "The £20 refund failed.",
  nextAction: "Retry refund",
  action: "retry" as const,
  dueAt: new Date("2026-10-15T11:00:00Z"),
  opId: opId(1),
  reasonKey: "refund_failed",
};
const op = (attempt: number, state: PaymentOp["state"]): PaymentOp => ({
  opId: opId(attempt),
  runId: RUN,
  caseId: "CASE-1042",
  kind: "refund",
  attempt,
  amountPence: 2000,
  request: {},
  state,
  stripeId: null,
  observed: null,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("exceptions", () => {
  let d: Db;
  beforeAll(async () => {
    d = await testDb();
  });
  afterAll(closeDb);
  beforeEach(() =>
    resetDemo(d, {
      scenario: "provider-cancel",
      mode: "monitor",
      source: "scripted",
    }),
  );

  it("opens once per deterministic id and audits once", async () => {
    const first = await openException(d, REFUND_FAILED);
    const again = await openException(d, {
      ...REFUND_FAILED,
      owner: "Sam Okafor",
    });
    expect(first).toMatchObject({
      exceptionId: `EXC:${RUN}:CASE-1042:refund_failed`,
      owner: "Priya Shah",
      status: "open",
      note: null,
    });
    expect(again).toEqual(first);
    expect(await col.exceptions(d).countDocuments()).toBe(1);
    expect(
      await col.audit(d).countDocuments({ action: "exception.open" }),
    ).toBe(1);
  });

  it("auto-closes only once a later attempt of the same op succeeds", async () => {
    await openException(d, REFUND_FAILED);
    await col.payments(d).insertMany([op(1, "failed"), op(2, "pending")]);
    await autoCloseForOp(d, opId(2));
    expect(await openExceptions(d, RUN)).toHaveLength(1);
    await col
      .payments(d)
      .updateOne({ opId: opId(2) }, { $set: { state: "succeeded" } });
    await autoCloseForOp(d, opId(2));
    expect(await openExceptions(d, RUN)).toEqual([]);
    expect(await col.exceptions(d).findOne({})).toMatchObject({
      status: "closed",
      note: "Resolved: operation succeeded",
    });
  });

  it("assigns and closes with audit, ignores a second close, rejects unknown ids", async () => {
    const e = await openException(d, REFUND_FAILED);
    await assignException(d, e.exceptionId, "Sam Okafor", "Sam Okafor");
    await closeException(d, e.exceptionId, "Refunded by phone.", "Sam Okafor");
    await closeException(d, e.exceptionId, "Second click.", "Sam Okafor");
    expect(await col.exceptions(d).findOne({})).toMatchObject({
      owner: "Sam Okafor",
      status: "closed",
      note: "Refunded by phone.",
    });
    expect(
      await col.audit(d).countDocuments({
        action: { $in: ["exception.assign", "exception.close"] },
      }),
    ).toBe(2);
    await expect(
      closeException(d, "EXC:nope", "x", "Sam Okafor"),
    ).rejects.toThrow(/Unknown exception/);
  });
});
