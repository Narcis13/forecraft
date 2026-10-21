// UX audit, reports engine (#1, #2, #7, #8, #32–#36, #41): a person collects
// workshop orders, then prints a survey summary and a submissions register of
// them. The summary quotes no email or company, counts an untouched switch as
// No, names a tie, gives a number's mean and a date's range, and keeps repeatable
// rows; the designer's data is the form's own; the register lists every order
// with a total; a missing value stays inside its stat.

import { createKeyViaSession, createPublishedForm, expect, signUp, test, unique, watchErrors } from "./helpers.ts";

const WORKSHOP = {
  schema: {
    title: "Workshop orders",
    type: "object",
    properties: {
      name: { type: "string", title: "Your name" },
      email: { type: "string", format: "email", title: "Email" },
      company: { type: "string", title: "Company name" },
      workshop: { type: "string", title: "Workshop", enum: ["Advanced React", "Design systems", "Accessible forms"] },
      start: { type: "string", format: "date", title: "Preferred start" },
      seats: { type: "integer", title: "Seats", minimum: 1, maximum: 20 },
      payment: { type: "string", title: "Payment method", enum: ["Card", "Invoice"] },
      newsletter: { type: "boolean", title: "Newsletter" },
      lineItems: { type: "array", title: "Line items", items: { type: "object", properties: { label: { type: "string", title: "Item" }, qty: { type: "number", title: "Qty" }, amount: { type: "number", title: "Amount" } } } },
      notes: { type: "string", title: "Anything else?" },
    },
    required: ["name", "email"],
  },
  ui: { notes: { widget: "textarea" }, newsletter: { widget: "switch" } },
};

const ORDERS = [
  { name: "Elena Popescu", email: "elena@example.test", company: "Popescu Digital SRL", workshop: "Advanced React", start: "2026-12-03", seats: 3, payment: "Invoice", newsletter: true, lineItems: [{ label: "Lunch", qty: 3, amount: 45 }], notes: "Please send the invoice to our accounts team." },
  { name: "Tom Becker", email: "tom@example.test", workshop: "Design systems", start: "2026-11-20", seats: 1, payment: "Card", lineItems: [{ label: "Lunch", qty: 1, amount: 15 }] },
  { name: "Aiko Tanaka", email: "aiko@example.test", company: "Tanaka & Partners KK", workshop: "Advanced React", start: "2027-01-15", seats: 2, payment: "Card" },
  { name: "Marc Dubois", email: "marc@example.test", company: "Dubois Conseil SARL", workshop: "Accessible forms", seats: 6, payment: "Invoice", lineItems: [{ label: "Parking", qty: 2, amount: 20 }] },
];

