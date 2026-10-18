// The report model. A report is ONE JSON document — the definition — that the
// API accepts, the designer edits and the renderer turns into HTML and PDF:
//
//   { schema, sample, layout, appearance?, money?, numbering?, documentTitle?,
//     runningHeader?, labels?, source? }
//
// The report's name and description are the schema's root `title` and
// `description`, as for forms. Appearance is curated values only; everything a
// definition says about looks is a choice from a list, never a size, a colour
// (beyond the one accent) or a position. Every expression in it is compiled
// here, at save time; a fault is a 422 that names its JSON pointer and, inside an
// expression, the line and column.

import { compile as compileRules, validate } from "@faqir-ui/rules";
import { createHash } from "node:crypto";
import { checkExpr, checkText, type Diagnostic } from "./expr.ts";
import { checkPattern } from "./numbering.ts";
import { LABEL_KEYS, languageOf, LANGUAGES } from "./labels.ts";
import { compileMarkdown, type MdBlock } from "./markdown.ts";
import { compileFragment } from "./fragment.ts";

// ── Curated appearance ──────────────────────────────────────────────────────

export const PRINT_THEMES = ["document", "document-serif", "editorial-document", "ink-document", "swiss-document"] as const;
export const PAPERS = ["a4", "letter"] as const;
export const ORIENTATIONS = ["portrait", "landscape"] as const;
export const MARGINS = ["narrow", "normal", "wide"] as const;
export const DENSITIES = ["compact", "comfortable"] as const;

/** Type pairings: at most two families plus a mono, all self-hosted (ui/print/fonts.css, ui/fonts.css). */
export const TYPE_PAIRINGS = {
  "plex-sans": { label: "IBM Plex Sans", text: "IBM Plex Sans", headings: "IBM Plex Sans", mono: "IBM Plex Mono", note: "Neutral and exact. Invoices, statements, confirmations." },
  "plex-serif": { label: "IBM Plex Serif with Plex Sans", text: "IBM Plex Serif", headings: "IBM Plex Serif", labels: "IBM Plex Sans", mono: "IBM Plex Mono", note: "Formal correspondence and contracts." },
  "source-serif": { label: "Source Serif 4 with Plex Sans", text: "Source Serif 4", headings: "Source Serif 4", labels: "IBM Plex Sans", mono: "IBM Plex Mono", note: "Letters and long reading." },
  "editorial": { label: "Source Serif 4 headings over Plex Sans", text: "IBM Plex Sans", headings: "Source Serif 4", mono: "IBM Plex Mono", note: "Business reports with a voice." },
  "inter": { label: "Inter", text: "Inter", headings: "Inter", mono: "IBM Plex Mono", note: "Swiss, dense, numeric. Summaries and dashboards on paper." },
} as const;
export type TypePairing = keyof typeof TYPE_PAIRINGS;

/** The locales offered (any en, ro, de, fr locale Intl knows is accepted). */
export const LOCALES = ["en-GB", "en-US", "en-IE", "ro-RO", "de-DE", "de-AT", "de-CH", "fr-FR", "fr-BE", "fr-CH"] as const;

/** Paper geometry in points, for preflight and tests. */
export const PAPER_POINTS = { a4: { width: 595.28, height: 841.89 }, letter: { width: 612, height: 792 } } as const;
/** Columns a table may have and stay legible (8.5 pt type). */
export const MAX_COLUMNS = { portrait: 7, landscape: 10 } as const;

export interface Appearance {
  theme: (typeof PRINT_THEMES)[number];
  accent: string;
  paper: (typeof PAPERS)[number];
  orientation: (typeof ORIENTATIONS)[number];
  margins: (typeof MARGINS)[number];
  type: TypePairing;
  density: (typeof DENSITIES)[number];
  locale: string;
  currency: string;
  logo: string | null;
  letter: { window: boolean; foldMarks: boolean };
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "document",
  accent: "#1f3a8a",
  paper: "a4",
  orientation: "portrait",
  margins: "normal",
  type: "plex-sans",
  density: "comfortable",
  locale: "en-GB",
  currency: "EUR",
  logo: null,
  letter: { window: false, foldMarks: false },
};

export interface MoneySpec {
  lines: string; quantity: string; unitPrice: string; taxRate?: string; discount?: string;
  prices?: "net" | "gross"; rounding?: "line" | "total"; paid?: string;
}

export type Source = { kind: "data" } | { kind: "submission"; form: string } | { kind: "summary"; form: string };

export interface Block { id: string; block: string; when?: string; keep?: "together" | "with-next"; [prop: string]: unknown }

export interface ReportDefinition {
  schema: { type: "object"; title: string; description?: string; properties: Record<string, unknown>; required?: string[] };
  sample: Record<string, unknown>;
  layout: Block[];
  appearance?: Partial<Appearance>;
  money?: MoneySpec;
  numbering?: { pattern?: string; manual?: boolean };
  documentTitle?: string;
  runningHeader?: string;
  labels?: Record<string, string>;
  source?: Source;
}

