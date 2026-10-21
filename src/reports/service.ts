// What the API, the dashboard pages and the public routes do with reports, in
// one place: render a document from its row, preview a definition, create and
// issue documents (preflight first, number in the issuing transaction), print
// and cache PDFs, draw the library's thumbnails.

import { Problem } from "../api/http.ts";
import { getWorkspaceAsset } from "../assets/index.ts";
import type { DB } from "../db/index.ts";
import { compileForm } from "../forms/model.ts";
import { getForm, getSubmission, getVersion, listSubmissions, type Submission } from "../forms/store.ts";
import { checkCurrency, checkLocale, compileReport, dataErrors, type CompiledReport, type ReportDefinition, type Source } from "./model.ts";
import { bindForm } from "./starters.ts";
import { printPdf, rasterize, type AssetLookup } from "./pdf.ts";
import { hasErrors, preflight, type PreflightResult } from "./preflight.ts";
import { renderReport, type DocMeta, type Finding, type Rendered, type ShareView, type SubmissionView } from "./render.ts";
import { liveDefinition, register, registerSchema, sourceData, summarize, SUMMARY_SCHEMA } from "./summary.ts";
import {
  getReportVersion, insertDraft, issueDraft, setThumbnail, storePdf, type DocumentRow, type ReportRow,
} from "./store.ts";
import { labelsFor } from "./labels.ts";

export const assetLookup = (db: DB, workspaceId: string): AssetLookup => (id) => {
  const a = getWorkspaceAsset(db, workspaceId, id);
  return a ? { bytes: a.bytes, type: a.type } : undefined;
};
const assetType = (db: DB, workspaceId: string) => (id: string) => getWorkspaceAsset(db, workspaceId, id)?.type;
// An image without intrinsic size (an SVG with only a viewBox) prints at its stored dimensions.
const assetSize = (db: DB, workspaceId: string) => (id: string) => { const a = getWorkspaceAsset(db, workspaceId, id); return a?.width && a.height ? { width: a.width, height: a.height } : undefined; };

export function invalidData(errors: { pointer: string; detail: string }[]): Problem {
  return new Problem(422, "invalid-data", "The data does not match the report's schema", errors.map((e) => `${e.pointer}: ${e.detail}`).join("; "), { errors });
}

export function preflightProblem(findings: Finding[]): Problem {
  const errors = findings.filter((f) => f.severity === "error");
  return new Problem(422, "preflight-failed", "Preflight found errors", errors.map((f) => `${f.code}${f.block ? ` (${f.block})` : ""}: ${f.message}`).join("; "), { findings });
}

// ── Submissions as data ─────────────────────────────────────────────────────

