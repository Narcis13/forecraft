// What the public submission endpoint stores and how it words a refusal:
// untouched booleans, a repeatable group a rule hides, and forecraft's sentences.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { startServer, type TestServer } from "../helpers.ts";

const definition = {
  schema: {
    title: "Workshop orders",
    type: "object",
    properties: {
      email: { type: "string", format: "email", title: "Email" },
      seats: { type: "integer", title: "Seats", minimum: 1, maximum: 20 },
      extras: { type: "array", title: "Extras", items: { type: "string", enum: ["Lunch", "Recording"] }, uniqueItems: true },
      lineItems: {
        type: "array", title: "Line items",
        items: { type: "object", properties: { label: { type: "string", title: "Label" }, paid: { type: "boolean", title: "Paid" } }, required: ["label"] },
      },
      newsletter: { type: "boolean", title: "Subscribe to newsletter" },
      terms: { type: "boolean", title: "I accept the terms", default: true },
    },
    required: ["email"],
  },
  ui: { newsletter: { widget: "switch" } },
  rules: { rules: [{ id: "show-lineitems", show: "lineItems", when: { "!": { missing: ["extras"] } } }] },
};

describe("public submissions", () => {
  let s: TestServer;
  let slug: string;
  let formId: string;
  before(async () => {
    s = await startServer({ seed: true });
    const created = await (await s.api("/api/v1/forms", { method: "POST", json: { definition, slug: "workshop-orders-x" } })).json();
    formId = created.id;
    slug = created.slug;
    assert.equal((await s.api(`/api/v1/forms/${formId}/publish`, { method: "POST" })).status, 201);
  });
  after(async () => { await s.close(); });

  const submit = (data: unknown) => fetch(`${s.url}/api/v1/f/${slug}/submissions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }),
  });

  test("an omitted boolean is stored as its default, or false", async () => {
    const res = await submit({ email: "ana@example.test" });
    assert.equal(res.status, 201, await res.clone().text());
    const { id } = await res.json();
    const stored = await (await s.api(`/api/v1/submissions/${id}`)).json();
    assert.equal(stored.data.newsletter, false);
    assert.equal(stored.data.terms, true);
    // A group the rule hid is not there at all, booleans inside it included.
    assert.equal("lineItems" in stored.data, false);
  });

  test("a row answered without its boolean gets false; a sent true stays", async () => {
    const res = await submit({ email: "bo@example.test", extras: ["Lunch"], newsletter: true, lineItems: [{ label: "Lunch for 2" }] });
    assert.equal(res.status, 201, await res.clone().text());
    const stored = await (await s.api(`/api/v1/submissions/${(await res.json()).id}`)).json();
    assert.equal(stored.data.newsletter, true);
    assert.deepEqual(stored.data.lineItems, [{ label: "Lunch for 2", paid: false }]);
  });

  test("a hidden repeatable group is neither validated nor stored", async () => {
    // The rows break their own `required`, but no extra is chosen, so the group is hidden.
    const res = await submit({ email: "cy@example.test", lineItems: [{ paid: true }] });
    assert.equal(res.status, 201, await res.clone().text());
    const stored = await (await s.api(`/api/v1/submissions/${(await res.json()).id}`)).json();
    assert.equal("lineItems" in stored.data, false);
    // Shown, the same rows are refused.
    const shown = await submit({ email: "cy@example.test", extras: ["Recording"], lineItems: [{ paid: true }] });
    assert.equal(shown.status, 422);
    const problem = await shown.json();
    assert.deepEqual(problem.errors.map((e: { field: string }) => e.field), ["lineItems.0.label"]);
  });

  test("a refusal is worded as the page words it", async () => {
    const res = await submit({ email: "not-an-email", seats: 40 });
    assert.equal(res.status, 422);
    const byField = Object.fromEntries((await res.json()).errors.map((e: { field: string; detail: string }) => [e.field, e.detail]));
    assert.equal(byField.email, "Enter a valid email address.");
    assert.equal(byField.seats, "Enter 20 or less.");
    const missing = await (await submit({})).json();
    assert.equal(missing.errors[0].detail, "This field is required.");
  });
});
