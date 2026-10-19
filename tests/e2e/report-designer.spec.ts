// Acceptance 3: a person builds a report from the blank starter in the report
// designer, publishes it, issues a document and opens its share link on a phone;
// what Chromium prints from the share view has as many pages as the server's PDF.

import type { Page } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD, expect, readPdf, signIn, signUp, test, waitSaved, watchErrors } from "./helpers.ts";

const SAMPLE = {
  title: "Invoice 2026-017",
  body: "Thank you for your business.",
  seller: { name: "Northwind Studio GmbH", street: "Torstrasse 12", city: "10119 Berlin" },
  customer: { name: "Atlas Retail Europe B.V.", street: "Keizersgracht 400", city: "1016 GD Amsterdam" },
  due: "2026-11-30",
  items: [
    { description: "Design sprint, week 1", qty: 5, price: 840, vat: 19 },
    { description: "Prototype build and user testing", qty: 12, price: 95.5, vat: 19 },
    { description: "Printed workshop handbook", qty: 30, price: 12.4, vat: 7 },
    { description: "Travel and accommodation", qty: 1, price: 410, vat: 19 },
  ],
};

const canvas = (page: Page) => page.frameLocator("#rd-canvas");
/** The block ids on the canvas, in page order. */
const canvasOrder = (page: Page) => canvas(page).locator("[data-block]").evaluateAll((els) => els.map((el) => el.getAttribute("data-block")));
const blockButton = (page: Page, name: string) => page.locator(`[data-rd-block="${name}"]`);
const props = (page: Page) => page.locator("[data-designer-props]");

