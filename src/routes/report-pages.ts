// Dashboard pages for reports and documents. Reads go to the store; every
// write goes through /api/v1 from public/app.js and public/report-designer.js.

import type { Context, Hono } from "hono";
import type { DB } from "../db/index.ts";
import { listForms } from "../forms/store.ts";
import { page } from "../render/index.ts";
import { labelsFor } from "../reports/labels.ts";
import { BLOCKS, DEFAULT_APPEARANCE, DENSITIES, LOCALES, MARGINS, ORIENTATIONS, PAPERS, PRINT_THEMES, TYPE_PAIRINGS, type ReportDefinition } from "../reports/model.ts";
import { renderDocument, versionThumbnail } from "../reports/service.ts";
import { HELPER_DOCS } from "../reports/helpers.ts";
import { listStarters } from "../reports/starters.ts";
import { getDocument, getReport, listDocuments, listReportVersions, listReports, toReportResource, type DocStatus, type DocumentRow, type ReportRow } from "../reports/store.ts";
import type { PageEnv } from "./pages.ts";

type Shell = (c: Context<PageEnv>, nav: string, heading: string, extra: Record<string, unknown>) => Record<string, unknown>;

const STATUS = {
  draft: { label: "Draft", variant: "secondary" },
  issued: { label: "Issued", variant: "success" },
  void: { label: "Void", variant: "destructive" },
} as const;

