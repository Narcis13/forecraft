// The `faqir` block: a fragment of Faqir template source for what the block
// vocabulary lacks. It is compiled with `raw: false` and the registry's
// component table (so every call is checked against its manifest), and its AST
// is linted: no `style` or `class` attribute (a custom block still speaks in
// tokens), no faqir-core directive (no client code), no element that loads or
// runs anything. It renders with a small step and output budget.

import { compile } from "@faqir-ui/template/compile";
import { render } from "@faqir-ui/template";
import { components } from "@faqir-ui/template/registry";
import { HELPER_NAMES } from "./helpers.ts";

type Ast = NonNullable<ReturnType<typeof compile>["ast"]>;
export interface FragmentDiagnostic { code: string; message: string; line: number; column: number }

export const FRAGMENT_LIMITS = { bytes: 8 * 1024, steps: 20_000, output: 256 * 1024 };
const REFUSED_TAGS = new Set(["script", "style", "iframe", "frame", "frameset", "object", "embed", "link", "meta", "base", "form", "input", "button", "select", "textarea", "template", "noscript", "svg", "math", "video", "audio", "img", "picture", "source"]);

const cache = new Map<string, Ast>();

export function compileFragment(source: string): { ast: Ast | null; diagnostics: FragmentDiagnostic[] } {
  const hit = cache.get(source);
  if (hit) return { ast: hit, diagnostics: [] };
  if (new TextEncoder().encode(source).length > FRAGMENT_LIMITS.bytes) {
    return { ast: null, diagnostics: [{ code: "too-large", message: `A faqir block holds at most ${FRAGMENT_LIMITS.bytes} bytes.`, line: 1, column: 1 }] };
  }
  const r = compile(source, { file: "faqir-block", components, helpers: HELPER_NAMES, raw: false });
  if (!r.ast) return { ast: null, diagnostics: r.diagnostics.map((d) => ({ code: d.code, message: d.message, line: d.line, column: d.col })) };
  const diagnostics = lint(r.ast);
  if (diagnostics.length) return { ast: null, diagnostics };
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  cache.set(source, r.ast);
  return { ast: r.ast, diagnostics: [] };
}

function lint(ast: Ast): FragmentDiagnostic[] {
  const out: FragmentDiagnostic[] = [];
  const at = (loc: unknown) => (Array.isArray(loc) ? { line: loc[1] as number, column: loc[2] as number } : { line: 1, column: 1 });
  const visit = (nodes: unknown[]) => {
    for (const raw of nodes) {
      const n = raw as { type: string; tag?: string; attrs?: { name: string; col?: number }[]; children?: unknown[]; body?: unknown[]; branches?: { body: unknown[] }[]; else?: unknown[]; loc?: unknown };
      if (n.type === "Element") {
        if (REFUSED_TAGS.has(String(n.tag).toLowerCase())) out.push({ code: "refused-element", message: `<${n.tag}> is not allowed in a faqir block.`, ...at(n.loc) });
        for (const a of n.attrs ?? []) {
          const name = a.name.toLowerCase();
          if (name === "style" || name === "class") out.push({ code: `refused-${name}`, message: `\`${name}\` is not allowed: a faqir block speaks in Faqir's variants and tokens.`, ...at(n.loc), ...(a.col ? { column: a.col } : {}) });
          else if (name.startsWith("l-") || name.startsWith(":") || name.startsWith("@") || name.startsWith("x-")) out.push({ code: "refused-directive", message: `\`${a.name}\`: client directives are not allowed in a document.`, ...at(n.loc) });
        }
      }
      if (n.type === "Raw") out.push({ code: "raw-refused", message: "raw is not allowed.", ...at(n.loc) });
      if (n.type === "Include") out.push({ code: "include-refused", message: "include is not allowed in a faqir block.", ...at(n.loc) });
      for (const k of ["children", "body", "else"] as const) if (Array.isArray(n[k])) visit(n[k]!);
      for (const b of n.branches ?? []) visit(b.body);
    }
  };
  visit(ast.body as unknown[]);
  for (const p of Object.values(ast.partials ?? {})) visit(p as unknown[]);
  return out;
}

/** The fragment's markup, with the document's data and helpers in scope. */
export function renderFragment(source: string, scope: Record<string, unknown>, helpers: Record<string, (...a: unknown[]) => unknown>): string {
  const { ast, diagnostics } = compileFragment(source);
  if (!ast) throw new Error(diagnostics[0]?.message ?? "faqir block does not compile");
  return render(ast, scope, { helpers, idPrefix: "fq", maxSteps: FRAGMENT_LIMITS.steps, maxOutput: FRAGMENT_LIMITS.output })
    // The engine's @ui:requires comment belongs to whole pages, not to a fragment.
    .replace(/^<!-- @ui:requires[^>]*-->\n/, "");
}
