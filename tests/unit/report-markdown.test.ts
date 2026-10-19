import { test } from "node:test";
import assert from "node:assert/strict";
import { compileMarkdown, type MdBlock, type Run } from "../../src/reports/markdown.ts";
import { compileReport, ReportProblem } from "../../src/reports/model.ts";
import { renderReport } from "../../src/reports/render.ts";

/** Compile, expecting success. */
function ok(source: string): { blocks: MdBlock[]; texts: string[] } {
  const r = compileMarkdown(source);
  if ("errors" in r) assert.fail(`expected ${JSON.stringify(source)} to compile, got ${JSON.stringify(r.errors)}`);
  return r;
}

/** Compile, expecting a refusal; the error codes. */
function codes(source: string): string[] {
  const r = compileMarkdown(source);
  if (!("errors" in r)) assert.fail(`expected ${JSON.stringify(source)} to be refused, got ${JSON.stringify(r.blocks)}`);
  return r.errors.map((e) => e.code);
}

const runsOf = (source: string): Run[] => {
  const block = ok(source).blocks[0]!;
  assert.ok("runs" in block, "a block with runs");
  return block.runs;
};

// ── What is accepted ────────────────────────────────────────────────────────

test("a paragraph, and two paragraphs", () => {
  assert.deepEqual(ok("Hello world").blocks, [{ t: "p", runs: [{ text: "Hello world" }] }]);
  assert.deepEqual(ok("One\n\nTwo").blocks, [{ t: "p", runs: [{ text: "One" }] }, { t: "p", runs: [{ text: "Two" }] }]);
});

test("a soft line break is a space; two trailing spaces are a break run", () => {
  assert.deepEqual(runsOf("line one\nline two"), [{ text: "line one line two" }]);
  assert.deepEqual(runsOf("line one  \nline two"), [{ text: "line one" }, { text: "", br: true }, { text: "line two" }]);
});

test("headings: levels 1 and 2 are h3, levels 3 to 6 are h4", () => {
  const blocks = ok("# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six").blocks;
  assert.deepEqual(blocks.map((b) => b.t), ["h3", "h3", "h4", "h4", "h4", "h4"]);
  assert.deepEqual((blocks[0] as { runs: Run[] }).runs, [{ text: "One" }]);
});

test("a bullet list and a numbered list", () => {
  assert.deepEqual(ok("- a\n- b").blocks, [{ t: "ul", items: [[{ text: "a" }], [{ text: "b" }]] }]);
  assert.deepEqual(ok("1. one\n2. two").blocks, [{ t: "ol", items: [[{ text: "one" }], [{ text: "two" }]] }]);
});

test("lists are flat: a nested list's items follow their parent", () => {
  const list = ok("- a\n- b\n  - c\n- d").blocks[0] as { t: string; items: Run[][] };
  assert.equal(list.t, "ul");
  assert.deepEqual(list.items.map((i) => i.map((r) => r.text).join("")), ["a", "b", "c", "d"]);
});

test("bold, italic, code and link runs; strikethrough keeps its text", () => {
  const runs = runsOf("Some **bold** and *italic* and `code` and [link](https://example.com) and ~~gone~~.");
  assert.deepEqual(runs, [
    { text: "Some " },
    { b: true, text: "bold" },
    { text: " and " },
    { i: true, text: "italic" },
    { text: " and " },
    { code: true, text: "code" },
    { text: " and " },
    { href: "https://example.com", text: "link" },
    { text: " and gone." },
  ]);
});

test("bold inside italic, and ***both***", () => {
  assert.deepEqual(runsOf("***both***"), [{ i: true, b: true, text: "both" }]);
  assert.deepEqual(runsOf("*a **b** c*"), [{ i: true, text: "a " }, { i: true, b: true, text: "b" }, { i: true, text: " c" }]);
});

test("runs with the same style are merged", () => {
  assert.equal(runsOf("plain text, all one run").length, 1);
  assert.equal(runsOf("**one** **two**").filter((r) => r.b).length, 2);
});

test("links: https, http, mailto and tel are kept", () => {
  const runs = runsOf("[a](https://a.example) [b](http://b.example) [c](mailto:c@example.com) [d](tel:+40123456)");
  assert.deepEqual(runs.filter((r) => r.href).map((r) => r.href), ["https://a.example", "http://b.example", "mailto:c@example.com", "tel:+40123456"]);
  assert.deepEqual(runsOf("[HTTPS](HTTPS://EXAMPLE.COM)").map((r) => r.href), ["HTTPS://EXAMPLE.COM"]);
});

