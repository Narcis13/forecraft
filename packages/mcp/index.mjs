#!/usr/bin/env node
// forecraft MCP server — stdio transport, zero dependencies.
//
// Speaks JSON-RPC 2.0 over newline-delimited JSON (one message per line on
// stdin/stdout; logs go to stderr) and drives the forecraft REST API
// (/api/v1) with `fetch` and a bearer key.
//
//   FORECRAFT_URL      base URL of the forecraft server (default http://localhost:3000)
//   FORECRAFT_API_KEY  an fc_live_… key (required for tool calls and resources)

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline";

const SERVER_INFO = { name: "forecraft", title: "forecraft", version: "0.2.0" };
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

// ── Report vocabulary (kept in step with src/reports/model.ts; the API is the authority) ──

const PRINT_THEMES = ["document", "document-serif", "editorial-document", "ink-document", "swiss-document"];
const PAPERS = ["a4", "letter"];
const ORIENTATIONS = ["portrait", "landscape"];
const MARGINS = ["narrow", "normal", "wide"];
const DENSITIES = ["compact", "comfortable"];
const TYPE_PAIRINGS = ["plex-sans", "plex-serif", "source-serif", "editorial", "inter"];
const ASSET_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const REPORT_APPEARANCE_SCHEMA = {
  type: "object",
  description: "Curated print look. Choose from these values only (never sizes, fonts or colours): theme, ONE dark accent hex, paper, type pairing. See forecraft_get_report_vocabulary.",
  properties: {
    theme: { type: "string", enum: PRINT_THEMES },
    accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "One dark, saturated hex colour, #rrggbb; at least 4.5:1 contrast on white." },
    paper: { type: "string", enum: PAPERS },
    orientation: { type: "string", enum: ORIENTATIONS },
    margins: { type: "string", enum: MARGINS },
    type: { type: "string", enum: TYPE_PAIRINGS, description: "Type pairing id." },
    density: { type: "string", enum: DENSITIES },
    locale: { type: "string", description: "Language-REGION, e.g. en-GB, ro-RO, de-DE, fr-FR." },
    currency: { type: "string", pattern: "^[A-Z]{3}$", description: "ISO 4217 code, e.g. EUR, RON, GBP, USD." },
    logo: { type: ["string", "null"], pattern: "^asset:ast_", description: "An asset ref from forecraft_upload_asset (asset:ast_…), or null." },
    letter: { type: "object", properties: { window: { type: "boolean" }, foldMarks: { type: "boolean" } }, additionalProperties: false },
  },
  additionalProperties: false,
};

const REPORT_DEFINITION_SCHEMA = {
  type: "object",
  description: "A report definition: { schema, sample, layout, appearance?, money?, numbering?, documentTitle?, runningHeader?, labels?, source? }. Prefer editing a starter's definition over writing one from nothing.",
  properties: {
    schema: { type: "object", description: "JSON Schema (root type object, root title) of the data the document prints." },
    sample: { type: "object", description: "Realistic example data that satisfies the schema; previews use it." },
    layout: { type: "array", description: "Ordered blocks, each { id, block, ...props }. Block names and props: forecraft_get_report_vocabulary.", items: { type: "object" } },
    appearance: REPORT_APPEARANCE_SCHEMA,
    money: { type: "object", description: "Exact money maths: { lines, quantity, unitPrice, taxRate?, discount?, prices?, rounding?, paid? } naming data fields." },
    numbering: { type: "object", description: "Gapless numbering: { pattern: \"INV-{YYYY}-{seq:4}\" } or { manual: true }." },
    documentTitle: { type: "string" },
    runningHeader: { type: "string" },
    labels: { type: "object", description: "Label overrides, keyed by label name." },
    source: { type: "object", description: "Where data comes from: { kind: \"data\" } (default), { kind: \"submission\", form } or { kind: \"summary\", form }." },
  },
  required: ["schema", "layout"],
};

