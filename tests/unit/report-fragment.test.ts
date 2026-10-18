import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFragment, FRAGMENT_LIMITS, renderFragment } from "../../src/reports/fragment.ts";
import { makeHelpers } from "../../src/reports/helpers.ts";
import { labelsFor } from "../../src/reports/labels.ts";
import { compileReport, ReportProblem } from "../../src/reports/model.ts";
import { renderReport } from "../../src/reports/render.ts";

const helpers = makeHelpers({ locale: "en-GB", currency: "EUR", labels: labelsFor("en-GB") });

const CALLOUT = '+callout(variant="muted")\n  @content\n    p {{ note }}';

/** The diagnostics a source is refused with (fails the test when it compiles). */
function refused(source: string) {
  const r = compileFragment(source);
  assert.equal(r.ast, null, `expected ${JSON.stringify(source)} to be refused`);
  assert.ok(r.diagnostics.length > 0);
  return r.diagnostics;
}

const codes = (source: string) => refused(source).map((d) => d.code);

// ── What is accepted ────────────────────────────────────────────────────────

test("a legitimate callout component compiles", () => {
  const r = compileFragment(CALLOUT);
  assert.ok(r.ast);
  assert.deepEqual(r.diagnostics, []);
});

test("plain elements, loops and conditions compile", () => {
  for (const source of ["p hello", "p {{ money(5) }} and {{ label(\"invoice\") }}", "each r in xs\n  p {{ r }}", "if x\n  p yes\nelse\n  p no"]) {
    assert.ok(compileFragment(source).ast, source);
  }
});

test("an empty fragment compiles to nothing", () => {
  assert.ok(compileFragment("").ast);
  assert.equal(renderFragment("", {}, helpers).trim(), "");
});

test("the same source compiles to the same AST (cached)", () => {
  assert.equal(compileFragment("p cached").ast, compileFragment("p cached").ast);
});

test("a component is checked against its manifest: a value outside its list is refused", () => {
  assert.deepEqual(codes('+callout(variant="nonsense")\n  @content\n    p hi'), ["bad-value"]);
});

// ── What is refused ─────────────────────────────────────────────────────────

test("raw is refused (raw-refused), with a line and column", () => {
  const [d] = refused('div\n  raw "<b>x</b>"');
  assert.equal(d!.code, "raw-refused");
  assert.equal(d!.line, 2);
  assert.ok(d!.column > 0);
});

test("a style attribute is refused (refused-style), whatever its case", () => {
  const [d] = refused('div(style="color:red")\n  p hi');
  assert.equal(d!.code, "refused-style");
  assert.equal(d!.line, 1);
  assert.ok(d!.column > 0);
  assert.match(d!.message, /style/);
  assert.deepEqual(codes('div(Style="color:red")\n  p hi'), ["refused-style"]);
});

test("a class attribute is refused (refused-class), on elements and on components", () => {
  assert.deepEqual(codes('div(class="x")\n  p hi'), ["refused-class"]);
  assert.deepEqual(codes('div(CLASS="x")\n  p hi'), ["refused-class"]);
  assert.deepEqual(codes('+callout(variant="muted", class="x")\n  @content\n    p hi'), ["refused-class"]);
});

test("style and class are found inside conditions, else branches and loops", () => {
  assert.deepEqual(codes('if x\n  div(style="a")\n    p hi'), ["refused-style"]);
  assert.deepEqual(codes('if x\n  p hi\nelse\n  div(style="a")\n    p hi'), ["refused-style"]);
  assert.deepEqual(codes('each r in xs\n  div(class="a")\n    p {{ r }}'), ["refused-class"]);
});

test("an unknown component is refused (unknown-component) and named", () => {
  const [d] = refused("+nonesuch()\n  p hi");
  assert.equal(d!.code, "unknown-component");
  assert.match(d!.message, /nonesuch/);
  assert.deepEqual(codes('+nonesuch(variant="x")'), ["unknown-component"]);
});

test("client directives are refused: l-*, @event, :bind and x-*", () => {
  assert.deepEqual(codes('div(l-show="open")\n  p hi'), ["refused-directive"]);
  assert.deepEqual(codes('div(@click="go()")\n  p hi'), ["refused-directive"]);
  assert.deepEqual(codes('div(:hidden="x")\n  p hi'), ["refused-directive"]);
  assert.deepEqual(codes('div(x-data="{}")'), ["refused-directive"]);
  assert.match(refused('div(l-show="open")')[0]!.message, /client directives are not allowed/);
});

test("inline event handlers are refused", () => {
  assert.deepEqual(codes('div(onclick="x()")'), ["event-attr"]);
});

test("elements that load or run something are refused (refused-element)", () => {
  const tags = ["script", "style", "iframe", "frame", "frameset", "object", "embed", "link", "meta", "base", "form", "input", "button", "select", "textarea", "template", "noscript", "svg", "math", "video", "audio", "img", "picture", "source"];
  for (const tag of tags) {
    const [d] = refused(`${tag}(data-x="1")`);
    assert.equal(d!.code, "refused-element", tag);
    assert.match(d!.message, new RegExp(`<${tag}>`));
  }
  // A script with a body is refused as well, whichever diagnostic wins.
  assert.ok(codes('script "alert(1)"').length > 0);
  assert.ok(codes("script\n  alert(1)").length > 0);
  assert.ok(codes("iframe(src=\"https://example.com\")").includes("refused-element"));
});

test("an include is refused", () => {
  const found = codes('include "reports/md.faqir"');
  assert.ok(found.every((c) => c === "include-refused" || c === "no-loader"), JSON.stringify(found));
});

