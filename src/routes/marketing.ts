// Marketing site: /, /pricing, /docs, /docs/:slug, /for-agents.
//
// Pages are `.faqir` templates under templates/pages/marketing/. The docs are
// markdown files under docs/, read on each request (they are small), so a page
// that lands in docs/ — docs/mcp.md, say — is served without a restart.

import { Hono } from "hono";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked, type Tokens } from "marked";
import type { Env } from "../api/http.ts";
import { page } from "../render/index.ts";

const DOCS_DIR = join(import.meta.dirname, "../../docs");

/** The one theme the marketing site wears (ui/themes/<SKIN>.scoped.css). */
export const SKIN = "midnight";

/** Docs in reading order; any other docs/*.md follows, alphabetically. */
const DOC_ORDER = ["getting-started", "for-agents", "definitions", "rules", "api", "mcp"];
/** Markdown in docs/ that is not a docs page (project notes). */
const NOT_DOCS = new Set(["faqir-digest"]);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// ── Code samples (rendered as text, escaped by the template) ──────────────

const CURL_CREATE = `curl -s "$FORECRAFT_URL/api/v1/forms" \\
  -H "Authorization: Bearer $FORECRAFT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "slug": "beta-waitlist",
    "definition": {
      "schema": {
        "title": "Beta waitlist",
        "type": "object",
        "properties": {
          "email": { "type": "string", "format": "email" },
          "plan": { "type": "string", "enum": ["Solo", "Team"] }
        },
        "required": ["email", "plan"]
      },
      "appearance": { "theme": "aurora" }
    }
  }'`;

const MCP_SESSION = `> Make a waitlist for the beta and publish it.

forecraft_create_form   slug "beta-waitlist", 2 fields, theme aurora
forecraft_preview_form  audit passed: 0 errors, 0 warnings
forecraft_publish_form  version 1 is live
                        http://localhost:3000/f/beta-waitlist

> Who signed up today?

forecraft_list_submissions  3 new: 2 Solo, 1 Team`;

const CREATED = `HTTP/1.1 201 Created
Location: /api/v1/forms/frm_8xQm2kVb0aTz

{
  "id": "frm_8xQm2kVb0aTz",
  "slug": "beta-waitlist",
  "title": "Beta waitlist",
  "status": "open",
  "published_version": null,
  "has_unpublished_changes": true,
  "submission_count": 0,
  "url": "http://localhost:3000/f/beta-waitlist",
  "preview_url": "http://localhost:3000/app/forms/frm_8xQm2kVb0aTz/preview",
  "definition": { "schema": { … }, "appearance": { "theme": "aurora" } }
}`;

const MCP_JSON = `{
  "mcpServers": {
    "forecraft": {
      "command": "node",
      "args": ["packages/mcp/index.mjs"],
      "env": {
        "FORECRAFT_URL": "http://localhost:3000",
        "FORECRAFT_API_KEY": "fc_live_…"
      }
    }
  }
}`;

const ENV = `export FORECRAFT_URL=http://localhost:3000
export FORECRAFT_API_KEY=fc_live_…`;

const SEED = `npm install
npm run seed     # prints a demo key once: fc_live_…
npm start        # http://localhost:3000`;

const FIRST_CALL = `curl -s "$FORECRAFT_URL/api/v1/forms" \\
  -H "Authorization: Bearer $FORECRAFT_API_KEY"`;

const MCP_TOOLS = [
  { name: "forecraft_create_form", does: "Create a form from a definition." },
  { name: "forecraft_update_form", does: "Replace the draft definition, status, limit or slug." },
  { name: "forecraft_get_form", does: "Read one form, its definition and its public URL." },
  { name: "forecraft_list_forms", does: "List the workspace's forms." },
  { name: "forecraft_preview_form", does: "Render the form and audit it: HTML, findings, rules." },
  { name: "forecraft_publish_form", does: "Snapshot the draft as a version; the public URL serves it." },
  { name: "forecraft_list_submissions", does: "Read answers, filtered by text, version or date." },
  { name: "forecraft_get_submission", does: "Read one submission." },
];

// ── Docs ──────────────────────────────────────────────────────────────────

interface DocEntry { slug: string; title: string; summary: string; href: string }

/** Every docs page on disk, in reading order, with its title and first paragraph. */
function listDocs(): DocEntry[] {
  if (!existsSync(DOCS_DIR)) return [];
  const slugs = readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((s) => SLUG.test(s) && !NOT_DOCS.has(s));
  const rank = (s: string) => (DOC_ORDER.includes(s) ? DOC_ORDER.indexOf(s) : DOC_ORDER.length);
  slugs.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return slugs.map((slug) => {
    const { title, summary } = docMeta(readFileSync(join(DOCS_DIR, `${slug}.md`), "utf8"), slug);
    return { slug, title, summary, href: `/docs/${slug}` };
  });
}

