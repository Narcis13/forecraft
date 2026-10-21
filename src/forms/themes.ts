// The form themes as a person picks them: a name and a swatch, not a file slug.
// Each scoped theme file declares its colours as custom properties, often through
// a palette of its own and `light-dark()`; the swatch resolves those to the light
// scheme's plain colour values once, at start-up, so the picker needs no theme CSS.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEMES } from "./model.ts";

export interface ThemeInfo {
  id: string;
  /** "Swiss document", not "swiss-document". */
  name: string;
  /** The theme's own one-line description, when it has one worth showing. */
  note: string;
  swatch: { bg: string; fg: string; primary: string; surface: string };
}

const dir = join(import.meta.dirname, "../../ui");

/** Every `--name: value;` in a stylesheet, first declaration wins (the light scheme comes first). */
function declarations(css: string, into: Map<string, string>): void {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    if (!into.has(m[1]!)) into.set(m[1]!, m[2]!.trim());
  }
}

/** The first argument of a top-level `light-dark(a, b)`. */
function lightSide(value: string): string {
  const m = /^light-dark\((.*)\)$/s.exec(value.trim());
  if (!m) return value;
  let depth = 0;
  for (let i = 0; i < m[1]!.length; i++) {
    const ch = m[1]![i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return m[1]!.slice(0, i).trim();
  }
  return m[1]!;
}

function resolve(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 8) return value;
  const v = lightSide(value);
  const out = v.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]+))?\)/g, (_m, name: string, fallback?: string) => {
    const found = vars.get(name);
    return found !== undefined ? resolve(found, vars, depth + 1) : (fallback ?? "transparent");
  });
  return out === v ? out : resolve(out, vars, depth + 1);
}

const base = new Map<string, string>();
declarations(readFileSync(join(dir, "tokens/index.css"), "utf8"), base);

function info(id: string): ThemeInfo {
  const css = readFileSync(join(dir, `themes/${id}.scoped.css`), "utf8");
  const vars = new Map<string, string>();
  declarations(css, vars);
  for (const [k, v] of base) if (!vars.has(k)) vars.set(k, v);
  const color = (name: string, fallback: string) => {
    const raw = vars.get(name);
    const v = raw === undefined ? fallback : resolve(raw, vars);
    // Anything still unresolved would paint nothing; show the neutral instead.
    return /var\(|light-dark/.test(v) ? fallback : v;
  };
  const described = /@ui:theme [\w-]+ — ([^*]+?)\s*\*\//.exec(css)?.[1] ?? "";
  // "generated from #c8f000" and "brand-matched, print-optimized…" say nothing to a person.
  const note = /^generated from|^one :root block|^brand-matched/.test(described) ? "" : described.split(/[;:]/)[0]!.trim();
  const name = id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return {
    id,
    name: id === "default" ? "Default" : name,
    note: note ? note[0]!.toUpperCase() + note.slice(1) : "",
    swatch: {
      bg: color("--color-bg", "white"),
      fg: color("--color-fg", "black"),
      primary: color("--color-primary", "black"),
      surface: color("--color-surface-1", color("--color-bg", "white")),
    },
  };
}

export const THEME_INFO: ThemeInfo[] = THEMES.map(info);
