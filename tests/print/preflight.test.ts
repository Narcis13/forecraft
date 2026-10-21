// Preflight catches what it claims (Acceptance 7): a definition seeded with six
// faults gets exactly those findings, with the right block ids; after the fixes
// it is clean; and issue is refused while an error stands.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DB } from "../../src/db/index.ts";
import { seedDemo } from "../../src/seed.ts";
import { insertAsset } from "../../src/assets/index.ts";
import { compileReport, type ReportDefinition } from "../../src/reports/model.ts";
import { createDocument, preview } from "../../src/reports/service.ts";
import { closeBrowser, printPdf } from "../../src/reports/pdf.ts";
import { createReport, publishReport, getReport } from "../../src/reports/store.ts";
import { Problem } from "../../src/api/http.ts";

let dir = "";
let db: DB;
let ws = "";
let lowres = "";
let sharp = "";

/** A PNG of w × h pixels, drawn in Chromium (no image library). */
async function png(w: number, h: number): Promise<Uint8Array> {
  const html = `<!doctype html><title>png</title><canvas id=c width=${w} height=${h}></canvas>`;
  const out = await printPdf(html, { probe: `const c = document.getElementById("c"); const x = c.getContext("2d"); x.fillStyle = "#14532d"; x.fillRect(0, 0, ${w}, ${h}); return c.toDataURL("image/png");` });
  return Buffer.from(String(out.layout).split(",")[1]!, "base64");
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "forecraft-preflight-"));
  db = openDb(join(dir, "p.db"));
  ws = (await seedDemo(db, { quiet: true, password: "print-password-1" })).workspaceId;
  // Printed 11 mm high: 31 px is ~72 dpi, 700 px is well over 200.
  lowres = insertAsset(db, ws, await png(110, 31), "lowres.png").id;
  sharp = insertAsset(db, ws, await png(2400, 700), "sharp.png").id;
});
after(async () => { await closeBrowser(); db.close(); rmSync(dir, { recursive: true, force: true }); });

function bad(): ReportDefinition {
  const def = JSON.parse(readFileSync(join(import.meta.dirname, "../../src/reports/starters/invoice.json"), "utf8")) as ReportDefinition;
  def.layout[0]!.logo = `asset:${lowres}`;
  (def.layout[0]!.lines as string[]).push("Fax {{ seller.fax }}"); // a missing path
  const table = def.layout.find((b) => b.id === "items")!;
  (table.columns as unknown[]).push(
    { label: "Unit", value: "{{ row.unit ?? \"\" }}" },
    { label: "Net", value: "{{ money(line.net) }}", format: "currency" },
    { label: "Tax", value: "{{ money(line.tax) }}", format: "currency" },
    { label: "Gross", value: "{{ money(line.gross) }}", format: "currency" },
  ); // nine columns, portrait
  // 2433 bytes: more than a QR code holds at error correction M (2331, version 40).
  def.schema.properties.checkout = { type: "string" };
  def.sample.checkout = "https://pay.example.com/checkout?" + "a=1&".repeat(600);
  const at = def.layout.findIndex((b) => b.id === "payment");
  def.layout.splice(at, 0,
    { id: "refs", block: "facts", cols: "2", items: [{ label: "Mandate", value: "SEPA-MANDATE-" + "X".repeat(67) }, { label: "Contract", value: "MSA-2025-03" }] }, // 80 unbreakable characters
    { id: "long-qr", block: "qr", value: "{{ checkout }}", caption: "Pay" }, // too long for the QR recipe
    { id: "annex", block: "section", title: "Annex: service levels", blocks: [] }, // a heading that ends a page
    { id: "annex-break", block: "page-break" },
  );
  return def;
}

function fixed(): ReportDefinition {
  const def = bad();
  def.layout[0]!.logo = `asset:${sharp}`;
  (def.layout[0]!.lines as string[]).pop();
  const table = def.layout.find((b) => b.id === "items")!;
  (table.columns as unknown[]).splice(5);
  const refs = def.layout.find((b) => b.id === "refs")!;
  (refs.items as { value: string }[])[0]!.value = "SEPA-2026-0091";
  def.layout.find((b) => b.id === "long-qr")!.value = "https://pay.example.com/i/0042";
  def.layout = def.layout.filter((b) => b.id !== "annex-break");
  def.layout.find((b) => b.id === "annex")!.blocks = [{ id: "annex-text", block: "text", markdown: "Response within four business hours, every weekday." }];
  return def;
}

test("the seeded definition gets exactly its six findings, with the right block ids", async () => {
  const p = await preview(db, ws, compileReport(bad()), {}, { pdf: true });
  const got = p.preflight!.findings.map((f) => `${f.code}:${f.block}`).sort();
  assert.deepEqual(got, [
    "image-resolution:letterhead",
    "missing-data:letterhead",
    "orphan-heading:annex",
    "overflow:refs",
    "qr-capacity:long-qr",
    "too-many-columns:items",
  ], JSON.stringify(p.preflight!.findings, null, 1));
});

test("after the fixes it is clean", async () => {
  const p = await preview(db, ws, compileReport(fixed()), {}, { pdf: true });
  assert.deepEqual(p.preflight!.findings, []);
});

test("issue is refused while an error stands, and allowed once fixed", async () => {
  const row = createReport(db, ws, bad(), "invoice");
  publishReport(db, row);
  const published = getReport(db, ws, row.id)!;
  const data = bad().sample;
  await assert.rejects(createDocument(db, ws, published, { data, issue: true }), (err: unknown) => {
    assert.ok(err instanceof Problem);
    assert.equal(err.status, 422);
    assert.equal(err.type.endsWith("preflight-failed"), true);
    return true;
  });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM documents WHERE report_id = ?").get(row.id) as { n: number }).n, 0, "a refused issue leaves no document and uses no number");
  const fixedRow = createReport(db, ws, fixed(), "invoice");
  publishReport(db, fixedRow);
  const { doc } = await createDocument(db, ws, getReport(db, ws, fixedRow.id)!, { data, issue: true });
  assert.match(doc.number!, /^INV-\d{4}-0001$/);
});
