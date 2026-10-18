// Guards the boot order: faqir-core's own auto-start can fire between two deferred
// scripts (FAQIR-UPSTREAM.md #28), so the core script carries data-manual and
// public/boot.js starts it last. A slow plugin must still get its rules bound.
import { expect, test } from "@playwright/test";
import { createKeyViaSession, createPublishedForm, fieldGroup, signUp, teamDefinition } from "./helpers.ts";

test.describe("faqir boot order", () => {
  test("a slow plugin script still gets its rules applied", async ({ page, request }) => {
    await signUp(page);
    const key = await createKeyViaSession(page);
    const form = await createPublishedForm(request, key, teamDefinition("Slow plugin"));
    await page.route("**/ui/core/plugins/faqir-rules.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await page.goto(form.url);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(fieldGroup(page, "seats")).toBeHidden({ timeout: 3_000 });
  });
});
