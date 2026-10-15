import { describe, expect, it } from "vitest";
import { bookingOf, caseOf, slotsOf } from "@/engine/case";
import { HOLD_MINUTES } from "@/engine/policy";
import { applyChanges } from "@/engine/records";
import {
  nextFriday,
  providerCancel as S,
  rejectedFrom,
  scriptedConstraintsFor,
} from "@/scenarios/provider-cancel";
import type { Rec } from "@/scenarios/types";

// Thursday 10:00 BST, exactly 24 h before the Friday 10:00 booking.
const NOW = new Date("2026-10-15T09:00:00Z");
const HOUR = 3_600_000;
const CASE = "CASE-1042";
const BRIGHTNEST = {
  caseId: CASE,
  providerId: "PROV-brightnest",
  slotId: "SLOT-brightnest-fri10",
};
const CLEARHOME = {
  caseId: CASE,
  providerId: "PROV-clearhome",
  slotId: "SLOT-clearhome-fri13",
};
const PROPOSE = {
  caseId: CASE,
  offerId: "OFR-PROV-clearhome",
  summary: "ClearHome, Friday 1pm.",
};

function call(recs: Rec[], tool: string, args: unknown, now = NOW) {
  const t = S.tools[tool];
  const out = t.run(t.args.parse(args), recs, now);
  return { result: out.result, recs: applyChanges(recs, out.changes) };
}
const offerPolicy = (recs: Rec[], args: unknown) =>
  S.tools.requestOffer.policy(S.tools.requestOffer.args.parse(args), recs, NOW);
const clearhome = (recs: Rec[]) =>
  caseOf(recs).data.offers.find((o) => o.providerId === "PROV-clearhome");
const slot = (recs: Rec[], id: string) =>
  slotsOf(recs).find((s) => s.recordId === id);

const seed = S.seed(NOW);
const ready = call(seed, "recordConstraints", {
  caseId: CASE,
  ...scriptedConstraintsFor(caseOf(seed).data, bookingOf(seed, "BK-1042").data),
}).recs;

describe("nextFriday", () => {
  it.each([
    ["2026-10-15T09:00:00Z", "2026-10-16T09:00:00.000Z"],
    ["2026-10-15T09:30:00Z", "2026-10-23T09:00:00.000Z"],
    ["2026-10-22T23:30:00Z", "2026-10-30T10:00:00.000Z"],
    ["2026-11-02T12:00:00Z", "2026-11-06T10:00:00.000Z"],
  ])("from %s gives %s", (now, want) =>
    expect(nextFriday(new Date(now), 10).toISOString()).toBe(want),
  );
});

describe("provider-cancel seed", () => {
  it("seeds BK-1042, five providers, four slots and the case shell", () => {
    expect(seed.map((r) => r.recordId).sort()).toEqual([
      "BK-1042",
      "CASE-1042",
      "PROV-brightnest",
      "PROV-clearhome",
      "PROV-freshco",
      "PROV-quickshine",
      "PROV-sparkle",
      "SLOT-brightnest-fri10",
      "SLOT-clearhome-fri13",
      "SLOT-quickshine-fri10",
      "SLOT-sparkle-fri09",
    ]);
    expect(seed.filter((r) => r.target !== null).map((r) => r.target)).toEqual([
      "BK-1042",
    ]);
    expect(bookingOf(seed, "BK-1042").data).toMatchObject({
      customer: "Maya Chen",
      startsAt: "2026-10-16T09:00:00.000Z",
      endsAt: "2026-10-16T11:00:00.000Z",
      pricePence: 30000,
      providerId: "PROV-quickshine",
      status: "confirmed",
    });
    expect(caseOf(seed).data).toMatchObject({
      status: "booked",
      paidPence: 30000,
      originalProviderId: "PROV-quickshine",
      originalProviderPaid: false,
      cancellationText: null,
      rescueDeadline: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
      constraints: null,
      offers: [],
      rejected: [],
      messages: [],
    });
    expect(slot(seed, "SLOT-quickshine-fri10")?.data).toMatchObject({
      status: "booked",
      bookingId: "BK-1042",
    });
  });

  it("scripted constraints finish by Friday 15:00 London within what Maya paid", () =>
    expect(
      scriptedConstraintsFor(
        caseOf(seed).data,
        bookingOf(seed, "BK-1042").data,
      ),
    ).toEqual({
      doneBy: "2026-10-16T14:00:00.000Z",
      petFriendly: true,
      oven: true,
      maxPricePence: 30000,
      preferSameTime: true,
      notes: "Keys back Fri 17:00. Cat in the flat. Oven needed.",
    }));
});

