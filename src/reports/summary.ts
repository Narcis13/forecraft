// The `summary` and `submissions` sources: forecraft computes a report's data
// from a form's submissions over a period chosen at issue.
//
// A summary has one fixed shape (SUMMARY_SCHEMA documents it, and a summary
// report's own schema declares the parts it binds):
//
//   form       { id, title, description }
//   period     { since, until }                    ISO dates (inclusive)
//   responses  { total, first, last }
//   nps        { score, promoters, passives, detractors, answered, question,
//                groups: [{ label, count, share }] } | null      promoters, passives, detractors
//   questions  [ { name, title, kind, answered, skipped,
//                  options?: [{ label, count, share }]      choice, multi, boolean, nps
//                  top?: { label, count, share }             the most chosen option (the first, on a tie)
//                  tie?: boolean, tops?: [{ label, count, share }]   every option sharing the top count
//                  mean?, min?, max?, median?               number, nps, and a choice asked as a scale
//                  sum?                                     number
//                  earliest?, latest?                       date: the first and last date answered (ISO)
//                  rows?: { total, perSubmission,           rows (a repeatable group): rows over all
//                           columns: [{ name, title, kind,   answers, their mean per answer, and per
//                                       count, sum?, avg? }] }   column how many rows filled it in
//                  samples?: [{ text, at }] } ]              long text only: up to six, newest first
//   verbatims  [ { text, at, question } ]                   every long text's samples, newest first (≤ 8)
//   overTime   [ { label, start, count } ]                  per day, week or month
//
// kind is one of choice, multi, boolean, nps, number, text, date, rows.
// A scale (ui widget "scale", or options "1"…"5") is a choice with numbers: its
// mean, median, min and max are the answers themselves when the options are
// numbers ("1"…"5" → 1…5), else the option's position (1…n). A choice asked any
// other way has no mean: an average of option positions means nothing.
// An unanswered yes/no question counts as No (an untouched switch is "off").
// Only long text (ui widget "textarea") is quoted in samples and verbatims —
// never an email, a link or a short answer such as a name; `ui.verbatim: false`
// keeps a long text out, `ui.verbatim: true` lets a text field in.
//
// Shares are percentages (0–100, one decimal): percent(share) prints them.
// Every number here is computed from stored answers only: nothing depends on
// the clock but the period given.
//
// The `submissions` source is the register — one row per submission:
//
//   form     { id, title, description }
//   period   { since, until }
//   count    how many submissions
//   columns  [ { name, title, kind } ]   the form's fields, in form order
//   rows     [ { id, number, submitted_at, totals, ...answers } ]   oldest first; number is 1…count
//
// totals holds, per repeatable group, the sum of each of its number columns
// (row.totals.lineItems.amount); sum(rows, "totals.lineItems.amount") adds them
// up over the register.
// Every field's key is on every row: null when unanswered, false for an
// untouched yes/no, [] for an empty list. A repeatable group stays an array of
// objects (sum(row.items, "qty")); a scale of numbers ("1"…"5") answers a number.

import type { DB } from "../db/index.ts";
import { countSubmissions, exportSubmissions } from "../forms/store.ts";

export interface SummaryOption { label: string; count: number; share: number }
export interface SummaryColumn { name: string; title: string; kind: string; count: number; sum?: number; avg?: number }
export interface SummaryQuestion {
  name: string;
  title: string;
  kind: "choice" | "multi" | "boolean" | "nps" | "number" | "text" | "date" | "rows";
  answered: number;
  skipped: number;
  options?: SummaryOption[];
  mean?: number;
  min?: number;
  max?: number;
  median?: number;
  sum?: number;
  earliest?: string;
  latest?: string;
  rows?: { total: number; perSubmission: number; columns: SummaryColumn[] };
  samples?: { text: string; at: string }[];
  top?: SummaryOption;
  tie?: boolean;
  tops?: SummaryOption[];
}
export interface Summary {
  form: { id: string; title: string; description: string };
  period: { since: string; until: string };
  responses: { total: number; first: string; last: string };
  nps: { score: number; promoters: number; passives: number; detractors: number; answered: number; question: string; groups: SummaryOption[] } | null;
  questions: SummaryQuestion[];
  verbatims: { text: string; at: string; question: string }[];
  overTime: { label: string; start: string; count: number }[];
}
export interface Register {
  form: { id: string; title: string; description: string };
  period: { since: string; until: string };
  count: number;
  columns: { name: string; title: string; kind: FieldKind }[];
  rows: Record<string, unknown>[];
}

