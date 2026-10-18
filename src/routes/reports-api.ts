// /api/v1 — reports, documents, assets. Registered on the authenticated API
// (a bearer key or a session), with phase 1's problem details. PDF and PNG
// renders draw from their own, smaller rate-limit bucket.

import type { Context, Hono } from "hono";
import { absoluteUrl, type Env, notFound, Problem, rateLimit, readJson } from "../api/http.ts";
import { assetResource, getWorkspaceAsset, insertAsset, listAssets, MAX_ASSET_BYTES } from "../assets/index.ts";
import type { DB } from "../db/index.ts";
import { getSubmission } from "../forms/store.ts";
import { HELPER_DOCS } from "../reports/helpers.ts";
import { LABEL_KEYS, LANGUAGES } from "../reports/labels.ts";
import {
  BLOCKS, compileReport, DEFAULT_APPEARANCE, DENSITIES, LOCALES, MARGINS, ORIENTATIONS, PAPERS, PRINT_THEMES, TYPE_PAIRINGS,
} from "../reports/model.ts";
import { closeBrowser, RenderBusy, RenderFailed } from "../reports/pdf.ts";
import { PREFLIGHT_CODES } from "../reports/preflight.ts";
import { renderReport } from "../reports/render.ts";
import {
  assetLookup, checkOverrides, compiledVersion, createDocument, documentPdf, issueDocument, preview, submissionView,
} from "../reports/service.ts";
import { fromStarter, listStarters, recordDefinition } from "../reports/starters.ts";
import {
  createReport, deleteDraft, deleteReport, getDocument, getReport, getReportVersion, listDocuments, listReports, listReportVersions,
  publishReport, rotateShareToken, toReportResource, updateDraft, updateReport, voidDocument, type DocStatus, type DocumentRow, type ReportRow,
} from "../reports/store.ts";
import { SUMMARY_SCHEMA } from "../reports/summary.ts";
import { printPdf } from "../reports/pdf.ts";

void closeBrowser;

