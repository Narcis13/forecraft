// `npm run samples`: the six seed documents as docs/samples/<name>.pdf, and every
// page as docs/samples/<name>-p<n>.png at 150 dpi — rendered by the real
// renderer against a fresh, seeded database. The PNGs are the PDF's own pages.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/index.ts";
import { seedDemo } from "../src/seed.ts";
import { seedReports } from "../src/seed-reports-run.ts";
import { documentPdf } from "../src/reports/service.ts";
import { closeBrowser, rasterize } from "../src/reports/pdf.ts";
import { readPdf } from "../src/reports/preflight.ts";

const OUT = join(import.meta.dirname, "../docs/samples");
const dir = mkdtempSync(join(tmpdir(), "forecraft-samples-"));
const db = openDb(join(dir, "samples.db"));
try {
  const demo = await seedDemo(db, { quiet: true, password: "samples-password-1" });
  const docs = await seedReports(db, demo.workspaceId, { quiet: true });
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (/\.(pdf|png)$/.test(f)) rmSync(join(OUT, f));
  for (const { name, document } of docs) {
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(document.id) as unknown as typeof document;
    const { pdf } = await documentPdf(db, row);
    writeFileSync(join(OUT, `${name}.pdf`), pdf);
    const pages = await rasterize(pdf, { dpi: 150 });
    pages.forEach((png, i) => writeFileSync(join(OUT, `${name}-p${i + 1}.png`), png));
    if (name === "invoice") writeFileSync(join(import.meta.dirname, "../public/images/marketing/document-invoice.png"), (await rasterize(pdf, { dpi: 96, max: 1 }))[0]!);
    const read = await readPdf(pdf);
    const fonts = [...new Set(read.fonts.map((f) => f.replace(/^[A-Z]{6}\+/, "").replace(/-(Regular|Bold|SemiBold|Medium|Semibold|Light)$/i, "")))];
    console.log(`✓ ${name}.pdf — ${document.number}, ${pages.length} page${pages.length === 1 ? "" : "s"}, ${read.pages[0]!.width.toFixed(2)} × ${read.pages[0]!.height.toFixed(2)} pt, fonts: ${fonts.join(", ")}`);
  }
} finally {
  await closeBrowser();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