const fmtAnswer = (v: unknown, labels: ReturnType<typeof labelsFor>, locale = "en-GB"): string => {
  if (v === undefined || v === null || v === "") return labels.unanswered;
  if (typeof v === "boolean") return v ? labels.yes : labels.no;
  if (Array.isArray(v)) return v.map((x) => fmtAnswer(x, labels, locale)).join(", ");
  if (typeof v === "object") return Object.entries(v as object).map(([k, x]) => `${k}: ${fmtAnswer(x, labels, locale)}`).join("; ");
  // An ISO date answer reads as a date, the way the document writes dates.
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${v}T00:00:00Z`)).replace(/ /g, " ");
  return String(v);
};

/** A submission in form order: what the `answers` block prints and `doc.submission` holds. */
export function submissionView(db: DB, sub: Submission, locale: string): SubmissionView {
  const form = db.prepare("SELECT * FROM forms WHERE id = ?").get(sub.form_id) as { id: string; definition: string } | undefined;
  const version = form ? getVersion(db, form.id, sub.version) : undefined;
  const def = JSON.parse(version?.definition ?? form?.definition ?? "{\"schema\":{\"title\":\"Form\",\"properties\":{}}}");
  const labels = labelsFor(locale);
  const groups: SubmissionView["groups"] = [];
  let scalars: { name: string; label: string; value: string; mono: boolean }[] = [];
  const flush = (label: string) => { if (scalars.length) groups.push({ label, items: scalars }); scalars = []; };
  const walk = (props: Record<string, { title?: string; type?: string; properties?: Record<string, unknown>; items?: { properties?: Record<string, { title?: string }> } }>, data: Record<string, unknown>, prefix: string, path = "") => {
    for (const [name, field] of Object.entries(props ?? {})) {
      const title = field.title ?? name;
      const v = data?.[name];
      if (field.type === "object" && field.properties) { walk(field.properties as never, (v ?? {}) as Record<string, unknown>, `${prefix}${title} · `, `${path}${name}.`); continue; }
      if (field.type === "array" && field.items?.properties) {
        flush(def.schema.title);
        const cols = Object.entries(field.items.properties);
        const rows = Array.isArray(v) ? v : [];
        groups.push({ label: `${prefix}${title}`, name: `${path}${name}`, table: { head: cols.map(([k, c]) => c.title ?? k), rows: rows.map((r) => cols.map(([k]) => fmtAnswer((r as Record<string, unknown>)?.[k], labels, locale))) } });
        continue;
      }
      scalars.push({ name: `${path}${name}`, label: `${prefix}${title}`, value: fmtAnswer(v, labels, locale), mono: false });
    }
  };
  walk(def.schema.properties, sub.data, "");
  flush(def.schema.title);
  return { id: sub.id, created_at: sub.created_at, form: { id: sub.form_id, title: def.schema.title }, groups };
}

// ── Rendering a document ────────────────────────────────────────────────────

export function compiledVersion(db: DB, reportId: string, version: number): CompiledReport {
  const v = getReportVersion(db, reportId, version);
  if (!v) throw new Problem(404, "not-found", "Not found", `Report version ${version} does not exist.`);
  return compileReport(JSON.parse(v.definition));
}

export function docMeta(db: DB, doc: DocumentRow): DocMeta {
  const sub = doc.submission_id ? (db.prepare("SELECT s.*, f.workspace_id FROM submissions s JOIN forms f ON f.id = s.form_id WHERE s.id = ?").get(doc.submission_id) as { workspace_id: string } | undefined) : undefined;
  const subRow = sub ? getSubmission(db, sub.workspace_id, doc.submission_id!) : undefined;
  return {
    id: doc.id,
    number: doc.number,
    status: doc.status,
    // A draft has no issue date yet: it shows the day it was made, so its pages are stable.
    issuedAt: doc.issued_at ?? doc.created_at,
    locale: doc.locale,
    currency: doc.currency,
    submission: subRow ? submissionView(db, subRow, doc.locale) : null,
  };
}

export function renderDocument(db: DB, doc: DocumentRow, mode: "print" | "share" | "canvas" = "print", share?: ShareView): Rendered {
  const report = compiledVersion(db, doc.report_id, doc.version);
  return renderReport({ report, data: JSON.parse(doc.data), doc: docMeta(db, doc), mode, share, assetType: assetType(db, doc.workspace_id), assetSize: assetSize(db, doc.workspace_id) });
}

/** The document's PDF: an issued (or void) document's bytes are printed once and kept. */
export async function documentPdf(db: DB, doc: DocumentRow): Promise<{ pdf: Uint8Array; sha256: string | null; filename: string; pages: number | null }> {
  const rendered = renderDocument(db, doc);
  if (doc.status !== "draft" && doc.pdf) return { pdf: doc.pdf, sha256: doc.pdf_sha256, filename: rendered.filename, pages: doc.pages };
  const printed = await printPdf(rendered.html, { assets: assetLookup(db, doc.workspace_id), sheet: rendered.sheet });
  const pages = countPages(printed.pdf);
  if (doc.status === "draft") return { pdf: printed.pdf, sha256: null, filename: rendered.filename, pages };
  const sha = storePdf(db, doc.id, printed.pdf, pages);
  const kept = db.prepare("SELECT pdf, pdf_sha256 FROM documents WHERE id = ?").get(doc.id) as { pdf: Uint8Array; pdf_sha256: string };
  return { pdf: kept.pdf ?? printed.pdf, sha256: kept.pdf_sha256 ?? sha, filename: rendered.filename, pages };
}

/** Page count from the PDF's page tree, without parsing it fully. */
export function countPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  return (text.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
}

// ── Data for a report ───────────────────────────────────────────────────────

export interface DataInput { data?: unknown; submissionId?: string | null; period?: { since?: string; until?: string } }

/** The data a document of this report renders: given, from a submission, or a summary. */
export function resolveData(db: DB, workspaceId: string, report: CompiledReport, input: DataInput, fallbackToSample: boolean): { data: Record<string, unknown>; submission: Submission | null } {
  const source = report.definition.source ?? { kind: "data" };
  if (source.kind === "submission") {
    if (!input.submissionId) {
      // A preview without a submission prints the sample as if it had been submitted.
      if (fallbackToSample) return { data: report.definition.sample, submission: { id: "sub_preview", form_id: source.form, version: 1, created_at: new Date().toISOString().slice(0, 10) + "T09:00:00.000Z", data: report.definition.sample } };
      throw new Problem(422, "submission-required", "Submission required", "This report prints a form's submission: send `submission` (sub_…).", { errors: [{ pointer: "/submission", detail: "Required for a submission source." }] });
    }
    const sub = getSubmission(db, workspaceId, input.submissionId);
    if (!sub) throw new Problem(404, "not-found", "Not found", "No submission with that id in this workspace.");
    if (sub.form_id !== source.form) throw new Problem(422, "wrong-form", "Wrong form", `This report prints submissions of ${source.form}; that submission belongs to ${sub.form_id}.`);
    return { data: sub.data, submission: sub };
  }
  if (source.kind === "summary" || source.kind === "submissions") {
    if (!getForm(db, workspaceId, source.form)) throw new Problem(422, "invalid-source", "Form not found", `The ${source.kind === "summary" ? "summary" : "register"}'s form ${source.form} is not in this workspace.`);
    // A preview shows the form's real answers (made-up ones shaped like its questions until the first arrives);
    // a document is computed from the answers in its period, whatever the caller sent as data.
    if (fallbackToSample) return { data: sourceData(db, source.form, source.kind, input.period ?? {}, { examples: true }).data as unknown as Record<string, unknown>, submission: null };
    const data = source.kind === "summary" ? summarize(db, source.form, input.period ?? {}) : register(db, source.form, input.period ?? {});
    return { data: data as unknown as Record<string, unknown>, submission: null };
  }
  if (input.data === undefined) {
    if (fallbackToSample) return { data: report.definition.sample, submission: null };
    throw new Problem(422, "invalid-request", "Invalid request", "/data: required — the document's data, valid against the report's schema.", { errors: [{ pointer: "/data", detail: "Required." }] });
  }
  if (typeof input.data !== "object" || input.data === null || Array.isArray(input.data)) {
    throw new Problem(422, "invalid-request", "Invalid request", "/data: an object.", { errors: [{ pointer: "/data", detail: "An object." }] });
  }
  return { data: input.data as Record<string, unknown>, submission: null };
}

