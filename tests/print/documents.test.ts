// Print tests: the six seed documents and every starter, rendered by the real
// renderer (Chromium), asserted on the PDF itself with pdf.js.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DB } from "../../src/db/index.ts";
import { seedDemo } from "../../src/seed.ts";
import { seedReports, type SeededDocument } from "../../src/seed-reports-run.ts";
import { compiledVersion, documentPdf, preview } from "../../src/reports/service.ts";
import { closeBrowser } from "../../src/reports/pdf.ts";
import { declaredFamilies, readPdf, undeclaredFonts, type ReadPdf } from "../../src/reports/preflight.ts";
import { compileReport, PAPER_POINTS } from "../../src/reports/model.ts";
import { computeMoney } from "../../src/reports/money.ts";
import { makeHelpers } from "../../src/reports/helpers.ts";
import { labelsFor } from "../../src/reports/labels.ts";
import type { DocumentRow } from "../../src/reports/store.ts";

const PAGES: Record<string, number> = { invoice: 1, "invoice-ro": 3, letter: 1, "business-report": 3, confirmation: 1 };
const COUNTER: Record<string, (n: number, of: number) => string> = {
  en: (n, of) => `Page ${n} of ${of}`, ro: (n, of) => `Pagina ${n} din ${of}`, de: (n, of) => `Seite ${n} von ${of}`, fr: (n, of) => `Page ${n} sur ${of}`,
};
const norm = (s: string) => s.replace(/[  ]/g, " ");
/** Letter-spaced capitals come out of pdf.js with spaces between letters: compare without spaces. */
const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
const text = (r: ReadPdf, page?: number) => norm((page === undefined ? r.pages : [r.pages[page]!]).flatMap((p) => p.lines.map((l) => l.text)).join("\n"));

