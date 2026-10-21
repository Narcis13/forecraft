import { expect, signUp, test, waitSaved, watchSubmissions } from "./helpers.ts";

const kind = (page: import("@playwright/test").Page, label: string) => page.locator("[data-designer-kind]").filter({ hasText: label });
const card = (page: import("@playwright/test").Page, name: string) => page.locator(`#field-${name}`);

test("a person builds a wizard form in the designer, publishes it and a visitor fills it on a phone", async ({ page }) => {
  await signUp(page);

  // Empty state -> the designer, with the starter form (name + email).
  await page.getByRole("button", { name: "Open the designer" }).click();
  await page.waitForURL(/\/app\/forms\/new\/design$/);
  await expect(page.locator("[data-designer-field]")).toHaveCount(2);
  // A tall viewport keeps source and target of every drag on screen: if Playwright has to scroll the
  // page between mouse-down and the first move, Chromium starts the native drag from the wrong card.
  await page.setViewportSize({ width: 1440, height: 1500 });

  // 1. Drag five different field types from the palette onto the canvas.
  const end = () => page.locator("[data-designer-end]").last();
  for (const label of ["Number", "Single choice", "Checkboxes", "Link", "Dropdown"]) {
    await kind(page, label).dragTo(end());
  }
  await expect(page.locator("[data-designer-field]")).toHaveCount(7);
  await expect(page.locator("[data-designer-field]").filter({ hasText: "Checkboxes" })).toHaveCount(1);

  // 2. Sections: everything starts in one section; add a second and drag two fields into it.
  const layout = page.getByRole("radiogroup", { name: "Layout of the form" });
  await layout.getByText("Sections", { exact: true }).click();
  await expect(page.locator("[data-designer-section]")).toHaveCount(1);
  await page.getByRole("button", { name: "Add a section" }).click();
  await expect(page.locator("[data-designer-section]")).toHaveCount(2);
  const second = page.locator("[data-designer-section]").nth(1);
  await card(page, "website").dragTo(second.locator("[data-designer-end]"));
  await card(page, "choose").dragTo(second.locator("[data-designer-end]"));
  await expect(second.locator("[data-designer-field]")).toHaveCount(2);
  await expect(page.locator("[data-designer-section]").first().locator("[data-designer-field]")).toHaveCount(5);

  // 3. A show-when rule: show "Website" only when "Pick one" is "Option B".
  await page.getByRole("tab", { name: "Rules" }).click();
  await page.locator("#rule-verb").selectOption("show");
  await page.locator("#rule-target").selectOption("website");
  await page.locator("#rule-field").selectOption("pickOne");
  await page.locator("#rule-op").selectOption("eq");
  await page.locator("#rule-value").selectOption("Option B");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Show “Website” when “Pick one” is “Option B”")).toBeVisible();

  // 4. Wizard: the two sections become two steps.
  await page.getByRole("tab", { name: "Build" }).click();
  await layout.getByText("Wizard", { exact: true }).click();
  await expect(page.getByText("Step 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Step 2", { exact: true })).toBeVisible();
  await expect(page.locator("[data-designer-section]")).toHaveCount(2);

  // 5. Appearance: a theme.
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByRole("radiogroup", { name: "Theme" }).getByText("Aurora", { exact: true }).click();
  await page.locator("#look-thanks-title").fill("Thanks from the wizard");

  // 6. Saved, then published. The first change stored the form; the address bar names it now.
  await waitSaved(page);
  const formId = page.url().match(/forms\/(frm_[^/]+)\/design/)![1];
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Published version 1/).first()).toBeVisible();

  // 7. What the API now holds.
  const res = await page.request.get(`/api/v1/forms/${formId}`);
  expect(res.status()).toBe(200);
  const form = await res.json();
  expect(form.published_version).toBe(1);
  const def = form.definition;
  expect(def.ui["ui:wizard"].steps).toHaveLength(2);
  expect(def.ui["ui:wizard"].steps[1].fields).toEqual(["website", "choose"]);
  expect(def.ui["ui:groups"]).toBeUndefined();
  expect(def.rules.rules.some((r: { show?: string }) => r.show === "website")).toBe(true);
  expect(def.appearance.theme).toBe("aurora");
  expect(Object.keys(def.schema.properties).length).toBeGreaterThanOrEqual(7);

  // 8. A visitor on a phone: step 1, Next, step 2, submit, thank-you.
  await page.setViewportSize({ width: 390, height: 844 });
  const submissions = watchSubmissions(page);
  await page.goto(`/f/${form.slug}`);
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByLabel("Your name").fill("Ada Phone");
  await page.getByLabel("Email").fill("ada.phone@example.com");
  await page.getByLabel("Number", { exact: true }).fill("42");
  await page.getByLabel("Option B").check();
  await page.getByLabel("Two").check();
  await page.getByRole("button", { name: /^Next/ }).click();

  // Step 2 now: "Website" was revealed by the rule (Option B).
  await expect(page.getByLabel("Website")).toBeVisible();
  await page.getByLabel("Website").fill("https://example.com/ada");
  await page.getByLabel("Choose", { exact: true }).selectOption("Third");
  expect(submissions).toHaveLength(0);
  await page.getByRole("button", { name: /^(Submit|Send)/ }).click();
  await expect(page.getByRole("heading", { name: "Thanks from the wizard" })).toBeVisible();
  expect(submissions).toHaveLength(1);

  // 9. Dashboard table + CSV carry the answers.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/app/forms/${formId}/submissions`);
  await expect(page.getByRole("row").filter({ hasText: "ada.phone@example.com" })).toHaveCount(1);
  const csv = await (await page.request.get(`/api/v1/forms/${formId}/submissions/export?format=csv`)).text();
  const lines = csv.trim().split("\r\n");
  expect(lines).toHaveLength(2);
  for (const needle of ["Ada Phone", "ada.phone@example.com", "42", "Option B", "Two", "https://example.com/ada", "Third"]) expect(lines[1]).toContain(needle);
});
