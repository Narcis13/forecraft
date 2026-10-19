// Regression tests for the final review: bounded decimals, stale issues, kept
// series, numbers typed by hand, CSS strings from data, SVG namespaces.

import { test } from "node:test";
import assert from "node:assert/strict";
import { newId, now, openDb, type DB } from "../../src/db/index.ts";
import { parseDecimal } from "../../src/reports/money.ts";
import { makeHelpers } from "../../src/reports/helpers.ts";
import { labelsFor } from "../../src/reports/labels.ts";
import { nextNumber } from "../../src/reports/numbering.ts";
import { deleteReport, issueDraft, type DocumentRow } from "../../src/reports/store.ts";
import { compileReport } from "../../src/reports/model.ts";
import { renderReport } from "../../src/reports/render.ts";
import { loadStarter } from "../../src/reports/starters.ts";
import { svgProblems } from "../../src/assets/index.ts";

const failsWith = (status: number) => (err: unknown) => (err as { status?: number }).status === status;

function setup(): { db: DB; workspaceId: string; reportId: string } {
  const db = openDb(":memory:");
  const workspaceId = newId("wsp");
  db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, 'Test', ?)").run(workspaceId, now());
  const reportId = newId("rep");
  db.prepare("INSERT INTO reports (id, workspace_id, definition, created_at, updated_at) VALUES (?, ?, '{}', ?, ?)").run(reportId, workspaceId, now(), now());
  return { db, workspaceId, reportId };
}

function addDocument(db: DB, workspaceId: string, reportId: string, status: "draft" | "issued", number: string | null): DocumentRow {
  const id = newId("doc");
  const at = "2026-10-01T09:00:00.000Z";
  db.prepare(
    `INSERT INTO documents (id, workspace_id, report_id, version, status, number, data, locale, share_token, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, '{"a":1}', 'en', ?, ?, ?)`,
  ).run(id, workspaceId, reportId, status, number, newId("shr"), at, at);
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as unknown as DocumentRow;
}

test("a decimal with a huge exponent or too many digits is refused, at once", () => {
  const t = performance.now();
  for (const v of ["1e-200000", "1e31", "1e-31", "1".repeat(41), "9".repeat(30) + "." + "9".repeat(11)]) assert.equal(parseDecimal(v), null, v);
  assert.ok(performance.now() - t < 50);
  assert.deepEqual(parseDecimal("1e30"), { n: 10n ** 30n, d: 1n });
  assert.deepEqual(parseDecimal("12.5e-2"), { n: 125n, d: 1000n });
  const h = makeHelpers({ locale: "en-GB", currency: "EUR", labels: labelsFor("en-GB") });
  const start = performance.now();
  assert.throws(() => h.number!("1e-200000"), /needs a number/);
  assert.ok(performance.now() - start < 50);
});

test("an automatic sequence steps past a number that was typed by hand", () => {
  const { db, workspaceId, reportId } = setup();
  addDocument(db, workspaceId, reportId, "issued", "1");
  addDocument(db, workspaceId, reportId, "issued", "2");
  assert.equal(nextNumber(db, reportId, { pattern: "{seq}" }, new Date()), "3");
  assert.equal(nextNumber(db, reportId, { pattern: "{seq}" }, new Date()), "4");
});

test("a draft edited while it was being checked is not issued", () => {
  const { db, workspaceId, reportId } = setup();
  const snapshot = addDocument(db, workspaceId, reportId, "draft", null);
  db.prepare("UPDATE documents SET data = '{\"a\":2}', updated_at = ? WHERE id = ?").run("2026-10-01T09:00:01.000Z", snapshot.id);
  assert.throws(() => issueDraft(db, snapshot, { pattern: "{seq}" }, null, () => "t"), (err: unknown) => (err as { status?: number }).status === 409 && /edited while/.test(String((err as { detail?: string }).detail ?? (err as Error).message)));
  const row = db.prepare("SELECT status, number FROM documents WHERE id = ?").get(snapshot.id) as { status: string; number: string | null };
  assert.deepEqual({ ...row }, { status: "draft", number: null });
  // The fresh row issues normally.
  const fresh = db.prepare("SELECT * FROM documents WHERE id = ?").get(snapshot.id) as unknown as DocumentRow;
  assert.equal(issueDraft(db, fresh, { pattern: "{seq}" }, null, () => "t").number, "1");
});

test("a report with issued documents is kept; one with drafts alone can go", () => {
  const { db, workspaceId, reportId } = setup();
  addDocument(db, workspaceId, reportId, "issued", "1");
  assert.throws(() => deleteReport(db, reportId), failsWith(409));
  assert.ok(db.prepare("SELECT 1 FROM reports WHERE id = ?").get(reportId));
  const other = setup();
  addDocument(other.db, other.workspaceId, other.reportId, "draft", null);
  deleteReport(other.db, other.reportId);
  assert.equal(other.db.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n, 0);
});

test("data in the running header cannot end its CSS string", () => {
  const def = loadStarter("invoice");
  const report = compileReport(def);
  const data = structuredClone(def.sample) as { customer: { name: string } };
  data.customer.name = "ACME\r}[data-report-block=totals]{visibility:hidden}\f\"x";
  const r = renderReport({ report, data, doc: { number: "INV-1", status: "issued", issuedAt: "2026-10-01T09:00:00.000Z", locale: "en-GB", currency: "EUR" } });
  const css = /<style data-report-page>([\s\S]*?)<\/style>/.exec(r.html)![1]!;
  const header = /@top-left \{ content: ("(?:[^"\\]|\\.)*");/.exec(css);
  assert.ok(header, "the header is one CSS string");
  assert.ok(!/[\r\f]/.test(header![1]!), "control characters are escaped");
  assert.match(header![1]!, /\\D \}\[data-report-block=totals\]\{visibility:hidden\}\\C \\"x/);
});

test("an SVG script or animated link behind a namespace prefix is refused", () => {
  assert.match(svgProblems('<svg xmlns="http://www.w3.org/2000/svg"><s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script></svg>')!, /script/);
  assert.match(svgProblems('<svg><set attributeName="href" to="javascript:alert(1)"/></svg>')!, /animates/);
  assert.match(svgProblems('<svg><animate attributeName="xlink:href" values="javascript:alert(1)"/></svg>')!, /animates/);
  assert.equal(svgProblems('<svg viewBox="0 0 10 10"><animate attributeName="opacity" values="0;1"/><rect width="10" height="10"/></svg>'), null);
});
