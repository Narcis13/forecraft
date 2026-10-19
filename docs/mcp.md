# forecraft MCP server

`packages/mcp/index.mjs` is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets an agent build and run forms, and design and issue PDF reports and documents (invoices, letters, confirmations), through the forecraft REST API. It speaks JSON-RPC 2.0 over **stdio** (newline-delimited JSON), is plain Node with **no dependencies**, and logs to stderr only. Protocol version `2025-06-18` (it also answers `2025-03-26` and `2024-11-05` clients in kind).

## Install

Add the server to your project's `.mcp.json` (this repository already has it):

```json
{
  "mcpServers": {
    "forecraft": {
      "command": "node",
      "args": ["packages/mcp/index.mjs"],
      "env": {
        "FORECRAFT_URL": "http://localhost:3000",
        "FORECRAFT_API_KEY": "${FORECRAFT_API_KEY}"
      }
    }
  }
}
```

Or with the Claude Code CLI:

```sh
claude mcp add forecraft -e FORECRAFT_URL=http://localhost:3000 -e FORECRAFT_API_KEY=fc_live_… -- node packages/mcp/index.mjs
```

Create a key in the dashboard under **API keys** (or `POST /api/v1/keys`) and export it as `FORECRAFT_API_KEY` in the shell that starts your agent host. Never commit a real key.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `FORECRAFT_URL` | `http://localhost:3000` | Base URL of the forecraft server. |
| `FORECRAFT_API_KEY` | none | `fc_live_…` bearer key. Required for every tool call and for resources; without it tools answer with an error that says so. |

## The definition format

Tools that take a `definition` expect one JSON object, `{ schema, ui?, rules?, appearance? }`:

- `schema`: JSON Schema, root `type: "object"`, root `title` (the form's title), at least one property. The supported subset is strict: strings (with `format`, `enum`, `minLength`, …), numbers, integers, booleans, nested objects, arrays of enum strings, arrays of objects with scalar fields.
- `ui`: Faqir UI schema per field (`widget`, `placeholder`, `rows`, `enumLabels`), plus `ui:groups` or `ui:wizard`.
- `rules`: `@faqir-ui/rules` input, `{ rules: [{ id, show | require | validate | compute, when, … }] }`, conditions in JSONLogic.
- `appearance`: `{ theme, accent, scheme, layout, cover, submitLabel, thankYou, redirect }`. Valid values: `GET /api/v1/vocabulary` (tool `forecraft_get_vocabulary`).

A definition that breaks the format is refused with a `422` problem whose `errors[]` give a JSON pointer and a detail for each fault.

## Tools

Results are text content holding pretty-printed JSON (`forecraft_preview_report` also returns the pages as images, and resources can carry a PDF; see below). When the API answers 400 or above, the result has `isError: true` and its text is the problem-details JSON (`type`, `title`, `status`, `detail`, `errors[]`; `retry_after_seconds` on 429). Invalid arguments are reported the same way, before any request.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `forecraft_create_form` | `definition`, `slug?` | Create a draft form. Returns id, slug, title, status, `url` (public page, live after publishing) and `preview_url`. |
| `forecraft_update_form` | `id`, `definition?`, `status?` (`open`\|`closed`), `submission_limit?` (integer or `null`), `slug?` | PATCH a form. `definition` replaces the whole draft. Publish again to make it live. |
| `forecraft_get_form` | `id` | The form with its full draft definition. |
| `forecraft_list_forms` | none | All forms of the workspace (no definitions). |
| `forecraft_publish_form` | `id` | Snapshot the draft as the next version and serve it. Returns `version`, `published_at`, `url`. |
| `forecraft_preview_form` | `id?`, `definition?` (one required) | Render and audit without storing. Returns two content items: a summary (audit passed, counts, findings) and the full HTML page. |
| `forecraft_list_submissions` | `id`, `q?`, `limit?` (1-1000), `offset?`, `version?`, `since?`, `until?` | Submissions, newest first, with `total`. |
| `forecraft_get_submission` | `id` | One submission. |
| `forecraft_export_submissions` | `id`, `format` (`csv`\|`json`), `q?` | Up to 1000 submissions as CSV text or JSON. |
| `forecraft_validate_submission` | `id`, `data` | Dry-run answers against the draft's rules. Returns `{ valid, findings, data }`; nothing is stored. |
| `forecraft_get_vocabulary` | none | Valid `themes`, `accents`, `layouts` and the appearance defaults. |

### Reports and documents

A **report** is one JSON definition (`{ schema, sample, layout, appearance, … }`) printed as an A4 or Letter PDF; a **document** is one issued PDF of it, with a gapless number. Start from a starter, choose the look from curated values (theme, one dark accent hex, paper, type pairing; never sizes or colours), preview, publish, then issue. See [reports](/docs/reports) and the [style guide](/docs/report-style).

| Tool | Arguments | When to use it |
| --- | --- | --- |
| `forecraft_get_report_vocabulary` | none | Before writing or editing a definition: every block with an example, helpers, print themes, type pairings, locales, papers and preflight codes. |
| `forecraft_list_report_starters` | none | First step of every new report: invoice, letter, business-report, confirmation, survey-summary, blank. |
| `forecraft_create_report` | `starter`, `title?`, `appearance?`, `sample?`, `form?` — or `definition` (exactly one of `starter` / `definition`) | Create a draft report. From a starter the result includes the definition so you can edit it; `form` (`frm_…`) is required for the confirmation and survey-summary starters. |
| `forecraft_update_report` | `id`, `definition` | Replace the whole draft definition (read it with `forecraft_get_report` first). Publish again afterwards. |
| `forecraft_get_report` | `id` | One report with its draft definition, `published_version` and `has_unpublished_changes`. |
| `forecraft_list_reports` | none | All reports (no definitions) with `document_count`. |
| `forecraft_preview_report` | `id`, `definition?`, `data?`, `submission?`, `period?`, `locale?`, `currency?`, `pages?` (1-4, default 4), `dpi?` (36-150, default 100) | Render and run preflight; nothing is stored. Returns a text item `{ verdict, ok, pages, pages_shown, findings, title }` followed by one `image` item (PNG) per page, so you can look at the result. |
| `forecraft_publish_report` | `id` | Snapshot the draft as the next immutable version; documents are issued from it. Returns `version`, `published_at`, `documents_url`. |
| `forecraft_issue_document` | `report`, `data?` / `submission?` / `period?`, `number?`, `locale?`, `currency?`, `draft?` (default `false`) | Make a document: issued now (number, PDF, `pdf_url`, `share_url`), or an editable draft with `draft: true`. 409 if the report is unpublished; 422 `invalid-data` (pointers) or `preflight-failed` (`findings`). |
| `forecraft_list_documents` | `report?`, `status?` (`draft`\|`issued`\|`void`), `number?`, `q?`, `since?`, `until?`, `limit?`, `offset?` | Find documents, newest first, with `total`. |
| `forecraft_get_document` | `id` | One document with its `data`, status, number, `pdf_url` and `share_url`. The PDF itself is a resource. |
| `forecraft_void_document` | `id`, `reason` (3-500 characters) | Cancel an issued document: it keeps its number and prints VOID. Issued documents cannot be edited, so correct a mistake by voiding and issuing again. |
| `forecraft_upload_asset` | `path` (local file) or `base64` (+ `type?`), `name?` | Upload a logo or image (PNG, JPEG, WebP, SVG; about 1 MB at most). Use the returned `ref` (`asset:ast_…`) as `appearance.logo` or in an image block. The type is checked from the bytes, not the name. |

`forecraft_preview_report` is the one tool whose result is not all text. Its `content` is the summary text item and then up to four `{ "type": "image", "data": "<base64>", "mimeType": "image/png" }` items, about 100 dpi. A busy renderer is a tool error with the API's 503 `renderer-busy` problem and `retry_after_seconds`; wait that long and call again.

## Resources

- Template `forecraft://form/{id}` (`application/json`): the form's draft definition.
- Template `forecraft://report/{id}` (`application/json`): the report's draft definition.
- Template `forecraft://document/{id}`: two content items, the document's metadata and data (`application/json`, as `text`) and its PDF (`application/pdf`, as a base64 `blob`).
- `resources/list` lists the workspace's forms and reports, and its 20 most recent documents, as `forecraft://form/<id>`, `forecraft://report/<id>` and `forecraft://document/<id>`.
- Reading an unknown id answers JSON-RPC error `-32002` (resource not found).

## Example session

An agent building a small form. The calls are shown as the tool name and arguments; the host wraps them in `tools/call`.

```text
forecraft_get_vocabulary {}
  -> { "themes": ["aurora", "candy", "default", "editorial", "luxe", "nordic", …], "accents": [...], "layouts": ["card","split","page"], … }

forecraft_create_form {
  "slug": "pizza-night",
  "definition": {
    "schema": {
      "title": "Pizza night",
      "type": "object",
      "properties": {
        "name": { "type": "string", "title": "Your name", "minLength": 2 },
        "size": { "type": "string", "title": "Size", "enum": ["Small", "Large"] }
      },
      "required": ["name", "size"]
    },
    "appearance": { "theme": "nordic", "submitLabel": "Order" }
  }
}
  -> { "id": "frm_…", "slug": "pizza-night", "published_version": null,
       "url": "http://localhost:3000/f/pizza-night", "preview_url": "http://localhost:3000/app/forms/frm_…/preview", … }

forecraft_preview_form { "id": "frm_…" }
  -> [ "Audit: PASSED\nCounts: critical=0 error=0 warning=0 info=0\n…",
       "<!doctype html>… <form id=\"fc-form\" …" ]

forecraft_publish_form { "id": "frm_…" }
  -> { "version": 1, "published_at": "…", "url": "http://localhost:3000/f/pizza-night" }
```

People now fill in `http://localhost:3000/f/pizza-night`. Later:

```text
forecraft_list_submissions { "id": "frm_…", "limit": 20 }
  -> { "items": [ { "id": "sub_…", "version": 1, "created_at": "…", "data": { "name": "Grace Hopper", "size": "Large" } } ], "total": 1 }
```

### Example: your first invoice (preview, fix, publish, issue)

```text
forecraft_list_report_starters {}
  -> { "items": [ { "id": "invoice", "theme": "document", "paper": "a4", "source": "data", … }, { "id": "letter", … }, … ] }

forecraft_create_report {
  "starter": "invoice", "title": "Invoice",
  "appearance": { "accent": "#7c2d12" },
  "sample": { "seller": { "name": "Quayside Logistics Ltd", "street": "4 Harbour Row", "city": "Leith EH6 6LX", "iban": "GB29NWBK60161331926819" } }
}
  -> { "id": "rpt_…", "starter": "invoice", "published_version": null, "definition": { "schema": …, "sample": …, "layout": […] }, … }

forecraft_preview_report { "id": "rpt_…" }
  -> [ { "type": "text", "text": "{ \"verdict\": \"Preflight FAILED: 1 error; fix the findings before publishing. 1 page in total, 1 shown as images below.\",
          \"ok\": false, \"pages\": 1, \"pages_shown\": 1,
          \"findings\": [ { \"severity\": \"error\", \"code\": \"overflow\", \"block\": \"payment\", \"message\": \"…\" } ], \"title\": \"…\" }" },
       { "type": "image", "data": "<base64 PNG>", "mimeType": "image/png" } ]
```

Read the findings and look at the page. Fix what they name (here, a block's text is too wide) by sending the whole definition back, and preview again until `ok` is `true`:

```text
forecraft_update_report { "id": "rpt_…", "definition": { …the edited definition… } }
forecraft_preview_report { "id": "rpt_…" }
  -> verdict "Preflight passed with no findings. 1 page in total, 1 shown as images below." + the page image

forecraft_publish_report { "id": "rpt_…" }
  -> { "version": 1, "published_at": "…", "documents_url": "http://localhost:3000/api/v1/reports/rpt_…/documents" }

forecraft_issue_document { "report": "rpt_…", "data": { "seller": { … }, "customer": { … }, "reference": "…", "period": "…", "due": "2026-11-18", "items": [ { "description": "Pallet transport", "qty": 2, "unit": "pallet", "price": 450, "vat": 19 } ] } }
  -> { "id": "doc_…", "status": "issued", "number": "INV-2026-0001", "pages": 1,
       "pdf_url": "http://localhost:3000/api/v1/documents/doc_…/pdf", "share_url": "http://localhost:3000/d/…", "findings": [] }
```

`data` follows the report's `schema` (start from the definition's `sample`); a mistake comes back as a 422 `invalid-data` whose `errors[]` give a JSON pointer into `data`. The PDF is the resource `forecraft://document/doc_…`. If the invoice went to the wrong customer, void it and issue a new one; the number is kept and never reused:

```text
forecraft_void_document { "id": "doc_…", "reason": "Issued to the wrong entity" }
  -> { "id": "doc_…", "status": "void", "number": "INV-2026-0001", "void_reason": "Issued to the wrong entity", … }
```

On the wire, one tool call is a single line each way:

```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"forecraft_get_form","arguments":{"id":"frm_…"}}}
{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{\n  \"id\": \"frm_…\", …}"}]}}
```

A refusal:

```json
{"jsonrpc":"2.0","id":8,"result":{"isError":true,"content":[{"type":"text","text":"{\n  \"type\": \"https://forecraft.dev/problems/invalid-definition\",\n  \"title\": \"Invalid form definition\",\n  \"status\": 422,\n  \"errors\": [ { \"pointer\": \"/schema/properties/a\", \"detail\": \"…\" } ]\n}"}]}}
```

## Troubleshooting

- *"FORECRAFT_API_KEY is not set"*: the host did not pass the variable through. Export it before launching the host, or write the key into the `env` block of your local (uncommitted) MCP config.
- *401*: the key is revoked or from another server. Create a new one.
- *"Could not reach forecraft"*: check `FORECRAFT_URL` and that `npm start` is running.
- Stdout carries JSON-RPC only; read stderr for the server's own log lines.

The same API is described for machines at `/openapi.json` and `/llms.txt`.