describe("seed documents print", () => {
  let dir = "";
  let db: DB;
  let workspace = "";
  let docs: SeededDocument[] = [];
  const read = new Map<string, { pdf: Uint8Array; read: ReadPdf; row: DocumentRow }>();

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "forecraft-print-"));
    db = openDb(join(dir, "print.db"));
    const demo = await seedDemo(db, { quiet: true, password: "print-password-1" });
    workspace = demo.workspaceId;
    docs = await seedReports(db, workspace, { quiet: true });
    for (const d of docs) {
      const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(d.document.id) as unknown as DocumentRow;
      const { pdf } = await documentPdf(db, row);
      read.set(d.name, { pdf, read: await readPdf(pdf), row });
    }
  });
  after(async () => { await closeBrowser(); db.close(); rmSync(dir, { recursive: true, force: true }); });

  test("all six documents were issued", () => {
    assert.deepEqual(docs.map((d) => d.name).sort(), ["business-report", "confirmation", "invoice", "invoice-ro", "letter", "survey-summary"]);
  });

  test("page size and page count", () => {
    for (const [name, { read: r, row }] of read) {
      const report = compiledVersion(db, row.report_id, row.version);
      const paper = PAPER_POINTS[report.appearance.paper];
      for (const p of r.pages) {
        assert.ok(Math.abs(p.width - paper.width) <= 0.5, `${name}: width ${p.width}`);
        assert.ok(Math.abs(p.height - paper.height) <= 0.5, `${name}: height ${p.height}`);
      }
      if (PAGES[name]) assert.equal(r.pages.length, PAGES[name], `${name} page count`);
      else assert.ok(r.pages.length >= 1);
    }
  });

  test("the number, the total and the counterparty are in the text", () => {
    for (const [name, { read: r, row }] of read) {
      const all = text(r);
      assert.ok(all.includes(row.number!), `${name}: number ${row.number}`);
      const report = compiledVersion(db, row.report_id, row.version);
      const data = JSON.parse(row.data);
      if (report.definition.money) {
        const m = computeMoney(data, report.definition.money, row.currency ?? report.appearance.currency);
        const h = makeHelpers({ locale: row.locale, currency: m.currency, labels: labelsFor(row.locale) });
        assert.ok(all.includes(norm(h.money!(m.total) as string)), `${name}: total ${m.total}`);
      }
      const counterparty = data.customer?.name ?? data.recipient?.name ?? data.company ?? data.fullName ?? data.form?.title;
      if (counterparty) assert.ok(all.includes(counterparty), `${name}: counterparty ${counterparty}`);
    }
  });

  test("the localised page counter is on every page", () => {
    for (const [name, { read: r, row }] of read) {
      const say = COUNTER[row.locale.split("-")[0]!]!;
      r.pages.forEach((_p, i) => assert.ok(text(r, i).includes(say(i + 1, r.pages.length)), `${name} page ${i + 1}: ${say(i + 1, r.pages.length)}`));
    }
  });

  test("table headers repeat on every page that has rows; rows never split; totals stay with the last rows", () => {
    const { read: r, row } = read.get("invoice-ro")!;
    const data = JSON.parse(row.data) as { items: { description: string }[] };
    const descriptions = new Set(data.items.map((i) => i.description));
    r.pages.forEach((p, i) => {
      const lines = p.lines.map((l) => norm(l.text));
      const hasRows = lines.some((l) => [...descriptions].some((d) => l.startsWith(d)));
      if (hasRows) assert.ok(lines.some((l) => /^DESCRIERE\b/.test(l) && l.includes("VALOARE")), `page ${i + 1} repeats the header`);
      const header = squash(`FACTURĂ FISCALĂ ${row.number} · DUNĂREA`);
      if (i > 0) assert.ok(lines.some((l) => squash(l).includes(header)), `page ${i + 1} has the running header`);
      else assert.ok(!lines.some((l) => squash(l).includes(header)), "no running header on page 1");
    });
    // Every row appears exactly once: none split across pages.
    const rowLines = r.pages.flatMap((p) => p.lines.map((l) => norm(l.text))).filter((l) => [...descriptions].some((d) => l.startsWith(d)));
    assert.equal(rowLines.length, data.items.length);
    const last = r.pages.length - 1;
    const lastRow = data.items.at(-1)!.description;
    const lastRowPage = r.pages.findLastIndex((p) => p.lines.some((l) => norm(l.text).startsWith(lastRow)));
    const totalPage = r.pages.findIndex((p) => p.lines.some((l) => norm(l.text).startsWith("Total de plată")));
    assert.equal(lastRowPage, totalPage, "the total sits on the page of the last rows");
    assert.equal(totalPage, last);
  });

  test("no blank page", () => {
    for (const [name, { read: r }] of read) {
      r.pages.forEach((p, i) => assert.ok(p.lines.length > 3, `${name} page ${i + 1} is not blank`));
    }
  });

  test("embedded fonts are exactly the declared families", () => {
    for (const [name, { read: r, row }] of read) {
      const report = compiledVersion(db, row.report_id, row.version);
      assert.deepEqual(undeclaredFonts(r.fonts, declaredFamilies(report)), [], `${name}: ${r.fonts.join(", ")}`);
      assert.ok(r.fonts.length > 0);
    }
  });

  test("title and language metadata, an outline for the business report, clickable links", () => {
    for (const [name, { read: r, row }] of read) {
      assert.ok(r.title && r.title.includes(row.number!), `${name}: title ${r.title}`);
      assert.equal(r.lang, row.locale, `${name}: language`);
    }
    const br = read.get("business-report")!.read;
    for (const h of ["Executive summary", "Financial performance", "Operations and people", "Risks and outlook"]) {
      assert.ok(br.outline.some((o) => o.includes(h)), `outline has ${h}: ${br.outline.join(" | ")}`);
    }
    // The unpaid invoice prints its terms with a mailto link; the paid one leaves them out.
    const inv = read.get("invoice-ro")!.read;
    assert.ok(inv.links.flat().some((u) => u.startsWith("mailto:")), "the invoice's mailto link is clickable");
  });

  test("money adds up to the cent in the issued invoices' text", () => {
    for (const name of ["invoice", "invoice-ro"]) {
      const { read: r, row } = read.get(name)!;
      const report = compiledVersion(db, row.report_id, row.version);
      const m = computeMoney(JSON.parse(row.data), report.definition.money!, row.currency!);
      const h = makeHelpers({ locale: row.locale, currency: m.currency, labels: labelsFor(row.locale) });
      const all = text(r);
      const fmt = (v: string) => norm(h.money!(v) as string);
      // Line amounts print as figures under a header that names the currency.
      for (const l of m.lines) assert.ok(all.includes(norm(h.number!(l.net, 2) as string)), `${name}: line net ${l.net}`);
      for (const t of m.taxes) if (t.tax !== "0.00") assert.ok(all.includes(fmt(t.tax)) && all.includes(fmt(t.base)), `${name}: tax ${t.rate}%`);
      assert.ok(all.includes(fmt(m.subtotal)) && all.includes(fmt(m.total)));
      const cents = (v: string) => BigInt(v.replace(".", ""));
      assert.equal(m.lines.reduce((s, l) => s + cents(l.net), 0n), cents(m.subtotal));
      assert.equal(m.taxes.reduce((s, t) => s + cents(t.tax), 0n), cents(m.tax));
      assert.equal(cents(m.subtotal) + cents(m.tax), cents(m.total));
    }
  });

  test("the paid invoice carries the SEPA QR and the PAID stamp", () => {
    const all = text(read.get("invoice")!.read);
    assert.ok(/\bPAID\b/i.test(all));
    assert.ok(all.includes("EPC payment code"));
  });

  test("re-rendering gives the same pages and text", async () => {
    for (const name of ["invoice", "letter", "business-report"]) {
      const { row, read: r } = read.get(name)!;
      // A void copy forces a fresh render path; here the cached bytes are bypassed by reading a new print.
      const fresh = { ...row, pdf: null, status: "draft" as const };
      const again = await readPdf((await documentPdf(db, { ...fresh, number: row.number, status: row.status, pdf: null })).pdf);
      assert.equal(again.pages.length, r.pages.length, name);
      assert.equal(text(again), text(r), name);
    }
  });
});