test("quotes and fenced code become paragraphs; a rule disappears; empty is empty", () => {
  assert.deepEqual(ok("> quoted words").blocks, [{ t: "p", runs: [{ text: "quoted words" }] }]);
  assert.deepEqual(ok("```\nline 1\nline 2\n```").blocks, [{ t: "p", runs: [{ text: "line 1 line 2", code: true }] }]);
  assert.deepEqual(ok("---").blocks, []);
  assert.deepEqual(ok("").blocks, []);
  assert.deepEqual(ok("\n\n").blocks, []);
});

// ── Holes survive ───────────────────────────────────────────────────────────

test("holes survive as holes, in the run text and in the texts list for checking", () => {
  const r = ok("Hi {{ customer.name }}, your total is {{ money(doc.money.total) }}.");
  assert.deepEqual(r.blocks, [{ t: "p", runs: [{ text: "Hi {{ customer.name }}, your total is {{ money(doc.money.total) }}." }] }]);
  assert.deepEqual(r.texts, ["Hi {{ customer.name }}, your total is {{ money(doc.money.total) }}."]);
});

test("`{{ a * b }}` is not turned into emphasis", () => {
  assert.deepEqual(runsOf("Total {{ a * b }} units"), [{ text: "Total {{ a * b }} units" }]);
  assert.deepEqual(runsOf("{{ a * b }} * {{ c * d }}"), [{ text: "{{ a * b }} * {{ c * d }}" }]);
  assert.deepEqual(runsOf("{{ a * b * c }}"), [{ text: "{{ a * b * c }}" }]);
});

test("underscores inside a hole are not emphasis either", () => {
  assert.deepEqual(runsOf("{{ snake_case_name }} and _em_"), [{ text: "{{ snake_case_name }} and " }, { i: true, text: "em" }]);
});

test("a hole inside bold, italic, code and a link keeps both the style and the hole", () => {
  assert.deepEqual(runsOf("**{{ y }}**"), [{ b: true, text: "{{ y }}" }]);
  assert.deepEqual(runsOf("*{{ a * b }}*"), [{ i: true, text: "{{ a * b }}" }]);
  assert.deepEqual(runsOf("`{{ x }}`"), [{ code: true, text: "{{ x }}" }]);
  const link = runsOf("[{{ customer.name }}]({{ customer.url }})");
  assert.deepEqual(link, [{ href: "{{ customer.url }}", text: "{{ customer.name }}" }]);
});

test("a hole in a list item and a heading", () => {
  assert.deepEqual(ok("- {{ a * b }} apples").blocks, [{ t: "ul", items: [[{ text: "{{ a * b }} apples" }]] }]);
  assert.deepEqual(ok("## Total {{ a * b }}").blocks, [{ t: "h3", runs: [{ text: "Total {{ a * b }}" }] }]);
});

test("a hole may span lines in the source and stays one hole", () => {
  const r = ok("Pay {{ money(\n  doc.money.due) }} now");
  assert.equal(r.blocks.length, 1);
  assert.ok(JSON.stringify(r.blocks).includes("{{ money("));
});

test("texts carries every link target, so a bad hole in an href is checked too", () => {
  assert.deepEqual(ok("[docs]({{ url }})").texts, ["docs", "{{ url }}"]);
});

// ── What is refused ─────────────────────────────────────────────────────────

test("HTML is refused, block and inline", () => {
  assert.deepEqual(codes("<div>\nblock\n</div>"), ["html-refused"]);
  assert.deepEqual(codes("<script>alert(1)</script>"), ["html-refused"]);
  assert.ok(codes("text with <b>bold</b> html").every((c) => c === "html-refused"));
  assert.ok(codes("<b>x</b>").length >= 1);
  assert.deepEqual(codes("<!-- a comment -->\n\ntext"), ["html-refused"]);
  assert.match((compileMarkdown("<b>x</b>") as { errors: { detail: string }[] }).errors[0]!.detail, /HTML is not allowed in markdown/);
});

test("HTML is refused inside list items, headings and emphasis", () => {
  assert.ok(codes("- item <i>x</i>").includes("html-refused"));
  assert.ok(codes("# Title <u>x</u>").includes("html-refused"));
  assert.ok(codes("**bold <br> text**").includes("html-refused"));
});

