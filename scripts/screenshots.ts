// `node scripts/screenshots.ts`: the acceptance screenshots in docs/screenshots/,
// taken in headless Chromium against a fresh, seeded database.

import { serve } from "@hono/node-server";
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db/index.ts";
import { DEMO_EMAIL, seedDemo } from "../src/seed.ts";

const PORT = 3322;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(import.meta.dirname, "../docs/screenshots");
const PASSWORD = "screenshot-password-1";

const dir = mkdtempSync(join(tmpdir(), "forecraft-shots-"));
const db = openDb(join(dir, "shots.db"));
const demo = await seedDemo(db, { quiet: true, password: PASSWORD });
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

await browser.close();
server.close();
db.close();
rmSync(dir, { recursive: true, force: true });
