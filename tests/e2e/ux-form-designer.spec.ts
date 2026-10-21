// The form designer, after the UX audit (TASK-UX-FIXES.md items 3, 10–14, 16–22, 49, 50, 52):
// each test drives the designer like a person and then reads what the API holds.

import type { Locator, Page } from "@playwright/test";
import { expect, signUp, test, waitSaved, watchErrors } from "./helpers.ts";

const kind = (page: Page, label: string) => page.locator("[data-designer-kind]").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
const card = (page: Page, name: string) => page.locator(`#field-${name}`);
const formId = (page: Page) => page.url().match(/forms\/(frm_[^/]+)\/design/)![1]!;
const stored = async (page: Page) => (await (await page.request.get(`/api/v1/forms/${formId(page)}`)).json());
const sectionFields = (page: Page, si: number) => page.locator("[data-designer-section]").nth(si).locator("[data-designer-field]");

/** Open a new form in the designer and store it (the first change creates it). */
async function newForm(page: Page, title = "UX audit form") {
  await signUp(page);
  await page.getByRole("button", { name: "New form" }).click();
  await page.waitForURL(/\/app\/forms\/new\/design$/);
  await page.locator("#designer-title").fill(title);
  await page.waitForURL(/\/app\/forms\/frm_[^/]+\/design$/);
  await waitSaved(page);
}

/** Replace the working copy through the JSON tab, then go back to Build. */
async function setJson(page: Page, mutate: (def: Record<string, any>) => void) {
  await page.getByRole("tab", { name: "JSON" }).click();
  const def = JSON.parse(await page.locator("#designer-json").inputValue());
  mutate(def);
  await page.locator("#designer-json").fill(JSON.stringify(def, null, 2));
  await page.getByRole("tab", { name: "Build" }).click();
}

/** An HTML5 drag from one card to a point on another element, as the browser dispatches it. */
async function drag(page: Page, from: Locator, to: Locator, at: "top" | "bottom", stale?: Locator) {
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await from.dispatchEvent("dragstart", { dataTransfer: dt });
  if (stale) {
    // An earlier dragover somewhere else must not decide where the drop lands.
    const s = (await stale.boundingBox())!;
    await stale.dispatchEvent("dragover", { dataTransfer: dt, clientX: s.x + 20, clientY: s.y + s.height * 0.75 });
  }
  const box = (await to.boundingBox())!;
  const point = { clientX: box.x + 20, clientY: box.y + box.height * (at === "top" ? 0.25 : 0.75) };
  await to.dispatchEvent("dragover", { dataTransfer: dt, ...point });
  await to.dispatchEvent("drop", { dataTransfer: dt, ...point });
  await from.dispatchEvent("dragend", { dataTransfer: dt });
}

test("#14 opening the designer stores nothing until the first change", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Open the designer" }).click();
  await page.waitForURL(/\/app\/forms\/new\/design$/);
  await expect(page.locator("[data-designer-field]")).toHaveCount(2);
  await expect(page.locator("[data-designer-props]")).toContainText("saved, with its address, on your first change");
  // An abandoned visit leaves no "Untitled form" behind.
  await page.goto("/app");
  expect((await (await page.request.get("/api/v1/forms")).json()).items).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Open the designer" })).toBeVisible();

  // The first change creates the form, once, and the address bar names it.
  await page.getByRole("button", { name: "New form" }).click();
  await page.waitForURL(/\/app\/forms\/new\/design$/);
  await kind(page, "Short text").click();
  await kind(page, "Email").click();
  await page.waitForURL(/\/app\/forms\/frm_[^/]+\/design$/);
  await waitSaved(page);
  const items = (await (await page.request.get("/api/v1/forms")).json()).items;
  expect(items).toHaveLength(1);
  expect(Object.keys((await stored(page)).definition.schema.properties)).toEqual(["name", "email", "shortAnswer", "email2"]);
  await page.reload();
  await expect(page.locator("[data-designer-field]")).toHaveCount(4);
});

