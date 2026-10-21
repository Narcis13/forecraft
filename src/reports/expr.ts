// A report's expressions are @faqir-ui/template expressions — one language for
// the whole feature, evaluated by the engine itself, never by `eval`.
//
//   template text  "Invoice {{ doc.number ?? label(\"draft\") }}"  → compiled as `| <text>`
//   bare expression  "items"  /  "doc.money.paid != \"0.00\""        → compiled as `| {{ __v(<expr>) }}`
//
// A bare expression's value comes back through `__v`, a capture helper, so the
// engine's own rules apply to it: own data properties only, `missing` is an
// error unless `??` says the value is optional, no globals.
//
// Three things forecraft adds to the engine's language, before and after it parses:
//   [a, b] and []         list literals, read as the capture helper __list(a, b)
//   question("seats")     the summary question by name: the path __q["seats"], so
//                         .mean, ?? and missing-data work as on any path
//   guards                a bare path tested by `? :`, `!`, or on the left of && and ||
//                         is optional there (missing reads as null): `a ? a.b : "—"`
//                         and `a && a.b` check before they read, as they say.

import { compile } from "@faqir-ui/template/compile";
import { render } from "@faqir-ui/template";
import { HELPER_NAMES } from "./helpers.ts";

type Ast = NonNullable<ReturnType<typeof compile>["ast"]>;

export interface Diagnostic { code: string; message: string; line: number; column: number }

const TEXT_PREFIX = "| ";
const EXPR_PREFIX = "| {{ __v(";
const EXPR_SUFFIX = ") }}";
const NAMES = [...HELPER_NAMES, "__v", "__list"];

/** The scope name of the questions-by-name index `question("…")` reads. */
export const QUESTIONS_INDEX = "__q";

// ── Before the parse: list literals and question("…") ───────────────────────

/**
 * Rewrite the holes of `source` (a `| text` line) so the engine can parse
 * them, with a map from each output character to its source column, so a
 * diagnostic still points at what the author wrote.
 */