export interface FieldError { pointer: string; detail: string; code?: string; line?: number; column?: number }

/** A definition problem: a 422 that names where each fault is. */
export class ReportProblem extends Error {
  errors: FieldError[];
  constructor(errors: FieldError[]) {
    super(errors.map((e) => `${e.pointer}: ${e.detail}`).join("; "));
    this.errors = errors;
  }
}

// ── The block vocabulary ────────────────────────────────────────────────────
//
// Each prop has a kind. `text` is template text with {{ }} holes (it renders);
// `expr` is a bare expression (it decides or selects); `md` is markdown with
// holes; `blocks` nests the vocabulary. The renderer is the only code that
// knows how a block becomes markup (templates/reports/blocks/*.faqir).

type Kind =
  | { k: "text" } | { k: "expr" } | { k: "md" } | { k: "bool" } | { k: "asset" } | { k: "source" }
  | { k: "enum"; values: readonly string[] }
  | { k: "list"; of: Kind; max: number; min?: number }
  | { k: "object"; props: Props }
  | { k: "blocks" }
  | { k: "columns" };
type Props = Record<string, Kind & { required?: boolean }>;

const text = { k: "text" } as const;
const expr = { k: "expr" } as const;
const md = { k: "md" } as const;
const bool = { k: "bool" } as const;
const req = <T extends Kind>(kind: T) => ({ ...kind, required: true });
const list = (of: Kind, max: number, min = 0): Kind => ({ k: "list", of, max, min });
const obj = (props: Props): Kind => ({ k: "object", props });
const oneOf = (...values: string[]): Kind => ({ k: "enum", values });
const pair = obj({ label: req(text), value: req(text), mono: bool });

export interface BlockSpec { group: "structure" | "data" | "content" | "office" | "advanced"; does: string; props: Props; example: Record<string, unknown> }