test("#3 an empty section saves, is shown and focused, and a refusal reads as a sentence", async ({ page }) => {
  const errors = watchErrors(page);
  await newForm(page);
  await page.getByRole("radiogroup", { name: "Layout of the form" }).getByText("Sections", { exact: true }).click();
  await page.getByRole("button", { name: "Add a section" }).click();
  const title = page.locator("#sec-title-1");
  await expect(title).toBeFocused();
  await expect(title).toBeInViewport();
  await expect(page.locator("[data-designer-section]").nth(1)).toHaveAttribute("data-empty", "");
  await expect(page.locator("[data-designer-section]").nth(1)).toContainText("Empty — drag fields here");
  await waitSaved(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The draft keeps only the sections that hold fields; the canvas keeps the empty one.
  expect((await stored(page)).definition.ui["ui:groups"]).toEqual([{ title: "Section 1", fields: ["name", "email"] }]);

  // Filling it makes it part of the saved form.
  await drag(page, card(page, "email"), page.locator("[data-designer-section]").nth(1).locator("[data-designer-end]"), "top");
  await waitSaved(page);
  expect((await stored(page)).definition.ui["ui:groups"]).toEqual([
    { title: "Section 1", fields: ["name"] },
    { title: "Section 2", fields: ["email"] },
  ]);

  // A definition the renderer refuses: the note names the section, not uiSchema["ui:groups"][0].
  await setJson(page, (d) => { d.ui["ui:groups"][0].fields.push("ghost"); });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("This version cannot be saved yet");
  await expect(alert).toContainText("lists a field that is no longer on the form (ghost)");
  await expect(alert).not.toContainText("uiSchema");
  await expect(alert).not.toContainText("/schema");
  await expect(page.locator("[data-designer-bar]")).toContainText("Not saved");
  expect(errors.pageErrors).toEqual([]);
});

test("#10 #11 repeatable rows: one row of thirds, and a column editor in the inspector", async ({ page }) => {
  await newForm(page);
  await kind(page, "Repeatable rows").click();
  await expect(page.locator("#prop-add-column")).toBeVisible();
  await waitSaved(page);
  let def = (await stored(page)).definition;
  // #11: three thirds fill one row.
  expect(def.ui.lineItems.items).toEqual({ label: { width: "third" }, qty: { width: "third" }, amount: { width: "third" } });

  // Columns: add one, name it, type it, size it, move it first; drop the label column.
  await page.locator("#prop-add-column").click();
  await page.locator("#col-title-3").fill("Unit price");
  await page.locator("#col-type-3").selectOption("number");
  await page.locator("#col-width-3").selectOption("half");
  await page.locator("#col-required-3").check();
  await page.getByRole("button", { name: "Move Unit price earlier" }).click();
  await page.getByRole("button", { name: "Remove column Label" }).click();
  await page.locator("#col-type-0").selectOption("dropdown");
  await page.locator("#col-options-0").fill("Small\nLarge");
  await page.locator("#col-options-0").blur();
  // Rows and buttons.
  await page.locator("#prop-min-rows").fill("2");
  await page.locator("#prop-min-rows").blur();
  await page.locator("#prop-max-rows").fill("5");
  await page.locator("#prop-max-rows").blur();
  await page.locator("#prop-add-label").fill("Add a ticket");
  await page.locator("#prop-remove-label").fill("Remove ticket");
  await waitSaved(page);

  def = (await stored(page)).definition;
  const s = def.schema.properties.lineItems;
  expect(Object.keys(s.items.properties)).toEqual(["qty", "unitPrice", "amount"]);
  expect(s.items.properties.qty).toEqual({ type: "string", title: "Qty", enum: ["Small", "Large"] });
  expect(s.items.properties.unitPrice).toEqual({ type: "number", title: "Unit price" });
  expect(s.items.required).toEqual(["qty", "unitPrice"]);
  expect([s.minItems, s.maxItems]).toEqual([2, 5]);
  expect(def.ui.lineItems).toEqual({
    addLabel: "Add a ticket",
    removeLabel: "Remove ticket",
    items: { qty: { width: "third" }, amount: { width: "third" }, unitPrice: { width: "half" } },
  });
  // The preview renders it: two rows to start, the new labels.
  await page.getByRole("tab", { name: "Preview" }).click();
  const frame = page.frameLocator("#designer-preview");
  await expect(frame.getByRole("button", { name: "Add a ticket" })).toBeVisible();
  await expect(frame.locator('select[name="lineItems[1].qty"]')).toHaveCount(1);
});

test("#12 a field's name follows its label until edited by hand, and locks once published", async ({ page }) => {
  await newForm(page);
  await kind(page, "Short text").click();
  await expect(page.locator("#prop-name")).toHaveValue("shortAnswer");
  await page.locator("#prop-title").fill("Company name");
  await expect(page.locator("#prop-name")).toHaveValue("companyName");
  await expect(card(page, "companyName")).toContainText("Company name");

  // A second one with the same label gets a unique name.
  await kind(page, "Short text").click();
  await page.locator("#prop-title").fill("Company name");
  await expect(page.locator("#prop-name")).toHaveValue("companyName2");
  // Named by hand: the label no longer moves it.
  await page.locator("#prop-name").fill("vatNumber");
  await page.locator("#prop-name").press("Enter");
  await page.locator("#prop-title").fill("VAT number (if any)");
  await expect(page.locator("#prop-name")).toHaveValue("vatNumber");
  await waitSaved(page);
  expect(Object.keys((await stored(page)).definition.schema.properties)).toEqual(["name", "email", "companyName", "vatNumber"]);

  // Published: the name is locked, the label edits only the label, unlocking is explicit.
  await page.locator("#designer-publish").click();
  await expect(page.locator("#designer-publish")).toHaveText(/Published/);
  await card(page, "companyName").click();
  await expect(page.locator("#prop-name")).toHaveAttribute("readonly", "");
  await expect(page.locator("#prop-name-hint")).toContainText("Locked");
  await page.locator("#prop-title").fill("Organisation");
  await expect(page.locator("#prop-name")).toHaveValue("companyName");
  await page.getByRole("button", { name: "Change it anyway" }).click();
  await expect(page.locator("#prop-name")).not.toHaveAttribute("readonly", "");
  await expect(page.locator("#prop-name-hint")).toContainText("breaks reports");
  await page.locator("#prop-name").fill("organisation");
  await page.locator("#prop-name").press("Enter");
  await waitSaved(page);
  expect(Object.keys((await stored(page)).definition.schema.properties)).toContain("organisation");
});

test("#13 #22 the address follows the title until publish; the toast links it; the button tells the state", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await newForm(page, "Workshop orders");
  const first = (await stored(page)).slug as string;
  expect(first).toMatch(/^workshop-orders-[0-9a-f]{6}$/);
  const hex = first.slice(-6);
  await page.locator("#designer-title").fill("Spring workshop");
  await waitSaved(page);
  expect((await stored(page)).slug).toBe(`spring-workshop-${hex}`);
  await expect(page.locator("[data-designer-props]")).toContainText(`/f/spring-workshop-${hex}`);

  // Before publishing: "Publish", no public link yet.
  const publish = page.locator("#designer-publish");
  await expect(publish).toHaveText("Publish");
  await publish.click();

  // The toast: the live address as a link, a Change link to Settings → Public address, a copy button.
  const toast = page.locator("#toasts [data-part='toast']").last();
  const live = toast.locator("a[data-designer-toast-link]");
  await expect(live).toHaveAttribute("href", new RegExp(`/f/spring-workshop-${hex}$`));
  await expect(toast.getByRole("link", { name: "Change" })).toHaveAttribute("href", `/app/forms/${formId(page)}/settings#set-slug`);
  await toast.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/f/spring-workshop-${hex}$`));

  // Published and unchanged: the button says so and does nothing.
  await expect(publish).toHaveText("Published");
  await expect(publish).toBeDisabled();
  await expect(page.locator("[data-designer-bar]").getByRole("link", { name: "Public link" })).toHaveAttribute("href", `/f/spring-workshop-${hex}`);

  // After publishing the address stays, whatever the title does.
  await page.locator("#designer-title").fill("Autumn workshop");
  await expect(publish).toHaveText("Publish changes");
  await expect(publish).toBeEnabled();
  await waitSaved(page);
  expect((await stored(page)).slug).toBe(`spring-workshop-${hex}`);
  // The state survives a reload (the designer reads the published version).
  await page.reload();
  await expect(publish).toHaveText("Publish changes");
  await page.locator("#designer-title").fill("Spring workshop");
  await waitSaved(page);
  await expect(publish).toHaveText("Published");
});

test("#16 #17 number and scale fields: whole or decimal, step, units, default; scale range and end labels", async ({ page }) => {
  await newForm(page);
  await kind(page, "Number").click();
  await page.locator("#prop-title").fill("Seats");
  await page.locator("#prop-number-kind").selectOption("integer");
  await page.locator("#prop-suffix").fill("seats");
  await page.locator("#prop-default").fill("2");
  await page.locator("#prop-default").blur();
  await kind(page, "Number").click();
  await page.locator("#prop-title").fill("Price");
  await page.locator("#prop-number-kind").selectOption("number");
  await page.locator("#prop-step").fill("0.01");
  await page.locator("#prop-step").blur();
  await page.locator("#prop-prefix").fill("€");

  await kind(page, "Scale").click();
  await expect(page.locator("#prop-options")).toHaveCount(0);
  await page.locator("#prop-title").fill("Experience level");
  await page.locator("#prop-scale-to").fill("4");
  await page.locator("#prop-scale-to").blur();
  await page.locator("#prop-min-label").fill("Beginner");
  await page.locator("#prop-max-label").fill("Expert");
  await waitSaved(page);

  const def = (await stored(page)).definition;
  expect(def.schema.properties.seats).toEqual({ type: "integer", title: "Seats", default: 2 });
  expect(def.schema.properties.price).toEqual({ type: "number", title: "Price", multipleOf: 0.01 });
  expect(def.schema.properties.experienceLevel.enum).toEqual(["1", "2", "3", "4"]);
  expect(def.ui.seats).toEqual({ suffix: "seats" });
  expect(def.ui.price).toEqual({ prefix: "€" });
  expect(def.ui.experienceLevel).toEqual({ widget: "scale", minLabel: "Beginner", maxLabel: "Expert" });

  // The public page: the units sit in the inputs, the default is filled in, and the server takes the answers.
  await page.locator("#designer-publish").click();
  await expect(page.locator("#designer-publish")).toHaveText("Published");
  const slug = (await stored(page)).slug;
  await page.goto(`/f/${slug}`);
  const seats = page.locator('[data-forecraft-unit]').filter({ has: page.locator('[name="seats"]') });
  await expect(seats).toContainText("seats");
  await expect(page.locator('[name="seats"]')).toHaveValue("2");
  await expect(page.locator('[name="seats"]')).toHaveAttribute("step", "1");
  await expect(page.locator('[data-forecraft-unit]').filter({ has: page.locator('[name="price"]') })).toContainText("€");
  await expect(page.locator('[name="price"]')).toHaveAttribute("step", "0.01");
  await expect(page.getByText("Beginner")).toBeVisible();
  await expect(page.getByText("Expert")).toBeVisible();
  const res = await page.request.post(`/api/v1/f/${slug}/submissions`, {
    data: { data: { email: "ada@example.com", seats: 3, price: 12.5, experienceLevel: "4" } },
  });
  expect(res.status(), await res.text()).toBe(201);
});

test("#18 rules: comparisons, includes, and/or, hide, and a computed total, enforced on the server too", async ({ page }) => {
  await newForm(page);
  for (const [label, title] of [["Number", "Seats"], ["Number", "Price"], ["Number", "Total"], ["Checkboxes", "Extras"], ["Long text", "Notes"], ["Short text", "Company"]]) {
    await kind(page, label!).click();
    await page.locator("#prop-title").fill(title!);
  }
  await page.getByRole("tab", { name: "Rules" }).click();

  // Total = Seats × Price.
  await page.locator("#rule-verb").selectOption("compute");
  await page.locator("#rule-target").selectOption("total");
  await page.locator("#rule-a").selectOption("seats");
  await page.locator("#rule-math").selectOption("*");
  await page.locator("#rule-b").selectOption("price");
  await page.getByRole("button", { name: "Add rule" }).click();
  // Hide Notes when Seats ≥ 10 or Extras includes "Two".
  await page.locator("#rule-verb").selectOption("hide");
  await page.locator("#rule-target").selectOption("notes");
  await page.locator("#rule-field").selectOption("seats");
  await page.locator("#rule-op").selectOption("gte");
  await page.locator("#rule-value-text").fill("10");
  await page.getByRole("button", { name: "Add a condition" }).click();
  await page.locator("#rule-field-1").selectOption("extras");
  await page.locator("#rule-op-1").selectOption("includes");
  await page.locator("#rule-value-1").selectOption("Two");
  await page.locator("#rule-match").selectOption("any");
  await page.getByRole("button", { name: "Add rule" }).click();
  // Require Company when Seats > 5 and Price < 100.
  await page.locator("#rule-verb").selectOption("require");
  await page.locator("#rule-target").selectOption("company");
  await page.locator("#rule-field").selectOption("seats");
  await page.locator("#rule-op").selectOption("gt");
  await page.locator("#rule-value-text").fill("5");
  await page.getByRole("button", { name: "Add a condition" }).click();
  await page.locator("#rule-field-1").selectOption("price");
  await page.locator("#rule-op-1").selectOption("lt");
  await page.locator("#rule-value-text-1").fill("100");
  await page.getByRole("button", { name: "Add rule" }).click();

  const list = page.locator("#dp-rules ul");
  await expect(list).toContainText("Calculate “Total” = “Seats” × “Price”");
  await expect(list).toContainText("Hide “Notes” when “Seats” is at least 10 or “Extras” includes “Two”");
  await expect(list).toContainText("Require “Company” when “Seats” is more than 5 and “Price” is less than 100");
  await waitSaved(page);
  expect((await stored(page)).definition.rules.rules).toEqual([
    { id: "compute-total", compute: "total", value: { "*": [{ var: "seats" }, { var: "price" }] } },
    { id: "hide-notes", show: "notes", when: { "!": { or: [{ ">=": [{ var: "seats" }, 10] }, { in: ["Two", { var: "extras" }] }] } } },
    { id: "require-company", require: "company", when: { and: [{ ">": [{ var: "seats" }, 5] }, { "<": [{ var: "price" }, 100] }] } },
  ]);

  // The public page runs them as people type.
  await page.locator("#designer-publish").click();
  await expect(page.locator("#designer-publish")).toHaveText("Published");
  const slug = (await stored(page)).slug;
  await page.goto(`/f/${slug}`);
  await page.locator('[name="seats"]').fill("3");
  await page.locator('[name="price"]').fill("2.5");
  await expect(page.locator('[name="total"]')).toHaveValue("7.5");
  await expect(page.locator('[name="total"]')).toHaveAttribute("readonly", "");
  await expect(page.locator('[name="notes"]')).toBeVisible();
  await page.getByLabel("Two").check();
  await expect(page.locator('[name="notes"]')).toBeHidden();

  // The server agrees: it computes the total itself and requires Company for 6 seats under 100.
  const submit = (data: Record<string, unknown>) => page.request.post(`/api/v1/f/${slug}/submissions`, { data: { data } });
  const refused = await submit({ email: "a@example.com", seats: 6, price: 10 });
  expect(refused.status()).toBe(422);
  expect(JSON.stringify(await refused.json())).toContain("company");
  const ok = await submit({ email: "a@example.com", seats: 6, price: 10, company: "Acme", total: 1 });
  expect(ok.status(), await ok.text()).toBe(201);
  const sub = await ok.json();
  const saved = await (await page.request.get(`/api/v1/submissions/${sub.id}`)).json();
  expect(saved.data.total).toBe(60);
});

test("#19 dragging a field onto another lands exactly there, across a scrolled canvas", async ({ page }) => {
  const errors = watchErrors(page);
  await newForm(page);
  await page.setViewportSize({ width: 1280, height: 640 });
  for (const label of ["Number", "Date", "Link", "Single choice", "Dropdown", "Checkboxes", "Scale", "Switch"]) await kind(page, label).click();
  await waitSaved(page);
  const order = async () => page.locator("[data-designer-field]").evaluateAll((els) => els.map((e) => e.id.replace("field-", "")));
  expect(await order()).toEqual(["name", "email", "number", "date", "website", "pickOne", "choose", "pickAny", "howWouldYouRate", "turnItOn"]);

  // Scroll so the canvas is mid-way, then drag the last field onto the top half of the third:
  // a stale dragover on another card first must not decide where it lands.
  await card(page, "pickOne").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await drag(page, card(page, "turnItOn"), card(page, "number"), "top", card(page, "pickAny"));
  await expect.poll(order).toEqual(["name", "email", "turnItOn", "number", "date", "website", "pickOne", "choose", "pickAny", "howWouldYouRate"]);
  // ... and the bottom half of a card means after it.
  await drag(page, card(page, "name"), card(page, "choose"), "bottom");
  await expect.poll(order).toEqual(["email", "turnItOn", "number", "date", "website", "pickOne", "choose", "name", "pickAny", "howWouldYouRate"]);
  await waitSaved(page);
  expect(Object.keys((await stored(page)).definition.schema.properties)).toEqual(await order());

  // A real mouse drag between two cards in view, after scrolling: the same rule.
  await card(page, "date").scrollIntoViewIfNeeded();
  await card(page, "website").dragTo(card(page, "email"), { targetPosition: { x: 40, y: 8 } });
  await expect.poll(order).toEqual(["website", "email", "turnItOn", "number", "date", "pickOne", "choose", "name", "pickAny", "howWouldYouRate"]);
  await expect(page.locator("[data-designer-drop]:visible")).toHaveCount(0);
  expect(errors.pageErrors).toEqual([]);
});

test("#20 Alt+↓ moves one section at a time, into empty sections too", async ({ page }) => {
  await newForm(page);
  await setJson(page, (d) => {
    d.schema.properties.phone = { type: "string", title: "Phone" };
    d.ui = { "ui:groups": [
      { title: "About you", fields: ["name", "email"] },
      { title: "Empty one", fields: [] },
      { title: "Empty two", fields: [] },
      { title: "Contact", fields: ["phone"] },
    ] };
  });
  await expect(page.locator("[data-designer-section]")).toHaveCount(4);
  await expect(page.locator("[data-designer-section][data-empty]")).toHaveCount(2);

  await card(page, "email").focus();
  const where = async () => {
    for (let si = 0; si < 4; si++) if (await page.locator("[data-designer-section]").nth(si).locator("#field-email").count()) return si;
    return -1;
  };
  for (const expected of [1, 2, 3]) {
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(where).toBe(expected);
    await expect(card(page, "email")).toBeFocused();
  }
  expect(await sectionFields(page, 3).evaluateAll((els) => els.map((e) => e.id))).toEqual(["field-email", "field-phone"]);

  // Held down: repeats arrive faster than the canvas can be read; it still steps, never jumps.
  for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(where).toBe(0);
  await card(page, "email").dispatchEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true });
  await expect.poll(where).toBe(1);
  await card(page, "email").dispatchEvent("keydown", { key: "ArrowDown", altKey: true, repeat: true, bubbles: true });
  expect(await where()).toBe(1);

  // An empty section is a drop target of its own (its whole box), not just a line.
  await drag(page, card(page, "phone"), page.locator("[data-designer-section]").nth(2).locator("[data-designer-section-head]"), "top");
  await expect(sectionFields(page, 2)).toHaveCount(1);
  await expect(sectionFields(page, 2).first()).toHaveId("field-phone");
});

test("#21 #49 #50 #52 the inspector shows the form when no field is selected; palette, panes and themes", async ({ page }) => {
  await newForm(page);
  const props = page.locator("[data-designer-props]");
  await expect(props.getByRole("heading", { name: "The form" })).toBeVisible();
  await card(page, "email").click();
  await expect(page.locator("#prop-title")).toHaveValue("Email");
  // Other tabs: the form's own settings.
  for (const tab of ["Rules", "Appearance", "JSON", "Preview"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(props.getByRole("heading", { name: "The form" })).toBeVisible();
  }
  await page.getByRole("tab", { name: "Build" }).click();
  await expect(page.locator("#prop-title")).toHaveValue("Email");
  // A click on the canvas's empty space deselects.
  const canvas = page.locator("[data-designer-center]");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30);
  await expect(props.getByRole("heading", { name: "The form" })).toBeVisible();
  await page.locator("#form-title").fill("Renamed in the inspector");
  await expect(page.locator("#designer-title")).toHaveValue("Renamed in the inspector");
  await page.locator("#form-description").fill("A form about forms.");
  await waitSaved(page);
  expect((await stored(page)).definition.schema.description).toBe("A form about forms.");

  // #49: every palette icon is one the icon set has; Checkbox and Checkboxes differ.
  const icons = await page.locator("[data-designer-kind] [data-icon]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-icon"), getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage]));
  for (const [icon, mask] of icons) expect(mask, `icon ${icon}`).toContain("url(");
  const iconOf = async (label: string) => kind(page, label).locator("[data-icon]").getAttribute("data-icon");
  expect(await iconOf("Checkbox")).not.toBe(await iconOf("Checkboxes"));

  // #50: palette, canvas tabs and properties start at one height, right under the bar.
  const top = async (sel: string) => (await page.locator(sel).boundingBox())!.y;
  const bar = await page.locator("[data-designer-bar]").boundingBox();
  for (const sel of ["[data-designer-palette]", "[data-designer-props]", "[data-designer-center]"]) expect(Math.abs((await top(sel)) - (bar!.y + bar!.height))).toBeLessThanOrEqual(1);
  expect((await top("#designer-tabs [data-part='list']")) - (bar!.y + bar!.height)).toBeLessThanOrEqual(24);

  // #52: themes by name, with a swatch; picking one stores its id.
  await page.getByRole("tab", { name: "Appearance" }).click();
  const themes = page.getByRole("radiogroup", { name: "Theme" });
  await expect(themes.getByText("Swiss document", { exact: true })).toBeVisible();
  await expect(themes.getByText("swiss-document", { exact: true })).toHaveCount(0);
  const swatch = themes.locator("label").filter({ hasText: "Terminal" }).locator("[data-designer-swatch]");
  expect(await swatch.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await themes.getByText("Terminal", { exact: true }).click();
  await waitSaved(page);
  expect((await stored(page)).definition.appearance.theme).toBe("terminal");
});