describe("every starter prints with its sample", () => {
  let dir = "";
  let db: DB;
  let workspace = "";
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "forecraft-starters-"));
    db = openDb(join(dir, "s.db"));
    workspace = (await seedDemo(db, { quiet: true, password: "print-password-1" })).workspaceId;
  });
  after(async () => { await closeBrowser(); db.close(); rmSync(dir, { recursive: true, force: true }); });

  const dirStarters = join(import.meta.dirname, "../../src/reports/starters");
  for (const file of readdirSync(dirStarters).filter((f) => f.endsWith(".json"))) {
    test(file, async () => {
      const def = JSON.parse(readFileSync(join(dirStarters, file), "utf8"));
      // A source form must exist in the workspace for summary/submission starters.
      if (def.source?.form) def.source.form = (db.prepare("SELECT id FROM forms WHERE slug = ?").get(def.source.kind === "summary" ? "customer-pulse" : "agents-summit") as { id: string }).id;
      const report = compileReport(def);
      const p = await preview(db, workspace, report, {}, { pdf: true });
      const pf = p.preflight!;
      assert.deepEqual(pf.findings.filter((f) => f.severity === "error"), [], `${file}: ${JSON.stringify(pf.findings)}`);
      const r = pf.read;
      const paper = PAPER_POINTS[report.appearance.paper];
      assert.ok(Math.abs(r.pages[0]!.width - paper.width) <= 0.5);
      const say = COUNTER[report.appearance.locale.split("-")[0]!]!;
      r.pages.forEach((_pg, i) => assert.ok(text(r, i).includes(say(i + 1, r.pages.length)), `${file} counter page ${i + 1}`));
      assert.deepEqual(undeclaredFonts(r.fonts, declaredFamilies(report)), []);
    });
  }
});
