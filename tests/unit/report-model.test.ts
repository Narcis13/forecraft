import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCKS, checkCurrency, checkLocale, compileReport, contrastOnWhite, DEFAULT_APPEARANCE, normalizeAppearance, ReportProblem, walkBlocks,
  type Block, type FieldError,
} from "../../src/reports/model.ts";

const STARTERS = join(import.meta.dirname, "..", "..", "src", "reports", "starters");

type Def = Record<string, any>;

/** A small valid definition: a customer, some lines, one title block. Every test mutates a fresh copy. */
function base(): Def {
  return structuredClone({
    schema: {
      type: "object",
      title: "Test report",
      properties: {
        customer: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        items: { type: "array", items: { type: "object", properties: { qty: { type: "number" }, price: { type: "number" } } } },
      },
      required: ["customer"],
    },
    sample: { customer: { name: "Ada" }, items: [{ qty: 1, price: 2 }] },
    layout: [{ id: "title", block: "title", text: "Hi {{ customer.name }}" }],
  });
}

function make(change: (d: Def) => void): Def {
  const d = base();
  change(d);
  return d;
}

/** The errors a refused definition carries (fails the test when it is accepted). */
function refused(def: unknown): FieldError[] {
  try {
    compileReport(def);
  } catch (err) {
    assert.ok(err instanceof ReportProblem, `expected a ReportProblem, got ${String(err)}`);
    assert.ok(err.errors.length > 0);
    return err.errors;
  }
  return assert.fail("the definition was accepted, expected a 422");
}

/** The one error at a pointer (fails when there is none). */
function at(def: unknown, pointer: string): FieldError {
  const errors = refused(def);
  const hit = errors.find((e) => e.pointer === pointer);
  assert.ok(hit, `expected an error at ${pointer}, got ${JSON.stringify(errors.map((e) => e.pointer))}`);
  return hit;
}

const table = (extra: Def = {}): Def => ({ id: "items", block: "table", rows: "items", columns: [{ label: "Qty", value: "{{ row.qty }}" }], ...extra });

// ── The starters ────────────────────────────────────────────────────────────

const starterIds = readdirSync(STARTERS).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();

test("the seven starters are all there", () => {
  assert.deepEqual(starterIds, ["blank", "business-report", "confirmation", "invoice", "letter", "submissions-register", "survey-summary"]);
});

for (const id of starterIds) {
  test(`starter "${id}" compiles`, () => {
    const def = JSON.parse(readFileSync(join(STARTERS, `${id}.json`), "utf8"));
    const report = compileReport(def);
    assert.equal(report.title, def.schema.title);
    assert.match(report.hash, /^[0-9a-f]{24}$/);
    assert.equal(report.definition.layout.length, def.layout.length);
  });
}

test("compiling the same definition twice gives the same hash, and a changed one a different hash", () => {
  const a = compileReport(base());
  const b = compileReport(base());
  assert.equal(a.hash, b.hash);
  assert.notEqual(compileReport(make((d) => { d.schema.title = "Another"; })).hash, a.hash);
});

test("appearance defaults are filled in around what the definition says", () => {
  const plain = compileReport(base()).appearance;
  assert.deepEqual(plain, DEFAULT_APPEARANCE);
  const custom = compileReport(make((d) => { d.appearance = { locale: "de-DE", letter: { foldMarks: true } }; })).appearance;
  assert.equal(custom.locale, "de-DE");
  assert.equal(custom.currency, "EUR");
  assert.deepEqual(custom.letter, { window: false, foldMarks: true });
  assert.deepEqual(normalizeAppearance(undefined), DEFAULT_APPEARANCE);
});

