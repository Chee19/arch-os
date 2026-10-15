export type Split = {
  paid: number;
  price: number;
  customerNet: number;
  refund: number;
  subsidy: number;
  commission: number;
  transfer: number;
};

function assertPence(name: string, v: number) {
  if (!Number.isSafeInteger(v) || v <= 0)
    throw new Error(
      `${name} must be a positive integer number of pence, got ${v}`,
    );
}

export function splitFor(paidPence: number, pricePence: number): Split {
  assertPence("paidPence", paidPence);
  assertPence("pricePence", pricePence);
  const customerNet = Math.min(paidPence, pricePence);
  const commission = Math.round(pricePence / 5);
  return {
    paid: paidPence,
    price: pricePence,
    customerNet,
    refund: paidPence - customerNet,
    subsidy: pricePence - customerNet,
    commission,
    transfer: pricePence - commission,
  };
}
