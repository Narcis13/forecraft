// `node scripts/screenshots.ts`: the acceptance screenshots in docs/screenshots/,
// taken in headless Chromium against a fresh, seeded database.

import { serve } from "@hono/node-server";
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db/index.ts";
import { closeBrowser } from "../src/reports/pdf.ts";
import { DEMO_EMAIL, seedDemo } from "../src/seed.ts";
import { seedReports } from "../src/seed-reports-run.ts";

const PORT = 3322;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(import.meta.dirname, "../docs/screenshots");
const PASSWORD = "screenshot-password-1";

const dir = mkdtempSync(join(tmpdir(), "forecraft-shots-"));
const db = openDb(join(dir, "shots.db"));
const demo = await seedDemo(db, { quiet: true, password: PASSWORD });
const seeded = await seedReports(db, demo.workspaceId, { quiet: true }); // prints the PDFs: about ten seconds
const server = serve({ fetch: createApp(db).fetch, port: PORT, hostname: "127.0.0.1" });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const settle = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500); // entrance motion (reveal, stagger) finishes
};

const forms: [string, string][] = [
  ["contact", "contact"],
  ["event", "agents-summit"],
  ["survey", "customer-pulse"],
  ["application", "senior-product-engineer"],
];
const only = process.argv[2];

for (const [shot, slug] of forms) {
  if (only && only !== shot) continue;
  for (const [device, viewport, scale] of [["desktop", { width: 1440, height: 900 }, 1], ["phone", { width: 390, height: 844 }, 2]] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
    await page.goto(`${BASE}/f/${slug}`);
    await settle(page);
    await page.screenshot({ path: join(OUT, `${shot}-${device}.png`), fullPage: true });
    await page.close();
    console.log(`✓ ${shot}-${device}.png`);
  }
}

if (!only || only === "app") {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${BASE}/`);
  await settle(desktop);
  await desktop.screenshot({ path: join(OUT, "landing-desktop.png"), fullPage: true });
  console.log("✓ landing-desktop.png");

  await desktop.goto(`${BASE}/signin`);
  await desktop.fill("#auth-email", DEMO_EMAIL);
  await desktop.fill("#auth-password", PASSWORD);
  await desktop.click('button[type="submit"]');
  await desktop.waitForURL(`${BASE}/app`);
  await settle(desktop);
  await desktop.screenshot({ path: join(OUT, "dashboard-desktop.png") });
  console.log("✓ dashboard-desktop.png");

  const event = demo.forms.find((f) => f.slug === "agents-summit")!;
  await desktop.goto(`${BASE}/app/forms/${event.id}/design`);
  await desktop.waitForSelector("[data-designer-field]");
  await desktop.click("#field-ticket");
  await settle(desktop);
  await desktop.screenshot({ path: join(OUT, "designer-desktop.png") });
  console.log("✓ designer-desktop.png");
}

if (!only || only === "reports") {
  const invoice = seeded.find((d) => d.name === "invoice")!;
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${BASE}/signin`);
  await desktop.fill("#auth-email", DEMO_EMAIL);
  await desktop.fill("#auth-password", PASSWORD);
  await desktop.click('button[type="submit"]');
  await desktop.waitForURL(`${BASE}/app`);

  // The shelf: thumbnails render on first request, so wait for every one to load.
  await desktop.goto(`${BASE}/app/reports`);
  await desktop.waitForSelector("[data-report-shelf] img");
  await desktop.waitForFunction(() => {
    const imgs = [...document.querySelectorAll("[data-report-shelf] img")] as HTMLImageElement[];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, undefined, { timeout: 60_000 });
  await settle(desktop);
  await desktop.screenshot({ path: join(OUT, "reports-desktop.png"), fullPage: true });
  console.log("✓ reports-desktop.png");

  // The invoice in the designer, with a block selected on the canvas.
  await desktop.goto(`${BASE}/app/reports/${invoice.report}/design`);
  const canvas = desktop.frameLocator("#rd-canvas");
  await canvas.locator('[data-block="items"]').waitFor({ timeout: 30_000 });
  await canvas.locator('[data-block="items"]').dispatchEvent("click"); // the canvas is CSS-zoomed: click by event, not by pixel
  await desktop.locator("[data-designer-props] code").first().waitFor();
  await desktop.waitForFunction(() => document.querySelector("[data-rd-sheet]")?.getAttribute("style")?.includes("--canvas-zoom"));
  await settle(desktop);
  await desktop.screenshot({ path: join(OUT, "report-designer-desktop.png") });
  console.log("✓ report-designer-desktop.png");

  // An issued invoice, on its dashboard page and as its share link on a phone.
  await desktop.setViewportSize({ width: 1440, height: 1300 }); // the sheet frame is 88vh tall: show the whole page
  await desktop.goto(`${BASE}/app/documents/${invoice.document.id}`);
  await desktop.frameLocator("#doc-sheet").locator('[data-ui="document"]').waitFor({ timeout: 30_000 });
  await settle(desktop);
  await desktop.screenshot({ path: join(OUT, "document-desktop.png"), fullPage: true });
  console.log("✓ document-desktop.png");
  await desktop.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.goto(`${BASE}/d/${invoice.document.share_token}`);
  await phone.locator('[data-ui="document"]').waitFor();
  await settle(phone);
  await phone.screenshot({ path: join(OUT, "document-phone.png"), fullPage: true });
  console.log("✓ document-phone.png");
  await phone.close();

  // The summit registration submitted on a phone: the thank-you state with the confirmation link.
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await visitor.goto(`${BASE}/f/agents-summit`);
  await visitor.getByLabel("Full name").fill("Rosa Lindqvist");
  await visitor.getByLabel("Email").fill("rosa.lindqvist@example.com");
  await visitor.getByLabel("What do you do?").selectOption("Designer");
  await visitor.getByLabel("Company or project").fill("Fjord Systems");
  await visitor.getByRole("button", { name: /^Next/ }).click();
  await visitor.getByLabel("Conference + workshops — €590").check();
  await visitor.getByLabel("Agent UX").check();
  await visitor.getByLabel("Forms for agents").check();
  const arrival = visitor.locator('[name="arrival"]');
  await arrival.click();
  await visitor.locator('[data-ui="date-picker"]').filter({ has: arrival }).locator('button[data-part="day"]:not([data-outside])').nth(14).click();
  await visitor.getByRole("button", { name: /^Next/ }).click();
  await visitor.getByLabel("Dietary needs").selectOption("Vegetarian");
  await visitor.getByLabel("T-shirt size").selectOption("M");
  await visitor.getByLabel(/code of conduct/).check();
  await visitor.getByRole("button", { name: "Register" }).click();
  await visitor.getByRole("link", { name: "Download your confirmation (PDF)" }).waitFor();
  await settle(visitor);
  await visitor.screenshot({ path: join(OUT, "thank-you-confirmation-phone.png"), fullPage: true });
  console.log("✓ thank-you-confirmation-phone.png");
  await visitor.close();
}

await browser.close();
await closeBrowser();
server.close();
db.close();
rmSync(dir, { recursive: true, force: true });
