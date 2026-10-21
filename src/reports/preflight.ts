// Preflight: the print shop's check, run on every preview and before every
// issue. Layout checks run in Chromium under print media at the page area's
// width (a probe evaluated in the page that prints); pagination checks read the
// PDF itself with pdf.js — text positions per page and the embedded fonts — so
// what is checked is what prints. Errors block issue; warnings are listed.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { LIMITS, printPdf, rasterize, type AssetLookup } from "./pdf.ts";
import { geometry, type Finding, type Rendered } from "./render.ts";
import { TYPE_PAIRINGS, type CompiledReport } from "./model.ts";

export interface PreflightCode { code: string; severity: "error" | "warning"; checks: string }

export const PREFLIGHT_CODES: PreflightCode[] = [
  { code: "missing-data", severity: "error", checks: "A path the data does not have (named, with its block). Write `x ?? \"…\"` for an optional value." },
  { code: "missing-asset", severity: "error", checks: "A logo or image whose asset id is not in this workspace (it would print as a broken image)." },
  { code: "expression-error", severity: "error", checks: "An expression that cannot be evaluated with this data (a type mismatch, a helper given nonsense)." },
  { code: "overflow", severity: "error", checks: "Anything wider than the page's content box, including unbreakable strings such as IBANs and URLs." },
  { code: "cell-overflow", severity: "error", checks: "A table cell whose content does not fit its column." },
  { code: "too-many-columns", severity: "error", checks: "More table columns than the paper and orientation hold legibly (7 portrait, 10 landscape)." },
  { code: "window-overlap", severity: "error", checks: "Something other than the address inside the envelope window of a window letter." },
  { code: "qr-capacity", severity: "error", checks: "A QR payload the qr-code recipe cannot encode (versions 1–40, ECL M: at most 2331 bytes)." },
  { code: "barcode-value", severity: "error", checks: "A barcode value Code 128-B cannot encode (printable ASCII only)." },
  { code: "font-fallback", severity: "error", checks: "Any glyph set in a family the report did not declare, read from the PDF's font list." },
  { code: "page-limit", severity: "error", checks: `More than ${LIMITS.pages} pages.` },
  { code: "orphan-heading", severity: "warning", checks: "A heading, section title or block title (a bars or chart block's title) that is the last thing on a page." },
  { code: "split-totals", severity: "warning", checks: "Totals or payment details on a later page than the rows they total." },
  { code: "blank-page", severity: "warning", checks: "A page with nothing on it but the running header and footer." },
  { code: "image-resolution", severity: "warning", checks: "An image under 200 dpi at its printed size." },
];
const SEVERITY = new Map(PREFLIGHT_CODES.map((c) => [c.code, c.severity]));