describe("provider-cancel tools", () => {
  it("searches in a fixed order with eligibility from policy", () => {
    const r = call(ready, "searchProviders", { caseId: CASE }).result as {
      providerId: string;
      eligible: boolean;
    }[];
    expect(r.map((p) => [p.providerId, p.eligible])).toEqual([
      ["PROV-brightnest", true],
      ["PROV-clearhome", true],
      ["PROV-sparkle", false],
      ["PROV-freshco", false],
    ]);
  });

  it("quotes, counters below the floor, then holds at £280", () => {
    const quoted = call(ready, "requestOffer", CLEARHOME);
    expect(quoted.result).toEqual({ status: "quoted", quotePence: 29000 });
    expect(clearhome(quoted.recs)).toMatchObject({
      state: "quoted",
      quotePence: 29000,
      pricePence: null,
      holdExpiresAt: null,
    });
    const low = call(quoted.recs, "requestOffer", {
      ...CLEARHOME,
      pricePence: 27500,
    });
    expect(low.result).toEqual({ status: "countered", quotePence: 29000 });
    expect(slot(low.recs, CLEARHOME.slotId)?.data.status).toBe("free");
    expect(
      offerPolicy(low.recs, { ...CLEARHOME, pricePence: 28000 }),
    ).toBeNull();
    const held = call(low.recs, "requestOffer", {
      ...CLEARHOME,
      pricePence: 28000,
    });
    const s = slot(held.recs, CLEARHOME.slotId);
    expect(s?.data.status).toBe("held");
    expect(clearhome(held.recs)).toMatchObject({
      state: "held",
      pricePence: 28000,
      slotVersion: s?.version,
      holdExpiresAt: new Date(
        NOW.getTime() + HOLD_MINUTES() * 60_000,
      ).toISOString(),
    });
  });

  it("denies BrightNest at £340 as over_subsidy and a no-oven provider as hard_constraint", () => {
    const deny = offerPolicy(ready, { ...BRIGHTNEST, pricePence: 34000 });
    expect(deny?.reason).toBe("over_subsidy");
    expect(offerPolicy(ready, BRIGHTNEST)).toBeNull();
    expect(
      offerPolicy(ready, {
        caseId: CASE,
        providerId: "PROV-sparkle",
        slotId: "SLOT-sparkle-fri09",
        pricePence: 25000,
      })?.reason,
    ).toBe("hard_constraint");
    expect(
      rejectedFrom(
        { reason: "over_subsidy", message: "Too high" },
        "PROV-brightnest",
        34000,
        NOW,
      ),
    ).toEqual({
      providerId: "PROV-brightnest",
      pricePence: 34000,
      reason: "over_subsidy",
      message: "Too high",
      at: NOW.toISOString(),
    });
  });

  it("refuses to propose without a live hold", () => {
    const quoted = call(ready, "requestOffer", CLEARHOME).recs;
    expect(() => call(quoted, "proposeRecovery", PROPOSE)).toThrow(/no hold/);
    const held = call(quoted, "requestOffer", {
      ...CLEARHOME,
      pricePence: 28000,
    }).recs;
    const late = new Date(NOW.getTime() + (HOLD_MINUTES() + 1) * 60_000);
    expect(() => call(held, "proposeRecovery", PROPOSE, late)).toThrow(
      /expired/,
    );
    expect(clearhome(call(held, "proposeRecovery", PROPOSE).recs)?.state).toBe(
      "proposed",
    );
  });

  it("runs the script with valid args, one policy denial and no _sim leak", () => {
    expect([...new Set(S.script.map((c) => c.step))]).toEqual([
      "search",
      "boundary",
      "negotiate",
      "propose",
    ]);
    let recs = ready;
    let denied = 0;
    const results: unknown[] = [
      call(ready, "readCase", { caseId: CASE }).result,
    ];
    for (const c of S.script) {
      const t = S.tools[c.tool];
      expect(t, c.tool).toBeDefined();
      const args = t.args.parse(c.args);
      // The gateway records a denial instead of running the tool.
      if (t.policy(args, recs, NOW)) {
        denied++;
        continue;
      }
      const out = t.run(args, recs, NOW);
      results.push(out.result);
      recs = applyChanges(recs, out.changes);
    }
    expect(denied).toBe(1);
    expect(JSON.stringify(results)).not.toMatch(/_sim|floorPence/);
    expect(clearhome(recs)?.state).toBe("proposed");
    expect(caseOf(recs).data.messages.map((m) => [m.party, m.kind])).toEqual([
      ["ClearHome Cleaning", "text"],
      ["Maya Chen", "proposal"],
      ["Maya Chen", "text"],
    ]);
  });
});
