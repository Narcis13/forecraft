import { test } from "node:test";
import assert from "node:assert/strict";
import { epcPayload, HELPER_DOCS, HELPER_NAMES, makeHelpers } from "../../src/reports/helpers.ts";
import { LABEL_KEYS, labelsFor, languageOf, LANGUAGES } from "../../src/reports/labels.ts";

type Locale = "en-GB" | "ro-RO" | "de-DE" | "fr-FR";

/**
 * Intl separates groups and the currency with U+202F (fr) and U+00A0 (ro, de, fr) and writes
 * U+2212 for a minus in some ICU versions. Compare after folding all of them to one plain space / hyphen.
 */
const plain = (v: unknown) => String(v).replace(/[\s   ]+/g, " ").replace(/−/g, "-").trim();

function helpers(locale: Locale, currency = locale === "ro-RO" ? "RON" : "EUR") {
  return makeHelpers({ locale, currency, labels: labelsFor(locale) });
}

/** A helper's result, with no-break spaces (dates keep their parts together) read as spaces. */
const call = (h: ReturnType<typeof makeHelpers>, name: string, ...args: unknown[]) => {
  const v = h[name]!(...args);
  return typeof v === "string" ? v.replace(/ /g, " ") : v;
};

// What each locale prints for the same inputs.
const EXPECT: Record<Locale, {
  money: string; negative: string; threeDecimals: string; zero: string; number: string; numberFixed: string; percent: string; percent2: string; date: string;
  invoice: string; subtotal: string; page: string; of: string;
}> = {
  "en-GB": {
    money: "€1,234.50", negative: "-€1,234.50", threeDecimals: "€12.345", zero: "€0.00", number: "1,234,567.891", numberFixed: "1,234.50", percent: "19%", percent2: "19.5%",
    date: "19 October 2026", invoice: "Invoice", subtotal: "Subtotal", page: "Page {n} of {total}", of: "of",
  },
  "ro-RO": {
    money: "1.234,50 RON", negative: "-1.234,50 RON", threeDecimals: "12,345 RON", zero: "0,00 RON", number: "1.234.567,891", numberFixed: "1.234,50", percent: "19 %", percent2: "19,5 %",
    date: "19 octombrie 2026", invoice: "Factură", subtotal: "Subtotal", page: "Pagina {n} din {total}", of: "din",
  },
  "de-DE": {
    money: "1.234,50 €", negative: "-1.234,50 €", threeDecimals: "12,345 €", zero: "0,00 €", number: "1.234.567,891", numberFixed: "1.234,50", percent: "19 %", percent2: "19,5 %",
    date: "19. Oktober 2026", invoice: "Rechnung", subtotal: "Zwischensumme", page: "Seite {n} von {total}", of: "von",
  },
  "fr-FR": {
    money: "1 234,50 €", negative: "-1 234,50 €", threeDecimals: "12,345 €", zero: "0,00 €", number: "1 234 567,891", numberFixed: "1 234,50", percent: "19 %", percent2: "19,5 %",
    date: "19 octobre 2026", invoice: "Facture", subtotal: "Sous-total", page: "Page {n} sur {total}", of: "sur",
  },
};