/** Evaluated inside the document, under print media, after fonts and controllers settled. */
const PROBE = String.raw`
const art = document.querySelector('[data-ui="document"]');
const body = art.querySelector(':scope > [data-part="body"]');
const bb = body.getBoundingClientRect();
const bs = getComputedStyle(art);
const right = bb.right - parseFloat(getComputedStyle(body).paddingRight) + 0.75;
const mm = (px) => Math.round(px * 25.4 / 96 * 10) / 10;
const blockOf = (el) => el.closest('[data-block]')?.dataset.block ?? null;
const out = { overflow: [], cells: [], images: [], codes: [], headings: [], totals: [], window: [] };
const seen = new Set();
for (const el of body.querySelectorAll('*')) {
  if (el.closest('[data-report-chart-data], svg')) continue;
  const r = el.getBoundingClientRect();
  if (!r.width) continue;
  if (r.right > right) {
    const id = blockOf(el);
    if (!seen.has(id)) { seen.add(id); out.overflow.push({ block: id, by: mm(r.right - right), what: el.tagName.toLowerCase() }); }
  }
}
// Unbreakable strings: a word wider than the box it sits in (key-value and
// table cells would break it mid-word, which prints just as badly).
const canvas = document.createElement('canvas').getContext('2d');
const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
for (let n = walker.nextNode(); n; n = walker.nextNode()) {
  const el = n.parentElement;
  if (!el || el.closest('[data-report-chart-data], svg, [data-ui="qr-code"], [data-ui="barcode"]')) continue;
  // A line may break at a space, a hyphen, a dash or a slash: what lies between is unbreakable.
  const words = n.textContent.split(/[\s\-‐-—\/]+/).filter((w) => w.length >= 16);
  if (!words.length) continue;
  const cs = getComputedStyle(el);
  canvas.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  let box = el;
  while (box && getComputedStyle(box).display === 'inline') box = box.parentElement;
  const bcs = getComputedStyle(box);
  const avail = box.clientWidth - parseFloat(bcs.paddingLeft) - parseFloat(bcs.paddingRight);
  for (const w of words) {
    const width = canvas.measureText(w).width + (w.length - 1) * (parseFloat(cs.letterSpacing) || 0);
    if (width > avail + 0.5) {
      const id = blockOf(el);
      if (!seen.has(id + w)) { seen.add(id + w); out.overflow.push({ block: id, by: mm(width - avail), what: 'string', text: w.slice(0, 40), length: w.length }); }
    }
  }
}
for (const td of body.querySelectorAll('[data-part="td"], [data-part="th"]')) {
  if (td.closest('[data-report-chart-data]')) continue;
  if (td.scrollWidth > td.clientWidth + 1) out.cells.push({ block: blockOf(td), text: td.textContent.trim().slice(0, 40), by: mm(td.scrollWidth - td.clientWidth) });
}
for (const img of body.querySelectorAll('img')) {
  const r = img.getBoundingClientRect();
  if (!r.width || img.closest('[data-report-vector]')) continue;
  out.images.push({ block: blockOf(img), natural: img.naturalWidth, printedIn: r.width / 96, dpi: Math.round(img.naturalWidth / (r.width / 96)) });
}
for (const el of body.querySelectorAll('[data-ui="qr-code"], [data-ui="barcode"]')) {
  if (el.dataset.value && !el.querySelector('[data-part="svg"]')) out.codes.push({ block: blockOf(el), kind: el.dataset.ui, bytes: new TextEncoder().encode(el.dataset.value).length });
}
// Headings, and the titles blocks print as eyebrows (a bars block's "Bookings per workshop").
for (const h of body.querySelectorAll('h1, h2, h3, h4, [data-report-block] [data-ui="text"][data-variant="eyebrow"]')) {
  if (h.closest('[data-report-block="title"], [data-report-block="letterhead"], [data-report-block="parties"]')) continue;
  out.headings.push({ block: blockOf(h), text: h.textContent.replace(/\s+/g, ' ').trim() });
}
for (const t of body.querySelectorAll('[data-report-block="totals"]')) {
  const first = t.querySelector('[data-part="label"]')?.textContent.trim();
  // The rows they total: the closest table block before it in document order.
  const tables = [...body.querySelectorAll('[data-report-block="table"]')].filter((x) => x.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
  const table = tables.at(-1);
  const lastRow = table ? [...table.querySelectorAll(':scope [data-part="tbody"]:not([data-report-table-footer]) > [data-part="tr"]')].at(-1) : null;
  const cell = lastRow?.querySelector('[data-part="td"]');
  out.totals.push({ block: t.dataset.block, first, table: table?.dataset.block ?? null, lastRow: cell ? cell.firstChild?.textContent?.trim() ?? cell.textContent.trim() : null });
}
const win = body.querySelector('[data-report-window]');
if (win) {
  const w = win.getBoundingClientRect();
  for (const el of body.querySelectorAll('*')) {
    if (win.contains(el) || el.contains(win)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !el.textContent.trim() && el.tagName !== 'IMG') continue;
    if (r.left < w.right - 1 && r.right > w.left + 1 && r.top < w.bottom - 1 && r.bottom > w.top + 1 && !el.querySelector('*')) out.window.push({ block: blockOf(el), text: el.textContent.trim().slice(0, 40) });
  }
}
return out;
`;

interface Probe {
  overflow: { block: string | null; by: number; what: string; text?: string; length?: number }[];
  cells: { block: string | null; text: string; by: number }[];
  images: { block: string | null; dpi: number; natural: number; printedIn: number }[];
  codes: { block: string | null; kind: string; bytes: number }[];
  headings: { block: string | null; text: string }[];
  totals: { block: string; first: string | null; table: string | null; lastRow: string | null }[];
  window: { block: string | null; text: string }[];
}

