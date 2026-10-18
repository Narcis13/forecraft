import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openapi } from "../../src/api/openapi.ts";
import { ACCENTS, LAYOUTS, THEMES } from "../../src/forms/model.ts";
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
});
