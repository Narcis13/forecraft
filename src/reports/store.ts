// Reports, versions and documents in SQLite. The definition is stored as the
// JSON text the API received (after validation); nothing derived from it — no
// HTML — is stored beside it, except the two caches that are bytes of a fixed
// version: a published version's page-1 thumbnail and an issued document's PDF.

import { createHash, randomBytes } from "node:crypto";
import { type DB, newId, now, transaction } from "../db/index.ts";
import { Problem } from "../api/http.ts";
import { compileReport, type ReportDefinition } from "./model.ts";
import { nextNumber } from "./numbering.ts";

export interface ReportRow {
  id: string;
  workspace_id: string;
  definition: string;
  published_version: number | null;
  starter: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportVersionRow { report_id: string; version: number; definition: string; published_at: string; thumbnail: Uint8Array | null }

export type DocStatus = "draft" | "issued" | "void";

export interface DocumentRow {
  id: string;
  workspace_id: string;
  report_id: string;
  version: number;
  status: DocStatus;
  number: string | null;
  title: string;
  data: string;
  locale: string;
  currency: string | null;
  submission_id: string | null;
  share_token: string;
  issued_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  pdf: Uint8Array | null;
  pdf_sha256: string | null;
  pages: number | null;
  created_at: string;
  updated_at: string;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export function createReport(db: DB, workspaceId: string, definition: unknown, starter: string | null = null): ReportRow {
  compileReport(definition);
  const row: ReportRow = { id: newId("rpt"), workspace_id: workspaceId, definition: JSON.stringify(definition), published_version: null, starter, created_at: now(), updated_at: now() };
  db.prepare("INSERT INTO reports (id, workspace_id, definition, published_version, starter, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.workspace_id, row.definition, row.published_version, row.starter, row.created_at, row.updated_at);
  return row;
}

export function getReport(db: DB, workspaceId: string, id: string): ReportRow | undefined {
  return db.prepare("SELECT * FROM reports WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as ReportRow | undefined;
}

export function listReports(db: DB, workspaceId: string): ReportRow[] {
  return db.prepare("SELECT * FROM reports WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as unknown as ReportRow[];
}

export function updateReport(db: DB, row: ReportRow, definition: unknown): ReportRow {
  compileReport(definition);
  const next = { ...row, definition: JSON.stringify(definition), updated_at: now() };
  db.prepare("UPDATE reports SET definition = ?, updated_at = ? WHERE id = ?").run(next.definition, next.updated_at, row.id);
  return next;
}

/** A report with issued or void documents keeps them: its numbered series is a record. */
export function deleteReport(db: DB, id: string): void {
  const kept = (db.prepare("SELECT COUNT(*) AS n FROM documents WHERE report_id = ? AND status != 'draft'").get(id) as { n: number }).n;
  if (kept) throw new Problem(409, "has-documents", "Report has documents", `This report has ${kept} issued or void document${kept === 1 ? "" : "s"}, which are kept as issued. Only a report with drafts alone can be deleted.`);
  db.prepare("DELETE FROM reports WHERE id = ?").run(id);
}

export function publishReport(db: DB, row: ReportRow): ReportVersionRow {
  compileReport(JSON.parse(row.definition));
  return transaction(db, () => {
    const max = db.prepare("SELECT MAX(version) AS v FROM report_versions WHERE report_id = ?").get(row.id) as { v: number | null };
    const v: ReportVersionRow = { report_id: row.id, version: (max.v ?? 0) + 1, definition: row.definition, published_at: now(), thumbnail: null };
    db.prepare("INSERT INTO report_versions (report_id, version, definition, published_at) VALUES (?, ?, ?, ?)").run(v.report_id, v.version, v.definition, v.published_at);
    db.prepare("UPDATE reports SET published_version = ?, updated_at = ? WHERE id = ?").run(v.version, now(), row.id);
    return v;
  });
}

export function listReportVersions(db: DB, reportId: string): Omit<ReportVersionRow, "thumbnail">[] {
  return db.prepare("SELECT report_id, version, definition, published_at FROM report_versions WHERE report_id = ? ORDER BY version DESC").all(reportId) as unknown as ReportVersionRow[];
}

export function getReportVersion(db: DB, reportId: string, version: number): ReportVersionRow | undefined {
  return db.prepare("SELECT * FROM report_versions WHERE report_id = ? AND version = ?").get(reportId, version) as ReportVersionRow | undefined;
}

export function setThumbnail(db: DB, reportId: string, version: number, png: Uint8Array): void {
  db.prepare("UPDATE report_versions SET thumbnail = ? WHERE report_id = ? AND version = ?").run(png, reportId, version);
}

export function countDocuments(db: DB, reportId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM documents WHERE report_id = ?").get(reportId) as { n: number }).n;
}

export function toReportResource(db: DB, row: ReportRow) {
  const definition = JSON.parse(row.definition) as ReportDefinition;
  const published = row.published_version === null ? null : getReportVersion(db, row.id, row.published_version);
  return {
    id: row.id,
    title: definition.schema.title,
    description: definition.schema.description ?? null,
    starter: row.starter,
    source: definition.source ?? { kind: "data" },
    published_version: row.published_version,
    has_unpublished_changes: !published || published.definition !== row.definition,
    document_count: countDocuments(db, row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
    definition,
  };
}

// ── Documents ───────────────────────────────────────────────────────────────

/** A share token: 128 random bits. Rotating it revokes the old link. */
const shareToken = () => randomBytes(16).toString("base64url");

export interface NewDocument { workspaceId: string; reportId: string; version: number; data: Record<string, unknown>; locale: string; currency: string | null; submissionId?: string | null; title: string }

export function insertDraft(db: DB, d: NewDocument): DocumentRow {
  const row: DocumentRow = {
    id: newId("doc"), workspace_id: d.workspaceId, report_id: d.reportId, version: d.version, status: "draft", number: null, title: d.title,
    data: JSON.stringify(d.data), locale: d.locale, currency: d.currency, submission_id: d.submissionId ?? null, share_token: shareToken(),
    issued_at: null, voided_at: null, void_reason: null, pdf: null, pdf_sha256: null, pages: null, created_at: now(), updated_at: now(),
  };
  db.prepare(
    `INSERT INTO documents (id, workspace_id, report_id, version, status, number, title, data, locale, currency, submission_id, share_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.workspace_id, row.report_id, row.version, row.title, row.data, row.locale, row.currency, row.submission_id, row.share_token, row.created_at, row.updated_at);
  return row;
}

/**
 * Issue a draft: the number is assigned here, inside the same transaction that
 * marks it issued — gapless by construction. `name` turns the assigned number
 * into the document's list title (it renders documentTitle with the number).
 */
export function issueDraft(db: DB, doc: DocumentRow, numbering: { pattern?: string; manual?: boolean }, manual: string | null, name: (number: string, issuedAt: string) => string): DocumentRow {
  return transaction(db, () => {
    const fresh = db.prepare("SELECT status, data, locale, currency, updated_at FROM documents WHERE id = ?").get(doc.id) as Pick<DocumentRow, "status" | "data" | "locale" | "currency" | "updated_at"> | undefined;
    if (!fresh) throw new Problem(404, "not-found", "Not found", "No document with that id.");
    if (fresh.status !== "draft") throw new Problem(409, "already-issued", "Already issued", "Only a draft can be issued; this document already has its number.");
    // The draft that was preflighted is the one that gets the number: an edit
    // that landed while preflight ran would otherwise be issued unchecked.
    if (fresh.updated_at !== doc.updated_at || fresh.data !== doc.data || fresh.locale !== doc.locale || fresh.currency !== doc.currency) {
      throw new Problem(409, "changed-during-issue", "Draft changed during issue", "The draft was edited while it was being checked. Issue it again: it will be checked as it is now.");
    }
    const issuedAt = now();
    const number = nextNumber(db, doc.report_id, numbering, new Date(issuedAt), manual);
    const title = name(number, issuedAt);
    db.prepare("UPDATE documents SET status = 'issued', number = ?, issued_at = ?, title = ?, updated_at = ? WHERE id = ?").run(number, issuedAt, title, issuedAt, doc.id);
    return { ...doc, status: "issued", number, issued_at: issuedAt, title, updated_at: issuedAt };
  });
}

export function storePdf(db: DB, id: string, pdf: Uint8Array, pages: number): string {
  const sha = createHash("sha256").update(pdf).digest("hex");
  // Only the first render of an issued document is kept: every download serves those bytes.
  db.prepare("UPDATE documents SET pdf = ?, pdf_sha256 = ?, pages = ? WHERE id = ? AND pdf IS NULL").run(pdf, sha, pages, id);
  return sha;
}

export function voidDocument(db: DB, doc: DocumentRow, reason: string): DocumentRow {
  if (doc.status !== "issued") throw new Problem(409, "not-issued", "Not issued", doc.status === "void" ? "This document is already void." : "Only an issued document can be voided; delete a draft instead.");
  const at = now();
  // The void PDF is a new rendering (VOID watermark): the issued bytes are dropped.
  db.prepare("UPDATE documents SET status = 'void', voided_at = ?, void_reason = ?, pdf = NULL, pdf_sha256 = NULL, updated_at = ? WHERE id = ? AND status = 'issued'").run(at, reason, at, doc.id);
  return { ...doc, status: "void", voided_at: at, void_reason: reason, pdf: null, pdf_sha256: null, updated_at: at };
}

export function rotateShareToken(db: DB, doc: DocumentRow): DocumentRow {
  const token = shareToken();
  db.prepare("UPDATE documents SET share_token = ?, updated_at = ? WHERE id = ?").run(token, now(), doc.id);
  return { ...doc, share_token: token };
}

export function updateDraft(db: DB, doc: DocumentRow, patch: { data?: Record<string, unknown>; locale?: string; currency?: string | null; title?: string }): DocumentRow {
  if (doc.status !== "draft") throw new Problem(409, "immutable", "Issued documents are immutable", `${doc.number} was issued and cannot change. Void it and issue a new one.`);
  const next = { ...doc, ...(patch.data ? { data: JSON.stringify(patch.data) } : {}), ...(patch.locale ? { locale: patch.locale } : {}), ...(patch.currency !== undefined ? { currency: patch.currency } : {}), ...(patch.title ? { title: patch.title } : {}), updated_at: now() };
  db.prepare("UPDATE documents SET data = ?, locale = ?, currency = ?, title = ?, updated_at = ? WHERE id = ? AND status = 'draft'").run(next.data, next.locale, next.currency, next.title, next.updated_at, doc.id);
  return next;
}

export function deleteDraft(db: DB, doc: DocumentRow): void {
  if (doc.status !== "draft") throw new Problem(409, "immutable", "Issued documents are immutable", "Only drafts can be deleted; void an issued document instead.");
  db.prepare("DELETE FROM documents WHERE id = ? AND status = 'draft'").run(doc.id);
}

export function getDocument(db: DB, workspaceId: string, id: string): DocumentRow | undefined {
  return db.prepare("SELECT * FROM documents WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as DocumentRow | undefined;
}

export function getDocumentByToken(db: DB, token: string): DocumentRow | undefined {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return undefined;
  return db.prepare("SELECT * FROM documents WHERE share_token = ?").get(token) as DocumentRow | undefined;
}

export function documentsForSubmission(db: DB, submissionId: string): DocumentRow[] {
  return db.prepare("SELECT * FROM documents WHERE submission_id = ? ORDER BY created_at").all(submissionId) as unknown as DocumentRow[];
}

export interface DocumentQuery { report?: string; status?: DocStatus; number?: string; since?: string; until?: string; q?: string; limit?: number; offset?: number }

export function listDocuments(db: DB, workspaceId: string, q: DocumentQuery = {}): { items: DocumentRow[]; total: number } {
  const where = ["workspace_id = ?"];
  const args: (string | number)[] = [workspaceId];
  if (q.report) { where.push("report_id = ?"); args.push(q.report); }
  if (q.status) { where.push("status = ?"); args.push(q.status); }
  if (q.number) { where.push("number = ?"); args.push(q.number); }
  if (q.q) { where.push("(title LIKE ? ESCAPE '\\' OR number LIKE ? ESCAPE '\\')"); const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`; args.push(like, like); }
  if (q.since) { where.push("COALESCE(issued_at, created_at) >= ?"); args.push(q.since); }
  if (q.until) { where.push("COALESCE(issued_at, created_at) <= ?"); args.push(q.until); }
  const sql = where.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE ${sql}`).get(...args) as { n: number }).n;
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const items = db.prepare(`SELECT id, workspace_id, report_id, version, status, number, title, data, locale, currency, submission_id, share_token, issued_at, voided_at, void_reason, NULL AS pdf, pdf_sha256, pages, created_at, updated_at
    FROM documents WHERE ${sql} ORDER BY COALESCE(issued_at, created_at) DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, q.offset ?? 0) as unknown as DocumentRow[];
  return { items, total };
}
