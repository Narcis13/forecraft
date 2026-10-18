import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.ts";
import { openDb, type DB } from "../../src/db/index.ts";
import { compileForm } from "../../src/forms/model.ts";
import { docMeta, renderMarkdown } from "../../src/routes/marketing.ts";

const DOCS = join(import.meta.dirname, "../../docs");

describe("marketing site", () => {
  let dir: string;
  let db: DB;
  let app: ReturnType<typeof createApp>;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "forecraft-marketing-"));
    db = openDb(join(dir, "test.db"));
    app = createApp(db);
  });
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const res = await app.request(path);
    return { status: res.status, type: res.headers.get("content-type") ?? "", html: await res.text() };
  };

  test("/ is the landing page", async () => {
    const r = await get("/");
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/html/);
    assert.match(r.html, /data-skin="midnight"/);
    assert.match(r.html, /<h1 data-part="headline" id="hero-headline">[\s\S]*agent[\s\S]*can build\./);
    for (const part of ['data-ui="site-header"', 'data-ui="hero"', 'data-ui="bento"', 'data-ui="logo-cloud"',
      'data-ui="testimonials"', 'data-ui="faq"', 'data-ui="cta"', 'data-ui="site-footer"', 'data-ui="marquee"']) {
      assert.ok(r.html.includes(part), `landing has ${part}`);
    }
    assert.match(r.html, /href="\/signup"/);
    assert.match(r.html, /href="\/for-agents"/);
    // the agent's first call, escaped as text
    assert.match(r.html, /curl -s &quot;|curl -s "\$FORECRAFT_URL\/api\/v1\/forms"/);
    assert.match(r.html, /forecraft_create_form/);
    assert.match(r.html, /<a data-part="link" href="\/" data-state="active" aria-current="page">Product<\/a>/);
    assert.doesNotMatch(r.html, /\sclass=/);
  });

  test("/pricing has one live tier and two coming soon", async () => {
    const r = await get("/pricing");
    assert.equal(r.status, 200);
    assert.match(r.html, /data-ui="pricing"/);
    assert.match(r.html, /Prototype/);
    assert.equal(r.html.match(/Coming soon/g)?.length, 4); // a badge and a button on each
    assert.match(r.html, /No billing exists/);
    assert.match(r.html, /href="\/pricing" data-state="active" aria-current="page"/);
  });

  test("/for-agents says how to get a key and how to connect", async () => {
    const r = await get("/for-agents");
    assert.equal(r.status, 200);
    for (const s of ["/signup", "npm run seed", "/llms.txt", "/openapi.json", "/docs/for-agents", "/docs/mcp",
      "packages/mcp/index.mjs", "FORECRAFT_URL", "FORECRAFT_API_KEY", "fc_live_", "forecraft_preview_form"]) {
      assert.ok(r.html.includes(s), `for-agents mentions ${s}`);
    }
    assert.match(r.html, /&quot;mcpServers&quot;|"mcpServers"/);
  });

  test("/docs lists every docs page by its first heading", async () => {
    const r = await get("/docs");
    assert.equal(r.status, 200);
    for (const [slug, title] of [["getting-started", "Getting started"], ["for-agents", "The curl sequence"],
      ["definitions", "Form definitions"], ["rules", "Rules"], ["api", "API reference"]]) {
      assert.ok(r.html.includes(`href="/docs/${slug}"`), `docs index links ${slug}`);
      assert.ok(r.html.includes(`>${title}</a>`), `docs index titles ${slug} "${title}"`);
    }
  });

  test("/docs/:slug renders each markdown file", async () => {
    const slugs = readdirSync(DOCS).filter((f) => f.endsWith(".md") && f !== "faqir-digest.md").map((f) => f.slice(0, -3));
    assert.ok(slugs.includes("api"));
    for (const slug of slugs) {
      const r = await get(`/docs/${slug}`);
      assert.equal(r.status, 200, slug);
      const { title } = docMeta(readFileSync(join(DOCS, `${slug}.md`), "utf8"), slug);
      assert.ok(r.html.includes(`<h1 id="doc-title">`), `${slug} has its title`);
      assert.ok(r.html.includes(`aria-current="page">${title.replace(/&/g, "&amp;")}</a>`), `${slug} is current in the docs nav`);
      assert.doesNotMatch(r.html, /\sclass=/, `${slug} carries no class attribute`);
    }
    const api = await get("/docs/api");
    assert.match(api.html, /POST \/api\/v1\/forms\/:id\/publish/);
  });

  test("/docs/:slug refuses unknown and unsafe names", async () => {
    assert.equal((await get("/docs/no-such-page")).status, 404);
    assert.equal((await get("/docs/..%2Fpackage")).status, 404);
    assert.equal((await get("/docs/Getting-Started")).status, 404);
  });
});

describe("docs content", () => {
  test("every full form definition in the docs compiles", () => {
    let n = 0;
    for (const file of readdirSync(DOCS).filter((f) => f.endsWith(".md"))) {
      const md = readFileSync(join(DOCS, file), "utf8");
      for (const m of md.matchAll(/```json\n([\s\S]*?)```/g)) {
        let json: { schema?: { title?: unknown } };
        try { json = JSON.parse(m[1]!); } catch { continue; }
        if (typeof json.schema?.title !== "string") continue;
        assert.doesNotThrow(() => compileForm(json), `${file}: "${json.schema.title}"`);
        n++;
      }
    }
    assert.ok(n >= 5, `found ${n} definitions`);
  });

  test("the curl sequence's definition compiles", () => {
    const md = readFileSync(join(DOCS, "for-agents.md"), "utf8");
    const body = /-d '(\{\n    "definition"[\s\S]*?\n  \})'\)/.exec(md);
    assert.ok(body, "for-agents.md has the create body");
    assert.doesNotThrow(() => compileForm(JSON.parse(body![1]!).definition));
  });

  test("markdown renders without class attributes, with heading ids and scrollable tables", () => {
    const html = renderMarkdown("# Title\n\n## A section\n\n## A section\n\n```bash\necho <hi>\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    assert.match(html, /<h1 id="doc-title">Title<\/h1>/);
    assert.match(html, /<h2 id="a-section">/);
    assert.match(html, /<h2 id="a-section-2">/);
    assert.match(html, /<pre data-lang="bash"><code>echo &lt;hi&gt;<\/code><\/pre>/);
    assert.match(html, /<div role="region" tabindex="0" aria-label="Table: a, b">/);
    assert.match(html, /<th scope="col">a<\/th>/);
    assert.doesNotMatch(html, /class=/);
  });
});
