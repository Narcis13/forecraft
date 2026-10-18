# The curl sequence

Everything an agent with only an API key needs, in order: create a form, preview it, publish it, open it, submit to it as a person would, then list and export the answers. Each step is one `curl`; `jq` carries the form's id and slug from one step to the next.

You need `curl`, `jq` and two environment variables. Get a key from the dashboard (API keys) or, locally, from `npm run seed`.

```bash
export FORECRAFT_URL=http://localhost:3000
export FORECRAFT_API_KEY=fc_live_…
```

## 0. Check the key

```bash
curl -s "$FORECRAFT_URL/api/v1/forms" \
  -H "Authorization: Bearer $FORECRAFT_API_KEY" | jq '.items | length'
```

A number means the key works. A `401` with `application/problem+json` means it does not.

## 1. Create a form

The body is `{ definition, slug? }`. Leave `slug` out and one is made from the title (with a short random suffix), so the sequence can run twice. The definition below has three fields and two rules: `seats` is shown, and required, only for the Team plan.

```bash
FORM=$(curl -s -X POST "$FORECRAFT_URL/api/v1/forms" \
  -H "Authorization: Bearer $FORECRAFT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "definition": {
      "schema": {
        "title": "Beta waitlist",
        "description": "Two questions. We write back within a day.",
        "type": "object",
        "properties": {
          "email": { "type": "string", "format": "email", "title": "Work email" },
          "plan": { "type": "string", "title": "Plan", "enum": ["Solo", "Team"] },
          "seats": { "type": "integer", "title": "Seats", "minimum": 2, "maximum": 50 }
        },
        "required": ["email", "plan"]
      },
      "rules": {
        "rules": [
          { "id": "seats-for-teams", "show": "seats", "when": { "==": [{ "var": "plan" }, "Team"] } },
          { "id": "seats-required-for-teams", "require": "seats", "when": { "==": [{ "var": "plan" }, "Team"] } }
        ]
      },
      "appearance": { "theme": "aurora", "submitLabel": "Join the waitlist" }
    }
  }')
FORM_ID=$(echo "$FORM" | jq -r .id)
SLUG=$(echo "$FORM" | jq -r .slug)
echo "$FORM_ID $SLUG"
```

`201 Created` returns the form resource: `id`, `slug`, `title`, `status`, `published_version` (`null` until you publish), `has_unpublished_changes`, `submission_count`, `definition`, `url` and `preview_url`. A definition that does not render is a `422` whose `errors[].pointer` says where, for example `/schema/properties/plan`.

## 2. Preview it

```bash
curl -s -X POST "$FORECRAFT_URL/api/v1/forms/$FORM_ID/preview" \
  -H "Authorization: Bearer $FORECRAFT_API_KEY" | jq '.audit.passed, .audit.counts'
```

The response is `{ html, audit: { passed, counts, findings }, rules }`: the exact HTML the public page will carry, its accessibility audit, and the rules definition the server will enforce. Publish when `passed` is `true`. To try a change without saving it, send `{"definition": {…}}` as the body; nothing is stored.

## 3. Publish it

```bash
URL=$(curl -s -X POST "$FORECRAFT_URL/api/v1/forms/$FORM_ID/publish" \
  -H "Authorization: Bearer $FORECRAFT_API_KEY" | jq -r .url)
echo "$URL"
```

Publishing snapshots the draft as version 1 and answers `{ version, published_at, url }`. The public URL always serves the latest published version; later edits stay in the draft until you publish again.

## 4. Open the public URL

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$FORECRAFT_URL/f/$SLUG"
```

`200` once published. Before the first publish it is `404`. Send the URL to the people who should fill it in.

## 5. Submit, as a person would

The public submission endpoint needs no key. It takes JSON `{ "data": { … } }` or a form encoding, exactly like the page sends.

```bash
curl -s -X POST "$FORECRAFT_URL/api/v1/f/$SLUG/submissions" \
  -H "Content-Type: application/json" \
  -d '{ "data": { "email": "ada@example.com", "plan": "Team", "seats": 5 } }' | jq .
```

`201` returns `{ id, created_at, thank_you, redirect }`. Now break a rule on purpose: a Team plan with no seats.

```bash
curl -s -X POST "$FORECRAFT_URL/api/v1/f/$SLUG/submissions" \
  -H "Content-Type: application/json" \
  -d '{ "data": { "email": "grace@example.com", "plan": "Team" } }' | jq '.status, .errors'
```

The server runs the same rules the browser ran and answers `422` with a problem whose `errors[0]` has `"field": "seats"` and `"rule": "required"`. A closed, full or unpublished form answers `409`; too many submissions from one address, `429`.

## 6. List the submissions

```bash
curl -s "$FORECRAFT_URL/api/v1/forms/$FORM_ID/submissions" \
  -H "Authorization: Bearer $FORECRAFT_API_KEY" | jq '.total, .items[0].data'
```

`{ items, total }`, newest first. Each item is `{ id, form_id, version, created_at, data }`. Filter with `?q=` (text in the answers), `?version=`, `?since=` and `?until=` (ISO dates), and page with `?limit=` (default 50) and `?offset=`.

## 7. Export them

```bash
curl -s "$FORECRAFT_URL/api/v1/forms/$FORM_ID/submissions/export?format=csv" \
  -H "Authorization: Bearer $FORECRAFT_API_KEY"
```

One row per submission: `id,submitted_at,version`, then one column per field (`email,plan,seats`). Use `format=json` for `{ form, items }` instead.

## Afterwards

- Change the form: `PATCH /api/v1/forms/$FORM_ID` with `{ "definition": … }`, then publish again.
- Close it: `PATCH` with `{ "status": "closed" }`, or cap it with `{ "submission_limit": 100 }`.
- Read one answer: `GET /api/v1/submissions/:id`. Delete one: `DELETE` the same path.

The whole API is in [the API reference](/docs/api); the same steps as MCP tools are in [the MCP docs](/docs/mcp).
