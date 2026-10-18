import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMoney, currencyDigits, fromMinor, toMinor, type MoneyConfig } from "../../src/reports/money.ts";

const CFG: MoneyConfig = { lines: "items", quantity: "qty", unitPrice: "price", taxRate: "rate", discount: "discount", paid: "paid" };

type Item = Record<string, unknown>;

function calc(items: Item[], over: Partial<MoneyConfig> = {}, currency = "EUR", extra: Record<string, unknown> = {}) {
  return computeMoney({ items, ...extra }, { ...CFG, ...over }, currency);
}

/** Rates come back as decimal strings; compare them as numbers so "19" and "19.00" are the same rate. */
function groups(m: ReturnType<typeof calc>) {
  return m.taxes.map((g) => [Number(g.rate), g.base, g.tax]);
}

// Four lines, three rates. By hand:
//   A  2 x 50.00 @19  net 100.00  tax 19.00   gross 119.00
//   B  1 x 20.50 @ 9  net  20.50  tax 1.845 -> 1.85   gross 22.35
//   C  3 x 10.10 @ 5  net  30.30  tax 1.515 -> 1.52   gross 31.82
//   D  1 x 80.00 @19  net  80.00  tax 15.20   gross 95.20
const MIXED: Item[] = [
  { qty: 2, price: 50, rate: 19 },
  { qty: 1, price: 20.5, rate: 9 },
  { qty: 3, price: 10.1, rate: 5 },
  { qty: 1, price: 80, rate: 19 },
];

test("0.1 + 0.2 is exactly 0.30", () => {
  const m = calc([{ qty: 1, price: 0.1 }, { qty: 1, price: 0.2 }]);
  assert.deepEqual(m.lines.map((l) => l.net), ["0.10", "0.20"]);
  assert.equal(m.subtotal, "0.30");
  assert.equal(m.tax, "0.00");
  assert.equal(m.total, "0.30");
  assert.equal(m.currency, "EUR");
  assert.equal(m.digits, 2);
});

test("3 x 33.333 rounds to 100.00, from numbers and from numeric strings", () => {
  // 3 x 33.333 = 99.999 -> 100.00
  assert.equal(calc([{ qty: 3, price: 33.333 }]).lines[0]!.net, "100.00");
  assert.equal(calc([{ qty: "3", price: "33.333" }]).lines[0]!.net, "100.00");
  assert.equal(calc([{ qty: 3, price: "33.333" }]).subtotal, "100.00");
});

test("mixed 19 % / 9 % / 5 % rates give one tax group per rate, highest first", () => {
  const m = calc(MIXED);
  assert.deepEqual(m.lines.map((l) => [l.net, l.tax, l.gross]), [
    ["100.00", "19.00", "119.00"],
    ["20.50", "1.85", "22.35"],
    ["30.30", "1.52", "31.82"],
    ["80.00", "15.20", "95.20"],
  ]);
  // 19 %: base 100 + 80 = 180.00, tax 19.00 + 15.20 = 34.20
  assert.deepEqual(groups(m), [[19, "180.00", "34.20"], [9, "20.50", "1.85"], [5, "30.30", "1.52"]]);
  // subtotal 100 + 20.50 + 30.30 + 80 = 230.80; tax 34.20 + 1.85 + 1.52 = 37.57; total 268.37
  assert.equal(m.subtotal, "230.80");
  assert.equal(m.tax, "37.57");
  assert.equal(m.total, "268.37");
});

test("totals add up exactly in every mode", () => {
  const modes: Partial<MoneyConfig>[] = [{}, { rounding: "total" }, { prices: "gross" }, { prices: "gross", rounding: "total" }];
  for (const mode of modes) {
    const m = calc(MIXED, mode);
    const label = JSON.stringify(mode);
    assert.equal(toMinor(m.total, 2), toMinor(m.subtotal, 2) + toMinor(m.tax, 2), label);
    assert.equal(m.taxes.reduce((s, g) => s + toMinor(g.tax, 2), 0n), toMinor(m.tax, 2), label);
    if (mode.rounding !== "total") {
      assert.equal(m.lines.reduce((s, l) => s + toMinor(l.net, 2), 0n), toMinor(m.subtotal, 2), label);
    }
  }
});

