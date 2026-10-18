// Shared helpers for the end-to-end suite. Every test creates its own account,
// so tests never depend on each other or on the order they run in.

import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

export { expect };

// faqir-core boots from public/boot.js, after every deferred script (the
// auto-start race is FAQIR-UPSTREAM.md #28; faqir-boot.spec.ts guards the fix).
export const test = base;

export const PASSWORD = "e2e-password-1";

let counter = 0;
/** A unique value per call (per run, per test), safe to use in emails and slugs. */
export function unique(prefix = "e2e"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Sign up through the real form at /signup and wait for the dashboard. */
export async function signUp(page: Page, name = "E2E Tester"): Promise<{ email: string }> {
  const email = `${unique("e2e")}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/app");
  return { email };
}

/** The form definition used by the rule tests: seats is shown and required only for the Team plan. */
export function teamDefinition(title = "Beta waitlist") {
  return {
    schema: {
      title,
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
    appearance: { theme: "aurora", thankYou: { title: "You're on the list", message: "We will be in touch." } },
  };
}

export interface CreatedForm {
  id: string;
  slug: string;
  url: string;
}

/** Create and publish a form through the API with a bearer key. */
export async function createPublishedForm(
  request: APIRequestContext,
  key: string,
  definition: unknown,
  slug = unique("form"),
): Promise<CreatedForm> {
  const headers = { authorization: `Bearer ${key}` };
  const created = await request.post("/api/v1/forms", { headers, data: { definition, slug } });
  expect(created.status(), await created.text()).toBe(201);
  const form = (await created.json()) as { id: string; slug: string };
  const published = await request.post(`/api/v1/forms/${form.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(201);
  return { id: form.id, slug: form.slug, url: `/f/${form.slug}` };
}

/** Create an API key from the signed-in session (no UI) and return its secret. */
export async function createKeyViaSession(page: Page, name = "e2e"): Promise<string> {
  const res = await page.request.post("/api/v1/keys", { data: { name } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
}

/** The faqir-validate / faqir-rules field group that wraps the control named `name`. */
export function fieldGroup(page: Page, name: string) {
  return page.locator('[data-ui="field-group"]').filter({ has: page.locator(`[name="${name}"]`) });
}

/** Record every request the page makes to the public submission endpoint. */
export function watchSubmissions(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/v1\/f\/[^/]+\/submissions/.test(req.url())) seen.push(req.url());
  });
  return seen;
}

/** Wait for the designer's save badge to settle on "All changes saved". */
export async function waitSaved(page: Page) {
  await expect(page.locator("[data-designer-bar]").getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
}

/**
 * Choose the 15th of the month the calendar opens on, in a faqir date-picker
 * (its input is readonly and shows "October 15, 2026"); returns the ISO date.
 */
export async function pickDate(page: Page, name: string): Promise<string> {
  const input = page.locator(`[name="${name}"]`);
  await input.click();
  const picker = page.locator('[data-ui="date-picker"]').filter({ has: input });
  const day = picker.locator('button[data-part="day"]:not([data-outside])').nth(14);
  const iso = await day.getAttribute("data-date");
  await day.click();
  await expect(picker.locator('[data-part="calendar"]')).toBeHidden();
  expect(iso).toMatch(/^\d{4}-\d{2}-15$/);
  return iso!;
}
