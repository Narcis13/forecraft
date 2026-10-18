import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { startServer, type TestServer } from "../helpers.ts";
import { createSession } from "../../src/auth/index.ts";

const definition = {
  schema: {
    title: "Beta waitlist",
    type: "object",
    properties: {
      email: { type: "string", format: "email", title: "Email" },
      plan: { type: "string", title: "Plan", enum: ["Solo", "Team"] },
      seats: { type: "integer", title: "Seats", minimum: 2, maximum: 50 },
    },
    required: ["email", "plan"],
  },
  rules: {
    rules: [
      { id: "seats-for-teams", show: "seats", when: { "==": [{ var: "plan" }, "Team"] } },
      { id: "seats-required-for-teams", require: "seats", when: { "==": [{ var: "plan" }, "Team"] } },
    ],
  },
  appearance: { theme: "aurora" },
};

describe("forms API", () => {
  let s: TestServer;
  before(async () => { s = await startServer({ seed: true }); });
  after(async () => { await s.close(); });

  test("health", async () => {
    const res = await fetch(s.url + "/health");
    assert.equal(res.status, 200);
  });

  test("requires a key", async () => {
    const res = await s.api("/api/v1/forms", { key: null });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("content-type"), "application/problem+json");
    const res2 = await s.api("/api/v1/forms", { key: "fc_live_nope" });
    assert.equal(res2.status, 401);
  });

  test("create → preview → publish → submit → list → export", async () => {
    const created = await s.api("/api/v1/forms", { method: "POST", json: { definition, slug: "beta-waitlist" } });
    assert.equal(created.status, 201);
    const form = await created.json();
    assert.equal(form.title, "Beta waitlist");
    assert.equal(form.published_version, null);

    const preview = await s.api(`/api/v1/forms/${form.id}/preview`, { method: "POST" });
    assert.equal(preview.status, 200);
    const p = await preview.json();
    assert.match(p.html, /<form id="fc-form"/);
    assert.equal(p.audit.counts.error, 0, JSON.stringify(p.audit.findings));

    // Not published yet: the public page says so and submissions are refused.
    assert.equal((await fetch(`${s.url}/f/beta-waitlist`)).status, 404);
    const early = await fetch(`${s.url}/api/v1/f/beta-waitlist/submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { email: "a@b.co", plan: "Solo" } }) });
    assert.equal(early.status, 409);

    const pub = await s.api(`/api/v1/forms/${form.id}/publish`, { method: "POST" });
    assert.equal(pub.status, 201);
    assert.equal((await pub.json()).version, 1);

    const page = await fetch(`${s.url}/f/beta-waitlist`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-skin="aurora"/);
    assert.match(html, /l-rules="#fc-rules"/);

    const submit = (data: unknown) => fetch(`${s.url}/api/v1/f/beta-waitlist/submissions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }),
    });

    // A team without seats breaks a rule: 422, naming the field and the rule.
    const bad = await submit({ email: "team@example.com", plan: "Team" });
    assert.equal(bad.status, 422);
    const problem = await bad.json();
    assert.equal(problem.errors[0].field, "seats");
    assert.equal(problem.errors[0].rule, "required");

    const ok = await submit({ email: "team@example.com", plan: "Team", seats: "5" });
    assert.equal(ok.status, 201);

    // Form-encoded, like the browser sends; a hidden field's value is dropped.
    const ok2 = await fetch(`${s.url}/api/v1/f/beta-waitlist/submissions`, {
      method: "POST", body: new URLSearchParams([["email", "solo@example.com"], ["plan", "Solo"], ["seats", "9"]]),
    });
    assert.equal(ok2.status, 201);

    const list = await (await s.api(`/api/v1/forms/${form.id}/submissions`)).json();
    assert.equal(list.total, 2);
    const solo = list.items.find((i: { data: { plan: string } }) => i.data.plan === "Solo");
    assert.deepEqual(solo.data, { email: "solo@example.com", plan: "Solo" });
    const team = list.items.find((i: { data: { plan: string } }) => i.data.plan === "Team");
    assert.equal(team.data.seats, 5);

    const csv = await (await s.api(`/api/v1/forms/${form.id}/submissions/export?format=csv`)).text();
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], "id,submitted_at,version,email,plan,seats");
    assert.equal(lines.length, 3);
  });

  test("a bad definition is a 422 that says where", async () => {
    const res = await s.api("/api/v1/forms", { method: "POST", json: { definition: { schema: { type: "object", title: "x", properties: { a: { type: "strin" } } } } } });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.type, "https://forecraft.dev/problems/invalid-definition");
    assert.ok(body.errors[0].pointer.startsWith("/schema"));
  });

  test("closed and full forms refuse submissions", async () => {
    const forms = (await (await s.api("/api/v1/forms")).json()).items;
    const contact = forms.find((f: { slug: string }) => f.slug === "contact");
    await s.api(`/api/v1/forms/${contact.id}`, { method: "PATCH", json: { status: "closed" } });
    const page = await (await fetch(`${s.url}/f/contact`)).text();
    assert.match(page, /no longer accepting responses/);
    const res = await fetch(`${s.url}/api/v1/f/contact/submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 409);
    await s.api(`/api/v1/forms/${contact.id}`, { method: "PATCH", json: { status: "open", submission_limit: 3 } });
    assert.match(await (await fetch(`${s.url}/f/contact`)).text(), /all the responses it can take/);
  });

  test("keys: a person creates and revokes them; a key cannot", async () => {
    assert.equal((await s.api("/api/v1/keys", { method: "POST", json: { name: "by a key" } })).status, 403);
    const cookie = `fc_session=${createSession(s.db, s.demo!.userId, s.demo!.workspaceId)}`;
    const asPerson = { cookie, origin: s.url };
    const res = await s.api("/api/v1/keys", { method: "POST", json: { name: "ci" }, key: null, headers: asPerson });
    assert.equal(res.status, 201);
    const key = await res.json();
    assert.match(key.secret, /^fc_live_/);
    assert.equal((await s.api("/api/v1/forms", { key: key.secret })).status, 200);
    assert.equal((await s.api(`/api/v1/keys/${key.id}`, { method: "DELETE", key: key.secret })).status, 403);
    assert.equal((await s.api(`/api/v1/keys/${key.id}`, { method: "DELETE", key: null, headers: asPerson })).status, 204);
    assert.equal((await s.api("/api/v1/forms", { key: key.secret })).status, 401);
    const listed = (await (await s.api("/api/v1/keys")).json()).items;
    assert.ok(listed.every((k: Record<string, unknown>) => !("secret" in k) && !("key_hash" in k)));
  });

  test("hostile input is refused cleanly", async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${s.url}/api/v1/f/customer-pulse/submissions`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    assert.equal((await post({ data: [1, 2] })).status, 422);
    const forms = (await (await s.api("/api/v1/forms")).json()).items;
    assert.equal((await s.api(`/api/v1/forms/${forms[0].id}/submissions?limit=abc`)).status, 422);
    // A honeypot at the top level is honoured too; nothing is stored.
    const before = (await (await s.api(`/api/v1/forms/${forms.find((f: { slug: string }) => f.slug === "customer-pulse").id}/submissions`)).json()).total;
    assert.equal((await post({ _fc_hp: "x", data: { recommend: "9", easy: "Agree", agents: "Agree" } })).status, 202);
    const after = (await (await s.api(`/api/v1/forms/${forms.find((f: { slug: string }) => f.slug === "customer-pulse").id}/submissions`)).json()).total;
    assert.equal(after, before);
  });

  test("the per-address limit ignores a forged X-Forwarded-For", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await fetch(`${s.url}/api/v1/f/contact/submissions`, {
        method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${i}` },
        body: JSON.stringify({ data: {} }),
      });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), statuses.join(","));
    // Last in the file: the server answers 413 without reading the body, which closes the socket.
    const big = await fetch(`${s.url}/api/v1/f/contact/submissions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { message: "x".repeat(300_000) } }),
    });
    assert.equal(big.status, 413);
  });
});