export const BLOCKS: Record<string, BlockSpec> = {
  letterhead: {
    group: "structure", does: "Sender identity on the first page: logo, name, address lines and registration details.",
    props: { name: req(text), logo: { k: "asset" }, lines: list(text, 6), details: list(pair, 6) },
    example: { id: "letterhead", block: "letterhead", name: "{{ seller.name }}", logo: "asset:ast_…", lines: ["{{ seller.street }}", "{{ seller.city }}"], details: [{ label: "VAT", value: "{{ seller.vat }}" }] },
  },
  title: {
    group: "structure", does: "The document's type, number and key dates.",
    props: { eyebrow: text, text: req(text), details: list(pair, 6) },
    example: { id: "title", block: "title", text: "{{ label(\"invoice\") }}", details: [{ label: "{{ label(\"number\") }}", value: "{{ doc.number ?? label(\"draft\") }}" }, { label: "{{ label(\"issueDate\") }}", value: "{{ date(doc.issuedAt) }}" }] },
  },
  parties: {
    group: "data", does: "From, bill to, ship to. With appearance.letter.window the first party sits in the envelope window.",
    props: { parties: { ...list(obj({ label: text, name: req(text), lines: list(text, 6), details: list(pair, 4) }), 3, 1), required: true } },
    example: { id: "parties", block: "parties", parties: [{ label: "{{ label(\"billTo\") }}", name: "{{ customer.name }}", lines: ["{{ customer.street }}", "{{ customer.city }}"] }] },
  },
  facts: {
    group: "data", does: "References, dates, terms and PO numbers as a grid of labelled values.",
    props: { items: { ...list(pair, 12, 1), required: true }, cols: oneOf("1", "2", "3", "4") },
    example: { id: "facts", block: "facts", items: [{ label: "{{ label(\"dueDate\") }}", value: "{{ date(due) }}" }, { label: "PO", value: "{{ po ?? \"—\" }}" }] },
  },
  table: {
    group: "data", does: "Rows bound to an array, with formatted columns. In a row: `row`, `i`, and `line` (the computed money line) when the rows are the money lines.",
    props: {
      rows: req(expr),
      columns: { ...list(obj({ label: req(text), value: req(text), note: text, format: oneOf("text", "number", "currency", "percent"), align: oneOf("left", "right", "center"), width: oneOf("auto", "narrow", "wide") }), 12, 1), required: true },
      footer: list(pair, 4), empty: text, caption: text,
    },
    example: { id: "items", block: "table", rows: "items", columns: [{ label: "{{ label(\"description\") }}", value: "{{ row.description }}", width: "wide" }, { label: "{{ label(\"quantity\") }}", value: "{{ number(row.qty) }}", format: "number" }, { label: "{{ label(\"amount\") }}", value: "{{ money(line.net) }}", format: "currency" }] },
  },
  totals: {
    group: "data", does: "Subtotal, discount, tax per rate, total, paid and due — from doc.money when `items` is not given.",
    props: { items: list(obj({ label: req(text), value: req(text), emphasis: bool }), 8), due: bool },
    example: { id: "totals", block: "totals" },
  },
  text: {
    group: "content", does: "Markdown prose: paragraphs, lists, emphasis, links. Holes are kept; data is always escaped text.",
    props: { markdown: req(md), size: oneOf("body", "small", "fine") },
    example: { id: "terms", block: "text", markdown: "Payment within **14 days** of {{ date(doc.issuedAt) }}. Questions: [billing@example.com](mailto:billing@example.com)." },
  },
  callout: {
    group: "content", does: "Payment instructions, notes and conditions, set apart.",
    props: { title: text, markdown: req(md), tone: oneOf("muted", "info", "warning", "success") },
    example: { id: "pay", block: "callout", title: "How to pay", markdown: "Transfer {{ money(doc.money.due) }} to {{ iban(seller.iban) }}, reference {{ doc.number ?? \"—\" }}." },
  },
  stats: {
    group: "content", does: "KPI figures: a label, a value and an optional change.",
    props: { items: { ...list(obj({ label: req(text), value: req(text), change: text, trend: oneOf("up", "down", "neutral") }), 6, 1), required: true } },
    example: { id: "kpis", block: "stats", items: [{ label: "Revenue", value: "{{ money(revenue) }}", change: "+18% y/y", trend: "up" }] },
  },
  bars: {
    group: "content", does: "Shares and distributions as labelled bars with their figures.",
    props: { rows: req(expr), label: req(text), value: req(expr), display: text, max: expr, title: text },
    example: { id: "shares", block: "bars", rows: "channels", label: "{{ row.name }}", value: "row.share", display: "{{ percent(row.share) }}" },
  },
  chart: {
    group: "content", does: "Bar, column or line chart drawn as inline SVG from Faqir tokens, with the numbers also as a table.",
    props: { kind: { ...oneOf("bar", "column", "line"), required: true }, rows: req(expr), label: req(text), series: { ...list(obj({ name: req(text), value: req(expr) }), 4, 1), required: true }, format: oneOf("number", "currency", "percent"), title: text, caption: text },
    example: { id: "revenue", block: "chart", kind: "column", rows: "quarters", label: "{{ row.name }}", series: [{ name: "Revenue", value: "row.revenue" }], format: "currency", title: "Revenue by quarter" },
  },
  quote: {
    group: "content", does: "A verbatim or testimonial with its attribution; with `rows`, one per row (`row` in scope).",
    props: { text: req(text), name: text, role: text, rows: expr },
    example: { id: "voice", block: "quote", text: "{{ comment.text }}", name: "{{ comment.who ?? \"\" }}" },
  },
  section: {
    group: "structure", does: "A heading and the blocks it groups; numbered 1. / 1.1 when `numbered` is true.",
    props: { title: req(text), numbered: bool, blocks: { k: "blocks" } },
    example: { id: "summary", block: "section", title: "Executive summary", numbered: true, blocks: [] },
  },
  columns: {
    group: "structure", does: "Two or three columns of child blocks.",
    props: { columns: { k: "columns", required: true } },
    example: { id: "cols", block: "columns", columns: [[], []] },
  },
  signature: {
    group: "office", does: "Signing lines with name, role and date, kept with their labels.",
    props: { signatures: { ...list(obj({ name: req(text), role: text, date: text }), 3, 1), required: true } },
    example: { id: "sign", block: "signature", signatures: [{ name: "{{ seller.signatory }}", role: "Director" }, { name: "{{ customer.contact }}", role: "{{ customer.name }}" }] },
  },
  qr: {
    group: "office", does: "A QR code (payment, check-in, verification).",
    props: { value: req(text), caption: text, size: oneOf("sm", "md", "lg") },
    example: { id: "pay-qr", block: "qr", value: "{{ epc(seller.name, seller.iban, doc.money.due, doc.number ?? \"DRAFT\") }}", caption: "{{ label(\"scanToPay\") }}" },
  },
  barcode: {
    group: "office", does: "A Code 128 barcode of printable ASCII.",
    props: { value: req(text), caption: text, size: oneOf("sm", "md", "lg") },
    example: { id: "ticket", block: "barcode", value: "{{ doc.number ?? \"DRAFT\" }}" },
  },
  image: {
    group: "content", does: "A figure from an uploaded asset, with a caption.",
    props: { src: { k: "asset", required: true }, alt: req(text), caption: text, size: oneOf("sm", "md", "lg", "full") },
    example: { id: "figure", block: "image", src: "asset:ast_…", alt: "Site plan", caption: "Figure 1. Site plan" },
  },
  stamp: {
    group: "office", does: "PAID, COPY or another mark, in Faqir's stamp, turned a few degrees.",
    props: { text: req(text), tone: oneOf("default", "primary", "destructive", "success") },
    example: { id: "paid", block: "stamp", text: "{{ label(\"paidStamp\") }}", tone: "success", when: "doc.money.due == \"0.00\"" },
  },
  watermark: {
    group: "office", does: "Diagonal text across every page (DRAFT and VOID are added for you).",
    props: { text: req(text) },
    example: { id: "copy", block: "watermark", text: "{{ label(\"copy\") }}" },
  },
  separator: { group: "structure", does: "A hairline rule.", props: {}, example: { id: "rule", block: "separator" } },
  "page-break": { group: "structure", does: "Start a new page.", props: {}, example: { id: "break", block: "page-break" } },
  answers: {
    group: "data", does: "Every answer of the bound submission, in form order, with zero configuration.",
    props: { title: text },
    example: { id: "answers", block: "answers" },
  },
  footer: {
    group: "structure", does: "The running footer: legal lines, registration, bank details. The page counter is added for you.",
    props: { lines: { ...list(text, 4, 1), required: true } },
    example: { id: "footer", block: "footer", lines: ["{{ seller.name }} · {{ seller.registration }}", "{{ seller.bank }} · IBAN {{ iban(seller.iban) }}"] },
  },
  faqir: {
    group: "advanced", does: "A fragment of Faqir template source for what the vocabulary lacks. No raw, no style, no class; manifests are checked.",
    props: { source: { k: "source", required: true } },
    example: { id: "custom", block: "faqir", source: "+callout(variant=\"muted\")\n  @content\n    p {{ note }}" },
  },
};

