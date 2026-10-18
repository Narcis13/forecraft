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

> forecraft is a form platform whose first user is an AI agent. A form is one JSON document (a JSON Schema plus UI, rules and appearance). You create it, preview and audit the rendered page, publish it to a public URL and read the submissions, all through a REST API (OpenAPI 3.1) or an MCP server. A designer exists for people, but everything it does goes through the same API.

## Docs

- [For agents](${origin}/for-agents): what forecraft is and how an agent should drive it
- [Agent guide](${origin}/docs/for-agents): the definition format, rules and the create, preview, publish loop
- [MCP server](${origin}/docs/mcp): install line, environment variables, every tool and resource
- [Docs index](${origin}/docs): all documentation

## API

- [OpenAPI 3.1 document](${origin}/openapi.json): every route under ${origin}/api/v1, with schemas and problem+json errors
- [Vocabulary](${origin}/api/v1/vocabulary): valid themes, accents and layouts for a definition's appearance (needs a bearer key)

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

## MCP

Add to \`.mcp.json\` (the server is \`packages/mcp/index.mjs\` in the forecraft repository, plain Node, no dependencies):

\`\`\`json
{ "mcpServers": { "forecraft": { "command": "node", "args": ["packages/mcp/index.mjs"], "env": { "FORECRAFT_URL": "${origin}", "FORECRAFT_API_KEY": "\${FORECRAFT_API_KEY}" } } } }
\`\`\`

Or with the Claude Code CLI: \`claude mcp add forecraft -e FORECRAFT_URL=${origin} -e FORECRAFT_API_KEY=fc_live_… -- node packages/mcp/index.mjs\`

Tools: forecraft_create_form, forecraft_update_form, forecraft_get_form, forecraft_list_forms, forecraft_publish_form, forecraft_preview_form, forecraft_list_submissions, forecraft_get_submission, forecraft_export_submissions, forecraft_validate_submission, forecraft_get_vocabulary. Resource template: forecraft://form/{id}.
`;
}
