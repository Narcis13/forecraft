// HTML → PDF → page PNGs, in headless Chromium (playwright-core).
//
// One browser stays warm; every render gets a fresh context and is torn down
// after. The page lives on a fake origin answered entirely by `route`: the
// document itself, Faqir's files under /ui/, our /print.css and /document.js,
// pdf.js under /vendor/pdfjs/, and /assets/:id from the caller. Every other
// request is aborted, so a render never touches the network and does not need
// the HTTP server. A timeout, a page limit and a concurrency cap with a queue
// bound what one definition can cost; a full queue is `RenderBusy` (a 503).

import { chromium, type Browser, type BrowserContext, type Route } from "playwright-core";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

export const ORIGIN = "https://render.forecraft.invalid";
const ROOT = join(import.meta.dirname, "../..");
const STATIC: [prefix: string, dir: string][] = [
  ["/ui/", join(ROOT, "ui")],
  ["/vendor/pdfjs/", join(ROOT, "node_modules/pdfjs-dist/build")],
  ["/", join(ROOT, "public")],
];
const TYPES: Record<string, string> = {
  ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".html": "text/html",
};

export const LIMITS = {
  /** Wall-clock budget of one render, in ms. */
  timeout: Number(process.env.FORECRAFT_RENDER_TIMEOUT ?? 20_000),
  /** A document longer than this is refused (preflight `page-limit`). */
  pages: 40,
  /** Renders in flight at once, and renders allowed to wait. */
  concurrency: Number(process.env.FORECRAFT_RENDER_CONCURRENCY ?? 2),
  queue: Number(process.env.FORECRAFT_RENDER_QUEUE ?? 8),
};

export class RenderBusy extends Error {
  retryAfter = 5;
  constructor() { super("The renderer is busy: too many documents are waiting."); }
}
export class RenderFailed extends Error {}

/** An asset the page may load: `/assets/:id`. */
export type AssetLookup = (id: string) => { bytes: Uint8Array; type: string } | undefined;

// ── The warm browser ────────────────────────────────────────────────────────

let browser: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch({ headless: true, args: ["--disable-gpu", "--font-render-hinting=none"] });
    browser.then((b) => b.on("disconnected", () => { browser = null; }), () => { browser = null; });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (b) await (await b).close().catch(() => {});
}

// ── The queue ───────────────────────────────────────────────────────────────

let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= LIMITS.concurrency) {
    if (waiting.length >= LIMITS.queue) throw new RenderBusy();
    await new Promise<void>((go) => waiting.push(go));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ── Requests ────────────────────────────────────────────────────────────────

async function staticFile(path: string): Promise<{ body: Buffer; type: string } | null> {
  for (const [prefix, dir] of STATIC) {
    if (!path.startsWith(prefix)) continue;
    let rel: string;
    try { rel = decodeURIComponent(path.slice(prefix.length)); } catch { return null; } // a malformed escape is a 404, not a stall
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep)) return null;
    try {
      return { body: await readFile(file), type: TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" };
    } catch {
      if (prefix !== "/") return null;
    }
  }
  return null;
}

async function context(pages: Record<string, string>, assets?: AssetLookup, sheet?: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await (await getBrowser()).newContext({
    serviceWorkers: "block",
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-GB",
    timezoneId: "UTC",
    // The paper's own width (mm → CSS px), so a layout probe measures what prints.
    viewport: sheet ? { width: Math.round(sheet.width * 96 / 25.4), height: Math.round(sheet.height * 96 / 25.4) } : { width: 1240, height: 1754 },
  });
  ctx.setDefaultTimeout(LIMITS.timeout);
  const serve = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort("blockedbyclient");
    if (url.pathname in pages) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: pages[url.pathname] });
    const asset = /^\/assets\/([\w-]+)$/.exec(url.pathname);
    if (asset) {
      const hit = assets?.(asset[1]!);
      return hit ? route.fulfill({ status: 200, contentType: hit.type, body: Buffer.from(hit.bytes) }) : route.abort("blockedbyclient");
    }
    const file = await staticFile(url.pathname);
    return file ? route.fulfill({ status: 200, contentType: file.type, body: file.body }) : route.abort("blockedbyclient");
  };
  // Every request is answered: one that throws is aborted, never left to the timeout.
  await ctx.route("**/*", (route: Route) => serve(route).catch(() => route.abort("failed").catch(() => undefined)));
  return ctx;
}