// ── The data a designer designs against ─────────────────────────────────────

export type SampleKind = "data" | "submission" | "summary" | "submissions";
export interface SampleData { data: Record<string, unknown>; schema: ReportDefinition["schema"]; origin: "submissions" | "synthetic" | "definition"; count: number; source: Source }

/**
 * What a report designs against, for a source (the stored one, or the one the
 * designer's working copy names): a summary or a register of the form's real
 * submissions in the period, else made-up ones shaped like its questions; a
 * submission's latest answers with the form's schema; a data report's sample.
 * `schema` is the data's JSON Schema with the report's title and description.
 */
export function sampleFor(db: DB, workspaceId: string, def: ReportDefinition, source: Source, period: { since?: string; until?: string } = {}): SampleData {
  const head = { type: "object" as const, title: def.schema.title, ...(def.schema.description ? { description: def.schema.description } : {}) };
  if (source.kind === "data") return { data: def.sample, schema: def.schema, origin: "definition", count: 0, source };
  if (!getForm(db, workspaceId, source.form)) throw new Problem(404, "not-found", "Not found", `No form ${source.form} in this workspace.`);
  if (source.kind === "submission") {
    const form = liveDefinition(db, source.form);
    const bound = structuredClone(def);
    const latest = listSubmissions(db, source.form, { limit: 1 }).items[0];
    bindForm(bound, form as never, latest?.data);
    const sameForm = def.source?.kind === "submission" && def.source.form === source.form;
    // The definition's own sample stands while it binds this form; a newly chosen form brings its latest answers.
    return { data: sameForm ? def.sample : bound.sample, schema: { ...bound.schema, ...head }, origin: latest && !sameForm ? "submissions" : "definition", count: latest ? 1 : 0, source };
  }
  const out = sourceData(db, source.form, source.kind, period, { examples: true });
  const props = source.kind === "summary" ? SUMMARY_SCHEMA : registerSchema(liveDefinition(db, source.form));
  return { data: out.data as unknown as Record<string, unknown>, schema: { ...head, properties: props as Record<string, unknown> }, origin: out.origin, count: out.count, source };
}