test("every block's own example compiles in a layout of its own", () => {
  // Examples cite assets by a placeholder; any well-formed id will do for the check.
  const fix = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replaceAll("asset:ast_…", "asset:ast_abc123"));
  for (const [name, spec] of Object.entries(BLOCKS)) {
    const example = fix(spec.example) as Block;
    assert.equal(example.block, name);
    const def = { schema: { type: "object", title: "Example", properties: {} }, sample: {}, layout: [example] };
    assert.doesNotThrow(() => compileReport(def), `${name} example`);
  }
});

// ── The envelope ────────────────────────────────────────────────────────────

test("a definition that is not an object is refused at the root", () => {
  for (const bad of [null, [], "x", 3, undefined]) {
    assert.deepEqual(refused(bad), [{ pointer: "", detail: "The definition must be a JSON object." }]);
  }
});

test("a ReportProblem is an Error whose message lists every pointer", () => {
  assert.throws(() => compileReport(make((d) => { d.foo = 1; delete d.schema.title; })), (err: unknown) => {
    assert.ok(err instanceof ReportProblem && err instanceof Error);
    assert.match(err.message, /\/foo: Unknown key/);
    assert.match(err.message, /\/schema\/title: Required/);
    return true;
  });
});

test("all faults are reported together, each with its own pointer", () => {
  const errors = refused(make((d) => {
    d.foo = 1;
    delete d.schema.title;
    d.layout.push({ id: "x", block: "nope" });
    d.appearance = { theme: "neon" };
  }));
  assert.deepEqual(errors.map((e) => e.pointer).sort(), ["/appearance/theme", "/foo", "/layout/1/block", "/schema/title"]);
});

test("an unknown top-level key names itself: /foo", () => {
  assert.match(at(make((d) => { d.foo = 1; }), "/foo").detail, /Unknown key/);
});

test("a JSON pointer escapes / and ~ in a key (RFC 6901)", () => {
  at(make((d) => { d["a/b"] = 1; }), "/a~1b");
  at(make((d) => { d["a~b"] = 1; }), "/a~0b");
});

test("a missing layout or schema is refused where it should be", () => {
  at(make((d) => { delete d.layout; }), "/layout");
  at(make((d) => { delete d.schema; }), "/schema");
  at(make((d) => { d.layout = {}; }), "/layout");
});

// ── The schema ──────────────────────────────────────────────────────────────

test("a missing schema title is /schema/title", () => {
  at(make((d) => { delete d.schema.title; }), "/schema/title");
  at(make((d) => { d.schema.title = "   "; }), "/schema/title");
});

test("`doc` may not be declared in the schema: /schema/properties/doc", () => {
  const e = at(make((d) => { d.schema.properties.doc = { type: "string" }; }), "/schema/properties/doc");
  assert.match(e.detail, /reserved/);
});

test("the schema root must be an object with properties and no stray keys", () => {
  at(make((d) => { d.schema.type = "array"; }), "/schema/type");
  at(make((d) => { delete d.schema.properties; }), "/schema/properties");
  at(make((d) => { d.schema.additionalProperties = false; }), "/schema/additionalProperties");
});

// ── Blocks ──────────────────────────────────────────────────────────────────

test("an unknown block is /layout/N/block and lists the vocabulary", () => {
  const e = at(make((d) => { d.layout.push({ id: "x", block: "nope" }); }), "/layout/1/block");
  assert.match(e.detail, /Unknown block/);
  assert.match(e.detail, /letterhead/);
  at(make((d) => { d.layout.push({ id: "x" }); }), "/layout/1/block");
});

test("a block must be an object with a well-formed id", () => {
  at(make((d) => { d.layout.push("title"); }), "/layout/1");
  at(make((d) => { d.layout.push({ block: "separator" }); }), "/layout/1/id");
  at(make((d) => { d.layout.push({ id: "Bad Id", block: "separator" }); }), "/layout/1/id");
  at(make((d) => { d.layout.push({ id: "1st", block: "separator" }); }), "/layout/1/id");
});

