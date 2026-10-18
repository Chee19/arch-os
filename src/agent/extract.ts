import { z } from "zod";
import type {
  BookingData,
  CaseData,
  Constraints,
  Extraction,
} from "@/engine/case";
import { SCENARIOS } from "@/scenarios";
import { DEFAULT_MODEL, NEBIUS_BASE } from "./config";

// Takes the booking too because the sanity checks need its start time (Task 13).
export type Extractor = (
  caseData: CaseData,
  booking: BookingData,
) => Promise<{ constraints: Constraints; extraction: Extraction }>;

const DAY_MS = 86_400_000;
const TIMEOUT_MS = 20_000;
const london = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
const isTimeout = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  "name" in e &&
  (e.name === "TimeoutError" || e.name === "AbortError");

// The model only proposes values; this gate decides whether they are plausible enough to record.
export function parseExtraction(
  raw: string,
  caseData: CaseData,
  booking: BookingData,
  now = new Date(),
): Constraints {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("the model did not return valid JSON");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new Error("the model did not return a JSON object");
  const parsed = SCENARIOS[
    "provider-cancel"
  ].tools.recordConstraints.args.safeParse({
    ...json,
    caseId: caseData.caseId,
  });
  if (!parsed.success)
    throw new Error(`schema check failed: ${z.prettifyError(parsed.error)}`);
  const v = parsed.data as Constraints;
  const k: Constraints = {
    doneBy: v.doneBy,
    twoMovers: v.twoMovers,
    luton: v.luton,
    maxPricePence: v.maxPricePence,
    preferSameTime: v.preferSameTime,
    notes: v.notes,
  };
  // Catches pounds sent as pence: 300 means 3 pounds, not 300.
  if (
    k.maxPricePence < Math.max(1000, caseData.paidPence / 10) ||
    k.maxPricePence > 1_000_000
  )
    throw new Error(
      `maxPricePence ${k.maxPricePence} is not a plausible total in pence`,
    );
  const due = Date.parse(k.doneBy);
  if (!(due > now.getTime() && due <= Date.parse(booking.startsAt) + DAY_MS))
    throw new Error(`doneBy ${k.doneBy} is outside the rescue window`);
  return k;
}

function prompt(c: CaseData, b: BookingData) {
  return [
    {
      role: "system",
      content: [
        "You turn the messages about a cancelled man and van booking into constraints. Reply with one JSON object and nothing else.",
        "Use exactly these fields: doneBy (ISO 8601 UTC datetime ending in Z, the latest time the move must be finished), twoMovers (boolean, true if the job needs two movers, for example stairs without a lift or bulky furniture), luton (boolean, true if the job needs a Luton van, for example a full 2-bed home or larger), maxPricePence (integer, the most the customer will pay in total, in pence, so 300 pounds is 30000), preferSameTime (boolean, true unless the customer asks for another time), notes (string under 200 characters).",
        "Times in the messages are Europe/London local time.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Booking starts ${b.startsAt} (${london(b.startsAt)} London time).`,
        `Customer paid ${c.paidPence} pence.`,
        `Provider message: ${c.cancellationText ?? "(none)"}`,
        `Customer message: ${c.customerText ?? "(none)"}`,
      ].join("\n"),
    },
  ];
}

export function liveExtractor(): Extractor | undefined {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey || process.env.LIVE_EXTRACTION === "off") return undefined;
  const model = process.env.NEBIUS_MODEL ?? DEFAULT_MODEL;
  return async (caseData, booking) => {
    try {
      const res = await fetch(`${NEBIUS_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: prompt(caseData, booking),
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Nebius returned ${res.status}`);
      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
      };
      const raw = body.choices?.[0]?.message?.content ?? "";
      return {
        constraints: parseExtraction(raw, caseData, booking),
        extraction: { source: "live", model, reason: null, raw },
      };
    } catch (e) {
      if (isTimeout(e)) throw new Error("timeout");
      throw e;
    }
  };
}