test("a 10 % line discount on 3 x 19.99", () => {
  // 3 x 19.99 = 59.97; discount 59.97 x 10 % = 5.997; net 59.97 - 5.997 = 53.973 -> 53.97
  const m = calc([{ qty: 3, price: 19.99, discount: 10 }]);
  assert.equal(m.lines[0]!.net, "53.97");
  assert.equal(m.subtotal, "53.97");
  assert.equal(m.discount, "6.00");
  assert.equal(m.total, "53.97");
});

test("a discounted line is taxed on its discounted net", () => {
  // net 53.97; tax 53.97 x 19 % = 10.2543 -> 10.25; total 64.22
  const m = calc([{ qty: 3, price: 19.99, discount: 10, rate: 19 }]);
  assert.equal(m.lines[0]!.tax, "10.25");
  assert.equal(m.tax, "10.25");
  assert.equal(m.total, "64.22");
});

test("half-way tax rounds per line in line mode and once per group in total mode", () => {
  // Three lines of net 0.05 at 10 %.
  // line mode:  0.05 x 10 % = 0.005 -> 0.01 each, tax 0.03, total 0.15 + 0.03 = 0.18
  // total mode: group base 0.15 x 10 % = 0.015 -> 0.02, total 0.15 + 0.02 = 0.17
  const items = [1, 2, 3].map(() => ({ qty: 1, price: 0.05, rate: 10 }));
  const line = calc(items);
  assert.equal(line.tax, "0.03");
  assert.deepEqual(groups(line), [[10, "0.15", "0.03"]]);
  assert.equal(line.total, "0.18");
  const total = calc(items, { rounding: "total" });
  assert.equal(total.subtotal, "0.15");
  assert.equal(total.tax, "0.02");
  assert.deepEqual(groups(total), [[10, "0.15", "0.02"]]);
  assert.equal(total.total, "0.17");
});

test("rounding is half away from zero, symmetric for negatives", () => {
  const m = calc([{ qty: 1, price: 2.005 }, { qty: 1, price: -2.005 }, { qty: 1, price: 0.125 }, { qty: 1, price: -0.125 }]);
  // 2.005 -> 2.01, -2.005 -> -2.01, 0.125 -> 0.13, -0.125 -> -0.13
  assert.deepEqual(m.lines.map((l) => l.net), ["2.01", "-2.01", "0.13", "-0.13"]);
  assert.equal(m.subtotal, "0.00");
});

test("a credit note with negative lines", () => {
  // -2 x 49.995 = -99.990 -> -99.99; tax 19 %: -99.99 x 0.19 = -18.9981 -> -19.00; total -99.99 - 19.00 = -118.99
  const m = calc([{ qty: -2, price: 49.995, rate: 19 }]);
  assert.equal(m.lines[0]!.net, "-99.99");
  assert.equal(m.lines[0]!.tax, "-19.00");
  assert.equal(m.subtotal, "-99.99");
  assert.deepEqual(groups(m), [[19, "-99.99", "-19.00"]]);
  assert.equal(m.tax, "-19.00");
  assert.equal(m.total, "-118.99");
});

test("a negative unit price works the same as a negative quantity", () => {
  const m = calc([{ qty: 2, price: -49.995, rate: 19 }]);
  assert.equal(m.lines[0]!.net, "-99.99");
  assert.equal(m.total, "-118.99");
});