export interface PdfPage { width: number; height: number; lines: { y: number; text: string }[]; body: { y: number; text: string }[]; fonts: string[] }
export interface ReadPdf { pages: PdfPage[]; fonts: string[]; title: string | null; lang: string | null; outline: string[]; links: string[][] }

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Text lines, fonts, metadata, outline and links of a PDF, by pdf.js. */
export async function readPdf(pdf: Uint8Array, zones?: { first: number; top: number; bottom: number }): Promise<ReadPdf> {
  const task = getDocument({ data: new Uint8Array(pdf), fontExtraProperties: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: PdfPage[] = [];
    const all = new Set<string>();
    const links: string[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      await page.getOperatorList();
      const tc = await page.getTextContent();
      const fonts = new Set<string>();
      const rows = new Map<number, { x: number; w: number; s: string; size: number }[]>();
      for (const it of tc.items as { str: string; transform: number[]; fontName: string; width: number }[]) {
        if (!("str" in it)) continue;
        try {
          const f = page.commonObjs.get(it.fontName) as { name?: string } | undefined;
          if (f?.name && it.str.trim()) fonts.add(f.name);
        } catch { /* a font pdf.js did not load: no glyphs drawn with it */ }
        if (!it.str) continue;
        const y = Math.round(it.transform[5]! * 2) / 2;
        const key = [...rows.keys()].find((k) => Math.abs(k - y) < 2) ?? y;
        (rows.get(key) ?? rows.set(key, []).get(key)!).push({ x: it.transform[4]!, w: it.width ?? 0, s: it.str, size: Math.hypot(it.transform[0]!, it.transform[1]!) || 10 });
      }
      // Runs that touch are one word (a diacritic, or a letter-spaced capital, is often its
      // own run); a gap wider than a fifth of an em is a word space.
      const join = (parts: { x: number; w: number; s: string; size: number }[]) => parts.sort((a, b) => a.x - b.x)
        .reduce((acc, p, i, all) => acc + (i && p.x - (all[i - 1]!.x + all[i - 1]!.w) > 0.6 * p.size && !acc.endsWith(" ") && !p.s.startsWith(" ") ? " " : "") + p.s, "");
      const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([y, parts]) => ({ y, text: norm(join(parts)) })).filter((l) => l.text);
      const body = zones ? lines.filter((l) => l.y < vp.height - (n === 1 ? zones.first : zones.top) && l.y > zones.bottom) : lines;
      pages.push({ width: vp.width, height: vp.height, lines, body, fonts: [...fonts] });
      fonts.forEach((f) => all.add(f));
      links.push(((await page.getAnnotations()) as { url?: string }[]).map((a) => a.url).filter((u): u is string => Boolean(u)));
      page.cleanup();
    }
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: string; Language?: string };
    const outline = ((await doc.getOutline()) ?? []).flatMap(function flat(o: { title: string; items: unknown[] }): string[] { return [o.title, ...(o.items as { title: string; items: unknown[] }[]).flatMap(flat)]; });
    return { pages, fonts: [...all], title: info.Title ?? null, lang: info.Language ?? null, outline, links };
  } finally {
    await task.destroy();
  }
}

