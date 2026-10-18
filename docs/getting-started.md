# Getting started

forecraft is a form platform whose first user is an agent. An agent creates a form, previews it, publishes it and reads the answers through a REST API or an MCP server; a person can do all of the same in the dashboard and the drag-and-drop designer. People fill in the published form at `/f/<slug>`.

## The idea in one paragraph

A form is **one JSON document**, the [definition](/docs/definitions): a JSON Schema for the data, a UI schema for the widgets, optional [rules](/docs/rules) for cross-field logic, and an appearance (theme, accent, layout, cover, thank-you). The same document is what the API accepts and returns, what the designer edits, and what the public page renders. The rules the browser enforces are re-checked by the server before anything is stored, with the same evaluator, so the server's verdict is the browser's verdict.

## Run it locally

forecraft is one Node process and one SQLite file. You need Node 24.

```bash
npm install
npm run seed     # a demo workspace, four published forms, and an API key (printed once)
npm start        # http://localhost:3000
```

The seed prints the demo account's email and password and an API key that starts with `fc_live_`. Keep the key: it is stored hashed and shown only once. Run the seed again for a new key.

## Get a key on a running instance

1. Sign up at [/signup](/signup). Your account gets a workspace.
2. In the dashboard, open **API keys** and create a key. Name it after the agent that will hold it.
3. Copy the secret. It is shown once; revoke the key and make another if you lose it.

Every API request carries it as a bearer token:

```bash
curl -s "$FORECRAFT_URL/api/v1/forms" -H "Authorization: Bearer $FORECRAFT_API_KEY"
```

## Your first form

The shortest useful definition is a title and one field:

```json
{
  "schema": {
    "title": "Quick question",
    "type": "object",
    "properties": {
      "answer": { "type": "string", "title": "What should we build next?" }
    },
    "required": ["answer"]
  }
}
```

Send it as `{ "definition": … }` to `POST /api/v1/forms`, preview it with `POST /api/v1/forms/:id/preview`, and publish it with `POST /api/v1/forms/:id/publish`. [The curl sequence](/docs/for-agents) walks the whole loop, submissions and export included.

## Connect an agent over MCP

The MCP server lives in `packages/mcp` and speaks stdio. Add it to your host's `.mcp.json`:

```json
{
  "mcpServers": {
    "forecraft": {
      "command": "node",
      "args": ["packages/mcp/index.mjs"],
      "env": { "FORECRAFT_URL": "http://localhost:3000", "FORECRAFT_API_KEY": "fc_live_…" }
    }
  }
}
```

Its tools and resources are in [the MCP docs](/docs/mcp).

## Where to go next

- [The curl sequence](/docs/for-agents): create, preview, publish, submit, list, export.
- [Form definitions](/docs/definitions): every key of the JSON document.
- [Rules](/docs/rules): show, require, validate, compute and jump.
- [API reference](/docs/api): every endpoint, error and limit.
- For machines: [/llms.txt](/llms.txt) and [/openapi.json](/openapi.json).
