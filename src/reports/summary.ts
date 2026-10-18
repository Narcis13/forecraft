// The `summary` source: forecraft computes a report's data from a form's
// submissions over a period chosen at issue. One fixed shape (SUMMARY_SCHEMA
// documents it, and a summary report's own schema declares the parts it binds):
//
//   form       { id, title, description }
//   period     { since, until }                    ISO dates (inclusive)
//   responses  { total, first, last }
//   nps        { score, promoters, passives, detractors, answered, question,
//                groups: [{ label, count, share }] } | null      promoters, passives, detractors
//   questions  [ { name, title, kind, answered, skipped,
//                  options?: [{ label, count, share }]      choice, multi, boolean
//                  mean?, min?, max?, median?               number, scale (choices as 1…n)
//                  top?: { label, count, share }             the most chosen option
//                  samples?: [{ text, at }] } ]              text: up to six, newest first
//   verbatims  [ { text, at, question } ]                   every question's samples, newest first (≤ 8)
//   overTime   [ { label, start, count } ]                  per day, week or month
//
// Shares are percentages (0–100, one decimal). Every number here is computed
// from stored answers only: nothing depends on the clock but the period given.

import type { DB } from "../db/index.ts";
import { exportSubmissions } from "../forms/store.ts";

export interface SummaryOption { label: string; count: number; share: number }
export interface SummaryQuestion {
  name: string;
  title: string;
  kind: "choice" | "multi" | "boolean" | "nps" | "number" | "text" | "date";
  answered: number;
  skipped: number;
  options?: SummaryOption[];
  mean?: number;
  min?: number;
  max?: number;
  median?: number;
  samples?: { text: string; at: string }[];
  top?: SummaryOption;
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

const NPS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(db: DB, formId: string, period: { since?: string; until?: string }): Summary {
  const form = db.prepare("SELECT * FROM forms WHERE id = ?").get(formId) as { id: string; definition: string; published_version: number | null } | undefined;
  if (!form) throw new Error(`no form ${formId}`);
  const live = form.published_version ? db.prepare("SELECT definition FROM form_versions WHERE form_id = ? AND version = ?").get(formId, form.published_version) as { definition: string } : null;
  const def = JSON.parse(live?.definition ?? form.definition) as { schema: { title: string; description?: string; properties: Record<string, { type?: string; title?: string; enum?: string[]; format?: string; items?: { enum?: string[] } }> } };
  const since = period.since && /^\d{4}-\d{2}-\d{2}/.test(period.since) ? period.since.slice(0, 10) : undefined;
  const until = period.until && /^\d{4}-\d{2}-\d{2}/.test(period.until) ? period.until.slice(0, 10) : undefined;
  const subs = exportSubmissions(db, formId, { since: since ? `${since}T00:00:00.000Z` : undefined, until: until ? `${until}T23:59:59.999Z` : undefined });
  const total = subs.length;
  const first = subs[0]?.created_at.slice(0, 10) ?? since ?? "";
  const last = subs.at(-1)?.created_at.slice(0, 10) ?? until ?? "";

  const questions: SummaryQuestion[] = [];
  let nps: Summary["nps"] = null;
  for (const [name, field] of Object.entries(def.schema.properties)) {
    const title = field.title ?? name;
    const values = subs.map((s) => s.data[name]).filter((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
    const answered = values.length;
    const base = { name, title, answered, skipped: total - answered };
    if (field.type === "string" && field.enum && field.enum.length === 11 && field.enum.every((v, i) => v === NPS[i])) {
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
    } else if (field.enum) {
      const opts = field.enum.map((label) => ({ label, count: values.filter((v) => v === label).length }));
      const positions = values.map((v) => field.enum!.indexOf(String(v)) + 1).filter((p) => p > 0);
      questions.push({ ...base, kind: "choice", options: opts.map((o) => ({ ...o, share: pct(o.count, answered) })), ...stats(positions) });
    } else if (field.type === "array" && field.items?.enum) {
      const opts = field.items.enum.map((label) => ({ label, count: values.filter((v) => Array.isArray(v) && v.includes(label)).length }));
      questions.push({ ...base, kind: "multi", options: opts.map((o) => ({ ...o, share: pct(o.count, answered) })).sort((a, b) => b.count - a.count) });
    } else if (field.type === "boolean") {
      const yes = values.filter((v) => v === true).length;
      questions.push({ ...base, kind: "boolean", options: [{ label: "Yes", count: yes, share: pct(yes, answered) }, { label: "No", count: answered - yes, share: pct(answered - yes, answered) }] });
    } else if (field.type === "number" || field.type === "integer") {
      questions.push({ ...base, kind: "number", ...stats(values.map(Number).filter(Number.isFinite)) });
    } else if (field.type === "string" && field.format === "date") {
      questions.push({ ...base, kind: "date" });
    } else if (field.type === "string") {
      const once = new Set<string>();
      const samples = subs.filter((s) => typeof s.data[name] === "string" && String(s.data[name]).trim().length >= 12).reverse()
        .filter((s) => !once.has(String(s.data[name]).trim()) && once.add(String(s.data[name]).trim())).slice(0, 6)
        .map((s) => ({ text: String(s.data[name]).trim().slice(0, 400), at: s.created_at.slice(0, 10) }));
      questions.push({ ...base, kind: "text", samples });
    }
  }

  for (const q of questions) {
    if (q.options?.length && (q.kind === "choice" || q.kind === "multi" || q.kind === "boolean" || q.kind === "nps")) q.top = [...q.options].sort((a, b) => b.count - a.count)[0];
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

/** The summary shape as JSON Schema — what a summary report's schema may declare (and the vocabulary documents). */
export const SUMMARY_SCHEMA = {
  form: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } } },
  period: { type: "object", properties: { since: { type: "string" }, until: { type: "string" } } },
  responses: { type: "object", properties: { total: { type: "integer" }, first: { type: "string" }, last: { type: "string" } } },
  nps: { type: "object", properties: { score: { type: "integer" }, promoters: { type: "integer" }, passives: { type: "integer" }, detractors: { type: "integer" }, answered: { type: "integer" }, question: { type: "string" }, groups: { type: "array", items: { type: "object", properties: { label: { type: "string" }, count: { type: "integer" }, share: { type: "number" } } } } } },
  verbatims: { type: "array", items: { type: "object", properties: { text: { type: "string" }, at: { type: "string" }, question: { type: "string" } } } },
  questions: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" }, title: { type: "string" }, kind: { type: "string" }, answered: { type: "integer" }, skipped: { type: "integer" },
        options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, count: { type: "integer" }, share: { type: "number" } } } },
        mean: { type: "number" }, min: { type: "number" }, max: { type: "number" }, median: { type: "number" },
        top: { type: "object", properties: { label: { type: "string" }, count: { type: "integer" }, share: { type: "number" } } },
        samples: { type: "array", items: { type: "object", properties: { text: { type: "string" }, at: { type: "string" } } } },
      },
    },
  },
  overTime: { type: "array", items: { type: "object", properties: { label: { type: "string" }, start: { type: "string" }, count: { type: "integer" } } } },
};
