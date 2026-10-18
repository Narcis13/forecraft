// Public faces of documents: the share view (/d/:token), its PDF
// (/d/:token.pdf), and assets (/assets/:id). Plus issue-on-submit, the hook a
// form's public submission calls to issue its confirmation.

import { Hono, type Context } from "hono";
import { clientIp, type Env, ipHash, Problem, take } from "../api/http.ts";
import { assetHeaders, getAsset } from "../assets/index.ts";
import type { DB } from "../db/index.ts";
import { labelsFor } from "../reports/labels.ts";
import { documentPdf, issueDocument, renderDocument } from "../reports/service.ts";
import { getDocumentByToken, insertDraft, type DocumentRow } from "../reports/store.ts";
import { compiledVersion, docMeta } from "../reports/service.ts";
import { renderReport } from "../reports/render.ts";
import { guard, pdfResponse } from "./reports-api.ts";

export function documentRoutes(db: DB) {
  const app = new Hono<Env>();

  const limited = (c: Context, bucket: string, perMinute: number) => {
    const r = take(`${bucket}:${ipHash(db, clientIp(c))}`, perMinute);
    if (!r.ok) {
      c.header("Retry-After", String(r.retryAfter));
      throw new Problem(429, "rate-limited", "Too many requests", `Slow down: ${perMinute} documents per minute. Retry in ${r.retryAfter}s.`);
    }
  };

  app.get("/assets/:id", (c) => {
    const a = getAsset(db, c.req.param("id"));
    if (!a) return c.notFound();
    return c.body(new Uint8Array(a.bytes), 200, assetHeaders(a.type));
  });

  app.get("/d/:file", async (c) => {
    const file = c.req.param("file");
    const pdf = file.endsWith(".pdf");
    const doc = getDocumentByToken(db, pdf ? file.slice(0, -4) : file);
    if (!doc) return c.notFound();
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    if (pdf) {
      // A render that has not happened yet costs: the first download of a
      // confirmation counts against the form's per-IP submission limit.
      if (doc.status === "draft" || !doc.pdf) limited(c, doc.submission_id ? "submit" : "share-render", doc.submission_id ? 10 : 20);
      const out = await guard(() => documentPdf(db, doc));
      return pdfResponse(c, out, c.req.query("download") === "1" ? "attachment" : "inline");
    }
    limited(c, "share-view", 120);
    const labels = labelsFor(doc.locale);
    const rendered = renderDocument(db, doc, "share", shareView(c, doc, labels));
    return c.html(rendered.html);
  });

  return app;
}

function shareView(c: Context, doc: DocumentRow, labels: ReturnType<typeof labelsFor>) {
  const origin = new URL(c.req.url).origin;
  const filename = `${(doc.number ?? `draft-${doc.id}`).replace(/[^\w.-]+/g, "-")}.pdf`;
  return {
    title: doc.number && !doc.title.includes(doc.number) ? `${doc.title} · ${doc.number}` : doc.title,
    pdf: `/d/${doc.share_token}.pdf?download=1`,
    link: `${origin}/d/${doc.share_token}`,
    filename,
    badge: doc.status === "void" ? labels.void : doc.status === "draft" ? labels.draft : null,
    badgeVariant: doc.status === "void" ? "destructive" : "secondary",
  };
}

/**
 * After a public submission: if the form names a confirmation report and asks
 * to issue on submit, make the document now (number and all) and leave the PDF
 * for its first download. A failure never fails the submission.
 */
export async function issueOnSubmit(db: DB, formId: string, submissionId: string, origin: string): Promise<{ id: string; number: string | null; pdf_url: string; share_url: string; link: boolean } | null> {
  const form = db.prepare("SELECT workspace_id, confirmation_report_id, issue_on_submit, thank_you_link FROM forms WHERE id = ?").get(formId) as
    { workspace_id: string; confirmation_report_id: string | null; issue_on_submit: number; thank_you_link: number } | undefined;
  if (!form?.confirmation_report_id || !form.issue_on_submit) return null;
  const report = db.prepare("SELECT * FROM reports WHERE id = ? AND workspace_id = ?").get(form.confirmation_report_id, form.workspace_id) as { id: string; published_version: number | null } | undefined;
  if (!report?.published_version) return null;
  try {
    const compiled = compiledVersion(db, report.id, report.published_version);
    const sub = db.prepare("SELECT data FROM submissions WHERE id = ?").get(submissionId) as { data: string };
    const data = JSON.parse(sub.data);
    const draft = insertDraft(db, {
      workspaceId: form.workspace_id, reportId: report.id, version: report.published_version, data,
      locale: compiled.appearance.locale, currency: compiled.appearance.currency, submissionId, title: compiled.title,
    });
    const named = renderReport({ report: compiled, data, doc: { ...docMeta(db, draft), status: "draft" } });
    db.prepare("UPDATE documents SET title = ? WHERE id = ?").run(named.name, draft.id);
    const { doc } = await issueDocument(db, { ...draft, title: named.name }, null, { deferPdf: true });
    const base = origin.replace(/\/$/, "");
    return { id: doc.id, number: doc.number, pdf_url: `${base}/d/${doc.share_token}.pdf`, share_url: `${base}/d/${doc.share_token}`, link: Boolean(form.thank_you_link) };
  } catch (err) {
    console.error(`issue-on-submit for ${formId} failed:`, err instanceof Problem ? err.message : err);
    db.prepare("DELETE FROM documents WHERE submission_id = ? AND status = 'draft'").run(submissionId);
    return null;
  }
}
