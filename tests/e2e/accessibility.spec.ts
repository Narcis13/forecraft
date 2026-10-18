import { createKeyViaSession, createPublishedForm, expect, signUp, test, unique, watchSubmissions } from "./helpers.ts";

const definition = {
  schema: {
    title: "Newsletter",
    type: "object",
    properties: {
      fullName: { type: "string", title: "Full name" },
      email: { type: "string", format: "email", title: "Email address" },
      frequency: { type: "string", title: "How often", enum: ["Weekly", "Monthly"] },
      consent: { type: "boolean", title: "I agree to be emailed" },
    },
    required: ["fullName", "email", "frequency"],
  },
  appearance: { thankYou: { title: "Subscribed", message: "See you in your inbox." } },
};

async function publish(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  await signUp(page);
  const key = await createKeyViaSession(page);
  return createPublishedForm(request, key, definition, unique("news"));
}

test("a form can be completed with the keyboard alone", async ({ page, request }) => {
  const form = await publish(page, request);
  const submissions = watchSubmissions(page);
  await page.goto(form.url);
  await expect(page.getByRole("heading", { level: 1, name: "Newsletter" })).toBeVisible();

  const focusedName = () => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name ?? document.activeElement?.tagName ?? "");
  // Tab until the first field (the skip link comes first); it must be reachable within a few presses.
  for (let i = 0; i < 4 && (await focusedName()) !== "fullName"; i++) await page.keyboard.press("Tab");
  expect(await focusedName()).toBe("fullName");

  await page.keyboard.type("Grace Hopper");
  await page.keyboard.press("Tab");
  expect(await focusedName()).toBe("email");
  await page.keyboard.type("grace@example.com");
  await page.keyboard.press("Tab");
  expect(await focusedName()).toBe("frequency"); // the radio group: one tab stop
  await page.keyboard.press("ArrowDown"); // Weekly -> Monthly
  await expect(page.getByRole("radio", { name: "Monthly" })).toBeChecked();
  await page.keyboard.press("Tab");
  expect(await focusedName()).toBe("consent");
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "I agree to be emailed" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Submit" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Subscribed" })).toBeVisible();
  expect(submissions).toHaveLength(1);
  const items = (await (await page.request.get(`/api/v1/forms/${form.id}/submissions`)).json()).items;
  expect(items).toHaveLength(1);
  expect(items[0].data).toEqual({ fullName: "Grace Hopper", email: "grace@example.com", frequency: "Monthly", consent: true });
});

test("errors are announced and tied to their fields", async ({ page, request }) => {
  const form = await publish(page, request);
  const submissions = watchSubmissions(page);
  await page.goto(form.url);

  // Every control has an accessible name, and an error slot wired up with aria-describedby.
  for (const label of ["Full name", "Email address"]) {
    const input = page.getByRole("textbox", { name: new RegExp(label) });
    await expect(input).toBeVisible();
    const describedBy = await input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveAttribute("aria-live", "polite");
  }

  await page.getByRole("button", { name: "Submit" }).focus();
  await page.keyboard.press("Enter");
  const nameInput = page.getByRole("textbox", { name: /Full name/ });
  const nameError = page.locator(`#${await nameInput.getAttribute("aria-describedby")}`);
  await expect(nameError).not.toBeEmpty();
  await expect(page.getByRole("textbox", { name: /Full name/ })).toHaveAttribute("aria-invalid", "true");
  await page.waitForTimeout(300);
  expect(submissions).toHaveLength(0);
});

test("with prefers-reduced-motion the page still renders and submits", async ({ page, request }) => {
  const form = await publish(page, request);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await page.goto(form.url);
  await expect(page.getByRole("heading", { level: 1, name: "Newsletter" })).toBeVisible();
  // Content is never left mid-animation: nothing invisible, nothing still moving the form.
  await expect.poll(() => page.evaluate(() => {
    const el = document.querySelector("[data-ui='reveal']") as HTMLElement | null;
    return el ? getComputedStyle(el).opacity : "1";
  })).toBe("1");

  await page.getByLabel("Full name").fill("Alan Turing");
  await page.getByLabel("Email address").fill("alan@example.com");
  await page.getByLabel("Weekly").check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("heading", { name: "Subscribed" })).toBeVisible();
  await expect(page.getByText("See you in your inbox.")).toBeVisible();
});