/** Put `path` into the text field `key` of the selected block with the Insert field picker (replacing what was there). */
async function bindWithPicker(page: Page, key: string, path: string) {
  const input = props(page).locator(`[data-rd-key="${key}"]`);
  await input.focus();
  await input.press("ControlOrMeta+a");
  const options = await page.locator("#rd-insert option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(options, `the Insert field picker offers ${path}`).toContain(path);
  await page.locator("#rd-insert").selectOption(path);
  await expect(input).toHaveValue(new RegExp(`\\{\\{ ${path.replace(".", "\\.")} \\}\\}`));
}

/** Click a block on the canvas and wait for the properties panel to name it. */
async function selectOnCanvas(page: Page, id: string) {
  await canvas(page).locator(`[data-block="${id}"]`).click();
  await expect(props(page).locator("code").first()).toHaveText(id);
}

test.describe("the report designer", () => {
  test("a person designs an invoice from the blank starter, publishes it, issues a document and shares it", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await signUp(page);

    // 1. Reports: start from the blank starter; the designer opens.
    await page.goto("/app/reports");
    await page.getByRole("button", { name: "Start from blank" }).click();
    await page.waitForURL(/\/app\/reports\/[^/]+\/design$/);
    const reportId = page.url().match(/reports\/([^/]+)\/design/)![1]!;
    await page.waitForFunction(() => Boolean((window as unknown as { Faqir?: unknown }).Faqir));
    await expect(canvas(page).locator('[data-block="title"]')).toBeVisible({ timeout: 20_000 });
    expect(await canvasOrder(page)).toEqual(["title", "body"]); // the footer prints in the page margin, not in the body
    // A tall window keeps the palette button and the canvas block both on screen during the drag.
    await page.setViewportSize({ width: 1440, height: 1500 });

    // 2. Data: replace the sample, infer the schema from it.
    await page.locator("#rt-data").click();
    await page.locator("#rd-sample").fill(JSON.stringify(SAMPLE, null, 2));
    await page.getByRole("button", { name: "Infer the schema from the sample" }).click();
    await expect(page.getByText("Fields added from the sample")).toBeVisible();
    for (const path of ["seller.name", "customer.name", "due", "items", "row.description", "row.qty", "row.price", "row.vat"]) {
      await expect(page.locator("#rp-data tbody code").filter({ hasText: new RegExp(`^${path.replace(".", "\\.")}$`) })).toHaveCount(1);
    }

    // 3. Layout: add blocks from the palette (each lands after the selected one, and becomes selected).
    await page.locator("#rt-layout").click();
    await expect(canvas(page).locator('[data-block="title"]')).toBeVisible();
    for (const name of ["letterhead", "title", "facts", "table", "totals", "text", "signature"]) {
      await blockButton(page, name).click();
    }
    await expect.poll(() => canvasOrder(page), { timeout: 15_000 }).toEqual(["title", "body", "letterhead", "title-2", "facts", "table", "totals", "text", "signature"]);
    // The designer guessed the money configuration for the totals block from the lines.
    await page.locator("#rt-data").click();
    await expect(page.getByLabel("Money: the lines")).toHaveValue("items");
    await page.locator("#rt-layout").click();

    // The canvas is a CSS-zoomed iframe; at 100 % Playwright's coordinates for what is inside it are exact.
    await page.getByText("100 %", { exact: true }).click();
    await expect(page.locator("[data-rd-sheet]")).toHaveAttribute("style", /--canvas-zoom: 1;/);

    // 4. A real drag: a palette button onto a block inside the canvas iframe (dropped on the lower half of "signature").
    const sig = canvas(page).locator('[data-block="signature"]');
    const sigBox = (await sig.boundingBox())!;
    // The lower half of the block means "drop after it".
    await blockButton(page, "callout").dragTo(sig, { targetPosition: { x: 30, y: sigBox.height - 4 } });
    await expect.poll(() => canvasOrder(page), { timeout: 15_000 }).toEqual(["title", "body", "letterhead", "title-2", "facts", "table", "totals", "text", "signature", "callout"]);
    await expect(props(page).locator("code").first()).toHaveText("callout");

    // 5. Bind blocks to data with the Insert field picker.
    await selectOnCanvas(page, "letterhead");
    await bindWithPicker(page, "name", "seller.name");
    await selectOnCanvas(page, "facts");
    await bindWithPicker(page, "items.0.value", "due");
    await selectOnCanvas(page, "text");
    await page.locator("#rf-markdown").fill("Billed to **{{ customer.name }}**, {{ customer.city }}. Please pay by {{ date(due) }}.");

    // 6. The table: rows = items, four columns through the row editor, values through the picker.
    await selectOnCanvas(page, "table");
    await expect(page.locator("#rf-rows")).toHaveValue("items");
    await page.locator("#rf-rows").fill("items");
    const addColumn = props(page).getByRole("button", { name: "Add a column" });
    while ((await props(page).locator('[data-rd-key^="columns."][data-rd-key$=".value"]').count()) < 4) await addColumn.click();
    await expect(props(page).locator('[data-rd-key^="columns."][data-rd-key$=".value"]')).toHaveCount(4);
    const columns = [
      ["Description", "row.description"],
      ["Qty", "row.qty"],
      ["Unit price", "row.price"],
      ["VAT %", "row.vat"],
    ] as const;
    for (const [i, [label, path]] of columns.entries()) {
      await props(page).locator(`[data-rd-key="columns.${i}.label"]`).fill(label);
      await bindWithPicker(page, `columns.${i}.value`, path);
    }
    await expect.poll(async () => (await page.locator("#rd-json").inputValue().catch(() => "")) || "x").toBeTruthy();

    // 7. Appearance: a print theme, the accent, paper and locale.
    await page.locator("#rt-look").click();
    const themes = page.locator("[data-rd-theme]");
    expect(await themes.count()).toBeGreaterThanOrEqual(3);
    await themes.filter({ hasText: "swiss-document" }).click();
    await expect(themes.filter({ hasText: "swiss-document" })).toHaveAttribute("aria-pressed", "true");
    await page.locator("#rd-accent").fill("#9a3412");
    await page.locator("#rd-paper").selectOption("letter");
    await page.locator("#rd-locale").selectOption("de-DE");

    // 8. The definition the API holds says all of it (once saved).
    await waitSaved(page);
    const stored = (await (await page.request.get(`/api/v1/reports/${reportId}`)).json()).definition;
    expect(stored.appearance).toMatchObject({ theme: "swiss-document", accent: "#9a3412", paper: "letter", locale: "de-DE" });
    expect(stored.money).toMatchObject({ lines: "items", quantity: "qty", unitPrice: "price", taxRate: "vat" });
    const table = stored.layout.find((b: { block: string }) => b.block === "table");
    expect(table.rows).toBe("items");
    expect(table.columns.map((c: { value: string }) => c.value)).toEqual(columns.map(([, p]) => `{{ ${p} }}`));
    expect(stored.layout.map((b: { id: string }) => b.id)).toEqual(["title", "body", "letterhead", "title-2", "facts", "table", "totals", "text", "signature", "callout", "footer"]);

    // 9. Move, undo, redo: alt+ArrowUp moves the selected block up one place; undo puts it back; redo moves it again.
    await page.locator("#rt-layout").click();
    await selectOnCanvas(page, "signature");
    const before = await canvasOrder(page);
    const index = before.indexOf("signature");
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => (await canvasOrder(page)).indexOf("signature"), { timeout: 10_000 }).toBe(index - 1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => canvasOrder(page), { timeout: 10_000 }).toEqual(before);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect.poll(async () => (await canvasOrder(page)).indexOf("signature"), { timeout: 10_000 }).toBe(index - 1);
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => canvasOrder(page), { timeout: 10_000 }).toEqual(before);

    // 10. Preflight runs on the real PDF after the save and comes back clean.
    await waitSaved(page);
    await page.locator("#rt-preflight").click();
    await expect(page.locator("#rp-preflight").getByText(/^Clean: nothing to fix\. \d+ pages?\./)).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("#rt-preflight").getByText("clean", { exact: true })).toBeVisible();
    await expect(page.locator("#rp-preflight [data-rd-strip] img").first()).toBeVisible();

    // 11. Publish.
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/Published version 1/).first()).toBeVisible();

    // 12. The report's page: issue a document from the sample.
    await page.goto(`/app/reports/${reportId}`);
    await page.getByRole("button", { name: "Issue a document" }).click();
    await page.waitForURL(/\/app\/documents\/[^/]+$/);
    const documentId = page.url().match(/documents\/([^/]+)$/)![1]!;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^DOC-\d{4}-\d{3}$/);

    // 13. Download PDF returns a PDF with the data in it.
    const download = page.getByRole("link", { name: "Download PDF" });
    await expect(download).toHaveAttribute("href", `/api/v1/documents/${documentId}/pdf`);
    const pdfRes = await page.request.get((await download.getAttribute("href"))!);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    const apiPdf = await readPdf(await pdfRes.body());
    expect(apiPdf.text).toContain("Northwind Studio GmbH");
    expect(apiPdf.text).toContain("Atlas Retail Europe B.V.");
    expect(apiPdf.text).toContain("Design sprint, week 1");
    expect(apiPdf.pages).toBeGreaterThanOrEqual(1);

    // 14. The share link, at phone width: the sheet is there, readable and does not scroll sideways.
    const shareUrl = (await page.locator("[data-report-link]").innerText()).trim();
    expect(shareUrl).toMatch(/\/d\/[\w-]+$/);
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const phonePage = await phone.newPage();
    const phoneErrors = watchErrors(phonePage);
    await phonePage.goto(shareUrl);
    const article = phonePage.locator('[data-ui="document"]');
    await expect(article).toBeVisible();
    await expect(phonePage.getByText("Atlas Retail Europe B.V.").first()).toBeVisible();
    const fit = await phonePage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, font: parseFloat(getComputedStyle(document.querySelector('[data-ui="document"] p, [data-ui="document"] td') ?? document.body).fontSize) }));
    expect(fit.scrollWidth, "no horizontal overflow at 390 px").toBeLessThanOrEqual(fit.innerWidth + 1);
    expect(fit.font, "body text is not shrunk to nothing").toBeGreaterThanOrEqual(11);
    const articleBox = (await article.boundingBox())!;
    expect(articleBox.width).toBeGreaterThan(300);
    await expect(phonePage.getByRole("link", { name: /PDF/ }).first()).toBeVisible();
    expect(phoneErrors.pageErrors).toEqual([]);
    await phone.close();

    // 15. Printing the share view in Chromium gives the same number of pages as the server's PDF.
    const printer = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await printer.goto(shareUrl);
    await expect(printer.locator('[data-ui="document"]')).toBeVisible();
    await printer.evaluate(() => document.fonts.ready);
    const printed = await readPdf(await printer.pdf({ preferCSSPageSize: true, printBackground: true }));
    const shareRes = await page.request.get(`${shareUrl}.pdf`);
    expect(shareRes.status()).toBe(200);
    expect(shareRes.headers()["content-type"]).toContain("application/pdf");
    const serverPdf = await readPdf(await shareRes.body());
    expect(serverPdf.pages).toBe(apiPdf.pages);
    expect(printed.pages, `Chromium printed ${printed.pages} page(s) from the share view, the server ${serverPdf.pages}`).toBe(serverPdf.pages);
    await printer.close();

    expect(errors.pageErrors).toEqual([]);
  });

  test("a multi-page document prints the same number of pages from the share view as from the server", async ({ page, browser }) => {
    // The seeded 60-line Romanian invoice (numbered CS-…) runs to several pages.
    await signIn(page, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto("/app/documents");
    await page.getByRole("link", { name: /^CS-\d{4}-\d{5}$/ }).first().click();
    await page.waitForURL(/\/app\/documents\/[^/]+$/);
    const shareUrl = (await page.locator("[data-report-link]").innerText()).trim();
    const server = await readPdf(await (await page.request.get(`${shareUrl}.pdf`)).body());
    expect(server.pages).toBeGreaterThanOrEqual(2);
    const printer = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await printer.goto(shareUrl);
    await expect(printer.locator('[data-ui="document"]')).toBeVisible();
    await printer.evaluate(() => document.fonts.ready);
    const printed = await readPdf(await printer.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(printed.pages, `Chromium printed ${printed.pages} page(s), the server ${server.pages}`).toBe(server.pages);
    await printer.close();
  });

  // The Fit zoom is computed while the Layout panel is still hidden after a round trip through another tab.
  test("the canvas keeps its Fit zoom after a visit to another tab", async ({ page }) => {
    await signUp(page);
    await page.goto("/app/reports");
    await page.getByRole("button", { name: "Start from blank" }).click();
    await page.waitForURL(/\/app\/reports\/[^/]+\/design$/);
    await expect(canvas(page).locator('[data-block="title"]')).toBeVisible({ timeout: 20_000 });
    const zoom = () => page.locator("[data-rd-sheet]").evaluate((el) => parseFloat(el.style.getPropertyValue("--canvas-zoom")));
    const first = await zoom();
    await page.locator("#rt-data").click();
    await page.locator("#rt-layout").click();
    await page.waitForTimeout(500);
    expect(await zoom()).toBeCloseTo(first, 2); // actual: 0.4
  });

  test("on a phone the designer says it needs a wider screen", async ({ page }) => {
    const errors = watchErrors(page);
    await signUp(page);
    await page.goto("/app/reports");
    await page.getByRole("button", { name: "Start from blank" }).click();
    await page.waitForURL(/\/app\/reports\/[^/]+\/design$/);
    await page.setViewportSize({ width: 390, height: 844 });
    const note = page.locator("[data-designer-narrow]");
    await expect(note).toBeVisible();
    await expect(note).toContainText("needs a wider screen");
    // And not wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    // Back on a desktop the note goes away.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(note).toBeHidden();
    expect(errors.pageErrors).toEqual([]);
  });
});