export function desugar(source: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  const emit = (s: string, at: number) => { out += s; for (let k = 0; k < s.length; k++) map.push(at); };
  const copy = (from: number, to: number) => { for (let k = from; k < to; k++) { out += source[k]; map.push(k); } };
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{{", i);
    if (open === -1) { copy(i, source.length); break; }
    if (source[open - 1] === "\\") { copy(i, open + 2); i = open + 2; continue; }
    copy(i, open + 2);
    i = open + 2;
    // Inside a hole: until its `}}`, outside strings.
    const stack: ("list" | "index" | "paren" | "question")[] = [];
    let value = false; // the last token ends a value: a `[` after it indexes
    while (i < source.length) {
      const c = source[i]!;
      if (c === "}" && source[i + 1] === "}") break;
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
        copy(i, Math.min(j + 1, source.length));
        i = j + 1;
        value = true;
        continue;
      }
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      if (word) {
        const before = source.slice(0, i).trimEnd().at(-1);
        const call = /^question\s*\(/.exec(source.slice(i));
        if (word[0] === "question" && call && before !== ".") {
          emit(`${QUESTIONS_INDEX}[`, i);
          stack.push("question");
          i += call[0].length;
          value = false;
          continue;
        }
        copy(i, i + word[0].length);
        i += word[0].length;
        value = true;
        continue;
      }
      const num = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (num) { copy(i, i + num[0].length); i += num[0].length; value = true; continue; }
      if (c === " ") { copy(i, i + 1); i++; continue; }
      if (c === "[") {
        if (value) { stack.push("index"); copy(i, i + 1); } else { stack.push("list"); emit("__list(", i); }
        i++; value = false; continue;
      }
      if (c === "(") { stack.push("paren"); copy(i, i + 1); i++; value = false; continue; }
      if (c === "]" || c === ")") {
        const top = stack.pop();
        emit(top === "list" ? ")" : top === "question" ? "]" : c, i);
        i++; value = true; continue;
      }
      copy(i, i + 1);
      i++;
      value = false;
    }
  }
  return { text: out, map };
}

// ── After the parse: guards ─────────────────────────────────────────────────

type Node = { type?: string; op?: string; [k: string]: unknown };
const optional = (n: Node): Node => ({ type: "Binary", op: "??", left: n, right: { type: "Literal", value: null } });

/** A condition: a bare path in it is optional, through `!`, `&&` and `||`. */
function guard(n: Node): Node {
  if (n.type === "Path") return optional(n);
  if (n.type === "Unary" && n.op === "!") return { ...n, arg: guard(n.arg as Node) };
  if (n.type === "Binary" && (n.op === "&&" || n.op === "||")) return { ...n, left: guard(n.left as Node), right: guard(n.right as Node) };
  return n;
}

/** Rewrite every guard in an expression tree (in place: the tree is ours, fresh from compile). */
function guards(node: unknown): void {
  if (Array.isArray(node)) { node.forEach(guards); return; }
  if (typeof node !== "object" || node === null) return;
  const n = node as Node;
  if (n.type === "Cond") n.test = guard(n.test as Node);
  else if (n.type === "Unary" && n.op === "!") n.arg = guard(n.arg as Node);
  else if (n.type === "Binary" && (n.op === "&&" || n.op === "||")) n.left = guard(n.left as Node);
  for (const v of Object.values(n)) guards(v);
}

const cache = new Map<string, Ast>();

function compiled(source: string): Ast | Diagnostic[] {
  const hit = cache.get(source);
  if (hit) return hit;
  const { text, map } = desugar(source);
  const result = compile(text, { file: "expression", helpers: NAMES, raw: false });
  // Columns back in the author's text (1-based both sides).
  const column = (col: number) => (col - 1 < map.length ? map[col - 1]! : source.length + (col - 1 - map.length)) + 1;
  if (!result.ast) return result.diagnostics.map((d) => ({ code: d.code, message: d.message.replace(/__list\(/g, "[").replace(/__q\[/g, "question("), line: d.line, column: column(d.col) }));
  guards(result.ast);
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
  if (e.code === "missing") throw new MissingData(authored(e.path ?? "?"), cleanMessage(e.message));
  throw new EvalError(e.code ?? "error", cleanMessage(e.message));
}

/** Engine paths as the author wrote them: `__q["seats"]` is `question("seats")`. */
const authored = (s: string) => s.replace(/__q\[("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\]]*)\]/g, "question($1)");
const cleanMessage = (m: unknown) => authored(String(m ?? "").replace(/\s*\(expression:\d+:\d+\)\s*$/, "").replace(/^expression:\d+:\d+:?\s*/, ""));

/** A list literal's value. */
const list = (...items: unknown[]) => items;

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Template text → plain text (not HTML: the partial that prints it escapes it). */
export function evalText(text: string, scope: Record<string, unknown>, helpers: Helpers): string {
  if (!text.includes("{{")) return text.replace(/\\\{\{/g, "{{");
  const ast = compiled(TEXT_PREFIX + text);
  if (Array.isArray(ast)) throw new EvalError(ast[0]!.code, ast[0]!.message);
  try {
    return unescape(render(ast, scope, { helpers: { ...helpers, __list: list }, maxSteps: 10_000, maxOutput: 64 * 1024 }).replace(/\n$/, ""));
  } catch (err) {
    translate(err);
  }
}

export function evalExpr(expr: string, scope: Record<string, unknown>, helpers: Helpers): unknown {
  const ast = compiled(EXPR_PREFIX + expr + EXPR_SUFFIX);
  if (Array.isArray(ast)) throw new EvalError(ast[0]!.code, ast[0]!.message);
  let value: unknown;
  try {
    render(ast, scope, { helpers: { ...helpers, __list: list, __v: (v: unknown) => { value = v; return ""; } }, maxSteps: 10_000, maxOutput: 1024 });
  } catch (err) {
    translate(err);
  }
  return value;
}