/** "AAAAAA+IBM-Plex-Sans-SemiBold" → "ibmplexsans semibold" family test. */
export function fontFamilyOf(pdfName: string): string {
  return pdfName.replace(/^[A-Z]{6}\+/, "");
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The families a report may print in: its pairing and the mono. */
export function declaredFamilies(report: CompiledReport): string[] {
  const p = TYPE_PAIRINGS[report.appearance.type] as { text: string; headings: string; labels?: string; mono: string };
  return [...new Set([p.text, p.headings, p.labels ?? p.text, p.mono])];
}

export function undeclaredFonts(fonts: string[], families: string[]): string[] {
  const ok = families.map(squash);
  return fonts.filter((f) => {
    const name = squash(fontFamilyOf(f));
    return !ok.some((fam) => name.startsWith(fam) && !/^(condensed|cond)/.test(name.slice(fam.length)));
  });
}

export interface PreflightResult {
  findings: Finding[];
  pages: number;
  pdf: Buffer;
  ms: number;
  read: ReadPdf;
  /** First pages as PNGs, when asked for. */
  images: Buffer[];
}

export async function preflight(report: CompiledReport, rendered: Rendered, opts: { assets?: AssetLookup; images?: { dpi: number; max: number } } = {}): Promise<PreflightResult> {
  const printed = await printPdf(rendered.html, { assets: opts.assets, probe: PROBE, sheet: rendered.sheet });
  const probe = printed.layout as Probe;
  const pt = (mm: number) => (mm * 72) / 25.4;
  // Header zone: the top margin plus the running header; footer zone: bottom margin plus footer.
  const footerLines = (rendered.html.match(/<footer data-part="doc-footer">[\s\S]*?<\/footer>/)?.[0].match(/<p>/g) ?? []).length;
  // The running header and footer live in the page margins (margin boxes): the body is between them.
  const g = geometry(rendered.appearance, footerLines);
  const zones = { first: pt(g.margins.top - 0.5), top: pt(g.laterTop - 0.5), bottom: pt(g.margins.bottom - 0.5) };
  const read = await readPdf(printed.pdf, zones);
  const findings: Finding[] = [...rendered.findings];
  const add = (code: string, message: string, block: string | null, page?: number) =>
    findings.push({ severity: SEVERITY.get(code) ?? "error", code, message, block, ...(page ? { page } : {}) });

  for (const o of probe.overflow) {
    add("overflow", o.what === "string"
      ? `An unbreakable string of ${o.length} characters ("${o.text}…") is ${o.by} mm wider than its box. Shorten it, or give it a line of its own.`
      : `Content runs ${o.by} mm past the right margin.`, o.block);
  }
  for (const c of probe.cells) add("cell-overflow", `"${c.text}" is ${c.by} mm wider than its column.`, c.block);
  for (const im of probe.images) if (im.dpi < 200) add("image-resolution", `The image prints at ${im.dpi} dpi (${im.natural} px over ${Math.round(im.printedIn * 25.4)} mm); at least 200 dpi looks sharp on paper.`, im.block);
  for (const c of probe.codes) {
    if (c.kind === "qr-code") add("qr-capacity", `The QR payload is ${c.bytes} bytes; a QR code holds at most 2331 at error correction M. Shorten it.`, c.block);
    else add("barcode-value", "The barcode value is not printable ASCII (Code 128-B).", c.block);
  }
  for (const w of probe.window) add("window-overlap", `"${w.text}" shows through the envelope window; a window shows the address and nothing else.`, w.block);

  const pages = read.pages.length;
  if (pages > LIMITS.pages) add("page-limit", `${pages} pages; a document has at most ${LIMITS.pages}.`, null);

  // Headings that end a page.
  read.pages.forEach((p, i) => {
    if (i === pages - 1) return;
    const last = p.body.at(-1);
    if (!last) return;
    // Case- and space-blind: an eyebrow prints in letter-spaced capitals its text does not have.
    const flat = (t: string) => t.toLowerCase().replace(/\s+/g, "");
    const at = flat(last.text);
    const h = probe.headings.find((x) => x.text && (flat(x.text) === at || (at.length >= 8 && flat(x.text).endsWith(at))));
    if (h) add("orphan-heading", `"${h.text}" is the last thing on page ${i + 1}; it belongs with what follows.`, h.block, i + 1);
  });

  // Totals that left their rows.
  for (const t of probe.totals) {
    if (!t.first || !t.lastRow) continue;
    const pageOf = (text: string, fromEnd: boolean) => {
      const order = read.pages.map((p, i) => ({ p, i }));
      if (fromEnd) order.reverse();
      return order.find(({ p }) => p.body.some((l) => l.text.includes(norm(text))))?.i;
    };
    const rowPage = pageOf(t.lastRow, true);
    const totalsPage = (() => {
      const after = read.pages.findIndex((p, i) => i >= (rowPage ?? 0) && p.body.some((l) => l.text.startsWith(norm(t.first!))));
      return after === -1 ? undefined : after;
    })();
    if (rowPage !== undefined && totalsPage !== undefined && totalsPage > rowPage) {
      add("split-totals", `The totals are on page ${totalsPage + 1}, the last rows they total on page ${rowPage + 1}.`, t.block, totalsPage + 1);
    }
  }

  read.pages.forEach((p, i) => { if (p.body.length === 0) add("blank-page", `Page ${i + 1} has nothing on it but the running header and footer.`, null, i + 1); });

  const families = declaredFamilies(report);
  read.pages.forEach((p, i) => {
    for (const f of undeclaredFonts(p.fonts, families)) add("font-fallback", `Page ${i + 1} sets text in ${fontFamilyOf(f)}, a family this report does not declare (${families.join(", ")}).`, null, i + 1);
  });

  const images = opts.images ? await rasterize(printed.pdf, { dpi: opts.images.dpi, max: opts.images.max }) : [];
  return { findings: dedupe(findings), pages, pdf: printed.pdf, ms: printed.ms, read, images };
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = `${f.code}|${f.block}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export const hasErrors = (fs: Finding[]) => fs.some((f) => f.severity === "error");
