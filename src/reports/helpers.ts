// The host functions a report's expressions may call. Each is total (a wrong
// input gives a readable result or a helper-error naming the problem, never a
// crash), locale-correct through `Intl` and the document's locale, and exact
// where money is involved (decimals go to `Intl` as strings, never as floats).

import { currencyDigits, parseDecimal } from "./money.ts";
import type { Labels } from "./labels.ts";

export interface HelperContext { locale: string; currency: string; labels: Labels }

export interface HelperDoc { name: string; signature: string; does: string; example: string }

/** The list `GET /vocabulary/reports` publishes. */
export const HELPER_DOCS: HelperDoc[] = [
  { name: "money", signature: "money(amount, currency?)", does: "An amount in the document's currency and locale, with the currency's digits (more when the amount has them, as a unit price may).", example: "{{ money(doc.money.total) }} → €1,234.50" },
  { name: "number", signature: "number(value, digits?)", does: "A number in the locale, with `digits` decimals when given.", example: "{{ number(row.qty) }} → 1,250" },
  { name: "percent", signature: "percent(value, digits?)", does: "A percentage: 19 prints as 19% (19 %, in de and fr).", example: "{{ percent(tax.rate) }}" },
  { name: "date", signature: "date(iso, style?)", does: "A date (ISO 8601) in the locale: style \"long\" (default), \"medium\" or \"short\". UTC.", example: "{{ date(doc.issuedAt) }} → 19 October 2026" },
  { name: "datetime", signature: "datetime(iso)", does: "A date and time, UTC.", example: "{{ datetime(doc.submission.created_at) }}" },
  { name: "label", signature: "label(key)", does: "A built-in word in the document's language (invoice, subtotal, vat, total, amountDue, dueDate, …), or the report's override.", example: "{{ label(\"invoice\") }} → Factură" },
  { name: "iban", signature: "iban(value)", does: "An IBAN grouped by four, upper case.", example: "{{ iban(bank.iban) }} → DE89 3704 0044 0532 0130 00" },
  { name: "sum", signature: "sum(array, key)", does: "The exact sum of one key over an array of objects.", example: "{{ number(sum(items, \"qty\")) }}" },
  { name: "count", signature: "count(array, key?)", does: "How many items; with a key, how many have a value there.", example: "{{ count(items) }}" },
  { name: "avg", signature: "avg(array, key)", does: "The mean of one key over the items that have it.", example: "{{ number(avg(scores, \"value\"), 1) }}" },
  { name: "round", signature: "round(value, digits?)", does: "Half away from zero, exactly.", example: "{{ round(2.345, 2) }} → 2.35" },
  { name: "join", signature: "join(array, separator?, key?)", does: "Items (or one key of each) as text, \", \" by default.", example: "{{ join(tags) }}" },
  { name: "upper", signature: "upper(text)", does: "Upper case, by the locale's rules.", example: "{{ upper(customer.city) }}" },
  { name: "epc", signature: "epc(name, iban, amount, reference, bic?)", does: "A SEPA credit transfer QR payload (EPC069-12, version 002, EUR) for a qr block.", example: "{{ epc(seller.name, seller.iban, doc.money.due, doc.number ?? \"DRAFT\") }}" },
];

export const HELPER_NAMES = HELPER_DOCS.map((h) => h.name);

class HelperError extends Error {}

function decimalText(v: unknown, name: string): string {
  const f = parseDecimal(v);
  if (!f) throw new HelperError(`${name}() needs a number, got ${JSON.stringify(v)}`);
  // An exact decimal string Intl reads without float conversion.
  let digits = 0;
  while (10n ** BigInt(digits) < f.d) digits++;
  const scaled = f.n * (10n ** BigInt(digits) / f.d);
  const neg = scaled < 0n;
  const s = (neg ? -scaled : scaled).toString().padStart(digits + 1, "0");
  return (neg ? "-" : "") + (digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s);
}

const decimals = (text: string) => (text.split(".")[1] ?? "").length;

function items(v: unknown, name: string): unknown[] {
  if (!Array.isArray(v)) throw new HelperError(`${name}() needs an array, got ${v === null ? "null" : typeof v}`);
  return v;
}

function field(item: unknown, key: unknown): unknown {
  if (key === undefined || key === null) return item;
  if (typeof item !== "object" || item === null) return undefined;
  return Object.hasOwn(item, String(key)) ? (item as Record<string, unknown>)[String(key)] : undefined;
}

function isoDate(v: unknown, name: string): Date {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) throw new HelperError(`${name}() needs an ISO date such as "2026-10-19", got ${JSON.stringify(v)}`);
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) throw new HelperError(`${name}() got an impossible date: ${v}`);
  return d;
}

/** Sum of exact decimals, as a decimal string. */
function exactSum(values: unknown[]): string {
  let acc = { n: 0n, d: 1n };
  for (const v of values) {
    const f = parseDecimal(v);
    if (!f) continue;
    acc = { n: acc.n * f.d + f.n * acc.d, d: acc.d * f.d };
  }
  return decimalText(acc.n === 0n ? 0 : `${acc.n * (10n ** 30n) / acc.d}e-30`, "sum");
}

