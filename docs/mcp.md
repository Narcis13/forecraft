# forecraft MCP server

`packages/mcp/index.mjs` is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets an agent build and run forms through the forecraft REST API. It speaks JSON-RPC 2.0 over **stdio** (newline-delimited JSON), is plain Node with **no dependencies**, and logs to stderr only. Protocol version `2025-06-18` (it also answers `2025-03-26` and `2024-11-05` clients in kind).

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

Results are text content holding pretty-printed JSON. When the API answers 400 or above, the result has `isError: true` and its text is the problem-details JSON (`type`, `title`, `status`, `detail`, `errors[]`; `retry_after_seconds` on 429). Invalid arguments are reported the same way, before any request.

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

## Resources

- Template `forecraft://form/{id}` (`application/json`): the form's draft definition.
- `resources/list` lists the workspace's forms as `forecraft://form/<id>`.
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
