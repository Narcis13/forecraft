// The OpenAPI 3.1 description of /api/v1, hand-written to match src/routes/api.ts.
// Served at /openapi.json (src/routes/agents.ts). Accurate rather than exhaustive:
// the form definition's JSON Schema subset is described in prose and linked to
// the renderer's README, not re-modelled here.

import { ACCENTS, LAYOUTS, SCHEMES, THEMES } from "../forms/model.ts";

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

const AUTH_ERRORS = { "401": problemRef("Unauthorized"), "429": problemRef("RateLimited") };

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
        "`schema` is a strict JSON Schema subset (`@faqir-ui/forms`); `ui` is a Faqir UI schema (`widget`, `placeholder`, `rows`, `enumLabels`, `ui:groups`, `ui:wizard`); `rules` is `@faqir-ui/rules` input. `GET /vocabulary` lists the valid appearance values.",
        "An MCP server for the same API ships in `packages/mcp` (see /docs/mcp).",
      ].join("\n\n"),
    },
    servers: [{ url: `${origin}/api/v1`, description: "This forecraft server" }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "forms", description: "Create, edit, preview and publish forms." },
      { name: "submissions", description: "Read what people sent. Sending is the public endpoint." },
      { name: "workspace", description: "The workspace, its members and API keys." },
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
          description: "The secret (`fc_live_…`) is in this response only. Store it now.",
          requestBody: jsonBody({ type: "object", properties: { name: { type: "string", default: "API key" } } }, false),
          responses: { "201": jsonResponse("The key and its secret.", ref("ApiKeyCreated")), ...AUTH_ERRORS },
        },
      },
      "/keys/{id}": {
        delete: {
          operationId: "revokeKey", tags: ["workspace"], summary: "Revoke an API key",
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
        RateLimited: {
          description: "Too many requests (240/min per key; 10 submissions/min per address).",
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
              description: "Faqir UI schema. Per-field keys: widget (textarea, radio, select, switch, checkbox-group, multi-select, …), placeholder, rows, enumLabels, addLabel, removeLabel. Root keys: ui:groups [{title, description?, fields}] or ui:wizard {label, steps[{title, description?, fields, when?}]}.",
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
        Vocabulary: {
          type: "object",
          properties: {
            themes: { type: "array", items: { type: "string" } },
            accents: { type: "array", items: { type: "string" } },
            layouts: { type: "array", items: { type: "string" } },
            appearance_defaults: { type: "object", additionalProperties: true },
          },
          required: ["themes", "accents", "layouts", "appearance_defaults"],
        },
      },
    },
  };
}
