// Starters: complete, realistic definitions an agent or a person begins from
// ("Start from an invoice"). Each is a file in starters/*.json; `fromStarter`
// applies the few things a caller may say up front — a name, the appearance,
// its own sample data — and, for the confirmation, binds the form it confirms.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Problem } from "../api/http.ts";
import type { DB } from "../db/index.ts";
import { getForm, listSubmissions } from "../forms/store.ts";
import type { ReportDefinition } from "./model.ts";
import { kindOf, liveDefinition, registerSchema, sourceData, SYSTEM_KEYS, type FieldKind, type FormDef } from "./summary.ts";

const DIR = join(import.meta.dirname, "starters");

export interface StarterInfo { id: string; title: string; description: string; theme: string; paper: string; source: string; needsForm: boolean; blocks: string[] }

const ORDER = ["invoice", "letter", "business-report", "confirmation", "survey-summary", "submissions-register", "blank"];
const FORM_SOURCES = ["submission", "summary", "submissions"];

export function starterIds(): string[] {
  const ids = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  return ids.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
}

export function loadStarter(id: string): ReportDefinition {
  if (!/^[a-z][a-z-]*$/.test(id) || !starterIds().includes(id)) throw new Problem(404, "not-found", "Unknown starter", `No starter "${id}". One of: ${starterIds().join(", ")}.`);
  return JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"));
}

export function listStarters(): StarterInfo[] {
  return starterIds().map((id) => {
    const d = loadStarter(id);
    return {
      id, title: d.schema.title, description: d.schema.description ?? "", theme: d.appearance?.theme ?? "document", paper: d.appearance?.paper ?? "a4",
      source: d.source?.kind ?? "data", needsForm: FORM_SOURCES.includes(d.source?.kind ?? "data"),
      blocks: d.layout.map((b) => b.block),
    };
  });
}

export interface StarterOptions { title?: unknown; appearance?: unknown; sample?: unknown; form?: unknown }

/** A starter's definition with the caller's name, appearance and sample applied. */
export function fromStarter(db: DB, workspaceId: string, id: string, opts: StarterOptions): ReportDefinition {
  const def = loadStarter(id);
  if (typeof opts.title === "string" && opts.title.trim()) def.schema.title = opts.title.trim();
  if (opts.appearance !== undefined) {
    if (typeof opts.appearance !== "object" || opts.appearance === null || Array.isArray(opts.appearance)) throw new Problem(422, "invalid-request", "Invalid request", "/appearance: an object.", { errors: [{ pointer: "/appearance", detail: "An object." }] });
    def.appearance = { ...(def.appearance ?? {}), ...(opts.appearance as object) };
  }
  if (opts.sample !== undefined) {
    if (typeof opts.sample !== "object" || opts.sample === null || Array.isArray(opts.sample)) throw new Problem(422, "invalid-request", "Invalid request", "/sample: an object.", { errors: [{ pointer: "/sample", detail: "An object." }] });
    // Each top-level key of the caller's sample replaces the starter's: your seller is all yours.
    def.sample = { ...def.sample, ...(opts.sample as Record<string, unknown>) };
  }
  if (def.source && def.source.kind !== "data") {
    const what = { submission: "confirms", summary: "summarises", submissions: "lists the submissions of" }[def.source.kind];
    if (typeof opts.form !== "string") throw new Problem(422, "form-required", "Form required", `The ${id} starter ${what} a form: send \`form\` (frm_…).`, { errors: [{ pointer: "/form", detail: "Required for this starter." }] });
    const form = getForm(db, workspaceId, opts.form);
    if (!form) throw new Problem(404, "not-found", "Not found", "No form with that id in this workspace.");
    const kind = def.source.kind;
    def.source = { kind, form: form.id };
    if (kind === "submission") bindForm(def, JSON.parse(form.definition), listSubmissions(db, form.id, { limit: 1 }).items[0]?.data);
    else {
      // The sample is this form's data — its answers, or made-up ones shaped like its questions — never the starter's demo.
      if (kind === "submissions") bindRegister(def, liveDefinition(db, form.id));
      if (opts.sample === undefined) def.sample = sourceData(db, form.id, kind, {}, { examples: true }).data as unknown as Record<string, unknown>;
    }
  }
  return def;
}

/**
 * A confirmation prints a submission: its data schema is the form's schema
 * (so its expressions bind the form's fields), its sample the latest
 * submission, or the form's examples when there is none yet.
 */
export function bindForm(def: ReportDefinition, form: { schema: { title: string; properties: Record<string, Record<string, unknown>>; required?: string[] } }, latest?: Record<string, unknown>): void {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form.schema.properties)) {
    if (k === "doc") continue;
    // Requiredness stays the form's business: a confirmation prints what came in.
    const { required: _r, ...rest } = v;
    props[k] = rest;
  }
  def.schema = { ...def.schema, properties: props, required: [] };
  const sample: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form.schema.properties)) {
    const ex = (v.examples as unknown[] | undefined)?.[0] ?? (v.enum as unknown[] | undefined)?.[0];
    if (latest && latest[k] !== undefined) sample[k] = latest[k];
    else if (ex !== undefined) sample[k] = ex;
  }
  def.sample = sample;
  def.schema.description = `Confirmation for “${form.schema.title}”, with the answers, a check-in QR code and a barcode.`;
}