/** The first `# ` heading and the first paragraph of plain text after it. */
export function docMeta(md: string, slug: string): { title: string; summary: string } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const h1 = lines.findIndex((l) => /^# \S/.test(l));
  const title = h1 >= 0 ? lines[h1]!.slice(2).trim() : slug;
  let summary = "";
  for (let i = h1 + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l) { if (summary) break; continue; }
    if (/^(#|```|[-*>|]|\d+\.)/.test(l)) { if (summary) break; continue; }
    summary += (summary ? " " : "") + l;
  }
  summary = summary.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*_]/g, "");
  if (summary.length > 180) summary = summary.slice(0, 177).replace(/\s+\S*$/, "") + "…";
  return { title, summary };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Markdown → HTML for the docs. Faqir markup rules apply to the output too: no
 * `class` on code blocks (marked writes `class="language-x"`), headings carry
 * ids for deep links, and a table sits in a focusable, labelled region so a
 * wide one scrolls on a phone instead of widening the page.
 */
export function renderMarkdown(md: string): string {
  const used = new Set<string>(["main"]);
  const marked = new Marked({
    gfm: true,
    renderer: {
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? "").match(/^[\w-]+/)?.[0];
        return `<pre${language ? ` data-lang="${escapeHtml(language)}"` : ""}><code>${escapeHtml(text)}</code></pre>\n`;
      },
      heading({ tokens, depth, text }: Tokens.Heading) {
        let id = text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[`*_]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
        let n = 2;
        const base = id;
        while (used.has(id)) id = `${base}-${n++}`;
        used.add(id);
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td") => {
          const scope = tag === "th" ? ' scope="col"' : "";
          return `<${tag}${scope}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        const head = `<tr>${token.header.map((c) => cell(c, "th")).join("")}</tr>`;
        const body = token.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("\n");
        const label = token.header.map((c) => c.text).join(", ");
        return `<div role="region" tabindex="0" aria-label="Table: ${escapeHtml(label)}">\n<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>\n</div>\n`;
      },
    },
  });
  return marked.parse(md, { async: false }) as string;
}

// ── Routes ────────────────────────────────────────────────────────────────

const base = (title: string, description: string, extra: Record<string, unknown> = {}) => ({
  page: { skin: SKIN, scheme: "dark", title, description, ...extra },
});

export function marketingRoutes() {
  const app = new Hono<Env>();

  app.get("/", (c) => c.html(page("pages/marketing/landing.faqir", base(
    "forecraft — forms your agent can build",
    "forecraft is a form platform with a REST API and an MCP server. Your agent creates, previews and publishes the form, then reads the answers.",
    { code: { curl: CURL_CREATE, mcp: MCP_SESSION, response: CREATED } },
  ))));

  app.get("/pricing", (c) => c.html(page("pages/marketing/pricing.faqir", base(
    "Pricing — forecraft",
    "forecraft is a prototype: one free tier, everything on, no billing.",
  ))));

  app.get("/for-agents", (c) => c.html(page("pages/marketing/for-agents.faqir", base(
    "For agents — forecraft",
    "How an agent gets a forecraft API key, installs the MCP server and ships its first form.",
    { code: { env: ENV, seed: SEED, mcp: MCP_JSON, first: FIRST_CALL, create: CURL_CREATE }, tools: MCP_TOOLS },
  ))));

  app.get("/docs", (c) => c.html(page("pages/marketing/docs-index.faqir", base(
    "Docs — forecraft",
    "The forecraft docs: getting started, the form definition, rules, the REST API and the MCP server.",
    { docs: listDocs() },
  ))));

  app.get("/docs/:slug", (c) => {
    const slug = c.req.param("slug");
    const file = join(DOCS_DIR, `${slug}.md`);
    if (!SLUG.test(slug) || NOT_DOCS.has(slug) || !existsSync(file)) return c.notFound();
    const md = readFileSync(file, "utf8");
    const { title, summary } = docMeta(md, slug);
    const docs = listDocs().map((d) => ({ ...d, current: d.slug === slug }));
    const i = docs.findIndex((d) => d.slug === slug);
    return c.html(page("pages/marketing/doc.faqir", base(`${title} — forecraft docs`, summary || title, {
      docs,
      doc: { slug, title, html: renderMarkdown(md) },
      prev: docs[i - 1] ?? null,
      next: docs[i + 1] ?? null,
    })));
  });

  return app;
}
