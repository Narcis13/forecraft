import { createKeyViaSession, createPublishedForm, expect, signUp, teamDefinition, test, unique } from "./helpers.ts";

test("the server rejects what the browser would block", async ({ page, request }) => {
  await signUp(page);
  const key = await createKeyViaSession(page);
  const form = await createPublishedForm(request, key, teamDefinition("Server rules"));
  const endpoint = `/api/v1/f/${form.slug}/submissions`;

  // A team without seats: 422 problem+json, naming the field and the rule.
  const bad = await request.post(endpoint, { data: { data: { email: "x@y.co", plan: "Team" } } });
  expect(bad.status()).toBe(422);
  expect(bad.headers()["content-type"]).toContain("application/problem+json");
  const problem = await bad.json();
  expect(problem.status).toBe(422);
  expect(problem.errors[0].field).toBe("seats");
  expect(problem.errors[0].rule).toBe("required");
  expect(problem.errors[0].pointer).toBe("/seats");

  // The same request without the key is public, but a malformed email is still refused.
  const badEmail = await request.post(endpoint, { data: { data: { email: "not-an-email", plan: "Solo" } } });
  expect(badEmail.status()).toBe(422);
  expect((await badEmail.json()).errors.some((e: { field: string }) => e.field === "email")).toBe(true);

  // Nothing was stored by the refused requests.
  const list = await page.request.get(`/api/v1/forms/${form.id}/submissions`);
  expect((await list.json()).total).toBe(0);

  // And the same data with seats is accepted (201), with a form-encoded body like the browser sends.
  const ok = await request.post(endpoint, { form: { email: "team@example.com", plan: "Team", seats: "5" } });
  expect(ok.status(), await ok.text()).toBe(201);
  expect((await (await page.request.get(`/api/v1/forms/${form.id}/submissions`)).json()).total).toBe(1);

  // An unpublished or unknown form is not a submission target.
  const missing = await request.post(`/api/v1/f/${unique("nope")}/submissions`, { data: { data: {} } });
  expect(missing.status()).toBe(404);
});