interface Field {
  type?: string; title?: string; enum?: string[]; format?: string; minimum?: number; maximum?: number;
  items?: Field & { properties?: Record<string, Field> }; properties?: Record<string, Field>;
}
export interface FormDef {
  schema: { title: string; description?: string; properties: Record<string, Field>; required?: string[] };
  ui?: Record<string, unknown>;
}
interface Sub { id: string; created_at: string; data: Record<string, unknown> }
type Period = { since?: string; until?: string };

/** What a field asks, as the summary and the register read it. */
export type FieldKind = "nps" | "scale" | "choice" | "multi" | "boolean" | "number" | "date" | "email" | "url" | "longtext" | "text" | "rows" | "object";

const NPS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Sums of decimals without float dust (0.1 + 0.2 is 0.3 here). */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

function uiOf(def: FormDef, name: string): { widget?: unknown; verbatim?: unknown } {
  const u = def.ui?.[name];
  if (typeof u !== "object" || u === null) return {};
  const o = u as Record<string, unknown>;
  return { widget: o.widget ?? o["ui:widget"], verbatim: o.verbatim };
}

export function kindOf(field: Field, ui: { widget?: unknown } = {}): FieldKind {
  if (field.type === "string" && field.enum && field.enum.length === 11 && field.enum.every((v, i) => v === NPS[i])) return "nps";
  if (field.enum) return ui.widget === "scale" || field.enum.join(",") === "1,2,3,4,5" ? "scale" : "choice";
  if (field.type === "array") return field.items?.type === "object" || field.items?.properties ? "rows" : "multi";
  if (field.type === "object") return "object";
  if (field.type === "boolean") return "boolean";
  if (field.type === "number" || field.type === "integer") return "number";
  if (field.format === "date") return "date";
  if (field.format === "email") return "email";
  if (field.format === "uri") return "url";
  if (ui.widget === "textarea") return "longtext";
  return "text";
}

/** A scale's answers as numbers: the option itself when it is one, else its position. */
function scaleValue(field: Field, v: unknown): number | null {
  const opts = field.enum ?? [];
  const at = opts.indexOf(String(v));
  if (at === -1) return null;
  return numericOptions(field) ? Number(opts[at]) : at + 1;
}

/** Options that are numbers ("1"…"5"): a scale whose answers read as numbers. */
const numericOptions = (field: Field) => (field.enum ?? []).length > 0 && field.enum!.every((o) => /^-?\d+(\.\d+)?$/.test(o));

const isAnswered = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

// ── The form and its submissions ────────────────────────────────────────────

/** The definition the public page serves (the published version), else the working copy. */
export function liveDefinition(db: DB, formId: string): FormDef {
  const form = db.prepare("SELECT * FROM forms WHERE id = ?").get(formId) as { id: string; definition: string; published_version: number | null } | undefined;
  if (!form) throw new Error(`no form ${formId}`);
  const live = form.published_version ? db.prepare("SELECT definition FROM form_versions WHERE form_id = ? AND version = ?").get(formId, form.published_version) as { definition: string } | undefined : undefined;
  return JSON.parse(live?.definition ?? form.definition) as FormDef;
}

function readPeriod(period: Period): { since?: string; until?: string } {
  const since = period.since && /^\d{4}-\d{2}-\d{2}/.test(period.since) ? period.since.slice(0, 10) : undefined;
  const until = period.until && /^\d{4}-\d{2}-\d{2}/.test(period.until) ? period.until.slice(0, 10) : undefined;
  return { since, until };
}