export function reportRoutes(api: Hono<Env>, db: DB) {
  const renders = rateLimit(30, (c) => {
    const p = c.var.principal;
    return `render:${p.via === "key" ? p.keyId : p.userId}`;
  });

  const mustReport = (c: Context<Env>) => {
    const row = getReport(db, c.var.principal.workspaceId, c.req.param("id")!);
    if (!row) throw notFound("report");
    return row;
  };
  const mustDocument = (c: Context<Env>) => {
    const row = getDocument(db, c.var.principal.workspaceId, c.req.param("id")!);
    if (!row) throw notFound("document");
    return row;
  };
  const reportOut = (c: Context<Env>, row: ReportRow) => ({
    ...toReportResource(db, row),
    preview_url: absoluteUrl(c, `/api/v1/reports/${row.id}/preview`),
    design_url: absoluteUrl(c, `/app/reports/${row.id}/design`),
  });
  const documentOut = (c: Context<Env>, d: DocumentRow, withData = false) => ({
    id: d.id,
    report_id: d.report_id,
    version: d.version,
    status: d.status,
    number: d.number,
    title: d.title,
    locale: d.locale,
    currency: d.currency,
    submission_id: d.submission_id,
    issued_at: d.issued_at,
    voided_at: d.voided_at,
    void_reason: d.void_reason,
    pages: d.pages,
    pdf_sha256: d.pdf_sha256,
    created_at: d.created_at,
    updated_at: d.updated_at,
    pdf_url: absoluteUrl(c, `/api/v1/documents/${d.id}/pdf`),
    share_url: absoluteUrl(c, `/d/${d.share_token}`),
    share_pdf_url: absoluteUrl(c, `/d/${d.share_token}.pdf`),
    ...(withData ? { data: JSON.parse(d.data) } : {}),
  });

  // ── Vocabulary and starters ─────────────────────────────────────────────
  api.get("/vocabulary/reports", (c) => c.json({
    blocks: Object.entries(BLOCKS).map(([name, spec]) => ({ block: name, group: spec.group, does: spec.does, props: Object.keys(spec.props), example: spec.example })),
    common_props: { id: "stable, unique: lowercase letters, digits, dashes", when: "a bare expression; the block renders when it is truthy", keep: "together | with-next" },
    helpers: HELPER_DOCS,
    system_values: ["doc.number", "doc.status", "doc.issuedAt", "doc.locale", "doc.currency", "doc.money.{lines, subtotal, discount, taxes[{rate, base, tax}], tax, total, paid, due}", "doc.labels", "doc.submission.{id, created_at, form, groups}"],
    print_themes: PRINT_THEMES,
    type_pairings: Object.entries(TYPE_PAIRINGS).map(([id, p]) => ({ id, ...p })),
    papers: PAPERS, orientations: ORIENTATIONS, margins: MARGINS, densities: DENSITIES,
    locales: LOCALES, languages: LANGUAGES, labels: LABEL_KEYS,
    appearance_defaults: DEFAULT_APPEARANCE,
    numbering: { tokens: ["{YYYY}", "{YY}", "{MM}", "{seq}", "{seq:N}"], example: "INV-{YYYY}-{seq:4}", manual: { manual: true } },
    money: { keys: ["lines", "quantity", "unitPrice", "taxRate", "discount", "prices (net|gross)", "rounding (line|total)", "paid"], example: { lines: "items", quantity: "qty", unitPrice: "price", taxRate: "vat", prices: "net", rounding: "line" } },
    sources: [{ kind: "data" }, { kind: "submission", form: "frm_…" }, { kind: "summary", form: "frm_…" }],
    summary_shape: SUMMARY_SCHEMA,
    preflight_codes: PREFLIGHT_CODES,
  }));

  api.get("/report-starters", (c) => c.json({ items: listStarters() }));

  // ── Reports ─────────────────────────────────────────────────────────────
  api.get("/reports", (c) => c.json({
    items: listReports(db, c.var.principal.workspaceId).map((r) => { const { definition: _d, ...rest } = reportOut(c, r); return rest; }),
  }));

  api.post("/reports", async (c) => {
    const body = await readJson(c);
    let definition: unknown;
    let starter: string | null = null;
    if (typeof body.starter === "string") {
      const extra = Object.keys(body).filter((k) => !["starter", "title", "appearance", "sample", "form"].includes(k));
      if (extra.length) throw invalid(extra.map((k) => ({ pointer: `/${k}`, detail: "Unknown key. From a starter, POST /reports takes starter, title, appearance, sample and form." })));
      definition = fromStarter(db, c.var.principal.workspaceId, body.starter, body);
      starter = body.starter;
    } else {
      definition = "definition" in body ? body.definition : body;
    }
    const row = createReport(db, c.var.principal.workspaceId, definition, starter);
    c.header("Location", `/api/v1/reports/${row.id}`);
    return c.json(reportOut(c, row), 201);
  });

  api.get("/reports/:id", (c) => c.json(reportOut(c, mustReport(c))));

  api.patch("/reports/:id", async (c) => {
    const row = mustReport(c);
    const body = await readJson(c);
    const extra = Object.keys(body).filter((k) => k !== "definition");
    if (extra.length) throw invalid(extra.map((k) => ({ pointer: `/${k}`, detail: "Unknown key. PATCH /reports/:id takes definition." })));
    if (!("definition" in body)) throw invalid([{ pointer: "/definition", detail: "Required: the whole definition." }]);
    return c.json(reportOut(c, updateReport(db, row, body.definition)));
  });

  api.delete("/reports/:id", (c) => {
    deleteReport(db, mustReport(c).id);
    return c.body(null, 204);
  });

  api.post("/reports/:id/publish", (c) => {
    const row = mustReport(c);
    const v = publishReport(db, row);
    return c.json({ version: v.version, published_at: v.published_at, documents_url: absoluteUrl(c, `/api/v1/reports/${row.id}/documents`) }, 201);
  });

  api.get("/reports/:id/versions", (c) => {
    const row = mustReport(c);
    return c.json({ items: listReportVersions(db, row.id).map((v) => ({ version: v.version, published_at: v.published_at, live: v.version === row.published_version })) });
  });

  api.get("/reports/:id/versions/:version", (c) => {
    const row = mustReport(c);
    const v = getReportVersion(db, row.id, Number(c.req.param("version")));
    if (!v) throw notFound("version");
    return c.json({ version: v.version, published_at: v.published_at, definition: JSON.parse(v.definition) });
  });

  /** Preview the working copy (or a definition in the body): preflight and page images; nothing is stored. */
  api.post("/reports/:id/preview", renders, async (c) => {
    const row = mustReport(c);
    const text = (await c.req.raw.clone().text()).trim();
    const body = text ? await readJson(c) : {};
    const known = ["definition", "data", "submission", "period", "format", "locale", "currency", "status", "pages", "dpi", "view"];
    const extra = Object.keys(body).filter((k) => !known.includes(k));
    if (extra.length) throw invalid(extra.map((k) => ({ pointer: `/${k}`, detail: `Unknown key. Preview takes ${known.join(", ")}.` })));
    const format = body.format ?? "png";
    if (!["html", "pdf", "png"].includes(format as string)) throw invalid([{ pointer: "/format", detail: 'One of "png" (preflight and page images, the default), "pdf" (the PDF itself), "html".' }]);
    const report = compileReport(body.definition ?? JSON.parse(row.definition));
    const overrides = checkOverrides(body.locale, body.currency);
    const pagesMax = Math.min(Math.max(Number(body.pages ?? 4) || 4, 1), 8);
    const dpi = Math.min(Math.max(Number(body.dpi ?? 100) || 100, 36), 150);
    const status = body.status === "draft" ? "draft" : "issued";
    const p = await guard(() => preview(db, c.var.principal.workspaceId, report, {
      data: body.data, submissionId: typeof body.submission === "string" ? body.submission : null, period: body.period as { since?: string; until?: string } | undefined,
      ...overrides, status,
    }, { pdf: format !== "html", images: format === "png" ? { dpi, max: pagesMax } : undefined, mode: format === "html" && body.view === "canvas" ? "canvas" : "print" }));
    if (format === "html") return c.json({ html: p.rendered.html, findings: p.rendered.findings, title: p.rendered.title });
    const pf = p.preflight!;
    if (format === "pdf") {
      return c.body(new Uint8Array(pf.pdf), 200, {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="preview-${p.rendered.filename}"`,
        "preflight-errors": String(pf.findings.filter((f) => f.severity === "error").length),
        "preflight-warnings": String(pf.findings.filter((f) => f.severity === "warning").length),
      });
    }
    return c.json({
      ok: !pf.findings.some((f) => f.severity === "error"),
      title: p.rendered.title,
      pages: pf.pages,
      render_ms: pf.ms,
      findings: pf.findings,
      images: pf.images.map((png, i) => ({ page: i + 1, dpi, type: "image/png", data: png.toString("base64") })),
      money: p.rendered.money,
    });
  });

  // ── Documents ───────────────────────────────────────────────────────────
  api.post("/reports/:id/documents", renders, async (c) => {
    const row = mustReport(c);
    const body = await readJson(c);
    const known = ["data", "submission", "period", "issue", "number", "locale", "currency"];
    const extra = Object.keys(body).filter((k) => !known.includes(k));
    if (extra.length) throw invalid(extra.map((k) => ({ pointer: `/${k}`, detail: `Unknown key. Takes ${known.join(", ")}.` })));
    if (body.issue !== undefined && typeof body.issue !== "boolean") throw invalid([{ pointer: "/issue", detail: "true (issue now: number and PDF) or false (a draft)." }]);
    if (body.number !== undefined && typeof body.number !== "string") throw invalid([{ pointer: "/number", detail: "A string (manual numbering only)." }]);
    const overrides = checkOverrides(body.locale, body.currency);
    const { doc, findings } = await guard(() => createDocument(db, c.var.principal.workspaceId, row, {
      data: body.data, submissionId: typeof body.submission === "string" ? body.submission : null, period: body.period as { since?: string; until?: string } | undefined,
      issue: body.issue === true, number: (body.number as string | undefined) ?? null, ...overrides,
    }));
    c.header("Location", `/api/v1/documents/${doc.id}`);
    return c.json({ ...documentOut(c, doc), findings }, 201);
  });

  api.get("/documents", (c) => {
    const q = c.req.query();
    if (q.status && !["draft", "issued", "void"].includes(q.status)) throw invalid([{ pointer: "/status", detail: 'One of "draft", "issued", "void".' }]);
    const { items, total } = listDocuments(db, c.var.principal.workspaceId, {
      report: q.report || undefined, status: (q.status || undefined) as DocStatus | undefined, number: q.number || undefined, q: q.q || undefined,
      since: q.since || undefined, until: q.until || undefined, limit: int(q, "limit") ?? 50, offset: int(q, "offset") ?? 0,
    });
    return c.json({ items: items.map((d) => documentOut(c, d)), total });
  });

  api.get("/documents/:id", (c) => c.json(documentOut(c, mustDocument(c), true)));

  api.patch("/documents/:id", async (c) => {
    const doc = mustDocument(c);
    if (doc.status !== "draft") throw new Problem(409, "immutable", "Issued documents are immutable", `${doc.number} was issued on ${doc.issued_at?.slice(0, 10)} and cannot change. Void it with a reason, then issue a new one.`);
    const body = await readJson(c);
    const extra = Object.keys(body).filter((k) => !["data", "locale", "currency"].includes(k));
    if (extra.length) throw invalid(extra.map((k) => ({ pointer: `/${k}`, detail: "Unknown key. A draft's PATCH takes data, locale, currency." })));
    const overrides = checkOverrides(body.locale, body.currency);
    const report = compiledVersion(db, doc.report_id, doc.version);
    let data: Record<string, unknown> | undefined;
    if (body.data !== undefined) {
      if (typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) throw invalid([{ pointer: "/data", detail: "An object." }]);
      data = body.data as Record<string, unknown>;
      const { dataErrors } = await import("../reports/model.ts");
      const errs = dataErrors(report.rules, data);
      if (errs.length) throw new Problem(422, "invalid-data", "The data does not match the report's schema", errs.map((e) => `${e.pointer}: ${e.detail}`).join("; "), { errors: errs });
    }
    const next = updateDraft(db, doc, { data, ...overrides });
    return c.json(documentOut(c, next, true));
  });

  api.delete("/documents/:id", (c) => {
    deleteDraft(db, mustDocument(c));
    return c.body(null, 204);
  });

  api.get("/documents/:id/pdf", renders, async (c) => {
    const doc = mustDocument(c);
    const out = await guard(() => documentPdf(db, doc));
    return pdfResponse(c, out);
  });

  api.post("/documents/:id/issue", renders, async (c) => {
    const doc = mustDocument(c);
    const text = (await c.req.raw.clone().text()).trim();
    const body = text ? await readJson(c) : {};
    if (doc.status !== "draft") throw new Problem(409, "already-issued", "Already issued", `This document is ${doc.status}${doc.number ? ` (${doc.number})` : ""}.`);
    const { doc: issued, findings } = await guard(() => issueDocument(db, doc, typeof body.number === "string" ? body.number : null));
    return c.json({ ...documentOut(c, issued), findings });
  });

  api.post("/documents/:id/void", async (c) => {
    const doc = mustDocument(c);
    const body = await readJson(c);
    if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 500) {
      throw invalid([{ pointer: "/reason", detail: "Required: why this document is void (3–500 characters). It keeps its number and prints VOID." }]);
    }
    return c.json(documentOut(c, voidDocument(db, doc, body.reason.trim())));
  });

  api.post("/documents/:id/share/rotate", (c) => {
    const doc = rotateShareToken(db, mustDocument(c));
    return c.json({ share_url: absoluteUrl(c, `/d/${doc.share_token}`), share_pdf_url: absoluteUrl(c, `/d/${doc.share_token}.pdf`), note: "The previous link no longer works." });
  });

  /** Any submission of any form, printed through the built-in submission record. */
  api.get("/submissions/:id/pdf", renders, async (c) => {
    const sub = getSubmission(db, c.var.principal.workspaceId, c.req.param("id"));
    if (!sub) throw notFound("submission");
    const view = submissionView(db, sub, "en-GB");
    const report = compileReport(recordDefinition(view.form.title));
    const rendered = renderReport({ report, data: {}, doc: { number: null, status: "issued", issuedAt: sub.created_at, submission: view }, variant: "form" });
    const printed = await guard(() => printPdf(rendered.html, { sheet: rendered.sheet }));
    return pdfResponse(c, { pdf: printed.pdf, filename: `${sub.id}.pdf`, sha256: null, pages: null });
  });

  // ── Assets ──────────────────────────────────────────────────────────────
  api.post("/assets", async (c) => {
    const type = c.req.header("content-type") ?? "";
    let bytes: Uint8Array;
    let name = c.req.query("name") ?? "";
    if (type.includes("multipart/form-data")) {
      const fd = await c.req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) throw invalid([{ pointer: "/file", detail: "Send the image as the multipart field `file`." }]);
      bytes = new Uint8Array(await file.arrayBuffer());
      name ||= file.name;
    } else {
      bytes = new Uint8Array(await c.req.arrayBuffer());
    }
    if (bytes.length > MAX_ASSET_BYTES) throw new Problem(413, "too-large", "Asset too large", `At most ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
    const a = insertAsset(db, c.var.principal.workspaceId, bytes, name);
    c.header("Location", `/api/v1/assets/${a.id}`);
    return c.json({ ...assetResource(a), url: absoluteUrl(c, `/assets/${a.id}`) }, 201);
  });

  api.get("/assets", (c) => c.json({ items: listAssets(db, c.var.principal.workspaceId).map((a) => ({ ...assetResource(a), url: absoluteUrl(c, `/assets/${a.id}`) })) }));

  api.get("/assets/:id", (c) => {
    const a = getWorkspaceAsset(db, c.var.principal.workspaceId, c.req.param("id"));
    if (!a) throw notFound("asset");
    const { bytes: _b, ...meta } = a;
    return c.json({ ...assetResource(meta), url: absoluteUrl(c, `/assets/${a.id}`) });
  });

  void assetLookup;
}

export function pdfResponse(c: Context, out: { pdf: Uint8Array; filename: string; sha256: string | null; pages: number | null }, disposition = "attachment"): Response {
  const headers: Record<string, string> = {
    "content-type": "application/pdf",
    "content-disposition": `${disposition}; filename="${out.filename}"`,
    "cache-control": out.sha256 ? "private, max-age=3600" : "no-store",
  };
  if (out.sha256) headers.etag = `"${out.sha256}"`;
  if (out.pages) headers["x-pages"] = String(out.pages);
  if (out.sha256 && c.req.header("if-none-match") === `"${out.sha256}"`) return c.body(null, 304, headers);
  return c.body(new Uint8Array(out.pdf), 200, headers);
}

/** Renderer failures as problems: a full queue is a 503 with Retry-After. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RenderBusy) throw new Problem(503, "renderer-busy", "The renderer is busy", "Too many documents are being printed right now. Retry shortly.", { retry_after: err.retryAfter });
    if (err instanceof RenderFailed) throw new Problem(503, "render-failed", "The document could not be printed", err.message, { retry_after: 5 });
    throw err;
  }
}

function invalid(errors: { pointer: string; detail: string }[]) {
  return new Problem(422, "invalid-request", "Invalid request", errors.map((e) => `${e.pointer}: ${e.detail}`).join("; "), { errors });
}

function int(q: Record<string, string>, name: string): number | undefined {
  if (q[name] === undefined || q[name] === "") return undefined;
  const n = Number(q[name]);
  if (!Number.isInteger(n) || n < 0) throw invalid([{ pointer: `/${name}`, detail: "A non-negative integer." }]);
  return n;
}