const REPORT_ID_PROP = { type: "string", description: "The report id (rpt_…), as returned by forecraft_create_report / forecraft_list_reports." };
const DOCUMENT_ID_PROP = { type: "string", description: "The document id (doc_…), as returned by forecraft_issue_document / forecraft_list_documents." };
const PERIOD_PROP = { type: "object", properties: { since: { type: "string" }, until: { type: "string" } }, additionalProperties: false, description: "For summary reports: ISO 8601 dates { since, until }." };
const LOCALE_PROP = { type: "string", description: "Override the report's locale for this document, e.g. ro-RO." };
const CURRENCY_PROP = { type: "string", pattern: "^[A-Z]{3}$", description: "Override the report's currency for this document (ISO 4217)." };

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

/**
 * `body` is sent as JSON; `bytes` + `contentType` as a raw body (asset upload).
 * `binary: true` keeps a successful body as `res.bytes` (a PDF) instead of text.
 */
async function call(method, path, { query, body, bytes, contentType, binary } = {}) {
  const key = process.env.FORECRAFT_API_KEY;
  if (!key) {
    throw new ToolError(
      "FORECRAFT_API_KEY is not set. Create an API key in the forecraft dashboard (API keys) and put it in the MCP server's env as FORECRAFT_API_KEY (an fc_live_… value).",
    );
  }
  const url = new URL(`${baseUrl()}/api/v1${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const headers = { authorization: `Bearer ${key}`, accept: binary ? "application/pdf, application/problem+json;q=0.9" : "application/json, application/problem+json, text/csv;q=0.9" };
  let payload;
  if (bytes !== undefined) {
    headers["content-type"] = contentType;
    payload = bytes;
  } else if (body !== undefined) {
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
  const answerType = response.headers.get("content-type") || "";
  let raw = "";
  let answerBytes = null;
  if (binary && response.ok) answerBytes = Buffer.from(await response.arrayBuffer());
  else raw = await response.text();
  let parsed = null;
  if (/json/.test(answerType) && raw) {
    try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
  }
  const res = {
    status: response.status,
    ok: response.ok,
    contentType: answerType,
    retryAfter: response.headers.get("retry-after"),
    body: parsed,
    raw,
    bytes: answerBytes,
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
  if (res.status === 503 || res.status === 429) problem.hint = "The renderer is busy or rate limited: wait retry_after_seconds (or retry_after) seconds, then call again.";
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

/** An image's type from its first bytes (what the API trusts too), or null. */
function sniffImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  const head = buf.toString("utf8", 0, 2048).replace(/^﻿/, "");
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

const MAX_UPLOAD_READ = 8 * 1024 * 1024;

/** The verdict line of a preview: what a person would say after looking at it. */
function previewVerdict(findings, pages, shown) {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const head = errors ? `Preflight FAILED: ${errors} error${errors === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}; fix the findings before publishing.`
    : warnings ? `Preflight passed with ${warnings} warning${warnings === 1 ? "" : "s"}; read them, then publish.`
    : "Preflight passed with no findings.";
  return `${head} ${pages} page${pages === 1 ? "" : "s"} in total, ${shown} shown as images below.`;
}

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

  // ── Reports and documents ───────────────────────────────────────────────
  {
    name: "forecraft_get_report_vocabulary",
    title: "Get the report vocabulary",
    description:
      "Fetch GET /api/v1/vocabulary/reports: every block with a JSON example, the expression helpers, print themes, type pairings, locales, papers and preflight codes. " +
      "Read it before writing or editing a report definition.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Get the report vocabulary", ...READ },
    async run() {
      const res = await call("GET", "/vocabulary/reports");
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_list_report_starters",
    title: "List report starters",
    description:
      "List the complete starter reports (invoice, letter, business-report, confirmation, survey-summary, blank) with their theme, paper, data source and blocks. " +
      "Pick one and pass its id to forecraft_create_report; the two that read a form (confirmation, survey-summary) need needsForm: a form id.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List report starters", ...READ },
    async run() {
      const res = await call("GET", "/report-starters");
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_create_report",
    title: "Create a report",
    description:
      "Create a report (a DRAFT; forecraft_publish_report before issuing documents) from a `starter` (recommended: start from one rather than blank) or from a full `definition`, exactly one. " +
      "Choose `appearance` from the curated values only (theme, one dark accent hex, paper, type pairing), never sizes or colours, and put your company in `sample`; a starter's result includes the definition to edit.",
    inputSchema: {
      type: "object",
      properties: {
        starter: { type: "string", description: "A starter id from forecraft_list_report_starters, e.g. invoice." },
        title: { type: "string", description: "Name for the report (starter only)." },
        appearance: REPORT_APPEARANCE_SCHEMA,
        sample: { type: "object", description: "Starter only: example data merged into the starter's sample, e.g. { seller: { name: \"Acme Ltd\", iban: \"…\" } }." },
        form: { type: "string", description: "Starter only: the form id (frm_…) a confirmation or survey-summary report reads." },
        definition: REPORT_DEFINITION_SCHEMA,
      },
      additionalProperties: false,
    },
    annotations: { title: "Create a report", ...WRITE },
    async run(a) {
      let body;
      if (a.starter !== undefined) {
        if (a.definition !== undefined) throw new ToolError("Pass either `starter` or `definition`, not both.");
        body = {};
        for (const k of ["starter", "title", "appearance", "sample", "form"]) if (a[k] !== undefined) body[k] = a[k];
      } else if (a.definition !== undefined) {
        const stray = ["title", "appearance", "sample", "form"].filter((k) => a[k] !== undefined);
        if (stray.length) throw new ToolError(`${stray.join(", ")} only apply with a \`starter\`; with a \`definition\`, put them inside it.`);
        body = { definition: a.definition };
      } else {
        throw new ToolError("Pass `starter` (recommended; see forecraft_list_report_starters) or a full `definition`.");
      }
      const res = await call("POST", "/reports", { body });
      return ok(jsonText(a.starter !== undefined ? res.body : withoutDefinition(res.body)));
    },
  },
  {
    name: "forecraft_update_report",
    title: "Update a report",
    description:
      "Replace a report's whole draft definition (send the complete definition, not a fragment; read it first with forecraft_get_report). " +
      "Editing the draft does not change documents or the published version: preview, then forecraft_publish_report. Returns the report without its definition.",
    inputSchema: {
      type: "object",
      properties: { id: REPORT_ID_PROP, definition: REPORT_DEFINITION_SCHEMA },
      required: ["id", "definition"],
      additionalProperties: false,
    },
    annotations: { title: "Update a report", ...WRITE_IDEMPOTENT },
    async run(a) {
      const res = await call("PATCH", `/reports/${enc(a.id)}`, { body: { definition: a.definition } });
      return ok(jsonText(withoutDefinition(res.body)));
    },
  },
  {
    name: "forecraft_get_report",
    title: "Get a report",
    description:
      "Fetch one report by id: title, starter, source, published_version, has_unpublished_changes, document_count, timestamps, design_url and the full draft `definition`. " +
      "Use it before forecraft_update_report to start from the current definition.",
    inputSchema: { type: "object", properties: { id: REPORT_ID_PROP }, required: ["id"], additionalProperties: false },
    annotations: { title: "Get a report", ...READ },
    async run(a) {
      const res = await call("GET", `/reports/${enc(a.id)}`);
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_list_reports",
    title: "List reports",
    description:
      "List every report in the workspace with id, title, starter, published_version, has_unpublished_changes and document_count (no definitions; use forecraft_get_report for that).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List reports", ...READ },
    async run() {
      const res = await call("GET", "/reports");
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_preview_report",
    title: "Preview a report",
    description:
      "Render a report to page images and run preflight; nothing is stored and no number is used. Pass `id` for the saved draft, plus optionally an unsaved `definition`, and `data` (or a `submission` id, or a summary `period`); it defaults to the report's sample. " +
      "Returns a text item { verdict, ok, pages, pages_shown, findings, title } followed by up to four PNG pages (about 100 dpi): look at the pages, fix every finding with severity error, and re-run before publishing.",
    inputSchema: {
      type: "object",
      properties: {
        id: REPORT_ID_PROP,
        definition: REPORT_DEFINITION_SCHEMA,
        data: { type: "object", description: "Data to print instead of the report's sample." },
        submission: { type: "string", description: "A submission id (sub_…) to print, for reports that read a form." },
        period: PERIOD_PROP,
        locale: LOCALE_PROP,
        currency: CURRENCY_PROP,
        pages: { type: "integer", minimum: 1, maximum: 4, description: "How many pages to return as images, 1-4 (default 4)." },
        dpi: { type: "integer", minimum: 36, maximum: 150, description: "Image resolution, 36-150 (default 100)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Preview a report", ...READ },
    async run(a) {
      const body = { format: "png", pages: a.pages ?? 4, dpi: a.dpi ?? 100 };
      for (const k of ["definition", "data", "submission", "period", "locale", "currency"]) if (a[k] !== undefined) body[k] = a[k];
      const res = await call("POST", `/reports/${enc(a.id)}/preview`, { body });
      const { ok: passed = true, title = "", pages = 0, findings = [], images = [] } = res.body ?? {};
      const summary = { verdict: previewVerdict(findings, pages, images.length), ok: passed, pages, pages_shown: images.length, findings, title };
      return ok(jsonText(summary), ...images.map((img) => ({ type: "image", data: img.data, mimeType: img.type || "image/png" })));
    },
  },
  {
    name: "forecraft_publish_report",
    title: "Publish a report",
    description:
      "Snapshot the report's draft as the next immutable version (1, 2, …); documents are issued from the published version only. " +
      "Returns { version, published_at, documents_url }. Publish again after every forecraft_update_report; documents already issued keep the version they were made with.",
    inputSchema: { type: "object", properties: { id: REPORT_ID_PROP }, required: ["id"], additionalProperties: false },
    annotations: { title: "Publish a report", ...WRITE },
    async run(a) {
      const res = await call("POST", `/reports/${enc(a.id)}/publish`, { body: undefined });
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_issue_document",
    title: "Issue a document",
    description:
      "Make a document from the report's PUBLISHED version with `data` (matching its schema), a `submission` id or a summary `period`; by default it is issued now, getting the next gapless `number`, a PDF (`pdf_url`) and a `share_url`, and is immutable afterwards. " +
      "Set `draft` true for an editable draft without a number; bad data is a 422 with pointers, preflight errors a 422 with `findings`, an unpublished report a 409.",
    inputSchema: {
      type: "object",
      properties: {
        report: REPORT_ID_PROP,
        data: { type: "object", description: "The document's data, matching the report's schema (see the sample in forecraft_get_report)." },
        submission: { type: "string", description: "A submission id (sub_…) to print, for reports that read a form." },
        period: PERIOD_PROP,
        number: { type: "string", description: "Manual numbering only: the number to give this document." },
        locale: LOCALE_PROP,
        currency: CURRENCY_PROP,
        draft: { type: "boolean", description: "true: create an editable draft without a number or PDF. Default false (issue now)." },
      },
      required: ["report"],
      additionalProperties: false,
    },
    annotations: { title: "Issue a document", ...WRITE },
    async run(a) {
      const body = { issue: a.draft !== true };
      for (const k of ["data", "submission", "period", "number", "locale", "currency"]) if (a[k] !== undefined) body[k] = a[k];
      const res = await call("POST", `/reports/${enc(a.report)}/documents`, { body });
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_list_documents",
    title: "List documents",
    description:
      "List documents, newest first: { items: [{ id, report_id, status, number, title, issued_at, pages, pdf_url, share_url, … }], total }. " +
      "Filter by `report`, `status` (draft|issued|void), exact `number`, text `q`, `since` / `until` (ISO 8601); `limit` 1-1000 (default 50) and `offset` to page.",
    inputSchema: {
      type: "object",
      properties: {
        report: REPORT_ID_PROP,
        status: { type: "string", enum: ["draft", "issued", "void"] },
        number: { type: "string", description: "The document number, e.g. INV-2026-0001." },
        q: { type: "string", description: "Substring to look for in the documents." },
        since: { type: "string", description: "ISO 8601 timestamp: only documents at or after it." },
        until: { type: "string", description: "ISO 8601 timestamp: only documents at or before it." },
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Page size, default 50." },
        offset: { type: "integer", minimum: 0, description: "Items to skip, default 0." },
      },
      additionalProperties: false,
    },
    annotations: { title: "List documents", ...READ },
    async run(a) {
      const res = await call("GET", "/documents", {
        query: { report: a.report, status: a.status, number: a.number, q: a.q, since: a.since, until: a.until, limit: a.limit, offset: a.offset },
      });
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_get_document",
    title: "Get a document",
    description:
      "Fetch one document by id with its `data`, status, number, void_reason, pages, pdf_sha256, pdf_url and share_url. " +
      "The PDF itself is the resource forecraft://document/{id}.",
    inputSchema: { type: "object", properties: { id: DOCUMENT_ID_PROP }, required: ["id"], additionalProperties: false },
    annotations: { title: "Get a document", ...READ },
    async run(a) {
      const res = await call("GET", `/documents/${enc(a.id)}`);
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_void_document",
    title: "Void a document",
    description:
      "Void an issued document with a reason: it keeps its number and prints VOID, and the number is never reused. " +
      "Issued documents cannot be edited or deleted, so correct a mistake by voiding it and issuing a new one with forecraft_issue_document.",
    inputSchema: {
      type: "object",
      properties: {
        id: DOCUMENT_ID_PROP,
        reason: { type: "string", minLength: 3, maxLength: 500, description: "Why the document is void, 3-500 characters." },
      },
      required: ["id", "reason"],
      additionalProperties: false,
    },
    annotations: { title: "Void a document", ...{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
    async run(a) {
      const res = await call("POST", `/documents/${enc(a.id)}/void`, { body: { reason: a.reason } });
      return ok(jsonText(res.body));
    },
  },
  {
    name: "forecraft_upload_asset",
    title: "Upload an image",
    description:
      "Upload a logo or image (PNG, JPEG, WebP or SVG, about 1 MB at most) from a local file `path`, or as `base64` bytes with its `type`. " +
      "Returns { id, ref, url, width, height, … }: use `ref` (asset:ast_…) as appearance.logo or in an image block.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of a local image file." },
        base64: { type: "string", description: "The image bytes, base64-encoded (use instead of path)." },
        type: { type: "string", enum: ASSET_TYPES, description: "With base64: the image's MIME type (checked against the bytes)." },
        name: { type: "string", description: "A file name to keep with the asset (default: the file's name)." },
      },
      additionalProperties: false,
    },
    annotations: { title: "Upload an image", ...WRITE },
    async run(a) {
      if ((a.path === undefined) === (a.base64 === undefined)) throw new ToolError("Pass exactly one of `path` (a local file) or `base64` (the bytes).");
      let buf;
      let name = a.name;
      if (a.path !== undefined) {
        let info;
        try { info = await stat(a.path); } catch (err) { throw new ToolError(`Cannot read ${a.path}: ${err?.code || err?.message}`); }
        if (!info.isFile()) throw new ToolError(`${a.path} is not a file.`);
        if (info.size > MAX_UPLOAD_READ) throw new ToolError(`${a.path} is ${info.size} bytes; assets are about 1 MB at most.`);
        buf = await readFile(a.path);
        name ??= basename(a.path);
      } else {
        buf = Buffer.from(a.base64.replace(/^data:[^,]*,/, ""), "base64");
        if (buf.length > MAX_UPLOAD_READ) throw new ToolError(`The image is ${buf.length} bytes; assets are about 1 MB at most.`);
      }
      const sniffed = sniffImage(buf);
      if (!sniffed) throw new ToolError("Not a PNG, JPEG, WebP or SVG image (checked by its first bytes).");
      if (a.type !== undefined && a.type !== sniffed) throw new ToolError(`\`type\` says ${a.type} but the bytes are ${sniffed}.`);
      const res = await call("POST", "/assets", { bytes: buf, contentType: sniffed, query: { name } });
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
    if (typeof v === "string") {
      if (prop.minLength !== undefined && v.length < prop.minLength) problems.push(`"${k}" must be at least ${prop.minLength} characters`);
      if (prop.maxLength !== undefined && v.length > prop.maxLength) problems.push(`"${k}" must be at most ${prop.maxLength} characters`);
    }
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
const REPORT_PREFIX = "forecraft://report/";
const DOCUMENT_PREFIX = "forecraft://document/";
const RECENT_DOCUMENTS = 20;

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: `${URI_PREFIX}{id}`,
    name: "form-definition",
    title: "Form definition",
    description: "The draft definition ({ schema, ui?, rules?, appearance? }) of a forecraft form, by form id.",
    mimeType: "application/json",
  },
  {
    uriTemplate: `${REPORT_PREFIX}{id}`,
    name: "report-definition",
    title: "Report definition",
    description: "The draft definition ({ schema, sample, layout, appearance, … }) of a forecraft report, by report id.",
    mimeType: "application/json",
  },
  {
    uriTemplate: `${DOCUMENT_PREFIX}{id}`,
    name: "document",
    title: "Document",
    description: "A document by id: its metadata and data as JSON text, plus its PDF as a binary (application/pdf) item.",
    mimeType: "application/json",
  },
];

/** Reports and documents arrived after forms: an older server answers 404, which only means "none". */
const orNone = (err) => {
  if (err instanceof ApiError && err.res.status === 404) return { body: { items: [] } };
  return resourceFailure(err);
};

async function listResources() {
  const [forms, reports, documents] = await Promise.all([
    call("GET", "/forms").catch(resourceFailure),
    call("GET", "/reports").catch(orNone),
    call("GET", "/documents", { query: { limit: RECENT_DOCUMENTS } }).catch(orNone),
  ]);
  return {
    resources: [
      ...(forms.body?.items ?? []).map((f) => ({
        uri: `${URI_PREFIX}${f.id}`,
        name: f.slug,
        title: f.title,
        description: `Definition of the form "${f.title}" (${f.status}, ${f.published_version === null ? "unpublished" : `published v${f.published_version}`}, ${f.submission_count} submissions).`,
        mimeType: "application/json",
      })),
      ...(reports.body?.items ?? []).map((r) => ({
        uri: `${REPORT_PREFIX}${r.id}`,
        name: r.id,
        title: r.title,
        description: `Definition of the report "${r.title}" (${r.published_version === null ? "unpublished" : `published v${r.published_version}`}, ${r.document_count} documents).`,
        mimeType: "application/json",
      })),
      ...(documents.body?.items ?? []).map((d) => ({
        uri: `${DOCUMENT_PREFIX}${d.id}`,
        name: d.number ?? d.id,
        title: d.number ? `${d.title} · ${d.number}` : d.title,
        description: `${d.status === "draft" ? "Draft" : d.status === "void" ? "Void" : "Issued"} document ${d.number ? `${d.number} ` : ""}(${d.pages ?? "?"} pages): metadata and data, with the PDF.`,
        mimeType: "application/json",
      })),
    ],
  };
}

async function readResource(params) {
  const uri = String(params?.uri ?? "");
  const kind = [URI_PREFIX, REPORT_PREFIX, DOCUMENT_PREFIX].find((p) => uri.startsWith(p) && uri.length > p.length);
  if (!kind) throw rpcError(-32002, `Resource not found: ${uri}`, { uri });
  const id = decodeURIComponent(uri.slice(kind.length));
  const notFound = (err) => {
    if (err instanceof ApiError && err.res.status === 404) throw rpcError(-32002, `Resource not found: ${uri}`, { uri });
    return resourceFailure(err);
  };
  if (kind === REPORT_PREFIX) {
    const res = await call("GET", `/reports/${enc(id)}`).catch(notFound);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(res.body.definition, null, 2) }] };
  }
  if (kind === DOCUMENT_PREFIX) {
    const meta = await call("GET", `/documents/${enc(id)}`).catch(notFound);
    const pdf = await call("GET", `/documents/${enc(id)}/pdf`, { binary: true }).catch(notFound);
    return {
      contents: [
        { uri, mimeType: "application/json", text: JSON.stringify(meta.body, null, 2) },
        { uri, mimeType: "application/pdf", blob: pdf.bytes.toString("base64") },
      ],
    };
  }
  const res = await call("GET", `/forms/${enc(id)}`).catch(notFound);
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
  "forecraft builds web forms from one JSON definition ({ schema, ui?, rules?, appearance? }), and prints reports and documents (invoices, letters, confirmations) as A4/Letter PDFs from a report definition ({ schema, sample, layout, appearance }).",
  "Forms: forecraft_get_vocabulary (themes) -> forecraft_create_form -> forecraft_preview_form (read the audit; fix errors) -> forecraft_publish_form -> share the returned url -> forecraft_list_submissions.",
  "Documents: forecraft_list_report_starters -> forecraft_create_report (from a starter) -> forecraft_preview_report (read the findings, look at the pages; fix errors) -> forecraft_publish_report -> forecraft_issue_document (returns number, pdf_url, share_url); forecraft_void_document to cancel one.",
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