async function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RenderFailed(`${what} took longer than ${LIMITS.timeout} ms`)), LIMITS.timeout); });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

// ── Print ───────────────────────────────────────────────────────────────────

export interface Printed {
  pdf: Buffer;
  /** What the print-media layout pass measured (see preflight). */
  layout: unknown;
  ms: number;
}

/**
 * Print one HTML document. `probe`, when given, is a function body evaluated in
 * the page under print media after fonts and Faqir's drawing controllers have
 * settled; whatever it returns comes back as `layout`.
 */
export function printPdf(html: string, opts: { assets?: AssetLookup; probe?: string; sheet?: { width: number; height: number } } = {}): Promise<Printed> {
  return slot(async () => {
    const started = performance.now();
    const ctx = await context({ "/document": html }, opts.assets, opts.sheet ?? { width: 210, height: 297 });
    try {
      return await withTimeout((async () => {
        const page = await ctx.newPage();
        await page.emulateMedia({ media: "print", colorScheme: "light" });
        await page.goto(`${ORIGIN}/document`, { waitUntil: "load" });
        await settle(page);
        const layout = opts.probe ? await page.evaluate(`(() => { ${opts.probe} })()`) : null;
        const pdf = await page.pdf({
          preferCSSPageSize: true,
          printBackground: true,
          displayHeaderFooter: false,
          tagged: true,
          outline: true,
        });
        return { pdf, layout, ms: Math.round(performance.now() - started) };
      })(), "Rendering the PDF");
    } finally {
      await ctx.close().catch(() => {});
    }
  });
}

/** Fonts loaded, and every qr-code and barcode either drawn or given up on. */
async function settle(page: import("playwright-core").Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const drawn = () => [...document.querySelectorAll<HTMLElement>('[data-ui="qr-code"], [data-ui="barcode"]')]
      .every((el) => !el.dataset.value || el.querySelector('[data-part="svg"]') || el.dataset.fcFailed);
    const started = Date.now();
    while (!drawn() && Date.now() - started < 3000) await new Promise((r) => setTimeout(r, 25));
    // Images must be decoded before printing.
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    await document.fonts.ready;
  });
}

// ── Pages as PNG (pdf.js inside the same Chromium) ─────────────────────────

const RASTER_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>raster</title></head><body>
<script type="module">
import * as pdfjs from "/vendor/pdfjs/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
window.rasterize = async (b64, dpi, max) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const out = [];
  for (let n = 1; n <= Math.min(doc.numPages, max); n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    out.push(canvas.toDataURL("image/png").slice("data:image/png;base64,".length));
  }
  return out;
};
window.rasterReady = true;
</script></body></html>`;

/** The PDF's own pages as PNGs, at `dpi`, at most `max` of them. */
export function rasterize(pdf: Uint8Array, opts: { dpi?: number; max?: number } = {}): Promise<Buffer[]> {
  const dpi = opts.dpi ?? 100;
  const max = opts.max ?? LIMITS.pages;
  return slot(async () => {
    const ctx = await context({ "/raster": RASTER_PAGE });
    try {
      return await withTimeout((async () => {
        const page = await ctx.newPage();
        await page.goto(`${ORIGIN}/raster`, { waitUntil: "load" });
        await page.waitForFunction(() => (window as unknown as { rasterReady?: boolean }).rasterReady === true);
        const b64 = Buffer.from(pdf).toString("base64");
        const pngs = await page.evaluate(([data, d, m]) => (window as unknown as { rasterize: (b: string, d: number, m: number) => Promise<string[]> }).rasterize(data, d, m), [b64, dpi, max] as const);
        return pngs.map((p) => Buffer.from(p, "base64"));
      })(), "Rasterising the PDF");
    } finally {
      await ctx.close().catch(() => {});
    }
  });
}