export const BLOCK_NAMES = Object.keys(BLOCKS);
const COMMON = new Set(["id", "block", "when", "keep"]);

// ── Compilation ─────────────────────────────────────────────────────────────

export interface CompiledReport {
  definition: ReportDefinition;
  appearance: Appearance;
  /** Markdown, compiled once: source → blocks. */
  markdown: Map<string, MdBlock[]>;
  /** The data's shape as @faqir-ui/rules reads it. */
  rules: Parameters<typeof validate>[0];
  title: string;
  hash: string;
}

const cache = new Map<string, CompiledReport>();

/** Validate a definition and compile everything in it. Throws ReportProblem. */
export function compileReport(input: unknown): CompiledReport {
  const json = JSON.stringify(input);
  const hash = createHash("sha256").update(json ?? "").digest("hex").slice(0, 24);
  const hit = cache.get(hash);
  if (hit) return hit;

  const errors: FieldError[] = [];
  if (!isRecord(input)) throw new ReportProblem([{ pointer: "", detail: "The definition must be a JSON object." }]);
  const known = new Set(["schema", "sample", "layout", "appearance", "money", "numbering", "documentTitle", "runningHeader", "labels", "source"]);
  for (const k of Object.keys(input)) if (!known.has(k)) errors.push({ pointer: `/${esc(k)}`, detail: `Unknown key. A report definition has ${[...known].join(", ")}.` });

  const rules = checkSchema(input.schema, errors);
  const markdown = new Map<string, MdBlock[]>();
  checkLayout(input.layout, errors, markdown);
  const appearance = checkAppearance(input.appearance, errors);
  checkWindow(input, errors);
  checkMoney(input.money, input.schema, errors);
  checkNumbering(input.numbering, errors);
  for (const k of ["documentTitle", "runningHeader"] as const) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== "string") errors.push({ pointer: `/${k}`, detail: "Template text (a string)." });
      else textErrors(input[k] as string, `/${k}`, errors);
    }
  }
  if (input.labels !== undefined) {
    if (!isRecord(input.labels)) errors.push({ pointer: "/labels", detail: "An object { key: text }." });
    else for (const [k, v] of Object.entries(input.labels)) {
      if (!(LABEL_KEYS as string[]).includes(k)) errors.push({ pointer: `/labels/${esc(k)}`, detail: `Unknown label. Known: ${LABEL_KEYS.join(", ")}.` });
      else if (typeof v !== "string" || !v.trim() || v.length > 80) errors.push({ pointer: `/labels/${esc(k)}`, detail: "A non-empty string of at most 80 characters." });
    }
  }
  checkSource(input.source, errors);

  // The sample must be valid data: it is what every preview renders.
  if (rules && errors.length === 0) {
    if (!isRecord(input.sample)) errors.push({ pointer: "/sample", detail: "Required: example data, valid against the schema." });
    else errors.push(...dataErrors(rules, input.sample).map((e) => ({ ...e, pointer: `/sample${e.pointer}` })));
  } else if (input.sample !== undefined && !isRecord(input.sample)) errors.push({ pointer: "/sample", detail: "Must be an object." });

  if (errors.length) throw new ReportProblem(errors);
  const definition = input as unknown as ReportDefinition;
  const out: CompiledReport = { definition, appearance, markdown, rules: rules!, title: definition.schema.title, hash };
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  cache.set(hash, out);
  return out;
}

/** The data's shape problems, as JSON pointers. */
export function dataErrors(rules: CompiledReport["rules"], data: Record<string, unknown>): FieldError[] {
  const verdict = validate(rules, data);
  return verdict.findings.map((f: { path: string; rule: string; message: string }) => ({
    pointer: `/${f.path.replace(/\./g, "/").replace(/\[(\d+)\]/g, "/$1")}`,
    detail: `${f.message} (${f.rule})`,
    code: f.rule,
  }));
}