function submissionsIn(db: DB, formId: string, p: { since?: string; until?: string }): Sub[] {
  return exportSubmissions(db, formId, { since: p.since ? `${p.since}T00:00:00.000Z` : undefined, until: p.until ? `${p.until}T23:59:59.999Z` : undefined });
}

export function summarize(db: DB, formId: string, period: Period): Summary {
  const def = liveDefinition(db, formId);
  const p = readPeriod(period);
  return summaryOf(def, formId, submissionsIn(db, formId, p), p);
}

export function register(db: DB, formId: string, period: Period): Register {
  const def = liveDefinition(db, formId);
  const p = readPeriod(period);
  return registerOf(def, formId, submissionsIn(db, formId, p), p);
}

// ── The summary ─────────────────────────────────────────────────────────────

/** The summary of `subs` (oldest first) — what summarize computes, for any list of submissions. */
export function summaryOf(def: FormDef, formId: string, subs: Sub[], period: Period): Summary {
  const { since, until } = readPeriod(period);
  const total = subs.length;
  const first = subs[0]?.created_at.slice(0, 10) ?? since ?? "";
  const last = subs.at(-1)?.created_at.slice(0, 10) ?? until ?? "";

  const questions: SummaryQuestion[] = [];
  let nps: Summary["nps"] = null;
  for (const [name, field] of Object.entries(def.schema.properties)) {
    const title = field.title ?? name;
    const ui = uiOf(def, name);
    const kind = kindOf(field, ui);
    const values = subs.map((s) => s.data[name]).filter(isAnswered);
    const answered = values.length;
    const base = { name, title, answered, skipped: total - answered };
    if (kind === "nps") {
      const scores = values.map(Number);
      const promoters = scores.filter((s) => s >= 9).length;
      const detractors = scores.filter((s) => s <= 6).length;
      const passives = answered - promoters - detractors;
      nps = {
        score: answered ? Math.round(((promoters - detractors) / answered) * 100) : 0, promoters, passives, detractors, answered, question: title,
        groups: [
          { label: "Promoters (9–10)", count: promoters, share: pct(promoters, answered) },
          { label: "Passives (7–8)", count: passives, share: pct(passives, answered) },
          { label: "Detractors (0–6)", count: detractors, share: pct(detractors, answered) },
        ],
      };
      questions.push({ ...base, kind: "nps", options: NPS.map((v) => ({ label: v, count: scores.filter((s) => String(s) === v).length, share: pct(scores.filter((s) => String(s) === v).length, answered) })), ...stats(scores) });
    } else if (kind === "scale" || kind === "choice") {
      const opts = field.enum!.map((label) => ({ label, count: values.filter((v) => v === label).length }));
      const scale = kind === "scale" ? stats(values.map((v) => scaleValue(field, v)).filter((n): n is number => n !== null)) : {};
      questions.push({ ...base, kind: "choice", options: opts.map((o) => ({ ...o, share: pct(o.count, answered) })), ...scale });
    } else if (kind === "multi") {
      const opts = (field.items?.enum ?? []).map((label) => ({ label, count: values.filter((v) => Array.isArray(v) && v.includes(label)).length }));
      questions.push({ ...base, kind: "multi", options: opts.map((o) => ({ ...o, share: pct(o.count, answered) })).sort((a, b) => b.count - a.count) });
    } else if (kind === "boolean") {
      // An untouched switch is off: everyone who submitted answered, and silence is No.
      const yes = subs.filter((s) => s.data[name] === true).length;
      questions.push({ name, title, answered: total, skipped: 0, kind: "boolean", options: [{ label: "Yes", count: yes, share: pct(yes, total) }, { label: "No", count: total - yes, share: pct(total - yes, total) }] });
    } else if (kind === "number") {
      const xs = values.map(Number).filter(Number.isFinite);
      questions.push({ ...base, kind: "number", ...stats(xs), ...(xs.length ? { sum: tidy(xs.reduce((a, b) => a + b, 0)) } : {}) });
    } else if (kind === "date") {
      const days = values.map(String).filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v)).map((v) => v.slice(0, 10)).sort();
      questions.push({ ...base, kind: "date", ...(days.length ? { earliest: days[0]!, latest: days.at(-1)! } : {}) });
    } else if (kind === "rows") {
      questions.push({ ...base, kind: "rows", rows: rowStats(field, values as unknown[][], answered) });
    } else if (kind !== "object") {
      // Text. Only long text is quoted: a name, an email or a link is not a testimonial.
      const quoted = ui.verbatim === true || (kind === "longtext" && ui.verbatim !== false);
      if (!quoted) { questions.push({ ...base, kind: "text" }); continue; }
      const once = new Set<string>();
      const samples = subs.filter((s) => typeof s.data[name] === "string" && String(s.data[name]).trim().length >= 12).reverse()
        .filter((s) => !once.has(String(s.data[name]).trim()) && once.add(String(s.data[name]).trim())).slice(0, 6)
        .map((s) => ({ text: String(s.data[name]).trim().slice(0, 400), at: s.created_at.slice(0, 10) }));
      questions.push({ ...base, kind: "text", samples });
    }
  }

  for (const q of questions) {
    if (!q.answered || !q.options?.length || !["choice", "multi", "boolean", "nps"].includes(q.kind)) continue;
    const most = Math.max(...q.options.map((o) => o.count));
    if (most === 0) continue;
    // A tie is named, not decided by option order: "Card, Invoice (tie)".
    q.tops = q.options.filter((o) => o.count === most);
    q.top = q.tops[0];
    q.tie = q.tops.length > 1;
  }
  const seen = new Set<string>();
  const verbatims = questions.flatMap((q) => (q.samples ?? []).map((s) => ({ ...s, question: q.title }))).sort((a, b) => (a.at < b.at ? 1 : -1))
    .filter((v) => !seen.has(v.text) && seen.add(v.text)).slice(0, 8);
  return {
    form: { id: formId, title: def.schema.title, description: def.schema.description ?? "" },
    period: { since: since ?? first, until: until ?? last },
    responses: { total, first, last },
    nps,
    questions,
    verbatims,
    overTime: buckets(subs.map((s) => s.created_at), since ?? first, until ?? last),
  };
}