test("a duplicate id points at the second block and names the first", () => {
  const e = at(make((d) => { d.layout.push({ id: "title", block: "separator" }); }), "/layout/1/id");
  assert.match(e.detail, /Duplicate id "title"/);
  assert.match(e.detail, /\/layout\/0/);
});

test("ids are unique across nesting levels too", () => {
  const def = make((d) => { d.layout.push({ id: "s", block: "section", title: "S", blocks: [{ id: "title", block: "separator" }] }); });
  at(def, "/layout/1/blocks/0/id");
});

test("an unknown prop on a block is /layout/N/<prop>, and the error lists what the block takes", () => {
  const e = at(make((d) => { d.layout[0].colour = "red"; }), "/layout/0/colour");
  assert.match(e.detail, /Unknown prop for title/);
  assert.match(e.detail, /eyebrow, text, details/);
  at(make((d) => { d.layout.push({ id: "rule", block: "separator", width: 3 }); }), "/layout/1/width");
});

test("a required prop that is missing is named", () => {
  assert.match(at(make((d) => { delete d.layout[0].text; }), "/layout/0/text").detail, /Required by title/);
  at(make((d) => { d.layout = [{ id: "t", block: "table", rows: "items" }]; }), "/layout/0/columns");
});

test("a wrong type, an out-of-list enum and an oversized list are refused", () => {
  at(make((d) => { d.layout[0].text = 5; }), "/layout/0/text");
  at(make((d) => { d.layout = [{ id: "f", block: "facts", items: [{ label: "a", value: "b" }], cols: "9" }]; }), "/layout/0/cols");
  at(make((d) => { d.layout = [{ id: "f", block: "facts", items: [] }]; }), "/layout/0/items");
  at(make((d) => { d.layout[0].keep = "always"; }), "/layout/0/keep");
  at(make((d) => { d.layout[0].details = [{ label: "a", value: "b", extra: 1 }]; }), "/layout/0/details/0/extra");
});

test("assets are cited as asset:ast_…; a remote URL is refused", () => {
  at(make((d) => { d.layout = [{ id: "i", block: "image", src: "https://example.com/x.png", alt: "x" }]; }), "/layout/0/src");
  at(make((d) => { d.layout = [{ id: "l", block: "letterhead", name: "Acme", logo: "asset:nope" }]; }), "/layout/0/logo");
  assert.doesNotThrow(() => compileReport(make((d) => { d.layout = [{ id: "i", block: "image", src: "asset:ast_abc123", alt: "x" }]; })));
});

test("a table with 11 columns is refused (10 is the most any paper fits)", () => {
  const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `C${i}`, value: "{{ row.qty }}" }));
  const e = at(make((d) => { d.layout = [table({ columns: cols(11) })]; }), "/layout/0/columns");
  assert.match(e.detail, /At most 10 columns/);
  assert.doesNotThrow(() => compileReport(make((d) => { d.layout = [table({ columns: cols(10) })]; })));
});

test("containers nest two levels deep at most", () => {
  const leaf = { id: "leaf", block: "separator" };
  // section > section > leaf: fine.
  assert.doesNotThrow(() => compileReport(make((d) => {
    d.layout = [{ id: "a", block: "section", title: "A", blocks: [{ id: "b", block: "section", title: "B", blocks: [leaf] }] }];
  })));
  // section > section > section: the third is refused, at its own block.
  const deep = make((d) => {
    d.layout = [{ id: "a", block: "section", title: "A", blocks: [{ id: "b", block: "section", title: "B", blocks: [{ id: "c", block: "section", title: "C", blocks: [] }] }] }];
  });
  assert.match(at(deep, "/layout/0/blocks/0/blocks/0/block").detail, /two levels deep/);
  // columns > columns inside a section is refused too.
  const cols = make((d) => {
    d.layout = [{ id: "a", block: "section", title: "A", blocks: [{ id: "b", block: "columns", columns: [[{ id: "c", block: "columns", columns: [[], []] }], []] }] }];
  });
  at(cols, "/layout/0/blocks/0/columns/0/0/block");
});

