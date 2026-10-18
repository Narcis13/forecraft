// Money, exactly. Amounts become integer minor units (BigInt) at the currency's
// ISO 4217 digits; every intermediate product is a fraction of BigInts, and the
// only rounding is half away from zero at the points the rule names. No float
// ever touches an amount: a JSON number is read through its shortest decimal
// representation (so 0.1 is 0.1), never multiplied as a double.
//
// What comes out (`doc.money`) is decimal strings with exactly the currency's
// digits, so the printed lines, the tax breakdown and the total add up to the
// cent by construction: subtotal is the sum of line nets, tax the sum of the
// groups, total = subtotal + tax.

export interface MoneyConfig {
  lines: string;
  quantity: string;
  unitPrice: string;
  taxRate?: string;
  discount?: string;
  prices?: "net" | "gross";
  rounding?: "line" | "total";
  paid?: string;
}

export interface MoneyLine { index: number; quantity: string; unitPrice: string; discount: string; net: string; taxRate: string; tax: string; gross: string }
export interface TaxGroup { rate: string; base: string; tax: string }
export interface DocMoney {
  currency: string;
  digits: number;
  lines: MoneyLine[];
  subtotal: string;
  discount: string;
  taxes: TaxGroup[];
  tax: string;
  total: string;
  paid: string;
  due: string;
}

export class MoneyError extends Error {
  /** A JSON pointer into the data. */
  pointer: string;
  constructor(pointer: string, message: string) {
    super(message);
    this.pointer = pointer;
  }
}

/** Minor-unit digits of an ISO 4217 code, as `Intl` knows them (EUR 2, JPY 0, BHD 3). */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// ── Exact decimals as fractions ──────────────────────────────────────────────

/** n / d with d > 0. */
interface Frac { n: bigint; d: bigint }

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** A JSON number or numeric string as an exact fraction; `null` when it is neither. */
export function parseDecimal(value: unknown): Frac | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value); // the shortest round-trip decimal: what the JSON said
  } else if (typeof value === "string" && value.trim()) {
    text = value.trim();
  } else return null;
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const [, sign, int, frac = "", exp = "0"] = m;
  let n = BigInt(int! + frac);
  let scale = frac.length - Number(exp);
  if (sign === "-") n = -n;
  if (scale >= 0) return { n, d: 10n ** BigInt(scale) };
  return { n: n * 10n ** BigInt(-scale), d: 1n };
}

const mul = (a: Frac, b: Frac): Frac => ({ n: a.n * b.n, d: a.d * b.d });
const sub = (a: Frac, b: Frac): Frac => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const frac = (n: bigint, d = 1n): Frac => ({ n, d });

/** Round a fraction to an integer, half away from zero. */
function roundHalfAway(f: Frac): bigint {
  const neg = f.n < 0n;
  const abs = neg ? -f.n : f.n;
  const q = abs / f.d;
  const r = abs % f.d;
  const up = r * 2n >= f.d ? q + 1n : q;
  return neg ? -up : up;
}

/** A fraction of currency units → integer minor units. */
const toMinorFrac = (f: Frac, digits: number): bigint => roundHalfAway(mul(f, frac(10n ** BigInt(digits))));

/** An exact decimal (number or numeric string) → integer minor units, half away from zero. */
export function toMinor(value: unknown, digits: number): bigint {
  const f = parseDecimal(value);
  if (!f) throw new MoneyError("", `Not a number: ${JSON.stringify(value)}`);
  return toMinorFrac(f, digits);
}

/** 12345n, 2 → "123.45"; -5n, 2 → "-0.05"; 7n, 0 → "7". */
export function fromMinor(minor: bigint, digits: number): string {
  const neg = minor < 0n;
  const s = (neg ? -minor : minor).toString().padStart(digits + 1, "0");
  const out = digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
  return neg ? `-${out}` : out;
}