for (const locale of Object.keys(EXPECT) as Locale[]) {
  const want = EXPECT[locale];
  const h = helpers(locale);

  test(`${locale}: money groups, separates and places the currency by locale`, () => {
    assert.equal(plain(call(h, "money", 1234.5)), want.money);
    assert.equal(plain(call(h, "money", "1234.50")), want.money);
    assert.equal(plain(call(h, "money", 0)), want.zero);
  });

  test(`${locale}: a negative amount keeps its sign`, () => {
    assert.equal(plain(call(h, "money", -1234.5)), want.negative);
  });

  test(`${locale}: a 3-decimal unit price stays exact, not rounded to cents`, () => {
    assert.equal(plain(call(h, "money", "12.345")), want.threeDecimals);
    assert.equal(plain(call(h, "money", 12.345)), want.threeDecimals);
    // Four decimals at most, and 0.1 + 0.2 style floats never leak into the text.
    assert.match(plain(call(h, "money", "12.3456")), /12[.,]3456/);
    assert.doesNotMatch(plain(call(h, "money", 0.1 + 0.2)), /0000/);
    assert.match(plain(call(h, "money", 0.1 + 0.2)), /^0[.,]30? ?\D*$|^\D*0[.,]30?$/);
  });

  test(`${locale}: JPY has no decimals, and keeps one the amount really has`, () => {
    assert.equal(plain(call(h, "money", 1234, "JPY")).replace(/\D/g, ""), "1234");
    assert.equal(plain(call(h, "money", 1234.5, "JPY")).replace(/\D/g, ""), "12345");
    // A currency argument is honoured; garbage falls back to the document's.
    assert.equal(plain(call(h, "money", 1234.5, "nope")), want.money);
  });

  test(`${locale}: number`, () => {
    assert.equal(plain(call(h, "number", 1234567.891)), want.number);
    assert.equal(plain(call(h, "number", 1234.5, 2)), want.numberFixed);
    assert.equal(plain(call(h, "number", 1250)).replace(/\D/g, ""), "1250");
    assert.equal(plain(call(h, "number", -1234.5, 1)).startsWith("-"), true);
    // Digits outside 0..6 are ignored.
    assert.equal(plain(call(h, "number", 1.5, 9)), plain(call(h, "number", 1.5)));
  });

  test(`${locale}: percent shifts exactly: 19 is 19 %, 19.5 keeps its decimal`, () => {
    assert.equal(plain(call(h, "percent", 19)), want.percent);
    assert.equal(plain(call(h, "percent", 19.5)), want.percent2);
    assert.equal(plain(call(h, "percent", 7, 1)).replace(/\s/g, "").replace(",", "."), "7.0%");
    assert.equal(plain(call(h, "percent", 0)).replace(/\s/g, ""), "0%");
    assert.equal(plain(call(h, "percent", "100")).replace(/\s/g, ""), "100%");
  });

  test(`${locale}: date in the long style, and a time of day never moves it (UTC)`, () => {
    assert.equal(plain(call(h, "date", "2026-10-19")), want.date);
    assert.equal(plain(call(h, "date", "2026-10-19T23:59:00Z")), want.date);
    assert.equal(plain(call(h, "date", "2026-10-19T00:00:00Z", "long")), want.date);
    assert.match(plain(call(h, "datetime", "2026-10-19T14:05:00Z")), /2026.*14:05|14:05.*2026/);
    assert.match(plain(call(h, "date", "2026-10-19", "short")), /19/);
    assert.match(plain(call(h, "date", "2026-10-19", "medium")), /19/);
  });

  test(`${locale}: label gives the built-in word in the document's language`, () => {
    assert.equal(call(h, "label", "invoice"), want.invoice);
    assert.equal(call(h, "label", "subtotal"), want.subtotal);
    assert.equal(call(h, "label", "page"), want.page);
    assert.equal(call(h, "label", "of"), want.of);
    assert.throws(() => call(h, "label", "nonsense"), /no built-in word "nonsense"/);
    assert.throws(() => call(h, "label", "toString"), /no built-in word/);
  });

  test(`${locale}: iban groups by four and upper-cases`, () => {
    assert.equal(call(h, "iban", "de89370400440532013000"), "DE89 3704 0044 0532 0130 00");
    assert.equal(call(h, "iban", "DE89 3704 0044 0532 0130 00"), "DE89 3704 0044 0532 0130 00");
    assert.equal(call(h, "iban", "RO49AAAA1B31007593840000"), "RO49 AAAA 1B31 0075 9384 0000");
    assert.equal(call(h, "iban", "AB12"), "AB12");
    assert.equal(call(h, "iban", undefined), "");
  });

  test(`${locale}: sum is exact: 0.1 + 0.2 = 0.3`, () => {
    assert.equal(call(h, "sum", [{ v: 0.1 }, { v: 0.2 }], "v"), 0.3);
    assert.equal(call(h, "sum", [{ v: "1.10" }, { v: 2.2 }, { w: 9 }, { v: "x" }, { v: null }], "v"), 3.3);
    assert.equal(call(h, "sum", [{ v: 19.99 }, { v: 5.01 }, { v: -10.5 }], "v"), 14.5);
    assert.equal(call(h, "sum", [], "v"), 0);
    // Without a key the items themselves are added.
    assert.equal(call(h, "sum", [0.1, 0.2, 0.3]), 0.6);
    assert.throws(() => call(h, "sum", "nope", "v"), /sum\(\) needs an array/);
    assert.throws(() => call(h, "sum", null, "v"), /sum\(\) needs an array, got null/);
  });

  test(`${locale}: count, with and without a key`, () => {
    assert.equal(call(h, "count", [1, 2, 3]), 3);
    assert.equal(call(h, "count", []), 0);
    // With a key: items that have a value there (0 is a value; "", null, false and a missing key are not).
    assert.equal(call(h, "count", [{ a: 1 }, { a: "" }, { a: null }, { b: 1 }, { a: 0 }, { a: false }, { a: "x" }], "a"), 3);
    assert.throws(() => call(h, "count", {}), /count\(\) needs an array/);
  });

  test(`${locale}: avg is the mean of the items that have the key`, () => {
    assert.equal(call(h, "avg", [{ v: 1 }, { v: 2 }, { v: 6 }], "v"), 3);
    assert.equal(call(h, "avg", [{ v: 1 }, { w: 2 }, { v: "x" }], "v"), 1);
    assert.equal(call(h, "avg", [], "v"), 0);
    assert.equal(call(h, "avg", [{ v: 0.1 }, { v: 0.2 }], "v"), 0.15);
  });

  test(`${locale}: round is half away from zero, exactly`, () => {
    assert.equal(call(h, "round", 2.345, 2), 2.35);
    assert.equal(call(h, "round", -2.345, 2), -2.35);
    assert.equal(call(h, "round", 2.5), 3);
    assert.equal(call(h, "round", -2.5), -3);
    assert.equal(call(h, "round", 1.005, 2), 1.01);
    assert.equal(call(h, "round", 0.5), 1);
    assert.equal(call(h, "round", 2.344, 2), 2.34);
    assert.equal(call(h, "round", "7.125", 2), 7.13);
    // A rounded-away negative is 0, not -0.
    assert.equal(call(h, "round", -0.001, 2), 0);
    assert.throws(() => call(h, "round", "abc"), /round\(\) needs a number/);
  });

  test(`${locale}: join, with a separator and with a key`, () => {
    assert.equal(call(h, "join", ["a", "b", "c"]), "a, b, c");
    assert.equal(call(h, "join", ["a", "b"], " / "), "a / b");
    assert.equal(call(h, "join", [{ n: "a" }, { n: "" }, { m: "x" }, { n: "c" }], " + ", "n"), "a + c");
    assert.equal(call(h, "join", []), "");
    assert.equal(call(h, "join", [1, null, 2, undefined]), "1, 2");
    assert.throws(() => call(h, "join", "abc"), /join\(\) needs an array/);
  });

  test(`${locale}: upper uses the locale's rules`, () => {
    assert.equal(call(h, "upper", "ăîșț"), "ĂÎȘȚ");
    assert.equal(call(h, "upper", "straße"), "STRASSE");
    assert.equal(call(h, "upper", "éàç"), "ÉÀÇ");
    assert.equal(call(h, "upper", null), "");
    assert.equal(call(h, "upper", 12), "12");
  });
}