test("links other than http(s), mailto and tel are refused", () => {
  for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hi", "vbscript:x", "/relative", "//evil.example/x", "file:///etc/passwd", "ftp://x.example"]) {
    assert.deepEqual(codes(`[x](${url})`), ["unsafe-url"], url);
  }
});

test("images are refused", () => {
  assert.deepEqual(codes("![alt](https://example.com/y.png)"), ["image-refused"]);
  assert.deepEqual(codes("text ![alt](data:image/png;base64,AAAA) more"), ["image-refused"]);
});

test("tables are refused", () => {
  assert.deepEqual(codes("| a | b |\n|---|---|\n| 1 | 2 |"), ["table-refused"]);
});

test("every problem in the source is reported, not just the first", () => {
  assert.deepEqual(codes("<b>x</b>\n\n[x](javascript:1)\n\n![i](https://x/y.png)").sort(), ["html-refused", "html-refused", "image-refused", "unsafe-url"]);
});

test("a link with a scheme-less hole target is left to the render-time allow-list", () => {
  // The URL is only known once the data is, so compile cannot judge it: the engine's own allow-list does, when it renders.
  assert.doesNotThrow(() => ok("[docs]({{ url }})"));
});

test("a literal `javascript:` in front of a hole is refused at save time", () => {
  assert.deepEqual(codes("[x](javascript:{{ y }})"), ["unsafe-url"]);
});

test("a bad hole inside a fenced code block is checked at save time", () => {
  assert.throws(() => compileReport(textReport("```\nHi {{ note\n```")), (err: unknown) => err instanceof ReportProblem && err.errors.some((e) => e.code === "bad-hole"));
});

// ── Through the model: save-time checks of the same text ────────────────────

function textReport(markdown: string, sample: Record<string, unknown> = { note: "plain", url: "https://example.com" }, block = "text") {
  return {
    schema: { type: "object", title: "Markdown test", properties: { note: { type: "string" }, url: { type: "string" } } },
    sample,
    layout: [{ id: "t", block, markdown }],
  };
}

test("compileReport keeps the compiled markdown keyed by its source", () => {
  const compiled = compileReport(textReport("**hello** {{ note }}"));
  assert.deepEqual(compiled.markdown.get("**hello** {{ note }}"), [{ t: "p", runs: [{ b: true, text: "hello" }, { text: " {{ note }}" }] }]);
});

test("compileReport reports markdown refusals at the block's markdown pointer", () => {
  for (const [md, code] of [["<b>x</b>", "html-refused"], ["[x](javascript:alert(1))", "unsafe-url"], ["![a](https://x/y.png)", "image-refused"], ["| a |\n|---|\n| 1 |", "table-refused"]] as const) {
    assert.throws(() => compileReport(textReport(md)), (err: unknown) => {
      assert.ok(err instanceof ReportProblem);
      assert.ok(err.errors.every((e) => e.pointer === "/layout/0/markdown"));
      assert.ok(err.errors.some((e) => e.code === code), md);
      return true;
    });
  }
});

test("compileReport also checks the holes inside the markdown", () => {
  assert.throws(() => compileReport(textReport("Hello {{ nope(1) }}")), (err: unknown) => err instanceof ReportProblem && err.errors[0]!.code === "unknown-helper");
  assert.throws(() => compileReport(textReport("Hello [x]({{ url")), (err: unknown) => err instanceof ReportProblem && err.errors.some((e) => e.code === "bad-hole"));
});

// ── Rendered: data is text, never markup ────────────────────────────────────

const DOC = { number: "MD-1", status: "issued", issuedAt: "2026-10-19" } as const;

/** Render a one-block report and return the HTML of that block. */
function blockHtml(markdown: string, data: Record<string, unknown>, block = "text"): string {
  const report = compileReport(textReport(markdown, data, block));
  const out = renderReport({ report, data, doc: DOC });
  assert.deepEqual(out.findings, [], JSON.stringify(out.findings));
  const start = out.html.indexOf('data-block="t"');
  assert.ok(start > 0, "the block is in the page");
  return out.html.slice(start, out.html.indexOf("</article>", start));
}

