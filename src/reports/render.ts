// The renderer: a compiled definition plus data becomes ONE HTML document — a
// `document` pattern page in the report's print theme — through the block
// partials in templates/reports/. This is the only code that knows how a block
// becomes markup; the definition says what, the partials and print.css say how.
//
// Evaluation runs every expression through @faqir-ui/template (src/reports/expr.ts).
// A missing value is not silently empty: it becomes a `missing-data` finding
// naming the block and the path, and the page shows ‹path› where it would be.

import { page } from "../render/index.ts";
import { computeMoney, MoneyError, type DocMoney } from "./money.ts";
import { evalExpr, evalText, EvalError, MissingData } from "./expr.ts";
import { makeHelpers } from "./helpers.ts";
import { labelsFor, type Labels } from "./labels.ts";
import { MAX_COLUMNS, TYPE_PAIRINGS, type Appearance, type Block, type CompiledReport } from "./model.ts";
import { renderFragment } from "./fragment.ts";
import { layoutChart } from "./chart.ts";
import type { MdBlock, Run } from "./markdown.ts";

export type Severity = "error" | "warning";
export interface Finding { severity: Severity; code: string; message: string; block: string | null; page?: number; path?: string }

export interface SubmissionView {
  id: string;
  created_at: string;
  form: { id: string; title: string };
  /** In form order: scalars as labelled values, repeatable groups as tables. */
  groups: ({ label: string; items: { label: string; value: string; mono: boolean }[] } | { label: string; table: { head: string[]; rows: string[][] } })[];
}

export interface DocMeta {
  id?: string;
  number: string | null;
  status: "draft" | "issued" | "void";
  issuedAt: string | null;
  locale?: string | null;
  currency?: string | null;
  submission?: SubmissionView | null;
}

export interface ShareView { title: string; pdf: string; link: string; filename: string; badge: string | null; badgeVariant: string }

export interface RenderInput {
  report: CompiledReport;
  data: Record<string, unknown>;
  doc: DocMeta;
  mode?: "print" | "share" | "canvas";
  share?: ShareView;
  /** An asset's media type, so a vector logo is not judged by its pixels. */
  assetType?: (id: string) => string | undefined;
  /** The document pattern's variant; the submission record uses "form". */
  variant?: "form" | "invoice";
}

export interface Rendered {
  html: string;
  /** The page area's size in mm (the left margin is padding inside it): what a layout probe must use. */
  sheet: { width: number; height: number };
  /** The document's name in lists (documentTitle, evaluated). */
  name: string;
  /** <title> and the PDF's title metadata. */
  title: string;
  filename: string;
  lang: string;
  findings: Finding[];
  money: DocMoney | null;
  appearance: Appearance;
}

// ── Paper geometry, in millimetres ─────────────────────────────────────────

const MARGINS = {
  narrow: { top: 12, right: 12, bottom: 14, left: 14 },
  normal: { top: 15, right: 18, bottom: 16, left: 20 },
  wide: { top: 20, right: 22, bottom: 20, left: 25 },
} as const;
/** DIN 5008 Form B, for window letters: 25 mm left, 20 mm right. */
const LETTER_MARGINS = { top: 15, right: 20, bottom: 16, left: 25 };

export function geometry(a: Appearance, footerLines: number) {
  const m = a.letter.window || a.letter.foldMarks ? LETTER_MARGINS : MARGINS[a.margins];
  const paper = a.paper === "letter" ? { w: 215.9, h: 279.4, css: "letter" } : { w: 210, h: 297, css: "A4" };
  const [w, h] = a.orientation === "landscape" ? [paper.h, paper.w] : [paper.w, paper.h];
  // The running footer lives in the bottom margin, which grows with its lines
  // (7.5 pt on 1.35 leading ≈ 3.6 mm a line, plus the rule and its gap).
  const footer = Math.round((5 + Math.max(1, footerLines) * 3.6) * 10) / 10;
  const margins = { ...m, bottom: Math.max(m.bottom, footer + 3) };
  return { margins, paperCss: paper.css, width: w, height: h, footer };
}