function checkSchema(schema: unknown, errors: FieldError[]): CompiledReport["rules"] | null {
  if (!isRecord(schema)) {
    errors.push({ pointer: "/schema", detail: "Required: a JSON Schema object with type \"object\" — the shape of the data." });
    return null;
  }
  const before = errors.length;
  if (schema.type !== "object") errors.push({ pointer: "/schema/type", detail: "The root schema must be type \"object\"." });
  if (typeof schema.title !== "string" || !schema.title.trim()) errors.push({ pointer: "/schema/title", detail: "Required: the report's name." });
  if (schema.description !== undefined && typeof schema.description !== "string") errors.push({ pointer: "/schema/description", detail: "A string." });
  if (!isRecord(schema.properties)) errors.push({ pointer: "/schema/properties", detail: "Required: the data's fields (may be empty: {})." });
  else if ("doc" in schema.properties) errors.push({ pointer: "/schema/properties/doc", detail: "`doc` is reserved for the system values (doc.number, doc.money, …)." });
  const extra = Object.keys(schema).filter((k) => !["type", "title", "description", "properties", "required", "$schema"].includes(k));
  for (const k of extra) errors.push({ pointer: `/schema/${esc(k)}`, detail: "Unknown key at the root of the schema." });
  if (errors.length > before) return null;
  const rules = { version: "1" as const, fields: schema.properties, ...(Array.isArray(schema.required) ? { required: schema.required } : {}) };
  try {
    compileRules(rules as never);
  } catch (err) {
    const e = err as { message?: string; path?: string };
    const path = typeof e.path === "string" && e.path ? `/${e.path.replace(/^fields\./, "").replace(/\./g, "/properties/")}` : "";
    errors.push({ pointer: `/schema/properties${path}`, detail: String(e.message ?? err).replace(/^@faqir-ui\/rules: /, "") });
    return null;
  }
  return rules as unknown as CompiledReport["rules"];
}

function checkLayout(layout: unknown, errors: FieldError[], markdown: Map<string, MdBlock[]>): void {
  if (!Array.isArray(layout)) {
    errors.push({ pointer: "/layout", detail: "Required: an array of blocks, e.g. [{ \"id\": \"title\", \"block\": \"title\", \"text\": \"Invoice\" }]." });
    return;
  }
  const ids = new Map<string, string>();
  let count = 0;
  let footers = 0;
  const walk = (blocks: unknown[], at: string, depth: number) => {
    if (depth > 2) return;
    blocks.forEach((b, i) => {
      const p = `${at}/${i}`;
      if (++count > 300) { if (count === 301) errors.push({ pointer: p, detail: "A report has at most 300 blocks." }); return; }
      if (!isRecord(b)) { errors.push({ pointer: p, detail: "A block is an object { id, block, … }." }); return; }
      if (typeof b.id !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(b.id)) errors.push({ pointer: `${p}/id`, detail: "Required: a stable id, lowercase letters, digits and dashes, starting with a letter." });
      else if (ids.has(b.id)) errors.push({ pointer: `${p}/id`, detail: `Duplicate id "${b.id}" (also at ${ids.get(b.id)}).` });
      else ids.set(b.id, p);
      const spec = typeof b.block === "string" ? BLOCKS[b.block] : undefined;
      if (!spec) { errors.push({ pointer: `${p}/block`, detail: `Unknown block. One of: ${BLOCK_NAMES.join(", ")}.` }); return; }
      if ((b.block === "section" || b.block === "columns") && depth >= 2) errors.push({ pointer: `${p}/block`, detail: "Sections and columns nest two levels deep at most; only leaf blocks go here." });
      if (b.block === "footer" && ++footers > 1) errors.push({ pointer: p, detail: "A report has one footer." });
      if (b.block === "footer" && depth > 0) errors.push({ pointer: p, detail: "The footer belongs at the top level of the layout." });
      if (b.when !== undefined) {
        if (typeof b.when !== "string") errors.push({ pointer: `${p}/when`, detail: "A bare expression, e.g. \"doc.money.paid != \\\"0.00\\\"\"." });
        else exprErrors(b.when, `${p}/when`, errors);
      }
      if (b.keep !== undefined && b.keep !== "together" && b.keep !== "with-next") errors.push({ pointer: `${p}/keep`, detail: 'One of "together", "with-next".' });
      for (const k of Object.keys(b)) if (!COMMON.has(k) && !(k in spec.props)) errors.push({ pointer: `${p}/${esc(k)}`, detail: `Unknown prop for ${b.block}. It takes: ${["id", "block", "when", "keep", ...Object.keys(spec.props)].join(", ")}.` });
      for (const [k, kind] of Object.entries(spec.props)) {
        const v = b[k];
        if (v === undefined) {
          if (kind.required) errors.push({ pointer: `${p}/${k}`, detail: `Required by ${b.block}.` });
          continue;
        }
        checkProp(v, kind, `${p}/${k}`, errors, markdown, (children, cp) => walk(children, cp, depth + 1));
      }
      if (b.block === "table" && Array.isArray(b.columns) && b.columns.length > MAX_COLUMNS.landscape) {
        errors.push({ pointer: `${p}/columns`, detail: `At most ${MAX_COLUMNS.landscape} columns fit any paper legibly.` });
      }
    });
  };
  walk(layout, "/layout", 0);
}