test("columns takes two or three columns of blocks", () => {
  at(make((d) => { d.layout = [{ id: "c", block: "columns", columns: [[]] }]; }), "/layout/0/columns");
  at(make((d) => { d.layout = [{ id: "c", block: "columns", columns: [[], [], [], []] }]; }), "/layout/0/columns");
  at(make((d) => { d.layout = [{ id: "c", block: "columns", columns: [[], "x"] }]; }), "/layout/0/columns");
  assert.doesNotThrow(() => compileReport(make((d) => { d.layout = [{ id: "c", block: "columns", columns: [[], [], []] }]; })));
});

test("one footer, and only at the top level", () => {
  const footer = (id: string) => ({ id, block: "footer", lines: ["Acme"] });
  at(make((d) => { d.layout.push(footer("f1"), footer("f2")); }), "/layout/2");
  at(make((d) => { d.layout.push({ id: "s", block: "section", title: "S", blocks: [footer("f1")] }); }), "/layout/1/blocks/0");
});

test("a report has at most 300 blocks", () => {
  const many = make((d) => { d.layout = Array.from({ length: 301 }, (_, i) => ({ id: `s${i}`, block: "separator" })); });
  assert.match(at(many, "/layout/300").detail, /at most 300 blocks/);
  assert.doesNotThrow(() => compileReport(make((d) => { d.layout = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, block: "separator" })); })));
});

test("walkBlocks yields every block depth first with its pointer", () => {
  const layout = [
    { id: "a", block: "section", title: "A", blocks: [{ id: "a1", block: "separator" }] },
    { id: "b", block: "columns", columns: [[{ id: "b1", block: "separator" }], [{ id: "b2", block: "separator" }]] },
    { id: "c", block: "separator" },
  ] as Block[];
  assert.deepEqual([...walkBlocks(layout)].map((w) => [w.block.id, w.pointer, w.depth]), [
    ["a", "/layout/0", 0],
    ["a1", "/layout/0/blocks/0", 1],
    ["b", "/layout/1", 0],
    ["b1", "/layout/1/columns/0/0", 1],
    ["b2", "/layout/1/columns/1/0", 1],
    ["c", "/layout/2", 0],
  ]);
});

// ── Expressions ─────────────────────────────────────────────────────────────

test("an unclosed hole in text reports the pointer, the line and a column", () => {
  const e = at(make((d) => { d.layout[0].text = "Hi {{ customer.name"; }), "/layout/0/text");
  assert.equal(e.code, "bad-hole");
  assert.equal(e.line, 1);
  assert.ok(e.column! > 0 && e.column! <= "Hi {{ customer.name".length + 1, `column ${e.column}`);
  assert.match(e.detail, /line 1, column \d+/);
});

test("a bad bare expression (rows) reports pointer, code, line and column", () => {
  const e = at(make((d) => { d.layout = [table({ rows: "items +" })]; }), "/layout/0/rows");
  assert.equal(e.code, "bad-expr");
  assert.equal(e.line, 1);
  assert.ok(e.column! > 0 && e.column! <= "items +".length + 1, `column ${e.column}`);
});

test("a bad `when` is /layout/N/when", () => {
  const e = at(make((d) => { d.layout[0].when = "customer.name =="; }), "/layout/0/when");
  assert.equal(e.code, "bad-expr");
  assert.ok(e.column! > 0);
  at(make((d) => { d.layout[0].when = 42; }), "/layout/0/when");
});

test("an unknown helper is named, with its position", () => {
  const e = at(make((d) => { d.layout[0].text = "{{ nope(1) }}"; }), "/layout/0/text");
  assert.equal(e.code, "unknown-helper");
  assert.match(e.detail, /nope/);
  assert.ok(e.column! > 0);
  // The real helpers are accepted.
  assert.doesNotThrow(() => compileReport(make((d) => { d.layout[0].text = '{{ upper(money(1)) }} {{ label("invoice") }} {{ date("2026-10-19") }}'; })));
});