test.describe("reports from a form's submissions", () => {
  test("a survey summary and a register print the form's real answers, correctly", async ({ page }) => {
    const errors = watchErrors(page);
    await signUp(page, "Report Engine");
    const key = await createKeyViaSession(page);
    const headers = { authorization: `Bearer ${key}` };
    const form = await createPublishedForm(page.request, key, WORKSHOP, unique("workshop"));

    // Before the first order, the summary designs against answers shaped like this form, not the demo survey (#7).
    const created = await page.request.post("/api/v1/reports", { headers, data: { starter: "survey-summary", title: "Workshop summary", form: form.id } });
    expect(created.status(), await created.text()).toBe(201);
    const summary = (await created.json()) as { id: string };
    let sample = await (await page.request.get(`/api/v1/reports/${summary.id}/sample`, { headers })).json();
    expect(sample.origin).toBe("synthetic");
    expect(sample.data.form.title).toBe("Workshop orders");

    for (const order of ORDERS) {
      const res = await page.request.post(`/api/v1/f/${form.slug}/submissions`, { data: order });
      expect(res.status(), await res.text()).toBeLessThan(300);
    }
    sample = await (await page.request.get(`/api/v1/reports/${summary.id}/sample`, { headers })).json();
    expect(sample.origin).toBe("submissions");
    expect(sample.count).toBe(4);

    // The designer's canvas is the form's data: no "How was your month", and guarded/name-bound fields are not missing (#7, #32–#34).
    const def = (await (await page.request.get(`/api/v1/reports/${summary.id}`, { headers })).json()).definition;
    def.layout.splice(1, 0, { id: "seats", block: "stats", items: [
      { label: "Seats, mean", value: "{{ number(question(\"seats\").mean, 1) }}" },
      { label: "Guarded", value: "{{ questions[40] ? number(questions[40].mean, 1) : \"—\" }}" },
      { label: "Payment options", value: "{{ count(question(\"payment\").options ?? []) }}" },
    ] });
    expect((await page.request.patch(`/api/v1/reports/${summary.id}`, { headers, data: { definition: def } })).status()).toBe(200);
    const canvas = await (await page.request.post(`/api/v1/reports/${summary.id}/preview`, { headers, data: { format: "html", view: "canvas" } })).json();
    expect(canvas.findings.filter((f: { severity: string }) => f.severity === "error")).toEqual([]);
    expect(canvas.html).not.toContain("How was your month");

    // Publish, issue for today, and read the shared document like a visitor (#1, #2, #41).
    expect((await page.request.post(`/api/v1/reports/${summary.id}/publish`, { headers })).status()).toBe(201);
    const today = new Date().toISOString().slice(0, 10);
    const issued = await page.request.post(`/api/v1/reports/${summary.id}/documents`, { headers, data: { period: { since: today, until: today }, issue: true } });
    expect(issued.status(), await issued.text()).toBe(201);
    const doc = (await issued.json()) as { share_url: string };
    await page.goto(new URL(doc.share_url).pathname);
    const sheet = page.locator('[data-ui="document"]');
    await expect(sheet).toContainText("Workshop orders");
    const quotes = sheet.locator('[data-report-block="quote"]');
    await expect(quotes).toContainText("Please send the invoice to our accounts team.");
    for (const leak of ["elena@example.test", "Popescu Digital SRL", "Tanaka & Partners KK"]) await expect(quotes).not.toContainText(leak);
    const row = (title: string) => sheet.locator('[data-report-block="table"] [data-part="tr"]').filter({ hasText: title });
    await expect(row("Payment method")).toContainText("Card, Invoice (tie)");
    await expect(row("Workshop")).toContainText("Advanced React");
    await expect(row("Workshop")).not.toContainText("mean");
    await expect(row("Seats")).toContainText("Mean 3.0 · 1–6");
    await expect(row("Preferred start")).toContainText("20 Nov 2026 – 15 Jan 2027");
    await expect(row("Newsletter")).toContainText("No");
    await expect(row("Newsletter")).toContainText("75%");
    await expect(row("Line items")).toContainText("3 rows");
    await expect(row("Company name")).not.toContainText("Written answers");
    await expect(row("Anything else?")).toContainText("Written answers");
    await expect(sheet).toContainText("Workshop summary ·", { useInnerText: true });

    // A register of the same orders: one row each, the form's columns, a total (#8).
    const reg = await page.request.post("/api/v1/reports", { headers, data: { starter: "submissions-register", title: "Order register", form: form.id } });
    expect(reg.status(), await reg.text()).toBe(201);
    const register = (await reg.json()) as { id: string };
    expect((await page.request.post(`/api/v1/reports/${register.id}/publish`, { headers })).status()).toBe(201);
    const regDoc = await page.request.post(`/api/v1/reports/${register.id}/documents`, { headers, data: { period: { since: today, until: today }, issue: true } });
    expect(regDoc.status(), await regDoc.text()).toBe(201);
    await page.goto(new URL(((await regDoc.json()) as { share_url: string }).share_url).pathname);
    const table = page.locator('[data-block="register"]');
    for (const order of ORDERS) await expect(table).toContainText(order.name);
    await expect(table.locator("th")).toContainText(["No.", "Date", "Your name", "Company name", "Workshop", "Seats", "Line items: Amount"]);
    await expect(table.locator("[data-report-table-footer]")).toContainText("Total");
    await expect(table.locator("[data-report-table-footer]")).toContainText("12");

    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });

  test("a value the data lacks stays inside its own stat (#36)", async ({ page }) => {
    await signUp(page, "Missing Values");
    const key = await createKeyViaSession(page);
    const headers = { authorization: `Bearer ${key}` };
    const created = await page.request.post("/api/v1/reports", { headers, data: { starter: "blank", title: "Stats" } });
    const report = (await created.json()) as { id: string; definition: Record<string, unknown> };
    const definition = { ...report.definition, layout: [{ id: "kpis", block: "stats", items: [
      { label: "Mean seats", value: "{{ questions[5].options[0].label }}" },
      { label: "Next", value: "The MCP server" },
      { label: "Third", value: "{{ questions[6].options[0].label }}" },
      { label: "Fourth", value: "4" },
    ] }] };
    const res = await page.request.post(`/api/v1/reports/${report.id}/preview`, { headers, data: { definition, format: "html" } });
    const preview = await res.json();
    expect(preview.findings.some((f: { code: string }) => f.code === "missing-data")).toBe(true);
    // The width the page area prints at (A4 less its margins), where four stats share 170 mm.
    await page.setViewportSize({ width: 650, height: 900 });
    await page.setContent(preview.html.replace("<head>", `<head><base href="${new URL(page.url()).origin}/">`), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const stats = page.locator('[data-report-block="stats"] [data-ui="stat"]');
    await expect(stats).toHaveCount(4);
    const boxes = await stats.evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      // The text itself, not its box: overflowing text spills out of a box that stays put.
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('[data-part="value"]')!);
      return { left: r.left, right: r.right, valueRight: range.getBoundingClientRect().right, text: el.textContent };
    }));
    expect(boxes[0]!.text).toContain("‹questions[5].options[0].label›");
    for (const [i, b] of boxes.entries()) {
      expect(b.valueRight, `stat ${i + 1}'s value ends inside it`).toBeLessThanOrEqual(b.right + 0.5);
      if (i + 1 < boxes.length) expect(b.right).toBeLessThanOrEqual(boxes[i + 1]!.left + 0.5);
    }
  });
});
