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

const DIR = join(import.meta.dirname, "starters");

export interface StarterInfo { id: string; title: string; description: string; theme: string; paper: string; source: string; needsForm: boolean; blocks: string[] }

const ORDER = ["invoice", "letter", "business-report", "confirmation", "survey-summary", "blank"];

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
      source: d.source?.kind ?? "data", needsForm: d.source?.kind === "submission" || d.source?.kind === "summary",
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
    def.sample = deepMerge(def.sample, opts.sample as Record<string, unknown>);
  }
  if (def.source?.kind === "submission" || def.source?.kind === "summary") {
    if (typeof opts.form !== "string") throw new Problem(422, "form-required", "Form required", `The ${id} starter ${def.source.kind === "submission" ? "confirms" : "summarises"} a form: send \`form\` (frm_…).`, { errors: [{ pointer: "/form", detail: "Required for this starter." }] });
    const form = getForm(db, workspaceId, opts.form);
    if (!form) throw new Problem(404, "not-found", "Not found", "No form with that id in this workspace.");
    const kind = def.source.kind;
    def.source = { kind, form: form.id };
    if (kind === "submission") bindForm(def, JSON.parse(form.definition), listSubmissions(db, form.id, { limit: 1 }).items[0]?.data);
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

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" && !Array.isArray(prev) ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
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