test("a zero-decimal currency (JPY) has no decimals and rounds away from zero", () => {
  // 3 x 333.5 = 1000.5 -> 1001; tax 10 %: 100.1 -> 100; total 1101
  const m = calc([{ qty: 3, price: 333.5, rate: 10 }], {}, "JPY");
  assert.equal(m.digits, 0);
  assert.equal(m.currency, "JPY");
  assert.equal(m.lines[0]!.net, "1001");
  assert.equal(m.lines[0]!.tax, "100");
  assert.equal(m.subtotal, "1001");
  assert.equal(m.tax, "100");
  assert.equal(m.total, "1101");
  assert.equal(m.paid, "0");
  assert.equal(m.due, "1101");
});

test("a three-decimal currency (BHD) keeps three decimals", () => {
  // 3 x 1.0005 = 3.0015 -> 3.002 (half away); tax 5 %: 3.002 x 0.05 = 0.1501 -> 0.150; total 3.152
  const m = calc([{ qty: 3, price: 1.0005, rate: 5 }], {}, "BHD");
  assert.equal(m.digits, 3);
  assert.equal(m.subtotal, "3.002");
  assert.equal(m.tax, "0.150");
  assert.equal(m.total, "3.152");
});

test("gross prices, line mode: tax is cut out of each line's gross", () => {
  // L1 1 x 119.00 @19: tax 119 x 19/119 = 19.00, net 100.00
  // L2 2 x 10.00 @9: gross 20.00, tax 20 x 9/109 = 1.6513... -> 1.65, net 18.35
  // subtotal 118.35, tax 20.65, total 139.00 (= the sum of the gross prices 119 + 20)
  const m = calc([{ qty: 1, price: 119, rate: 19 }, { qty: 2, price: 10, rate: 9 }], { prices: "gross" });
  assert.deepEqual(m.lines.map((l) => [l.net, l.tax, l.gross]), [
    ["100.00", "19.00", "119.00"],
    ["18.35", "1.65", "20.00"],
  ]);
  assert.deepEqual(groups(m), [[19, "100.00", "19.00"], [9, "18.35", "1.65"]]);
  assert.equal(m.subtotal, "118.35");
  assert.equal(m.tax, "20.65");
  assert.equal(m.total, "139.00");
});

test("gross prices: line mode and total mode cut the tax differently", () => {
  // Three lines of gross 0.35 at 10 %.
  // line mode:  0.35 x 10/110 = 0.0318... -> 0.03 each, net 0.32 each; subtotal 0.96, tax 0.09, total 1.05
  // total mode: group gross 1.05, tax 1.05 x 10/110 = 0.0954... -> 0.10, base 0.95; subtotal 0.95, tax 0.10, total 1.05
  const items = [1, 2, 3].map(() => ({ qty: 1, price: 0.35, rate: 10 }));
  const line = calc(items, { prices: "gross" });
  assert.deepEqual(line.lines.map((l) => [l.net, l.tax, l.gross]), Array(3).fill(["0.32", "0.03", "0.35"]));
  assert.deepEqual(groups(line), [[10, "0.96", "0.09"]]);
  assert.equal(line.subtotal, "0.96");
  assert.equal(line.tax, "0.09");
  assert.equal(line.total, "1.05");
  const total = calc(items, { prices: "gross", rounding: "total" });
  assert.deepEqual(groups(total), [[10, "0.95", "0.10"]]);
  assert.equal(total.subtotal, "0.95");
  assert.equal(total.tax, "0.10");
  assert.equal(total.total, "1.05");
});

test("paid and due", () => {
  // 2 x 50.00 @19: net 100.00, tax 19.00, total 119.00
  const items = [{ qty: 2, price: 50, rate: 19 }];
  const partly = calc(items, {}, "EUR", { paid: 50.5 });
  assert.equal(partly.total, "119.00");
  assert.equal(partly.paid, "50.50");
  assert.equal(partly.due, "68.50");
  const asString = calc(items, {}, "EUR", { paid: "119" });
  assert.equal(asString.paid, "119.00");
  assert.equal(asString.due, "0.00");
  const over = calc(items, {}, "EUR", { paid: 120 });
  assert.equal(over.due, "-1.00");
});

