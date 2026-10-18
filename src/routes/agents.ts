// Machine-readable descriptions for agents: /openapi.json and /llms.txt.
import { Hono } from "hono";
import type { Env } from "../api/http.ts";
import { openapi } from "../api/openapi.ts";

export function agentRoutes() {
  const app = new Hono<Env>();

  app.get("/openapi.json", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(openapi(new URL(c.req.url).origin));
  });

  app.get("/llms.txt", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.text(llmsTxt(new URL(c.req.url).origin));
  });

  return app;
}

/** llmstxt.org: an H1, a blockquote summary, then sections of links. */
export function llmsTxt(origin: string): string {
  const exampleDefinition = JSON.stringify({
    definition: {
      schema: {
        title: "Contact", type: "object",
        properties: {
          email: { type: "string", format: "email", title: "Email" },
          message: { type: "string", title: "Message", minLength: 10 },
        },
        required: ["email", "message"],
      },
      ui: { message: { widget: "textarea", rows: 5 } },
      appearance: { theme: "nordic", submitLabel: "Send" },
    },
    slug: "contact-demo",
  });
  return `# forecraft

> forecraft is a form platform whose first user is an AI agent. A form is one JSON document (a JSON Schema plus UI, rules and appearance). You create it, preview and audit the rendered page, publish it to a public URL and read the submissions, all through a REST API (OpenAPI 3.1) or an MCP server. It also prints reports and documents (invoices, letters, confirmations) to A4 or Letter PDFs from one JSON definition, with gapless numbering and preflight checks. A designer exists for people, but everything it does goes through the same API.

## Docs

- [For agents](${origin}/for-agents): what forecraft is and how an agent should drive it
- [Agent guide](${origin}/docs/for-agents): the definition format, rules and the create, preview, publish loop
- [MCP server](${origin}/docs/mcp): install line, environment variables, every tool and resource
- [Reports and documents](${origin}/docs/reports): report definitions, blocks, starters, numbering, preflight, issuing and voiding PDFs
- [Report style guide](${origin}/docs/report-style): how to choose a theme, accent, paper and type pairing so a document looks right
- [Docs index](${origin}/docs): all documentation

## API

- [OpenAPI 3.1 document](${origin}/openapi.json): every route under ${origin}/api/v1, with schemas and problem+json errors
- [Vocabulary](${origin}/api/v1/vocabulary): valid themes, accents and layouts for a definition's appearance (needs a bearer key)
- [Report vocabulary](${origin}/api/v1/vocabulary/reports): every block with an example, helpers, print themes, type pairings, locales and preflight codes (needs a bearer key)

## Quick start

Authenticate with \`Authorization: Bearer fc_live_…\` (create a key in the dashboard under API keys). Errors are application/problem+json; a rejected definition lists \`errors[]\` with a JSON pointer per fault.

\`\`\`sh
export FORECRAFT_API_KEY=fc_live_…
API=${origin}/api/v1

# 1. create a draft (definition = { schema, ui?, rules?, appearance? })
curl -sX POST $API/forms -H "Authorization: Bearer $FORECRAFT_API_KEY" -H "Content-Type: application/json" \\
  -d '${exampleDefinition}'

# 2. render and audit it (returns { html, audit, rules }; fix audit.counts.error before publishing)
curl -sX POST $API/forms/frm_…/preview -H "Authorization: Bearer $FORECRAFT_API_KEY"

# 3. publish: the public page is ${origin}/f/<slug>
curl -sX POST $API/forms/frm_…/publish -H "Authorization: Bearer $FORECRAFT_API_KEY"

# 4. people submit (no key needed)
curl -sX POST $API/f/contact-demo/submissions -H "Content-Type: application/json" \\
  -d '{"data":{"email":"ada@example.com","message":"Hello from curl, please reply."}}'

# 5. read the answers (also: /submissions/export?format=csv)
curl -s "$API/forms/frm_…/submissions?limit=20" -H "Authorization: Bearer $FORECRAFT_API_KEY"
\`\`\`

## Issue your first invoice

A report is one JSON definition printed as an A4 or Letter PDF; start from a starter and choose the look from curated values (theme, one dark accent hex, paper, type pairing), never sizes or colours.

\`\`\`sh
# 1. see the starters (invoice, letter, business-report, confirmation, survey-summary, blank)
curl -s $API/report-starters -H "Authorization: Bearer $FORECRAFT_API_KEY"

# 2. create from invoice with your company and accent (returns the report, id rpt_…, with its definition)
curl -sX POST $API/reports -H "Authorization: Bearer $FORECRAFT_API_KEY" -H "Content-Type: application/json" \\
  -d '{"starter":"invoice","title":"Invoice","appearance":{"accent":"#7c2d12"},"sample":{"seller":{"name":"Quayside Logistics Ltd"}}}'

# 3. preview: read findings[] (fix every severity "error"), then look at images[] (base64 PNG pages)
curl -sX POST $API/reports/rpt_…/preview -H "Authorization: Bearer $FORECRAFT_API_KEY"

# 4. publish: documents are issued from the published version
curl -sX POST $API/reports/rpt_…/publish -H "Authorization: Bearer $FORECRAFT_API_KEY"

# 5. issue with your JSON data (shaped like the definition's "sample"): you get number, pdf_url and share_url
curl -sX POST $API/reports/rpt_…/documents -H "Authorization: Bearer $FORECRAFT_API_KEY" -H "Content-Type: application/json" \\
  -d '{"issue":true,"data":{…}}'

# 6. an issued document is immutable; cancel it with a reason (it keeps its number and prints VOID), then issue a new one
curl -sX POST $API/documents/doc_…/void -H "Authorization: Bearer $FORECRAFT_API_KEY" -H "Content-Type: application/json" \\
  -d '{"reason":"Issued to the wrong entity"}'
\`\`\`

With MCP the same loop is forecraft_list_report_starters, forecraft_create_report, forecraft_preview_report (returns the findings and the pages as images), forecraft_publish_report, forecraft_issue_document and forecraft_void_document. Upload a logo with forecraft_upload_asset and set \`appearance.logo\` to the returned \`asset:ast_…\` ref. Bad data is a 422 \`invalid-data\` with a pointer per fault; a full renderer is a 503 \`renderer-busy\` with \`Retry-After\`.

## MCP

Add to \`.mcp.json\` (the server is \`packages/mcp/index.mjs\` in the forecraft repository, plain Node, no dependencies):

\`\`\`json
{ "mcpServers": { "forecraft": { "command": "node", "args": ["packages/mcp/index.mjs"], "env": { "FORECRAFT_URL": "${origin}", "FORECRAFT_API_KEY": "\${FORECRAFT_API_KEY}" } } } }
\`\`\`

Or with the Claude Code CLI: \`claude mcp add forecraft -e FORECRAFT_URL=${origin} -e FORECRAFT_API_KEY=fc_live_… -- node packages/mcp/index.mjs\`

Tools: forecraft_create_form, forecraft_update_form, forecraft_get_form, forecraft_list_forms, forecraft_publish_form, forecraft_preview_form, forecraft_list_submissions, forecraft_get_submission, forecraft_export_submissions, forecraft_validate_submission, forecraft_get_vocabulary, forecraft_get_report_vocabulary, forecraft_list_report_starters, forecraft_create_report, forecraft_update_report, forecraft_get_report, forecraft_list_reports, forecraft_preview_report, forecraft_publish_report, forecraft_issue_document, forecraft_list_documents, forecraft_get_document, forecraft_void_document, forecraft_upload_asset. Resource templates: forecraft://form/{id}, forecraft://report/{id}, forecraft://document/{id} (metadata and data as JSON, plus the PDF).
`;
}
