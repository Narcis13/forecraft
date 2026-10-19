// A report's expressions are @faqir-ui/template expressions — one language for
// the whole feature, evaluated by the engine itself, never by `eval`.
//
//   template text  "Invoice {{ doc.number ?? label(\"draft\") }}"  → compiled as `| <text>`
//   bare expression  "items"  /  "doc.money.paid != \"0.00\""        → compiled as `| {{ __v(<expr>) }}`
//
// A bare expression's value comes back through `__v`, a capture helper, so the
// engine's own rules apply to it: own data properties only, `missing` is an
// error unless `??` says the value is optional, no globals.

import { compile } from "@faqir-ui/template/compile";
import { render } from "@faqir-ui/template";
import { HELPER_NAMES } from "./helpers.ts";

type Ast = NonNullable<ReturnType<typeof compile>["ast"]>;

export interface Diagnostic { code: string; message: string; line: number; column: number }

const TEXT_PREFIX = "| ";
const EXPR_PREFIX = "| {{ __v(";
const EXPR_SUFFIX = ") }}";
const NAMES = [...HELPER_NAMES, "__v"];

const cache = new Map<string, Ast>();

function compiled(source: string): Ast | Diagnostic[] {
  const hit = cache.get(source);
  if (hit) return hit;
  const result = compile(source, { file: "expression", helpers: NAMES, raw: false });
  if (!result.ast) return result.diagnostics.map((d) => ({ code: d.code, message: d.message, line: d.line, column: d.col }));
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  cache.set(source, result.ast);
  return result.ast;
}

/** Diagnostics for template text, with columns inside the text itself. */
export function checkText(text: string): Diagnostic[] {
  if (text.includes("\n")) return [{ code: "multi-line", message: "Template text is one line; use a list of lines or a text block for more.", line: 1, column: text.indexOf("\n") + 1 }];
  const r = compiled(TEXT_PREFIX + text);
  return Array.isArray(r) ? r.map((d) => ({ ...d, column: Math.max(1, d.column - TEXT_PREFIX.length) })) : [];
}

export function checkExpr(expr: string): Diagnostic[] {
  if (!expr.trim()) return [{ code: "bad-expr", message: "An empty expression.", line: 1, column: 1 }];
  if (/[\n]/.test(expr)) return [{ code: "multi-line", message: "An expression is one line.", line: 1, column: expr.indexOf("\n") + 1 }];
  // `}}` inside a bare expression would end the hole early.
  if (expr.includes("}}")) return [{ code: "bad-expr", message: "`}}` cannot appear in a bare expression.", line: 1, column: expr.indexOf("}}") + 1 }];
  const r = compiled(EXPR_PREFIX + expr + EXPR_SUFFIX);
  return Array.isArray(r) ? r.map((d) => ({ ...d, column: Math.min(expr.length + 1, Math.max(1, d.column - EXPR_PREFIX.length)) })) : [];
}

/** A value the data does not have: reported by preflight, refused at issue. */
export class MissingData extends Error {
  path: string;
  constructor(path: string, message: string) {
    super(message);
    this.path = path;
  }
}

/** Any other evaluation error (a type mismatch, a helper given nonsense). */
export class EvalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Helpers = Record<string, (...args: unknown[]) => unknown>;

function translate(err: unknown): never {
  const e = err as { code?: string; path?: string; message?: string };
  if (e.code === "missing") throw new MissingData(e.path ?? "?", cleanMessage(e.message));
  throw new EvalError(e.code ?? "error", cleanMessage(e.message));
}

const cleanMessage = (m: unknown) => String(m ?? "").replace(/\s*\(expression:\d+:\d+\)\s*$/, "").replace(/^expression:\d+:\d+:?\s*/, "");

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Template text → plain text (not HTML: the partial that prints it escapes it). */
export function evalText(text: string, scope: Record<string, unknown>, helpers: Helpers): string {
  if (!text.includes("{{")) return text.replace(/\\\{\{/g, "{{");
  const ast = compiled(TEXT_PREFIX + text);
  if (Array.isArray(ast)) throw new EvalError(ast[0]!.code, ast[0]!.message);
  try {
    return unescape(render(ast, scope, { helpers, maxSteps: 10_000, maxOutput: 64 * 1024 }).replace(/\n$/, ""));
  } catch (err) {
    translate(err);
  }
}

export function evalExpr(expr: string, scope: Record<string, unknown>, helpers: Helpers): unknown {
  const ast = compiled(EXPR_PREFIX + expr + EXPR_SUFFIX);
  if (Array.isArray(ast)) throw new EvalError(ast[0]!.code, ast[0]!.message);
  let value: unknown;
  try {
    render(ast, scope, { helpers: { ...helpers, __v: (v: unknown) => { value = v; return ""; } }, maxSteps: 10_000, maxOutput: 1024 });
  } catch (err) {
    translate(err);
  }
  return value;
}
