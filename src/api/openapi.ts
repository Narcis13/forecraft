// The OpenAPI 3.1 description of /api/v1, hand-written to match src/routes/api.ts.
// Served at /openapi.json (src/routes/agents.ts). Accurate rather than exhaustive:
// the form definition's JSON Schema subset is described in prose and linked to
// the renderer's README, not re-modelled here.

import { ACCENTS, LAYOUTS, SCHEMES, THEMES } from "../forms/model.ts";
import { BLOCKS, DENSITIES, LOCALES, MARGINS, ORIENTATIONS, PAPERS, PRINT_THEMES, SOURCE_KINDS, TYPE_PAIRINGS } from "../reports/model.ts";
import { PREFLIGHT_CODES } from "../reports/preflight.ts";

type Obj = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema: Obj, required = true) => ({ required, content: { "application/json": { schema } } });
const jsonResponse = (description: string, schema: Obj, headers?: Obj) => ({
  description, ...(headers ? { headers } : {}), content: { "application/json": { schema } },
});
const problemRef = (name: string) => ({ $ref: `#/components/responses/${name}` });
const idParam = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: { type: "string" } });

const FORM_ID = idParam("id", "Form id (frm_…).");
const SUBMISSION_ID = idParam("id", "Submission id (sub_…).");
const REPORT_ID = idParam("id", "Report id (rpt_…).");
const DOCUMENT_ID = idParam("id", "Document id (doc_…).");
const pdfResponse = (description: string) => ({
  description,
  headers: { "Content-Disposition": { schema: { type: "string" }, description: "The filename is the document number." }, ETag: { schema: { type: "string" }, description: "The PDF's sha-256; send it back as If-None-Match for a 304." } },
  content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
});
const intQuery = (name: string, description: string, extra: Obj = {}) => ({ name, in: "query", description, schema: { type: "integer", minimum: 0, ...extra } });

const AUTH_ERRORS = { "401": problemRef("Unauthorized"), "429": problemRef("RateLimited") };
/** Anything that prints: the renderer can be saturated (503 with Retry-After). */
const RENDER_ERRORS = { ...AUTH_ERRORS, "503": problemRef("RendererBusy") };

