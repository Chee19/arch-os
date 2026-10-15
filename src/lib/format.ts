export type Unit = "GBP";

const whole = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(pence: number): string {
  const abs = Math.abs(pence);
  const text =
    abs % 100 === 0 ? whole.format(abs / 100) : exact.format(abs / 100);
  return pence < 0 ? `-${text}` : text;
}

export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

// h23 avoids "24:00" at midnight
const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const part = (d: Date, type: Intl.DateTimeFormatPartTypes) =>
  london.formatToParts(d).find((p) => p.type === type)?.value ?? "";

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

export function clock(iso: string | Date): string {
  const d = toDate(iso);
  return `${part(d, "hour")}:${part(d, "minute")}`;
}

export function when(iso: string | Date): string {
  const d = toDate(iso);
  return `${part(d, "weekday")} ${clock(d)}`;
}