test("an expression error nested in a section or a column keeps its full pointer", () => {
  const section = make((d) => { d.layout.push({ id: "s", block: "section", title: "S", blocks: [{ id: "t2", block: "title", text: "{{ nope(1) }}" }] }); });
  assert.equal(at(section, "/layout/1/blocks/0/text").code, "unknown-helper");
  const cols = make((d) => { d.layout.push({ id: "c", block: "columns", columns: [[], [{ id: "t2", block: "text", markdown: "ok" }, { id: "t3", block: "title", text: "{{ 1 + }}" }]] }); });
  assert.ok(at(cols, "/layout/1/columns/1/1/text").line);
});

test("an expression inside a list item (a table column) is located by index", () => {
  const e = at(make((d) => { d.layout = [table({ columns: [{ label: "A", value: "{{ row.qty }}" }, { label: "B", value: "{{ row.qty * }}" }] })]; }), "/layout/0/columns/1/value");
  assert.ok(e.line && e.column);
});

test("text is one line; an expression is one line", () => {
  assert.equal(at(make((d) => { d.layout[0].text = "a\nb"; }), "/layout/0/text").code, "multi-line");
  assert.equal(at(make((d) => { d.layout[0].when = "a\n&& b"; }), "/layout/0/when").code, "multi-line");
  assert.equal(at(make((d) => { d.layout = [table({ rows: "  " })]; }), "/layout/0/rows").code, "bad-expr");
});

test("a bad expression in documentTitle or runningHeader is located", () => {
  assert.equal(at(make((d) => { d.documentTitle = "{{ nope() }}"; }), "/documentTitle").code, "unknown-helper");
  assert.equal(at(make((d) => { d.runningHeader = "{{ customer.name"; }), "/runningHeader").code, "bad-hole");
  at(make((d) => { d.documentTitle = 5; }), "/documentTitle");
});

test("a bad hole inside markdown is located at the markdown prop", () => {
  const e = at(make((d) => { d.layout.push({ id: "m", block: "text", markdown: "Pay {{ customer.name" }); }), "/layout/1/markdown");
  assert.equal(e.code, "bad-hole");
  assert.ok(e.column! > 0);
});

test("HTML in markdown is refused at the markdown prop", () => {
  const e = at(make((d) => { d.layout.push({ id: "m", block: "text", markdown: "<b>hello</b>" }); }), "/layout/1/markdown");
  assert.equal(e.code, "html-refused");
});

test("a faqir block's fragment errors carry the block's source pointer and a code", () => {
  const style = at(make((d) => { d.layout.push({ id: "f", block: "faqir", source: 'div(style="color:red")\n  p hi' }); }), "/layout/1/source");
  assert.equal(style.code, "refused-style");
  assert.ok(style.line && style.column);
  assert.equal(at(make((d) => { d.layout.push({ id: "f", block: "faqir", source: "+nonesuch()" }); }), "/layout/1/source").code, "unknown-component");
  assert.doesNotThrow(() => compileReport(make((d) => { d.layout.push({ id: "f", block: "faqir", source: '+callout(variant="muted")\n  @content\n    p {{ customer.name }}' }); })));
});

// ── Labels and source ───────────────────────────────────────────────────────

test("label overrides: known keys, short non-empty strings", () => {
  at(make((d) => { d.labels = { nonsense: "x" }; }), "/labels/nonsense");
  at(make((d) => { d.labels = { invoice: "" }; }), "/labels/invoice");
  at(make((d) => { d.labels = { invoice: "x".repeat(81) }; }), "/labels/invoice");
  at(make((d) => { d.labels = ["x"]; }), "/labels");
  assert.doesNotThrow(() => compileReport(make((d) => { d.labels = { invoice: "Factura" }; })));
});