export function reportPageRoutes(app: Hono<PageEnv>, db: DB, shell: Shell) {
  const ws = (c: Context<PageEnv>) => c.var.principal.workspaceId;

  const reportSummary = (row: ReportRow) => {
    const r = toReportResource(db, row);
    const def = r.definition as ReportDefinition;
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      documents: r.document_count,
      updated: r.updated_at,
      published: r.published_version !== null,
      version: r.published_version,
      draft: r.has_unpublished_changes,
      statusLabel: r.published_version === null ? "Draft" : `Live · v${r.published_version}${r.has_unpublished_changes ? " · edits" : ""}`,
      statusVariant: r.published_version === null ? "secondary" : "success",
      thumbnail: r.published_version !== null ? `/app/reports/${r.id}/thumbnail.png?v=${r.published_version}` : null,
      sourceLabel: def.source?.kind === "submission" ? "A submission of a form" : def.source?.kind === "summary" ? "A summary of a form's submissions" : "Data sent with each document",
      numbering: def.numbering?.manual ? "typed by hand" : def.numbering?.pattern ?? "{seq}",
      paper: `${(def.appearance?.paper ?? "a4").toUpperCase()} ${def.appearance?.orientation ?? "portrait"}`,
      theme: def.appearance?.theme ?? "document",
    };
  };

  const docSummary = (d: DocumentRow, reports: Map<string, string>) => ({
    id: d.id, number: d.number, title: d.title, report: reports.get(d.report_id) ?? "", date: d.issued_at ?? d.created_at,
    statusLabel: STATUS[d.status].label, statusVariant: STATUS[d.status].variant,
  });

  const statuses = (current: string) => [
    { value: "", label: "Any status", selected: current === "" },
    ...(["issued", "draft", "void"] as const).map((s) => ({ value: s, label: STATUS[s].label, selected: current === s })),
  ];

  const formsList = (c: Context<PageEnv>) => listForms(db, ws(c)).map((f) => ({ id: f.id, title: (JSON.parse(f.definition) as { schema: { title: string } }).schema.title }));

  app.get("/app/reports", (c) => {
    const reports = listReports(db, ws(c)).map(reportSummary);
    const counts = db.prepare("SELECT status, COUNT(*) AS n FROM documents WHERE workspace_id = ? GROUP BY status").all(ws(c)) as { status: DocStatus; n: number }[];
    const n = (s: DocStatus) => counts.find((x) => x.status === s)?.n ?? 0;
    return c.html(page("pages/app/reports.faqir", {
      page: shell(c, "reports", "Reports", { reports, starters: listStarters(), forms: formsList(c), totals: { reports: reports.length, issued: n("issued"), drafts: n("draft") } }),
    }));
  });

  const reportTabs = (id: string) => [
    { id: "overview", label: "Overview", href: `/app/reports/${id}` },
    { id: "versions", label: "Versions", href: `/app/reports/${id}/versions` },
    { id: "settings", label: "Settings", href: `/app/reports/${id}/settings` },
  ];

  app.get("/app/reports/:id", (c) => {
    const row = getReport(db, ws(c), c.req.param("id"));
    if (!row) return c.notFound();
    const report = reportSummary(row);
    const status = c.req.query("status") ?? "";
    const number = c.req.query("number") ?? "";
    const { items } = listDocuments(db, ws(c), { report: row.id, status: (["draft", "issued", "void"].includes(status) ? status : undefined) as DocStatus | undefined, number: number || undefined, limit: 200 });
    const names = new Map([[row.id, report.title]]);
    const counts = db.prepare("SELECT status, COUNT(*) AS n FROM documents WHERE report_id = ? GROUP BY status").all(row.id) as { status: DocStatus; n: number }[];
    const n = (s: DocStatus) => counts.find((x) => x.status === s)?.n ?? 0;
    return c.html(page("pages/app/report.faqir", {
      page: shell(c, "reports", report.title, {
        report, tab: "overview", tabs: reportTabs(row.id),
        documents: items.map((d) => docSummary(d, names)),
        filters: { status, number }, statuses: statuses(status),
        counts: { issued: n("issued"), draft: n("draft"), void: n("void") },
      }),
    }));
  });

  app.get("/app/reports/:id/versions", (c) => {
    const row = getReport(db, ws(c), c.req.param("id"));
    if (!row) return c.notFound();
    const versions = listReportVersions(db, row.id).map((v) => ({
      version: v.version, published: v.published_at, live: v.version === row.published_version,
      documents: (db.prepare("SELECT COUNT(*) AS n FROM documents WHERE report_id = ? AND version = ?").get(row.id, v.version) as { n: number }).n,
      href: `/api/v1/reports/${row.id}/versions/${v.version}`,
    }));
    return c.html(page("pages/app/report-versions.faqir", { page: shell(c, "reports", reportSummary(row).title, { report: reportSummary(row), versions, tab: "versions", tabs: reportTabs(row.id) }) }));
  });

  app.get("/app/reports/:id/settings", (c) => {
    const row = getReport(db, ws(c), c.req.param("id"));
    if (!row) return c.notFound();
    const def = JSON.parse(row.definition) as ReportDefinition;
    const source = def.source ?? { kind: "data" as const };
    return c.html(page("pages/app/report-settings.faqir", {
      page: shell(c, "reports", reportSummary(row).title, {
        report: reportSummary(row), tab: "settings", tabs: reportTabs(row.id), forms: formsList(c),
        settings: { pattern: def.numbering?.pattern ?? "{seq}", manual: def.numbering?.manual === true, source: source.kind, form: "form" in source ? source.form : "" },
      }),
    }));
  });

  /** Page 1 of the published version, rendered once and kept: the shelf's thumbnails. */
  app.get("/app/reports/:id/thumbnail.png", async (c) => {
    const row = getReport(db, ws(c), c.req.param("id"));
    if (!row || row.published_version === null) return c.notFound();
    const v = Number(c.req.query("v") ?? row.published_version);
    const png = await versionThumbnail(db, row, Number.isInteger(v) ? v : row.published_version);
    if (!png) return c.notFound();
    return c.body(new Uint8Array(png), 200, { "content-type": "image/png", "cache-control": "private, max-age=86400, immutable" });
  });

  app.get("/app/documents", (c) => {
    const q = c.req.query();
    const status = q.status ?? "";
    const { items, total } = listDocuments(db, ws(c), {
      q: q.q || undefined, report: q.report || undefined, status: (["draft", "issued", "void"].includes(status) ? status : undefined) as DocStatus | undefined, limit: 200,
    });
    const reports = listReports(db, ws(c));
    const names = new Map(reports.map((r) => [r.id, (JSON.parse(r.definition) as ReportDefinition).schema.title]));
    return c.html(page("pages/app/documents.faqir", {
      page: shell(c, "documents", "Documents", {
        documents: items.map((d) => docSummary(d, names)), total,
        filters: { q: q.q ?? "", report: q.report ?? "" }, statuses: statuses(status),
        reportOptions: reports.map((r) => ({ id: r.id, title: names.get(r.id)!, selected: r.id === q.report })),
      }),
    }));
  });

  app.get("/app/documents/:id", (c) => {
    const d = getDocument(db, ws(c), c.req.param("id"));
    if (!d) return c.notFound();
    const row = getReport(db, ws(c), d.report_id)!;
    const origin = new URL(c.req.url).origin;
    return c.html(page("pages/app/document.faqir", {
      page: shell(c, "documents", d.number ?? "Draft", {
        doc: {
          id: d.id, number: d.number, title: d.title, status: d.status, statusLabel: STATUS[d.status].label, statusVariant: STATUS[d.status].variant,
          report: (JSON.parse(row.definition) as ReportDefinition).schema.title, version: d.version, issued: d.issued_at, voided: d.voided_at, voidReason: d.void_reason,
          pages: d.pages, locale: d.locale, currency: d.currency, sha: d.pdf_sha256, shareUrl: `${origin}/d/${d.share_token}`,
          json: JSON.stringify(JSON.parse(d.data), null, 2),
        },
      }),
    }));
  });

  /** The sheet the document page frames: the same markup the PDF prints. */
  app.get("/app/documents/:id/sheet", (c) => {
    const d = getDocument(db, ws(c), c.req.param("id"));
    if (!d) return c.notFound();
    void labelsFor;
    return c.html(renderDocument(db, d, "canvas").html);
  });

  /** The report designer: the definition is loaded and saved through /api/v1. */
  app.get("/app/reports/:id/design", (c) => {
    const row = getReport(db, ws(c), c.req.param("id"));
    if (!row) return c.notFound();
    const groups = ["structure", "data", "content", "office", "advanced"].map((g) => ({
      id: g, label: { structure: "Structure", data: "Data", content: "Content", office: "Office", advanced: "Advanced" }[g]!,
      blocks: Object.entries(BLOCKS).filter(([, s]) => s.group === g).map(([name, s]) => ({ name, does: s.does })),
    }));
    return c.html(page("pages/app/report-designer.faqir", {
      page: {
        reportId: row.id,
        title: (JSON.parse(row.definition) as ReportDefinition).schema.title,
        groups,
        vocabulary: {
          blocks: Object.fromEntries(Object.entries(BLOCKS).map(([k, s]) => [k, { group: s.group, does: s.does, example: s.example, props: s.props }])),
          themes: PRINT_THEMES, pairings: Object.entries(TYPE_PAIRINGS).map(([id, p]) => ({ id, label: p.label, note: p.note })),
          papers: PAPERS, orientations: ORIENTATIONS, margins: MARGINS, densities: DENSITIES, locales: LOCALES, defaults: DEFAULT_APPEARANCE,
          helpers: HELPER_DOCS.map((h) => ({ name: h.name, signature: h.signature })),
        },
        forms: formsList(c),
      },
    }));
  });
}