test("with nothing paid, or no paid key configured, due is the whole total", () => {
  const items = [{ qty: 2, price: 50, rate: 19 }];
  const none = calc(items);
  assert.equal(none.paid, "0.00");
  assert.equal(none.due, "119.00");
  const unconfigured = calc(items, { paid: undefined }, "EUR", { paid: 50 });
  assert.equal(unconfigured.paid, "0.00");
  assert.equal(unconfigured.due, "119.00");
});

test("a missing tax rate is 0 % and a missing discount is 0", () => {
  const m = calc([{ qty: 2, price: 5 }]);
  assert.equal(Number(m.lines[0]!.taxRate), 0);
  assert.equal(m.lines[0]!.net, "10.00");
  assert.equal(m.lines[0]!.tax, "0.00");
  assert.equal(m.lines[0]!.gross, "10.00");
  assert.equal(m.discount, "0.00");
  assert.equal(m.total, "10.00");
  // The configuration need not name a tax or discount key at all.
  const bare = computeMoney({ items: [{ qty: 2, price: 5, rate: 19, discount: 50 }] }, { lines: "items", quantity: "qty", unitPrice: "price" }, "EUR");
  assert.equal(bare.total, "10.00");
  assert.equal(bare.tax, "0.00");
});

test("amounts beyond float precision stay exact", () => {
  // 90071992547409.93 + 0.07 = 90071992547410.00 (the first is not representable as a double)
  const m = calc([{ qty: 1, price: "90071992547409.93" }, { qty: 1, price: "0.07" }]);
  assert.equal(m.subtotal, "90071992547410.00");
  assert.equal(m.total, "90071992547410.00");
});

test("toMinor reads decimals exactly and rounds half away from zero", () => {
  assert.equal(toMinor(0.1, 2), 10n);
  assert.equal(toMinor("33.333", 2), 3333n);
  assert.equal(toMinor(12, 2), 1200n);
  assert.equal(toMinor("12.3", 3), 12300n);
  assert.equal(toMinor("2.005", 2), 201n);
  assert.equal(toMinor(-2.005, 2), -201n);
  assert.equal(toMinor(1.005, 2), 101n); // a double would give 1.00
  assert.equal(toMinor("0.125", 2), 13n);
  assert.equal(toMinor("-0.125", 2), -13n);
  assert.equal(toMinor("0.004", 2), 0n);
  assert.equal(toMinor("1000.5", 0), 1001n);
  assert.equal(toMinor("-1000.5", 0), -1001n);
  assert.equal(toMinor(5, 0), 5n);
});

test("fromMinor writes exactly `digits` decimals", () => {
  assert.equal(fromMinor(12345n, 2), "123.45");
  assert.equal(fromMinor(-5n, 2), "-0.05");
  assert.equal(fromMinor(7n, 0), "7");
  assert.equal(fromMinor(0n, 2), "0.00");
  assert.equal(fromMinor(100n, 2), "1.00");
  assert.equal(fromMinor(5n, 3), "0.005");
  assert.equal(fromMinor(1234n, 3), "1.234");
  assert.equal(fromMinor(-1234567n, 2), "-12345.67");
  assert.equal(fromMinor(-1001n, 0), "-1001");
});

test("fromMinor(toMinor(x)) round-trips, negatives and the leading-zero cases included", () => {
  for (const [text, digits] of [["123.45", 2], ["-0.05", 2], ["0.00", 2], ["-12345.67", 2], ["0.01", 2], ["1.234", 3], ["-0.005", 3], ["42", 0], ["-7", 0]] as const) {
    assert.equal(fromMinor(toMinor(text, digits), digits), text);
  }
});

test("currencyDigits follows ISO 4217", () => {
  assert.equal(currencyDigits("EUR"), 2);
  assert.equal(currencyDigits("JPY"), 0);
  assert.equal(currencyDigits("BHD"), 3);
  assert.equal(currencyDigits("RON"), 2);
  assert.equal(currencyDigits("GBP"), 2);
});
