#!/usr/bin/env node
// forecraft MCP server — stdio transport, zero dependencies.
//
// Speaks JSON-RPC 2.0 over newline-delimited JSON (one message per line on
// stdin/stdout; logs go to stderr) and drives the forecraft REST API
// (/api/v1) with `fetch` and a bearer key.
//
//   FORECRAFT_URL      base URL of the forecraft server (default http://localhost:3000)
//   FORECRAFT_API_KEY  an fc_live_… key (required for tool calls and resources)

import { createInterface } from "node:readline";

const SERVER_INFO = { name: "forecraft", title: "forecraft", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const REQUEST_TIMEOUT_MS = 60_000;

const baseUrl = () => (process.env.FORECRAFT_URL || "http://localhost:3000").replace(/\/+$/, "");
const log = (...a) => process.stderr.write(`[forecraft-mcp] ${a.join(" ")}\n`);

// ── Tool vocabulary (kept in step with src/forms/model.ts; the API is the authority) ──

const ACCENTS = ["theme", "indigo", "violet", "rose", "orange", "amber", "emerald", "teal", "sky"];
const LAYOUTS = ["card", "split", "page"];
const SCHEMES = ["auto", "light", "dark"];

const DEFINITION_HELP = [
  "A form DEFINITION is one JSON object: { schema, ui?, rules?, appearance? }.",
  "- schema (required): a JSON Schema with root type \"object\", a root \"title\" (the form's title) and at least one entry in \"properties\"; optional root \"description\" and \"required\": [names].",
  "  Supported property subset: string (format email|uri|date|time|date-time|phone|iban|uuid|postal-code; minLength, maxLength, pattern, enum, const, examples), number/integer (minimum, maximum, multipleOf), boolean, nested object, array of enum strings (checkbox group / multi-select), array of objects with scalar fields (repeatable rows; minItems, maxItems). Each property should carry a \"title\". Anything outside the subset is rejected with a 422 that names the JSON pointer.",
  "- ui (optional): Faqir UI schema keyed by field name: { field: { widget: \"textarea\"|\"radio\"|\"select\"|\"switch\"|\"checkbox-group\"|\"multi-select\", placeholder, rows, enumLabels: [..] } }, plus \"ui:groups\": [{title, description?, fields:[..]}] to section the form or \"ui:wizard\": {label, steps:[{title, description?, fields:[..], when?}]} for a multi-step form (every field in exactly one group/step; cannot combine).",
  "- rules (optional): @faqir-ui/rules input: { rules: [ {id, show:\"field\", when}, {id, require:\"field\", when}, {id, validate:<logic>, path:\"field\", message}, {id, compute:\"field\", value:<logic>} ], messages? }. Conditions are JSONLogic, e.g. {\"==\":[{\"var\":\"plan\"},\"Team\"]}. Every rule needs a unique id. The server enforces the same rules on every submission.",
  "- appearance (optional): { theme, accent, scheme, layout, cover:{image,eyebrow}|null, submitLabel, thankYou:{title,message}, redirect:url|null }. accent: " + ACCENTS.join("|") + "; scheme: " + SCHEMES.join("|") + "; layout: " + LAYOUTS.join("|") + ". Valid theme names and the defaults are at GET /api/v1/vocabulary (tool forecraft_get_vocabulary).",
  "Minimal example: {\"schema\":{\"title\":\"Contact\",\"type\":\"object\",\"properties\":{\"email\":{\"type\":\"string\",\"format\":\"email\",\"title\":\"Email\"},\"message\":{\"type\":\"string\",\"title\":\"Message\",\"minLength\":10}},\"required\":[\"email\",\"message\"]},\"ui\":{\"message\":{\"widget\":\"textarea\",\"rows\":5}},\"appearance\":{\"theme\":\"nordic\",\"submitLabel\":\"Send\"}}",
].join("\n");

const DEFINITION_SCHEMA = {
  type: "object",
  description: "The form definition: { schema, ui?, rules?, appearance? }. See the tool description for the format.",
  properties: {
    schema: {
      type: "object",
      description: "JSON Schema. Root type \"object\", root \"title\" (the form title), \"properties\" with at least one field, optional \"description\" and \"required\".",
      properties: {
        type: { type: "string", const: "object" },
        title: { type: "string", description: "The form's title." },
        description: { type: "string" },
        properties: { type: "object", description: "Field name -> JSON Schema for that field (supported subset)." },
        required: { type: "array", items: { type: "string" } },
      },
      required: ["type", "title", "properties"],
    },
    ui: { type: "object", description: "Faqir UI schema: per-field { widget, placeholder, rows, enumLabels }, plus \"ui:groups\" or \"ui:wizard\"." },
    rules: { type: "object", description: "@faqir-ui/rules input: { rules: [{ id, show|require|validate|compute, when, ... }], messages? }." },
    appearance: {
      type: "object",
      description: "Look and feel of the public page.",
      properties: {
        theme: { type: "string", description: "A theme name from GET /api/v1/vocabulary (forecraft_get_vocabulary)." },
        accent: { type: "string", enum: ACCENTS },
        scheme: { type: "string", enum: SCHEMES },
        layout: { type: "string", enum: LAYOUTS },
        cover: { type: ["object", "null"], properties: { image: { type: "string" }, eyebrow: { type: "string" } } },
        submitLabel: { type: "string" },
        thankYou: { type: "object", properties: { title: { type: "string" }, message: { type: "string" } }, required: ["title", "message"] },
        redirect: { type: ["string", "null"], description: "http(s) URL to send people to after submitting, or null." },
      },
    },
  },
  required: ["schema"],
};

const ID_PROP = { type: "string", description: "The form id (frm_…), as returned by forecraft_create_form / forecraft_list_forms." };
const SLUG_PROP = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$", description: "Public URL slug: 3-64 chars, lowercase letters, digits and dashes. Must be unique across forecraft. Omit to get one derived from the title." };

// ── HTTP to the REST API ──────────────────────────────────────────────────

class ToolError extends Error {}

/** A non-2xx API answer, carried to the tool boundary so it becomes `isError: true`. */
class ApiError extends Error {
  constructor(res) {
    super(`HTTP ${res.status}`);
    this.res = res;
  }
}

async function call(method, path, { query, body } = {}) {
  const key = process.env.FORECRAFT_API_KEY;
  if (!key) {
    throw new ToolError(
      "FORECRAFT_API_KEY is not set. Create an API key in the forecraft dashboard (API keys) and put it in the MCP server's env as FORECRAFT_API_KEY (an fc_live_… value).",
    );
  }
  const url = new URL(`${baseUrl()}/api/v1${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const headers = { authorization: `Bearer ${key}`, accept: "application/json, application/problem+json, text/csv;q=0.9" };
  let payload;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message || err?.message || String(err);
    throw new ToolError(`Could not reach forecraft at ${baseUrl()} (${cause}). Check FORECRAFT_URL and that the server is running.`);
  }
  const raw = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let parsed = null;
  if (/json/.test(contentType) && raw) {
    try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
  }
  const res = {
    status: response.status,
    ok: response.ok,
    contentType,
    retryAfter: response.headers.get("retry-after"),
    body: parsed,
    raw,
  };
  if (!res.ok) throw new ApiError(res);
  return res;
}

function apiErrorResult(res) {
  let problem = res.body;
  if (!problem || typeof problem !== "object") {
    problem = { status: res.status, title: "Request failed", detail: res.raw.slice(0, 2000) || `HTTP ${res.status}` };
  } else {
    problem = { ...problem };
  }
  if (res.retryAfter) problem.retry_after_seconds = Number(res.retryAfter) || res.retryAfter;
  if (res.status === 401) problem.hint = "Check FORECRAFT_API_KEY: it must be an active fc_live_… key of this workspace.";
  return { content: [text(JSON.stringify(problem, null, 2))], isError: true };
}

// ── Result helpers ────────────────────────────────────────────────────────

const text = (t) => ({ type: "text", text: t });
const jsonText = (v) => text(JSON.stringify(v, null, 2));
const ok = (...items) => ({ content: items });

/** Create/update echo the form without its (possibly large) definition. */
function withoutDefinition(form) {
  if (!form || typeof form !== "object") return form;
  const { definition: _definition, ...rest } = form;
  return rest;
}

const enc = encodeURIComponent;

// ── Tools ─────────────────────────────────────────────────────────────────

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: "forecraft_create_form",
    title: "Create a form",
    description:
      "Create a new form (a DRAFT; nothing is public until forecraft_publish_form). Takes the form definition and an optional slug. " +
      "Returns the form: id (frm_…), slug, title, status, published_version (null until published), url (the public page, live only after publishing), preview_url (the dashboard preview). The definition is not echoed; use forecraft_get_form for it. " +
      "A definition that breaks the format is refused with a 422 problem whose `errors[]` lists a JSON pointer and a detail for each fault; fix and retry. " +
      "Recommended loop: create -> forecraft_preview_form (check audit) -> forecraft_publish_form.\n\n" + DEFINITION_HELP,
    inputSchema: {
      type: "object",
      properties: { definition: DEFINITION_SCHEMA, slug: SLUG_PROP },
      required: ["definition"],
      additionalProperties: false,
    },
    annotations: { title: "Create a form", ...WRITE },
    async run(a) {
      const body = { definition: a.definition };
      if (a.slug !== undefined) body.slug = a.slug;
      const res = await call("POST", "/forms", { body });
      return ok(jsonText(withoutDefinition(res.body)));
    },
  },
  {
    name: "forecraft_update_form",
    title: "Update a form",
    description:
      "Change a form: PATCH with any of definition, status, submission_limit, slug (at least one). " +
      "`definition` REPLACES the whole draft definition (send the complete { schema, ui?, rules?, appearance? }, not a fragment; read it first with forecraft_get_form). " +
      "Editing the draft does NOT change the live public form: call forecraft_publish_form afterwards (forms report has_unpublished_changes). " +
      "`status`: \"open\" accepts submissions, \"closed\" refuses them (takes effect immediately, no publish needed). `submission_limit`: positive integer, or null for unlimited. " +
      "Changing `slug` changes the public URL immediately. Returns the updated form (without the definition).\n\n" + DEFINITION_HELP,
    inputSchema: {
      type: "object",
      properties: {
        id: ID_PROP,
        definition: DEFINITION_SCHEMA,
        status: { type: "string", enum: ["open", "closed"], description: "open = accepting submissions, closed = refusing them." },
        submission_limit: { type: ["integer", "null"], minimum: 1, description: "Maximum number of submissions, or null for no limit." },
        slug: SLUG_PROP,
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Update a form", ...WRITE_IDEMPOTENT },
    async run(a) {
      const body = {};
      for (const k of ["definition", "status", "submission_limit", "slug"]) if (k in a) body[k] = a[k];
      if (Object.keys(body).length === 0) throw new ToolError("Nothing to update: pass at least one of definition, status, submission_limit, slug.");
      const res = await call("PATCH", `/forms/${enc(a.id)}`, { body });
      return ok(jsonText(withoutDefinition(res.body)));
    },
  },
  {
    name: "forecraft_get_form",
    title: "Get a form",
    description:
      "Fetch one form by id: id, slug, title, status (open|closed), submission_limit, published_version, has_unpublished_changes, submission_count, timestamps, url, preview_url and the full draft `definition` ({ schema, ui?, rules?, appearance? }). " +
      "Use it before forecraft_update_form to start from the current definition.",
    inputSchema: { type: "object", properties: { id: ID_PROP }, required: ["id"], additionalProperties: false },
    annotations: { title: "Get a form", ...READ },
    async run(a) {
      const res = await call("GET", `/forms/${enc(a.id)}`);
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_list_forms",
    title: "List forms",
    description:
      "List every form in the workspace, most recently updated first. Each item has id, slug, title, status, published_version, has_unpublished_changes, submission_count, url and preview_url (no definition; use forecraft_get_form for that).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List forms", ...READ },
    async run() {
      const res = await call("GET", "/forms");
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_publish_form",
    title: "Publish a form",
    description:
      "Publish the form's current draft: snapshots it as the next immutable version (1, 2, …) and serves it at the public url (/f/<slug>); people can submit from then on. " +
      "Returns { version, published_at, url }. Earlier submissions keep the version they were made against. Publish again after every forecraft_update_form that changes the definition. " +
      "Fails with 422 if the draft no longer compiles. Run forecraft_preview_form first and fix audit errors.",
    inputSchema: { type: "object", properties: { id: ID_PROP }, required: ["id"], additionalProperties: false },
    annotations: { title: "Publish a form", ...WRITE },
    async run(a) {
      const res = await call("POST", `/forms/${enc(a.id)}/publish`, { body: undefined });
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_preview_form",
    title: "Preview and audit a form",
    description:
      "Render a form to HTML and audit it (accessibility and markup checks); nothing is stored. Pass `id` to preview that form's saved draft, `definition` to preview a definition without saving it, or both to preview a proposed definition in the context of an existing form (at least one is required). " +
      "Returns TWO content items: (1) a summary: audit passed or not, counts by severity (critical, error, warning, info), each finding (rule_id, severity, line, message), and the number of rules; (2) the full rendered HTML page, so you can read it and self-check. " +
      "Treat counts.error > 0 or critical > 0 as something to fix before publishing. An invalid definition returns the 422 problem with pointers.\n\n" + DEFINITION_HELP,
    inputSchema: {
      type: "object",
      properties: { id: ID_PROP, definition: DEFINITION_SCHEMA },
      additionalProperties: false,
    },
    annotations: { title: "Preview and audit a form", ...READ },
    async run(a) {
      if (a.id === undefined && a.definition === undefined) throw new ToolError("Pass `id` (preview the saved draft), `definition` (preview an unsaved one), or both.");
      const body = a.definition !== undefined ? { definition: a.definition } : undefined;
      const res = a.id !== undefined
        ? await call("POST", `/forms/${enc(a.id)}/preview`, { body })
        : await call("POST", "/preview", { body });
      const { html = "", audit = {}, rules } = res.body ?? {};
      const counts = audit.counts ?? {};
      const findings = audit.findings ?? [];
      const ruleCount = Array.isArray(rules?.rules) ? rules.rules.length : 0;
      const lines = [
        `Audit: ${audit.passed ? "PASSED" : "FAILED"}`,
        `Counts: critical=${counts.critical ?? 0} error=${counts.error ?? 0} warning=${counts.warning ?? 0} info=${counts.info ?? 0}`,
        `Rules in the form: ${ruleCount}`,
        findings.length ? "Findings:" : "Findings: none",
        ...findings.map((f) => `- [${f.severity}] ${f.rule_id} (line ${f.line}): ${f.message}`),
        `HTML: ${html.length} characters, in the next content item.`,
      ];
      return ok(text(lines.join("\n")), text(html));
    },
  },
  {
    name: "forecraft_list_submissions",
    title: "List submissions",
    description:
      "List a form's submissions, newest first. Returns { items: [{ id, form_id, version, created_at, data }], total }; `total` counts all matches, not just this page. " +
      "`q` is a case-insensitive substring match over the stored answers (JSON text). `limit` 1-1000 (default 50), `offset` to page. Optional filters: `version` (published version number), `since` / `until` (ISO 8601 timestamps on created_at). " +
      "`data` holds only the answers the form kept (hidden fields and empty values are dropped).",
    inputSchema: {
      type: "object",
      properties: {
        id: ID_PROP,
        q: { type: "string", description: "Substring to look for in the answers." },
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Page size, default 50." },
        offset: { type: "integer", minimum: 0, description: "Items to skip, default 0." },
        version: { type: "integer", minimum: 1, description: "Only submissions made against this published version." },
        since: { type: "string", description: "ISO 8601 timestamp: only submissions at or after it." },
        until: { type: "string", description: "ISO 8601 timestamp: only submissions at or before it." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "List submissions", ...READ },
    async run(a) {
      const res = await call("GET", `/forms/${enc(a.id)}/submissions`, {
        query: { q: a.q, limit: a.limit, offset: a.offset, version: a.version, since: a.since, until: a.until },
      });
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_get_submission",
    title: "Get a submission",
    description: "Fetch one submission by id (sub_…): { id, form_id, version, created_at, data }. Ids come from forecraft_list_submissions.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The submission id (sub_…)." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Get a submission", ...READ },
    async run(a) {
      const res = await call("GET", `/submissions/${enc(a.id)}`);
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_export_submissions",
    title: "Export submissions",
    description:
      "Export a form's submissions (newest first, at most 1000). `format` \"csv\": header id,submitted_at,version then one column per field in schema order (nested answers as a.b, lists joined with \"; \"). " +
      "`format` \"json\": { form: { id, slug }, items: [...] }. Optional `q` filters like forecraft_list_submissions. For more than 1000 rows page through forecraft_list_submissions instead.",
    inputSchema: {
      type: "object",
      properties: {
        id: ID_PROP,
        format: { type: "string", enum: ["csv", "json"], description: "csv or json." },
        q: { type: "string", description: "Substring filter over the answers." },
      },
      required: ["id", "format"],
      additionalProperties: false,
    },
    annotations: { title: "Export submissions", ...READ },
    async run(a) {
      const res = await call("GET", `/forms/${enc(a.id)}/submissions/export`, { query: { format: a.format, q: a.q } });
      return ok(res.body !== null ? jsonText(res.body) : text(res.raw));
    },
  },
  {
    name: "forecraft_validate_submission",
    title: "Dry-run a submission",
    description:
      "Check sample answers against the form's DRAFT definition without storing anything: runs the same coercion and rules the public endpoint applies. " +
      "`data` is an object keyed by field name (strings like \"5\" are coerced to numbers where the schema says so). " +
      "Returns { valid, findings: [{ path, rule, message }], data } where `data` is what would be stored (hidden fields dropped, computed values filled in). A failing verdict is a normal result (not an error): read `findings`. " +
      "Use it to test conditional rules (show/require/validate) before publishing.",
    inputSchema: {
      type: "object",
      properties: { id: ID_PROP, data: { type: "object", description: "Answers keyed by field name, e.g. { \"email\": \"a@b.co\", \"plan\": \"Team\" }." } },
      required: ["id", "data"],
      additionalProperties: false,
    },
    annotations: { title: "Dry-run a submission", ...READ },
    async run(a) {
      const res = await call("POST", `/forms/${enc(a.id)}/validate`, { body: { data: a.data } });
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_get_vocabulary",
    title: "Get the appearance vocabulary",
    description:
      "Fetch GET /api/v1/vocabulary: the valid `themes`, `accents`, `layouts` for a definition's `appearance`, and `appearance_defaults`. Call it before choosing appearance.theme.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Get the appearance vocabulary", ...READ },
    async run() {
      const res = await call("GET", "/vocabulary");
      return ok(jsonText(res.body));
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ── Argument checking (top level only; the API judges the definition itself) ──

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

function typeMatches(want, v) {
  const t = typeOf(v);
  if (want === "number") return t === "number" || t === "integer";
  return want === t;
}

function checkArguments(schema, args) {
  const problems = [];
  if (args === null || typeof args !== "object" || Array.isArray(args)) return ["arguments must be an object"];
  for (const k of schema.required ?? []) if (args[k] === undefined) problems.push(`"${k}" is required`);
  for (const [k, v] of Object.entries(args)) {
    const prop = schema.properties?.[k];
    if (!prop) {
      if (schema.additionalProperties === false) problems.push(`unknown argument "${k}" (known: ${Object.keys(schema.properties ?? {}).join(", ") || "none"})`);
      continue;
    }
    const types = [].concat(prop.type ?? []);
    if (types.length && !types.some((t) => typeMatches(t, v))) {
      problems.push(`"${k}" must be ${types.join(" or ")}, got ${typeOf(v)}`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(v)) problems.push(`"${k}" must be one of ${prop.enum.map((e) => JSON.stringify(e)).join(", ")}`);
    if (typeof v === "number") {
      if (prop.minimum !== undefined && v < prop.minimum) problems.push(`"${k}" must be >= ${prop.minimum}`);
      if (prop.maximum !== undefined && v > prop.maximum) problems.push(`"${k}" must be <= ${prop.maximum}`);
    }
  }
  return problems;
}

async function callTool(params) {
  const tool = TOOLS_BY_NAME.get(params?.name);
  if (!tool) throw rpcError(-32602, `Unknown tool: ${params?.name}`);
  const args = params.arguments ?? {};
  const problems = checkArguments(tool.inputSchema, args);
  if (problems.length) {
    return { content: [text(`Invalid arguments for ${tool.name}: ${problems.join("; ")}.`)], isError: true };
  }
  try {
    return await tool.run(args);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResult(err.res);
    if (err instanceof ToolError) return { content: [text(err.message)], isError: true };
    log("tool failure:", err?.stack || err);
    return { content: [text(`Unexpected error in ${tool.name}: ${err?.message || err}`)], isError: true };
  }
}

// ── Resources ─────────────────────────────────────────────────────────────

const URI_PREFIX = "forecraft://form/";

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: `${URI_PREFIX}{id}`,
    name: "form-definition",
    title: "Form definition",
    description: "The draft definition ({ schema, ui?, rules?, appearance? }) of a forecraft form, by form id.",
    mimeType: "application/json",
  },
];

async function listResources() {
  const res = await call("GET", "/forms").catch(resourceFailure);
  const items = res.body?.items ?? [];
  return {
    resources: items.map((f) => ({
      uri: `${URI_PREFIX}${f.id}`,
      name: f.slug,
      title: f.title,
      description: `Definition of the form "${f.title}" (${f.status}, ${f.published_version === null ? "unpublished" : `published v${f.published_version}`}, ${f.submission_count} submissions).`,
      mimeType: "application/json",
    })),
  };
}

async function readResource(params) {
  const uri = String(params?.uri ?? "");
  if (!uri.startsWith(URI_PREFIX) || uri.length === URI_PREFIX.length) {
    throw rpcError(-32002, `Resource not found: ${uri}`, { uri });
  }
  const id = decodeURIComponent(uri.slice(URI_PREFIX.length));
  const res = await call("GET", `/forms/${enc(id)}`).catch((err) => {
    if (err instanceof ApiError && err.res.status === 404) throw rpcError(-32002, `Resource not found: ${uri}`, { uri });
    return resourceFailure(err);
  });
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(res.body.definition, null, 2) }] };
}

function resourceFailure(err) {
  if (err instanceof ApiError) {
    const detail = err.res.body?.detail || err.res.raw.slice(0, 300) || `HTTP ${err.res.status}`;
    throw rpcError(-32603, `forecraft API ${err.res.status}: ${detail}`);
  }
  if (err instanceof ToolError) throw rpcError(-32603, err.message);
  throw err;
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────

function rpcError(code, message, data) {
  const e = new Error(message);
  e.rpc = { code, message, ...(data !== undefined ? { data } : {}) };
  return e;
}

const INSTRUCTIONS = [
  "forecraft builds web forms from one JSON definition ({ schema, ui?, rules?, appearance? }).",
  "Workflow: forecraft_get_vocabulary (themes) -> forecraft_create_form -> forecraft_preview_form (read the audit; fix errors) -> forecraft_publish_form -> share the returned url -> forecraft_list_submissions.",
  "Definitions are validated strictly: a 422 error names the JSON pointer of each fault.",
].join(" ");

async function handleRequest(method, params) {
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(({ run: _run, ...tool }) => tool) };
    case "tools/call":
      return callTool(params);
    case "resources/list":
      return listResources();
    case "resources/templates/list":
      return { resourceTemplates: RESOURCE_TEMPLATES };
    case "resources/read":
      return readResource(params);
    default:
      throw rpcError(-32601, `Method not found: ${method}`);
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

const pending = new Set();

async function handleMessage(msg) {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0") {
    send({ jsonrpc: "2.0", id: msg && typeof msg === "object" && "id" in msg ? msg.id : null, error: { code: -32600, message: "Invalid Request" } });
    return;
  }
  const isRequest = msg.id !== undefined && msg.id !== null && typeof msg.method === "string";
  if (typeof msg.method !== "string") return; // a response to something we never asked: ignore
  if (!isRequest) {
    // Notifications (notifications/initialized, notifications/cancelled, …) take no reply.
    return;
  }
  try {
    const result = await handleRequest(msg.method, msg.params);
    send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (err) {
    if (err?.rpc) send({ jsonrpc: "2.0", id: msg.id, error: err.rpc });
    else {
      log("internal error:", err?.stack || err);
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: `Internal error: ${err?.message || err}` } });
    }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const items = Array.isArray(msg) && msg.length ? msg : [msg]; // tolerate (pre-2025-06-18) batches
  for (const item of items) {
    const p = handleMessage(item).finally(() => pending.delete(p));
    pending.add(p);
  }
});
rl.on("close", async () => {
  await Promise.allSettled([...pending]);
  process.stdout.write("", () => process.exit(0));
});

if (!process.env.FORECRAFT_API_KEY) log("FORECRAFT_API_KEY is not set; tool calls will fail until it is.");
log(`ready (${baseUrl()})`);
