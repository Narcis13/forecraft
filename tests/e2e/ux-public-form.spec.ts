// The public form as the UX audit met it (TASK-UX-FIXES.md items 2, 4, 5, 15,
// 23, 24, 25), on the journey's own "Workshop orders" form: a three-step wizard
// with a dropdown, a date, a number, radios, checkboxes, repeatable rows, a
// scale, a switch, long text and two rules.

import type { Page } from "@playwright/test";
import { createKeyViaSession, createPublishedForm, expect, fieldGroup, signUp, test, unique, watchErrors } from "./helpers.ts";

function workshopDefinition(extra: { date?: Record<string, unknown> } = {}) {
  return {
    schema: {
      title: "Workshop orders",
      type: "object",
      properties: {
        fullName: { type: "string", title: "Full name" },
        email: { type: "string", format: "email", title: "Email" },
        company: { type: "string", title: "Company name" },
        workshop: {
          type: "string", title: "Workshop",
          enum: ["Intro to TypeScript", "Advanced React patterns", "Accessible forms in practice", "Node performance", "Design systems", "Testing with Playwright"],
        },
        date: { type: "string", format: "date", title: "Workshop date", ...extra.date },
        seats: { type: "integer", title: "Seats", minimum: 1, maximum: 20 },
        payment: { type: "string", title: "Payment method", enum: ["Card", "Bank transfer", "Invoice"] },
        extras: { type: "array", title: "Extras", items: { type: "string", enum: ["Lunch", "Recording", "Certificate"] }, uniqueItems: true },
        lineItems: {
          type: "array", title: "Line items",
          items: {
            type: "object",
            properties: { label: { type: "string", title: "Label" }, qty: { type: "integer", title: "Qty", minimum: 1 }, amount: { type: "number", title: "Amount", minimum: 0 } },
            required: ["label", "qty"],
          },
        },
        notes: { type: "string", title: "Notes" },
        level: { type: "string", title: "Your experience level", enum: ["1", "2", "3", "4", "5"] },
        newsletter: { type: "boolean", title: "Subscribe to newsletter" },
      },
      required: ["fullName", "email", "workshop", "date", "seats", "payment"],
    },
    ui: {
      workshop: { widget: "select", width: "third" },
      date: { width: "third" },
      seats: { width: "third" },
      lineItems: { items: { label: { width: "third" }, qty: { width: "third" }, amount: { width: "third" } } },
      notes: { widget: "textarea" },
      level: { widget: "scale", minLabel: "Beginner", maxLabel: "Expert" },
      newsletter: { widget: "switch" },
      "ui:wizard": {
        steps: [
          { title: "About you", fields: ["fullName", "email", "company"] },
          { title: "Booking", fields: ["workshop", "date", "seats", "payment", "extras", "lineItems"] },
          { title: "Feedback", fields: ["notes", "level", "newsletter"] },
        ],
      },
    },
    rules: {
      rules: [
        { id: "company-for-invoice", require: "company", when: { "==": [{ var: "payment" }, "Invoice"] } },
        { id: "show-lineitems", show: "lineItems", when: { "!": { missing: ["extras"] } } },
      ],
    },
    appearance: { theme: "aurora", submitLabel: "Book my seat" },
  };
}

async function publishWorkshop(page: Page, request: Parameters<typeof createPublishedForm>[0], extra = {}) {
  await signUp(page);
  const key = await createKeyViaSession(page);
  return createPublishedForm(request, key, workshopDefinition(extra), unique("workshop"));
}

/** Console warnings, so a rule that cannot find its field fails the test. */
function watchWarnings(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "warning") seen.push(msg.text()); });
  return seen;
}

const control = (page: Page, name: string) => page.locator(`#fc-form [name="${name}"]`);
const dateInput = (page: Page) => page.locator('#fc-form [data-ui="date-picker"] [data-part="input"]');
const errorOf = (page: Page, name: string) => fieldGroup(page, name).locator('[data-part="error"]');
const step = (page: Page, title: string) => page.locator("#fc-form > section").filter({ has: page.getByRole("heading", { name: title }) });

