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
    const res = await s.api("/api/v1/reports", { method: "POST", json: { starter: "invoice", title: "Invoice", appearance: { accent: "#7c2d12", logo }, sample: { seller: { name: "Quayside Logistics Ltd" } } } });
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

  test("a submission prints with zero setup", async () => {
    const forms = await (await s.api("/api/v1/forms")).json();
    const subs = await (await s.api(`/api/v1/forms/${forms.items[0].id}/submissions`)).json();
    const res = await s.api(`/api/v1/submissions/${subs.items[0].id}/pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
  });
});
