// Forms, versions and submissions in SQLite. The definition is stored as JSON
// text exactly as the API received it (after validation); nothing is derived
// and stored beside it.

import { randomBytes } from "node:crypto";
import { type DB, newId, now, transaction } from "../db/index.ts";
import { compileForm, type FormDefinition } from "./model.ts";

export interface FormRow {
  id: string;
  workspace_id: string;
  slug: string;
  definition: string;
  status: "open" | "closed";
  submission_limit: number | null;
  published_version: number | null;
  created_at: string;
  updated_at: string;
}

export interface FormResource {
  id: string;
  slug: string;
  title: string;
  status: "open" | "closed";
  submission_limit: number | null;
  published_version: number | null;
  has_unpublished_changes: boolean;
  submission_count: number;
  created_at: string;
  updated_at: string;
  definition: FormDefinition;
}

export function slugify(title: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  return `${base || "form"}-${randomBytes(3).toString("hex")}`;
}

export function toResource(db: DB, row: FormRow): FormResource {
  const definition = JSON.parse(row.definition) as FormDefinition;
  const published = row.published_version === null ? null : getVersion(db, row.id, row.published_version);
  return {
    id: row.id,
    slug: row.slug,
    title: definition.schema.title,
    status: row.status,
    submission_limit: row.submission_limit,
    published_version: row.published_version,
    has_unpublished_changes: !published || published.definition !== row.definition,
    submission_count: countSubmissions(db, row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
    definition,
  };
}

export function createForm(db: DB, workspaceId: string, definition: unknown, slug?: string): FormRow {
  compileForm(definition);
  const def = definition as FormDefinition;
  const row: FormRow = {
    id: newId("frm"),
    workspace_id: workspaceId,
    slug: slug ?? slugify(def.schema.title),
    definition: JSON.stringify(definition),
    status: "open",
    submission_limit: null,
    published_version: null,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO forms (id, workspace_id, slug, definition, status, submission_limit, published_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.workspace_id, row.slug, row.definition, row.status, row.submission_limit, row.published_version, row.created_at, row.updated_at);
  return row;
}

export function getForm(db: DB, workspaceId: string, id: string): FormRow | undefined {
  return db.prepare("SELECT * FROM forms WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as FormRow | undefined;
}

export function getFormBySlug(db: DB, slug: string): FormRow | undefined {
  return db.prepare("SELECT * FROM forms WHERE slug = ?").get(slug) as FormRow | undefined;
}

export function listForms(db: DB, workspaceId: string): FormRow[] {
  return db.prepare("SELECT * FROM forms WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as unknown as FormRow[];
}

export interface FormPatch {
  definition?: unknown;
  status?: "open" | "closed";
  submission_limit?: number | null;
  slug?: string;
}

export function updateForm(db: DB, row: FormRow, patch: FormPatch): FormRow {
  if (patch.definition !== undefined) compileForm(patch.definition);
  const next: FormRow = {
    ...row,
    definition: patch.definition !== undefined ? JSON.stringify(patch.definition) : row.definition,
    status: patch.status ?? row.status,
    submission_limit: patch.submission_limit !== undefined ? patch.submission_limit : row.submission_limit,
    slug: patch.slug ?? row.slug,
    updated_at: now(),
  };
  db.prepare("UPDATE forms SET definition = ?, status = ?, submission_limit = ?, slug = ?, updated_at = ? WHERE id = ?")
    .run(next.definition, next.status, next.submission_limit, next.slug, next.updated_at, row.id);
  return next;
}

export function deleteForm(db: DB, id: string): void {
  db.prepare("DELETE FROM forms WHERE id = ?").run(id);
}

// ── Versions ──────────────────────────────────────────────────────────────

export interface VersionRow { form_id: string; version: number; definition: string; published_at: string }

/** Snapshot the current definition as the next version; the public form serves it from now on. */
export function publishForm(db: DB, row: FormRow): VersionRow {
  return transaction(db, () => {
    const max = db.prepare("SELECT MAX(version) AS v FROM form_versions WHERE form_id = ?").get(row.id) as { v: number | null };
    const version: VersionRow = { form_id: row.id, version: (max.v ?? 0) + 1, definition: row.definition, published_at: now() };
    db.prepare("INSERT INTO form_versions (form_id, version, definition, published_at) VALUES (?, ?, ?, ?)")
      .run(version.form_id, version.version, version.definition, version.published_at);
    db.prepare("UPDATE forms SET published_version = ?, updated_at = ? WHERE id = ?").run(version.version, now(), row.id);
    return version;
  });
}

export function listVersions(db: DB, formId: string): VersionRow[] {
  return db.prepare("SELECT * FROM form_versions WHERE form_id = ? ORDER BY version DESC").all(formId) as unknown as VersionRow[];
}

export function getVersion(db: DB, formId: string, version: number): VersionRow | undefined {
  return db.prepare("SELECT * FROM form_versions WHERE form_id = ? AND version = ?").get(formId, version) as VersionRow | undefined;
}

// ── Submissions ───────────────────────────────────────────────────────────

export interface SubmissionRow { id: string; form_id: string; version: number; data: string; created_at: string; ip_hash: string }
export interface Submission { id: string; form_id: string; version: number; created_at: string; data: Record<string, unknown> }

export function toSubmission(row: SubmissionRow): Submission {
  return { id: row.id, form_id: row.form_id, version: row.version, created_at: row.created_at, data: JSON.parse(row.data) };
}

export function insertSubmission(db: DB, formId: string, version: number, data: Record<string, unknown>, ipHash: string): Submission {
  const row: SubmissionRow = { id: newId("sub"), form_id: formId, version, data: JSON.stringify(data), created_at: now(), ip_hash: ipHash };
  db.prepare("INSERT INTO submissions (id, form_id, version, data, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.form_id, row.version, row.data, row.created_at, row.ip_hash);
  return toSubmission(row);
}

export function countSubmissions(db: DB, formId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE form_id = ?").get(formId) as { n: number }).n;
}

export interface SubmissionQuery { q?: string; version?: number; since?: string; until?: string; limit?: number; offset?: number }

function where(formId: string, query: SubmissionQuery): { sql: string; args: (string | number)[] } {
  const where = ["form_id = ?"];
  const args: (string | number)[] = [formId];
  if (query.q) { where.push("data LIKE ? ESCAPE '\\'"); args.push(`%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); }
  if (query.version) { where.push("version = ?"); args.push(query.version); }
  if (query.since) { where.push("created_at >= ?"); args.push(query.since); }
  if (query.until) { where.push("created_at <= ?"); args.push(query.until); }
  return { sql: where.join(" AND "), args };
}

export function listSubmissions(db: DB, formId: string, query: SubmissionQuery = {}): { items: Submission[]; total: number } {
  const { sql, args } = where(formId, query);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM submissions WHERE ${sql}`).get(...args) as { n: number }).n;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 1000);
  const rows = db.prepare(`SELECT * FROM submissions WHERE ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, query.offset ?? 0) as unknown as SubmissionRow[];
  return { items: rows.map(toSubmission), total };
}

/** Every submission matching the filters, oldest first — for exports. */
export function exportSubmissions(db: DB, formId: string, query: SubmissionQuery = {}): Submission[] {
  const { sql, args } = where(formId, query);
  return (db.prepare(`SELECT * FROM submissions WHERE ${sql} ORDER BY created_at, id`).all(...args) as unknown as SubmissionRow[]).map(toSubmission);
}

export function getSubmission(db: DB, workspaceId: string, id: string): Submission | undefined {
  const row = db.prepare(
    "SELECT s.* FROM submissions s JOIN forms f ON f.id = s.form_id WHERE s.id = ? AND f.workspace_id = ?",
  ).get(id, workspaceId) as SubmissionRow | undefined;
  return row ? toSubmission(row) : undefined;
}

export function deleteSubmission(db: DB, id: string): void {
  db.prepare("DELETE FROM submissions WHERE id = ?").run(id);
}


// ── Export ────────────────────────────────────────────────────────────────

/** One flat row per submission: nested answers become `a.b`, lists join with "; ". */
export function flatten(data: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(data)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x !== "object" || x === null)) out[key] = v.join("; ");
      else v.forEach((x, i) => flatten(x as Record<string, unknown>, `${key}[${i}]`, out));
    } else if (v && typeof v === "object") flatten(v as Record<string, unknown>, key, out);
    else out[key] = typeof v === "boolean" ? (v ? "yes" : "no") : String(v ?? "");
  }
  return out;
}

export function toCsv(subs: Submission[], fieldOrder: string[]): string {
  const rows = subs.map((s) => flatten(s.data));
  const seen = new Set<string>();
  const columns: string[] = [];
  // Schema order first, then whatever nested keys the rows hold.
  for (const f of fieldOrder) for (const r of rows) for (const k of Object.keys(r)) {
    if ((k === f || k.startsWith(`${f}.`) || k.startsWith(`${f}[`)) && !seen.has(k)) { seen.add(k); columns.push(k); }
  }
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k); }
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // spreadsheet formula injection
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["id", "submitted_at", "version", ...columns];
  const lines = [header.map(cell).join(",")];
  subs.forEach((s, i) => {
    lines.push([s.id, s.created_at, String(s.version), ...columns.map((c) => rows[i]![c] ?? "")].map(cell).join(","));
  });
  return lines.join("\r\n") + "\r\n";
}