/** A repeatable group: rows over all answers, and per column how many rows filled it in (and sum and mean of a number). */
function rowStats(field: Field, answers: unknown[][], answered: number): NonNullable<SummaryQuestion["rows"]> {
  const all = answers.flat().filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  const props = field.items?.properties ?? {};
  const columns = Object.entries(props).map(([name, f]) => {
    const kind = kindOf(f);
    const filled = all.map((r) => r[name]).filter(isAnswered);
    const col: SummaryColumn = { name, title: f.title ?? name, kind: kind === "longtext" ? "text" : kind, count: filled.length };
    if (kind === "number") {
      const xs = filled.map(Number).filter(Number.isFinite);
      col.sum = tidy(xs.reduce((a, b) => a + b, 0));
      col.avg = xs.length ? Math.round((col.sum / xs.length) * 100) / 100 : 0;
    }
    return col;
  });
  return { total: all.length, perSubmission: answered ? round1(all.length / answered) : 0, columns };
}

function stats(xs: number[]): { mean?: number; min?: number; max?: number; median?: number } {
  if (!xs.length) return {};
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return { mean: round1(s.reduce((a, b) => a + b, 0) / s.length), min: s[0]!, max: s.at(-1)!, median: s.length % 2 ? s[mid]! : round1((s[mid - 1]! + s[mid]!) / 2) };
}

