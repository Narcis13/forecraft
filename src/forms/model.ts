// The form model. A form is ONE JSON document — the definition — that the API
// accepts, the designer edits and the public page renders:
//
//   { schema: <JSON Schema>, ui?: <Faqir UI schema>, rules?: <@faqir-ui/rules input>,
//     appearance?: <theme, accent, layout, cover, thank-you> }
//
// The form's title and description are the schema's own root `title` and
// `description`. Everything below derives from that document; nothing here is a
// second model of it.

import { renderForm, type ObjectSchema, type RenderFormOptions, type UISchema } from "@faqir-ui/forms";
import { coerce, compile, fromFormData, lintDefinition, validate } from "@faqir-ui/rules";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

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

/** Accent hues `public/app.css` knows (`[data-accent]`); "theme" keeps the theme's own primary. */
export const ACCENTS = ["theme", "indigo", "violet", "rose", "orange", "amber", "emerald", "teal", "sky"] as const;
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

/** A definition problem, reported to an API client as a 422 that names where it is. */
export class DefinitionProblem extends Error {
  errors: { pointer: string; detail: string }[];
  constructor(errors: { pointer: string; detail: string }[]) {
    super(errors.map((e) => `${e.pointer}: ${e.detail}`).join("; "));
    this.errors = errors;
  }
}

const ID_PREFIX = "fc";
export const FORM_ID = `${ID_PREFIX}-form`;

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
  const { title: _title, description: _description, ...schema } = definition.schema;

  let html: string;
  try {
    html = renderForm(schema as ObjectSchema, definition.ui ?? {}, {
      idPrefix: ID_PREFIX,
      // Always pass rules, so the form always carries its definition — the one
      // the server validates with. See FAQIR-UPSTREAM.md #1.
      rules: definition.rules ?? {},
      i18n: { submitLabel: appearance.submitLabel },
    });
  } catch (err) {
    throw new DefinitionProblem([{ pointer: "/schema", detail: cleanMessage(err) }]);
  }

  const rules = extractRules(html);
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

/** The `<script type="application/json" id="fc-rules">` renderForm wrote. */
function extractRules(html: string): RulesDefinition {
  const match = /<script type="application\/json" id="fc-rules">\n([\s\S]*?)\n<\/script>/.exec(html);
  if (!match) throw new Error("renderForm emitted no rules definition");
  return JSON.parse(match[1]!);
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
  if (/^\/[^/\\]/.test(v)) return true; // a path on this site, e.g. /images/cover.svg
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
export function checkSubmission(form: CompiledForm, raw: Record<string, unknown> | URLSearchParams | [string, string][]): SubmissionVerdict {
  const record = isRecord(raw) ? raw : fromFormData(raw as URLSearchParams);
  const coerced = coerce(form.rules, record) as Record<string, unknown>;
  const verdict = validate(form.rules, coerced);
  const data: Record<string, unknown> = {};
  for (const { name } of form.fields) {
    if (verdict.visible[name] === false) continue;
    const value = name in verdict.computed ? verdict.computed[name] : coerced[name];
    if (value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)) data[name] = value;
  }
  return { valid: verdict.valid, findings: verdict.findings as Finding[], data };
}