/** A window letter starts with the letterhead and then the window's party (DIN 5008 Form B geometry). */
function checkWindow(input: Record<string, unknown>, errors: FieldError[]): void {
  const a = input.appearance as { letter?: { window?: boolean } } | undefined;
  if (!a?.letter?.window || !Array.isArray(input.layout)) return;
  const top = (input.layout as { block?: string; when?: unknown }[]).filter((b) => b && b.block !== "footer" && b.block !== "watermark");
  if (top[0]?.block !== "letterhead" || top[1]?.block !== "parties" || top[0]?.when !== undefined || top[1]?.when !== undefined) {
    errors.push({ pointer: "/appearance/letter/window", detail: "A window letter starts with a letterhead block, then a parties block whose first party is the window address, both without when." });
  }
}

function checkProp(v: unknown, kind: Kind, p: string, errors: FieldError[], markdown: Map<string, MdBlock[]>, nest: (b: unknown[], p: string) => void): void {
  switch (kind.k) {
    case "text":
      if (typeof v !== "string") errors.push({ pointer: p, detail: "Template text: a string, with {{ }} holes for data." });
      else if (v.length > 2000) errors.push({ pointer: p, detail: "At most 2000 characters." });
      else textErrors(v, p, errors);
      return;
    case "expr":
      if (typeof v !== "string") errors.push({ pointer: p, detail: "A bare expression (a string), e.g. \"items\"." });
      else exprErrors(v, p, errors);
      return;
    case "md": {
      if (typeof v !== "string") { errors.push({ pointer: p, detail: "Markdown text (a string)." }); return; }
      if (v.length > 20_000) { errors.push({ pointer: p, detail: "At most 20 000 characters." }); return; }
      const r = compileMarkdown(v);
      if ("errors" in r) for (const e of r.errors) errors.push({ ...e, pointer: p });
      else {
        for (const seg of r.texts) textErrors(seg, p, errors);
        markdown.set(v, r.blocks);
      }
      return;
    }
    case "bool":
      if (typeof v !== "boolean") errors.push({ pointer: p, detail: "true or false." });
      return;
    case "asset":
      if (typeof v !== "string" || !/^asset:ast_[A-Za-z0-9]{6,32}$/.test(v)) errors.push({ pointer: p, detail: "An uploaded asset, \"asset:ast_…\" (POST /api/v1/assets). Remote URLs are not allowed." });
      return;
    case "enum":
      if (typeof v !== "string" || !kind.values.includes(v)) errors.push({ pointer: p, detail: `One of: ${kind.values.join(", ")}.` });
      return;
    case "list":
      if (!Array.isArray(v)) { errors.push({ pointer: p, detail: "An array." }); return; }
      if (v.length > kind.max) errors.push({ pointer: p, detail: `At most ${kind.max} items.` });
      if (v.length < (kind.min ?? 0)) errors.push({ pointer: p, detail: `At least ${kind.min} item${kind.min === 1 ? "" : "s"}.` });
      v.slice(0, kind.max).forEach((x, i) => checkProp(x, kind.of, `${p}/${i}`, errors, markdown, nest));
      return;
    case "object":
      if (!isRecord(v)) { errors.push({ pointer: p, detail: `An object with ${Object.keys(kind.props).join(", ")}.` }); return; }
      for (const k of Object.keys(v)) if (!(k in kind.props)) errors.push({ pointer: `${p}/${esc(k)}`, detail: `Unknown key. Takes: ${Object.keys(kind.props).join(", ")}.` });
      for (const [k, sub] of Object.entries(kind.props)) {
        if (v[k] === undefined) { if (sub.required) errors.push({ pointer: `${p}/${k}`, detail: "Required." }); continue; }
        checkProp(v[k], sub, `${p}/${k}`, errors, markdown, nest);
      }
      return;
    case "blocks":
      if (!Array.isArray(v)) errors.push({ pointer: p, detail: "An array of blocks." });
      else nest(v, p);
      return;
    case "columns":
      if (!Array.isArray(v) || v.length < 2 || v.length > 3 || !v.every(Array.isArray)) errors.push({ pointer: p, detail: "Two or three arrays of blocks: [[…], […]]." });
      else v.forEach((col, i) => nest(col as unknown[], `${p}/${i}`));
      return;
    case "source": {
      if (typeof v !== "string" || !v.trim()) { errors.push({ pointer: p, detail: "Faqir template source (a string)." }); return; }
      const r = compileFragment(v);
      for (const d of r.diagnostics) errors.push({ pointer: p, detail: d.message, code: d.code, line: d.line, column: d.column });
      return;
    }
  }
}