test("source: kind data, submission or summary, with a form id where one is needed", () => {
  at(make((d) => { d.source = { kind: "nope" }; }), "/source");
  at(make((d) => { d.source = { kind: "submission" }; }), "/source/form");
  at(make((d) => { d.source = { kind: "summary", form: "not-an-id" }; }), "/source/form");
  at(make((d) => { d.source = { kind: "data", form: "frm_abc" }; }), "/source/form");
  at(make((d) => { d.source = { kind: "data", extra: 1 }; }), "/source/extra");
  assert.doesNotThrow(() => compileReport(make((d) => { d.source = { kind: "summary", form: "frm_abc123" }; })));
});

// ── Appearance ──────────────────────────────────────────────────────────────

test("curated appearance values are checked against their lists", () => {
  assert.match(at(make((d) => { d.appearance = { theme: "neon" }; }), "/appearance/theme").detail, /One of: document/);
  at(make((d) => { d.appearance = { paper: "a3" }; }), "/appearance/paper");
  at(make((d) => { d.appearance = { orientation: "diagonal" }; }), "/appearance/orientation");
  at(make((d) => { d.appearance = { margins: "huge" }; }), "/appearance/margins");
  at(make((d) => { d.appearance = { density: "airy" }; }), "/appearance/density");
  at(make((d) => { d.appearance = { type: "comic-sans" }; }), "/appearance/type");
  at(make((d) => { d.appearance = "document"; }), "/appearance");
});

test("the accent is one #rrggbb colour", () => {
  for (const bad of ["red", "#fff", "#12345", "1f3a8a", "#gggggg", 5]) at(make((d) => { d.appearance = { accent: bad }; }), "/appearance/accent");
  assert.doesNotThrow(() => compileReport(make((d) => { d.appearance = { accent: "#1F3A8A" }; })));
});

test("an accent too light to print is refused with its contrast in the message", () => {
  const e = at(make((d) => { d.appearance = { accent: "#eeeeee" }; }), "/appearance/accent");
  assert.match(e.detail, /Too light/);
  assert.match(e.detail, /contrast 1\.\d:1/);
  assert.match(e.detail, /4\.5:1/);
});

test("contrastOnWhite follows WCAG: black 21, white 1, #767676 is the lightest grey that passes", () => {
  assert.ok(Math.abs(contrastOnWhite("#000000") - 21) < 0.01);
  assert.ok(Math.abs(contrastOnWhite("#ffffff") - 1) < 0.001);
  assert.ok(contrastOnWhite("#767676") >= 4.5);
  assert.ok(contrastOnWhite("#777777") < 4.5);
  assert.doesNotThrow(() => compileReport(make((d) => { d.appearance = { accent: "#767676" }; })));
  at(make((d) => { d.appearance = { accent: "#777777" }; }), "/appearance/accent");
});

test("the locale is language-REGION in en, ro, de or fr", () => {
  assert.match(at(make((d) => { d.appearance = { locale: "xx-YY" }; }), "/appearance/locale").detail, /language-REGION/);
  at(make((d) => { d.appearance = { locale: "en" }; }), "/appearance/locale");
  at(make((d) => { d.appearance = { locale: "en_GB" }; }), "/appearance/locale");
  at(make((d) => { d.appearance = { locale: "pt-PT" }; }), "/appearance/locale");
  at(make((d) => { d.appearance = { locale: 44 }; }), "/appearance/locale");
  assert.equal(at(make((d) => { d.appearance = { locale: "ro-ro" }; }), "/appearance/locale").detail, "Write it as ro-RO.");
  for (const ok of ["en-GB", "en-US", "ro-RO", "de-AT", "de-CH", "fr-BE", "fr-CH"]) {
    assert.doesNotThrow(() => compileReport(make((d) => { d.appearance = { locale: ok }; })), ok);
  }
});

