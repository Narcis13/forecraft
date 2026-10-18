// Acceptance 4: forms meet documents. A visitor registers for the seeded
// summit on a phone; the form issues its confirmation on submit and offers the
// PDF on the thank-you state; the PDF carries the attendee's details, a number
// and a QR code that scans; the owner finds a PDF action on every response.

import jsQRModule from "jsqr";
import type { Browser, Page } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD, expect, pickDate, readPdf, signIn, test, watchErrors, watchSubmissions } from "./helpers.ts";

// jsqr is CommonJS (module.exports = jsQR); node's ESM default import is the function, TypeScript's nodenext typing says the namespace.
const jsQR = jsQRModule as unknown as typeof import("jsqr").default;

const ATTENDEE = { name: "Rosa Lindqvist", email: "rosa.lindqvist@example.com", company: "Fjord Systems" };

/** RGBA pixels of a PNG, read through a canvas in a blank Chromium page, with a white quiet zone around it. */
async function pixels(browser: Browser, png: Buffer, margin = 40): Promise<{ data: number[]; width: number; height: number }> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([b64, pad]) => {
        const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const m = pad as number;
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width + 2 * m;
        canvas.height = bmp.height + 2 * m;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, m, m);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { data: Array.from(img.data), width: img.width, height: img.height };
      },
      [png.toString("base64"), margin] as const,
    );
  } finally {
    await page.close();
  }
}

/** Fill the three wizard steps of the summit registration (phone width). */
async function register(page: Page) {
  await page.goto("/f/agents-summit");
  await expect(page.getByLabel("Full name")).toBeVisible();
  // Step 1: you
  await page.getByLabel("Full name").fill(ATTENDEE.name);
  await page.getByLabel("Email").fill(ATTENDEE.email);
  await page.getByLabel("What do you do?").selectOption("Designer");
  await page.getByLabel("Company or project").fill(ATTENDEE.company);
  await page.getByRole("button", { name: /^Next/ }).click();
  // Step 2: the ticket; workshops appear for "Conference + workshops", the arrival date for anything in person
  await page.getByLabel("Conference + workshops — €590").check();
  await expect(page.getByLabel("Agent UX")).toBeVisible();
  await page.getByLabel("Agent UX").check();
  await page.getByLabel("Forms for agents").check();
  await pickDate(page, "arrival");
  await page.getByRole("button", { name: /^Next/ }).click();
  // Step 3: extras
  await page.getByLabel("Dietary needs").selectOption("Vegetarian");
  await page.getByLabel("T-shirt size").selectOption("M");
  await page.getByLabel(/code of conduct/).check();
}

test.describe("forms meet documents", () => {
  test("a visitor registers on a phone and downloads a confirmation PDF with a scannable QR code; the owner finds a PDF on every response", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const submissions = watchSubmissions(page);

    // 1. The visitor fills the wizard and submits.
    await register(page);
    const sent = page.waitForResponse((r) => /\/api\/v1\/f\/agents-summit\/submissions/.test(r.url()) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Register" }).click();
    const res = await sent;
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { document?: { number: string | null; pdf_url: string; share_url: string; link: boolean } };
    expect(body.document?.link).toBe(true);
    expect(submissions).toHaveLength(1);

    // 2. The thank-you state offers the confirmation.
    await expect(page.getByRole("heading", { name: "You are registered" })).toBeVisible();
    const download = page.getByRole("link", { name: "Download your confirmation (PDF)" });
    await expect(download).toBeVisible();
    const href = (await download.getAttribute("href"))!;
    expect(href).toMatch(/\/d\/[\w-]+\.pdf$/);
    expect(href).toBe(body.document!.pdf_url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll on the thank-you state").toBeLessThanOrEqual(391);

    // 3. The PDF: a PDF, with the attendee's name and email and a confirmation number.
    const pdfRes = await page.request.get(href);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    const pdf = await readPdf(await pdfRes.body());
    expect(pdf.pages).toBeGreaterThanOrEqual(1);
    expect(pdf.text).toContain(ATTENDEE.name);
    expect(pdf.text).toContain(ATTENDEE.email);
    const number = pdf.text.match(/CNF-\d{4}-\d{4}/)?.[0];
    expect(number, "a confirmation number like CNF-2026-0002 is printed").toBeTruthy();
    expect(body.document!.number).toBe(number);

    // 4. The share view (the PDF's URL without .pdf): a barcode, and a QR code that scans to the number.
    const shareUrl = href.replace(/\.pdf$/, "");
    expect(body.document!.share_url).toBe(shareUrl);
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 3 });
    const desktopErrors = watchErrors(desktop);
    await desktop.goto(shareUrl);
    await expect(desktop.locator('[data-ui="document"]')).toBeVisible();
    await expect(desktop.locator('[data-ui="barcode"] svg').first()).toBeVisible();
    const qr = desktop.locator('[data-ui="qr-code"] svg').first();
    await expect(qr).toBeVisible();
    await desktop.evaluate(() => document.fonts.ready);
    const png = await qr.screenshot();
    const img = await pixels(browser, png);
    const decoded = jsQR(Uint8ClampedArray.from(img.data), img.width, img.height);
    expect(decoded, "jsQR found a QR code in the rendered SVG").not.toBeNull();
    expect(decoded!.data).toContain(number!);
    expect(decoded!.data).toMatch(/^FORECRAFT-CHECKIN:CNF-\d{4}-\d{4}:sub_[\w-]+$/);
    expect(desktopErrors.pageErrors).toEqual([]);
    await desktop.close();

    // 5. The owner signs in: every response has a PDF action, and it returns a PDF.
    const owner = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const ownerErrors = watchErrors(owner);
    await signIn(owner, DEMO_EMAIL, DEMO_PASSWORD);
    const forms = (await (await owner.request.get("/api/v1/forms")).json()) as { items: { id: string; slug: string }[] };
    const form = forms.items.find((f) => f.slug === "agents-summit")!;
    expect(form, "the seeded summit form").toBeTruthy();
    await owner.goto(`/app/forms/${form.id}/submissions`);
    const pdfLabel = "This response as a PDF";
    const dataRows = owner.locator("tbody tr").filter({ has: owner.locator('[data-part="row-toggle"]') });
    await expect(dataRows.first()).toBeVisible();
    const total = await dataRows.count();
    expect(total).toBeGreaterThanOrEqual(5); // three seeded answers, the seeded confirmation's, and this one
    for (let i = 0; i < total; i++) {
      await expect(dataRows.nth(i).getByRole("link", { name: pdfLabel }), `row ${i + 1} has a PDF action`).toHaveCount(1);
    }
    // This visitor's own response (found by the submission id the QR code carries), and a seeded one.
    const submissionId = decoded!.data.split(":").pop()!;
    const hrefs = [`/api/v1/submissions/${submissionId}/pdf`];
    const seeded = await dataRows.filter({ hasText: "ada@example.com" }).first().getByRole("link", { name: pdfLabel }).getAttribute("href");
    hrefs.push(seeded!);
    await expect(owner.locator(`a[href="${hrefs[0]}"]`)).toHaveCount(1);
    for (const href of hrefs) {
      const r = await owner.request.get(href);
      expect(r.status(), href).toBe(200);
      expect(r.headers()["content-type"]).toContain("application/pdf");
      expect((await readPdf(await r.body())).pages).toBeGreaterThanOrEqual(1);
    }
    expect((await readPdf(await (await owner.request.get(hrefs[0]!)).body())).text).toContain(ATTENDEE.email);
    expect(ownerErrors.pageErrors).toEqual([]);
    await owner.close();

    expect(errors.pageErrors).toEqual([]);
  });
});