export function openapi(baseUrl: string): Obj {
  const origin = baseUrl.replace(/\/+$/, "");
  return {
    openapi: "3.1.0",
    info: {
      title: "forecraft API",
      version: "1.0.0",
      summary: "Create, preview, publish and read forms. Built for agents.",
      description: [
        "forecraft is a form platform whose first user is an AI agent. A form is ONE JSON document, the *definition*: `{ schema, ui?, rules?, appearance? }`.",
        "Typical flow: `POST /forms` (draft) -> `POST /forms/{id}/preview` (HTML + audit) -> `POST /forms/{id}/publish` -> people submit through the public page or `POST /f/{slug}/submissions` -> `GET /forms/{id}/submissions`.",
        "Authenticate with `Authorization: Bearer fc_live_…` (create a key in the dashboard or with `POST /keys`). Errors are RFC 9457 `application/problem+json`; a rejected definition or submission carries `errors[]` with a JSON pointer for each fault.",
        "`schema` is a strict JSON Schema subset (`@faqir-ui/forms`); `ui` is a Faqir UI schema (`widget`, `placeholder`, `rows`, `enumLabels`, `width`, `orientation`, `minLabel`/`maxLabel`, `ui:groups`, `ui:wizard`); `rules` is `@faqir-ui/rules` input. `GET /vocabulary` lists the valid appearance values.",
        "Reports and documents: a *report* is ONE JSON definition (`{ schema, sample, layout, appearance, … }`; blocks and curated appearance are listed by `GET /vocabulary/reports`) rendered to an A4 or Letter PDF. Flow: `GET /report-starters` -> `POST /reports` (from a starter) -> `POST /reports/{id}/preview` (preflight findings and page images) -> `POST /reports/{id}/publish` -> `POST /reports/{id}/documents` with `issue: true` (a gapless number, a PDF, a share link) -> `POST /documents/{id}/void` if it must be cancelled. Rendering has its own rate limit (30/min per key) and can answer 503 `renderer-busy` with `Retry-After`.",
        "An MCP server for the same API ships in `packages/mcp` (see /docs/mcp).",
      ].join("\n\n"),
    },
    servers: [{ url: `${origin}/api/v1`, description: "This forecraft server" }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "forms", description: "Create, edit, preview and publish forms." },
      { name: "submissions", description: "Read what people sent. Sending is the public endpoint." },
      { name: "workspace", description: "The workspace, its members and API keys." },
      { name: "reports", description: "Report definitions: starters, edit, preview with preflight, publish." },
      { name: "documents", description: "Issued PDFs: numbers, voiding, share links. Public share views are /d/{token}." },
      { name: "assets", description: "Logos and images used by reports." },
      { name: "meta", description: "Vocabulary an agent needs to write a definition." },
    ],
    paths: {
      "/f/{slug}/submissions": {
        post: {
          operationId: "submitToForm",
          tags: ["submissions"],
          summary: "Submit answers to a published form (public, no key)",
          description: "What the public page posts to. Rate limited per client address (10 per minute). Validated with the form's rules; a rule failure is a 422 listing each finding. A filled honeypot field `_fc_hp` is answered 202 and discarded.",
          security: [],
          parameters: [idParam("slug", "The form's public slug.")],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { oneOf: [ref("SubmissionBody"), { type: "object", additionalProperties: true, description: "Or the answers object itself." }] } },
              "application/x-www-form-urlencoded": { schema: { type: "object", additionalProperties: true } },
              "multipart/form-data": { schema: { type: "object", additionalProperties: true } },
            },
          },
          responses: {
            "201": jsonResponse("Stored.", ref("SubmissionReceipt")),
            "202": jsonResponse("Honeypot tripped: acknowledged, nothing stored.", { type: "object", properties: { id: { type: "null" }, received: { type: "boolean" } } }),
            "404": problemRef("NotFound"),
            "409": { ...problemRef("Conflict"), description: "The form is not published (`form-unpublished`), closed (`form-closed`) or full (`form-full`)." },
            "415": problemRef("Problem"),
            "422": problemRef("Invalid"),
            "429": problemRef("RateLimited"),
          },
        },
      },

      "/workspace": {
        get: {
          operationId: "getWorkspace", tags: ["workspace"], summary: "The workspace the key belongs to",
          responses: { "200": jsonResponse("The workspace.", ref("Workspace")), ...AUTH_ERRORS },
        },
        patch: {
          operationId: "renameWorkspace", tags: ["workspace"], summary: "Rename the workspace",
          requestBody: jsonBody({ type: "object", properties: { name: { type: "string", minLength: 1 } }, required: ["name"] }),
          responses: { "200": jsonResponse("The updated workspace.", ref("Workspace")), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
      },
      "/workspace/members": {
        get: {
          operationId: "listMembers", tags: ["workspace"], summary: "Members and pending invites",
          responses: {
            "200": jsonResponse("Members and open invitations.", {
              type: "object",
              properties: {
                members: { type: "array", items: { type: "object", properties: { id: { type: "string" }, email: { type: "string" }, name: { type: "string" }, role: { type: "string" }, joined_at: { type: "string", format: "date-time" } } } },
                invites: { type: "array", items: { type: "object", properties: { id: { type: "string" }, email: { type: "string" }, created_at: { type: "string", format: "date-time" } } } },
              },
              required: ["members", "invites"],
            }),
            ...AUTH_ERRORS,
          },
        },
      },
      "/workspace/invites": {
        post: {
          operationId: "inviteMember", tags: ["workspace"], summary: "Invite a person by email (signed-in people only)",
          description: "Needs a dashboard session. With an API key this answers 403 `session-required`.",
          requestBody: jsonBody({ type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] }),
          responses: {
            "201": jsonResponse("The invitation and its one-time link.", { type: "object", properties: { id: { type: "string" }, email: { type: "string" }, url: { type: "string", format: "uri" } }, required: ["id", "email", "url"] }),
            "403": problemRef("Problem"), "422": problemRef("Invalid"), ...AUTH_ERRORS,
          },
        },
      },
      "/keys": {
        get: {
          operationId: "listKeys", tags: ["workspace"], summary: "List API keys (never the secrets)",
          responses: { "200": jsonResponse("Keys, newest first.", { type: "object", properties: { items: { type: "array", items: ref("ApiKey") } }, required: ["items"] }), ...AUTH_ERRORS },
        },
        post: {
          operationId: "createKey", tags: ["workspace"], summary: "Create an API key",
          description: "Signed-in people only (session cookie): an API key gets 403, so a leaked key cannot mint successors. The secret (`fc_live_…`) is in this response only. Store it now.",
          requestBody: jsonBody({ type: "object", properties: { name: { type: "string", default: "API key" } } }, false),
          responses: { "201": jsonResponse("The key and its secret.", ref("ApiKeyCreated")), ...AUTH_ERRORS },
        },
      },
      "/keys/{id}": {
        delete: {
          operationId: "revokeKey", tags: ["workspace"], summary: "Revoke an API key",
          description: "Signed-in people only (session cookie): an API key gets 403.",
          parameters: [idParam("id", "Key id (key_…).")],
          responses: { "204": { description: "Revoked." }, "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
      },

      "/forms": {
        get: {
          operationId: "listForms", tags: ["forms"], summary: "List forms (without definitions)",
          responses: { "200": jsonResponse("Forms, most recently updated first.", { type: "object", properties: { items: { type: "array", items: ref("FormSummary") } }, required: ["items"] }), ...AUTH_ERRORS },
        },
        post: {
          operationId: "createForm", tags: ["forms"], summary: "Create a draft form",
          description: "Body is `{ definition, slug? }`, or the bare definition. The definition is compiled: anything outside the supported subset is a 422 `invalid-definition` with `errors[]` pointers. Nothing is public until `POST /forms/{id}/publish`.",
          requestBody: jsonBody({ oneOf: [ref("CreateForm"), ref("FormDefinition")] }),
          responses: {
            "201": jsonResponse("The form.", ref("Form"), { Location: { schema: { type: "string" }, description: "/api/v1/forms/{id}" } }),
            "400": problemRef("Problem"), "409": problemRef("Conflict"), "422": problemRef("Invalid"), ...AUTH_ERRORS,
          },
        },
      },
      "/forms/{id}": {
        parameters: [FORM_ID],
        get: {
          operationId: "getForm", tags: ["forms"], summary: "Get a form with its draft definition",
          responses: { "200": jsonResponse("The form.", ref("Form")), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
        patch: {
          operationId: "updateForm", tags: ["forms"], summary: "Change the draft definition, status, limit or slug",
          description: "Takes any of `definition` (replaces the whole draft), `status`, `submission_limit`, `slug`. Unknown keys are a 422. Editing the definition does not touch the live version; publish again.",
          requestBody: jsonBody(ref("FormPatch")),
          responses: { "200": jsonResponse("The updated form.", ref("Form")), "404": problemRef("NotFound"), "409": problemRef("Conflict"), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
        delete: {
          operationId: "deleteForm", tags: ["forms"], summary: "Delete a form and its submissions",
          responses: { "204": { description: "Deleted." }, "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
      },
      "/forms/{id}/publish": {
        parameters: [FORM_ID],
        post: {
          operationId: "publishForm", tags: ["forms"], summary: "Publish the draft as the next version",
          responses: { "201": jsonResponse("The new live version.", ref("PublishedVersion")), "404": problemRef("NotFound"), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
      },
      "/forms/{id}/versions": {
        parameters: [FORM_ID],
        get: {
          operationId: "listVersions", tags: ["forms"], summary: "Published versions, newest first",
          responses: { "200": jsonResponse("Versions.", { type: "object", properties: { items: { type: "array", items: ref("VersionSummary") } }, required: ["items"] }), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
      },
      "/forms/{id}/versions/{version}": {
        parameters: [FORM_ID, { name: "version", in: "path", required: true, description: "Version number.", schema: { type: "integer", minimum: 1 } }],
        get: {
          operationId: "getVersion", tags: ["forms"], summary: "One published version with its definition",
          responses: {
            "200": jsonResponse("The version.", { type: "object", properties: { version: { type: "integer" }, published_at: { type: "string", format: "date-time" }, definition: ref("FormDefinition") }, required: ["version", "published_at", "definition"] }),
            "404": problemRef("NotFound"), ...AUTH_ERRORS,
          },
        },
      },
      "/preview": {
        post: {
          operationId: "previewDefinition", tags: ["forms"], summary: "Render and audit a definition without storing it",
          description: "Body is `{ definition }` or the bare definition.",
          requestBody: jsonBody({ oneOf: [{ type: "object", properties: { definition: ref("FormDefinition") }, required: ["definition"] }, ref("FormDefinition")] }),
          responses: { "200": jsonResponse("Rendered page and audit.", ref("Preview")), "400": problemRef("Problem"), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
      },
      "/forms/{id}/preview": {
        parameters: [FORM_ID],
        post: {
          operationId: "previewForm", tags: ["forms"], summary: "Render and audit a form's draft (or a proposed definition)",
          description: "With an empty body, previews the saved draft. With `{ definition }`, previews that instead. Nothing is stored.",
          requestBody: jsonBody({ type: "object", properties: { definition: ref("FormDefinition") } }, false),
          responses: { "200": jsonResponse("Rendered page and audit.", ref("Preview")), "404": problemRef("NotFound"), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
      },
      "/forms/{id}/validate": {
        parameters: [FORM_ID],
        post: {
          operationId: "validateSubmission", tags: ["forms"], summary: "Dry-run answers against the draft's rules",
          description: "Returns the verdict (always 200, even when `valid` is false). Nothing is stored.",
          requestBody: jsonBody({ type: "object", properties: { data: { type: "object", additionalProperties: true } }, required: ["data"] }),
          responses: { "200": jsonResponse("The verdict.", ref("Verdict")), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
      },

      "/forms/{id}/submissions": {
        parameters: [FORM_ID],
        get: {
          operationId: "listSubmissions", tags: ["submissions"], summary: "List a form's submissions, newest first",
          parameters: [
            { name: "q", in: "query", description: "Substring match over the stored answers.", schema: { type: "string" } },
            { name: "version", in: "query", description: "Only this published version.", schema: { type: "integer", minimum: 1 } },
            { name: "since", in: "query", description: "created_at >= (ISO 8601).", schema: { type: "string", format: "date-time" } },
            { name: "until", in: "query", description: "created_at <= (ISO 8601).", schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", description: "Page size, 1-1000.", schema: { type: "integer", minimum: 1, maximum: 1000, default: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          ],
          responses: { "200": jsonResponse("A page of submissions.", { type: "object", properties: { items: { type: "array", items: ref("Submission") }, total: { type: "integer" } }, required: ["items", "total"] }), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
      },
      "/forms/{id}/submissions/export": {
        parameters: [FORM_ID],
        get: {
          operationId: "exportSubmissions", tags: ["submissions"], summary: "Export submissions as CSV or JSON (at most 1000)",
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"], default: "csv" } },
            { name: "q", in: "query", description: "Substring match over the stored answers.", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "The export, as an attachment.",
              content: {
                "text/csv": { schema: { type: "string" } },
                "application/json": { schema: { type: "object", properties: { form: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" } } }, items: { type: "array", items: ref("Submission") } } } },
              },
            },
            "404": problemRef("NotFound"), "422": problemRef("Invalid"), ...AUTH_ERRORS,
          },
        },
      },
      "/submissions/{id}": {
        parameters: [SUBMISSION_ID],
        get: {
          operationId: "getSubmission", tags: ["submissions"], summary: "One submission",
          responses: { "200": jsonResponse("The submission.", ref("Submission")), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
        delete: {
          operationId: "deleteSubmission", tags: ["submissions"], summary: "Delete a submission",
          responses: { "204": { description: "Deleted." }, "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
      },

      "/vocabulary": {
        get: {
          operationId: "getVocabulary", tags: ["meta"], summary: "Valid appearance values and defaults",
          responses: { "200": jsonResponse("Themes, accents, layouts and the defaults.", ref("Vocabulary")), ...AUTH_ERRORS },
        },
      },

      "/vocabulary/reports": {
        get: {
          operationId: "getReportVocabulary", tags: ["meta"], summary: "Blocks, helpers, print themes, type pairings, locales and preflight codes",
          description: "Every block with one JSON example, the expression helpers, the curated appearance values, numbering tokens, the summary data shape and the preflight codes. Read it before writing a report definition.",
          responses: { "200": jsonResponse("The report vocabulary.", ref("ReportVocabulary")), ...AUTH_ERRORS },
        },
      },
      "/report-starters": {
        get: {
          operationId: "listReportStarters", tags: ["reports"], summary: "Complete starter reports to begin from",
          description: "invoice, letter, business-report, confirmation, survey-summary and blank. Pass an id as `starter` to `POST /reports`.",
          responses: { "200": jsonResponse("The starters.", { type: "object", properties: { items: { type: "array", items: ref("Starter") } }, required: ["items"] }), ...AUTH_ERRORS },
        },
      },
      "/reports": {
        get: {
          operationId: "listReports", tags: ["reports"], summary: "List reports (without definitions)",
          responses: { "200": jsonResponse("Reports, most recently updated first.", { type: "object", properties: { items: { type: "array", items: ref("ReportSummary") } }, required: ["items"] }), ...AUTH_ERRORS },
        },
        post: {
          operationId: "createReport", tags: ["reports"], summary: "Create a draft report from a starter or a definition",
          description: "Body is `{ starter, title?, appearance?, sample?, form? }` (recommended: start from a starter and choose appearance from the curated values), or `{ definition }`, or the bare definition. `form` (frm_…) is required for the confirmation and survey-summary starters. Nothing can be issued until `POST /reports/{id}/publish`.",
          requestBody: jsonBody({ oneOf: [ref("CreateReportFromStarter"), { type: "object", properties: { definition: ref("ReportDefinition") }, required: ["definition"], additionalProperties: false }, ref("ReportDefinition")] }),
          responses: {
            "201": jsonResponse("The report.", ref("Report"), { Location: { schema: { type: "string" }, description: "/api/v1/reports/{id}" } }),
            "400": problemRef("Problem"), "404": problemRef("NotFound"),
            "422": { ...problemRef("Invalid"), description: "The definition is invalid; `errors[]` has a JSON pointer per fault, and a line and column for an expression." },
            ...AUTH_ERRORS,
          },
        },
      },
      "/reports/{id}": {
        parameters: [REPORT_ID],
        get: {
          operationId: "getReport", tags: ["reports"], summary: "Get a report with its draft definition",
          responses: { "200": jsonResponse("The report.", ref("Report")), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
        patch: {
          operationId: "updateReport", tags: ["reports"], summary: "Replace the draft definition",
          description: "Body is `{ definition }`, the WHOLE definition. Editing the draft does not touch published versions or issued documents; publish again.",
          requestBody: jsonBody({ type: "object", properties: { definition: ref("ReportDefinition") }, required: ["definition"], additionalProperties: false }),
          responses: { "200": jsonResponse("The updated report.", ref("Report")), "404": problemRef("NotFound"), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
        delete: {
          operationId: "deleteReport", tags: ["reports"], summary: "Delete a report",
          description: "Deletes the report, its versions and its drafts. A report that has issued or void documents is kept: 409 `has-documents` (its numbered series is a record).",
          responses: { "204": { description: "Deleted." }, "404": problemRef("NotFound"), "409": problemRef("Conflict"), ...AUTH_ERRORS },
        },
      },
      "/reports/{id}/publish": {
        parameters: [REPORT_ID],
        post: {
          operationId: "publishReport", tags: ["reports"], summary: "Publish the draft as the next version",
          description: "Documents are issued from the published version. Documents already issued keep the version they were made with.",
          responses: { "201": jsonResponse("The new version.", ref("PublishedReportVersion")), "404": problemRef("NotFound"), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
      },
      "/reports/{id}/versions": {
        parameters: [REPORT_ID],
        get: {
          operationId: "listReportVersions", tags: ["reports"], summary: "Published versions, newest first",
          responses: {
            "200": jsonResponse("Versions.", {
              type: "object",
              properties: { items: { type: "array", items: { type: "object", properties: { version: { type: "integer" }, published_at: { type: "string", format: "date-time" }, live: { type: "boolean" } }, required: ["version", "published_at", "live"] } } },
              required: ["items"],
            }),
            "404": problemRef("NotFound"), ...AUTH_ERRORS,
          },
        },
      },
      "/reports/{id}/versions/{version}": {
        parameters: [REPORT_ID, { name: "version", in: "path", required: true, description: "Version number.", schema: { type: "integer", minimum: 1 } }],
        get: {
          operationId: "getReportVersion", tags: ["reports"], summary: "One published version with its definition",
          responses: {
            "200": jsonResponse("The version.", { type: "object", properties: { version: { type: "integer" }, published_at: { type: "string", format: "date-time" }, definition: ref("ReportDefinition") }, required: ["version", "published_at", "definition"] }),
            "404": problemRef("NotFound"), ...AUTH_ERRORS,
          },
        },
      },
      "/reports/{id}/sample": {
        parameters: [REPORT_ID],
        get: {
          operationId: "getReportSample", tags: ["reports"], summary: "The data the report designs against",
          description: "For a `summary` or `submissions` source: the data computed from the bound form's real submissions (in `since`–`until` when given), or, while the form has none at all, from made-up submissions shaped like its questions (`origin: synthetic`). For `submission`: the latest answers with the form's schema. For `data`: the definition's sample. `form` and `kind` override the saved source, for a working copy not saved yet. `schema` is the data's JSON Schema with the report's title. Nothing is stored or printed.",
          parameters: [
            { name: "form", in: "query", description: "A form (frm_…) instead of the saved source's.", schema: { type: "string", pattern: "^frm_" } },
            { name: "kind", in: "query", description: "A source kind instead of the saved one.", schema: { type: "string", enum: [...SOURCE_KINDS] } },
            { name: "since", in: "query", description: "Period start (YYYY-MM-DD), summary and submissions.", schema: { type: "string", format: "date" } },
            { name: "until", in: "query", description: "Period end (YYYY-MM-DD), inclusive.", schema: { type: "string", format: "date" } },
          ],
          responses: {
            "200": jsonResponse("The data, its schema and where it came from.", {
              type: "object",
              properties: {
                data: { type: "object", additionalProperties: true },
                schema: { type: "object", description: "JSON Schema (root type object) of `data`.", additionalProperties: true },
                origin: { type: "string", enum: ["submissions", "synthetic", "definition"], description: "submissions: real answers; synthetic: made up, the form has none yet; definition: the definition's sample." },
                count: { type: "integer", description: "How many real submissions the data comes from (0 when synthetic)." },
                source: { type: "object", properties: { kind: { type: "string", enum: [...SOURCE_KINDS] }, form: { type: "string" } }, required: ["kind"] },
              },
              required: ["data", "schema", "origin", "count", "source"],
            }),
            "404": problemRef("NotFound"), "422": problemRef("Invalid"), ...AUTH_ERRORS,
          },
        },
      },
      "/reports/{id}/preview": {
        parameters: [REPORT_ID],
        post: {
          operationId: "previewReport", tags: ["reports"], summary: "Render the draft and run preflight; nothing is stored",
          description: "Prints the saved draft (or `definition` from the body) with `data` (default: the report's sample), a `submission` or a `period`. A summary or submissions report previews the bound form's real submissions (the period's, when given), or made-up ones shaped like its questions while it has none. `format` png (default) answers JSON with the preflight `findings` and base64 PNG `images`; pdf answers the PDF itself with `Preflight-Errors` and `Preflight-Warnings` headers; html answers JSON with the page's HTML. Fix every finding with severity error before publishing. Shares the render rate limit (30/min).",
          requestBody: jsonBody(ref("PreviewRequest"), false),
          responses: {
            "200": {
              description: "The preview, in the requested format.",
              headers: {
                "Preflight-Errors": { schema: { type: "integer" }, description: "format=pdf only: the number of error findings." },
                "Preflight-Warnings": { schema: { type: "integer" }, description: "format=pdf only: the number of warning findings." },
              },
              content: {
                "application/json": { schema: { oneOf: [ref("PreviewResult"), ref("HtmlPreview")] } },
                "application/pdf": { schema: { type: "string", format: "binary" } },
              },
            },
            "404": problemRef("NotFound"), "422": problemRef("Invalid"), ...RENDER_ERRORS,
          },
        },
      },
      "/reports/{id}/documents": {
        parameters: [REPORT_ID],
        post: {
          operationId: "createDocument", tags: ["documents"], summary: "Make a document from the published version (issue it now, or keep a draft)",
          description: "`issue: true` assigns the next gapless number and stores the PDF; the document is then immutable (void it with a reason to cancel). Without it a draft is created. 409 if the report has no published version; 422 `invalid-data` (pointers into `data`) or `preflight-failed` (with `findings`). Shares the render rate limit (30/min).",
          requestBody: jsonBody(ref("CreateDocument")),
          responses: {
            "201": jsonResponse("The document.", ref("DocumentIssued"), { Location: { schema: { type: "string" }, description: "/api/v1/documents/{id}" } }),
            "404": problemRef("NotFound"),
            "409": { ...problemRef("Conflict"), description: "The report is not published (or the manual number is taken)." },
            "422": problemRef("Invalid"), ...RENDER_ERRORS,
          },
        },
      },
      "/documents": {
        get: {
          operationId: "listDocuments", tags: ["documents"], summary: "List documents, newest first",
          parameters: [
            { name: "report", in: "query", description: "Only this report (rpt_…).", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["draft", "issued", "void"] } },
            { name: "number", in: "query", description: "The exact document number.", schema: { type: "string" } },
            { name: "q", in: "query", description: "Substring match.", schema: { type: "string" } },
            { name: "since", in: "query", description: "created_at >= (ISO 8601).", schema: { type: "string", format: "date-time" } },
            { name: "until", in: "query", description: "created_at <= (ISO 8601).", schema: { type: "string", format: "date-time" } },
            intQuery("limit", "Page size (default 50).", { default: 50 }),
            intQuery("offset", "Items to skip.", { default: 0 }),
          ],
          responses: { "200": jsonResponse("A page of documents.", { type: "object", properties: { items: { type: "array", items: ref("Document") }, total: { type: "integer" } }, required: ["items", "total"] }), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
      },
      "/documents/{id}": {
        parameters: [DOCUMENT_ID],
        get: {
          operationId: "getDocument", tags: ["documents"], summary: "One document with its data",
          responses: { "200": jsonResponse("The document.", ref("DocumentWithData")), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
        patch: {
          operationId: "updateDocument", tags: ["documents"], summary: "Change a draft's data, locale or currency",
          description: "Drafts only: an issued or void document answers 409 `immutable`.",
          requestBody: jsonBody({ type: "object", properties: { data: { type: "object", additionalProperties: true }, locale: { type: "string" }, currency: { type: "string", pattern: "^[A-Z]{3}$" } }, additionalProperties: false }),
          responses: {
            "200": jsonResponse("The updated draft.", ref("DocumentWithData")), "404": problemRef("NotFound"),
            "409": { ...problemRef("Conflict"), description: "`immutable`: the document is issued or void." },
            "422": problemRef("Invalid"), ...AUTH_ERRORS,
          },
        },
        delete: {
          operationId: "deleteDocument", tags: ["documents"], summary: "Delete a draft",
          description: "Drafts only: an issued document keeps its number, so void it instead.",
          responses: { "204": { description: "Deleted." }, "404": problemRef("NotFound"), "409": problemRef("Conflict"), ...AUTH_ERRORS },
        },
      },
      "/documents/{id}/pdf": {
        parameters: [DOCUMENT_ID],
        get: {
          operationId: "getDocumentPdf", tags: ["documents"], summary: "The document's PDF",
          description: "An issued document serves the same bytes on every download (see its `pdf_sha256`).",
          responses: {
            "200": pdfResponse("The PDF (application/pdf), as an attachment named after the document number."),
            "304": { description: "Not modified (If-None-Match matched)." },
            "404": problemRef("NotFound"), ...RENDER_ERRORS,
          },
        },
      },
      "/documents/{id}/issue": {
        parameters: [DOCUMENT_ID],
        post: {
          operationId: "issueDocument", tags: ["documents"], summary: "Issue a draft: number, PDF, immutable",
          requestBody: jsonBody({ type: "object", properties: { number: { type: "string", description: "Manual numbering only." } }, additionalProperties: false }, false),
          responses: {
            "200": jsonResponse("The issued document.", ref("DocumentIssued")), "404": problemRef("NotFound"),
            "409": { ...problemRef("Conflict"), description: "`already-issued`." },
            "422": problemRef("Invalid"), ...RENDER_ERRORS,
          },
        },
      },
      "/documents/{id}/void": {
        parameters: [DOCUMENT_ID],
        post: {
          operationId: "voidDocument", tags: ["documents"], summary: "Void a document with a reason",
          description: "The document keeps its number (never reused) and its PDF prints VOID.",
          requestBody: jsonBody({ type: "object", properties: { reason: { type: "string", minLength: 3, maxLength: 500 } }, required: ["reason"], additionalProperties: false }),
          responses: { "200": jsonResponse("The void document.", ref("Document")), "404": problemRef("NotFound"), "409": problemRef("Conflict"), "422": problemRef("Invalid"), ...AUTH_ERRORS },
        },
      },
      "/documents/{id}/share/rotate": {
        parameters: [DOCUMENT_ID],
        post: {
          operationId: "rotateShareLink", tags: ["documents"], summary: "Replace the share link; the old one stops working",
          responses: {
            "200": jsonResponse("The new links.", { type: "object", properties: { share_url: { type: "string", format: "uri" }, share_pdf_url: { type: "string", format: "uri" }, note: { type: "string" } }, required: ["share_url", "share_pdf_url"] }),
            "404": problemRef("NotFound"), ...AUTH_ERRORS,
          },
        },
      },
      "/submissions/{id}/pdf": {
        parameters: [SUBMISSION_ID],
        get: {
          operationId: "getSubmissionPdf", tags: ["submissions"], summary: "Print any submission through the built-in submission record",
          description: "No report needed: every answer of the submission, on A4. Not numbered and not stored.",
          responses: { "200": pdfResponse("The PDF."), "404": problemRef("NotFound"), ...RENDER_ERRORS },
        },
      },

      "/assets": {
        get: {
          operationId: "listAssets", tags: ["assets"], summary: "List uploaded images",
          responses: { "200": jsonResponse("Assets, newest first.", { type: "object", properties: { items: { type: "array", items: ref("Asset") } }, required: ["items"] }), ...AUTH_ERRORS },
        },
        post: {
          operationId: "uploadAsset", tags: ["assets"], summary: "Upload a logo or image (PNG, JPEG, WebP, SVG; about 1 MB at most)",
          description: "Send the raw bytes with an image content type (`?name=` names it), or multipart with the field `file`. The type is sniffed from the bytes: a script disguised as an image is a 415, an SVG with active content a 422. Use the returned `ref` (`asset:ast_…`) as `appearance.logo` or in an image block. The bytes are public at `url` (no key), served with a nosniff header.",
          parameters: [{ name: "name", in: "query", description: "A file name to keep with the asset.", schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/webp": { schema: { type: "string", format: "binary" } },
              "image/svg+xml": { schema: { type: "string", format: "binary" } },
              "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } },
            },
          },
          responses: {
            "201": jsonResponse("The asset.", ref("Asset"), { Location: { schema: { type: "string" }, description: "/api/v1/assets/{id}" } }),
            "413": problemRef("Problem"), "415": problemRef("Problem"), "422": problemRef("Invalid"), ...AUTH_ERRORS,
          },
        },
      },
      "/assets/{id}": {
        parameters: [idParam("id", "Asset id (ast_…).")],
        get: {
          operationId: "getAsset", tags: ["assets"], summary: "One asset's metadata",
          description: "The image bytes are served without a key at `{origin}/assets/{id}` (the asset's `url`), outside /api/v1.",
          responses: { "200": jsonResponse("The asset.", ref("Asset")), "404": problemRef("NotFound"), ...AUTH_ERRORS },
        },
      },

      "/d/{token}": {
        servers: [{ url: origin, description: "Share views live at the site root, not under /api/v1." }],
        parameters: [{ name: "token", in: "path", required: true, description: "The share token in a document's `share_url`.", schema: { type: "string" } }],
        get: {
          operationId: "viewSharedDocument", tags: ["documents"], summary: "Share view of a document (public, no key)",
          description: "An HTML page with the document and a download button, marked noindex. Replace the link with `POST /documents/{id}/share/rotate`.",
          security: [],
          responses: {
            "200": { description: "The share page.", content: { "text/html": { schema: { type: "string" } } } },
            "404": { description: "No such link (never existed, or rotated)." },
            "429": problemRef("RateLimited"),
          },
        },
      },
      "/d/{token}.pdf": {
        servers: [{ url: origin, description: "Share views live at the site root, not under /api/v1." }],
        parameters: [{ name: "token", in: "path", required: true, description: "The share token in a document's `share_url`.", schema: { type: "string" } }],
        get: {
          operationId: "downloadSharedDocument", tags: ["documents"], summary: "The PDF behind a share link (public, no key)",
          security: [],
          parameters: [{ name: "download", in: "query", description: "`1` sends it as an attachment instead of inline.", schema: { type: "string", enum: ["1"] } }],
          responses: { "200": pdfResponse("The PDF."), "404": { description: "No such link." }, "429": problemRef("RateLimited"), "503": problemRef("RendererBusy") },
        },
      },
    },

    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http", scheme: "bearer", bearerFormat: "fc_live_…",
          description: "A workspace API key: `Authorization: Bearer fc_live_…`. The dashboard's session cookie also works for same-origin calls.",
        },
      },
      responses: {
        Problem: { description: "Problem details (RFC 9457).", content: { "application/problem+json": { schema: ref("Problem") } } },
        Unauthorized: { description: "Missing or invalid API key.", content: { "application/problem+json": { schema: ref("Problem") } } },
        NotFound: { description: "No such resource in this workspace.", content: { "application/problem+json": { schema: ref("Problem") } } },
        Conflict: { description: "State conflict (slug taken, form closed/full/unpublished).", content: { "application/problem+json": { schema: ref("Problem") } } },
        Invalid: { description: "The request, definition or submission is invalid; `errors[]` names each fault.", content: { "application/problem+json": { schema: ref("Problem") } } },
        RendererBusy: {
          description: "The renderer is busy (`renderer-busy`) or failed to print (`render-failed`): retry after `Retry-After` seconds. Or it is not installed on the server (`renderer-not-installed`, whose detail says to run `npx playwright install --only-shell chromium`) or could not start (`renderer-unavailable`).",
          headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds to wait." } },
          content: { "application/problem+json": { schema: ref("Problem") } },
        },
        RateLimited: {
          description: "Too many requests (240/min per key; 30 renders/min per key; 10 submissions/min per address).",
          headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds to wait." } },
          content: { "application/problem+json": { schema: ref("Problem") } },
        },
      },
      schemas: {
        Problem: {
          type: "object",
          description: "RFC 9457 problem details.",
          properties: {
            type: { type: "string", format: "uri", description: "e.g. https://forecraft.dev/problems/invalid-definition" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string", description: "The request path." },
            errors: {
              type: "array",
              description: "Present on 422: one entry per fault.",
              items: {
                type: "object",
                properties: {
                  pointer: { type: "string", description: "JSON pointer into the request body, e.g. /schema/properties/a/type." },
                  detail: { type: "string" },
                  field: { type: "string", description: "Submission faults: the field path." },
                  rule: { type: "string", description: "Submission faults: the rule that failed (e.g. required, minLength, or a rules id)." },
                },
                required: ["pointer", "detail"],
              },
            },
          },
          required: ["type", "title", "status"],
          additionalProperties: true,
        },
        Workspace: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, created_at: { type: "string", format: "date-time" } }, required: ["id", "name", "created_at"] },
        ApiKey: {
          type: "object",
          properties: {
            id: { type: "string" }, name: { type: "string" }, prefix: { type: "string", description: "The first characters of the secret." },
            created_at: { type: "string", format: "date-time" },
            last_used_at: { type: ["string", "null"], format: "date-time" },
            revoked_at: { type: ["string", "null"], format: "date-time" },
          },
          required: ["id", "name", "prefix", "created_at"],
        },
        ApiKeyCreated: {
          allOf: [ref("ApiKey"), { type: "object", properties: { secret: { type: "string", pattern: "^fc_live_", description: "Shown once." }, note: { type: "string" } }, required: ["secret"] }],
        },

        FormDefinition: {
          type: "object",
          description: "The whole form in one document. Unknown top-level keys are refused.",
          properties: {
            schema: {
              type: "object",
              description: "JSON Schema in the subset @faqir-ui/forms renders: root type object with a title and at least one property; properties are scalars (string with format email|uri|date|…, enum, number, integer, boolean), nested objects, arrays of enum strings, or arrays of objects with scalar fields. Conditional keywords (if/then/else, dependentRequired) become rules.",
              properties: {
                type: { const: "object" },
                title: { type: "string", minLength: 1, description: "The form's title." },
                description: { type: "string" },
                properties: { type: "object", minProperties: 1, additionalProperties: true },
                required: { type: "array", items: { type: "string" } },
              },
              required: ["type", "title", "properties"],
              additionalProperties: true,
            },
            ui: {
              type: "object",
              description: "Faqir UI schema. Per-field keys: widget (textarea, radio, select, switch, checkbox-group, multi-select, scale, ...), placeholder, rows, enumLabels, width (full|half|third), orientation, minLabel/maxLabel (scale), addLabel, removeLabel, items (repeatable row UI); forecraft adds prefix/suffix (number units) and verbatim (long text a summary may quote). Root keys: ui:groups [{title, description?, fields}] or ui:wizard {label, steps[{title, description?, fields, when?}]}).",
              additionalProperties: true,
            },
            rules: {
              type: "object",
              description: "@faqir-ui/rules input: { rules: [{ id, show|require: field, when } | { id, validate, path, message } | { id, compute, value }], messages?, defaultLocale?, fields? }. Conditions are JSONLogic.",
              properties: { rules: { type: "array", items: { type: "object", required: ["id"], additionalProperties: true } } },
              additionalProperties: true,
            },
            appearance: ref("Appearance"),
          },
          required: ["schema"],
          additionalProperties: false,
        },
        Appearance: {
          type: "object",
          description: "How the public page looks. Every key is optional; see GET /vocabulary for the defaults.",
          properties: {
            theme: { type: "string", enum: THEMES },
            accent: { type: "string", enum: [...ACCENTS], description: '"theme" keeps the theme\'s own primary colour.' },
            scheme: { type: "string", enum: [...SCHEMES] },
            layout: { type: "string", enum: [...LAYOUTS] },
            cover: {
              type: ["object", "null"],
              properties: { image: { type: "string", description: "http(s) URL, a /path on this site, or empty." }, eyebrow: { type: "string" } },
              additionalProperties: false,
            },
            submitLabel: { type: "string", minLength: 1 },
            thankYou: { type: "object", properties: { title: { type: "string" }, message: { type: "string" } }, required: ["title", "message"] },
            redirect: { type: ["string", "null"], format: "uri", description: "http(s) URL to send people to after a submission." },
          },
          additionalProperties: false,
        },
        CreateForm: {
          type: "object",
          properties: {
            definition: ref("FormDefinition"),
            slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$", description: "Public slug (3-64 chars). Omit to derive one from the title." },
          },
          required: ["definition"],
        },
        FormPatch: {
          type: "object",
          minProperties: 1,
          properties: {
            definition: ref("FormDefinition"),
            status: { type: "string", enum: ["open", "closed"] },
            submission_limit: { type: ["integer", "null"], minimum: 1, description: "null removes the limit." },
            slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$" },
          },
          additionalProperties: false,
        },
        FormSummary: {
          type: "object",
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            title: { type: "string" },
            status: { type: "string", enum: ["open", "closed"] },
            submission_limit: { type: ["integer", "null"] },
            published_version: { type: ["integer", "null"], description: "null until first published." },
            has_unpublished_changes: { type: "boolean" },
            submission_count: { type: "integer" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            url: { type: "string", format: "uri", description: "The public page (live once published)." },
            preview_url: { type: "string", format: "uri", description: "The dashboard preview." },
          },
          required: ["id", "slug", "title", "status", "published_version", "has_unpublished_changes", "submission_count", "created_at", "updated_at", "url", "preview_url"],
        },
        Form: {
          allOf: [ref("FormSummary"), { type: "object", properties: { definition: ref("FormDefinition") }, required: ["definition"] }],
        },
        PublishedVersion: {
          type: "object",
          properties: { version: { type: "integer" }, published_at: { type: "string", format: "date-time" }, url: { type: "string", format: "uri" } },
          required: ["version", "published_at", "url"],
        },
        VersionSummary: {
          type: "object",
          properties: {
            version: { type: "integer" }, published_at: { type: "string", format: "date-time" },
            live: { type: "boolean" }, submission_count: { type: "integer" },
          },
          required: ["version", "published_at", "live", "submission_count"],
        },
        Preview: {
          type: "object",
          properties: {
            html: { type: "string", description: "The complete rendered page." },
            audit: ref("Audit"),
            rules: { type: "object", description: "The compiled @faqir-ui/rules definition the page carries.", additionalProperties: true },
          },
          required: ["html", "audit", "rules"],
        },
        Audit: {
          type: "object",
          properties: {
            passed: { type: "boolean" },
            counts: {
              type: "object",
              properties: { critical: { type: "integer" }, error: { type: "integer" }, warning: { type: "integer" }, info: { type: "integer" } },
              required: ["critical", "error", "warning", "info"],
            },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: { rule_id: { type: "string" }, severity: { type: "string" }, line: { type: "integer" }, message: { type: "string" } },
                required: ["rule_id", "severity", "line", "message"],
              },
            },
          },
          required: ["passed", "counts", "findings"],
        },
        Verdict: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: { path: { type: "string" }, rule: { type: "string" }, message: { type: "string" }, params: { type: "object", additionalProperties: true } },
                required: ["path", "rule", "message"],
              },
            },
            data: { type: "object", additionalProperties: true, description: "What would be stored: coerced, hidden fields dropped, computed values filled in." },
          },
          required: ["valid", "findings", "data"],
        },
        SubmissionBody: {
          type: "object",
          properties: { data: { type: "object", additionalProperties: true, description: "Answers keyed by field name." } },
          required: ["data"],
        },
        SubmissionReceipt: {
          type: "object",
          properties: {
            id: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            thank_you: { type: "object", properties: { title: { type: "string" }, message: { type: "string" } } },
            redirect: { type: ["string", "null"] },
          },
          required: ["id", "created_at"],
        },
        Submission: {
          type: "object",
          properties: {
            id: { type: "string" },
            form_id: { type: "string" },
            version: { type: "integer", description: "The published version it was made against." },
            created_at: { type: "string", format: "date-time" },
            data: { type: "object", additionalProperties: true },
          },
          required: ["id", "form_id", "version", "created_at", "data"],
        },
        ReportVocabulary: {
          type: "object",
          properties: {
            blocks: { type: "array", items: { type: "object", properties: { block: { type: "string" }, group: { type: "string" }, does: { type: "string" }, props: { type: "array", items: { type: "string" } }, example: { type: "object", additionalProperties: true } }, required: ["block", "does", "props", "example"] } },
            common_props: { type: "object", additionalProperties: { type: "string" } },
            helpers: { description: "Expression helpers usable inside `{{ … }}`." },
            system_values: { type: "array", items: { type: "string" } },
            print_themes: { type: "array", items: { type: "string", enum: [...PRINT_THEMES] } },
            type_pairings: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, note: { type: "string" } }, required: ["id"], additionalProperties: true } },
            papers: { type: "array", items: { type: "string" } },
            orientations: { type: "array", items: { type: "string" } },
            margins: { type: "array", items: { type: "string" } },
            densities: { type: "array", items: { type: "string" } },
            locales: { type: "array", items: { type: "string" } },
            languages: { type: "array", items: { type: "string" } },
            labels: { type: "array", items: { type: "string" } },
            appearance_defaults: { type: "object", additionalProperties: true },
            numbering: { type: "object", additionalProperties: true },
            money: { type: "object", additionalProperties: true },
            sources: { type: "array", items: { type: "object", additionalProperties: true } },
            summary_shape: { type: "object", description: "The JSON Schema of the data a summary report prints. Every share in it is a percentage on the 0–100 scale.", additionalProperties: true },
            submissions_shape: { type: "object", description: "The JSON Schema of the data a submissions (register) report prints.", additionalProperties: true },
            units: { type: "object", description: "What the numbers mean: share is 0–100; percent(value) reads value on the 0–100 scale.", additionalProperties: { type: "string" } },
            preflight_codes: { type: "array", items: ref("PreflightCode") },
          },
          required: ["blocks", "print_themes", "type_pairings", "papers", "preflight_codes"],
        },
        PreflightCode: {
          type: "object",
          properties: { code: { type: "string", enum: PREFLIGHT_CODES.map((c) => c.code) }, severity: { type: "string", enum: ["error", "warning"] }, checks: { type: "string" } },
          required: ["code", "severity", "checks"],
        },
        Starter: {
          type: "object",
          properties: {
            id: { type: "string" }, title: { type: "string" }, description: { type: "string" },
            theme: { type: "string" }, paper: { type: "string" },
            source: { type: "string", enum: [...SOURCE_KINDS] },
            needsForm: { type: "boolean", description: "true: `form` (frm_…) is required to create a report from it." },
            blocks: { type: "array", items: { type: "string" } },
          },
          required: ["id", "title", "description", "theme", "paper", "source", "needsForm", "blocks"],
        },
        ReportAppearance: {
          type: "object",
          description: "Curated print look: choose from these values. There are no sizes, fonts or colours to set, apart from the one accent.",
          properties: {
            theme: { type: "string", enum: [...PRINT_THEMES] },
            accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "One hex colour; at least 4.5:1 contrast on white." },
            paper: { type: "string", enum: [...PAPERS] },
            orientation: { type: "string", enum: [...ORIENTATIONS] },
            margins: { type: "string", enum: [...MARGINS] },
            type: { type: "string", enum: Object.keys(TYPE_PAIRINGS), description: "Type pairing id." },
            density: { type: "string", enum: [...DENSITIES] },
            locale: { type: "string", description: `language-REGION, e.g. ${LOCALES.join(", ")}.` },
            currency: { type: "string", pattern: "^[A-Z]{3}$", description: "ISO 4217." },
            logo: { type: ["string", "null"], pattern: "^asset:ast_", description: "An uploaded asset's `ref`." },
            letter: { type: "object", properties: { window: { type: "boolean" }, foldMarks: { type: "boolean" } }, additionalProperties: false },
          },
          additionalProperties: false,
        },
        ReportBlock: {
          type: "object",
          description: "One block of the layout. `block` names it; the other keys are that block's props (GET /vocabulary/reports lists each block's props with an example). Text props take `{{ expression }}` holes; `when` is a bare expression.",
          properties: {
            id: { type: "string", pattern: "^[a-z0-9-]+$", description: "Stable and unique within the report." },
            block: { type: "string", enum: Object.keys(BLOCKS) },
            when: { type: "string", description: "Renders only when this expression is truthy." },
            keep: { type: "string", enum: ["together", "with-next"] },
          },
          required: ["id", "block"],
          additionalProperties: true,
        },
        ReportDefinition: {
          type: "object",
          description: "The whole report in one document. Unknown top-level keys are refused.",
          properties: {
            schema: { type: "object", description: "JSON Schema (root type object, root title) of the data a document prints.", additionalProperties: true },
            sample: { type: "object", description: "Realistic data satisfying the schema; previews print it.", additionalProperties: true },
            layout: { type: "array", items: ref("ReportBlock") },
            appearance: ref("ReportAppearance"),
            money: {
              type: "object",
              description: "Exact money maths over the data: the names of the fields holding the lines, quantity, unit price, tax rate and so on.",
              properties: {
                lines: { type: "string" }, quantity: { type: "string" }, unitPrice: { type: "string" }, taxRate: { type: "string" }, discount: { type: "string" }, paid: { type: "string" },
                prices: { type: "string", enum: ["net", "gross"] }, rounding: { type: "string", enum: ["line", "total"] },
              },
              required: ["lines", "quantity", "unitPrice"],
              additionalProperties: false,
            },
            numbering: {
              type: "object",
              description: "Gapless numbering: a pattern with {YYYY}, {YY}, {MM}, {seq} or {seq:N}, or manual.",
              properties: { pattern: { type: "string", examples: ["INV-{YYYY}-{seq:4}"] }, manual: { type: "boolean" } },
              additionalProperties: false,
            },
            documentTitle: { type: "string" },
            runningHeader: { type: "string" },
            labels: { type: "object", additionalProperties: { type: "string" } },
            source: {
              type: "object",
              description: "Where the data comes from: `data` (JSON you send), `submission` (a form's submission), `summary` (a form's answers over a period, aggregated) or `submissions` (a register: one row per submission in a period).",
              properties: { kind: { type: "string", enum: [...SOURCE_KINDS] }, form: { type: "string", description: "frm_… (every kind but data)." } },
              required: ["kind"],
              additionalProperties: false,
            },
          },
          required: ["schema", "sample", "layout"],
          additionalProperties: false,
        },
        CreateReportFromStarter: {
          type: "object",
          properties: {
            starter: { type: "string", description: "A starter id from GET /report-starters." },
            title: { type: "string" },
            appearance: ref("ReportAppearance"),
            sample: { type: "object", description: "Each top-level key replaces the starter's sample key, e.g. a whole { seller: { … } }.", additionalProperties: true },
            form: { type: "string", description: "frm_… for the confirmation, survey-summary and submissions-register starters. A summary's or register's sample is then that form's data." },
          },
          required: ["starter"],
          additionalProperties: false,
        },
        ReportSummary: {
          type: "object",
          properties: {
            id: { type: "string" }, title: { type: "string" }, description: { type: ["string", "null"] },
            starter: { type: ["string", "null"] },
            source: { type: "object", additionalProperties: true },
            published_version: { type: ["integer", "null"], description: "null until first published." },
            has_unpublished_changes: { type: "boolean" },
            document_count: { type: "integer" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            preview_url: { type: "string", format: "uri", description: "POST here to preview." },
            design_url: { type: "string", format: "uri", description: "The dashboard designer." },
          },
          required: ["id", "title", "starter", "source", "published_version", "has_unpublished_changes", "document_count", "created_at", "updated_at", "preview_url", "design_url"],
        },
        Report: {
          allOf: [ref("ReportSummary"), { type: "object", properties: { definition: ref("ReportDefinition") }, required: ["definition"] }],
        },
        PublishedReportVersion: {
          type: "object",
          properties: { version: { type: "integer" }, published_at: { type: "string", format: "date-time" }, documents_url: { type: "string", format: "uri", description: "POST here to issue documents." } },
          required: ["version", "published_at", "documents_url"],
        },
        PreviewRequest: {
          type: "object",
          description: "Everything is optional: an empty body previews the saved draft with its sample, as PNG.",
          properties: {
            definition: ref("ReportDefinition"),
            data: { type: "object", additionalProperties: true },
            submission: { type: "string", description: "sub_… of a submission to print." },
            period: { type: "object", properties: { since: { type: "string" }, until: { type: "string" } }, additionalProperties: false },
            format: { type: "string", enum: ["png", "pdf", "html"], default: "png" },
            locale: { type: "string" },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            status: { type: "string", enum: ["draft", "issued"], default: "issued", description: "Print as a draft (marked, no number) or as issued." },
            pages: { type: "integer", minimum: 1, maximum: 8, default: 4, description: "format=png: how many pages to image." },
            dpi: { type: "integer", minimum: 36, maximum: 150, default: 100, description: "format=png: image resolution." },
          },
          additionalProperties: false,
        },
        Finding: {
          type: "object",
          description: "A preflight finding. Severity error blocks issuing; warning does not.",
          properties: {
            severity: { type: "string", enum: ["error", "warning"] },
            code: { type: "string", description: "One of the preflight codes (GET /vocabulary/reports)." },
            message: { type: "string" },
            block: { type: ["string", "null"], description: "The id of the block it concerns." },
            page: { type: "integer" },
            path: { type: "string" },
          },
          required: ["severity", "code", "message"],
          additionalProperties: true,
        },
        PreviewResult: {
          type: "object",
          properties: {
            ok: { type: "boolean", description: "false when any finding has severity error." },
            title: { type: "string" },
            pages: { type: "integer", description: "Total pages of the document." },
            render_ms: { type: "integer" },
            findings: { type: "array", items: ref("Finding") },
            images: {
              type: "array",
              items: {
                type: "object",
                properties: { page: { type: "integer" }, dpi: { type: "integer" }, type: { type: "string", const: "image/png" }, data: { type: "string", contentEncoding: "base64", description: "The PNG." } },
                required: ["page", "dpi", "type", "data"],
              },
            },
            money: { type: ["object", "null"], description: "The computed totals, when the report has money.", additionalProperties: true },
          },
          required: ["ok", "title", "pages", "findings", "images"],
        },
        HtmlPreview: {
          type: "object",
          properties: { html: { type: "string" }, findings: { type: "array", items: ref("Finding") }, title: { type: "string" } },
          required: ["html", "findings", "title"],
        },
        CreateDocument: {
          type: "object",
          description: "The data comes from `data`, a `submission` or a `period`, depending on the report's source.",
          properties: {
            data: { type: "object", additionalProperties: true, description: "Matches the report's schema; mistakes are a 422 with pointers." },
            submission: { type: "string", description: "sub_…" },
            period: { type: "object", properties: { since: { type: "string" }, until: { type: "string" } }, additionalProperties: false },
            issue: { type: "boolean", default: false, description: "true: number it and store the PDF now. false: create an editable draft." },
            number: { type: "string", description: "Manual numbering only." },
            locale: { type: "string" },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
          },
          additionalProperties: false,
        },
        Document: {
          type: "object",
          properties: {
            id: { type: "string" },
            report_id: { type: "string" },
            version: { type: "integer", description: "The published report version it was made with." },
            status: { type: "string", enum: ["draft", "issued", "void"] },
            number: { type: ["string", "null"], description: "null for drafts." },
            title: { type: "string" },
            locale: { type: "string" },
            currency: { type: "string" },
            submission_id: { type: ["string", "null"] },
            issued_at: { type: ["string", "null"], format: "date-time" },
            voided_at: { type: ["string", "null"], format: "date-time" },
            void_reason: { type: ["string", "null"] },
            pages: { type: ["integer", "null"] },
            pdf_sha256: { type: ["string", "null"], description: "The hash of the issued PDF." },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            pdf_url: { type: "string", format: "uri", description: "GET with a key." },
            share_url: { type: "string", format: "uri", description: "Public view: anyone with the link." },
            share_pdf_url: { type: "string", format: "uri", description: "Public PDF: anyone with the link." },
          },
          required: ["id", "report_id", "version", "status", "number", "title", "locale", "currency", "created_at", "updated_at", "pdf_url", "share_url", "share_pdf_url"],
        },
        DocumentWithData: {
          allOf: [ref("Document"), { type: "object", properties: { data: { type: "object", additionalProperties: true } }, required: ["data"] }],
        },
        DocumentIssued: {
          allOf: [ref("Document"), { type: "object", properties: { findings: { type: "array", items: ref("Finding"), description: "Preflight warnings (errors would have refused the request)." } }, required: ["findings"] }],
        },
        Asset: {
          type: "object",
          properties: {
            id: { type: "string" },
            ref: { type: "string", pattern: "^asset:ast_", description: "Use this in appearance.logo or an image block." },
            type: { type: "string", enum: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] },
            name: { type: "string" },
            size: { type: "integer" },
            width: { type: ["integer", "null"] },
            height: { type: ["integer", "null"] },
            sha256: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            url: { type: "string", format: "uri", description: "The bytes, public (no key)." },
          },
          required: ["id", "ref", "type", "name", "size", "sha256", "created_at", "url"],
        },
        Vocabulary: {
          type: "object",
          properties: {
            themes: { type: "array", items: { type: "string" } },
            accents: { type: "array", items: { type: "string" } },
            layouts: { type: "array", items: { type: "string" } },
            schemes: { type: "array", items: { type: "string" } },
            appearance_defaults: { type: "object", additionalProperties: true },
          },
          required: ["themes", "accents", "layouts", "schemes", "appearance_defaults"],
        },
      },
    },
  };
}
