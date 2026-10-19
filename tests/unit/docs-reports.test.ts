import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileReport, dataErrors } from "../../src/reports/model.ts";
import { computeMoney } from "../../src/reports/money.ts";

const DOCS = join(import.meta.dirname, "../../docs");
const STARTERS = join(import.meta.dirname, "../../src/reports/starters");

test("the invoice curl sequence's data is valid for the invoice starter, and its money adds up", () => {
  const md = readFileSync(join(DOCS, "for-agents.md"), "utf8");
  const raw = /DATA='(\{[\s\S]*?\n\})'/.exec(md);
  assert.ok(raw, "for-agents.md defines DATA");
  const data = JSON.parse(raw![1]!);
  const starter = JSON.parse(readFileSync(join(STARTERS, "invoice.json"), "utf8"));
  const report = compileReport(starter);
  assert.deepEqual(dataErrors(report.rules, data), []);
  const m = computeMoney(data, starter.money, "EUR");
  assert.equal(m.subtotal, "1445.50");
  assert.equal(m.total, "1734.60");
});

test("the reports docs name every block and every preflight code", async () => {
  const md = readFileSync(join(DOCS, "reports.md"), "utf8");
  const { BLOCK_NAMES } = await import("../../src/reports/model.ts");
  const { PREFLIGHT_CODES } = await import("../../src/reports/preflight.ts");
  for (const b of BLOCK_NAMES) assert.ok(md.includes(`#### \`${b}\``), `block ${b} is documented`);
  for (const c of PREFLIGHT_CODES) assert.ok(md.includes(`\`${c.code}\``), `code ${c.code} is documented`);
});
