# forecraft

Forms for the agentic era. An agent creates, previews, publishes and reads forms
through a REST API or an MCP server; people do the same through a dashboard and a
drag-and-drop designer; everyone else fills the forms in. Every pixel is Faqir UI 1.2.5.

One form is one JSON document — `{ schema, ui, rules, appearance }` — that the API
accepts, the designer edits and `@faqir-ui/forms` renders. The server re-checks every
submission with `@faqir-ui/rules` on the same definition the browser enforced.

## Run it

```bash
npm install
npm run seed     # demo workspace, four forms, prints a demo API key once
npm run dev      # http://localhost:3000 (node --watch; templates reload)
```

`npm start` runs without watching. The database is `data/forecraft.db` (override with
`FORECRAFT_DB`), the port 3000 (`PORT`).

## For agents

- `GET /llms.txt`, `GET /openapi.json`, `/for-agents`, `docs/for-agents.md` (the exact curl sequence).
- MCP: `node packages/mcp/index.mjs` over stdio with `FORECRAFT_URL` and `FORECRAFT_API_KEY`
  (already in `.mcp.json`); tools `forecraft_create_form`, `…_preview_form`, `…_publish_form`, … — see `docs/mcp.md`.

## Checks

```bash
npm run check      # typecheck + faqir audit of every page + unit/API tests
npm run test:e2e   # Playwright (Chromium), its own server and database
node scripts/screenshots.ts   # docs/screenshots/
```

## Layout

`src/` server (Hono, `node:sqlite`, `src/forms/model.ts` is the form model) ·
`templates/` `.faqir` pages · `public/` `app.css`, `form.js`, `designer.js`, `app.js` ·
`ui/` Faqir-owned files · `packages/mcp/` the MCP server · `tests/` · `docs/`.

`FAQIR-UPSTREAM.md` records every rough edge found in Faqir while building this, and
`docs/faqir-digest.md` the ten worth fixing first.
