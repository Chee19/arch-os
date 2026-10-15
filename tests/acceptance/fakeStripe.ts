import type { StripeClient } from "@/money/stripe";

type Obj = { id: string; metadata: Record<string, string> } & Record<
  string,
  unknown
>;
type Params = Record<string, unknown>;

// Objects are keyed by metadata.opId, which the outbox always sets equal to the idempotency key.
// onCreate sees each object as created, so a test can change what later retrieves return.
export function fakeStripe(
  onCreate: (x: Obj) => Promise<void> = async () => {},
) {
  const calls: string[] = [];
  const intents: Obj[] = [];
  const refunds: Obj[] = [];
  const transfers: Obj[] = [];

  const add = (xs: Obj[], prefix: string, fields: Omit<Obj, "id">): Obj => {
    const x = { ...fields, id: `${prefix}_fake${xs.length + 1}` } as Obj;
    xs.push(x);
    return x;
  };
  // Same key, same object: that is what lets Replay report a suppressed duplicate.
  const create =
    (xs: Obj[], prefix: string, fields: (p: Params) => Params) =>
    async (p: Params, o: { idempotencyKey: string }) => {
      calls.push(`create:${o.idempotencyKey}`);
      const x =
        xs.find((y) => y.metadata.opId === o.idempotencyKey) ??
        add(xs, prefix, {
          ...fields(p),
          metadata: {
            ...(p.metadata as Record<string, string>),
            opId: o.idempotencyKey,
          },
        });
      await onCreate(x);
      return x;
    };
  const retrieve = (xs: Obj[]) => async (id: string) => {
    calls.push(`retrieve:${id}`);
    return xs.find((x) => x.id === id);
  };
  const list = (xs: Obj[]) => async () => {
    calls.push("list");
    return { data: xs };
  };
  const seed = (opId: string): Obj =>
    add(refunds, "re", {
      amount: 2000,
      status: "succeeded",
      payment_intent: "pi_fake",
      balance_transaction: "txn_fake",
      metadata: { opId },
    });
  const refunded = (pi: string) =>
    refunds
      .filter((r) => r.payment_intent === pi)
      .reduce((n, r) => n + (r.amount as number), 0);

  const s = {
    paymentIntents: {
      create: create(intents, "pi", (p) => ({
        amount: p.amount,
        status: "succeeded",
      })),
      // Always expanded, which covers both the verify and the chargeFacts reads.
      retrieve: async (id: string) => {
        calls.push(`retrieve:${id}`);
        const pi = intents.find((x) => x.id === id);
        return (
          pi && {
            ...pi,
            latest_charge: {
              id: id.replace("pi_", "ch_"),
              amount_refunded: refunded(id),
              balance_transaction: { id: id.replace("pi_", "txn_"), fee: 470 },
            },
          }
        );
      },
    },
    refunds: {
      create: create(refunds, "re", (p) => ({
        amount: p.amount,
        status: "succeeded",
        payment_intent: p.payment_intent,
        balance_transaction: "txn_fake",
      })),
      retrieve: retrieve(refunds),
      list: list(refunds),
    },
    transfers: {
      create: create(transfers, "tr", (p) => ({
        amount: p.amount,
        destination: p.destination,
        reversed: false,
        balance_transaction: "txn_fake",
      })),
      retrieve: retrieve(transfers),
      list: list(transfers),
    },
    balance: {
      retrieve: async () => ({
        available: [{ amount: 0, currency: "gbp" }],
        pending: [],
      }),
    },
    accounts: {
      retrieve: async (id: string) => ({
        id,
        capabilities: { transfers: "active" },
      }),
    },
  } as unknown as StripeClient;
  return { s, calls, seed };
}
