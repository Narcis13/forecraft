// Server-rendered pages: `.faqir` templates compiled once (at first use) with
// @faqir-ui/template and rendered per request with `render`.

import { compile } from "@faqir-ui/template/compile";
import { render } from "@faqir-ui/template";
import { components } from "@faqir-ui/template/registry";
import { createFileLoader } from "@faqir-ui/template/node";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../templates");
const loader = createFileLoader(ROOT);

const HELPERS = {
  /** "2026-10-18T09:12:00Z" → "18 Oct 2026, 09:12" (UTC, so tests and screenshots are stable). */
  datetime: (iso: unknown) => {
    if (typeof iso !== "string" || !iso) return "—";
    const d = new Date(iso);
    return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}, ${d.toISOString().slice(11, 16)}`;
  },
  /** "18 Oct 2026" */
  date: (iso: unknown) => {
    if (typeof iso !== "string" || !iso) return "—";
    const d = new Date(iso);
    return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
  },
  /** A value as JSON text, for a data-prop-* attribute (faqir-core JSON-parses those). */
  tojson: (v: unknown) => JSON.stringify(v),
  /** plural(3, "form") → "3 forms" */
  plural: (n: unknown, word: unknown) => `${n} ${word}${n === 1 ? "" : "s"}`,
  /** Answers as one line of text for a table cell. */
  answer: (v: unknown): string => {
    if (v === undefined || v === null || v === "") return "—";
    if (Array.isArray(v)) {
      if (v.length === 0) return "—";
      if (v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
        return `${v.length} row${v.length === 1 ? "" : "s"}`;
      }
      return v.map((x) => (typeof x === "object" ? HELPERS.answer(x) : String(x))).join(", ");
    }
    if (typeof v === "object") return Object.entries(v as object).map(([k, x]) => `${k}: ${HELPERS.answer(x)}`).join("; ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  },
};

type Ast = NonNullable<ReturnType<typeof compile>["ast"]>;
const compiled = new Map<string, Ast>();
const DEV = process.env.NODE_ENV === "development" || "WATCH_REPORT_DEPENDENCIES" in process.env;

function load(name: string): Ast {
  let ast = compiled.get(name);
  if (ast) return ast;
  const source = loader(name);
  if (source === null) throw new Error(`template not found: ${name}`);
  const result = compile(source, { file: name, loader, components, helpers: Object.keys(HELPERS) });
  if (!result.ast) {
    throw new Error(result.diagnostics.map((d) => `${d.file}:${d.line}:${d.col} ${d.code} ${d.message}`).join("\n"));
  }
  ast = result.ast;
  // Under `node --watch` (npm run dev) templates are re-read on every render.
  if (!DEV) compiled.set(name, ast);
  return ast;
}

/** Compile every template once, so a broken one fails at boot, not on first visit. */
export function precompile(names: string[]): void {
  for (const n of names) load(n);
}

export function page(name: string, data: Record<string, unknown>): string {
  return render(load(name), data, { helpers: HELPERS });
}
