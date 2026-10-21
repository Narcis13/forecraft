// Drives packages/mcp/index.mjs over stdio against a real test server.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser } from "../../src/reports/pdf.ts";
import { startServer, type TestServer } from "../helpers.ts";

const SERVER = join(import.meta.dirname, "../../packages/mcp/index.mjs");

type Rpc = { jsonrpc: "2.0"; id?: number; result?: any; error?: { code: number; message: string } };

class McpClient {
  child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private waiting = new Map<number, (m: Rpc) => void>();
  private buffer = "";
  stderr = "";
  /** Every raw line the server wrote, to prove stdout carries nothing but JSON-RPC. */
  lines: string[] = [];

  constructor(env: Record<string, string | undefined>) {
    const clean = { ...process.env, ...env };
    for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
    this.child = spawn(process.execPath, [SERVER], { env: clean as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        this.lines.push(line);
        const msg = JSON.parse(line) as Rpc;
        if (msg.id !== undefined) this.waiting.get(msg.id)?.(msg);
      }
    });
    this.child.stderr.on("data", (d) => { this.stderr += d; });
  }

  request(method: string, params?: unknown): Promise<Rpc> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}\n${this.stderr}`)), 60_000);
      this.waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params?: unknown) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async tool(name: string, args: Record<string, unknown> = {}) {
    const res = await this.request("tools/call", { name, arguments: args });
    assert.ok(res.result, `no result for ${name}: ${JSON.stringify(res)}`);
    return res.result as { content: { type: string; text: string; data?: string; mimeType?: string }[]; isError?: boolean };
  }

  async close() {
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.stdin.end();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    this.child.kill();
  }
}

const EXPECTED_TOOLS = [
  "forecraft_create_form", "forecraft_update_form", "forecraft_get_form", "forecraft_list_forms", "forecraft_publish_form",
  "forecraft_preview_form", "forecraft_list_submissions", "forecraft_get_submission", "forecraft_export_submissions",
  "forecraft_validate_submission",
];

const REPORT_TOOLS = [
  "forecraft_get_report_vocabulary", "forecraft_list_report_starters", "forecraft_create_report", "forecraft_update_report",
  "forecraft_get_report", "forecraft_list_reports", "forecraft_preview_report", "forecraft_publish_report",
  "forecraft_issue_document", "forecraft_list_documents", "forecraft_get_document", "forecraft_void_document", "forecraft_upload_asset",
];

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const definition = {
  schema: {
    title: "Pizza night",
    type: "object",
    properties: {
      name: { type: "string", title: "Your name", minLength: 2 },
      size: { type: "string", title: "Size", enum: ["Small", "Large"] },
      toppings: { type: "integer", title: "Toppings", minimum: 0, maximum: 5 },
    },
    required: ["name", "size"],
  },
  appearance: { theme: "nordic", submitLabel: "Order" },
};

describe("MCP server (stdio)", () => {
  let s: TestServer;
  let mcp: McpClient;
  before(async () => {
    s = await startServer({ seed: true });
    mcp = new McpClient({ FORECRAFT_URL: s.url, FORECRAFT_API_KEY: s.demo!.apiKey });
  });
  after(async () => {
    await mcp.close();
    await s.close();
    await closeBrowser(); // the renderer's warm Chromium lives in this process
  });

  test("scripted session: create -> preview -> publish -> submit -> read", async () => {
    // Handshake. An unsupported client version is answered with ours.
    const init = await mcp.request("initialize", {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" },
    });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "forecraft");
    assert.ok(init.result.capabilities.tools && init.result.capabilities.resources);
    mcp.notify("notifications/initialized");
    assert.deepEqual((await mcp.request("ping")).result, {});

    const list = await mcp.request("tools/list");
    const tools = list.result.tools as { name: string; description: string; inputSchema: { type: string } }[];
    const names = tools.map((t) => t.name);
    for (const n of EXPECTED_TOOLS) assert.ok(names.includes(n), `missing tool ${n}`);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object", t.name);
      assert.ok(t.description.length > 40, `${t.name} needs a real description`);
    }
    const create = tools.find((t) => t.name === "forecraft_create_form")!;
    assert.match(create.description, /\/api\/v1\/vocabulary/);
    assert.match(create.description, /"schema"/);

    // create
    const created = await mcp.tool("forecraft_create_form", { definition, slug: "pizza-night" });
    assert.ok(!created.isError, created.content[0]!.text);
    const form = JSON.parse(created.content[0]!.text);
    assert.match(form.id, /^frm_/);
    assert.equal(form.slug, "pizza-night");
    assert.equal(form.url, `${s.url}/f/pizza-night`);
    assert.match(form.preview_url, new RegExp(`/app/forms/${form.id}/preview$`));

    // preview: summary + HTML
    const prev = await mcp.tool("forecraft_preview_form", { id: form.id });
    assert.ok(!prev.isError);
    assert.equal(prev.content.length, 2);
    assert.match(prev.content[0]!.text, /Audit: PASSED/);
    assert.match(prev.content[0]!.text, /error=0/);
    assert.match(prev.content[1]!.text, /<form id="fc-form"/);

    // The same, for a definition that is not saved.
    const loose = await mcp.tool("forecraft_preview_form", { definition });
    assert.ok(!loose.isError);
    assert.match(loose.content[1]!.text, /<form id="fc-form"/);
    const neither = await mcp.tool("forecraft_preview_form", {});
    assert.equal(neither.isError, true);

    // publish
    const pub = await mcp.tool("forecraft_publish_form", { id: form.id });
    assert.ok(!pub.isError, pub.content[0]!.text);
    const published = JSON.parse(pub.content[0]!.text);
    assert.equal(published.version, 1);
    assert.equal(published.url, `${s.url}/f/pizza-night`);

    // A dry run of an answer, then a person submits through the public endpoint.
    const dry = JSON.parse((await mcp.tool("forecraft_validate_submission", { id: form.id, data: { name: "A" } })).content[0]!.text);
    assert.equal(dry.valid, false);
    const submit = await fetch(`${s.url}/api/v1/f/pizza-night/submissions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { name: "Grace Hopper", size: "Large", toppings: "3" } }),
    });
    assert.equal(submit.status, 201);

    // list / get / export
    const listed = await mcp.tool("forecraft_list_submissions", { id: form.id });
    assert.ok(!listed.isError);
    const page = JSON.parse(listed.content[0]!.text);
    assert.equal(page.total, 1);
    assert.equal(page.items[0].data.name, "Grace Hopper");
    assert.equal(page.items[0].data.toppings, 3);
    const none = JSON.parse((await mcp.tool("forecraft_list_submissions", { id: form.id, q: "nobody-by-this-name" })).content[0]!.text);
    assert.equal(none.total, 0);

    const got = await mcp.tool("forecraft_get_submission", { id: page.items[0].id });
    assert.equal(JSON.parse(got.content[0]!.text).id, page.items[0].id);

    const csv = await mcp.tool("forecraft_export_submissions", { id: form.id, format: "csv" });
    assert.match(csv.content[0]!.text, /^id,submitted_at,version,name,size,toppings/);
    const json = await mcp.tool("forecraft_export_submissions", { id: form.id, format: "json" });
    assert.equal(JSON.parse(json.content[0]!.text).items.length, 1);

    // get / list / update
    const fetched = JSON.parse((await mcp.tool("forecraft_get_form", { id: form.id })).content[0]!.text);
    assert.equal(fetched.definition.schema.title, "Pizza night");
    assert.equal(fetched.submission_count, 1);
    const forms = JSON.parse((await mcp.tool("forecraft_list_forms")).content[0]!.text);
    assert.ok(forms.items.length >= 5);
    const upd = await mcp.tool("forecraft_update_form", { id: form.id, status: "closed", submission_limit: null });
    assert.ok(!upd.isError, upd.content[0]!.text);
    assert.equal(JSON.parse(upd.content[0]!.text).status, "closed");
    assert.equal((await mcp.tool("forecraft_update_form", { id: form.id })).isError, true);

    const vocab = JSON.parse((await mcp.tool("forecraft_get_vocabulary")).content[0]!.text);
    assert.ok(vocab.themes.includes("nordic"));

    // resources
    const templates = await mcp.request("resources/templates/list");
    assert.equal(templates.result.resourceTemplates[0].uriTemplate, "forecraft://form/{id}");
    const resources = await mcp.request("resources/list");
    const uris = resources.result.resources.map((r: { uri: string }) => r.uri);
    assert.ok(uris.includes(`forecraft://form/${form.id}`));
    assert.equal(uris.filter((u: string) => u.startsWith("forecraft://form/")).length, forms.items.length);

    const read = await mcp.request("resources/read", { uri: `forecraft://form/${form.id}` });
    assert.equal(read.result.contents[0].mimeType, "application/json");
    assert.deepEqual(JSON.parse(read.result.contents[0].text), definition);

    const missing = await mcp.request("resources/read", { uri: "forecraft://form/frm_nope" });
    assert.equal(missing.error?.code, -32002);
  });

  describe("reports and documents", () => {
    let reportId = "";
    let sample: Record<string, unknown> = {};
    let issued: { id: string; number: string; pdf_url: string; share_url: string; status: string; findings: unknown[] };
    let draftId = "";

    test("tools/list has the 13 report tools with strict schemas and short descriptions", async () => {
      const tools = (await mcp.request("tools/list")).result.tools as { name: string; description: string; inputSchema: { type: string; additionalProperties?: boolean } }[];
      const names = tools.map((t) => t.name);
      assert.equal(REPORT_TOOLS.length, 13);
      for (const n of REPORT_TOOLS) assert.ok(names.includes(n), `missing tool ${n}`);
      for (const n of [...EXPECTED_TOOLS, ...REPORT_TOOLS]) assert.equal(tools.find((t) => t.name === n)!.inputSchema.additionalProperties, false, n);
      for (const n of REPORT_TOOLS) {
        const d = tools.find((t) => t.name === n)!.description;
        assert.ok(d.length > 40, n);
        assert.ok(d.split(/\.\s/).length <= 4, `${n}: keep descriptions to two sentences`);
      }
      const create = tools.find((t) => t.name === "forecraft_create_report")!.description;
      assert.match(create, /starter/);
      assert.match(create, /never sizes or colours/);
    });

    test("starters and the report vocabulary", async () => {
      const starters = JSON.parse((await mcp.tool("forecraft_list_report_starters")).content[0]!.text);
      const ids = starters.items.map((i: { id: string }) => i.id);
      assert.deepEqual(ids, ["invoice", "letter", "business-report", "confirmation", "survey-summary", "submissions-register", "blank"]);
      const vocab = JSON.parse((await mcp.tool("forecraft_get_report_vocabulary")).content[0]!.text);
      assert.ok(vocab.blocks.length > 5);
      assert.ok(vocab.print_themes.includes("document"));
      assert.ok(vocab.preflight_codes.some((c: { code: string }) => c.code === "missing-data"));
    });

    test("upload_asset: base64, a local file, and a refusal for what is not an image", async () => {
      const b64 = await mcp.tool("forecraft_upload_asset", { base64: PNG_1x1, type: "image/png", name: "logo.png" });
      assert.ok(!b64.isError, b64.content[0]!.text);
      const asset = JSON.parse(b64.content[0]!.text);
      assert.match(asset.ref, /^asset:ast_/);
      assert.equal(asset.type, "image/png");
      assert.equal(asset.name, "logo.png");

      const dir = mkdtempSync(join(tmpdir(), "forecraft-mcp-asset-"));
      try {
        writeFileSync(join(dir, "mark.png"), Buffer.from(PNG_1x1, "base64"));
        writeFileSync(join(dir, "notes.txt"), "not an image");
        const file = await mcp.tool("forecraft_upload_asset", { path: join(dir, "mark.png") });
        assert.ok(!file.isError, file.content[0]!.text);
        assert.equal(JSON.parse(file.content[0]!.text).name, "mark.png");
        const text = await mcp.tool("forecraft_upload_asset", { path: join(dir, "notes.txt") });
        assert.equal(text.isError, true);
        assert.match(text.content[0]!.text, /Not a PNG, JPEG, WebP or SVG/);
        const wrong = await mcp.tool("forecraft_upload_asset", { base64: PNG_1x1, type: "image/jpeg" });
        assert.equal(wrong.isError, true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      assert.equal((await mcp.tool("forecraft_upload_asset", {})).isError, true);
      assert.equal((await mcp.tool("forecraft_upload_asset", { path: "x", base64: "y" })).isError, true);
      assert.equal((await mcp.tool("forecraft_upload_asset", { path: join(tmpdir(), "forecraft-no-such-file.png") })).isError, true);
    });

    test("create from the invoice starter; exactly one of starter or definition", async () => {
      const logo = JSON.parse((await mcp.tool("forecraft_upload_asset", { base64: PNG_1x1 })).content[0]!.text).ref;
      const created = await mcp.tool("forecraft_create_report", {
        starter: "invoice", title: "Invoice",
        appearance: { accent: "#7c2d12", logo },
        sample: { seller: { name: "Quayside Logistics Ltd", street: "4 Harbour Row", city: "Leith EH6 6LX", iban: "GB29NWBK60161331926819" } },
      });
      assert.ok(!created.isError, created.content[0]!.text);
      const report = JSON.parse(created.content[0]!.text);
      assert.match(report.id, /^rpt_/);
      assert.equal(report.starter, "invoice");
      assert.equal(report.published_version, null);
      assert.equal(report.definition.appearance.accent, "#7c2d12");
      assert.equal(report.definition.sample.seller.name, "Quayside Logistics Ltd");
      reportId = report.id;
      sample = report.definition.sample;

      assert.equal((await mcp.tool("forecraft_create_report", {})).isError, true);
      assert.equal((await mcp.tool("forecraft_create_report", { starter: "invoice", definition: report.definition })).isError, true);
      assert.equal((await mcp.tool("forecraft_create_report", { definition: report.definition, title: "x" })).isError, true);
      const unknown = await mcp.tool("forecraft_create_report", { starter: "no-such-starter" });
      assert.equal(unknown.isError, true);
      assert.equal(JSON.parse(unknown.content[0]!.text).status, 404);
      // a pale accent is refused by the API, with pointers
      const pale = await mcp.tool("forecraft_create_report", { starter: "invoice", appearance: { accent: "#ffee99" } });
      assert.equal(pale.isError, true);
      assert.ok(JSON.parse(pale.content[0]!.text).errors.length > 0);

      const got = JSON.parse((await mcp.tool("forecraft_get_report", { id: reportId })).content[0]!.text);
      assert.equal(got.definition.schema.title, "Invoice");
      const list = JSON.parse((await mcp.tool("forecraft_list_reports")).content[0]!.text);
      assert.ok(list.items.some((r: { id: string }) => r.id === reportId));
      assert.ok(list.items.every((r: { definition?: unknown }) => r.definition === undefined));
    });

    test("preview returns the preflight as JSON text and the pages as PNG images", async () => {
      const prev = await mcp.tool("forecraft_preview_report", { id: reportId });
      assert.ok(!prev.isError, prev.content[0]!.text);
      const [head, ...pages] = prev.content;
      assert.equal(head!.type, "text");
      const summary = JSON.parse(head!.text);
      assert.ok(Array.isArray(summary.findings));
      assert.equal(typeof summary.ok, "boolean");
      assert.ok(summary.pages >= 1);
      assert.ok(summary.title.length > 0);
      assert.match(summary.verdict, /^Preflight /);
      assert.ok(pages.length >= 1 && pages.length <= 4);
      assert.equal(pages.length, summary.pages_shown);
      for (const img of pages) {
        assert.equal(img.type, "image");
        assert.equal(img.mimeType, "image/png");
        assert.equal(Buffer.from(img.data!, "base64").subarray(1, 4).toString(), "PNG");
      }

      // An unsaved definition, one page, a lower resolution.
      const def = JSON.parse((await mcp.tool("forecraft_get_report", { id: reportId })).content[0]!.text).definition;
      const small = await mcp.tool("forecraft_preview_report", { id: reportId, definition: def, pages: 1, dpi: 50, currency: "GBP" });
      assert.ok(!small.isError, small.content[0]!.text);
      assert.equal(small.content.length, 2);

      // A mistake in the definition is the API's 422, with the block's pointer.
      const broken = structuredClone(def);
      broken.layout[1].text = "{{ label(\"invoice\") ";
      const bad = await mcp.tool("forecraft_preview_report", { id: reportId, definition: broken });
      assert.equal(bad.isError, true);
      assert.equal(JSON.parse(bad.content[0]!.text).errors[0].pointer, "/layout/1/text");

      assert.equal((await mcp.tool("forecraft_preview_report", { id: reportId, pages: 9 })).isError, true);
      assert.equal((await mcp.tool("forecraft_preview_report", {})).isError, true);
    });

    test("issuing needs a published version; then publish and issue with the sample data", async () => {
      const early = await mcp.tool("forecraft_issue_document", { report: reportId, data: sample });
      assert.equal(early.isError, true);
      assert.equal(JSON.parse(early.content[0]!.text).status, 409);

      const pub = await mcp.tool("forecraft_publish_report", { id: reportId });
      assert.ok(!pub.isError, pub.content[0]!.text);
      assert.equal(JSON.parse(pub.content[0]!.text).version, 1);

      const wrong = await mcp.tool("forecraft_issue_document", { report: reportId, data: { items: [] } });
      assert.equal(wrong.isError, true);
      const problem = JSON.parse(wrong.content[0]!.text);
      assert.equal(problem.status, 422);
      assert.ok(problem.errors.every((e: { pointer: string }) => e.pointer.startsWith("/")));

      const res = await mcp.tool("forecraft_issue_document", { report: reportId, data: sample });
      assert.ok(!res.isError, res.content[0]!.text);
      issued = JSON.parse(res.content[0]!.text);
      assert.match(issued.number, /^INV-\d{4}-0001$/);
      assert.equal(issued.status, "issued");
      assert.match(issued.pdf_url, /\/api\/v1\/documents\/doc_\w+\/pdf$/);
      assert.match(issued.share_url, /\/d\/[\w-]+$/);
      assert.ok(Array.isArray(issued.findings));

      const draft = await mcp.tool("forecraft_issue_document", { report: reportId, data: sample, draft: true });
      assert.ok(!draft.isError, draft.content[0]!.text);
      const d = JSON.parse(draft.content[0]!.text);
      assert.equal(d.status, "draft");
      assert.equal(d.number, null);
      draftId = d.id;
    });

    test("list and get documents; update the report after publishing", async () => {
      const list = JSON.parse((await mcp.tool("forecraft_list_documents", { report: reportId, status: "issued" })).content[0]!.text);
      assert.equal(list.total, 1);
      assert.equal(list.items[0].number, issued.number);
      const byNumber = JSON.parse((await mcp.tool("forecraft_list_documents", { number: issued.number })).content[0]!.text);
      assert.equal(byNumber.items[0].id, issued.id);
      const drafts = JSON.parse((await mcp.tool("forecraft_list_documents", { status: "draft", limit: 5 })).content[0]!.text);
      assert.ok(drafts.items.some((x: { id: string }) => x.id === draftId));

      const got = JSON.parse((await mcp.tool("forecraft_get_document", { id: issued.id })).content[0]!.text);
      assert.equal(got.number, issued.number);
      assert.deepEqual(got.data, sample);
      assert.equal((await mcp.tool("forecraft_get_document", { id: "doc_missing" })).isError, true);

      const def = JSON.parse((await mcp.tool("forecraft_get_report", { id: reportId })).content[0]!.text).definition;
      def.schema.title = "Tax invoice";
      const upd = await mcp.tool("forecraft_update_report", { id: reportId, definition: def });
      assert.ok(!upd.isError, upd.content[0]!.text);
      const report = JSON.parse(upd.content[0]!.text);
      assert.equal(report.title, "Tax invoice");
      assert.equal(report.has_unpublished_changes, true);
      assert.equal(report.definition, undefined);
    });

    test("resources: report definition, and document metadata with the PDF as a blob", async () => {
      const templates = (await mcp.request("resources/templates/list")).result.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate);
      assert.deepEqual(templates, ["forecraft://form/{id}", "forecraft://report/{id}", "forecraft://document/{id}"]);

      const uris = (await mcp.request("resources/list")).result.resources.map((r: { uri: string }) => r.uri);
      assert.ok(uris.includes(`forecraft://report/${reportId}`));
      assert.ok(uris.includes(`forecraft://document/${issued.id}`));

      const rep = await mcp.request("resources/read", { uri: `forecraft://report/${reportId}` });
      assert.equal(rep.result.contents[0].mimeType, "application/json");
      assert.equal(JSON.parse(rep.result.contents[0].text).schema.title, "Tax invoice");

      const read = await mcp.request("resources/read", { uri: `forecraft://document/${issued.id}` });
      assert.ok(read.result, JSON.stringify(read));
      const [meta, pdf] = read.result.contents;
      assert.equal(meta.mimeType, "application/json");
      const doc = JSON.parse(meta.text);
      assert.equal(doc.number, issued.number);
      assert.deepEqual(doc.data, sample);
      assert.equal(pdf.mimeType, "application/pdf");
      assert.equal(pdf.uri, `forecraft://document/${issued.id}`);
      assert.equal(Buffer.from(pdf.blob, "base64").subarray(0, 5).toString(), "%PDF-");
      assert.equal(pdf.text, undefined);

      assert.equal((await mcp.request("resources/read", { uri: "forecraft://document/doc_nope" })).error?.code, -32002);
      assert.equal((await mcp.request("resources/read", { uri: "forecraft://report/rpt_nope" })).error?.code, -32002);
      assert.equal((await mcp.request("resources/read", { uri: "forecraft://document/" })).error?.code, -32002);
    });

    test("void: a reason is required; the number is kept and not reused", async () => {
      const short = await mcp.tool("forecraft_void_document", { id: issued.id, reason: "x" });
      assert.equal(short.isError, true);
      assert.match(short.content[0]!.text, /"reason" must be at least 3 characters/);
      assert.equal((await mcp.tool("forecraft_void_document", { id: issued.id })).isError, true);

      const res = await mcp.tool("forecraft_void_document", { id: issued.id, reason: "Issued to the wrong entity" });
      assert.ok(!res.isError, res.content[0]!.text);
      const voided = JSON.parse(res.content[0]!.text);
      assert.equal(voided.status, "void");
      assert.equal(voided.number, issued.number);
      assert.equal(voided.void_reason, "Issued to the wrong entity");

      const next = JSON.parse((await mcp.tool("forecraft_issue_document", { report: reportId, data: sample })).content[0]!.text);
      assert.match(next.number, /0002$/);
    });
  });

  test("an API refusal is a tool error carrying the problem detail", async () => {
    const bad = await mcp.tool("forecraft_create_form", {
      definition: { schema: { title: "x", type: "object", properties: { a: { type: "strin" } } } },
    });
    assert.equal(bad.isError, true);
    const problem = JSON.parse(bad.content[0]!.text);
    assert.equal(problem.status, 422);
    assert.equal(problem.type, "https://forecraft.dev/problems/invalid-definition");
    assert.ok(problem.errors[0].pointer.startsWith("/schema"), JSON.stringify(problem.errors));

    const absent = await mcp.tool("forecraft_get_form", { id: "frm_missing" });
    assert.equal(absent.isError, true);
    assert.equal(JSON.parse(absent.content[0]!.text).status, 404);

    // Argument mistakes are caught before any request is made.
    const args = await mcp.tool("forecraft_get_form", {});
    assert.equal(args.isError, true);
    assert.match(args.content[0]!.text, /"id" is required/);
    const unknown = await mcp.request("tools/call", { name: "forecraft_nope", arguments: {} });
    assert.equal(unknown.error?.code, -32602);
  });

  test("protocol edges", async () => {
    const res = await mcp.request("no/such/method");
    assert.equal(res.error?.code, -32601);
    // Unknown notifications are ignored, and an old client version is echoed back.
    mcp.notify("notifications/whatever");
    const other = new McpClient({ FORECRAFT_URL: s.url, FORECRAFT_API_KEY: undefined });
    try {
      const init = await other.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
      assert.equal(init.result.protocolVersion, "2024-11-05");
      const init2 = await other.request("initialize", { protocolVersion: "1999-01-01" });
      assert.equal(init2.result.protocolVersion, "2025-06-18");
      const noKey = await other.tool("forecraft_list_forms");
      assert.equal(noKey.isError, true);
      assert.match(noKey.content[0]!.text, /FORECRAFT_API_KEY/);
      for (const line of other.lines) JSON.parse(line); // stdout is JSON-RPC only
    } finally {
      await other.close();
    }
    for (const line of mcp.lines) assert.equal(JSON.parse(line).jsonrpc, "2.0");
  });
});
