// Gapless document numbers. A number is assigned only at issue, by `nextNumber`,
// inside the same SQLite transaction (BEGIN IMMEDIATE) that marks the document
// issued — so a rolled-back issue never consumes a number and two issues can
// never read the same `last`.

import type { DatabaseSync } from "node:sqlite";
import { Problem } from "../api/http.ts";

export interface Numbering { pattern?: string; manual?: boolean }

const TOKEN = /\{(YYYY|YY|MM|seq(?::(\d))?)\}/g;

/** `null` when the pattern is usable, else what is wrong with it. */
export function checkPattern(pattern: string): string | null {
  if (typeof pattern !== "string" || !pattern.trim()) return "A non-empty pattern, e.g. \"INV-{YYYY}-{seq:4}\".";
  if (pattern.length > 64) return "At most 64 characters.";
  let seqs = 0;
  const rest = pattern.replace(TOKEN, (_all, token: string, pad?: string) => {
    if (token.startsWith("seq")) {
      seqs++;
      if (pad !== undefined && (Number(pad) < 1 || Number(pad) > 9)) seqs = 99;
    }
    return "";
  });
  const unknown = /\{[^}]*\}/.exec(rest);
  if (unknown) return `Unknown token ${unknown[0]}. Tokens: {YYYY}, {YY}, {MM}, {seq} and {seq:N} (N from 1 to 9).`;
  if (seqs === 0) return "The pattern needs one {seq} or {seq:N} token.";
  if (seqs > 1) return "The pattern takes exactly one {seq} token, padded 1 to 9.";
  if (!/^[A-Za-z0-9 _./-]*$/.test(rest)) return "Outside its tokens a pattern holds letters, digits, spaces and - _ / . only.";
  return null;
}

/** The sequence's reset period: the year when the pattern prints one, else "". */
export function periodOf(pattern: string, date: Date): string {
  return /\{YYYY\}|\{YY\}/.test(pattern) ? String(date.getUTCFullYear()) : "";
}

export function formatNumber(pattern: string, seq: number, date: Date): string {
  return pattern.replace(TOKEN, (_all, token: string, pad?: string) => {
    if (token === "YYYY") return String(date.getUTCFullYear());
    if (token === "YY") return String(date.getUTCFullYear()).slice(-2);
    if (token === "MM") return String(date.getUTCMonth() + 1).padStart(2, "0");
    return String(seq).padStart(pad ? Number(pad) : 0, "0");
  });
}

/** The next number for an issue. Call inside `transaction()`. */
export function nextNumber(db: DatabaseSync, reportId: string, numbering: Numbering, date: Date, manual?: string | null): string {
  if (numbering.manual) {
    const n = typeof manual === "string" ? manual.trim() : "";
    if (!n) throw new Problem(422, "number-required", "Number required", "This report numbers its documents by hand: send `number`.", { errors: [{ pointer: "/number", detail: "Required by this report's numbering." }] });
    if (n.length > 64 || /[\x00-\x1f\x7f]/.test(n)) throw new Problem(422, "invalid-request", "Invalid request", "/number: at most 64 printable characters.", { errors: [{ pointer: "/number", detail: "At most 64 printable characters." }] });
    if (db.prepare("SELECT 1 FROM documents WHERE report_id = ? AND number = ?").get(reportId, n)) {
      throw new Problem(409, "number-taken", "Number taken", `A document of this report already has the number ${n}.`);
    }
    return n;
  }
  const pattern = numbering.pattern ?? "{seq}";
  const period = periodOf(pattern, date);
  const row = db.prepare("SELECT last FROM report_sequences WHERE report_id = ? AND period = ?").get(reportId, period) as { last: number } | undefined;
  const seq = (row?.last ?? 0) + 1;
  db.prepare(
    "INSERT INTO report_sequences (report_id, period, last) VALUES (?, ?, ?) ON CONFLICT (report_id, period) DO UPDATE SET last = excluded.last",
  ).run(reportId, period, seq);
  return formatNumber(pattern, seq, date);
}