function textErrors(text: string, pointer: string, errors: FieldError[]): void {
  for (const d of checkText(text)) errors.push(diag(pointer, d, text));
}
function exprErrors(e: string, pointer: string, errors: FieldError[]): void {
  for (const d of checkExpr(e)) errors.push(diag(pointer, d, e));
}
function diag(pointer: string, d: Diagnostic, source: string): FieldError {
  return { pointer, code: d.code, line: d.line, column: d.column, detail: `${d.code} at line ${d.line}, column ${d.column}: ${d.message} — in ${JSON.stringify(source.length > 80 ? source.slice(0, 77) + "…" : source)}` };
}

function checkAppearance(a: unknown, errors: FieldError[]): Appearance {
  if (a === undefined) return { ...DEFAULT_APPEARANCE, letter: { ...DEFAULT_APPEARANCE.letter } };
  if (!isRecord(a)) { errors.push({ pointer: "/appearance", detail: "Must be an object." }); return DEFAULT_APPEARANCE; }
  const at = (k: string, detail: string) => errors.push({ pointer: `/appearance/${k}`, detail });
  for (const k of Object.keys(a)) if (!(k in DEFAULT_APPEARANCE)) at(esc(k), `Unknown key. Appearance takes ${Object.keys(DEFAULT_APPEARANCE).join(", ")} — and nothing about sizes, colours or positions: the renderer decides those.`);
  const pick = <T extends readonly string[]>(k: string, values: T) => {
    if (a[k] !== undefined && !values.includes(a[k] as string)) at(k, `One of: ${values.join(", ")}.`);
  };
  pick("theme", PRINT_THEMES);
  pick("paper", PAPERS);
  pick("orientation", ORIENTATIONS);
  pick("margins", MARGINS);
  pick("density", DENSITIES);
  pick("type", Object.keys(TYPE_PAIRINGS));
  if (a.accent !== undefined && (typeof a.accent !== "string" || !/^#[0-9a-fA-F]{6}$/.test(a.accent))) at("accent", "One hex colour, #rrggbb. It must read on white: pick a dark, saturated ink.");
  else if (typeof a.accent === "string" && contrastOnWhite(a.accent) < 4.5) at("accent", `Too light to print legibly (contrast ${contrastOnWhite(a.accent).toFixed(1)}:1 on white; at least 4.5:1). Darken it.`);
  if (a.locale !== undefined && checkLocale(a.locale)) at("locale", checkLocale(a.locale)!);
  if (a.currency !== undefined && checkCurrency(a.currency)) at("currency", checkCurrency(a.currency)!);
  if (a.logo !== undefined && a.logo !== null && (typeof a.logo !== "string" || !/^asset:ast_[A-Za-z0-9]{6,32}$/.test(a.logo))) at("logo", "An uploaded asset, \"asset:ast_…\", or null.");
  if (a.letter !== undefined) {
    if (!isRecord(a.letter)) at("letter", "An object { window, foldMarks }.");
    else for (const k of Object.keys(a.letter)) {
      if (k !== "window" && k !== "foldMarks") at(`letter/${esc(k)}`, "Unknown key. Takes window, foldMarks.");
      else if (typeof a.letter[k] !== "boolean") at(`letter/${k}`, "true or false.");
    }
  }
  return normalizeAppearance(a as Partial<Appearance>);
}

export function normalizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  return { ...DEFAULT_APPEARANCE, ...(a ?? {}), letter: { ...DEFAULT_APPEARANCE.letter, ...(a?.letter ?? {}) } };
}

/** `null` when usable, else why not. */
export function checkLocale(v: unknown): string | null {
  if (typeof v !== "string") return "A locale such as en-GB, ro-RO, de-DE or fr-FR.";
  try {
    const canonical = Intl.getCanonicalLocales(v)[0]!;
    if (!(LANGUAGES as readonly string[]).includes(canonical.split("-")[0]!) || !/^[a-z]{2}-[A-Z]{2}$/.test(canonical)) throw new Error();
    return canonical === v ? null : `Write it as ${canonical}.`;
  } catch {
    return `A language-REGION locale in ${LANGUAGES.join(", ")}, e.g. ${LOCALES.join(", ")}.`;
  }
}

export function checkCurrency(v: unknown): string | null {
  if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)) return "An ISO 4217 code such as EUR, RON, GBP, USD, CHF or JPY.";
  return (Intl.supportedValuesOf("currency") as string[]).includes(v) ? null : `Unknown currency ${v}.`;
}