async function fillAboutYou(page: Page, company = "") {
  await control(page, "fullName").fill("Ana Popescu");
  await control(page, "email").fill("ana@example.test");
  if (company) await control(page, "company").fill(company);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(step(page, "Booking")).toBeVisible();
}

test.describe("public form: the Workshop orders wizard", () => {
  test.use({ locale: "en-GB" });

  test("refusals use forecraft's words, in the field's own slot (25)", async ({ page, request }) => {
    const form = await publishWorkshop(page, request);
    await page.goto(form.url);
    await expect(page.locator("#fc-form")).toHaveAttribute("novalidate", "");
    await control(page, "email").fill("not an email");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(errorOf(page, "fullName")).toHaveText("This field is required.");
    await expect(errorOf(page, "email")).toHaveText("Enter a valid email address.");
    await expect(control(page, "fullName")).toBeFocused();
    // Still on step 1: nothing was sent, no browser bubble stopped the submit.
    await expect(step(page, "About you")).toBeVisible();
    await fillAboutYou(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(errorOf(page, "seats")).toHaveText("This field is required.");
    await control(page, "seats").fill("40");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(errorOf(page, "seats")).toHaveText("Enter 20 or less.");
    await expect(errorOf(page, "workshop")).toHaveText("This field is required.");
    await expect(fieldGroup(page, "date").locator('[data-part="error"]')).toHaveText("This field is required.");
  });

  test("a rule-required field shows its *, is checked when leaving the step that requires it, and an untouched switch is sent as false (2, 4c, 4d, 5)", async ({ page, request }) => {
    const errors = watchErrors(page);
    const warnings = watchWarnings(page);
    const form = await publishWorkshop(page, request);
    await page.goto(form.url);
    const companyLabel = fieldGroup(page, "company").locator('[data-part="label"]');
    await expect(companyLabel.locator('[data-part="required"]')).toHaveCount(0);
    await fillAboutYou(page);

    // Line items is hidden whole until an extra is chosen: box, row and buttons.
    const lineItems = page.locator('#fc-form fieldset[data-rules-path="lineItems"]');
    await expect(lineItems).toBeHidden();
    await expect(page.getByRole("button", { name: /Add Line items/ })).toBeHidden();
    await page.getByText("Lunch", { exact: true }).click();
    await expect(lineItems).toBeVisible();
    await page.getByText("Lunch", { exact: true }).click();
    await expect(lineItems).toBeHidden();
    await page.getByText("Recording", { exact: true }).click();
    await expect(lineItems).toBeVisible();
    await control(page, "lineItems[0].label").fill("Recording licence");
    await control(page, "lineItems[0].qty").fill("1");
    await control(page, "lineItems[0].amount").fill("49");

    await control(page, "workshop").selectOption("Node performance");
    await dateInput(page).fill("03/12/2026");
    await dateInput(page).press("Enter");
    await control(page, "seats").fill("2");
    await page.getByText("Invoice", { exact: true }).click();
    // The rule now requires Company name on step 1, and its label says so.
    await expect(companyLabel.locator('[data-part="required"]')).toHaveText("*");

    // Next on step 2 goes back to step 1, to the field, with the error under it.
    await page.getByRole("button", { name: "Next" }).click();
    await expect(step(page, "About you")).toBeVisible();
    await expect(control(page, "company")).toBeFocused();
    await expect(errorOf(page, "company")).toHaveText("This field is required.");
    await control(page, "company").fill("Popescu Digital SRL");
    await expect(errorOf(page, "company")).toHaveText("");

    // Card instead of Invoice: the * goes again.
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByText("Card", { exact: true }).click();
    await expect(companyLabel.locator('[data-part="required"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(step(page, "Feedback")).toBeVisible();
    await control(page, "notes").fill("Please send the invoice to accounting.");

    const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/submissions"));
    await page.getByRole("button", { name: "Book my seat" }).click();
    const body = (await sent).postDataJSON() as { data: Record<string, unknown> };
    expect(body.data.newsletter).toBe(false);
    await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();

    const list = await (await page.request.get(`/api/v1/forms/${form.id}/submissions`)).json();
    const data = list.items[0].data;
    expect(data.newsletter).toBe(false);
    expect(data.date).toBe("2026-12-03");
    expect(data.lineItems).toEqual([{ label: "Recording licence", qty: 1, amount: 49 }]);
    expect(warnings.filter((w) => w.includes("l-rules"))).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });

  test("a server refusal lands on its field and its step, and the summary names the field (4a, 4b)", async ({ page, request }) => {
    const form = await publishWorkshop(page, request);
    await page.goto(form.url);
    await fillAboutYou(page, "Popescu Digital SRL");
    await control(page, "workshop").selectOption("Intro to TypeScript");
    await dateInput(page).fill("03/12/2026");
    await dateInput(page).press("Enter");
    await control(page, "seats").fill("3");
    await page.getByText("Invoice", { exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(step(page, "Feedback")).toBeVisible();

    // The answers leave the page without Company name, as an older tab or a
    // stale definition might send them: the server's own 422 comes back.
    await page.route("**/submissions", async (route) => {
      const body = route.request().postDataJSON() as { data: Record<string, unknown> };
      delete body.data.company;
      await route.continue({ postData: JSON.stringify(body) });
    });
    await page.getByRole("button", { name: "Book my seat" }).click();

    await expect(step(page, "About you")).toBeVisible();
    await expect(errorOf(page, "company")).toHaveText("This field is required.");
    await expect(fieldGroup(page, "company")).toHaveAttribute("data-state", "invalid");
    await expect(control(page, "company")).toBeFocused();
    await expect(page.locator('[data-form-actions] [role="alert"]')).toHaveText("Company name is required.");

    // Fixed and sent again (without the interference), it goes through.
    await page.unroute("**/submissions");
    await control(page, "company").fill("Popescu Digital SRL");
    await expect(errorOf(page, "company")).toHaveText("");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Book my seat" }).click();
    await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  });

  test("a third-width dropdown shows the whole of its choice (23)", async ({ page, request }) => {
    const form = await publishWorkshop(page, request);
    await page.goto(form.url);
    await fillAboutYou(page);
    const select = control(page, "workshop");
    await select.selectOption("Accessible forms in practice");
    await expect(select).toHaveAttribute("title", "Accessible forms in practice");
    // The text fits inside the closed select: measured with the select's own font.
    const fit = await select.evaluate((el: HTMLSelectElement) => {
      const style = getComputedStyle(el);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = ctx.measureText(el.options[el.selectedIndex].text).width;
      return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - text;
    });
    expect(fit).toBeGreaterThanOrEqual(0);
    // Date and seats still share a row.
    const date = await fieldGroup(page, "date").boundingBox();
    const seats = await fieldGroup(page, "seats").boundingBox();
    expect(Math.abs(date!.y - seats!.y)).toBeLessThan(2);
  });
});

test.describe("public form: the date field (15)", () => {
  test.use({ locale: "en-GB" });

  test("typed in the visitor's format, Monday first, with month and year selects", async ({ page, request }) => {
    const errors = watchErrors(page);
    const form = await publishWorkshop(page, request);
    await page.goto(form.url);
    await fillAboutYou(page);
    const input = dateInput(page);
    await expect(input).toHaveAttribute("placeholder", "dd/mm/yyyy");
    await expect(input).not.toHaveAttribute("readonly", /.*/);

    // An impossible date is refused in the field, in the visitor's format.
    await input.fill("31/02/2026");
    await input.press("Tab");
    await expect(fieldGroup(page, "date").locator('[data-part="error"]')).toHaveText(/^Enter a date like \d{2}\/\d{2}\/\d{4}\.$/);
    await expect(control(page, "date")).toHaveValue("");

    // A real one is the ISO value, written back in the visitor's format.
    await input.fill("3.12.2026");
    await input.press("Enter");
    await expect(control(page, "date")).toHaveValue("2026-12-03");
    await expect(input).toHaveValue("03/12/2026");
    await expect(fieldGroup(page, "date").locator('[data-part="error"]')).toHaveText("");

    // The calendar: weeks start on Monday, and a year away is two selects away.
    await input.click();
    const calendar = page.locator('#fc-form [data-ui="calendar"]');
    await expect(calendar.locator("thead th").first()).toHaveText("Mo");
    await expect(calendar.locator("[data-fc-month]")).toHaveValue("11");
    await calendar.locator("[data-fc-year]").selectOption("1990");
    await calendar.locator("[data-fc-month]").selectOption("4");
    await calendar.locator('button[data-date="1990-05-14"]').click();
    await expect(control(page, "date")).toHaveValue("1990-05-14");
    await expect(input).toHaveValue("14/05/1990");
    // 1 May 1990 was a Tuesday: the first row starts on Monday 30 April.
    await input.click();
    await expect(calendar.locator('button[data-part="day"]').first()).toHaveAttribute("data-date", "1990-04-30");
    expect(errors.pageErrors).toEqual([]);
  });

  test("the earliest and latest date bound the calendar and what can be typed", async ({ page, request }) => {
    const form = await publishWorkshop(page, request, { date: { formatMinimum: "2026-01-05", formatMaximum: "2026-12-20" } });
    await page.goto(form.url);
    await fillAboutYou(page);
    const input = dateInput(page);
    await input.fill("01/01/2026");
    await input.press("Tab");
    await expect(fieldGroup(page, "date").locator('[data-part="error"]')).toHaveText("Choose a date on or after 05/01/2026.");
    await input.fill("24/12/2026");
    await input.press("Tab");
    await expect(fieldGroup(page, "date").locator('[data-part="error"]')).toHaveText("Choose a date on or before 20/12/2026.");
    await input.fill("");
    await input.click();
    const calendar = page.locator('#fc-form [data-ui="calendar"]');
    await expect(calendar.locator("[data-fc-year] option")).toHaveText(["2026"]);
    await calendar.locator("[data-fc-month]").selectOption("0");
    await expect(calendar.locator('button[data-date="2026-01-04"]')).toHaveAttribute("aria-disabled", "true");
    await expect(calendar.locator('[data-part="nav-prev"]')).toBeDisabled();
  });
});

test.describe("public form: the date field in en-US (15)", () => {
  test.use({ locale: "en-US" });

  test("month first, Sunday first", async ({ page, request }) => {
    const form = await publishWorkshop(page, request);
    await page.goto(form.url);
    await fillAboutYou(page);
    const input = dateInput(page);
    await expect(input).toHaveAttribute("placeholder", "mm/dd/yyyy");
    await input.fill("12/3/2026");
    await input.press("Enter");
    await expect(control(page, "date")).toHaveValue("2026-12-03");
    await expect(input).toHaveValue("12/03/2026");
    await input.click();
    await expect(page.locator('#fc-form [data-ui="calendar"] thead th').first()).toHaveText("Su");
  });
});

test.describe("public form on a phone (24)", () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: "en-GB" });

  test("the date is full width, the rows box keeps its distance, and nothing scrolls sideways", async ({ page, request }) => {
    const form = await publishWorkshop(page, request);
    await page.goto(form.url);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await sideways()).toBe(0);
    await fillAboutYou(page);
    await page.getByText("Lunch", { exact: true }).click();

    const date = await page.locator('#fc-form [data-ui="date-picker"] [data-part="trigger"]').boundingBox();
    const seats = await control(page, "seats").boundingBox();
    expect(Math.abs(date!.width - seats!.width)).toBeLessThan(2);

    const lastChoice = await page.getByText("Certificate", { exact: true }).boundingBox();
    const box = await page.locator('#fc-form fieldset[data-rules-path="lineItems"]').boundingBox();
    expect(box!.y - (lastChoice!.y + lastChoice!.height)).toBeGreaterThanOrEqual(16);
    expect(await sideways()).toBe(0);

    await dateInput(page).click();
    expect(await sideways()).toBe(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Next" }).click();
    expect(await sideways()).toBe(0);
  });
});
