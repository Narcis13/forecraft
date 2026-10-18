import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openapi } from "../../src/api/openapi.ts";
import { ACCENTS, LAYOUTS, THEMES } from "../../src/forms/model.ts";
import { BLOCKS, PRINT_THEMES, TYPE_PAIRINGS } from "../../src/reports/model.ts";
import { PREFLIGHT_CODES } from "../../src/reports/preflight.ts";
import { startServer, type TestServer } from "../helpers.ts";

// Every route registered in src/routes/api.ts (relative to /api/v1), written out by hand.
const ROUTES: [method: string, path: string][] = [
  ["post", "/f/{slug}/submissions"],
  ["get", "/workspace"],
  ["patch", "/workspace"],
  ["get", "/workspace/members"],
  ["post", "/workspace/invites"],
  ["get", "/keys"],
  ["post", "/keys"],
  ["delete", "/keys/{id}"],
  ["get", "/forms"],
  ["post", "/forms"],
  ["get", "/forms/{id}"],
  ["patch", "/forms/{id}"],
  ["delete", "/forms/{id}"],
  ["post", "/forms/{id}/publish"],
  ["get", "/forms/{id}/versions"],
  ["get", "/forms/{id}/versions/{version}"],
  ["post", "/preview"],
  ["post", "/forms/{id}/preview"],
  ["post", "/forms/{id}/validate"],
  ["get", "/forms/{id}/submissions"],
  ["get", "/forms/{id}/submissions/export"],
  ["get", "/submissions/{id}"],
  ["delete", "/submissions/{id}"],
  ["get", "/vocabulary"],
  // reports, documents, assets (src/routes/reports-api.ts)
  ["get", "/vocabulary/reports"],
  ["get", "/report-starters"],
  ["get", "/reports"],
  ["post", "/reports"],
  ["get", "/reports/{id}"],
  ["patch", "/reports/{id}"],
  ["delete", "/reports/{id}"],
  ["post", "/reports/{id}/publish"],
  ["get", "/reports/{id}/versions"],
  ["get", "/reports/{id}/versions/{version}"],
  ["post", "/reports/{id}/preview"],
  ["post", "/reports/{id}/documents"],
  ["get", "/documents"],
  ["get", "/documents/{id}"],
  ["patch", "/documents/{id}"],
  ["delete", "/documents/{id}"],
  ["get", "/documents/{id}/pdf"],
  ["post", "/documents/{id}/issue"],
  ["post", "/documents/{id}/void"],
  ["post", "/documents/{id}/share/rotate"],
  ["get", "/submissions/{id}/pdf"],
  ["post", "/assets"],
  ["get", "/assets"],
  ["get", "/assets/{id}"],
  // the public share view (src/routes/documents.ts), served from the site root
  ["get", "/d/{token}"],
  ["get", "/d/{token}.pdf"],
];