export function checkOverrides(locale: unknown, currency: unknown): { locale?: string; currency?: string } {
  const errors: { pointer: string; detail: string }[] = [];
  if (locale !== undefined && checkLocale(locale)) errors.push({ pointer: "/locale", detail: checkLocale(locale)! });
  if (currency !== undefined && checkCurrency(currency)) errors.push({ pointer: "/currency", detail: checkCurrency(currency)! });
  if (errors.length) throw new Problem(422, "invalid-request", "Invalid request", errors.map((e) => `${e.pointer}: ${e.detail}`).join("; "), { errors });
  return { ...(locale !== undefined ? { locale: locale as string } : {}), ...(currency !== undefined ? { currency: currency as string } : {}) };
}

// ── Preview ─────────────────────────────────────────────────────────────────

export interface Preview { rendered: Rendered; preflight: PreflightResult | null }

/** Render a definition with data (or its sample), and preflight it unless only HTML is asked for. */
export async function preview(db: DB, workspaceId: string, report: CompiledReport, input: DataInput & { locale?: string; currency?: string; status?: "draft" | "issued" }, opts: { pdf: boolean; images?: { dpi: number; max: number }; mode?: "print" | "canvas" }): Promise<Preview> {
  const { data, submission } = resolveData(db, workspaceId, report, input, true);
  const shape = dataErrors(report.rules, data);
  if (shape.length) throw invalidData(shape);
  const locale = input.locale ?? report.appearance.locale;
  const doc: DocMeta = {
    // A preview prints what an issued document would: the next number's shape, today's date.
    number: input.status === "draft" ? null : sampleNumber(report),
    status: input.status ?? "issued",
    issuedAt: new Date().toISOString().slice(0, 10) + "T09:00:00.000Z",
    locale, currency: input.currency ?? report.appearance.currency,
    submission: submission ? submissionView(db, submission, locale) : null,
  };
  const rendered = renderReport({ report, data, doc, assetType: assetType(db, workspaceId), assetSize: assetSize(db, workspaceId), mode: opts.mode });
  if (!opts.pdf) return { rendered, preflight: null };
  const pf = await preflight(report, rendered, { assets: assetLookup(db, workspaceId), images: opts.images });
  return { rendered, preflight: pf };
}

