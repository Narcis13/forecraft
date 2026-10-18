import { createPublishedForm, expect, fieldGroup, signUp, teamDefinition, test, unique, watchSubmissions } from "./helpers.ts";

test("signup, key, form via the API, public form with rules, submission, dashboard", async ({ page, request }) => {
  // 1. Sign up and land on an empty dashboard.
  await signUp(page);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Create your first form, or ask your agent to" })).toBeVisible();

  // 2. Create an API key from the keys page; the secret is shown once in a readonly input.
  await page.goto("/app/keys");
  await page.getByRole("button", { name: "Create a key" }).click();
  const dialog = page.getByRole("dialog", { name: "Create an API key" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("E2E agent");
  await dialog.getByRole("button", { name: "Create key" }).click();
  const secretInput = page.locator("#key-secret");
  await expect(secretInput).toBeVisible();
  await expect(secretInput).toHaveAttribute("readonly", "");
  const key = await secretInput.inputValue();
  expect(key).toMatch(/^fc_live_/);

  // 3. As an agent: create a form with a rule, then publish it.
  const slug = unique("beta");
  const form = await createPublishedForm(request, key, teamDefinition(), slug);

  // 4. The public form. "seats" is hidden until the plan is Team.
  const submissions = watchSubmissions(page);
  await page.goto(form.url);
  await expect(page.getByRole("heading", { level: 1, name: "Beta waitlist" })).toBeVisible();
  const seats = fieldGroup(page, "seats");
  await expect(seats).toBeHidden();
  await expect(seats).toHaveAttribute("hidden", "");

  await page.getByLabel("Email").fill("team-lead@example.com");
  await page.getByLabel("Team").check();
  await expect(seats).toBeVisible();
  await expect(seats).not.toHaveAttribute("hidden", /.*/);
  // Switching back hides it again, switching to Team shows it.
  await page.getByLabel("Solo").check();
  await expect(seats).toBeHidden();
  await page.getByLabel("Team").check();
  await expect(seats).toBeVisible();

  // 5. Team with no seats: the browser blocks the submit, nothing is sent.
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__noReload = true; });
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(seats.locator('[data-part="error"]')).not.toBeEmpty();
  await expect(seats.locator('[data-part="error"]')).toContainText(/\w/);
  await page.waitForTimeout(500);
  expect(submissions, "no POST should reach the server while seats is missing").toHaveLength(0);
  await expect(page.getByRole("heading", { name: "You're on the list" })).toHaveCount(0);

  // 6. Fill seats: the form goes through without a page navigation.
  await page.getByLabel("Seats").fill("5");
  const sent = page.waitForResponse((r) => r.url().includes(`/api/v1/f/${slug}/submissions`));
  await page.getByRole("button", { name: "Submit" }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "You're on the list" })).toBeVisible();
  await expect(page.getByText("We will be in touch.")).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__noReload), "the page was not reloaded").toBe(true);
  await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0);

  // 7. The owner sees the response in the dashboard (the session cookie is on `page`).
  await page.goto(`/app/forms/${form.id}/submissions`);
  const row = page.getByRole("row").filter({ hasText: "team-lead@example.com" });
  await expect(row).toHaveCount(1);
  await expect(page.getByText("1 response")).toBeVisible();

  // 8. The CSV export carries the answers.
  const csv = await page.request.get(`/api/v1/forms/${form.id}/submissions/export?format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const lines = (await csv.text()).trim().split("\r\n");
  expect(lines[0]).toBe("id,submitted_at,version,email,plan,seats");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("team-lead@example.com,Team,5");
});