/** Submissions per day (≤ 31 days), per ISO week (≤ 26 weeks) or per month. */
function buckets(dates: string[], since: string, until: string): Summary["overTime"] {
  if (!since || !until) return [];
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const step = days <= 31 ? "day" : days <= 26 * 7 ? "week" : "month";
  const out: Summary["overTime"] = [];
  const cur = new Date(start);
  if (step === "week") cur.setUTCDate(cur.getUTCDate() - ((cur.getUTCDay() + 6) % 7));
  if (step === "month") cur.setUTCDate(1);
  while (cur <= end && out.length < 60) {
    const next = new Date(cur);
    if (step === "day") next.setUTCDate(next.getUTCDate() + 1);
    else if (step === "week") next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    const a = cur.toISOString(), b = next.toISOString();
    const label = step === "day" ? String(cur.getUTCDate()) : step === "month" ? cur.toISOString().slice(0, 7) : cur.toISOString().slice(5, 10);
    out.push({ label, start: a.slice(0, 10), count: dates.filter((d) => d >= a && d < b).length });
    cur.setTime(next.getTime());
  }
  return out;
}

// ── The register ────────────────────────────────────────────────────────────

/** One row per submission, oldest first, every field's key on every row. */
export function registerOf(def: FormDef, formId: string, subs: Sub[], period: Period): Register {
  const { since, until } = readPeriod(period);
  const fields = Object.entries(def.schema.properties).map(([name, field]) => ({ name, field, kind: kindOf(field, uiOf(def, name)) }));
  const rows = subs.map((s, i) => {
    const row: Record<string, unknown> = {};
    for (const { name, field, kind } of fields) {
      const v = s.data[name];
      if (kind === "boolean") row[name] = v === true;
      else if (kind === "multi" || kind === "rows") row[name] = Array.isArray(v) ? v : [];
      else if (kind === "scale" && numericOptions(field)) row[name] = isAnswered(v) ? scaleValue(field, v) ?? v : null;
      else row[name] = isAnswered(v) ? v : null;
    }
    // Per repeatable group, the sum of each number column: row.totals.lineItems.amount.
    const totals: Record<string, Record<string, number>> = {};
    for (const { name, field, kind } of fields) {
      if (kind !== "rows") continue;
      const items = (row[name] as unknown[]).filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
      totals[name] = {};
      for (const [k, f] of Object.entries(field.items?.properties ?? {})) {
        if (kindOf(f) === "number") totals[name][k] = tidy(items.map((r) => Number(r[k])).filter(Number.isFinite).reduce((a, b) => a + b, 0));
      }
    }
    // The system's keys come last: a field called "id" cannot pass for the submission's.
    return { ...row, id: s.id, number: i + 1, submitted_at: s.created_at, totals };
  });
  return {
    form: { id: formId, title: def.schema.title, description: def.schema.description ?? "" },
    period: { since: since ?? subs[0]?.created_at.slice(0, 10) ?? "", until: until ?? subs.at(-1)?.created_at.slice(0, 10) ?? "" },
    count: subs.length,
    columns: fields.map(({ name, field, kind }) => ({ name, title: field.title ?? name, kind })),
    rows,
  };
}

// ── Before the first answer: a sample shaped like the form ──────────────────

const WRITTEN = [
  "This is where a written answer appears; real ones replace it once people respond.",
  "A second example answer, a little longer, so the layout shows how longer text wraps on the page.",
  "Short and to the point.",
];

