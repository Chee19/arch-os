import type { Db } from "mongodb";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { handle } from "@/engine/actions";
import {
  bookingOf,
  caseOf,
  type BookingData,
  type CaseData,
} from "@/engine/case";
import { runFailure } from "@/engine/scene1";
import { col, getDemo, loadRecords } from "@/engine/store";
import { scriptedConstraintsFor } from "@/scenarios/provider-cancel";
import { closeDb, testDb } from "./helpers";

const SCENE = "provider-cancel" as const;

// Skips the charge: open the case directly, then let advance run understand through run.ts.
async function understandWith(
  d: Db,
  fetchFor: (c: CaseData, b: BookingData) => typeof fetch,
) {
  await handle(d, { action: "configure", scenario: SCENE, source: "scripted" });
  const demo = await getDemo(d);
  await runFailure(d, demo);
  const recs = await loadRecords(d, SCENE);
  const c = caseOf(recs).data;
  const b = bookingOf(recs, c.bookingId).data;
  vi.stubGlobal("fetch", fetchFor(c, b));
  const step = demo.steps.indexOf("failure");
  await col
    .demo(d)
    .updateOne({ _id: "demo" }, { $set: { step, status: "running" } });
  await handle(d, { action: "advance", step });
  return {
    scripted: scriptedConstraintsFor(c, b),
    after: caseOf(await loadRecords(d, SCENE)).data,
  };
}

const reply = (content: string) =>
  (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

describe("live extraction in the understand step", () => {
  let d: Db;
  beforeAll(async () => {
    d = await testDb();
  });
  beforeEach(() => {
    vi.stubEnv("NEBIUS_API_KEY", "test-key");
    vi.stubEnv("NEBIUS_MODEL", "test-model");
    vi.stubEnv("LIVE_EXTRACTION", "on");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(closeDb);

  it("records live constraints and the model name", async () => {
    const { after } = await understandWith(d, (c, b) =>
      reply(
        JSON.stringify({
          ...scriptedConstraintsFor(c, b),
          notes: "From the live model.",
        }),
      ),
    );
    expect(after.extraction).toMatchObject({
      source: "live",
      model: "test-model",
      reason: null,
    });
    expect(after.constraints).toMatchObject({ notes: "From the live model." });
  });

  it("falls back to the scripted values when the model sends pounds as pence", async () => {
    const { scripted, after } = await understandWith(d, (c, b) =>
      reply(
        JSON.stringify({ ...scriptedConstraintsFor(c, b), maxPricePence: 300 }),
      ),
    );
    expect(after.extraction).toMatchObject({
      source: "scripted",
      reason: expect.stringMatching(/pence/),
    });
    expect(after.constraints).toEqual(scripted);
  });

  it("falls back on invalid JSON", async () => {
    const { scripted, after } = await understandWith(d, () =>
      reply("{not json"),
    );
    expect(after.extraction).toMatchObject({
      source: "scripted",
      reason: expect.stringMatching(/JSON/),
    });
    expect(after.constraints).toEqual(scripted);
  });

  it("falls back on a timeout", async () => {
    const { scripted, after } = await understandWith(
      d,
      () =>
        (async () => {
          throw new DOMException("This operation was aborted", "AbortError");
        }) as typeof fetch,
    );
    expect(after.extraction).toMatchObject({
      source: "scripted",
      reason: "timeout",
    });
    expect(after.constraints).toEqual(scripted);
  });
});
