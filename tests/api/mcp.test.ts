// Drives packages/mcp/index.mjs over stdio against a real test server.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
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
    return res.result as { content: { type: string; text: string }[]; isError?: boolean };
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
    assert.equal(uris.length, forms.items.length);

    const read = await mcp.request("resources/read", { uri: `forecraft://form/${form.id}` });
    assert.equal(read.result.contents[0].mimeType, "application/json");
    assert.deepEqual(JSON.parse(read.result.contents[0].text), definition);

    const missing = await mcp.request("resources/read", { uri: "forecraft://form/frm_nope" });
    assert.equal(missing.error?.code, -32002);
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
