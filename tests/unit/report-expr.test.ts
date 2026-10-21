// What forecraft adds to the expression language (UX audit #32–#34): list
// literals, question("name"), and guards that check before they read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExpr, checkText, evalExpr, evalText, MissingData } from "../../src/reports/expr.ts";
import { makeHelpers } from "../../src/reports/helpers.ts";
import { labelsFor } from "../../src/reports/labels.ts";
import { compileReport } from "../../src/reports/model.ts";
import { renderReport } from "../../src/reports/render.ts";

const helpers = makeHelpers({ locale: "en-GB", currency: "EUR", labels: labelsFor("en-GB") });
const questions = [{ name: "seats", title: "Seats", mean: 3.8, options: [] }, { name: "payment", title: "Payment", options: [{ label: "Card" }, { label: "Invoice" }] }];
const scope = { questions, __q: { seats: questions[0], payment: questions[1] } };
const text = (t: string) => evalText(t, scope, helpers);

test("a guarded expression is not missing data: ternary, &&, || and !", () => {
  assert.equal(text('{{ questions[5] ? number(questions[5].mean, 1) : "—" }}'), "—");
  assert.equal(text('{{ questions[0] ? number(questions[0].mean, 1) : "—" }}'), "3.8");
  assert.equal(text('{{ questions[5] && questions[5].mean ? "yes" : "no" }}'), "no");
  assert.equal(text('{{ questions[5].title || "untitled" }}'), "untitled");
  assert.equal(text('{{ !questions[5] ? "none" : "some" }}'), "none");
  // Unguarded, a missing value is still missing.
  assert.throws(() => text("{{ number(questions[5].mean, 1) }}"), MissingData);
});

test("list literals: [] and [a, b], also as a ?? fallback", () => {
  assert.deepEqual(checkExpr("questions[3].options ?? []"), []);
  assert.deepEqual(evalExpr("questions[3].options ?? []", scope, helpers), []);
  assert.deepEqual(evalExpr("[1, \"two\", questions[0].mean]", scope, helpers), [1, "two", 3.8]);
  assert.equal(text('{{ count(questions[1].options ?? []) }} · {{ join(["a", "b"], " / ") }}'), "2 · a / b");
  assert.equal(text("{{ questions[1].options[1].label }}"), "Invoice", "indexing is untouched");
  assert.equal(text('{{ "[not a list]" }}'), "[not a list]", "brackets in strings are text");
});

test("question(\"name\") reads a summary question by name, like a path", () => {
  assert.equal(text('{{ number(question("seats").mean, 1) }}'), "3.8");
  assert.equal(text("{{ question('payment').options[0].label }}"), "Card");
  assert.equal(text('{{ question("nope").mean ?? "—" }}'), "—");
  assert.equal(text('{{ question("nope") ? 1 : 2 }}'), "2");
  assert.throws(() => text('{{ question("nope").mean }}'), (err: unknown) => err instanceof MissingData && err.path === 'question("nope").mean');
});

test("diagnostics point at what the author wrote", () => {
  const [d] = checkExpr("a + [1, 2");
  assert.equal(d!.code, "bad-expr");
  assert.equal(d!.column, 10);
  const [t] = checkText('Seats {{ question("seats").mean + }}');
  assert.equal(t!.column, 35);
  assert.deepEqual(checkText('{{ question("seats").mean ?? "—" }}'), []);
});

test("in a rendered report: question() binds by name and doc.title is the report's name", () => {
  const report = compileReport({
    schema: { type: "object", title: "Orders summary", properties: { questions: { type: "array", items: { type: "object", properties: { name: { type: "string" }, mean: { type: "number" } } } } } },
    sample: { questions: [{ name: "seats", mean: 3.8 }] },
    layout: [
      { id: "kpis", block: "stats", items: [{ label: "Seats", value: "{{ number(question(\"seats\").mean, 1) }}" }, { label: "Missing", value: "{{ question(\"x\") ? 1 : \"—\" }}" }] },
      { id: "footer", block: "footer", lines: ["{{ doc.title }} · {{ doc.number ?? label(\"draft\") }}"] },
    ],
  });
  const r = renderReport({ report, data: report.definition.sample, doc: { number: null, status: "draft", issuedAt: "2026-10-01T09:00:00.000Z" } });
  assert.deepEqual(r.findings, []);
  assert.match(r.html, /3\.8/);
  assert.match(r.html, /Orders summary · Draft/);
});

test("a stat whose change printed nothing shows no trend", () => {
  const report = compileReport({
    schema: { type: "object", title: "KPIs", properties: {} }, sample: {},
    layout: [{ id: "kpis", block: "stats", items: [{ label: "Revenue", value: "1", change: "{{ \"\" }}", trend: "up" }] }],
  });
  const r = renderReport({ report, data: {}, doc: { number: "1", status: "issued", issuedAt: "2026-10-01T09:00:00.000Z" } });
  assert.doesNotMatch(r.html, /data-trend/);
});

test("a totals block with its own items renders without money", () => {
  const report = compileReport({
    schema: { type: "object", title: "Totals", properties: { seats: { type: "number" } } }, sample: { seats: 12 },
    layout: [{ id: "sum", block: "totals", items: [{ label: "Seats", value: "{{ number(seats) }}" }, { label: "Total", value: "{{ number(seats * 2) }}", emphasis: true }] }],
  });
  const r = renderReport({ report, data: report.definition.sample, doc: { number: "1", status: "issued", issuedAt: "2026-10-01T09:00:00.000Z" } });
  assert.deepEqual(r.findings, []);
  assert.match(r.html, /Seats/);
  assert.match(r.html, />24</);
});