test("an unknown helper and a bad expression are refused with a position", () => {
  const [unknown] = refused("p {{ nope(1) }}");
  assert.equal(unknown!.code, "unknown-helper");
  const [bad] = refused("p {{ 1 + }}");
  assert.equal(bad!.line, 1);
  assert.ok(bad!.column > 0);
});

test("a source over 8 KB is refused (too-large), counted in bytes", () => {
  assert.equal(FRAGMENT_LIMITS.bytes, 8 * 1024);
  assert.ok(compileFragment("p " + "x".repeat(8190)).ast, "exactly 8192 bytes is fine");
  assert.deepEqual(codes("p " + "x".repeat(8191)), ["too-large"]);
  // 4100 two-byte characters are 8200 bytes, though only 4102 characters.
  assert.deepEqual(codes("p " + "é".repeat(4100)), ["too-large"]);
  assert.match(refused("p " + "x".repeat(9000))[0]!.message, /at most 8192 bytes/);
});

test("a refused source is not cached as accepted", () => {
  const source = 'div(style="color:red")\n  p cached-refusal';
  assert.deepEqual(codes(source), ["refused-style"]);
  assert.deepEqual(codes(source), ["refused-style"]);
});

// ── Rendering ───────────────────────────────────────────────────────────────

test("renderFragment draws the component and escapes data", () => {
  const html = renderFragment(CALLOUT, { note: '<script>alert(1)</script> & "quotes"' }, helpers);
  assert.match(html, /data-ui="callout"/);
  assert.match(html, /data-variant="muted"/);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<b>"));
});

test("renderFragment escapes every item of a loop", () => {
  const html = renderFragment("each r in xs\n  p {{ r }}", { xs: ["<b>x</b>", "&", "ok"] }, helpers);
  assert.equal((html.match(/<p>/g) ?? []).length, 3);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;") && html.includes("&amp;") && html.includes("ok"));
  assert.ok(!html.includes("<b>"));
});

test("the document's helpers are in scope", () => {
  assert.match(renderFragment('p {{ money(5) }} {{ label("invoice") }} {{ upper("ab") }}', {}, helpers), /€5\.00 Invoice AB/);
});

test("the engine's page-level requires comment is not part of a fragment", () => {
  assert.ok(!renderFragment(CALLOUT, { note: "x" }, helpers).includes("@ui:requires"));
});

test("renderFragment refuses what compileFragment refuses", () => {
  assert.throws(() => renderFragment('div(style="color:red")\n  p hi', {}, helpers), /style/);
  assert.throws(() => renderFragment("+nonesuch()", {}, helpers), /nonesuch/);
  assert.throws(() => renderFragment("p " + "x".repeat(9000), {}, helpers), /at most 8192 bytes/);
});

test("a value the data does not have is a render error, not an empty string", () => {
  assert.throws(() => renderFragment("p {{ missing }}", {}, helpers), (err: unknown) => {
    assert.equal((err as { code?: string }).code, "missing");
    assert.match((err as Error).message, /missing is missing/);
    return true;
  });
  assert.equal(renderFragment("p {{ missing ?? \"fallback\" }}", {}, helpers).trim(), "<p>fallback</p>");
});

test("an unsafe URL in a link is stopped by the engine at render time", () => {
  assert.throws(() => renderFragment('a(href="javascript:alert(1)") hi', {}, helpers), /unsafe URL scheme/);
  assert.match(renderFragment('a(href="https://example.com") hi', {}, helpers), /href="https:\/\/example\.com"/);
});

// ── As a block in a report ──────────────────────────────────────────────────

function reportWith(source: string) {
  return {
    schema: { type: "object", title: "Fragment test", properties: { note: { type: "string" } } },
    sample: { note: "<script>alert(1)</script> hello" },
    layout: [{ id: "custom", block: "faqir", source }],
  };
}

test("a faqir block with a legitimate fragment compiles and renders, data escaped", () => {
  const report = compileReport(reportWith(CALLOUT));
  const out = renderReport({ report, data: report.definition.sample, doc: { number: "F-1", status: "issued", issuedAt: "2026-10-19" } });
  assert.deepEqual(out.findings, []);
  assert.ok(out.html.includes('data-ui="callout"'));
  assert.ok(out.html.includes("&lt;script&gt;alert(1)&lt;/script&gt; hello"));
  assert.ok(!out.html.includes("<script>"));
});

test("every refusal shows up as a 422 at the block's source pointer", () => {
  const expected: [string, string][] = [
    ['div(style="x")\n  p hi', "refused-style"],
    ['div(class="x")\n  p hi', "refused-class"],
    ["+nonesuch()", "unknown-component"],
    ['div(l-show="x")', "refused-directive"],
    ["iframe(src=\"x\")", "refused-element"],
    ['div\n  raw "x"', "raw-refused"],
    ["p " + "x".repeat(9000), "too-large"],
  ];
  for (const [source, code] of expected) {
    assert.throws(() => compileReport(reportWith(source)), (err: unknown) => {
      assert.ok(err instanceof ReportProblem);
      assert.ok(err.errors.every((e) => e.pointer === "/layout/0/source"));
      assert.ok(err.errors.some((e) => e.code === code), `${code}: ${JSON.stringify(err.errors)}`);
      return true;
    }, code);
  }
});

test("a missing value in a faqir block becomes a finding on the block, not a crash", () => {
  const report = compileReport(reportWith("p {{ gone }}"));
  const out = renderReport({ report, data: report.definition.sample, doc: { number: "F-2", status: "issued", issuedAt: null } });
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0]!.severity, "error");
  assert.equal(out.findings[0]!.block, "custom");
});
