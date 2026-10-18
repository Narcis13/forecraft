import { Hono } from "hono";
import type { DB } from "../db/index.ts";
import type { Env } from "../api/http.ts";
import { compileForm } from "../forms/model.ts";
import { renderClosedPage, renderFormPage } from "../forms/page.ts";
import { countSubmissions, getFormBySlug, getVersion } from "../forms/store.ts";

export function publicRoutes(db: DB) {
  const app = new Hono<Env>();

  app.get("/health", (c) => {
    db.prepare("SELECT 1").get();
    return c.json({ ok: true });
  });

  /** The public form: always the latest published version. */
  app.get("/f/:slug", (c) => {
    const row = getFormBySlug(db, c.req.param("slug"));
    if (!row) return c.notFound();
    if (row.published_version === null) {
      return c.html(renderClosedPage(compileForm(JSON.parse(row.definition)), "unpublished"), 404);
    }
    const form = compileForm(JSON.parse(getVersion(db, row.id, row.published_version)!.definition));
    if (row.status === "closed") return c.html(renderClosedPage(form, "closed"));
    if (row.submission_limit !== null && countSubmissions(db, row.id) >= row.submission_limit) {
      return c.html(renderClosedPage(form, "full"));
    }
    return c.html(renderFormPage(form, { action: `/api/v1/f/${row.slug}/submissions`, preview: false }));
  });

  return app;
}