/** A fraction as a plain decimal string, for rates and quantities ("19", "7.5", "0.333"). */
function fracText(f: Frac): string {
  // Rates and quantities come from decimals, so d is a power of ten.
  let digits = 0;
  while (10n ** BigInt(digits) < f.d) digits++;
  const scaled = f.n * (10n ** BigInt(digits) / f.d);
  return fromMinor(scaled, digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

// ── The computation ─────────────────────────────────────────────────────────

const ZERO: Frac = frac(0n);
const HUNDRED: Frac = frac(100n);

/**
 * Lines → `doc.money`. `rounding: "line"` rounds each line's tax and sums;
 * `"total"` rounds once per tax rate over the group's line amounts. Line
 * amounts are always rounded to the currency's digits first: a printed line is
 * what it says.
 */
export function computeMoney(data: Record<string, unknown>, config: MoneyConfig, currency: string): DocMoney {
  const digits = currencyDigits(currency);
  const gross = config.prices === "gross";
  const byLine = (config.rounding ?? "line") === "line";
  const rows = data[config.lines];
  if (rows !== undefined && !Array.isArray(rows)) throw new MoneyError(`/${config.lines}`, "Must be an array of lines.");
  const list = (rows ?? []) as unknown[];

  const num = (row: Record<string, unknown>, key: string | undefined, i: number, required: boolean): Frac => {
    if (!key) return ZERO;
    const v = row[key];
    if (v === undefined || v === null || v === "") {
      if (required) throw new MoneyError(`/${config.lines}/${i}/${key}`, "Required for the money computation.");
      return ZERO;
    }
    const f = parseDecimal(v);
    if (!f) throw new MoneyError(`/${config.lines}/${i}/${key}`, `Not a number: ${JSON.stringify(v)}`);
    return f;
  };

  interface Line { index: number; qty: Frac; price: Frac; rate: Frac; discountPct: Frac; amount: bigint; discount: bigint; net: bigint; tax: bigint; gross: bigint }
  const lines: Line[] = list.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new MoneyError(`/${config.lines}/${i}`, "Each line must be an object.");
    const row = raw as Record<string, unknown>;
    const qty = num(row, config.quantity, i, true);
    const price = num(row, config.unitPrice, i, true);
    const rate = num(row, config.taxRate, i, false);
    const discountPct = num(row, config.discount, i, false);
    const before = mul(qty, price);
    const after = mul(before, sub(HUNDRED, discountPct)); // × (100 − d) / 100, the /100 below
    const amount = toMinorFrac({ n: after.n, d: after.d * 100n }, digits);
    const discount = toMinorFrac(before, digits) - amount;
    return { index: i, qty, price, rate, discountPct, amount, discount, net: 0n, tax: 0n, gross: 0n };
  });

  // Tax per line, or per group.
  const rateKey = (r: Frac) => fracText(r);
  const groups = new Map<string, { rate: Frac; base: bigint; tax: bigint; amount: bigint }>();
  for (const l of lines) {
    const k = rateKey(l.rate);
    const g = groups.get(k) ?? { rate: l.rate, base: 0n, tax: 0n, amount: 0n };
    g.amount += l.amount;
    groups.set(k, g);
    if (byLine) {
      if (gross) {
        // tax = gross × r / (100 + r)
        l.tax = roundHalfAway({ n: l.amount * l.rate.n, d: (100n * l.rate.d + l.rate.n) });
        l.gross = l.amount;
        l.net = l.amount - l.tax;
      } else {
        l.tax = roundHalfAway({ n: l.amount * l.rate.n, d: 100n * l.rate.d });
        l.net = l.amount;
        l.gross = l.amount + l.tax;
      }
      g.tax += l.tax;
      g.base += l.net;
    }
  }
  if (!byLine) {
    for (const g of groups.values()) {
      if (gross) {
        g.tax = roundHalfAway({ n: g.amount * g.rate.n, d: 100n * g.rate.d + g.rate.n });
        g.base = g.amount - g.tax;
      } else {
        g.tax = roundHalfAway({ n: g.amount * g.rate.n, d: 100n * g.rate.d });
        g.base = g.amount;
      }
    }
    // A line's own net/gross, for printing: its amount on the side the prices are on.
    for (const l of lines) {
      if (gross) { l.gross = l.amount; l.net = l.amount; } else { l.net = l.amount; l.gross = l.amount; }
    }
  }

  const ordered = [...groups.values()].sort((a, b) => (a.rate.n * b.rate.d < b.rate.n * a.rate.d ? 1 : -1));
  const subtotal = ordered.reduce((s, g) => s + g.base, 0n);
  const tax = ordered.reduce((s, g) => s + g.tax, 0n);
  const total = subtotal + tax;
  let paid = 0n;
  if (config.paid && data[config.paid] !== undefined && data[config.paid] !== null) {
    const f = parseDecimal(data[config.paid]);
    if (!f) throw new MoneyError(`/${config.paid}`, `Not a number: ${JSON.stringify(data[config.paid])}`);
    paid = toMinorFrac(f, digits);
  }
  const m = (v: bigint) => fromMinor(v, digits);
  return {
    currency,
    digits,
    lines: lines.map((l) => ({
      index: l.index,
      quantity: fracText(l.qty),
      // Exactly as given (33.333 stays 33.333): rounding a unit price would print a line that does not multiply out.
      unitPrice: fracText(l.price),
      discount: m(l.discount),
      net: m(l.net),
      taxRate: fracText(l.rate),
      tax: m(l.tax),
      gross: m(l.gross),
    })),
    subtotal: m(subtotal),
    discount: m(lines.reduce((s, l) => s + l.discount, 0n)),
    taxes: ordered.map((g) => ({ rate: fracText(g.rate), base: m(g.base), tax: m(g.tax) })),
    tax: m(tax),
    total: m(total),
    paid: m(paid),
    due: m(total - paid),
  };
}