describe("openapi document", () => {
  const doc = openapi("https://forms.example.com/") as any;

  test("is OpenAPI 3.1 with the request's origin as server", () => {
    assert.equal(doc.openapi, "3.1.0");
    assert.equal(doc.servers[0].url, "https://forms.example.com/api/v1");
    assert.equal(doc.components.securitySchemes.bearerAuth.scheme, "bearer");
    assert.deepEqual(doc.security, [{ bearerAuth: [] }]);
  });

  test("describes every route in api.ts and nothing else", () => {
    const documented: string[] = [];
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      for (const method of ["get", "post", "put", "patch", "delete"]) if (item[method]) documented.push(`${method} ${path}`);
    }
    assert.deepEqual(documented.sort(), ROUTES.map(([m, p]) => `${m} ${p}`).sort());
  });

  test("the public submission route needs no key; the rest do", () => {
    assert.deepEqual(doc.paths["/f/{slug}/submissions"].post.security, []);
    assert.equal(doc.paths["/forms"].post.security, undefined);
  });

  test("reports, documents and assets are documented with their bodies, files and problems", () => {
    const p = doc.paths;
    // create: a starter, a definition, or the bare definition; the curated appearance is enumerated
    const create = p["/reports"].post;
    assert.equal(create.requestBody.content["application/json"].schema.oneOf.length, 3);
    assert.ok(create.responses["201"] && create.responses["422"]);
    const appearance = doc.components.schemas.ReportAppearance.properties;
    assert.deepEqual(appearance.theme.enum, [...PRINT_THEMES]);
    assert.deepEqual(appearance.type.enum, Object.keys(TYPE_PAIRINGS));
    assert.deepEqual(appearance.paper.enum, ["a4", "letter"]);
    assert.ok(appearance.accent.pattern);
    assert.deepEqual(doc.components.schemas.ReportBlock.properties.block.enum, Object.keys(BLOCKS));

    // preview: JSON (png / html) or the raw PDF with preflight headers; 503 and 429 are documented
    const preview = p["/reports/{id}/preview"].post;
    const ok = preview.responses["200"];
    assert.ok(ok.content["application/json"] && ok.content["application/pdf"]);
    assert.ok(ok.headers["Preflight-Errors"] && ok.headers["Preflight-Warnings"]);
    assert.deepEqual(doc.components.schemas.PreviewRequest.properties.format.enum, ["png", "pdf", "html"]);
    const result = doc.components.schemas.PreviewResult;
    assert.equal(result.properties.images.items.properties.type.const, "image/png");
    assert.deepEqual(doc.components.schemas.Finding.properties.severity.enum, ["error", "warning"]);
    for (const op of [preview, p["/reports/{id}/documents"].post, p["/documents/{id}/pdf"].get, p["/submissions/{id}/pdf"].get]) {
      assert.ok(op.responses["503"] && op.responses["429"], op.operationId);
    }
    assert.ok(doc.components.responses.RendererBusy.headers["Retry-After"]);

    // documents: issue now, 409 when unpublished, immutable once issued, a reason to void
    const docs = p["/reports/{id}/documents"].post;
    assert.ok(docs.responses["409"] && docs.responses["422"]);
    assert.equal(doc.components.schemas.CreateDocument.properties.issue.type, "boolean");
    assert.deepEqual(doc.components.schemas.Document.properties.status.enum, ["draft", "issued", "void"]);
    assert.ok(p["/documents/{id}"].patch.responses["409"] && p["/documents/{id}"].delete.responses["409"]);
    assert.ok(p["/documents/{id}/pdf"].get.responses["200"].content["application/pdf"]);
    const reason = p["/documents/{id}/void"].post.requestBody.content["application/json"].schema;
    assert.deepEqual(reason.required, ["reason"]);
    assert.equal(reason.properties.reason.minLength, 3);
    assert.equal(reason.properties.reason.maxLength, 500);

    // assets: raw image bodies or multipart, and a ref to use in a definition
    const upload = p["/assets"].post;
    assert.deepEqual(Object.keys(upload.requestBody.content).sort(), ["image/jpeg", "image/png", "image/svg+xml", "image/webp", "multipart/form-data"]);
    assert.ok(upload.responses["415"] && upload.responses["413"]);
    assert.match(doc.components.schemas.Asset.properties.ref.pattern, /asset:ast_/);

    // the public share view needs no key and lives at the site root
    for (const path of ["/d/{token}", "/d/{token}.pdf"]) {
      assert.deepEqual(p[path].get.security, [], path);
      assert.equal(p[path].servers[0].url, "https://forms.example.com", path);
    }
  });

  test("the preflight codes in the document are the renderer's", () => {
    assert.deepEqual(doc.components.schemas.PreflightCode.properties.code.enum, PREFLIGHT_CODES.map((c) => c.code));
  });

  test("every operation has an id, a summary and a success response; ids are unique", () => {
    const ids = new Set<string>();
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      for (const method of ["get", "post", "patch", "delete"]) {
        const op = item[method];
        if (!op) continue;
        assert.ok(op.operationId, `${method} ${path}: operationId`);
        assert.ok(!ids.has(op.operationId), `duplicate operationId ${op.operationId}`);
        ids.add(op.operationId);
        assert.ok(op.summary, `${method} ${path}: summary`);
        assert.ok(Object.keys(op.responses).some((c) => c.startsWith("2")), `${method} ${path}: a 2xx response`);
      }
    }
  });

  test("path parameters are declared", () => {
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      const wanted = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const method of ["get", "post", "patch", "delete"]) {
        const op = item[method];
        if (!op) continue;
        const declared = new Set([...(item.parameters ?? []), ...(op.parameters ?? [])].filter((p: any) => p.in === "path").map((p: any) => p.name));
        for (const w of wanted) assert.ok(declared.has(w), `${method} ${path}: {${w}} undeclared`);
      }
    }
  });

  test("every $ref resolves", () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]!);
    assert.ok(refs.length > 20);
    for (const r of refs) {
      let node: any = doc;
      for (const part of r.split("/")) node = node?.[part];
      assert.ok(node, `unresolved $ref #/${r}`);
    }
  });

  test("problem+json, the definition and the appearance enums are modelled", () => {
    const problem = doc.components.schemas.Problem;
    for (const k of ["type", "title", "status", "detail", "errors"]) assert.ok(problem.properties[k], k);
    assert.ok(doc.components.responses.Invalid.content["application/problem+json"]);
    const def = doc.components.schemas.FormDefinition;
    assert.deepEqual(Object.keys(def.properties), ["schema", "ui", "rules", "appearance"]);
    const appearance = doc.components.schemas.Appearance.properties;
    assert.deepEqual(appearance.theme.enum, THEMES);
    assert.deepEqual(appearance.accent.enum, [...ACCENTS]);
    assert.deepEqual(appearance.layout.enum, [...LAYOUTS]);
    for (const name of ["Form", "Submission", "ApiKey", "ApiKeyCreated", "SubmissionReceipt", "Preview"]) assert.ok(doc.components.schemas[name], name);
  });
});