test("the currency is an ISO 4217 code Intl knows", () => {
  assert.match(at(make((d) => { d.appearance = { currency: "EURO" }; }), "/appearance/currency").detail, /ISO 4217/);
  at(make((d) => { d.appearance = { currency: "eur" }; }), "/appearance/currency");
  assert.match(at(make((d) => { d.appearance = { currency: "XXQ" }; }), "/appearance/currency").detail, /Unknown currency XXQ/);
  for (const ok of ["EUR", "RON", "GBP", "USD", "CHF", "JPY"]) assert.equal(checkCurrency(ok), null);
  assert.equal(checkLocale("de-DE"), null);
});

test("sizes, colours and positions are not appearance keys", () => {
  for (const key of ["fontSize", "color", "font", "margin", "padding", "width", "position", "background"]) {
    const e = at(make((d) => { d.appearance = { [key]: 12 }; }), `/appearance/${key}`);
    assert.match(e.detail, /Unknown key/);
    assert.match(e.detail, /nothing about sizes, colours or positions/);
  }
});

test("a logo is an asset reference or null; letter takes window and foldMarks as booleans", () => {
  at(make((d) => { d.appearance = { logo: "https://example.com/logo.png" }; }), "/appearance/logo");
  assert.doesNotThrow(() => compileReport(make((d) => { d.appearance = { logo: null }; })));
  assert.doesNotThrow(() => compileReport(make((d) => { d.appearance = { logo: "asset:ast_abc123" }; })));
  at(make((d) => { d.appearance = { letter: { fold: true } }; }), "/appearance/letter/fold");
  at(make((d) => { d.appearance = { letter: { foldMarks: "yes" } }; }), "/appearance/letter/foldMarks");
  at(make((d) => { d.appearance = { letter: true }; }), "/appearance/letter");
});

test("a window letter must start with letterhead + parties: /appearance/letter/window", () => {
  const windowed = (layout: Def[]) => make((d) => { d.appearance = { letter: { window: true } }; d.layout = layout; });
  const head = { id: "head", block: "letterhead", name: "Acme" };
  const to = { id: "to", block: "parties", parties: [{ name: "{{ customer.name }}" }] };
  const body = { id: "body", block: "text", markdown: "Dear Sir" };
  const footer = { id: "foot", block: "footer", lines: ["Acme"] };

  assert.match(at(windowed([body]), "/appearance/letter/window").detail, /letterhead block, then a parties block/);
  at(windowed([to, head]), "/appearance/letter/window");
  at(windowed([head, body, to]), "/appearance/letter/window");
  at(windowed([{ ...head, when: "true" }, to]), "/appearance/letter/window");
  at(windowed([head, { ...to, when: "true" }]), "/appearance/letter/window");
  assert.doesNotThrow(() => compileReport(windowed([head, to, body])));
  // A footer or watermark in front does not count as content.
  assert.doesNotThrow(() => compileReport(windowed([footer, { id: "wm", block: "watermark", text: "COPY" }, head, to, body])));
  // Without the window flag no such rule applies.
  assert.doesNotThrow(() => compileReport(make((d) => { d.layout = [body]; })));
});

test("the letter starter is a valid window letter; without its letterhead it is not", () => {
  const letter = JSON.parse(readFileSync(join(STARTERS, "letter.json"), "utf8"));
  assert.equal(letter.appearance.letter.window, true);
  assert.doesNotThrow(() => compileReport(letter));
  letter.layout = letter.layout.filter((b: Def) => b.block !== "letterhead");
  at(letter, "/appearance/letter/window");
});

// ── Money and numbering ─────────────────────────────────────────────────────

const money = { lines: "items", quantity: "qty", unitPrice: "price" };