/** A CSS string literal: quotes, backslashes, newlines and `<` escaped. */
const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ").replace(/</g, "\\3C ")}"`;

/**
 * What only this document knows, as one <style>: paper size and margins (an
 * @page rule cannot be scoped to an element), the one accent (no runtime accent
 * in Faqir), and the page counter in the document's language (the pattern's is
 * an English literal). Everything else is print.css. FAQIR-UPSTREAM.md #32, #33.
 */
function documentCss(a: Appearance, labels: Labels, running: string, footer: string[]): string {
  const g = geometry(a, footer.length);
  const m = g.margins;
  const pairing = TYPE_PAIRINGS[a.type] as { text: string; labels?: string };
  const label = pairing.labels ?? pairing.text;
  const parts = labels.page.split(/(\{n\}|\{total\})/).filter(Boolean)
    .map((p) => (p === "{n}" ? "counter(page)" : p === "{total}" ? "counter(pages)" : cssString(p)));
  if (!/[^"]/.test(a.accent) || !/^#[0-9a-fA-F]{6}$/.test(a.accent)) throw new Error("accent must be validated before rendering");
  return [
    ":root {",
    `  --report-accent: ${a.accent};`,
    `  --page-format: ${g.paperCss}; --page-orientation: ${a.orientation};`,
    `  --page-margin-top: ${m.top}mm; --page-margin-right: ${m.right}mm; --page-margin-bottom: ${m.bottom}mm; --page-margin-left: ${m.left}mm;`,
    `  --report-sheet-width: ${g.width}mm; --report-sheet-height: ${g.height}mm;`,
    "}",
    // The left page margin is 0 and rebuilt as padding (print.css), so marks
    // and the envelope window can sit at exact sheet coordinates; the margin
    // boxes are moved back onto the content edge with margin-left.
    // The running header and footer are margin-box strings, so page 1 drops
    // the header (@page :first) and the footer shares its line with the page
    // counter (FAQIR-UPSTREAM.md #39, #47).
    `@page { size: ${g.paperCss} ${a.orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm 0;`,
    `  @top-left { content: ${cssString(running)}; margin-left: ${m.left}mm; font-family: ${cssString(label)}; font-size: 6.75pt; letter-spacing: 0.12em; text-transform: uppercase; color: #595959; vertical-align: bottom; padding-bottom: 2.5mm; border-bottom: 0.5pt solid #b8b8b8; }`,
    `  @bottom-left { content: ${cssString(footer.join("\n"))}; white-space: pre-wrap; margin-left: ${m.left}mm; font-family: ${cssString(pairing.text)}; font-size: 7.5pt; line-height: 1.35; color: #595959; vertical-align: top; padding-top: 2.5mm; border-top: 0.5pt solid #b8b8b8; }`,
    `  @bottom-right { content: ${parts.join(" ")}; white-space: nowrap; font-family: ${cssString(pairing.text)}; font-size: 7.5pt; line-height: 1.35; color: #595959; vertical-align: top; padding-top: 2.5mm; padding-left: 6mm; border-top: 0.5pt solid #b8b8b8; font-variant-numeric: tabular-nums; }`,
    "}",
    "@page :first { @top-left { content: none; border: 0; } }",
  ].join("\n");
}

// ── Evaluation ──────────────────────────────────────────────────────────────

type Helpers = ReturnType<typeof makeHelpers>;
type View = Record<string, unknown>;

class Evaluator {
  findings: Finding[] = [];
  report: CompiledReport;
  helpers: Helpers;
  labels: Labels;
  money: DocMoney | null;
  assetUrl: (id: string) => string;
  assetType: (id: string) => string | undefined = () => undefined;
  constructor(report: CompiledReport, helpers: Helpers, labels: Labels, money: DocMoney | null, assetUrl: (id: string) => string) {
    this.report = report;
    this.helpers = helpers;
    this.labels = labels;
    this.money = money;
    this.assetUrl = assetUrl;
  }

  private fail(block: Block, err: unknown, source: string): string {
    if (err instanceof MissingData) {
      this.findings.push({ severity: "error", code: "missing-data", message: `${err.path} is missing in the data (in ${JSON.stringify(source)}). Add it, or write ${err.path} ?? "…" if it is optional.`, block: block.id, path: err.path });
      return `‹${err.path}›`;
    }
    const e = err as EvalError;
    this.findings.push({ severity: "error", code: "expression-error", message: `${e.message} (in ${JSON.stringify(source)})`, block: block.id });
    return "‹?›";
  }

  text(block: Block, t: unknown, scope: View): string {
    if (typeof t !== "string") return "";
    try {
      return evalText(t, scope, this.helpers);
    } catch (err) {
      return this.fail(block, err, t);
    }
  }

  value(block: Block, e: unknown, scope: View, fallback: unknown): unknown {
    if (typeof e !== "string") return fallback;
    try {
      return evalExpr(e, scope, this.helpers);
    } catch (err) {
      this.fail(block, err, e);
      return fallback;
    }
  }

  array(block: Block, e: unknown, scope: View): unknown[] {
    const v = this.value(block, e, scope, []);
    if (Array.isArray(v)) return v;
    this.findings.push({ severity: "error", code: "missing-data", message: `${e} is not an array (rows must be a list).`, block: block.id, path: String(e) });
    return [];
  }

  pairs(block: Block, list: unknown, scope: View) {
    return ((list as { label: string; value: string; mono?: boolean }[] | undefined) ?? []).map((p) => ({
      label: this.text(block, p.label, scope), value: this.text(block, p.value, scope), mono: p.mono === true,
    }));
  }

  md(block: Block, source: unknown, scope: View): View[] {
    const blocks = this.report.markdown.get(String(source)) ?? [];
    // A link whose data supplies a scheme the engine refuses becomes plain text and a finding, not a crash.
    const safe = (href: string) => {
      if (/^(https?:|mailto:|tel:)/i.test(href.replace(/[\s\x00-\x1f]/g, "")) || !/^[a-z][a-z0-9+.-]*:/i.test(href.replace(/[\s\x00-\x1f]/g, ""))) return href;
      this.findings.push({ severity: "error", code: "expression-error", message: `A link resolved to ${JSON.stringify(href.slice(0, 40))}: links are http(s), mailto or tel.`, block: block.id });
      return undefined;
    };
    const runs = (rs: Run[]) => tidyRuns(rs.map((r) => {
      const run: Run = { ...r, text: this.text(block, r.text, scope) };
      if (r.href) {
        const h = safe(this.text(block, r.href, scope));
        if (h) run.href = h;
        else delete run.href;
      }
      return run;
    }));
    const out: View[] = [];
    for (const m of blocks as MdBlock[]) {
      if ("items" in m) { out.push({ t: m.t, items: m.items.map(runs) }); continue; }
      // Data is text, never markdown: but a value with blank lines is paragraphs,
      // and a single line break is a line break.
      const paragraphs: Run[][] = [[]];
      for (const r of runs(m.runs)) {
        if (r.br || !/\n/.test(r.text)) { paragraphs.at(-1)!.push(r); continue; }
        r.text.split(/\n\s*\n/).forEach((para, i) => {
          if (i > 0 && m.t === "p") paragraphs.push([]);
          para.split("\n").forEach((line, j) => {
            if (j > 0) paragraphs.at(-1)!.push({ text: "", br: true });
            if (line.trim()) paragraphs.at(-1)!.push({ ...r, text: line.trim() });
          });
        });
      }
      for (const p of paragraphs) if (p.length) out.push({ t: m.t, runs: p });
    }
    return out;
  }

  blocks(list: Block[], scope: View, depth: number, numbering: number[]): View[] {
    const out: View[] = [];
    let section = 0;
    for (const b of list) {
      if (b.block === "footer" || b.block === "watermark") continue; // hoisted
      if (b.when !== undefined && !this.value(b, b.when, scope, false)) continue;
      if (b.block === "section") section++;
      const v = this.block(b, scope, depth, b.block === "section" ? [...numbering, section] : numbering);
      if (v) out.push({ ...v, id: b.id, block: b.block, keep: b.keep ?? false });
    }
    return out;
  }

  block(b: Block, scope: View, depth: number, numbering: number[]): View | null {
    const t = (x: unknown) => this.text(b, x, scope);
    switch (b.block) {
      case "letterhead": {
        // The block's own logo, else the report's (appearance.logo).
        const ref = typeof b.logo === "string" ? b.logo : this.report.appearance.logo;
        const logo = ref ? { src: this.assetUrl(ref.slice(6)), alt: t(b.name), vector: this.assetType(ref.slice(6)) === "image/svg+xml" } : null;
        return { name: t(b.name), logo, lines: ((b.lines as string[]) ?? []).map(t).filter(Boolean), details: this.pairs(b, b.details, scope) };
      }
      case "title": {
        const details = this.pairs(b, b.details, scope);
        return { eyebrow: b.eyebrow ? t(b.eyebrow) : false, text: t(b.text), details, cols: String(Math.min(4, Math.max(2, details.length))), cover: depth === 0 && this.isCover(b) };
      }
      case "parties": {
        const parties = ((b.parties as Block[]) ?? []).map((p) => ({
          label: p.label ? t(p.label) : false, name: t(p.name), lines: ((p.lines as string[]) ?? []).map(t).filter(Boolean), details: this.pairs(b, p.details, scope),
        }));
        const window = this.report.appearance.letter.window && depth === 0 && this.isFirstParties(b) ? parties.shift() : undefined;
        return {
          window: window ? [window.name, ...window.lines] : false,
          parties,
          cols: String(Math.max(1, Math.min(3, parties.length))),
        };
      }
      case "facts": return { items: this.pairs(b, b.items, scope), cols: (b.cols as string) ?? String(Math.min(4, Math.max(2, ((b.items as unknown[]) ?? []).length))) };
      case "table": return this.table(b, scope);
      case "totals": return this.totals(b, scope);
      case "text": return { md: this.md(b, b.markdown, scope), size: (b.size as string) ?? "body" };
      case "callout": return { title: b.title ? t(b.title) : false, aria: b.title ? t(b.title) : this.labels.paymentTerms, md: this.md(b, b.markdown, scope), tone: (b.tone as string) ?? "muted" };
      case "stats": {
        const items = ((b.items as Block[]) ?? []).map((s) => ({ label: t(s.label), value: t(s.value), change: s.change ? t(s.change) : false, trend: (s.trend as string) ?? "neutral" }));
        return { items, cols: String([1, 2, 3, 4, 4, 6, 6][items.length] ?? 3) };
      }
      case "bars": {
        const rows = this.array(b, b.rows, scope).map((row, i) => ({ row, s: { ...scope, row, i } }));
        const values = rows.map(({ s }) => Number(this.value(b, b.value, s, 0)) || 0);
        const max = b.max !== undefined ? Number(this.value(b, b.max, scope, 0)) || Math.max(...values, 0) : Math.max(...values, 0);
        return {
          title: b.title ? t(b.title) : false,
          rows: rows.map(({ s }, i) => {
            const pct = max > 0 ? Math.round((values[i]! / max) * 1000) / 10 : 0;
            return { label: this.text(b, b.label, s), display: b.display ? this.text(b, b.display, s) : this.helpers.number!(values[i]) as string, pct, state: { pct } };
          }),
        };
      }
      case "chart": {
        const rows = this.array(b, b.rows, scope);
        const series = (b.series as { name: string; value: string }[]).map((se) => ({ name: t(se.name), values: rows.map((row, i) => Number(this.value(b, se.value, { ...scope, row, i }, 0)) || 0) }));
        const labels = rows.map((row, i) => this.text(b, b.label, { ...scope, row, i }));
        const format = (b.format as string) ?? "number";
        // One number of decimals for every figure in the chart (7.4, 8.0, 8.7 — not 8).
        const digits = Math.min(2, Math.max(0, ...series.flatMap((s) => s.values).map((v) => (String(v).split(".")[1] ?? "").length)));
        const fmt = (v: number) => (format === "currency" ? this.helpers.money!(v) : format === "percent" ? this.helpers.percent!(v, digits) : this.helpers.number!(v, digits)) as string;
        const title = b.title ? t(b.title) : "";
        return {
          kind: b.kind, title: title || false, caption: b.caption ? t(b.caption) : false,
          // Marks carry compact figures (the title names the unit); the table under the chart carries them in full.
          svg: layoutChart(b.kind as "bar" | "column" | "line", labels, series, format === "currency" ? this.tick(format) : fmt, title || this.labels.table, this.tick(format)),
          tableCaption: `${title || this.labels.table}`,
          table: { head: [{ text: "", align: "left" }, ...series.map((s) => ({ text: s.name, align: "right" }))], rows: labels.map((l, i) => [l, ...series.map((s) => fmt(s.values[i]!))]) },
        };
      }
      case "quote": {
        // With rows, one quote per row (verbatims); `row` is in scope.
        const scopes = b.rows !== undefined ? this.array(b, b.rows, scope).map((row, i) => ({ ...scope, row, i })) : [scope];
        return { quotes: scopes.map((s) => ({ text: this.text(b, b.text, s), name: b.name ? this.text(b, b.name, s) || false : false, role: b.role ? this.text(b, b.role, s) || false : false })) };
      }
      case "section": {
        const number = b.numbered ? `${numbering.join(".")}${numbering.length === 1 ? "." : ""}` : false;
        return { title: t(b.title), number, blocks: this.blocks((b.blocks as Block[]) ?? [], scope, depth + 1, b.numbered ? numbering : []) };
      }
      case "columns": {
        const cols = b.columns as Block[][];
        return { cols: String(cols.length), columns: cols.map((c) => this.blocks(c, scope, depth + 1, numbering)) };
      }
      case "signature": {
        const sigs = ((b.signatures as Block[]) ?? []).map((s) => ({ name: t(s.name), role: s.role ? t(s.role) : false, date: s.date ? t(s.date) : false }));
        return { signatures: sigs, cols: String(Math.max(2, sigs.length)) };
      }
      case "qr": case "barcode": {
        const value = t(b.value);
        return { value, caption: b.caption ? t(b.caption) : false, size: (b.size as string) ?? (b.block === "qr" ? "md" : "sm"), aria: `${b.block === "qr" ? "QR code" : "Barcode"}: ${b.caption ? t(b.caption) : value.split("\n")[0]}` };
      }
      case "image": return { src: this.assetUrl(String(b.src).slice(6)), vector: this.assetType(String(b.src).slice(6)) === "image/svg+xml", alt: t(b.alt), caption: b.caption ? t(b.caption) : false, size: (b.size as string) ?? "full" };
      case "stamp": return { text: t(b.text), tone: (b.tone as string) ?? "default" };
      case "separator": case "page-break": return {};
      case "answers": {
        const sub = (scope.doc as { submission?: SubmissionView | null }).submission;
        if (!sub) {
          this.findings.push({ severity: "error", code: "missing-data", message: "The answers block needs a submission: set source.kind to \"submission\" and issue the document from one.", block: b.id, path: "doc.submission" });
          return { title: b.title ? t(b.title) : false, groups: [] };
        }
        return { title: b.title ? t(b.title) : false, groups: sub.groups };
      }
      case "faqir": {
        try {
          return { html: renderFragment(String(b.source), scope, this.helpers) };
        } catch (err) {
          this.fail(b, err instanceof MissingData || err instanceof EvalError ? err : translateRender(err), "faqir block");
          return { html: "" };
        }
      }
    }
    return null;
  }

  /** Axis ticks: compact figures (1.2 M, 1,2 Mio.), so a scale never crowds the plot. */
  private tick(format: string): (v: number) => string {
    const { locale, currency } = this.report.appearance;
    const loc = this.locale ?? locale;
    if (format === "percent") return (v) => this.helpers.percent!(v, 0) as string;
    const nf = new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1, ...(format === "currency" ? { style: "currency", currency: this.currency ?? currency } : {}) });
    return (v) => nf.format(v);
  }

  locale: string | null = null;
  currency: string | null = null;

  /** A title before the first page break, with no table or parties in between, is a cover. */
  private isCover(b: Block): boolean {
    const layout = this.report.definition.layout;
    const at = layout.indexOf(b);
    const brk = layout.findIndex((x) => x.block === "page-break");
    return at >= 0 && brk > at && !layout.slice(0, brk).some((x) => x.block === "table" || x.block === "parties" || x.block === "letterhead");
  }

  private isFirstParties(b: Block): boolean {
    return this.report.definition.layout.find((x) => x.block === "parties") === b;
  }

  table(b: Block, scope: View): View {
    const columns = (b.columns as { label: string; value: string; note?: string; format?: string; align?: string; width?: string }[]);
    const moneyLines = this.report.definition.money?.lines;
    const rowsExpr = String(b.rows);
    const rows = this.array(b, b.rows, scope);
    const out = rows.map((row, i) => {
      const s: View = { ...scope, row, i };
      if (this.money && rowsExpr === moneyLines) s.line = this.money.lines[i];
      return columns.map((c) => ({ text: this.text(b, c.value, s), note: c.note ? this.text(b, c.note, s) || false : false }));
    });
    const max = MAX_COLUMNS[this.report.appearance.orientation];
    if (columns.length > max) {
      this.findings.push({ severity: "error", code: "too-many-columns", message: `${columns.length} columns do not fit ${this.report.appearance.paper.toUpperCase()} ${this.report.appearance.orientation} legibly (at most ${max}). Drop columns, or use landscape.`, block: b.id });
    }
    return {
      caption: b.caption ? this.text(b, b.caption, scope) : false,
      columns: columns.map((c) => {
        const numeric = c.format === "number" || c.format === "currency" || c.format === "percent";
        return { label: this.text(b, c.label, scope), format: numeric ? c.format : false, align: c.align ?? (numeric ? "right" : false), width: c.width && c.width !== "auto" ? c.width : false };
      }),
      rows: out,
      span: columns.length,
      empty: b.empty ? this.text(b, b.empty, scope) : this.labels.none,
      footer: this.pairs(b, b.footer, scope),
    };
  }

  totals(b: Block, scope: View): View {
    if (Array.isArray(b.items)) {
      return { rows: (b.items as { label: string; value: string; emphasis?: boolean }[]).map((r) => ({ label: this.text(b, r.label, scope), value: this.text(b, r.value, scope), kind: r.emphasis ? "total" : "item" })) };
    }
    const m = this.money;
    if (!m) {
      this.findings.push({ severity: "error", code: "missing-data", message: "A totals block without items needs the definition's `money` (lines, quantity, unitPrice, …).", block: b.id, path: "doc.money" });
      return { rows: [] };
    }
    const L = this.labels;
    const money = (v: string) => this.helpers.money!(v) as string;
    const pct = (r: string) => this.helpers.percent!(r) as string;
    const rows: View[] = [{ label: L.subtotal, value: money(m.subtotal), kind: "subtotal" }];
    if (m.discount !== (0).toFixed(m.digits)) rows.unshift({ label: L.discount, value: money(`-${m.discount}`), kind: "item" });
    for (const tx of m.taxes) {
      if (m.taxes.length === 1 && tx.rate === "0") continue;
      rows.push({ label: `${L.vat} ${pct(tx.rate)} · ${money(tx.base)}`, value: money(tx.tax), kind: "tax" });
    }
    const zero = (0).toFixed(m.digits);
    if (m.paid !== zero) {
      rows.push({ label: L.total, value: money(m.total), kind: "total" });
      rows.push({ label: L.paid, value: money(`-${m.paid}`), kind: "paid" });
      rows.push({ label: L.amountDue, value: money(m.due), kind: "due" });
    } else {
      // Nothing paid: the total is what is due; one row, not two of the same figure.
      rows.push({ label: b.due === false ? L.total : L.amountDue, value: money(m.total), kind: b.due === false ? "total" : "due" });
    }
    return { rows };
  }
}