function checkMoney(m: unknown, schema: unknown, errors: FieldError[]): void {
  if (m === undefined) return;
  if (!isRecord(m)) { errors.push({ pointer: "/money", detail: "An object { lines, quantity, unitPrice, taxRate?, discount?, prices?, rounding?, paid? }." }); return; }
  const keys = ["lines", "quantity", "unitPrice", "taxRate", "discount", "prices", "rounding", "paid"];
  for (const k of Object.keys(m)) if (!keys.includes(k)) errors.push({ pointer: `/money/${esc(k)}`, detail: `Unknown key. Takes ${keys.join(", ")}.` });
  for (const k of ["lines", "quantity", "unitPrice"]) if (typeof m[k] !== "string" || !m[k]) errors.push({ pointer: `/money/${k}`, detail: "Required: a field name." });
  for (const k of ["taxRate", "discount", "paid"]) if (m[k] !== undefined && (typeof m[k] !== "string" || !m[k])) errors.push({ pointer: `/money/${k}`, detail: "A field name." });
  if (m.prices !== undefined && m.prices !== "net" && m.prices !== "gross") errors.push({ pointer: "/money/prices", detail: 'One of "net" (unit prices exclude tax), "gross".' });
  if (m.rounding !== undefined && m.rounding !== "line" && m.rounding !== "total") errors.push({ pointer: "/money/rounding", detail: 'One of "line" (round each line\'s tax), "total" (round once per rate).' });
  const props = isRecord(schema) && isRecord(schema.properties) ? schema.properties : null;
  if (props && typeof m.lines === "string") {
    const lines = props[m.lines];
    const items = isRecord(lines) && lines.type === "array" && isRecord(lines.items) && isRecord(lines.items.properties) ? lines.items.properties : null;
    if (!items) errors.push({ pointer: "/money/lines", detail: `The schema needs "${m.lines}": an array of objects (the lines).` });
    else for (const k of ["quantity", "unitPrice", "taxRate", "discount"]) {
      if (typeof m[k] === "string" && !(m[k] in items)) errors.push({ pointer: `/money/${k}`, detail: `"${m[k]}" is not a property of each ${m.lines} item.` });
    }
  }
}

function checkNumbering(n: unknown, errors: FieldError[]): void {
  if (n === undefined) return;
  if (!isRecord(n)) { errors.push({ pointer: "/numbering", detail: 'An object: { "pattern": "INV-{YYYY}-{seq:4}" } or { "manual": true }.' }); return; }
  for (const k of Object.keys(n)) if (k !== "pattern" && k !== "manual") errors.push({ pointer: `/numbering/${esc(k)}`, detail: "Unknown key. Takes pattern or manual." });
  if (n.manual !== undefined && n.manual !== true) errors.push({ pointer: "/numbering/manual", detail: "true, or leave it out." });
  if (n.manual === true && n.pattern !== undefined) errors.push({ pointer: "/numbering", detail: "Either a pattern or manual numbering, not both." });
  if (n.pattern !== undefined) {
    const e = checkPattern(n.pattern as string);
    if (e) errors.push({ pointer: "/numbering/pattern", detail: e });
  }
  if (n.manual === undefined && n.pattern === undefined) errors.push({ pointer: "/numbering", detail: "Give a pattern or manual: true." });
}

function checkSource(s: unknown, errors: FieldError[]): void {
  if (s === undefined) return;
  if (!isRecord(s) || !["data", "submission", "summary"].includes(s.kind as string)) {
    errors.push({ pointer: "/source", detail: '{ "kind": "data" }, { "kind": "submission", "form": "frm_…" } or { "kind": "summary", "form": "frm_…" }.' });
    return;
  }
  for (const k of Object.keys(s)) if (k !== "kind" && k !== "form") errors.push({ pointer: `/source/${esc(k)}`, detail: "Unknown key. Takes kind and form." });
  if (s.kind !== "data" && (typeof s.form !== "string" || !/^frm_\w+$/.test(s.form))) errors.push({ pointer: "/source/form", detail: "Required: the form's id (frm_…)." });
  if (s.kind === "data" && s.form !== undefined) errors.push({ pointer: "/source/form", detail: "A data source takes no form." });
}

/** WCAG contrast of a hex colour against white. */
export function contrastOnWhite(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return 1.05 / (l + 0.05);
}

/** Every block, depth first, with its JSON pointer. */
export function* walkBlocks(layout: Block[], at = "/layout"): Generator<{ block: Block; pointer: string; depth: number }> {
  const visit = function* (blocks: Block[], p: string, depth: number): Generator<{ block: Block; pointer: string; depth: number }> {
    for (const [i, b] of blocks.entries()) {
      yield { block: b, pointer: `${p}/${i}`, depth };
      if (b.block === "section" && Array.isArray(b.blocks)) yield* visit(b.blocks as Block[], `${p}/${i}/blocks`, depth + 1);
      if (b.block === "columns" && Array.isArray(b.columns)) for (const [j, col] of (b.columns as Block[][]).entries()) yield* visit(col, `${p}/${i}/columns/${j}`, depth + 1);
    }
  };
  yield* visit(layout, at, 0);
}

export const languageOfReport = (a: Appearance) => languageOf(a.locale);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A JSON pointer token (RFC 6901). */
function esc(k: string): string {
  return k.replace(/~/g, "~0").replace(/\//g, "~1");
}