function roundHalfAway(text: string, digits: number): string {
  const f = parseDecimal(text)!;
  const scale = 10n ** BigInt(digits);
  const n = f.n * scale;
  const neg = n < 0n;
  const abs = neg ? -n : n;
  let q = abs / f.d;
  if ((abs % f.d) * 2n >= f.d) q += 1n;
  const s = q.toString().padStart(digits + 1, "0");
  return (neg && q !== 0n ? "-" : "") + (digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s);
}

/** EPC069-12 ("GiroCode") payload; the amount must be EUR, 0.01 to 999999999.99. */
export function epcPayload(name: unknown, iban: unknown, amount: unknown, reference: unknown, bic?: unknown): string {
  const clean = (v: unknown) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
  const nm = clean(name).slice(0, 70);
  const ib = clean(iban).replace(/\s+/g, "").toUpperCase();
  if (!nm) throw new HelperError("epc() needs the beneficiary's name");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ib)) throw new HelperError(`epc() needs an IBAN, got ${JSON.stringify(iban)}`);
  const amt = roundHalfAway(decimalText(amount, "epc"), 2);
  const ref = clean(reference);
  const structured = /^RF\d{2}[A-Z0-9]{1,21}$/.test(ref.replace(/\s+/g, ""));
  return [
    "BCD", "002", "1", "SCT", clean(bic ?? "").toUpperCase(), nm, ib,
    Number(amt) > 0 ? `EUR${amt}` : "",
    "", structured ? ref.replace(/\s+/g, "") : "", structured ? "" : ref.slice(0, 140),
  ].join("\n").replace(/\n+$/, "");
}

export function makeHelpers(ctx: HelperContext): Record<string, (...args: unknown[]) => unknown> {
  const fmt = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat(ctx.locale, opts);
  return {
    money(amount, currency) {
      const cur = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : ctx.currency;
      const text = decimalText(amount, "money");
      const digits = currencyDigits(cur);
      const max = Math.max(digits, Math.min(decimals(text), 4));
      // Exact: Intl formats the decimal string, not a float.
      return fmt({ style: "currency", currency: cur, minimumFractionDigits: digits, maximumFractionDigits: max }).format(text as unknown as number);
    },
    number(value, digits) {
      const text = decimalText(value, "number");
      const d = typeof digits === "number" && digits >= 0 && digits <= 6 ? digits : undefined;
      return fmt(d === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: d, maximumFractionDigits: d }).format(text as unknown as number);
    },
    percent(value, digits) {
      const text = decimalText(value, "percent");
      const shifted = decimalText(`${text}e-2`, "percent"); // ÷ 100, exactly
      const d = typeof digits === "number" && digits >= 0 && digits <= 4 ? digits : Math.min(Math.max(decimals(text), 0), 2);
      return fmt({ style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(shifted as unknown as number);
    },
    date(iso, style) {
      const s = style === "short" || style === "medium" ? style : "long";
      return new Intl.DateTimeFormat(ctx.locale, { dateStyle: s, timeZone: "UTC" }).format(isoDate(iso, "date"));
    },
    datetime(iso) {
      return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(isoDate(iso, "datetime"));
    },
    label(key) {
      const k = String(key);
      if (!Object.hasOwn(ctx.labels, k)) throw new HelperError(`label(): no built-in word "${k}"`);
      return ctx.labels[k as keyof Labels];
    },
    iban(value) {
      const s = String(value ?? "").replace(/\s+/g, "").toUpperCase();
      return s.replace(/(.{4})(?=.)/g, "$1 ");
    },
    sum(array, key) {
      const out = exactSum(items(array, "sum").map((i) => field(i, key)));
      return Number(out);
    },
    count(array, key) {
      const list = items(array, "count");
      if (key === undefined) return list.length;
      return list.filter((i) => { const v = field(i, key); return v !== undefined && v !== null && v !== "" && v !== false; }).length;
    },
    avg(array, key) {
      const values = items(array, "avg").map((i) => field(i, key)).filter((v) => parseDecimal(v) !== null);
      if (!values.length) return 0;
      return Number(exactSum(values)) / values.length;
    },
    round(value, digits) {
      const d = typeof digits === "number" && Number.isInteger(digits) && digits >= 0 && digits <= 10 ? digits : 0;
      return Number(roundHalfAway(decimalText(value, "round"), d));
    },
    join(array, separator, key) {
      const sep = typeof separator === "string" ? separator : ", ";
      return items(array, "join").map((i) => field(i, key)).filter((v) => v !== undefined && v !== null && v !== "").map(String).join(sep);
    },
    upper(text) {
      return String(text ?? "").toLocaleUpperCase(ctx.locale);
    },
    epc(name, iban, amount, reference, bic) {
      // EPC069-12 is a SEPA credit transfer in euros: a RON or GBP invoice gets no EPC code.
      if (ctx.currency !== "EUR") throw new HelperError(`epc() is for EUR documents; this one is in ${ctx.currency}. Add when: "doc.currency == \"EUR\"" to the qr block.`);
      return epcPayload(name, iban, amount, reference, bic);
    },
  };
}