/** A value for one field of the i-th made-up submission: plausible, deterministic. */
function exampleValue(field: Field, kind: FieldKind, i: number, day: string): unknown {
  const opts = field.enum ?? field.items?.enum ?? [];
  switch (kind) {
    case "nps": return ["9", "10", "8", "7", "9", "6", "10", "9", "3", "8", "10", "9"][i % 12];
    case "scale": return opts[[3, 4, 2, 4, 3, 4, 1, 3, 4, 2, 3, 0][i % 12]! % opts.length];
    case "choice": return opts[[0, 1, 0, 2, 0, 1, 3, 0, 1, 2, 0, 4][i % 12]! % opts.length];
    case "multi": return opts.filter((_, k) => (i + k) % 3 !== 0).slice(0, 3);
    case "boolean": return i % 3 !== 0;
    case "number": {
      const lo = field.minimum ?? 1;
      const hi = field.maximum ?? lo + 9;
      const n = lo + ([2, 3, 1, 4, 2, 5, 3, 2, 6, 1, 3, 4][i % 12]! % (hi - lo + 1));
      return field.type === "integer" ? Math.round(n) : n;
    }
    case "date": return day;
    case "email": return `person${i + 1}@example.com`;
    case "url": return `https://example.com/${i + 1}`;
    case "longtext": return WRITTEN[i % WRITTEN.length];
    case "rows": {
      const props = Object.entries(field.items?.properties ?? {});
      return Array.from({ length: 1 + (i % 3) }, (_, r) => Object.fromEntries(props.map(([k, f]) => [k, exampleValue(f, kindOf(f), i + r, day)])));
    }
    case "object": return Object.fromEntries(Object.entries(field.properties ?? {}).map(([k, f]) => [k, exampleValue(f, kindOf(f), i, day)]));
    default: return `Example ${(field.title ?? "answer").toLowerCase()} ${i + 1}`;
  }
}