test("helpers refuse nonsense with a readable error, never a crash of another kind", () => {
  const h = helpers("en-GB");
  assert.throws(() => call(h, "money", "nope"), /money\(\) needs a number, got "nope"/);
  assert.throws(() => call(h, "money", undefined), /money\(\) needs a number/);
  assert.throws(() => call(h, "number", {}), /number\(\) needs a number/);
  assert.throws(() => call(h, "percent", "x%"), /percent\(\) needs a number/);
  assert.throws(() => call(h, "date", "nope"), /date\(\) needs an ISO date such as "2026-10-19", got "nope"/);
  assert.throws(() => call(h, "date", 20261019), /date\(\) needs an ISO date/);
  assert.throws(() => call(h, "date", "2026-13-01"), /impossible date/);
  assert.throws(() => call(h, "datetime", "yesterday"), /datetime\(\) needs an ISO date/);
});

test("date(): a day that does not exist is refused, not rolled into the next month", () => {
  const h = helpers("en-GB");
  assert.throws(() => call(h, "date", "2026-02-31"), /impossible date/);
  assert.throws(() => call(h, "date", "2026-04-31"), /impossible date/);
});

test("date styles in en-GB (spaces are non-breaking, so a date never splits across lines)", () => {
  const h = helpers("en-GB");
  assert.ok(String(h.date!("2026-10-19")).includes(" "));
  assert.equal(call(h, "date", "2026-10-19"), "19 October 2026");
  assert.equal(call(h, "date", "2026-10-19", "medium"), "19 Oct 2026");
  assert.equal(call(h, "date", "2026-10-19", "short"), "19/10/2026");
  assert.equal(call(h, "date", "2026-10-19", "weird"), "19 October 2026");
  assert.match(String(call(h, "datetime", "2026-10-19T14:05:00Z")), /19 Oct 2026.*14:05/);
});

