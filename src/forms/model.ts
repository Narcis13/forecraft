// The form model. A form is ONE JSON document — the definition — that the API
// accepts, the designer edits and the public page renders:
//
//   { schema: <JSON Schema>, ui?: <Faqir UI schema>, rules?: <@faqir-ui/rules input>,
//     appearance?: <theme, accent, layout, cover, thank-you> }
//
// The form's title and description are the schema's own root `title` and
// `description`. Everything below derives from that document; nothing here is a
// second model of it.

import { renderForm, rulesFor, type ObjectSchema, type RenderFormOptions, type UISchema } from "@faqir-ui/forms";
import { coerce, compile, fromFormData, lintDefinition, validate } from "@faqir-ui/rules";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";


export interface Appearance {
  theme: string;
  accent: string;
  scheme: "auto" | "light" | "dark";
  layout: "card" | "split" | "page";
  cover: { image: string; eyebrow: string } | null;
  submitLabel: string;
  thankYou: { title: string; message: string };
  redirect: string | null;
}

export interface FormDefinition {
  schema: ObjectSchema & { title: string; description?: string };
  ui?: UISchema;
  rules?: RenderFormOptions["rules"];
  appearance?: Partial<Appearance>;
}

/** A rules definition as `@faqir-ui/rules` reads it. */
export type RulesDefinition = Parameters<typeof validate>[0];

export const THEMES: string[] = readdirSync(join(import.meta.dirname, "../../ui/themes"))
  .filter((f) => f.endsWith(".scoped.css"))
  .map((f) => f.replace(/\.scoped\.css$/, ""))
  .sort();

/** Accent hues Faqir's `tokens/accent.css` knows; "theme" keeps the theme's own primary. */
export const ACCENTS = ["theme", "rose", "red", "orange", "blue", "indigo", "violet", "purple", "fuchsia", "pink"] as const;
export const LAYOUTS = ["card", "split", "page"] as const;
export const SCHEMES = ["auto", "light", "dark"] as const;

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "default",
  accent: "theme",
  scheme: "auto",
  layout: "card",
  cover: null,
  submitLabel: "Submit",
  thankYou: { title: "Thank you!", message: "Your answers are in. You can close this page." },
  redirect: null,
};

/** What "New form" opens the designer on; stored only once someone changes it. */
export const STARTER_DEFINITION: FormDefinition = {
  schema: {
    title: "Untitled form",
    type: "object",
    properties: { name: { type: "string", title: "Your name" }, email: { type: "string", format: "email", title: "Email" } },
    required: ["email"],
  } as FormDefinition["schema"],
};

/** A definition problem, reported to an API client as a 422 that names where it is. */
export class DefinitionProblem extends Error {
  errors: { pointer: string; detail: string }[];
  constructor(errors: { pointer: string; detail: string }[]) {
    super(errors.map((e) => `${e.pointer}: ${e.detail}`).join("; "));
    this.errors = errors;
  }
}

const ID_PREFIX = "fc";

export interface CompiledForm {
  definition: FormDefinition;
  appearance: Appearance;
  html: string;
  rules: RulesDefinition;
  wizard: boolean;
  /** Top-level field names, in schema order — the columns of a submissions table. */
  fields: { name: string; title: string; type: string }[];
}

const cache = new Map<string, CompiledForm>();

/**
 * Validate a definition and derive everything from it: the form's HTML (by
 * `@faqir-ui/forms`), and the exact rules definition that HTML carries, which
 * is what the browser enforces and what the server re-checks. Throws
 * `DefinitionProblem` for anything an author must fix.
 */
