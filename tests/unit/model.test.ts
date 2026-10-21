import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSubmission, compileForm, DefinitionProblem, normalizeAppearance } from "../../src/forms/model.ts";
import { flatten, toCsv } from "../../src/forms/store.ts";
import { SEED_FORMS } from "../../src/seed.ts";

test("every seed form compiles, on four different themes, and its sample answers pass", () => {
  const themes = new Set<string>();
  for (const seed of SEED_FORMS) {
    const form = compileForm(seed.definition);
    themes.add(form.appearance.theme);
    assert.match(form.html, /<form id="fc-form"/);
    for (const a of seed.answers) assert.equal(checkSubmission(form, a).valid, true, seed.slug);
  }
  assert.equal(themes.size, 4);
});

test("the server's rules definition is the one the page carries", () => {
  const form = compileForm(SEED_FORMS[0]!.definition);
  const embedded = /<script type="application\/json" id="fc-rules">\n([\s\S]*?)\n<\/script>/.exec(form.html)![1]!;
  assert.deepEqual(JSON.parse(embedded), form.rules);
  assert.ok(form.rules.rules?.some((r: { id: string }) => r.id === "budget-for-projects"));
});

test("a rule decides what is required and what is kept", () => {
  const contact = compileForm(SEED_FORMS[0]!.definition);
  const base = { name: "Ada", email: "ada@example.com", message: "A message that is long enough to pass." };
  const project = checkSubmission(contact, { ...base, topic: "A new project" });
  assert.equal(project.valid, false);
  assert.deepEqual(project.findings.map((f) => [f.path, f.rule]), [["budget", "required"]]);
  // Budget is hidden for press enquiries: a value sent anyway is dropped.
  const press = checkSubmission(contact, { ...base, topic: "Press", budget: "Over €50k" });
  assert.equal(press.valid, true);
  assert.equal("budget" in press.data, false);
});

test("form pairs (as a browser sends them) and JSON give the same verdict", () => {
  const summit = compileForm(SEED_FORMS[1]!.definition);
  const json = checkSubmission(summit, { fullName: "Ada", email: "a@b.co", role: "Engineer", ticket: "Conference + workshops", workshops: ["Agent UX", "Forms for agents"], conduct: true, dietary: "None" });
  const pairs = checkSubmission(summit, new URLSearchParams([
    ["fullName", "Ada"], ["email", "a@b.co"], ["role", "Engineer"], ["ticket", "Conference + workshops"],
    ["workshops", "Agent UX"], ["workshops", "Forms for agents"], ["conduct", "on"], ["dietary", "None"],
  ]));
  assert.equal(json.valid, true);
  assert.deepEqual(pairs.data, json.data);
});

test("a validate rule names its field and rule id", () => {
  const summit = compileForm(SEED_FORMS[1]!.definition);
  const v = checkSubmission(summit, { fullName: "Ada", email: "a@b.co", role: "Engineer", ticket: "Remote", conduct: false });
  assert.equal(v.valid, false);
  assert.ok(v.findings.some((f) => f.path === "conduct"));
});

test("definition problems point at where they are", () => {
  const bad = (d: unknown) => {
    try { compileForm(d); } catch (e) { assert.ok(e instanceof DefinitionProblem); return e.errors.map((x) => x.pointer); }
    assert.fail("expected a DefinitionProblem");
  };
  assert.deepEqual(bad({ schema: { type: "object", properties: { a: { type: "string" } } } }), ["/schema/title"]);
  assert.deepEqual(bad({ schema: { type: "object", title: "x", properties: { a: { type: "string" } } }, appearance: { theme: "nope" } }), ["/appearance/theme"]);
  assert.deepEqual(bad({ schema: { type: "object", title: "x", properties: { a: { type: "string" } } }, extra: 1 }), ["/extra"]);
  assert.deepEqual(bad({ schema: { type: "object", title: "x", properties: { a: { type: "string" } } }, rules: { rules: [{ id: "r", show: "a", when: { "==": [{ var: "zzz" }, 1] } }] } }).length, 1);
});

test("appearance defaults fill in", () => {
  const a = normalizeAppearance({ theme: "luxe" });
  assert.equal(a.theme, "luxe");
  assert.equal(a.layout, "card");
  assert.equal(a.thankYou.title, "Thank you!");
  assert.equal(a.cover, null);
});

test("CSV flattens nested answers and defuses formulas", () => {
  assert.deepEqual(flatten({ a: { b: 1 }, c: [1, 2], d: [{ x: "y" }], e: true }), { "a.b": "1", c: "1; 2", "d[0].x": "y", e: "yes" });
  const csv = toCsv([{ id: "s1", form_id: "f", version: 1, created_at: "2026-01-01T00:00:00Z", data: { name: "=HYPERLINK(1)", note: 'say "hi", ok' } }], ["name", "note"]);
  assert.equal(csv.split("\r\n")[1], `s1,2026-01-01T00:00:00Z,1,'=HYPERLINK(1),"say ""hi"", ok"`);
});

