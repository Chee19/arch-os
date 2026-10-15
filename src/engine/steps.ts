import type { FocusTab, ScenarioId, Source, StepKey } from "@/scenarios/types";

export type StepMeta = {
  label: string;
  actor: string;
  title: string;
  check: string;
  focusTab: FocusTab;
};

export const STEP_META: Record<StepKey, StepMeta> = {
  charge: {
    label: "Charge",
    actor: "ArchOS money outbox · Stripe test mode",
    title: "Maya pays £300 for BK-1042",
    check:
      "The intent row is written first. The PaymentIntent is created with the op ID as its idempotency key, then read back from Stripe.",
    focusTab: "money",
  },
  failure: {
    label: "Provider cancels",
    actor: "QuickShine Cleaning",
    title: "QuickShine cancels Friday's clean",
    check:
      "\"Van broke down, can't do Friday's job at Flat 3.\" BK-1042 is now provider cancelled and CASE-1042 opens with £300 of booking value at risk.",
    focusTab: "reasoning",
  },
  understand: {
    label: "Understand",
    actor: "ArchOS Recovery Agent",
    title: "Maya's needs become structured constraints",
    check:
      "The model reads both messages and returns constraint fields. Every later check reads only those fields, never the free text.",
    focusTab: "reasoning",
  },
  search: {
    label: "Search",
    actor: "ArchOS Recovery Agent",
    title: "Four providers checked against the constraints",
    check:
      "Eligibility is computed by code: a free slot that ends before 3pm Friday, pet friendly, and oven cleaning included.",
    focusTab: "candidates",
  },
  boundary: {
    label: "Policy check",
    actor: "ArchOS policy",
    title: "BrightNest at £340 is denied",
    check:
      "£340 is £40 more than Maya paid and the subsidy cap is £20. The gateway denies the offer before any slot is held.",
    focusTab: "candidates",
  },
  negotiate: {
    label: "Negotiate",
    actor: "ArchOS Recovery Agent",
    title: "ClearHome holds Friday 13:00 for £280",
    check:
      "ClearHome quotes £290 and accepts £280. The slot is held, and the hold has a countdown.",
    focusTab: "candidates",
  },
  propose: {
    label: "Propose",
    actor: "ArchOS Recovery Agent",
    title: "Maya gets the offer with the money split",
    check:
      "Price £280, refund £20, provider £224, gross commission £56, subsidy £0, and the time the offer expires.",
    focusTab: "messages",
  },
  consent: {
    label: "Consent",
    actor: "Maya Chen · simulated customer",
    title: "Waiting for Maya to accept",
    check:
      "Nothing is secured and no money moves until the customer accepts. Consent expires with the hold.",
    focusTab: "messages",
  },
  secure: {
    label: "Secure",
    actor: "ArchOS money outbox",
    title: "Booking reassigned and refund sent",
    check:
      "Hold, consent, slot and money are rechecked first. The reassignment and the refund intent commit together, then Stripe runs the refund.",
    focusTab: "money",
  },
  fulfil: {
    label: "Fulfil",
    actor: "ClearHome Cleaning · simulated",
    title: "ClearHome completes the clean",
    check:
      "A fulfilment event is recorded and labelled SIMULATED. No provider is paid before it exists.",
    focusTab: "money",
  },
  settle: {
    label: "Settle",
    actor: "ArchOS money outbox",
    title: "ClearHome is paid from Maya's charge",
    check:
      "The booking, the fulfilment event and the available funds are rechecked. The transfer is tied to the original charge and read back from Stripe.",
    focusTab: "money",
  },
  ledger: {
    label: "Ledger",
    actor: "ArchOS journal preview",
    title: "Journal preview from verified money",
    check:
      "Built only from succeeded Stripe operations and the fulfilment event. Every line cites its source. Preview, not posted to Briefcase.",
    focusTab: "ledger",
  },
  brief: {
    label: "Task",
    actor: "Sam Okafor · Marketplace Operations Lead",
    title: "Cancel 3 Harbour Lettings bookings",
    check:
      "Task OPS-311 approves BK-2003, BK-2011 and BK-2017 because the properties were withdrawn. ArchOS stores the approved list apart from the agent.",
    focusTab: "reasoning",
  },
  agentReads: {
    label: "Agent reads",
    actor: "Ops Agent",
    title: "The agent lists Harbour Lettings' bookings",
    check:
      "listBookings returns all 30 end-of-tenancy cleans booked for next week.",
    focusTab: "reasoning",
  },
  agentActs: {
    label: "Agent acts",
    actor: "Ops Agent",
    title: "The agent cancels the whole client",
    check:
      "cancelBookings runs for every Harbour Lettings booking instead of the 3 approved. All 30 are cancelled through the gateway.",
    focusTab: "reasoning",
  },
  detect: {
    label: "Scope check",
    actor: "ArchOS detector",
    title: "27 bookings cancelled outside OPS-311",
    check:
      "Changed bookings minus approved bookings. £8,100 of booking value is at risk. That is value at risk, not a loss.",
    focusTab: "incident",
  },
  contain: {
    label: "Contain",
    actor: "ArchOS policy",
    title: "Ops Agent contained. Tenant emails blocked",
    check:
      "The agent's write tools are suspended and reads stay on. Its next call, notifyCustomers to 30 tenants, is denied.",
    focusTab: "incident",
  },
  plan: {
    label: "Safety checks",
    actor: "ArchOS planner",
    title: "24 restorable, 3 slots already taken",
    check:
      "For each booking: is its original slot still free? If the slot went to another job, the booking needs another provider.",
    focusTab: "incident",
  },
  approve: {
    label: "Your decision",
    actor: "Sam Okafor · Marketplace Operations Lead",
    title: "Recovery needs your approval",
    check: "No booking is restored until a person approves the exact plan.",
    focusTab: "incident",
  },
  restore: {
    label: "Restore",
    actor: "ArchOS executor",
    title: "24 bookings restored",
    check:
      "Each restore rechecks the booking version and has its own operation ID, so a retry never repeats a change.",
    focusTab: "incident",
  },
  rescue: {
    label: "Rescue",
    actor: "ArchOS Recovery Agent",
    title: "2 conflicts rebooked, 1 handed to Priya Shah",
    check:
      "Free qualified slots go to the earliest service time first, within the £60 incident budget. Clause 4.2 of the client contract covers like-for-like replacements.",
    focusTab: "incident",
  },
  verify: {
    label: "Verify",
    actor: "ArchOS verifier",
    title: "24 restored, 2 replaced, 1 exception",
    check:
      "Every booking is re-read. Replacements are confirmed with the new provider. BK-2026 stays with Priya Shah until it is credited.",
    focusTab: "incident",
  },
  agent: {
    label: "Live agent",
    actor: "Live agent · Nebius Token Factory",
    title: "A real model works the case",
    check:
      "The model sees the case and the tools, not the provider floors or the subsidy cap. Every call it makes goes through the ArchOS gateway.",
    focusTab: "reasoning",
  },
};

export function stepsFor(scenario: ScenarioId, source: Source): StepKey[] {
  // Scene 2 is scripted only, whatever source is selected.
  if (scenario === "bulk-cancel")
    return [
      "brief",
      "agentReads",
      "agentActs",
      "detect",
      "contain",
      "plan",
      "approve",
      "restore",
      "rescue",
      "verify",
    ];
  if (source === "live")
    return [
      "charge",
      "failure",
      "agent",
      "consent",
      "secure",
      "fulfil",
      "settle",
      "ledger",
    ];
  return [
    "charge",
    "failure",
    "understand",
    "search",
    "boundary",
    "negotiate",
    "propose",
    "consent",
    "secure",
    "fulfil",
    "settle",
    "ledger",
  ];
}