test("the document's locale and currency are the defaults, a currency argument overrides", () => {
  const h = helpers("de-DE", "CHF");
  assert.equal(plain(call(h, "money", 5)), "5,00 CHF");
  assert.equal(plain(call(h, "money", 5, "EUR")), "5,00 €");
});

test("the helper docs name every helper once, and HELPER_NAMES match the implementation", () => {
  const h = helpers("en-GB");
  assert.equal(new Set(HELPER_NAMES).size, HELPER_NAMES.length);
  assert.deepEqual([...HELPER_NAMES].sort(), Object.keys(h).sort());
  for (const doc of HELPER_DOCS) {
    assert.ok(doc.signature.startsWith(`${doc.name}(`), doc.name);
    assert.ok(doc.does && doc.example, doc.name);
  }
});

// ── labels ──────────────────────────────────────────────────────────────────

test("every language defines every label, and the page label has the counter's places", () => {
  assert.deepEqual([...LANGUAGES], ["en", "ro", "de", "fr"]);
  for (const lang of LANGUAGES) {
    const labels = labelsFor(lang);
    assert.deepEqual(Object.keys(labels).sort(), [...LABEL_KEYS].sort(), lang);
    for (const key of LABEL_KEYS) assert.ok(labels[key].trim(), `${lang}.${key}`);
    assert.ok(labels.page.includes("{n}") && labels.page.includes("{total}"), `${lang}.page`);
  }
});

test("built-in words differ per language", () => {
  const words = new Set(["en-GB", "ro-RO", "de-DE", "fr-FR"].map((l) => labelsFor(l).invoice));
  assert.deepEqual([...words].sort(), ["Facture", "Factură", "Invoice", "Rechnung"]);
  assert.equal(labelsFor("de-AT").total, labelsFor("de-DE").total);
  assert.equal(labelsFor("fr-BE").amountDue, "Montant dû");
});

test("a report overrides labels; an unknown locale falls back to English", () => {
  assert.equal(labelsFor("ro-RO", { invoice: "Factura fiscală" }).invoice, "Factura fiscală");
  assert.equal(labelsFor("ro-RO", { invoice: "Factura fiscală" }).total, "Total");
  assert.equal(languageOf("RO-ro"), "ro");
  assert.equal(languageOf("ja-JP"), "en");
  assert.equal(labelsFor("ja-JP").invoice, "Invoice");
  // The override reaches label().
  const h = makeHelpers({ locale: "en-GB", currency: "EUR", labels: labelsFor("en-GB", { invoice: "Bill" }) });
  assert.equal(call(h, "label", "invoice"), "Bill");
});

// ── EPC payload (EPC069-12, version 002) ────────────────────────────────────

const IBAN = "DE89 3704 0044 0532 0130 00";

