import type { Db } from "mongodb";
import { client, db } from "@/db";
import { handle } from "@/engine/actions";
import { bookingOf, CASE_SYSTEM, caseOf, type CaseData } from "@/engine/case";
import type { DemoDoc } from "@/engine/docs";
import { advance, type LiveRunner } from "@/engine/run";
import { CASE_ID } from "@/engine/scene1";
import {
  col,
  ensureIndexes,
  getDemo,
  loadRecords,
  persist,
  tx,
} from "@/engine/store";
import { opsFor } from "@/money/ops";
import type { StepKey } from "@/scenarios/types";

process.env.STEP_PACE_MS = "0";
// Keep acceptance suites offline unless a test stubs live extraction on.
process.env.LIVE_EXTRACTION = "off";

export async function testDb(): Promise<Db> {
  if (!process.env.MONGODB_URI)
    throw new Error("Set MONGODB_URI in .env.local to run acceptance tests.");
  const name = process.env.MONGODB_TEST_DB ?? "archos_test";
  if (name === (process.env.MONGODB_DB ?? "archos"))
    throw new Error(
      "MONGODB_TEST_DB must differ from MONGODB_DB; tests reset their database.",
    );
  const d = await db(name);
  await ensureIndexes(d);
  return d;
}

export async function closeDb(): Promise<void> {
  await (await client()).close();
}

export async function runToEnd(d: Db, live?: LiveRunner): Promise<DemoDoc> {
  for (let i = 0; i < 20; i++) {
    const demo = await getDemo(d);
    if (demo.status === "done") return demo;
    if (demo.status === "awaiting_approval")
      await handle(d, { action: "approve", confirmed: true }, live);
    else if (demo.status === "awaiting_customer")
      await handle(d, { action: "respond", decision: "accept" });
    else await advance(d, demo.step, live);
  }
  throw new Error("The run did not finish within 20 steps.");
}

// Scene 1 helpers shared by the Stripe sandbox and fake-Stripe suites.
const SCENE1 = "provider-cancel" as const;

export async function runUntil(d: Db, key: StepKey): Promise<DemoDoc> {
  for (let i = 0; i < 20; i++) {
    const demo = await getDemo(d);
    if (demo.steps[demo.step] === key) return demo;
    await handle(d, { action: "advance", step: demo.step });
  }
  throw new Error(`The run never reached ${key}.`);
}

export async function snapshot(d: Db) {
  const { runId } = await getDemo(d);
  const recs = await loadRecords(d, SCENE1);
  const c = caseOf(recs).data;
  return {
    runId,
    recs,
    c,
    booking: bookingOf(recs, c.bookingId).data,
    ops: await opsFor(d, runId, CASE_ID),
    exceptions: await col.exceptions(d).find({ runId }).toArray(),
  };
}

export async function editCase(
  d: Db,
  fn: (c: CaseData) => CaseData,
): Promise<void> {
  await tx(async (session) => {
    const recs = await loadRecords(d, SCENE1, session);
    await persist(
      d,
      SCENE1,
      recs,
      [{ system: CASE_SYSTEM, recordId: CASE_ID, data: fn(caseOf(recs).data) }],
      session,
    );
  });
}

export function expireHold(c: CaseData): CaseData {
  const past = new Date(Date.now() - 60_000).toISOString();
  return {
    ...c,
    offers: c.offers.map((o) =>
      o.holdExpiresAt ? { ...o, holdExpiresAt: past } : o,
    ),
    consent: c.consent && { ...c.consent, expiresAt: past },
  };
}