/** A plausible number for previews: the pattern with sequence 1 this year, or "PREVIEW". */
function sampleNumber(report: CompiledReport): string {
  const n = report.definition.numbering;
  if (!n?.pattern) return "PREVIEW";
  const d = new Date();
  return n.pattern.replace(/\{YYYY\}/g, String(d.getUTCFullYear())).replace(/\{YY\}/g, String(d.getUTCFullYear()).slice(-2))
    .replace(/\{MM\}/g, String(d.getUTCMonth() + 1).padStart(2, "0")).replace(/\{seq(?::(\d))?\}/g, (_m, p) => "1".padStart(p ? Number(p) : 1, "0"));
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface CreateInput extends DataInput { locale?: string; currency?: string; number?: string | null; issue: boolean }

/** A draft (and, with `issue`, its issue) from the report's published version. */
export async function createDocument(db: DB, workspaceId: string, row: ReportRow, input: CreateInput): Promise<{ doc: DocumentRow; findings: Finding[] }> {
  if (row.published_version === null) throw new Problem(409, "report-unpublished", "Report not published", "Documents are issued from a published version: POST /reports/:id/publish first.");
  const report = compiledVersion(db, row.id, row.published_version);
  const { data, submission } = resolveData(db, workspaceId, report, input, false);
  const shape = dataErrors(report.rules, data);
  if (shape.length) throw invalidData(shape);
  const locale = input.locale ?? report.appearance.locale;
  const currency = input.currency ?? report.appearance.currency;
  const provisional = renderReport({ report, data, doc: { number: null, status: "draft", issuedAt: new Date().toISOString(), locale, currency, submission: submission ? submissionView(db, submission, locale) : null }, assetType: assetType(db, workspaceId), assetSize: assetSize(db, workspaceId) });
  const draft = insertDraft(db, { workspaceId, reportId: row.id, version: row.published_version, data, locale, currency, submissionId: submission?.id ?? null, title: provisional.name });
  if (!input.issue) return { doc: draft, findings: provisional.findings };
  try {
    return await issueDocument(db, draft, input.number ?? null);
  } catch (err) {
    // An issue that fails leaves no trace: the draft it made goes too.
    db.prepare("DELETE FROM documents WHERE id = ? AND status = 'draft'").run(draft.id);
    throw err;
  }
}

/**
 * Issue a draft: preflight with the data as it will print, refuse on any error,
 * then number it in the issuing transaction and print the PDF that every
 * download serves. `deferPdf` (issue on submit) leaves the PDF to the first
 * download, so a public submission never waits for Chromium.
 */
export async function issueDocument(db: DB, draft: DocumentRow, manual: string | null, opts: { deferPdf?: boolean } = {}): Promise<{ doc: DocumentRow; findings: Finding[] }> {
  const report = compiledVersion(db, draft.report_id, draft.version);
  const meta = docMeta(db, draft);
  const numbering = report.definition.numbering ?? { pattern: "{seq}" };
  const probeNumber = numbering.manual ? (manual ?? "MANUAL") : sampleNumber(report);
  const rendered = renderReport({ report, data: JSON.parse(draft.data), doc: { ...meta, number: probeNumber, status: "issued", issuedAt: new Date().toISOString() }, assetType: assetType(db, draft.workspace_id), assetSize: assetSize(db, draft.workspace_id) });
  let findings = rendered.findings;
  if (!opts.deferPdf) findings = (await preflight(report, rendered, { assets: assetLookup(db, draft.workspace_id) })).findings;
  if (hasErrors(findings)) throw preflightProblem(findings);
  const issued = issueDraft(db, draft, numbering, manual, (number, issuedAt) =>
    renderReport({ report, data: JSON.parse(draft.data), doc: { ...meta, number, status: "issued", issuedAt }, assetType: assetType(db, draft.workspace_id), assetSize: assetSize(db, draft.workspace_id) }).name);
  // From here the number exists: the request succeeds whatever the printer does.
  // A print that fails now (a full queue, a timeout) is retried on the first download.
  if (!opts.deferPdf) {
    try { await documentPdf(db, issued); } catch { /* the PDF is made on first download */ }
  }
  return { doc: db.prepare("SELECT * FROM documents WHERE id = ?").get(issued.id) as unknown as DocumentRow, findings };
}

// ── The library's thumbnails ────────────────────────────────────────────────

/** Page 1 of a published version with its sample data, rendered once and kept. */
export async function versionThumbnail(db: DB, row: ReportRow, version: number): Promise<Uint8Array | null> {
  const v = getReportVersion(db, row.id, version);
  if (!v) return null;
  if (v.thumbnail) return v.thumbnail;
  const report = compileReport(JSON.parse(v.definition));
  const rendered = renderReport({ report, data: report.definition.sample, doc: { number: sampleNumber(report), status: "issued", issuedAt: "2026-10-01T09:00:00.000Z" }, assetType: assetType(db, row.workspace_id), assetSize: assetSize(db, row.workspace_id) });
  const printed = await printPdf(rendered.html, { assets: assetLookup(db, row.workspace_id), sheet: rendered.sheet });
  const [png] = await rasterize(printed.pdf, { dpi: 72, max: 1 });
  if (!png) return null;
  setThumbnail(db, row.id, version, png);
  return png;
}

export const formOf = (db: DB, workspaceId: string, id: string) => {
  const row = getForm(db, workspaceId, id);
  return row ? { row, form: compileForm(JSON.parse(row.definition)) } : undefined;
};
