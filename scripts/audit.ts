// `npm run audit`: render every page the server emits — against a fresh,
// seeded temporary database — and run `faqir audit` over each one. Errors (and
// criticals) fail the run; warnings are listed so PROGRESS.md can give a reason.
//
// The rendered pages are also written to test-results/audit/ for inspection.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db/index.ts";
import { auditHtml } from "../src/forms/page.ts";
import { seedDemo } from "../src/seed.ts";
import { createSession } from "../src/auth/index.ts";
import { listForms } from "../src/forms/store.ts";
import { seedReports } from "../src/seed-reports-run.ts";
import { closeBrowser } from "../src/reports/pdf.ts";

const dir = mkdtempSync(join(tmpdir(), "forecraft-audit-"));
const db = openDb(join(dir, "audit.db"));
const app = createApp(db);
const demo = await seedDemo(db, { quiet: true });
const cookie = `fc_session=${createSession(db, demo.userId, demo.workspaceId)}`;
const forms = listForms(db, demo.workspaceId);
const seeded = await seedReports(db, demo.workspaceId, { quiet: true });

const pages: { name: string; path: string; auth?: boolean }[] = [
  { name: "landing", path: "/" },
  { name: "pricing", path: "/pricing" },
  { name: "for-agents", path: "/for-agents" },
  { name: "docs", path: "/docs" },
  { name: "docs-api", path: "/docs/api" },
  { name: "signin", path: "/signin" },
  { name: "signup", path: "/signup" },
  { name: "not-found", path: "/no-such-page" },
  { name: "app-forms", path: "/app", auth: true },
  { name: "app-keys", path: "/app/keys", auth: true },
  { name: "app-settings", path: "/app/settings", auth: true },
];
for (const f of forms) {
  pages.push({ name: `form-${f.slug}`, path: `/f/${f.slug}` });
  pages.push({ name: `app-form-${f.slug}`, path: `/app/forms/${f.id}`, auth: true });
  pages.push({ name: `app-submissions-${f.slug}`, path: `/app/forms/${f.id}/submissions`, auth: true });
  pages.push({ name: `app-share-${f.slug}`, path: `/app/forms/${f.id}/share`, auth: true });
  pages.push({ name: `app-settings-${f.slug}`, path: `/app/forms/${f.id}/settings`, auth: true });
  pages.push({ name: `app-versions-${f.slug}`, path: `/app/forms/${f.id}/versions`, auth: true });
  pages.push({ name: `app-preview-${f.slug}`, path: `/app/forms/${f.id}/preview`, auth: true });
}
if (forms[0]) pages.push({ name: "designer", path: `/app/forms/${forms[0].id}/design`, auth: true });
// Reports and documents: the shelf, each report's pages, the designer, the documents list and page, every share view.
pages.push({ name: "app-reports", path: "/app/reports", auth: true });
pages.push({ name: "app-documents", path: "/app/documents", auth: true });
for (const r of db.prepare("SELECT id, starter FROM reports WHERE workspace_id = ?").all(demo.workspaceId) as { id: string; starter: string }[]) {
  pages.push({ name: `app-report-${r.starter}-${r.id}`, path: `/app/reports/${r.id}`, auth: true });
}
const firstReport = db.prepare("SELECT id FROM reports WHERE workspace_id = ? ORDER BY created_at LIMIT 1").get(demo.workspaceId) as { id: string };
pages.push({ name: "app-report-versions", path: `/app/reports/${firstReport.id}/versions`, auth: true });
pages.push({ name: "app-report-settings", path: `/app/reports/${firstReport.id}/settings`, auth: true });
pages.push({ name: "report-designer", path: `/app/reports/${firstReport.id}/design`, auth: true });
for (const d of seeded) {
  pages.push({ name: `app-document-${d.name}`, path: `/app/documents/${d.document.id}`, auth: true });
  pages.push({ name: `share-${d.name}`, path: `/d/${d.document.share_token}` });
  pages.push({ name: `sheet-${d.name}`, path: `/app/documents/${d.document.id}/sheet`, auth: true });
}
// A closed form, to audit the closed page.
db.prepare("UPDATE forms SET status = 'closed' WHERE id = ?").run(forms.at(-1)!.id);
pages.push({ name: "form-closed", path: `/f/${forms.at(-1)!.slug}` });

const out = join(import.meta.dirname, "../test-results/audit");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let errors = 0;
let warnings = 0;
for (const p of pages) {
  const res = await app.request(p.path, { headers: p.auth ? { cookie } : {} });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) {
    console.log(`✗ ${p.path} → ${res.status} ${type} (not HTML)`);
    errors++;
    continue;
  }
  const html = await res.text();
  writeFileSync(join(out, `${p.name}.html`), html);
  const audit = await auditHtml(html);
  const bad = audit.findings.filter((f) => f.severity === "error" || f.severity === "critical");
  const warn = audit.findings.filter((f) => f.severity === "warning");
  errors += bad.length;
  warnings += warn.length;
  console.log(`${bad.length ? "✗" : "✓"} ${p.path} (${res.status}) — ${bad.length} errors, ${warn.length} warnings`);
  for (const f of [...bad, ...warn]) console.log(`    ${f.severity} ${f.rule_id} line ${f.line}: ${f.message}`);
}

await closeBrowser();
db.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pages.length} pages, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