test("money keys must name properties of each line item", () => {
  assert.doesNotThrow(() => compileReport(make((d) => { d.money = money; })));
  const q = at(make((d) => { d.money = { ...money, quantity: "quantity" }; }), "/money/quantity");
  assert.match(q.detail, /"quantity" is not a property of each items item/);
  at(make((d) => { d.money = { ...money, unitPrice: "cost" }; }), "/money/unitPrice");
  at(make((d) => { d.money = { ...money, taxRate: "vat" }; }), "/money/taxRate");
  at(make((d) => { d.money = { ...money, discount: "off" }; }), "/money/discount");
});

test("money.lines must be an array of objects in the schema", () => {
  assert.match(at(make((d) => { d.money = { ...money, lines: "rows" }; }), "/money/lines").detail, /array of objects/);
  at(make((d) => { d.money = { ...money, lines: "customer" }; }), "/money/lines");
});

test("money: required keys, enums and unknown keys", () => {
  at(make((d) => { d.money = { lines: "items", unitPrice: "price" }; }), "/money/quantity");
  at(make((d) => { d.money = { ...money, prices: "both" }; }), "/money/prices");
  at(make((d) => { d.money = { ...money, rounding: "up" }; }), "/money/rounding");
  at(make((d) => { d.money = { ...money, currency: "EUR" }; }), "/money/currency");
  at(make((d) => { d.money = "items"; }), "/money");
  assert.doesNotThrow(() => compileReport(make((d) => { d.money = { ...money, prices: "gross", rounding: "total", paid: "paid" }; })));
});

test("numbering pattern errors are /numbering/pattern", () => {
  const pattern = (p: unknown) => make((d) => { d.numbering = { pattern: p }; });
  assert.match(at(pattern("INV-{YYYY}"), "/numbering/pattern").detail, /needs one \{seq\}/);
  assert.match(at(pattern("INV-{foo}-{seq:4}"), "/numbering/pattern").detail, /Unknown token \{foo\}/);
  at(pattern("{seq}-{seq}"), "/numbering/pattern");
  at(pattern("INV-{seq:0}"), "/numbering/pattern");
  at(pattern("INV-{seq:10}"), "/numbering/pattern");
  for (const ok of ["INV-{YYYY}-{seq:4}", "{seq}", "{YY}{MM}-{seq:6}"]) assert.doesNotThrow(() => compileReport(pattern(ok)), ok);
});

test("numbering: a pattern or manual, not both, not neither, no stray keys", () => {
  at(make((d) => { d.numbering = { pattern: "{seq}", manual: true }; }), "/numbering");
  at(make((d) => { d.numbering = {}; }), "/numbering");
  at(make((d) => { d.numbering = { manual: false }; }), "/numbering/manual");
  at(make((d) => { d.numbering = { start: 5 }; }), "/numbering/start");
  at(make((d) => { d.numbering = "INV"; }), "/numbering");
  assert.doesNotThrow(() => compileReport(make((d) => { d.numbering = { manual: true }; })));
});

// ── The sample ──────────────────────────────────────────────────────────────

test("the sample must be valid against the schema: /sample/...", () => {
  const missing = at(make((d) => { d.sample = { customer: {} }; }), "/sample/customer/name");
  assert.equal(missing.code, "required");
  assert.equal(at(make((d) => { d.sample = { customer: { name: 5 } }; }), "/sample/customer/name").code, "type");
  at(make((d) => { d.sample = {}; }), "/sample/customer");
});

test("a sample error inside an array carries the index", () => {
  const def = make((d) => {
    d.schema.properties.items.items.required = ["qty"];
    d.sample = { customer: { name: "Ada" }, items: [{ qty: 1 }, { price: 3 }] };
  });
  assert.equal(at(def, "/sample/items/1/qty").code, "required");
});

test("a missing or non-object sample is /sample", () => {
  assert.match(at(make((d) => { delete d.sample; }), "/sample").detail, /Required/);
  at(make((d) => { d.sample = [1]; }), "/sample");
  at(make((d) => { d.sample = "x"; }), "/sample");
});