test("nested answers: hidden paths and undeclared keys are not stored", () => {
  const form = compileForm({
    schema: {
      title: "Nested", type: "object",
      properties: {
        kind: { type: "string", enum: ["a", "b"] },
        addr: { type: "object", title: "Address", properties: { city: { type: "string" }, zip: { type: "string" } } },
        rows: { type: "array", items: { type: "object", properties: { n: { type: "string" } } } },
      },
    },
    rules: { rules: [{ id: "zip-for-b", show: "addr.zip", when: { "==": [{ var: "kind" }, "b"] } }] },
  });
  const v = checkSubmission(form, { kind: "a", addr: { city: "Oslo", zip: "HIDDEN", extra: "UNDECLARED" }, rows: [{ n: "1", x: "no" }], stray: 1 });
  assert.equal(v.valid, true);
  assert.deepEqual(v.data, { kind: "a", addr: { city: "Oslo" }, rows: [{ n: "1" }] });
});

test("forecraft's own keys: units around a number, a read-only computed field, date bounds, verbatim", () => {
  const definition = {
    schema: {
      title: "Order", type: "object",
      properties: {
        seats: { type: "integer", title: "Seats", default: 2 },
        price: { type: "number", title: "Price", multipleOf: 0.01 },
        total: { type: "number", title: "Total" },
        day: { type: "string", format: "date", title: "Day", formatMinimum: "2026-01-01", formatMaximum: "2026-12-31" },
        notes: { type: "string", title: "Notes" },
      },
    },
    ui: { seats: { suffix: "seats" }, price: { prefix: "€" }, notes: { widget: "textarea", verbatim: true } },
    rules: { rules: [{ id: "total", compute: "total", value: { "*": [{ var: "seats" }, { var: "price" }] } }] },
  };
  const form = compileForm(definition);
  // The definition is kept as written; the renderer never saw the extra keys.
  assert.deepEqual(form.definition, definition);
  assert.match(form.html, /<div data-ui="input-group" data-forecraft-unit><input[^>]*name="seats"[^>]*aria-describedby="[^"]*fc-field-seats-unit"[^>]*><span data-part="suffix" id="fc-field-seats-unit">seats<\/span><\/div>/);
  assert.match(form.html, /<span data-part="prefix" id="fc-field-price-unit">€<\/span><input[^>]*name="price"/);
  assert.match(form.html, /<input[^>]*name="total"[^>]*readonly/);
  assert.deepEqual(form.rules.rules?.map((r: { id: string }) => r.id), ["total", "date-min-day", "date-max-day"]);

  const v = checkSubmission(form, { seats: "3", price: "2.5", total: "1", day: "2025-12-31" });
  assert.equal(v.data.total, 7.5);
  assert.deepEqual(v.findings.map((f) => [f.path, f.rule]), [["day", "date-min-day"]]);
  assert.equal(checkSubmission(form, { seats: "3", price: "2.5", day: "2026-06-01" }).valid, true);
});

test("forecraft's own keys are refused where they mean nothing", () => {
  const bad = (props: Record<string, unknown>, ui: Record<string, unknown>) => {
    try { compileForm({ schema: { title: "X", type: "object", properties: props }, ui }); } catch (e) { return (e as DefinitionProblem).errors.map((x) => x.pointer); }
    return [];
  };
  assert.deepEqual(bad({ a: { type: "string" } }, { a: { prefix: "€" } }), ["/ui/a/prefix"]);
  assert.deepEqual(bad({ a: { type: "number" } }, { a: { suffix: "far too long a unit" } }), ["/ui/a/suffix"]);
  assert.deepEqual(bad({ a: { type: "string" } }, { a: { verbatim: true } }), ["/ui/a/verbatim"]);
  assert.deepEqual(bad({ a: { type: "string" } }, { a: { widget: "textarea", verbatim: "yes" } }), ["/ui/a/verbatim"]);
  assert.deepEqual(bad({ a: { type: "string", formatMinimum: "2026-01-01" } }, {}), ["/schema/properties/a/formatMinimum"]);
  assert.deepEqual(bad({ a: { type: "string", format: "date", formatMinimum: "2026-02-01", formatMaximum: "2026-01-01" } }, {}), ["/schema/properties/a/formatMaximum"]);
  assert.deepEqual(bad({ a: { type: "string", format: "date", formatMaximum: "1 May" } }, {}), ["/schema/properties/a/formatMaximum"]);
});