/** Kinds a register prints in a column of its own; the rest (long text, emails, links, lists, groups) would crowd a row. */
const COLUMN_KINDS: FieldKind[] = ["text", "choice", "scale", "nps", "number", "date", "boolean"];

/**
 * A register prints a form's submissions: its table's columns become the form's
 * own — the date, the first few short answers, a total per repeatable group
 * (its first numeric column) — and its totals row adds up the number columns.
 */
export function bindRegister(def: ReportDefinition, form: FormDef): void {
  const table = def.layout.find((b) => b.id === "register" && b.block === "table");
  if (!table) return;
  const fields = Object.entries(form.schema.properties).map(([name, f]) => ({ name, f, kind: kindOf(f, (form.ui?.[name] ?? {}) as { widget?: unknown }) }))
    .filter(({ name }) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !SYSTEM_KEYS.includes(name));
  const columns: Record<string, unknown>[] = [
    { label: "No.", value: "{{ row.number }}", align: "right", width: "narrow" },
    { label: "Date", value: "{{ date(row.submitted_at, \"medium\") }}" },
  ];
  // One totals row: its figure sits under the first number column (the renderer's rule), so it adds up that one.
  const footer: { label: string; value: string }[] = [];
  // Column heads print in one line of spaced capitals: short ones, and no more of them than the page holds.
  const at = (title: string) => title.length > 20 ? `${title.slice(0, 19).trimEnd()}…` : title;
  let budget = 64;
  // The first four short answers in form order — and the first number among them, so the register has a figure to total.
  const eligible = fields.filter((x) => COLUMN_KINDS.includes(x.kind));
  let picked = eligible.slice(0, 4);
  const firstNumber = eligible.find((x) => x.kind === "number");
  if (firstNumber && !picked.includes(firstNumber)) picked = [...picked.slice(0, 3), firstNumber];
  for (const { name, f, kind } of picked) {
    const label = at(f.title ?? name);
    if ((budget -= label.length + 4) < 0) break;
    if (kind === "number") {
      columns.push({ label, value: `{{ row.${name} == null ? "—" : number(row.${name}) }}`, format: "number" });
      if (!footer.length) footer.push({ label: "Total", value: `{{ number(sum(rows, "${name}")) }}` });
    } else if (kind === "boolean") columns.push({ label, value: `{{ row.${name} ? label("yes") : label("no") }}` });
    else if (kind === "date") columns.push({ label, value: `{{ row.${name} == null ? "—" : date(row.${name}, "medium") }}` });
    else if (kind === "nps" || (kind === "scale" && (f.enum ?? []).every((o) => /^\d+$/.test(o)))) columns.push({ label, value: `{{ row.${name} ?? "—" }}`, align: "right" });
    else columns.push({ label, value: `{{ row.${name} ?? "—" }}` });
  }
  for (const { name, f } of fields.filter((x) => x.kind === "rows")) {
    if (columns.length >= 7 || budget < 0) break;
    // The group's amount, if it names one; else its last number.
    const nums = Object.entries(f.items?.properties ?? {}).filter(([k, c]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && kindOf(c) === "number");
    const num = nums.find(([k, c]) => /amount|price|total|cost|sum|value/i.test(`${k} ${c.title ?? ""}`)) ?? nums.at(-1);
    if (!num) continue;
    columns.push({ label: at(`${f.title ?? name}: ${num[1].title ?? num[0]}`), value: `{{ number(row.totals.${name}.${num[0]}) }}`, format: "number" });
    if (!footer.length) footer.push({ label: "Total", value: `{{ number(sum(rows, "totals.${name}.${num[0]}")) }}` });
  }
  def.schema = { ...def.schema, properties: registerSchema(form), required: [] };
  table.columns = columns.slice(0, 7);
  table.footer = footer;
  table.empty = "No submissions in this period.";
}

/** The zero-setup submission record: any submission of any form, printed. */
export function recordDefinition(formTitle: string): ReportDefinition {
  return {
    schema: { type: "object", title: "Submission record", description: `Every answer of a submission to “${formTitle}”.`, properties: {} },
    sample: {},
    layout: [
      { id: "title", block: "title", eyebrow: "{{ label(\"record\") }}", text: "{{ doc.submission.form.title }}", details: [
        { label: "{{ label(\"submitted\") }}", value: "{{ datetime(doc.submission.created_at) }}" },
        { label: "{{ label(\"reference\") }}", value: "{{ doc.submission.id }}", mono: true },
      ] },
      { id: "answers", block: "answers" },
      { id: "footer", block: "footer", lines: ["{{ doc.submission.form.title }} · {{ doc.submission.id }} · {{ datetime(doc.submission.created_at) }}"] },
    ],
    appearance: { theme: "document", type: "plex-sans", accent: "#1f2937", paper: "a4", locale: "en-GB", currency: "EUR" },
    runningHeader: "{{ doc.submission.form.title }} · {{ doc.submission.id }}",
    documentTitle: "{{ doc.submission.form.title }} · {{ doc.submission.id }}",
    source: { kind: "data" },
  };
}
