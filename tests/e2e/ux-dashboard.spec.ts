// The dashboard as a person meets it (TASK-UX-FIXES.md items 26–28, 43–48, 53, 54):
// the app bar, the forms list, the responses table, shortcut hints per platform,
// the first API key, and the marketing pages' first paint.

import type { Browser, Page } from "@playwright/test";
import {
  createKeyViaSession, createPublishedForm, DEMO_EMAIL, DEMO_PASSWORD, expect, PASSWORD, signIn, signUp, test, unique, watchErrors,
} from "./helpers.ts";

/** A small order form with one field of each kind the responses table formats. */
function ordersDefinition(title = "Workshop orders") {
  return {
    schema: {
      title,
      type: "object",
      properties: {
        name: { type: "string", title: "Your name" },
        email: { type: "string", format: "email", title: "Email" },
        workshop: { type: "string", title: "Workshop", enum: ["ts", "react"] },
        start: { type: "string", format: "date", title: "Start date" },
        notes: { type: "string", title: "Anything else" },
        newsletter: { type: "boolean", title: "Newsletter" },
        extras: { type: "array", title: "Extras", items: { type: "string", enum: ["lunch", "parking"] } },
        lines: {
          type: "array",
          title: "Line items",
          items: { type: "object", properties: { label: { type: "string", title: "Item" }, qty: { type: "integer", title: "Qty" } } },
        },
      },
      required: ["email"],
    },
    ui: {
      workshop: { enumLabels: ["Intro to TypeScript", "Advanced React"] },
      notes: { widget: "textarea" },
      extras: { enumLabels: ["Lunch", "Parking"] },
    },
  };
}

const ORDER = {
  name: "Ana Popescu",
  email: "ana@example.test",
  workshop: "react",
  start: "2026-12-03",
  notes: "Vegetarian lunch, please.",
  newsletter: true,
  extras: ["lunch", "parking"],
  lines: [{ label: "Seat", qty: 2 }, { label: "Book", qty: 1 }],
};