function translateRender(err: unknown): EvalError {
  const e = err as { code?: string; message?: string };
  return new EvalError(e.code ?? "error", String(e.message ?? err));
}

/**
 * Runs render one per line, and a line break between inline siblings reads as
 * a space (the engine's whitespace rule, FAQIR-UPSTREAM.md #26). So trim each
 * run's edges, and give closing punctuation to the run before it — "us." not
 * "us ." after a link.
 */
function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (r.br) { out.push(r); continue; }
    let text = r.text;
    const prev = out.at(-1);
    const lead = /^[.,;:!?)\]»”’%]+/.exec(text);
    if (prev && !prev.br && lead && (prev.b || prev.i || prev.code || prev.href)) {
      prev.text += lead[0];
      text = text.slice(lead[0].length);
    }
    text = text.trim();
    if (text) out.push({ ...r, text });
  }
  return out;
}

// ── The document ────────────────────────────────────────────────────────────

/** The view the API and preflight see before the HTML: money, names, findings. */
export function renderReport(input: RenderInput): Rendered {
  const { report, data, doc } = input;
  const def = report.definition;
  const a = report.appearance;
  const locale = doc.locale ?? a.locale;
  const currency = doc.currency ?? a.currency;
  const appearance: Appearance = { ...a, locale, currency };
  const labels = labelsFor(locale, def.labels);
  const helpers = makeHelpers({ locale, currency, labels });
  const findings: Finding[] = [];

  let money: DocMoney | null = null;
  if (def.money) {
    try {
      money = computeMoney(data, def.money, currency);
    } catch (err) {
      if (!(err instanceof MoneyError)) throw err;
      findings.push({ severity: "error", code: "missing-data", message: `Money: ${err.message} (${err.pointer})`, block: null, path: err.pointer });
    }
  }

  const docScope = {
    number: doc.number,
    status: doc.status,
    issuedAt: doc.issuedAt,
    locale,
    currency,
    money,
    labels,
    submission: doc.submission ?? null,
  };
  const scope: View = { ...data, doc: docScope };
  const ev = new Evaluator(report, helpers, labels, money, (id) => `/assets/${id}`);
  ev.locale = locale;
  if (input.assetType) ev.assetType = input.assetType;
  ev.currency = currency;
  const blocks = ev.blocks(def.layout, scope, 0, []);

  const footerBlock = def.layout.find((b) => b.block === "footer" && (b.when === undefined || ev.value(b, b.when, scope, false)));
  const footer = footerBlock ? ((footerBlock.lines as string[]) ?? []).map((l) => ev.text(footerBlock, l, scope)).filter(Boolean) : null;

  const watermarks: string[] = [];
  if (doc.status === "draft") watermarks.push(labels.draft.toLocaleUpperCase(locale));
  if (doc.status === "void") watermarks.push(labels.void.toLocaleUpperCase(locale));
  for (const b of def.layout) if (b.block === "watermark" && (b.when === undefined || ev.value(b, b.when, scope, false))) watermarks.push(ev.text(b, b.text, scope));

  const pseudo: Block = { id: "document", block: "document" };
  const reportTitle = def.schema.title;
  const number = doc.number ?? labels.draft;
  const name = def.documentTitle ? ev.text({ ...pseudo, id: "documentTitle" }, def.documentTitle, scope) : `${reportTitle} ${number}`;
  const running = def.runningHeader ? ev.text({ ...pseudo, id: "runningHeader" }, def.runningHeader, scope) : `${reportTitle} · ${number}`;
  findings.push(...ev.findings);

  const title = `${reportTitle} ${number}${def.documentTitle ? ` — ${name}` : ""}`;
  const filename = `${(doc.number ?? `draft-${doc.id ?? "preview"}`).replace(/[^\w.-]+/g, "-")}.pdf`;
  const lang = locale;
  const view = {
    mode: input.mode ?? "print",
    lang,
    title,
    skin: a.theme,
    type: a.type,
    density: a.density,
    paper: a.paper,
    orientation: a.orientation,
    variant: input.variant ?? false,
    foldMarks: a.letter.foldMarks,
    window: a.letter.window,
    status: doc.status,
    running: { left: running, right: doc.number ? "" : labels.draft },
    watermarks,
    blocks,
    footer: footer && footer.length ? footer : null,
    // faqir-core draws qr-code, barcode and the bars' fills.
    scripts: true,
    share: input.share ?? null,
  };
  let html = page("reports/document.faqir", { view });
  const css = documentCss(appearance, labels, running, footer ?? []);
  html = html.replace("</head>", `<style data-report-page>\n${css}\n</style>\n</head>`);
  const g = geometry(appearance, footer?.length ?? 0);
  const sheet = { width: g.width - g.margins.right, height: g.height - g.margins.top - g.margins.bottom };
  return { html, sheet, name, title, filename, lang, findings, money, appearance };
}