/** Twelve made-up submissions shaped like the form's questions, spread over the period (the last 30 days by default). */
export function exampleSubmissions(def: FormDef, period: Period, n = 12): Sub[] {
  const p = readPeriod(period);
  const until = new Date(`${p.until ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const since = new Date(p.since ? `${p.since}T00:00:00Z` : until.getTime() - 29 * 86_400_000);
  const span = Math.max(0, until.getTime() - since.getTime());
  const required = new Set(def.schema.required ?? []);
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(since.getTime() + Math.floor((span * i) / Math.max(1, n - 1) / 86_400_000) * 86_400_000 + (9 + (i % 8)) * 3_600_000);
    const day = at.toISOString().slice(0, 10);
    const data: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(def.schema.properties)) {
      const kind = kindOf(field, uiOf(def, name));
      // Some optional questions go unanswered, as they do.
      if (!required.has(name) && kind !== "boolean" && i % 5 === 4) continue;
      if (kind === "longtext" && i % 2 === 1) continue;
      data[name] = exampleValue(field, kind, i, day);
    }
    return { id: `sub_example${String(i + 1).padStart(2, "0")}`, created_at: at.toISOString(), data };
  });
}

/**
 * The data a summary or register report previews: the form's real submissions
 * (in the period, when one is given); when the form has none at all, made-up
 * ones shaped like its questions. `count` is how many real submissions the data
 * comes from (0 for made-up data).
 */
export function sourceData(db: DB, formId: string, kind: "summary" | "submissions", period: Period, opts: { examples: boolean }): { data: Summary | Register; origin: "submissions" | "synthetic"; count: number } {
  const def = liveDefinition(db, formId);
  const p = readPeriod(period);
  let subs = submissionsIn(db, formId, p);
  let origin: "submissions" | "synthetic" = "submissions";
  if (!subs.length && opts.examples && countSubmissions(db, formId) === 0) {
    subs = exampleSubmissions(def, p);
    origin = "synthetic";
  }
  const span = origin === "synthetic" && !p.since && !p.until ? { since: subs[0]!.created_at.slice(0, 10), until: subs.at(-1)!.created_at.slice(0, 10) } : p;
  const data = kind === "summary" ? summaryOf(def, formId, subs, span) : registerOf(def, formId, subs, span);
  return { data, origin, count: origin === "synthetic" ? 0 : subs.length };
}

// ── Shapes, as JSON Schema ──────────────────────────────────────────────────

/** share is a percentage on the 0–100 scale (37.5 is 37.5 %): percent(share) prints it. */
const SHARE = { type: "number", description: "A percentage, 0–100: print it with percent(share)." };
const OPTION = { type: "object", properties: { label: { type: "string" }, count: { type: "integer" }, share: SHARE } };
const FORM = { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } } };
const PERIOD = { type: "object", properties: { since: { type: "string" }, until: { type: "string" } } };

/** The summary shape as JSON Schema — what a summary report's schema may declare (and the vocabulary documents). */
export const SUMMARY_SCHEMA = {
  form: FORM,
  period: PERIOD,
  responses: { type: "object", properties: { total: { type: "integer" }, first: { type: "string" }, last: { type: "string" } } },
  nps: { type: "object", properties: { score: { type: "integer" }, promoters: { type: "integer" }, passives: { type: "integer" }, detractors: { type: "integer" }, answered: { type: "integer" }, question: { type: "string" }, groups: { type: "array", items: OPTION } } },
  verbatims: { type: "array", items: { type: "object", properties: { text: { type: "string" }, at: { type: "string" }, question: { type: "string" } } } },
  questions: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" }, title: { type: "string" }, kind: { type: "string" }, answered: { type: "integer" }, skipped: { type: "integer" },
        options: { type: "array", items: OPTION },
        mean: { type: "number" }, min: { type: "number" }, max: { type: "number" }, median: { type: "number" }, sum: { type: "number" },
        earliest: { type: "string" }, latest: { type: "string" },
        top: OPTION, tie: { type: "boolean" }, tops: { type: "array", items: OPTION },
        rows: {
          type: "object",
          properties: {
            total: { type: "integer" }, perSubmission: { type: "number" },
            columns: { type: "array", items: { type: "object", properties: { name: { type: "string" }, title: { type: "string" }, kind: { type: "string" }, count: { type: "integer" }, sum: { type: "number" }, avg: { type: "number" } } } },
          },
        },
        samples: { type: "array", items: { type: "object", properties: { text: { type: "string" }, at: { type: "string" } } } },
      },
    },
  },
  overTime: { type: "array", items: { type: "object", properties: { label: { type: "string" }, start: { type: "string" }, count: { type: "integer" } } } },
};

/** A register row's own keys; a form field by one of these names is shadowed. */
export const SYSTEM_KEYS = ["id", "number", "submitted_at", "totals"];

/** The register's shape as JSON Schema; with a form, each row also names the form's fields. */
export function registerSchema(def?: FormDef): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const totals: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(def?.schema.properties ?? {})) {
    if (SYSTEM_KEYS.includes(name)) continue;
    const kind = kindOf(field, def ? uiOf(def, name) : {});
    const title = field.title ?? name;
    if (kind === "rows") {
      const nums = Object.entries(field.items?.properties ?? {}).filter(([, f]) => kindOf(f) === "number");
      totals[name] = { type: "object", title, properties: Object.fromEntries(nums.map(([k, f]) => [k, { type: "number", title: f.title ?? k }])) };
    }
    fields[name] = kind === "rows" ? { type: "array", title, items: { type: "object", properties: Object.fromEntries(Object.entries(field.items?.properties ?? {}).map(([k, f]) => [k, { type: f.type === "integer" ? "integer" : f.type ?? "string", title: f.title ?? k }])) } }
      : kind === "multi" ? { type: "array", title, items: { type: "string" } }
      : kind === "boolean" ? { type: "boolean", title }
      : kind === "number" ? { type: field.type === "integer" ? "integer" : "number", title }
      : kind === "scale" ? { type: numericOptions(field) ? "number" : "string", title }
      : kind === "object" ? { type: "object", title }
      : { type: "string", title };
  }
  return {
    form: FORM,
    period: PERIOD,
    count: { type: "integer" },
    columns: { type: "array", items: { type: "object", properties: { name: { type: "string" }, title: { type: "string" }, kind: { type: "string" } } } },
    rows: { type: "array", items: { type: "object", properties: { id: { type: "string" }, number: { type: "integer" }, submitted_at: { type: "string" }, totals: { type: "object", properties: totals }, ...fields } } },
  };
}
