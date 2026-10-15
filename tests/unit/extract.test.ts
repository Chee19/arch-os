import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveExtractor, parseExtraction } from "@/agent/extract";
import type { BookingData, CaseData } from "@/engine/case";

const H = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const CUSTOMER =
  "I hand the keys back Friday 5pm so it must be done by 3pm. We have a cat. The oven needs doing. I can't pay more.";

const booking: BookingData = {
  bookingId: "BK-1042",
  customer: "Maya Chen",
  client: null,
  service: "End-of-tenancy clean",
  address: "Flat 3, 12 Larkspur Road, London",
  startsAt: at(48 * H),
  endsAt: at(52 * H),
  pricePence: 30000,
  providerId: "PROV-quickshine",
  slotId: null,
  status: "provider_cancelled",
};
const caseData: CaseData = {
  caseId: "CASE-1042",
  bookingId: "BK-1042",
  status: "open",
  paidPence: 30000,
  originalProviderId: "PROV-quickshine",
  originalProviderPaid: false,
  cancellationText: "Van broke down, can't do Friday's job at Flat 3.",
  customerText: CUSTOMER,
  rescueDeadline: at(2 * H),
  constraints: null,
  extraction: null,
  offers: [],
  rejected: [],
  consent: null,
  messages: [],
  fulfilment: null,
  replacementProviderId: null,
};
const valid = {
  doneBy: at(53 * H),
  petFriendly: true,
  oven: true,
  maxPricePence: 30000,
  preferSameTime: true,
  notes: "Cat at home. Oven clean.",
};
const answer = (content: string) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

describe("parseExtraction", () => {
  it("accepts a plausible answer and drops unknown keys", () => {
    expect(
      parseExtraction(
        JSON.stringify({ ...valid, extra: 1 }),
        caseData,
        booking,
      ),
    ).toEqual(valid);
  });

  it.each([
    ["invalid JSON", "{not json", /JSON/],
    [
      "a schema failure",
      JSON.stringify({ ...valid, petFriendly: "yes" }),
      /schema/,
    ],
    [
      "pounds sent as pence",
      JSON.stringify({ ...valid, maxPricePence: 300 }),
      /pence/,
    ],
    [
      "doneBy in the past",
      JSON.stringify({ ...valid, doneBy: at(-H) }),
      /doneBy/,
    ],
    [
      "doneBy after the rescue window",
      JSON.stringify({ ...valid, doneBy: at(80 * H) }),
      /doneBy/,
    ],
  ])("rejects %s", (_name, raw, reason) => {
    expect(() => parseExtraction(raw, caseData, booking)).toThrow(reason);
  });
});

describe("liveExtractor", () => {
  beforeEach(() => {
    vi.stubEnv("NEBIUS_API_KEY", "test-key");
    vi.stubEnv("NEBIUS_MODEL", "test-model");
    vi.stubEnv("LIVE_EXTRACTION", "on");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is off without a key or with LIVE_EXTRACTION=off", () => {
    vi.stubEnv("LIVE_EXTRACTION", "off");
    expect(liveExtractor()).toBeUndefined();
    vi.stubEnv("LIVE_EXTRACTION", "on");
    vi.stubEnv("NEBIUS_API_KEY", "");
    expect(liveExtractor()).toBeUndefined();
  });

  it("returns live constraints with the model name", async () => {
    const fetchMock = answer(JSON.stringify(valid));
    vi.stubGlobal("fetch", fetchMock);
    const out = await liveExtractor()?.(caseData, booking);
    expect(out).toEqual({
      constraints: valid,
      extraction: {
        source: "live",
        model: "test-model",
        reason: null,
        raw: JSON.stringify(valid),
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/chat\/completions$/);
    const body = JSON.parse(String(init.body)) as {
      messages: { content: string }[];
    };
    expect(body).toMatchObject({
      model: "test-model",
      temperature: 0,
      response_format: { type: "json_object" },
    });
    expect(body.messages[1].content).toContain(CUSTOMER);
    expect(body.messages[1].content).toContain("30000");
  });

  it.each([
    ["invalid JSON", () => answer("{not json"), /JSON/],
    [
      "pounds sent as pence",
      () => answer(JSON.stringify({ ...valid, maxPricePence: 300 })),
      /pence/,
    ],
    [
      "a timeout",
      () =>
        vi.fn(async () => {
          throw new DOMException("This operation was aborted", "AbortError");
        }),
      /timeout/,
    ],
    [
      "a Nebius error",
      () => vi.fn(async () => new Response("boom", { status: 500 })),
      /500/,
    ],
  ])(
    "rejects on %s so runUnderstand falls back",
    async (_name, make, reason) => {
      vi.stubGlobal("fetch", make());
      await expect(liveExtractor()?.(caseData, booking)).rejects.toThrow(
        reason,
      );
    },
  );
});