test("epc: an unstructured reference lands on the 11th line", () => {
  const lines = epcPayload("Acme GmbH", IBAN, "123.40", "INV-2026-0001").split("\n");
  assert.deepEqual(lines, ["BCD", "002", "1", "SCT", "", "Acme GmbH", "DE89370400440532013000", "EUR123.40", "", "", "INV-2026-0001"]);
});

test("epc: a structured RF reference lands on the 10th line, spaces removed", () => {
  const lines = epcPayload("Acme GmbH", IBAN, 123.4, "RF18 5390 0754 7034", "cobadeff").split("\n");
  assert.deepEqual(lines, ["BCD", "002", "1", "SCT", "COBADEFF", "Acme GmbH", "DE89370400440532013000", "EUR123.40", "", "RF18539007547034"]);
});

test("epc: the header is always BCD / 002 / 1 / SCT", () => {
  assert.deepEqual(epcPayload("A", IBAN, 1, "x").split("\n").slice(0, 4), ["BCD", "002", "1", "SCT"]);
});

test("epc: amounts are exact, rounded half away from zero to cents, with EUR in front", () => {
  const amount = (a: unknown) => epcPayload("A", IBAN, a, "x").split("\n")[7];
  assert.equal(amount("123.4"), "EUR123.40");
  assert.equal(amount(0.1 + 0.2), "EUR0.30");
  assert.equal(amount("1234.565"), "EUR1234.57");
  assert.equal(amount("0.005"), "EUR0.01");
  assert.equal(amount("1000000"), "EUR1000000.00");
  // An amount of zero is an open amount: the line is left empty.
  assert.equal(amount(0), "");
  assert.equal(amount("0.004"), "");
});

test("epc: the IBAN is stripped and upper-cased; name and reference lose their line breaks", () => {
  const lines = epcPayload("  Acme\nGmbH  ", "de89 3704 0044 0532 0130 00", 5, "line one\nline two").split("\n");
  assert.equal(lines[5], "Acme GmbH");
  assert.equal(lines[6], "DE89370400440532013000");
  assert.equal(lines[10], "line one line two");
});

test("epc: limits — name 70 characters, unstructured reference 140", () => {
  const lines = epcPayload("N".repeat(100), IBAN, 5, "r".repeat(300)).split("\n");
  assert.equal(lines[5]!.length, 70);
  assert.equal(lines[10]!.length, 140);
});

test("epc: a missing name, a bad IBAN and a non-number are refused", () => {
  assert.throws(() => epcPayload("", IBAN, 1, "x"), /beneficiary's name/);
  assert.throws(() => epcPayload(undefined, IBAN, 1, "x"), /beneficiary's name/);
  assert.throws(() => epcPayload("A", "XX", 1, "x"), /epc\(\) needs an IBAN, got "XX"/);
  assert.throws(() => epcPayload("A", "", 1, "x"), /needs an IBAN/);
  assert.throws(() => epcPayload("A", IBAN, "lots", "x"), /epc\(\) needs a number/);
});

test("epc: the amount stays within EPC069-12's 999999999.99", () => {
  assert.throws(() => epcPayload("A", IBAN, "1000000000", "x"));
});

for (const locale of Object.keys(EXPECT) as Locale[]) {
  test(`${locale}: epc() through the helper set, in a EUR document`, () => {
    const h = helpers(locale, "EUR");
    assert.equal(call(h, "epc", "Acme GmbH", IBAN, "123.40", "INV-1"), epcPayload("Acme GmbH", IBAN, "123.40", "INV-1"));
  });
}

test("epc() refuses a document that is not in EUR", () => {
  for (const [locale, currency] of [["ro-RO", "RON"], ["en-GB", "GBP"], ["de-CH", "CHF"], ["en-US", "USD"]] as const) {
    const h = makeHelpers({ locale, currency, labels: labelsFor(locale) });
    assert.throws(() => call(h, "epc", "Acme", IBAN, 10, "x"), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, new RegExp(`EUR documents; this one is in ${currency}`));
      assert.match(err.message, /Add when/);
      return true;
    }, currency);
  }
});