describe("/openapi.json and /llms.txt", () => {
  let s: TestServer;
  before(async () => { s = await startServer(); });
  after(async () => { await s.close(); });

  test("/openapi.json serves the document with this server as the origin", async () => {
    const res = await fetch(`${s.url}/openapi.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const doc = await res.json();
    assert.equal(doc.openapi, "3.1.0");
    assert.equal(doc.servers[0].url, `${s.url}/api/v1`);
    assert.ok(doc.paths["/forms/{id}/publish"]);
    for (const path of ["/reports", "/reports/{id}/preview", "/reports/{id}/documents", "/documents/{id}/void", "/assets"]) assert.ok(doc.paths[path], path);
  });

  test("/llms.txt is plain text in the llms.txt layout and links /openapi.json", async () => {
    const res = await fetch(`${s.url}/llms.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
    const body = await res.text();
    assert.match(body, /^# forecraft\n/);
    assert.match(body, /\n> .+/);
    assert.match(body, /^## /m);
    for (const path of ["/openapi.json", "/for-agents", "/docs/for-agents", "/docs/mcp"]) {
      assert.ok(body.includes(`](${s.url}${path})`), `links ${path}`);
    }
    assert.match(body, /curl -sX POST \$API\/forms /);
    assert.match(body, /packages\/mcp\/index\.mjs/);
  });

  test("/llms.txt teaches the first invoice and links the report docs and vocabulary", async () => {
    const body = await (await fetch(`${s.url}/llms.txt`)).text();
    assert.match(body, /^## Issue your first invoice$/m);
    for (const path of ["/docs/reports", "/docs/report-style", "/api/v1/vocabulary/reports"]) {
      assert.ok(body.includes(`](${s.url}${path})`), `links ${path}`);
    }
    for (const step of ["/report-starters", "starter", "/preview", "/publish", "/documents", "/void"]) assert.ok(body.includes(step), step);
    for (const tool of ["forecraft_create_report", "forecraft_preview_report", "forecraft_issue_document", "forecraft_void_document", "forecraft_upload_asset"]) assert.ok(body.includes(tool), tool);
    assert.match(body, /forecraft:\/\/report\/\{id\}/);
    assert.match(body, /forecraft:\/\/document\/\{id\}/);
  });
});