test("data containing <script> and **asterisks** is shown as text, not run and not bold", () => {
  const data = { note: "<script>alert(1)</script> and **not bold**" };
  for (const block of ["text", "callout"]) {
    const html = blockHtml("Note: {{ note }}", data, block);
    assert.ok(html.includes("&lt;script&gt;"), `${block}: escaped script`);
    assert.ok(html.includes("**not bold**"), `${block}: literal asterisks`);
    assert.ok(!html.includes("<script"), `${block}: no script element`);
    assert.ok(!/<strong>\s*not bold/.test(html), `${block}: not bold`);
    assert.ok(!html.includes("<strong>"), `${block}: no strong at all`);
  }
});

test("the whole page carries no script element that data could have added", () => {
  const data = { note: "<script>alert(1)</script>" };
  const report = compileReport(textReport("{{ note }}"));
  const { html } = renderReport({ report, data, doc: DOC });
  assert.ok(!html.includes("<script>"), "a bare <script> would be injected code");
  assert.ok(!html.includes("alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("markup in data is escaped in every context: bold, link text, list item, heading", () => {
  const data = { note: '<img src=x onerror="alert(1)">' };
  const html = blockHtml("**{{ note }}**\n\n[{{ note }}](https://example.com)\n\n- {{ note }}\n\n## {{ note }}", data);
  assert.ok(!html.includes("<img"), "no image element");
  assert.ok(html.includes("&lt;img"), "escaped");
  assert.ok(html.includes("<strong>"), "authored bold is bold");
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes("<li>") && html.includes("<h3>"));
});

test("data that looks like a hole or markdown link is not evaluated again", () => {
  const html = blockHtml("{{ note }}", { note: "{{ 1 + 1 }} [x](javascript:alert(1)) `code` _em_" });
  assert.ok(html.includes("{{ 1 + 1 }}"));
  assert.ok(html.includes("[x](javascript:alert(1))"));
  assert.ok(html.includes("`code`") && html.includes("_em_"));
  assert.ok(!html.includes("<a "), "no link");
  assert.ok(!html.includes("<code>") && !html.includes("<em>"));
});

test("authored emphasis, code and links render as elements", () => {
  const html = blockHtml("**b** *i* `c` [l](https://example.com/{{ note }})", { note: "path" });
  assert.match(html, /<strong>\s*b\s*<\/strong>/);
  assert.match(html, /<em>\s*i\s*<\/em>/);
  assert.match(html, /<code>\s*c\s*<\/code>/);
  assert.match(html, /<a [^>]*href="https:\/\/example\.com\/path"[^>]*>\s*l\s*<\/a>/);
});

test("`{{ a * b }}` renders as the product, not as emphasis", () => {
  const report = compileReport({
    schema: { type: "object", title: "Product", properties: { a: { type: "number" }, b: { type: "number" }, c: { type: "number" }, d: { type: "number" } } },
    sample: { a: 6, b: 7, c: 2, d: 3 },
    layout: [{ id: "t", block: "text", markdown: "{{ a * b }} and {{ c * d }}, so {{ a * b }} * {{ c * d }}" }],
  });
  const out = renderReport({ report, data: report.definition.sample, doc: DOC });
  assert.deepEqual(out.findings, []);
  assert.ok(out.html.includes("42 and 6, so 42 * 6"), "the figures");
  assert.ok(!out.html.includes("<em>"));
});

test("a value with blank lines becomes paragraphs, and a single newline a line break", () => {
  const html = blockHtml("{{ note }}", { note: "first\n\nsecond\nthird" });
  assert.equal((html.match(/<p>/g) ?? []).length, 2);
  assert.ok(html.includes("<br"));
});

test("a link whose target comes from data: a safe URL becomes a link", () => {
  const html = blockHtml("[docs]({{ url }})", { url: "https://example.com/docs", note: "x" });
  assert.match(html, /href="https:\/\/example\.com\/docs"/);
});

test("a link whose target comes from data is never rendered as a javascript: link", () => {
  // The engine's own URL allow-list stops it at render time (by throwing). Whatever the renderer decides to do
  // about it, a javascript: href must never reach the page.
  const report = compileReport(textReport("[docs]({{ url }})"));
  const data = { note: "x", url: "javascript:alert(1)" };
  let html = "";
  try {
    html = renderReport({ report, data, doc: DOC }).html;
  } catch (err) {
    assert.match(String((err as Error).message), /unsafe URL/i);
  }
  assert.ok(!/href="\s*javascript:/i.test(html));
});
