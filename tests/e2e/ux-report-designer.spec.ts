// The report designer against a real form (TASK-UX-FIXES.md, report designer):
// the canvas prints the bound form's data (#7, #8), new blocks are seeded from
// it and land in view (#29, #30), stats rows are labelled (#31), the Insert
// field list is grouped and offers questions by name (#32), moves are visible
// and cross sections (#37), issuing asks first (#6, #39), the name follows a
// rename (#40), the header is one bar (#51) and zoom keeps its place (#55).

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createKeyViaSession, createPublishedForm, expect, signUp, test, waitSaved, watchErrors } from "./helpers.ts";

const FORM = {
  schema: {
    title: "Workshop orders",
    type: "object",
    properties: {
      name: { type: "string", title: "Your name" },
      workshop: { type: "string", title: "Workshop", enum: ["Intro to forms", "Advanced reports"] },
      seats: { type: "integer", title: "Seats", minimum: 1, maximum: 20 },
      newsletter: { type: "boolean", title: "Newsletter" },
    },
    required: ["name"],
  },
};
const ANSWERS = [
  { name: "Elena Popescu", workshop: "Intro to forms", seats: 2, newsletter: true },
  { name: "Mihai Ionescu", workshop: "Advanced reports", seats: 5 },
  { name: "Ana Georgescu", workshop: "Advanced reports", seats: 3, newsletter: false },
];

// One account, one form with three submissions, for every test: the public
// submission endpoint allows ten a minute per address.
let state: Awaited<ReturnType<BrowserContext["storageState"]>>;
let formId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signUp(page);
  const key = await createKeyViaSession(page);
  const form = await createPublishedForm(page.request, key, FORM);
  formId = form.id;
  for (const data of ANSWERS) {
    const res = await page.request.post(`/api/v1/f/${form.slug}/submissions`, { data: { data } });
    expect(res.status(), await res.text()).toBe(201);
  }
  state = await ctx.storageState();
  await ctx.close();
});

async function open(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 1000 } });
  return { page: await ctx.newPage(), close: () => ctx.close() };
}