/** Sign up, publish the order form through the API and submit one order. */
async function formWithOneOrder(page: Page) {
  await signUp(page);
  const key = await createKeyViaSession(page);
  const form = await createPublishedForm(page.request, key, ordersDefinition());
  const sent = await page.request.post(`/api/v1/f/${form.slug}/submissions`, { data: { data: ORDER } });
  expect(sent.status(), await sent.text()).toBe(201);
  return { ...form, key };
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test("the app bar holds the page title on its centre line, on the forms list and on a form page", async ({ page }) => {
  const errors = watchErrors(page);
  const form = await formWithOneOrder(page);
  for (const path of ["/app", `/app/forms/${form.id}/submissions`]) {
    await page.goto(path);
    const bar = await box(page, '[data-app] > [data-part="header"]');
    const h1 = await box(page, '[data-app] > [data-part="header"] h1');
    expect(h1.y, `${path}: the title starts inside the bar`).toBeGreaterThanOrEqual(bar.y);
    expect(h1.y + h1.height, `${path}: the title ends above the bar's border`).toBeLessThanOrEqual(bar.y + bar.height - 4);
    expect(Math.abs(h1.y + h1.height / 2 - (bar.y + bar.height / 2)), `${path}: centred`).toBeLessThan(4);
  }
  expect(errors.pageErrors).toEqual([]);
});

test("forms list: stat figures in lining sans, a full-height filter, the email ellipsised with a tooltip", async ({ page }) => {
  const errors = watchErrors(page);
  // A long address, so the sidebar has to cut it.
  const email = `${unique("a-rather-long-address-for-the-sidebar")}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Long Address");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/app");
  const key = await createKeyViaSession(page);
  await createPublishedForm(page.request, key, ordersDefinition("Stats form"));
  await page.goto("/app");

  // 45: the big numbers are not set in the heading serif (its "1" reads as "l").
  const value = page.locator('[data-ui="stat"] [data-part="value"]').first();
  await expect(value).toHaveText("1");
  const font = await value.evaluate((el) => getComputedStyle(el));
  expect(font.fontFamily).not.toContain("Instrument Serif");
  expect(font.fontVariantNumeric).toContain("lining-nums");

  // 46: the quick filter is as tall as an input.
  const filter = page.getByRole("searchbox", { name: "Filter forms" });
  const heights = await filter.evaluate((el) => ({
    filter: el.getBoundingClientRect().height,
    input: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--input-height")),
  }));
  expect(heights.input).toBeGreaterThanOrEqual(36);
  expect(Math.abs(heights.filter - heights.input)).toBeLessThanOrEqual(1);

  // 48: the address is cut with an ellipsis and carried whole in a tooltip.
  const name = page.locator('[data-part="sidebar-user-name"]');
  await expect(name).toHaveAttribute("title", email);
  const cut = await name.evaluate((el) => ({ overflow: getComputedStyle(el).textOverflow, clipped: el.scrollWidth > el.clientWidth }));
  expect(cut).toEqual({ overflow: "ellipsis", clipped: true });
  expect(errors.pageErrors).toEqual([]);
});

test("the empty dashboard: a gap between the empty state and the two how-to cards, and the API key offer", async ({ page }) => {
  const errors = watchErrors(page);
  await signUp(page);

  // 44: the empty-state card and the cards below it do not touch.
  const empty = await box(page, '[data-ui="card"][data-size="lg"]');
  const howTo = await box(page, '[data-ui="card"]:has(h3)');
  expect(howTo.y - (empty.y + empty.height)).toBeGreaterThanOrEqual(12);

  // 53: the signup copy promised a key; the first screen hands it over, once.
  const offer = page.locator("[data-key-cta]");
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Create your API key" }).click();
  const dialog = page.getByRole("dialog", { name: "Create an API key" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("My agent");
  await dialog.getByRole("button", { name: "Create key" }).click();
  const secret = await page.locator("#key-secret").inputValue();
  expect(secret).toMatch(/^fc_live_/);
  expect(page.url()).not.toContain(secret);
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.waitForLoadState("load");
  await expect(page.locator("[data-key-cta]")).toHaveCount(0);
  expect(page.url()).not.toContain("fc_live_");

  // The key works, and the keys page lists it by prefix only.
  const res = await page.request.get("/api/v1/forms", { headers: { authorization: `Bearer ${secret}` } });
  expect(res.status()).toBe(200);
  await page.goto("/app/keys");
  await expect(page.getByRole("row").filter({ hasText: "My agent" })).toHaveCount(1);
  expect(await page.content()).not.toContain(secret);
  expect(errors.pageErrors).toEqual([]);
});

test("responses: sensible default columns, a column chooser remembered per form, readable details", async ({ page }) => {
  const errors = watchErrors(page);
  const form = await formWithOneOrder(page);
  await page.goto(`/app/forms/${form.id}/submissions`);
  const header = (name: string) => page.locator('#responses [data-part="thead"] th').filter({ hasText: new RegExp(`^${name}`) });

  // One-line answers are the columns; long text, booleans past the first four and rows wait in the chooser.
  for (const shown of ["Your name", "Email", "Workshop", "Start date"]) await expect(header(shown)).toBeVisible();
  for (const hidden of ["Anything else", "Newsletter", "Line items"]) await expect(header(hidden)).toBeHidden();

  // Values read like the rest of the dashboard: a choice by its label, a date in words.
  const row = page.locator("#responses tbody tr").filter({ has: page.locator('[data-part="row-toggle"]') });
  await expect(row).toContainText("Advanced React");
  await expect(row).toContainText("3 Dec 2026");
  await expect(row).not.toContainText("2026-12-03");

  // 28: the search box shows its whole placeholder.
  const fits = await page.locator("#sub-q").evaluate((el: HTMLInputElement) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText(el.placeholder).width <= el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  });
  expect(fits).toBe(true);

  // Choose columns: add Newsletter, drop Email.
  await page.getByRole("button", { name: "Columns" }).click();
  const chooser = page.locator("[data-column-chooser]");
  await expect(chooser).toBeVisible();
  await chooser.getByLabel("Newsletter").check();
  await chooser.getByLabel("Email").uncheck();
  await expect(header("Newsletter")).toBeVisible();
  await expect(header("Email")).toBeHidden();
  await expect(row).toContainText("Yes");

  // Remembered for this form after a reload…
  await page.reload();
  await expect(header("Newsletter")).toBeVisible();
  await expect(header("Email")).toBeHidden();
  // …and back to the defaults on request.
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("button", { name: "Back to the defaults" }).click();
  await expect(header("Email")).toBeVisible();
  await expect(header("Newsletter")).toBeHidden();
  await page.keyboard.press("Escape");

  // The expanded response: a grid of answers, two or three to a row, formatted, rows as a table.
  await row.getByRole("button", { name: "View" }).click();
  const answers = page.locator("dl[data-answers]").first();
  await expect(answers).toBeVisible();
  const columns = await answers.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBeGreaterThanOrEqual(2);
  const pair = (term: string) => answers.locator("div").filter({ has: page.locator(`dt:text-is("${term}")`) });
  await expect(pair("Workshop").locator("dd")).toHaveText("Advanced React");
  await expect(pair("Start date").locator("dd")).toHaveText("3 Dec 2026");
  await expect(pair("Newsletter").locator("dd")).toHaveText("Yes");
  await expect(pair("Extras").locator("dd")).toHaveText("Lunch, Parking");
  const lines = pair("Line items").locator("table");
  await expect(lines.locator("th")).toHaveText(["Item", "Qty"]);
  await expect(lines.locator("tbody tr")).toHaveCount(2);
  // Two answers side by side share a row.
  const a = await pair("Your name").boundingBox();
  const b = await pair("Email").boundingBox();
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(errors.pageErrors).toEqual([]);
});

test("the header's publish button appears only when there is something to publish", async ({ page }) => {
  const form = await formWithOneOrder(page);
  const actions = page.locator("[data-app-actions]");

  // Live and unchanged: nothing to publish, so no primary "Republish".
  await page.goto(`/app/forms/${form.id}/submissions`);
  await expect(actions.getByRole("link", { name: "Design" })).toBeVisible();
  await expect(actions.getByRole("button", { name: /publish/i })).toHaveCount(0);

  // An edit to the draft: "Publish changes" is the primary action.
  const headers = { authorization: `Bearer ${form.key}` };
  const changed = await page.request.patch(`/api/v1/forms/${form.id}`, { headers, data: { definition: ordersDefinition("Workshop orders, 2027") } });
  expect(changed.status(), await changed.text()).toBe(200);
  await page.reload();
  const publish = actions.getByRole("button", { name: "Publish changes" });
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("data-variant", "primary");

  // A form never published says "Publish".
  const draft = await page.request.post("/api/v1/forms", { headers, data: { definition: ordersDefinition("Never published") } });
  const draftId = ((await draft.json()) as { id: string }).id;
  await page.goto(`/app/forms/${draftId}/submissions`);
  await expect(actions.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
});

/** A page whose browser reports `platform` (as navigator.platform and userAgentData.platform). */
async function pageOn(browser: Browser, platform: "mac" | "other"): Promise<Page> {
  const [legacy, modern] = platform === "mac" ? ["MacIntel", "macOS"] : ["Win32", "Windows"];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([l, m]) => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => l, configurable: true });
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ platform: m, brands: [], mobile: false }), configurable: true });
  }, [legacy, modern]);
  return context.newPage();
}

test("shortcut hints say ⌘ on a Mac and Ctrl elsewhere, in the bar and in both designers", async ({ browser }) => {
  for (const platform of ["mac", "other"] as const) {
    const page = await pageOn(browser, platform);
    const errors = watchErrors(page);
    const mac = platform === "mac";
    await signIn(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page.locator('[data-palette-button] [data-ui="kbd"]')).toHaveText(mac ? "⌘K" : "Ctrl K");

    const forms = (await (await page.request.get("/api/v1/forms")).json()) as { items: { id: string }[] };
    await page.goto(`/app/forms/${forms.items[0]!.id}/design`);
    await expect(page.locator("[data-designer-bar]").getByRole("button", { name: mac ? "Undo (⌘Z)" : "Undo (Ctrl+Z)" })).toBeAttached();
    await expect(page.locator("[data-designer-bar]").getByRole("button", { name: mac ? "Redo (⇧⌘Z)" : "Redo (Ctrl+Shift+Z)" })).toBeAttached();
    const keyboard = page.locator("[data-designer-props]").getByText(/^Keyboard:/);
    await expect(keyboard).toContainText(mac ? "⌥↑/↓ to move it" : "Alt+↑/↓ to move it");
    await expect(keyboard).toContainText(mac ? "⌘Z / ⇧⌘Z to undo and redo" : "Ctrl+Z / Ctrl+Shift+Z to undo and redo");

    const reports = (await (await page.request.get("/api/v1/reports")).json()) as { items: { id: string }[] };
    await page.goto(`/app/reports/${reports.items[0]!.id}/design`);
    await expect(page.getByRole("button", { name: mac ? "Undo (⌘Z)" : "Undo (Ctrl+Z)" })).toBeAttached();
    expect(errors.pageErrors).toEqual([]);
    await page.context().close();
  }
});

test("signup continues the marketing site's look: dark skin, the site bar, the card painted at once", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  const landing = await page.evaluate(() => ({ skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme }));
  await page.goto("/signup");
  const signup = await page.evaluate(() => ({ skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme }));
  expect(signup).toEqual(landing);
  expect(signup.theme).toBe("dark");
  // The wordmark is the site bar's, not a link floating beside the card.
  await expect(page.locator('[data-ui="site-header"] [data-part="brand"]')).toBeVisible();
  await expect(page.locator("[data-app-brand]")).toHaveCount(0);
  // The card is there at once: nothing on the page fades in from transparent.
  const card = page.locator('[data-ui="auth-form"] [data-ui="card"]');
  expect(await card.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  expect(await page.evaluate(() => document.querySelector("main")!.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByText("Your API key is one click away on the first screen.")).toBeVisible();
  expect(errors.pageErrors).toEqual([]);
});

test("the landing hero is painted on the first frame, not faded in", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const hero = await page.evaluate(() => {
    const section = document.querySelector('[data-ui="hero"]')!;
    const parts = [...section.querySelectorAll('[data-part="headline"], [data-part="description"], [data-part="actions"], [data-part="media"]')];
    const fades = section.getAnimations({ subtree: true }).filter((a) => {
      const effect = a.effect as KeyframeEffect | null;
      return effect?.getKeyframes().some((k) => "opacity" in k);
    });
    return { opacities: parts.map((p) => getComputedStyle(p).opacity), fades: fades.length };
  });
  expect(hero.opacities.length).toBe(4);
  expect(hero.opacities.every((o) => o === "1")).toBe(true);
  expect(hero.fades).toBe(0);
  await expect(page.getByRole("heading", { level: 1, name: /Forms your\s*agent\s*can build\./ })).toBeVisible();
  expect(errors.pageErrors).toEqual([]);
});

test("phone width: the app bar keeps one line and no page scrolls sideways", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const form = await formWithOneOrder(page);
  for (const path of ["/app", `/app/forms/${form.id}/submissions`]) {
    await page.goto(path);
    const bar = await box(page, '[data-app] > [data-part="header"]');
    const h1 = await box(page, '[data-app] > [data-part="header"] h1');
    expect(h1.y + h1.height, path).toBeLessThanOrEqual(bar.y + bar.height - 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  for (const path of ["/", "/signup"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  await context.close();
});
