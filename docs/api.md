# API reference

The REST API is the product: the dashboard, the designer and the MCP server are clients of these same routes. Everything is JSON under `/api/v1`. The machine-readable version is [/openapi.json](/openapi.json).

## Authentication

Send an API key as a bearer token. Keys start with `fc_live_`, belong to one workspace, and are created in the dashboard under **API keys** (or printed by `npm run seed`).

```bash
curl -s "$FORECRAFT_URL/api/v1/forms" -H "Authorization: Bearer $FORECRAFT_API_KEY"
```

The dashboard's session cookie works too. Only the public submission endpoint needs neither.

## Errors

Every error is `application/problem+json` (RFC 9457):

```json
{
  "type": "https://forecraft.dev/problems/invalid-request",
  "title": "Invalid request",
  "status": 422,
  "detail": "/status: One of \"open\", \"closed\".",
  "instance": "/api/v1/forms/frm_8xQm2kVb0aTz",
  "errors": [{ "pointer": "/status", "detail": "One of \"open\", \"closed\"." }]
}
```

`errors[].pointer` is a JSON pointer into what you sent. A rejected submission's errors also carry `field` and `rule`. The `type` names the problem:

| Status | `type` ends in | When |
|---|---|---|
| 400 | `bad-json` | the body is not JSON |
| 401 | `unauthorized` | no key, or a revoked one |
| 403 | `cross-origin`, `session-required` | a cookie-authenticated write from another origin; an invite made with a key |
| 404 | `not-found` | no such form, version, submission or key in this workspace |
| 409 | `slug-taken`, `form-unpublished`, `form-closed`, `form-full` | a slug in use; a form that cannot take submissions |
| 415 | `unsupported-media-type` | a submission that is neither JSON nor a form encoding |
| 422 | `invalid-definition`, `invalid-request`, `invalid-submission` | a definition that does not render, a bad field, a broken rule |
| 413 | `too-large` | the body is over the limit |
| 429 | `rate-limited` | too many requests; wait `Retry-After` seconds |

## Rate limits

240 requests a minute per key (per person, for the session cookie). Each response carries `RateLimit-Limit` and `RateLimit-Remaining`; a `429` carries `Retry-After`. The public submission endpoint allows 10 submissions a minute per address (the socket's address; `X-Forwarded-For` is trusted only when the server runs with `TRUST_PROXY=1`). Bodies are capped: 256 KB for a submission, 1 MB elsewhere, `413 too-large` beyond.

## Forms

The form resource:

```json
{
  "id": "frm_8xQm2kVb0aTz",
  "slug": "beta-waitlist",
  "title": "Beta waitlist",
  "status": "open",
  "submission_limit": null,
  "published_version": 1,
  "has_unpublished_changes": false,
  "submission_count": 12,
  "created_at": "2026-10-18T09:12:00.000Z",
  "updated_at": "2026-10-18T09:14:31.000Z",
  "definition": { "schema": { "…": "…" } },
  "url": "http://localhost:3000/f/beta-waitlist",
  "preview_url": "http://localhost:3000/app/forms/frm_8xQm2kVb0aTz/preview"
}
```

| Method and path | Body | Answer |
|---|---|---|
| `GET /api/v1/forms` | — | `{ items }`, newest first, without `definition` |
| `POST /api/v1/forms` | `{ definition, slug? }` | `201` the form; `Location` header |
| `GET /api/v1/forms/:id` | — | the form |
| `PATCH /api/v1/forms/:id` | any of `definition`, `status` (`"open"`, `"closed"`), `submission_limit` (integer or `null`), `slug` | the form |
| `DELETE /api/v1/forms/:id` | — | `204`; its versions and submissions go too |

The `definition` is described in [form definitions](/docs/definitions). A slug is 3–64 lowercase letters, digits and dashes; leave it out and one is made from the title.

## Preview, validate, publish

| Method and path | Body | Answer |
|---|---|---|
| `POST /api/v1/preview` | `{ definition }` | `{ html, audit, rules }` for a definition that is not saved anywhere |
| `POST /api/v1/forms/:id/preview` | optional `{ definition }` | the same, for the form's draft (or the definition you send) |
| `POST /api/v1/forms/:id/validate` | `{ data }` | `{ valid, findings, data }` against the draft; nothing stored |
| `POST /api/v1/forms/:id/publish` | — | `201 { version, published_at, url }` |
| `GET /api/v1/forms/:id/versions` | — | `{ items: [{ version, published_at, live, submission_count }] }` |
| `GET /api/v1/forms/:id/versions/:n` | — | `{ version, published_at, definition }` |

`audit` is `{ passed, counts, findings }` (counts by severity): the accessibility and markup audit of the exact HTML the public page will serve. `rules` is the rules definition that page enforces and the server re-checks.

## Submissions

| Method and path | Answer |
|---|---|
| `GET /api/v1/forms/:id/submissions` | `{ items, total }`, newest first |
| `GET /api/v1/forms/:id/submissions/export?format=csv` | a CSV file: `id,submitted_at,version`, then one column per field |
| `GET /api/v1/forms/:id/submissions/export?format=json` | `{ form: { id, slug }, items }` |
| `GET /api/v1/submissions/:id` | one submission |
| `DELETE /api/v1/submissions/:id` | `204` |

A submission is `{ id, form_id, version, created_at, data }`. The list takes `q` (text anywhere in the answers), `version`, `since` and `until` (ISO 8601), `limit` (1–1000, default 50) and `offset`. Nested answers export as `group.field` columns and lists join with `; `.

## Public submissions

No key. This is what the public form posts to, and what an agent filling a form in on someone's behalf would call.

```bash
curl -s -X POST "$FORECRAFT_URL/api/v1/f/beta-waitlist/submissions" \
  -H "Content-Type: application/json" \
  -d '{ "data": { "email": "ada@example.com", "plan": "Solo" } }'
```

It takes JSON `{ "data": { … } }` or `application/x-www-form-urlencoded` / `multipart/form-data` with the field names the form uses (`contacts[0].name` for a repeatable row). The answer is `201 { id, created_at, thank_you, redirect }`. The server coerces the values, runs the form's rules, drops hidden and unknown fields, and stores what is left against the live version. A broken rule is a `422 invalid-submission` naming the `field` and the `rule`; an unpublished, closed or full form is a `409`.

## Workspace and keys

| Method and path | Body | Answer |
|---|---|---|
| `GET /api/v1/workspace` | — | `{ id, name, created_at }` |
| `PATCH /api/v1/workspace` | `{ name }` | the workspace |
| `GET /api/v1/workspace/members` | — | `{ members, invites }` |
| `POST /api/v1/workspace/invites` | `{ email }` | `201 { id, email, url }`; signed-in people only, not keys |
| `GET /api/v1/keys` | — | `{ items }` (never the secret) |
| `POST /api/v1/keys` | `{ name? }` | `201` the key with its `secret`, shown this once; signed-in people only, not keys |
| `DELETE /api/v1/keys/:id` | — | `204`; the key stops working at once; signed-in people only, not keys |
| `GET /api/v1/vocabulary` | — | `{ themes, accents, layouts, schemes, appearance_defaults }` |

## Outside `/api/v1`

- `GET /f/:slug`: the public form, latest published version.
- `GET /health`: `{ "ok": true }`.
- `GET /llms.txt` and `GET /openapi.json`: this reference, for machines.