/** A report from a starter, bound to the form when the starter reads one. */
async function newReport(page: Page, starter: string, form = true): Promise<string> {
  const res = await page.request.post("/api/v1/reports", { data: form ? { starter, form: formId } : { starter } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const canvas = (page: Page) => page.frameLocator("#rd-canvas");
const canvasOrder = (page: Page) => canvas(page).locator("[data-block]").evaluateAll((els) => els.map((el) => el.getAttribute("data-block")));
const props = (page: Page) => page.locator("[data-designer-props]");
const selectedId = (page: Page) => props(page).locator("code").first();
const stored = async (page: Page, id: string) => (await (await page.request.get(`/api/v1/reports/${id}`)).json()).definition;

async function design(page: Page, id: string, firstBlock = "title") {
  await page.goto(`/app/reports/${id}/design`);
  await expect(canvas(page).locator(`[data-block="${firstBlock}"]`)).toBeVisible({ timeout: 20_000 });
}

/** Wait for the preflight after the last save, and return its findings. */
async function preflight(page: Page, id: string) {
  await waitSaved(page);
  const res = await page.request.post(`/api/v1/reports/${id}/preview`, { data: { format: "png", pages: 1, dpi: 36 } });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { findings: { severity: string; code: string; message: string; block: string | null }[] }).findings;
}

test("a summary designs against the bound form's submissions, and the Data tab shows the binding (#7, #8)", async ({ browser }) => {
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  // The starters come from the server, the new register among them.
  await page.goto("/app/reports");
  await expect(page.getByRole("button", { name: "Start from Submissions register" })).toBeVisible();

  const id = await newReport(page, "survey-summary");
  await design(page, id);
  // The canvas prints the form's own title and its three submissions, not the starter's sample.
  await expect(canvas(page).locator('[data-block="title"]')).toContainText("Workshop orders");
  await expect(canvas(page).getByText("How was your month with forecraft?")).toHaveCount(0);
  await expect(page.locator("[data-rd-origin]")).toHaveText("3 submissions from Workshop orders.");

  // Data: the binding is shown, not "Choose a form…".
  await page.locator("#rt-data").click();
  await expect(page.locator("#rd-source-kind")).toHaveValue("summary");
  await expect(page.locator("#rd-bind")).toHaveValue(formId);
  await expect(page.locator("[data-rd-source-note]")).toHaveText("3 submissions from Workshop orders.");

  // Preflight checks the real data: Seats has a mean there.
  const findings = await preflight(page, id);
  expect(findings.filter((f) => f.code === "missing-data"), JSON.stringify(findings)).toEqual([]);

  // Read the form another way: a register of its submissions.
  await page.locator("#rd-source-kind").selectOption("submissions");
  await expect(page.getByText("Bound to Workshop orders: a register of its submissions.")).toBeVisible();
  await waitSaved(page);
  const def = await stored(page, id);
  expect(def.source).toEqual({ kind: "submissions", form: formId });
  expect(def.schema.title).toBe("Survey summary"); // the report keeps its name
  expect(Object.keys(def.schema.properties)).toContain("rows");
  await expect(page.locator("[data-rd-source-note]")).toHaveText("3 submissions from Workshop orders.");

  // And one document per submission: the schema becomes the form's.
  await page.locator("#rd-source-kind").selectOption("submission");
  await waitSaved(page);
  expect((await stored(page, id)).source).toEqual({ kind: "submission", form: formId });
  expect(Object.keys((await stored(page, id)).schema.properties)).toEqual(expect.arrayContaining(["name", "workshop", "seats"]));
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("new blocks are seeded from the data, land after the selection, in view, and add no preflight error (#29, #30)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const id = await newReport(page, "survey-summary");
  await design(page, id);
  await canvas(page).locator('[data-block="title"]').click();
  await expect(selectedId(page)).toHaveText("title");

  for (const name of ["stats", "bars", "chart", "table", "quote", "text", "callout", "facts", "signature", "qr"]) {
    await page.locator(`[data-rd-block="${name}"]`).click();
    // Selected at once, and drawn right after the block that was selected.
    await expect(selectedId(page)).toHaveText(name);
  }
  await expect.poll(() => canvasOrder(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(["title", "stats", "bars", "chart", "table", "quote", "text", "callout", "facts", "signature", "qr"]));
  const order = await canvasOrder(page);
  expect(order.slice(order.indexOf("title"), order.indexOf("title") + 11)).toEqual(["title", "stats", "bars", "chart", "table", "quote", "text", "callout", "facts", "signature", "qr"]);

  // Nothing is bound to fields the data does not have.
  await waitSaved(page);
  const def = await stored(page, id);
  const json = JSON.stringify(def.layout);
  for (const ghost of ["money(revenue)", "channels", "quarters", "row.revenue", "comment.text", "\"rows\":\"items\""]) expect(json).not.toContain(ghost);
  const bars = def.layout.find((b: { id: string }) => b.id === "bars");
  expect(bars.rows).toBe("questions");
  const findings = await preflight(page, id);
  expect(findings.filter((f) => f.severity === "error"), JSON.stringify(findings)).toEqual([]);

  // With nothing selected a block goes last (before the footer) and the canvas scrolls to it.
  await page.getByText("100 %", { exact: true }).click();
  await page.keyboard.press("Escape");
  await page.locator("[data-designer-props] [aria-label='Delete block']").click();
  await expect(props(page).getByText("Select a block on the page")).toBeVisible();
  await page.locator('[data-rd-block="callout"]').click();
  await expect(selectedId(page)).toHaveText("callout-2");
  await expect.poll(async () => (await canvasOrder(page)).at(-1), { timeout: 15_000 }).toBe("callout-2");
  await expect.poll(() => page.locator("[data-rd-desk]").evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(200);
  await expect(canvas(page).locator('[data-block="callout-2"]')).toBeInViewport();
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("every block from the palette starts without a preflight error, on data with no lists too (#29)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const ALL = ["letterhead", "title", "section", "columns", "separator", "page-break", "parties", "facts", "table", "totals", "text", "callout", "stats", "bars", "chart", "quote", "signature", "qr", "barcode", "stamp", "watermark", "faqir"];
  for (const [starter, form] of [["blank", false], ["submissions-register", true]] as const) {
    const id = await newReport(page, starter, form);
    await design(page, id);
    for (const name of ALL) {
      await page.locator(`[data-rd-block="${name}"]`).click();
      await expect(selectedId(page)).toHaveText(new RegExp(`^${name}(-\\d+)?$`));
    }
    // The answers block prints a submission: here it is refused with a reason, not added broken.
    await page.locator('[data-rd-block="answers"]').click();
    await expect(page.getByText("The answers block prints a submission").first()).toBeVisible();
    const findings = await preflight(page, id);
    expect(findings.filter((f) => f.severity === "error"), `${starter}: ${JSON.stringify(findings)}`).toEqual([]);
    const def = await stored(page, id);
    expect(JSON.stringify(def.layout)).not.toContain('"block":"answers"');
    if (starter === "blank") expect(def.layout.find((b: { block: string }) => b.block === "table").rows).toBe("[]");
  }
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("stats rows have visible labels and start empty; Insert field is grouped and picks a question by name (#31, #32)", async ({ browser }) => {
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const id = await newReport(page, "survey-summary");
  await design(page, id);
  await canvas(page).locator('[data-block="title"]').click();
  await page.locator('[data-rd-block="stats"]').click();
  await expect(selectedId(page)).toHaveText("stats");

  // #31: each cell says what it is; a new row is empty, with placeholders.
  const rows = props(page).locator("[data-rd-row]");
  await expect(rows).toHaveCount(1);
  for (const label of ["Label", "Value", "Change", "Trend"]) await expect(rows.first().locator("[data-rd-cell]").filter({ hasText: label }).first()).toBeVisible();
  await props(page).getByRole("button", { name: "Add a row" }).click();
  await expect(rows).toHaveCount(2);
  const label2 = props(page).locator('[data-rd-key="items.1.label"]');
  await expect(label2).toHaveValue("");
  await expect(label2).toHaveAttribute("placeholder", /.+/);
  await expect(props(page).getByLabel("Label, row 2")).toBeVisible();

  // #32: grouped by list, no invoice paths on a summary, no duplicates inside a group.
  const groups = await page.locator("#rd-insert optgroup").evaluateAll((gs) => gs.map((g) => ({
    label: g.getAttribute("label"),
    values: Array.from(g.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value),
  })));
  const labels = groups.map((g) => g.label);
  expect(labels).toContain("questions[] →");
  expect(labels).toContain("Fields");
  const all = groups.flatMap((g) => g.values);
  for (const invoice of ["doc.money.total", "line.net", "i"]) expect(all).not.toContain(invoice);
  for (const g of groups) expect(new Set(g.values).size, `duplicates in ${g.label}`).toBe(g.values.length);
  expect(groups.find((g) => g.label === "questions[] →")!.values).toContain("row.title");

  // A question by its name: Seats → mean, into the new row's value.
  const value2 = props(page).locator('[data-rd-key="items.1.value"]');
  await value2.focus();
  await page.locator("#rd-question").selectOption("seats");
  const stats = await page.locator("#rd-stat option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(stats).toEqual(expect.arrayContaining(["answered", "mean", "min", "max"]));
  await page.locator("#rd-stat").selectOption("mean");
  await expect(value2).toHaveValue('{{ number(question("seats").mean, 1) }}');
  await label2.fill("Average seats");
  await waitSaved(page);
  const def = await stored(page, id);
  expect(def.layout.find((b: { id: string }) => b.id === "stats").items[1]).toMatchObject({ label: "Average seats", value: '{{ number(question("seats").mean, 1) }}' });
  await expect(canvas(page).locator('[data-block="stats"]')).toContainText("Average seats");
  await expect(canvas(page).locator('[data-block="stats"]')).toContainText("3.3");
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("move up and down step over hidden blocks and go into and out of sections (#37)", async ({ browser }) => {
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const id = await newReport(page, "survey-summary");
  await design(page, id);
  // The form has no 0–10 question: the NPS blocks are hidden by their `when`.
  expect(await canvasOrder(page)).not.toContain("headline");
  await canvas(page).locator('[data-block="title"]').click();
  await page.locator('[data-rd-block="text"]').click();
  await expect(selectedId(page)).toHaveText("text");
  const topIds = async () => (await stored(page, id)).layout.map((b: { id: string }) => b.id);

  // Down: over the hidden headline and NPS section, into "Responses over time".
  await props(page).getByRole("button", { name: "Move down" }).click();
  await waitSaved(page);
  let def = await stored(page, id);
  expect(def.layout.find((b: { id: string }) => b.id === "over-time").blocks[0].id).toBe("text");
  await expect.poll(async () => { const o = await canvasOrder(page); return o.indexOf("text") - o.indexOf("over-time"); }, { timeout: 10_000 }).toBe(1);

  // Up from the top of the section: out of it, before it.
  await props(page).getByRole("button", { name: "Move up" }).click();
  await waitSaved(page);
  def = await stored(page, id);
  expect(def.layout.find((b: { id: string }) => b.id === "over-time").blocks.map((b: { id: string }) => b.id)).not.toContain("text");
  const top = await topIds();
  expect(top.indexOf("text")).toBe(top.indexOf("over-time") - 1);

  // Up again: over the hidden blocks, before the title — every click shows.
  await props(page).getByRole("button", { name: "Move up" }).click();
  await expect.poll(async () => (await canvasOrder(page))[0], { timeout: 10_000 }).toBe("text");
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("Issue a test document waits for the first publish, then asks; the footer follows a rename (#39, #40)", async ({ browser }) => {
  test.setTimeout(90_000);
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const id = await newReport(page, "survey-summary");
  await design(page, id);
  const issue = page.locator("#rd-issue");
  await expect(issue).toBeDisabled();
  await expect(page.locator("[data-rd-issue]")).toHaveAttribute("title", "Publish the report first");

  // Rename: the footer (and the canvas) follow the report's name, not the form's.
  await page.locator("#rd-title").fill("May workshops");
  await waitSaved(page);
  await expect(canvas(page).getByText(/May workshops · Draft/).first()).toBeAttached({ timeout: 15_000 });

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Published version 1/).first()).toBeVisible();
  await expect(issue).toBeEnabled();
  await issue.click();
  const dialog = page.locator("#issue-document");
  await expect(dialog.getByRole("heading", { name: "Issue a document" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
  // A draft from the designer opens beside it.
  const opened = page.context().waitForEvent("page");
  await dialog.getByRole("button", { name: "Save as draft" }).click();
  const doc = await opened;
  await doc.waitForLoadState();
  // Headed by the document's title (the summary names its form and period), not "Draft".
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText(/^Workshop orders · .+/);
  await expect(doc.locator("[data-part='header'] [data-ui='badge']").first()).toHaveText("Draft");
  await expect(doc.locator("dt").filter({ hasText: /^Pages$/ })).toHaveCount(0);
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("Issue a document asks for the period, then a draft or a numbered document (#6)", async ({ browser }) => {
  test.setTimeout(90_000);
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const id = await newReport(page, "survey-summary");
  expect((await page.request.post(`/api/v1/reports/${id}/publish`)).status()).toBe(201);
  await page.goto(`/app/reports/${id}`);
  await page.getByRole("button", { name: "Issue a document" }).click();
  const dialog = page.locator("#issue-document");
  await expect(dialog.getByRole("heading", { name: "Issue a document" })).toBeVisible();
  // Nothing was issued by opening it.
  expect(((await (await page.request.get(`/api/v1/documents?report=${id}`)).json()) as { items: unknown[] }).items).toHaveLength(0);
  await expect(dialog.locator("[data-issue-count]")).toHaveText("3 submissions in this period.");
  await dialog.getByRole("button", { name: "Last 7 days" }).click();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await expect(dialog.locator("#issue-until")).toHaveValue(today);
  await dialog.locator("#issue-since").fill("2020-01-01");
  await dialog.locator("#issue-until").fill("2020-01-31");
  await dialog.locator("#issue-until").dispatchEvent("change");
  await expect(dialog.getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.locator("[data-issue-count]")).toHaveText("No submissions in this period.");
  await dialog.getByRole("button", { name: "All time" }).click();
  await expect(dialog.locator("#issue-since")).toHaveValue("");

  // Issue, numbered: the document page has the number and the period's data.
  await dialog.getByRole("button", { name: "Issue (numbered, cannot be edited)" }).click();
  await page.waitForURL(/\/app\/documents\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SUM-\d{4}-\d{3}$/);
  await expect(page.locator("dt").filter({ hasText: /^Pages$/ })).toHaveCount(1);

  // A report whose data is sent with each document: the dialog holds the sample as JSON; a draft, then issued.
  const blank = await newReport(page, "blank", false);
  expect((await page.request.post(`/api/v1/reports/${blank}/publish`)).status()).toBe(201);
  await page.goto(`/app/reports/${blank}`);
  await page.getByRole("button", { name: "Issue a document" }).click();
  const data = dialog.locator("#issue-data");
  await expect(data).toHaveValue(/"title"/);
  await data.fill("{ not json");
  await dialog.getByRole("button", { name: "Save as draft" }).click();
  await expect(dialog.getByRole("alert")).toContainText("not valid JSON");
  await data.fill(JSON.stringify({ title: "Hello from the dialog", body: "Sent with the document." }));
  await dialog.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/app\/documents\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Draft");
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  const confirm = page.locator("#issue-draft");
  await expect(confirm.getByText("It cannot be edited afterwards")).toBeVisible();
  await confirm.getByRole("button", { name: "Issue (numbered, cannot be edited)" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^DOC-\d{4}-\d{3}$/);

  // One document per submission: the dialog lists the form's submissions.
  const confirmation = await newReport(page, "confirmation");
  expect((await page.request.post(`/api/v1/reports/${confirmation}/publish`)).status()).toBe(201);
  await page.goto(`/app/reports/${confirmation}`);
  await page.getByRole("button", { name: "Issue a document" }).click();
  const options = dialog.locator("#issue-submission option");
  await expect(options).toHaveCount(3);
  await expect(options.first()).toContainText("Ana Georgescu");
  await dialog.locator("#issue-submission").selectOption({ index: 2 });
  await dialog.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/app\/documents\/[^/]+$/);
  await expect(page.locator("[data-report-json]")).toContainText("Elena Popescu");
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("print themes are named for people, not by their slug (#52)", async ({ browser }) => {
  const { page, close } = await open(browser);
  const id = await newReport(page, "survey-summary");
  await design(page, id);
  await page.locator("#rt-look").click();
  const names = await page.locator("[data-rd-theme] [data-weight='medium']").allInnerTexts();
  expect(names).toEqual(expect.arrayContaining(["Document", "Document serif", "Swiss document"]));
  for (const n of names) expect(n).not.toMatch(/-/);
  await page.locator("[data-rd-theme]").filter({ hasText: "Swiss document" }).click();
  await waitSaved(page);
  expect((await stored(page, id)).appearance.theme).toBe("swiss-document");
  await close();
});

test("the header is one bar and zoom keeps the place in the document (#51, #55)", async ({ browser }) => {
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const id = await newReport(page, "survey-summary");
  await design(page, id);
  const bar = (await page.locator("[data-designer-bar]").boundingBox())!;
  expect(bar.height).toBeLessThanOrEqual(64);
  const middle = async (sel: string) => { const b = (await page.locator(sel).first().boundingBox())!; return b.y + b.height / 2; };
  const titleMid = await middle("#rd-title");
  expect(Math.abs((await middle("[data-designer-bar] [data-variant='primary']")) - titleMid)).toBeLessThanOrEqual(2);
  expect(Math.abs((await middle("[data-designer-bar] [data-ui='toggle-group']")) - titleMid)).toBeLessThanOrEqual(2);
  // The panes start under the bar, side by side.
  const palette = (await page.locator("[data-designer-palette]").boundingBox())!;
  const inspector = (await page.locator("[data-designer-props]").boundingBox())!;
  expect(Math.abs(palette.y - inspector.y)).toBeLessThanOrEqual(1);
  expect((await page.locator("#rd-tabs").boundingBox())!.y - (bar.y + bar.height)).toBeLessThan(48);

  // Zoom: the desk keeps the same place in the document, not the same pixel offset.
  const desk = page.locator("[data-rd-desk]");
  await page.getByText("100 %", { exact: true }).click();
  await expect(page.locator("[data-rd-sheet]")).toHaveAttribute("style", /--canvas-zoom: 1;/);
  const at = () => desk.evaluate((el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
  await desk.evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; });
  const before = await at();
  await page.getByText("150 %", { exact: true }).click();
  await expect(page.locator("[data-rd-sheet]")).toHaveAttribute("style", /--canvas-zoom: 1.5;/);
  await expect.poll(at).toBeCloseTo(before, 1);
  await desk.evaluate((el) => { el.scrollTop = 0; });
  await page.getByText("Fit", { exact: true }).click();
  await expect.poll(() => desk.evaluate((el) => el.scrollTop)).toBe(0);
  expect(errors.pageErrors).toEqual([]);
  await close();
});

test("the report page offers publishing only when there are edits, and its number filter speaks the report's numbering", async ({ browser }) => {
  const { page, close } = await open(browser);
  const errors = watchErrors(page);
  const id = await newReport(page, "survey-summary");
  const actions = page.locator("[data-ui='cluster']").filter({ has: page.getByRole("link", { name: "Design" }) });
  await page.goto(`/app/reports/${id}`);
  await expect(actions.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  expect((await page.request.post(`/api/v1/reports/${id}/publish`)).status()).toBe(201);
  await page.reload();
  await expect(actions.getByRole("button", { name: /publish/i })).toHaveCount(0);
  await expect(page.locator("#doc-number")).toHaveAttribute("placeholder", `SUM-${new Date().getFullYear()}-…`);
  const def = await stored(page, id);
  def.documentTitle = "Edited";
  expect((await page.request.patch(`/api/v1/reports/${id}`, { data: { definition: def } })).status()).toBe(200);
  await page.reload();
  await expect(actions.getByRole("button", { name: "Publish changes" })).toBeVisible();
  expect(errors.pageErrors).toEqual([]);
  await close();
});
