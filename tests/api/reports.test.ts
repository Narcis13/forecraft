import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { startServer, type TestServer } from "../helpers.ts";
import { closeBrowser } from "../../src/reports/pdf.ts";
import { readPdf } from "../../src/reports/preflight.ts";

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

describe("reports API", () => {
  let s: TestServer;
  before(async () => { s = await startServer({ seed: true }); });
  after(async () => { await s.close(); await closeBrowser(); });

  let reportId = "";
  let logo = "";
  let first: { id: string; number: string; pdf_url: string; share_url: string } | null = null;

  test("assets: a PNG is stored, a script disguised as a PNG is refused", async () => {
    const ok = await s.api("/api/v1/assets?name=logo.png", { method: "POST", body: PNG_1x1, headers: { "content-type": "image/png" } });
    assert.equal(ok.status, 201);
    const a = await ok.json();
    assert.equal(a.type, "image/png");
    assert.match(a.ref, /^asset:ast_/);
    logo = a.ref;
    const served = await fetch(s.url + new URL(a.url).pathname);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    const bad = await s.api("/api/v1/assets?name=evil.png", { method: "POST", body: Buffer.from("<script>alert(1)</script>"), headers: { "content-type": "image/png" } });
    assert.equal(bad.status, 415);
    const svg = await s.api("/api/v1/assets", { method: "POST", body: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"), headers: { "content-type": "image/svg+xml" } });
    assert.equal(svg.status, 422);
  });

  test("starters are listed", async () => {
    const res = await s.api("/api/v1/report-starters");
    const { items } = await res.json();
    assert.ok(items.some((i: { id: string }) => i.id === "invoice"));
  });

  test("create from the invoice starter with a company and an accent", async () => {
    const res = await s.api("/api/v1/reports", { method: "POST", json: { starter: "invoice", title: "Invoice", appearance: { accent: "#7c2d12", logo }, sample: { seller: { name: "Quayside Logistics Ltd", street: "4 Harbour Row", city: "Leith EH6 6LX", iban: "GB29NWBK60161331926819" } } } });
    assert.equal(res.status, 201, await res.clone().text());
    const r = await res.json();
    reportId = r.id;
    assert.equal(r.definition.appearance.accent, "#7c2d12");
    assert.equal(r.definition.sample.seller.name, "Quayside Logistics Ltd");
  });

  test("a bad expression is a 422 naming the block's pointer, line and column", async () => {
    const r = await (await s.api(`/api/v1/reports/${reportId}`)).json();
    const def = structuredClone(r.definition);
    def.layout[1].text = "{{ label(\"invoice\") ";
    const res = await s.api(`/api/v1/reports/${reportId}`, { method: "PATCH", json: { definition: def } });
    assert.equal(res.status, 422);
    const p = await res.json();
    assert.equal(p.errors[0].pointer, "/layout/1/text");
    assert.equal(p.errors[0].line, 1);
    assert.ok(p.errors[0].column > 0);
  });

  test("preview: preflight and page images", async () => {
    const res = await s.api(`/api/v1/reports/${reportId}/preview`, { method: "POST", json: { format: "png", pages: 2 } });
    assert.equal(res.status, 200, await res.clone().text());
    const p = await res.json();
    assert.ok(Array.isArray(p.findings));
    assert.ok(p.images.length >= 1);
    assert.equal(Buffer.from(p.images[0].data, "base64").subarray(1, 4).toString(), "PNG");
  });

  test("documents need a published version", async () => {
    const res = await s.api(`/api/v1/reports/${reportId}/documents`, { method: "POST", json: { data: {}, issue: true } });
    assert.equal(res.status, 409);
    const pub = await s.api(`/api/v1/reports/${reportId}/publish`, { method: "POST" });
    assert.equal(pub.status, 201);
  });

  test("bad data is a 422 with pointers", async () => {
    const res = await s.api(`/api/v1/reports/${reportId}/documents`, { method: "POST", json: { data: { items: [] }, issue: true } });
    assert.equal(res.status, 422);
    const p = await res.json();
    assert.ok(p.errors.length > 0);
    assert.ok(p.errors.every((e: { pointer: string }) => e.pointer.startsWith("/")));
  });

  test("issue from JSON: a number, a PDF and a share link", async () => {
    const r = await (await s.api(`/api/v1/reports/${reportId}`)).json();
    const res = await s.api(`/api/v1/reports/${reportId}/documents`, { method: "POST", json: { data: r.definition.sample, issue: true } });
    assert.equal(res.status, 201, await res.clone().text());
    first = await res.json();
    assert.match(first!.number, /^INV-\d{4}-0001$/);
    const pdf = await s.api(new URL(first!.pdf_url).pathname);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition") ?? "", new RegExp(`${first!.number}\\.pdf`));
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const again = new Uint8Array(await (await s.api(new URL(first!.pdf_url).pathname)).arrayBuffer());
    assert.deepEqual(again, bytes, "every download serves the same bytes");
    const read = await readPdf(bytes);
    assert.ok(read.pages[0]!.lines.some((l) => l.text.includes(first!.number)));
    const share = await fetch(s.url + new URL(first!.share_url).pathname);
    assert.equal(share.status, 200);
    assert.match(share.headers.get("x-robots-tag") ?? "", /noindex/);
  });

  test("issued documents are immutable", async () => {
    const res = await s.api(`/api/v1/documents/${first!.id}`, { method: "PATCH", json: { data: {} } });
    assert.equal(res.status, 409);
    const del = await s.api(`/api/v1/documents/${first!.id}`, { method: "DELETE" });
    assert.equal(del.status, 409);
  });

  test("rotating the share link revokes the old one", async () => {
    const old = new URL(first!.share_url).pathname;
    const res = await s.api(`/api/v1/documents/${first!.id}/share/rotate`, { method: "POST" });
    const { share_url } = await res.json();
    assert.equal((await fetch(s.url + old)).status, 404);
    assert.equal((await fetch(s.url + new URL(share_url).pathname)).status, 200);
  });

  test("void with a reason keeps the number; the next issue gets the next number", async () => {
    const noReason = await s.api(`/api/v1/documents/${first!.id}/void`, { method: "POST", json: {} });
    assert.equal(noReason.status, 422);
    const v = await s.api(`/api/v1/documents/${first!.id}/void`, { method: "POST", json: { reason: "Issued to the wrong entity" } });
    assert.equal(v.status, 200);
    const voided = await v.json();
    assert.equal(voided.status, "void");
    assert.equal(voided.number, first!.number);
    const r = await (await s.api(`/api/v1/reports/${reportId}`)).json();
    const next = await (await s.api(`/api/v1/reports/${reportId}/documents`, { method: "POST", json: { data: r.definition.sample, issue: true } })).json();
    assert.match(next.number, /0002$/);
    const list = await (await s.api(`/api/v1/documents?report=${reportId}&status=void`)).json();
    assert.equal(list.total, 1);
  });

  test("the number filter is exact; a report with issued documents cannot be deleted", async () => {
    const exact = await (await s.api(`/api/v1/documents?number=${encodeURIComponent(first!.number)}`)).json();
    assert.equal(exact.total, 1);
    const partial = await (await s.api(`/api/v1/documents?number=${encodeURIComponent(first!.number.slice(0, -1))}`)).json();
    assert.equal(partial.total, 0);
    const del = await s.api(`/api/v1/reports/${reportId}`, { method: "DELETE" });
    assert.equal(del.status, 409);
    assert.equal((await del.json()).type.endsWith("has-documents"), true);
  });

  test("the share view loads nothing from elsewhere", async () => {
    const list = await (await s.api(`/api/v1/documents?report=${reportId}&status=issued`)).json();
    const share = await fetch(s.url + new URL(list.items[0].share_url).pathname);
    assert.equal(share.status, 200);
    assert.match(share.headers.get("content-security-policy") ?? "", /default-src 'none'.*img-src 'self' data:/);
  });

  test("a logo from another workspace (or none) is a preflight error, not a broken image", async () => {
    const fake = logo.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
    const res = await s.api("/api/v1/reports", { method: "POST", json: { starter: "invoice", title: "Ghost", appearance: { logo: fake } } });
    assert.equal(res.status, 201, await res.clone().text());
    const r = await res.json();
    const p = await (await s.api(`/api/v1/reports/${r.id}/preview`, { method: "POST", json: { format: "html" } })).json();
    assert.ok(p.findings.some((f: { code: string; severity: string }) => f.code === "missing-asset" && f.severity === "error"), JSON.stringify(p.findings));
  });

  test("a submission prints with zero setup", async () => {
    const forms = await (await s.api("/api/v1/forms")).json();
    const subs = await (await s.api(`/api/v1/forms/${forms.items[0].id}/submissions`)).json();
    const res = await s.api(`/api/v1/submissions/${subs.items[0].id}/pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
  });
});

// ── Designing against the bound form (UX audit #7, #8, #9, #32–#34) ──────────

describe("reports API: data from the bound form", () => {
  let s: TestServer;
  before(async () => { s = await startServer({ seed: true }); });
  after(async () => { await s.close(); await closeBrowser(); });

  const WORKSHOP = {
    schema: {
      title: "Workshop orders", type: "object",
      properties: {
        name: { type: "string", title: "Your name" },
        email: { type: "string", format: "email", title: "Email" },
        company: { type: "string", title: "Company name" },
        workshop: { type: "string", title: "Workshop", enum: ["Advanced React", "Design systems"] },
        seats: { type: "integer", title: "Seats", minimum: 1, maximum: 20 },
        payment: { type: "string", title: "Payment", enum: ["Card", "Invoice"] },
        newsletter: { type: "boolean", title: "Newsletter" },
        lineItems: { type: "array", title: "Line items", items: { type: "object", properties: { label: { type: "string", title: "Item" }, qty: { type: "number", title: "Qty" }, amount: { type: "number", title: "Amount" } } } },
        notes: { type: "string", title: "Anything else?" },
      },
      required: ["name", "email"],
    },
    ui: { notes: { widget: "textarea" } },
  };
  let formId = "";
  let summaryId = "";
  let registerId = "";

  test("a summary made from a form with no answers yet designs against made-up answers shaped like that form", async () => {
    const f = await s.api("/api/v1/forms", { method: "POST", json: { definition: WORKSHOP } });
    assert.equal(f.status, 201, await f.clone().text());
    formId = (await f.json()).id;
    const r = await s.api("/api/v1/reports", { method: "POST", json: { starter: "survey-summary", form: formId } });
    assert.equal(r.status, 201, await r.clone().text());
    const report = await r.json();
    summaryId = report.id;
    assert.equal(report.definition.sample.form.title, "Workshop orders", "the starter's demo survey is gone");
    assert.deepEqual(report.definition.sample.questions.map((q: { name: string }) => q.name), Object.keys(WORKSHOP.schema.properties));

    const sample = await (await s.api(`/api/v1/reports/${summaryId}/sample`)).json();
    assert.equal(sample.origin, "synthetic");
    assert.equal(sample.count, 0);
    assert.deepEqual(sample.source, { kind: "summary", form: formId });
    assert.equal(sample.data.form.title, "Workshop orders");
    assert.ok(sample.schema.properties.questions, "the summary's schema comes with it");
    assert.equal(sample.schema.title, report.definition.schema.title);
  });

  test("with answers in, the sample, the preview and preflight use them", async () => {
    const { insertSubmission } = await import("../../src/forms/store.ts");
    const answers = [
      { name: "Elena Popescu", email: "elena@example.test", company: "Popescu Digital SRL", workshop: "Advanced React", seats: 3, payment: "Invoice", newsletter: true, lineItems: [{ label: "Lunch", qty: 3, amount: 45 }], notes: "Please invoice our accounts team." },
      { name: "Tom Becker", email: "tom@example.test", workshop: "Design systems", seats: 1, payment: "Card" },
    ];
    // Today, an hour apart, so their order is certain.
    const today = new Date().toISOString().slice(0, 10);
    answers.forEach((a, i) => {
      const sub = insertSubmission(s.db, formId, 1, a, "test");
      s.db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run(`${today}T0${8 + i}:00:00.000Z`, sub.id);
    });
    const sample = await (await s.api(`/api/v1/reports/${summaryId}/sample`)).json();
    assert.equal(sample.origin, "submissions");
    assert.equal(sample.count, 2);
    const seats = sample.data.questions.find((q: { name: string }) => q.name === "seats");
    assert.equal(seats.mean, 2);
    assert.ok(!JSON.stringify(sample.data.verbatims).includes("@"), "no email is quoted");
    assert.equal(sample.data.questions.find((q: { name: string }) => q.name === "payment").tie, true);

    // Bind the stats to one question by name, guarded and positional forms included.
    const def = (await (await s.api(`/api/v1/reports/${summaryId}`)).json()).definition;
    def.layout.splice(1, 0, { id: "seats", block: "stats", items: [
      { label: "Seats", value: "{{ number(question(\"seats\").mean, 1) }}" },
      { label: "Guarded", value: "{{ questions[4] ? number(questions[4].mean, 1) : \"—\" }}" },
      { label: "Absent", value: "{{ question(\"nothing\") ? question(\"nothing\").mean : \"—\" }}" },
      { label: "Options", value: "{{ count(questions[40].options ?? []) }}" },
    ] });
    const patched = await s.api(`/api/v1/reports/${summaryId}`, { method: "PATCH", json: { definition: def } });
    assert.equal(patched.status, 200, await patched.clone().text());
    const p = await (await s.api(`/api/v1/reports/${summaryId}/preview`, { method: "POST", json: { format: "html" } })).json();
    assert.deepEqual(p.findings.filter((f: { severity: string }) => f.severity === "error"), []);
    assert.match(p.html, /Workshop orders/);
    assert.doesNotMatch(p.html, /How was your month/);

    // A question that is not there is named the way the author wrote it.
    def.layout[1].items.push({ label: "Typo", value: "{{ question(\"seat\").mean }}" });
    await s.api(`/api/v1/reports/${summaryId}`, { method: "PATCH", json: { definition: def } });
    const bad = await (await s.api(`/api/v1/reports/${summaryId}/preview`, { method: "POST", json: { format: "html" } })).json();
    const missing = bad.findings.find((f: { code: string }) => f.code === "missing-data");
    assert.equal(missing.path, "question(\"seat\").mean");
  });

  test("the sample endpoint takes a form and a kind for an unsaved working copy", async () => {
    const r = await (await s.api("/api/v1/reports", { method: "POST", json: { starter: "invoice" } })).json();
    const own = await (await s.api(`/api/v1/reports/${r.id}/sample`)).json();
    assert.equal(own.origin, "definition");
    assert.deepEqual(own.source, { kind: "data" });
    const reg = await (await s.api(`/api/v1/reports/${r.id}/sample?form=${formId}&kind=submissions`)).json();
    assert.equal(reg.origin, "submissions");
    assert.equal(reg.data.count, 2);
    assert.deepEqual(Object.keys(reg.data).sort(), ["columns", "count", "form", "period", "rows"]);
    assert.equal(reg.data.rows[1].newsletter, false);
    assert.equal(reg.data.rows[1].company, null);
    assert.equal(reg.data.rows[0].totals.lineItems.amount, 45);
    assert.ok(reg.schema.properties.rows.items.properties.seats);
    const bad = await s.api(`/api/v1/reports/${r.id}/sample?kind=register`);
    assert.equal(bad.status, 422);
    const noForm = await s.api(`/api/v1/reports/${r.id}/sample?kind=summary`);
    assert.equal(noForm.status, 422);
  });

  test("a submissions register lists the form's answers, with columns from the form and a total", async () => {
    const r = await s.api("/api/v1/reports", { method: "POST", json: { starter: "submissions-register", title: "Orders register", form: formId } });
    assert.equal(r.status, 201, await r.clone().text());
    const report = await r.json();
    registerId = report.id;
    assert.deepEqual(report.definition.source, { kind: "submissions", form: formId });
    const table = report.definition.layout.find((b: { id: string }) => b.id === "register");
    assert.deepEqual(table.columns.map((c: { label: string }) => c.label), ["No.", "Date", "Your name", "Company name", "Workshop", "Seats", "Line items: Amount"]);
    assert.equal(table.footer[0].value, "{{ number(sum(rows, \"seats\")) }}");
    const p = await (await s.api(`/api/v1/reports/${registerId}/preview`, { method: "POST", json: { format: "png", pages: 1, dpi: 36 } })).json();
    assert.deepEqual(p.findings.filter((f: { severity: string }) => f.severity === "error"), []);
    assert.equal(p.pages, 1);
    assert.equal((await s.api(`/api/v1/reports/${registerId}/publish`, { method: "POST" })).status, 201);
    const today = new Date().toISOString().slice(0, 10);
    const doc = await s.api(`/api/v1/reports/${registerId}/documents`, { method: "POST", json: { period: { since: today, until: today }, issue: true } });
    assert.equal(doc.status, 201, await doc.clone().text());
    const d = await (await s.api(`/api/v1/documents/${(await doc.json()).id}`)).json();
    assert.equal(d.data.count, 2);
    assert.equal(d.data.rows[0].name, "Elena Popescu");
    const html = await (await fetch(s.url + new URL(d.share_url).pathname)).text();
    assert.match(html, /Orders register · REG-/, "the footer follows the report's name");
  });

  test("the vocabulary lists the submissions source, doc.title, question() and the 0–100 share", async () => {
    const v = await (await s.api("/api/v1/vocabulary/reports")).json();
    assert.ok(v.sources.some((x: { kind: string }) => x.kind === "submissions"));
    assert.ok(v.system_values.includes("doc.title"));
    assert.ok(v.helpers.some((h: { name: string }) => h.name === "question"));
    assert.ok(v.submissions_shape.rows);
    assert.match(v.units.share, /0–100/);
  });

  test("without Chromium every printing route is a 503 that says how to install it", async () => {
    await closeBrowser();
    process.env.FORECRAFT_CHROMIUM = "/nonexistent/chromium";
    try {
      const res = await s.api(`/api/v1/reports/${registerId}/preview`, { method: "POST", json: { format: "png" } });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("content-type"), "application/problem+json");
      const p = await res.json();
      assert.equal(p.type.endsWith("/renderer-not-installed"), true);
      assert.match(p.detail, /npx playwright install --only-shell chromium/);
      const html = await s.api(`/api/v1/reports/${registerId}/preview`, { method: "POST", json: { format: "html" } });
      assert.equal(html.status, 200, "the HTML preview needs no browser");
    } finally {
      delete process.env.FORECRAFT_CHROMIUM;
      await closeBrowser();
    }
    const ok = await s.api(`/api/v1/reports/${registerId}/preview`, { method: "POST", json: { format: "png", pages: 1, dpi: 36 } });
    assert.equal(ok.status, 200);
  });
});