export function compileForm(input: unknown): CompiledForm {
  const key = createHash("sha1").update(JSON.stringify(input)).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const definition = checkShape(input);
  const appearance = normalizeAppearance(definition.appearance);
  // The keys forecraft adds to the Faqir vocabulary come off before rendering.
  const ext = extensions(definition);
  const schema = ext.schema;
  const ui = ext.ui;
  // Always pass rules so the form carries a definition the server can re-check.
  // heading/labelledBy: the page draws its own hero; submit: false: the page
  // places the button beside the error callout; gap: rhythm inside groups too.
  const renderOpts: RenderFormOptions = {
    idPrefix: ID_PREFIX,
    rules: ext.rules,
    heading: false,
    labelledBy: "fc-title",
    submit: false,
    gap: "6",
    // "Select {title}" reads badly when titles are questions ("Select What do you do?").
    i18n: { submitLabel: appearance.submitLabel, selectPlaceholder: "Choose one…" },
  };

  let html: string;
  let rules: RulesDefinition;
  try {
    html = decorate(renderForm(schema as ObjectSchema, ui, renderOpts), ext);
    const derived = rulesFor(schema as ObjectSchema, ui, renderOpts);
    if (!derived) throw new Error("rulesFor returned null for a form that always carries rules");
    // Same object renderForm embeds; forms and rules package types differ only on fields.
    rules = derived as RulesDefinition;
  } catch (err) {
    throw new DefinitionProblem([{ pointer: "/schema", detail: cleanMessage(err) }]);
  }

  try {
    compile(rules);
  } catch (err) {
    throw new DefinitionProblem([{ pointer: "/rules", detail: cleanMessage(err) }]);
  }
  const lint = lintDefinition(rules);
  const lintErrors = lint.findings.filter((f: { severity: string }) => f.severity === "error");
  if (lintErrors.length) {
    throw new DefinitionProblem(lintErrors.map((f: { path: string; message: string; rule: string }) => ({
      pointer: `/rules/${f.path}`, detail: `${f.rule}: ${f.message}`,
    })));
  }

  const compiled: CompiledForm = {
    definition,
    appearance,
    html,
    rules,
    wizard: Boolean(definition.ui && "ui:wizard" in definition.ui),
    fields: Object.entries(schema.properties).map(([name, field]) => ({
      name,
      title: (field as { title?: string }).title ?? name,
      type: String((field as { type: unknown }).type),
    })),
  };
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, compiled);
  return compiled;
}

// ── forecraft's own keys ──────────────────────────────────────────────────
// A few things the designer offers have no Faqir key, so they live beside the
// Faqir ones in the definition and are taken off before @faqir-ui/forms (which
// refuses unknown keys) sees it:
//   ui.<field>.prefix / suffix   a unit around a number input ("€", "seats")
//   ui.<field>.verbatim          a long-text answer reports may quote
//   schema.<date>.formatMinimum / formatMaximum   the earliest / latest ISO date,
//                                enforced by a `validate` rule on both sides
// A `compute` rule's target is shown read-only: people see the result, not a box to type in.

