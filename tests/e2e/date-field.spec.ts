import { createKeyViaSession, createPublishedForm, expect, pickDate, signUp, test, unique, watchSubmissions } from "./helpers.ts";

test.describe("date fields", () => {
  // The date-picker's input shows display text ("October 15, 2026"); the ISO date is in
  // data-value, which public/form.js pairs() sends (FAQIR-UPSTREAM.md #29).
  test("a visitor can submit a form with a date field", async ({ page, request }) => {
    await signUp(page);
    const key = await createKeyViaSession(page);
    const form = await createPublishedForm(request, key, {
      schema: {
        title: "Appointment",
        type: "object",
        properties: { when: { type: "string", format: "date", title: "Date" } },
        required: ["when"],
      },
    }, unique("date"));
    const submissions = watchSubmissions(page);
    await page.goto(form.url);
    const iso = await pickDate(page, "when");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible({ timeout: 3_000 });
    expect(submissions).toHaveLength(1);
    const list = await page.request.get(`/api/v1/forms/${form.id}/submissions`);
    expect((await list.json()).items[0].data.when).toBe(iso);
  });
});