export const UI_EXTENSION_KEYS = ["prefix", "suffix", "verbatim"] as const;
const DATE_BOUND_KEYS = ["formatMinimum", "formatMaximum"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Extensions {
  schema: ObjectSchema;
  ui: UISchema;
  rules: NonNullable<RenderFormOptions["rules"]>;
  units: { name: string; prefix?: string; suffix?: string }[];
  computed: string[];
}

function extensions(definition: FormDefinition): Extensions {
  const errors: { pointer: string; detail: string }[] = [];
  const props = definition.schema.properties as unknown as Record<string, Record<string, unknown>>;
  const uiIn = (definition.ui ?? {}) as Record<string, unknown>;
  const ui: Record<string, unknown> = { ...uiIn };
  const properties: Record<string, unknown> = { ...props };
  const units: Extensions["units"] = [];
  const extra: { id: string; validate: unknown; path: string; message: string }[] = [];

  for (const [name, field] of Object.entries(props)) {
    if (!isRecord(field)) continue;
    const fieldUi = uiIn[name];
    if (isRecord(fieldUi) && UI_EXTENSION_KEYS.some((k) => k in fieldUi)) {
      const rest = { ...fieldUi };
      const at = (k: string, detail: string) => errors.push({ pointer: `/ui/${name}/${k}`, detail });
      const unit: Extensions["units"][number] = { name };
      for (const k of ["prefix", "suffix"] as const) {
        if (!(k in rest)) continue;
        const v = rest[k];
        delete rest[k];
        if (field.type !== "number" && field.type !== "integer") at(k, "Only a number field takes a prefix or suffix.");
        else if (typeof v !== "string" || v.length > 12) at(k, "A short string (at most 12 characters), e.g. \"€\" or \"seats\".");
        else if (v) unit[k] = v;
      }
      if ("verbatim" in rest) {
        if (typeof rest.verbatim !== "boolean") at("verbatim", "true or false.");
        else if (field.type !== "string" || (rest.widget ?? rest["ui:widget"]) !== "textarea") at("verbatim", "Only a long-text field (widget \"textarea\") can be quoted in reports.");
        delete rest.verbatim;
      }
      if (unit.prefix || unit.suffix) units.push(unit);
      if (Object.keys(rest).length) ui[name] = rest; else delete ui[name];
    }
    if (DATE_BOUND_KEYS.some((k) => k in field)) {
      const rest = { ...field };
      const at = (k: string, detail: string) => errors.push({ pointer: `/schema/properties/${name}/${k}`, detail });
      for (const k of DATE_BOUND_KEYS) {
        if (!(k in rest)) continue;
        const v = rest[k];
        delete rest[k];
        if (field.format !== "date") at(k, "Only a date field (format \"date\") takes an earliest or latest date.");
        else if (typeof v !== "string" || !ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) at(k, "A date written YYYY-MM-DD.");
        else {
          const min = k === "formatMinimum";
          extra.push({
            id: `date-${min ? "min" : "max"}-${name.toLowerCase()}`,
            validate: { date: [{ var: name }, min ? ">=" : "<=", v] },
            path: name,
            message: `Pick a date on or ${min ? "after" : "before"} ${v}.`,
          });
        }
      }
      const lo = field.formatMinimum, hi = field.formatMaximum;
      if (typeof lo === "string" && typeof hi === "string" && lo > hi) at("formatMaximum", "The latest date comes before the earliest.");
      properties[name] = rest;
    }
  }
  if (errors.length) throw new DefinitionProblem(errors);

  const authored = (definition.rules ?? {}) as { rules?: { id: string; compute?: unknown }[] };
  const taken = new Set((authored.rules ?? []).map((r) => r.id));
  for (const r of extra) {
    let id = r.id, n = 2;
    while (taken.has(id)) id = `${r.id}-${n++}`;
    taken.add(id);
    r.id = id;
  }
  const computed = (authored.rules ?? []).map((r) => r.compute).filter((t): t is string => typeof t === "string" && t in props);
  const rules = extra.length ? { ...authored, rules: [...(authored.rules ?? []), ...extra] } : authored;
  return {
    schema: { ...definition.schema, properties } as ObjectSchema,
    ui: ui as UISchema,
    rules: rules as NonNullable<RenderFormOptions["rules"]>,
    units,
    computed,
  };
}

/** The markup half of the extensions: units around number inputs, computed fields read-only. */
function decorate(html: string, ext: Extensions): string {
  const input = (name: string) => new RegExp(`<input\\b[^>]*\\sname="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
  for (const u of ext.units) {
    html = html.replace(input(u.name), (tag) => {
      const id = /\sid="([^"]+)"/.exec(tag)?.[1] ?? `${ID_PREFIX}-${u.name}`;
      // The unit is part of what the field asks for, so it is read with the field too.
      const described = tag.replace(/\saria-describedby="([^"]*)"/, ` aria-describedby="$1 ${id}-unit"`);
      const part = (k: "prefix" | "suffix") => u[k] ? `<span data-part="${k}" id="${id}-unit">${escapeText(u[k]!)}</span>` : "";
      const withUnit = u.prefix && u.suffix
        // Two parts, one id: the prefix is decoration, the suffix is the unit read aloud.
        ? `<span data-part="prefix" aria-hidden="true">${escapeText(u.prefix)}</span>${described}${part("suffix")}`
        : `${part("prefix")}${described}${part("suffix")}`;
      return `<div data-ui="input-group" data-forecraft-unit>${withUnit}</div>`;
    });
  }
  for (const name of ext.computed) {
    html = html.replace(input(name), (tag) => (/\sreadonly\b/.test(tag) ? tag : tag.replace(/>$/, " readonly data-forecraft-computed>")));
  }
  return html;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cleanMessage(err: unknown): string {
  return String(err instanceof Error ? err.message : err).replace(/^@faqir-ui\/(forms|rules): /, "");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const DEFINITION_KEYS = new Set(["schema", "ui", "rules", "appearance"]);

function checkShape(input: unknown): FormDefinition {
  const errors: { pointer: string; detail: string }[] = [];
  if (!isRecord(input)) throw new DefinitionProblem([{ pointer: "", detail: "The definition must be a JSON object." }]);
  for (const k of Object.keys(input)) {
    if (!DEFINITION_KEYS.has(k)) errors.push({ pointer: `/${k}`, detail: `Unknown key. A definition has schema, ui, rules and appearance.` });
  }
  const schema = input.schema;
  if (!isRecord(schema)) errors.push({ pointer: "/schema", detail: "Required: a JSON Schema object with type \"object\"." });
  else {
    if (schema.type !== "object") errors.push({ pointer: "/schema/type", detail: "The root schema must be type \"object\"." });
    if (typeof schema.title !== "string" || !schema.title.trim()) errors.push({ pointer: "/schema/title", detail: "Required: the form's title." });
    if (!isRecord(schema.properties) || Object.keys(schema.properties).length === 0) {
      errors.push({ pointer: "/schema/properties", detail: "A form needs at least one field." });
    }
  }
  if (input.ui !== undefined && !isRecord(input.ui)) errors.push({ pointer: "/ui", detail: "Must be an object." });
  if (input.rules !== undefined && !isRecord(input.rules)) errors.push({ pointer: "/rules", detail: "Must be an object." });
  if (input.appearance !== undefined) errors.push(...appearanceErrors(input.appearance));
  if (errors.length) throw new DefinitionProblem(errors);
  return input as unknown as FormDefinition;
}

function appearanceErrors(a: unknown): { pointer: string; detail: string }[] {
  const errors: { pointer: string; detail: string }[] = [];
  const at = (k: string, detail: string) => errors.push({ pointer: `/appearance/${k}`, detail });
  if (!isRecord(a)) return [{ pointer: "/appearance", detail: "Must be an object." }];
  const known = new Set(Object.keys(DEFAULT_APPEARANCE));
  for (const k of Object.keys(a)) if (!known.has(k)) at(k, `Unknown key. Known: ${[...known].join(", ")}.`);
  if (a.theme !== undefined && !THEMES.includes(a.theme as string)) at("theme", `Unknown theme. One of: ${THEMES.join(", ")}.`);
  if (a.accent !== undefined && !(ACCENTS as readonly string[]).includes(a.accent as string)) at("accent", `One of: ${ACCENTS.join(", ")}.`);
  if (a.layout !== undefined && !(LAYOUTS as readonly string[]).includes(a.layout as string)) at("layout", `One of: ${LAYOUTS.join(", ")}.`);
  if (a.scheme !== undefined && !(SCHEMES as readonly string[]).includes(a.scheme as string)) at("scheme", `One of: ${SCHEMES.join(", ")}.`);
  if (a.submitLabel !== undefined && (typeof a.submitLabel !== "string" || !a.submitLabel.trim())) at("submitLabel", "A non-empty string.");
  if (a.cover !== undefined && a.cover !== null) {
    if (!isRecord(a.cover)) at("cover", "An object { image, eyebrow } or null.");
    else {
      if (a.cover.image !== undefined && a.cover.image !== "" && !isHttpUrl(a.cover.image)) at("cover/image", "An http(s) URL, a /path on this site, or an empty string.");
      if (a.cover.eyebrow !== undefined && typeof a.cover.eyebrow !== "string") at("cover/eyebrow", "A string.");
    }
  }
  if (a.thankYou !== undefined) {
    if (!isRecord(a.thankYou) || typeof a.thankYou.title !== "string" || typeof a.thankYou.message !== "string") {
      at("thankYou", "An object { title, message } of strings.");
    }
  }
  if (a.redirect !== undefined && a.redirect !== null && a.redirect !== "" && !isHttpUrl(a.redirect)) at("redirect", "An http(s) URL, or null.");
  return errors;
}

function isHttpUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  // A path on this site, e.g. /images/cover.svg: no whitespace, control characters
  // or backslashes, and it must stay on the origin it resolves against.
  if (v.startsWith("/")) {
    if (/[\s\x00-\x1f\x7f\\]/.test(v)) return false;
    return new URL(v, "https://forecraft.invalid").host === "forecraft.invalid";
  }
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  const out = { ...DEFAULT_APPEARANCE, ...(a ?? {}) };
  out.thankYou = { ...DEFAULT_APPEARANCE.thankYou, ...(a?.thankYou ?? {}) };
  out.cover = a?.cover ? { image: a.cover.image ?? "", eyebrow: a.cover.eyebrow ?? "" } : null;
  out.redirect = a?.redirect || null;
  return out;
}

// ── Submissions ───────────────────────────────────────────────────────────

export interface Finding { path: string; rule: string; message: string; params?: Record<string, unknown> }

export interface SubmissionVerdict {
  valid: boolean;
  findings: Finding[];
  /** The coerced answers: declared fields only, hidden fields dropped, computed values in. */
  data: Record<string, unknown>;
}

/**
 * The server's verdict on a submission — the same `coerce` → `validate` pass
 * the `faqir-rules` plugin ran in the browser, on the same definition.
 * `raw` is a JSON object of answers, or form pairs (`URLSearchParams`, `[k, v][]`).
 */
export function checkSubmission(form: CompiledForm, raw: Record<string, unknown> | URLSearchParams): SubmissionVerdict {
  const record = raw instanceof URLSearchParams ? fromFormData(raw) : raw;
  const coerced = coerce(form.rules, record) as Record<string, unknown>;
  const verdict = validate(form.rules, coerced);
  const hidden = (path: string) => verdict.visible[path] === false || verdict.visible[path.replace(/.(d+)(?=.|$)/g, "[$1]")] === false;
  const data = (keep(form.definition.schema, { ...coerced, ...verdict.computed }, "", hidden) ?? {}) as Record<string, unknown>;
  untouched(form.definition.schema, data, "", hidden);
  return { valid: verdict.valid, findings: verdict.findings as Finding[], data };
}

/**
 * An untouched checkbox or switch is an answer — "no" — so a boolean left out
 * is stored as its `default`, or `false` when it has none: the page sends what
 * an untouched control shows (public/form.js), and an API client that omits the
 * field gets the same, so the data never depends on which client sent it.
 * Not for a path a rule hid, and inside a group or a row only when that group
 * or row was answered at all. Runs after validation, so a required boolean
 * that was left out is still refused.
 */
function untouched(schema: { properties?: Record<string, unknown> }, value: Record<string, unknown>, path: string, hidden: (p: string) => boolean): void {
  for (const [name, raw] of Object.entries(schema.properties ?? {})) {
    const at = path ? `${path}.${name}` : name;
    if (hidden(at)) continue;
    const child = raw as { type?: unknown; default?: unknown; properties?: Record<string, unknown>; items?: { properties?: Record<string, unknown> } };
    const v = value[name];
    if (child.type === "boolean" && v === undefined) value[name] = typeof child.default === "boolean" ? child.default : false;
    else if (child.properties && isRecord(v)) untouched(child, v, at, hidden);
    else if (child.items?.properties && Array.isArray(v)) {
      v.forEach((row, i) => { if (isRecord(row)) untouched(child.items!, row, `${at}.${i}`, hidden); });
    }
  }
}

/**
 * What is stored: the declared properties only, at every depth, without the
 * paths a rule hid, and without blanks. Keys the form never declared are dropped.
 */
function keep(schema: { type?: unknown; properties?: Record<string, unknown>; items?: unknown }, value: unknown, path: string, hidden: (p: string) => boolean): unknown {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return undefined;
  if (schema.properties && isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(schema.properties)) {
      const at = path ? `${path}.${name}` : name;
      if (hidden(at)) continue;
      const v = keep(child as typeof schema, value[name], at, hidden);
      if (v !== undefined) out[name] = v;
    }
    return path && Object.keys(out).length === 0 ? undefined : out;
  }
  const items = schema.items as typeof schema | undefined;
  if (Array.isArray(value) && items?.properties) {
    const rows = value.map((row, i) => keep(items, row, `${path}.${i}`, hidden)).filter((r) => r !== undefined);
    return rows.length ? rows : undefined;
  }
  if (schema.properties || items?.properties) return undefined; // a scalar where an object belongs
  return value;
}
