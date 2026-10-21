// A block's title stays with its body (UX audit #38): a bars block whose title
// would fall at the bottom of page 1 moves with it to page 2, and preflight
// names an eyebrow title that does end a page as an orphan heading.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { compileReport, type ReportDefinition } from "../../src/reports/model.ts";
import { renderReport, type Rendered } from "../../src/reports/render.ts";
import { closeBrowser, printPdf } from "../../src/reports/pdf.ts";
import { preflight, readPdf } from "../../src/reports/preflight.ts";

after(async () => { await closeBrowser(); });

const TITLE = "Bookings per workshop";
const BARS = [["Advanced React", 9], ["Design systems", 6], ["Accessible forms", 4], ["Testing in CI", 3], ["Print CSS", 2]] as const;

function definition(filler: number): ReportDefinition {
  return {
    schema: {
      type: "object", title: "Keep titles",
      properties: {
        lines: { type: "array", items: { type: "object", properties: { label: { type: "string" }, n: { type: "number" } } } },
        bookings: { type: "array", items: { type: "object", properties: { label: { type: "string" }, n: { type: "number" } } } },
      },
    },
    sample: {
      lines: Array.from({ length: filler }, (_, i) => ({ label: `Filler row ${String(i + 1).padStart(2, "0")}`, n: i + 1 })),
      bookings: BARS.map(([label, n]) => ({ label, n })),
    },
    layout: [
      { id: "title", block: "title", text: "Keep titles with their bodies" },
      { id: "filler", block: "table", rows: "lines", columns: [{ label: "Row", value: "{{ row.label }}" }, { label: "N", value: "{{ number(row.n) }}", format: "number" }] },
      { id: "bookings", block: "bars", title: TITLE, rows: "bookings", label: "{{ row.label }}", value: "row.n" },
    ],
    appearance: { theme: "document", type: "plex-sans", accent: "#1f2937", paper: "a4", locale: "en-GB", currency: "EUR" },
  };
}

function render(filler: number): { report: ReturnType<typeof compileReport>; rendered: Rendered } {
  const report = compileReport(definition(filler));
  return { report, rendered: renderReport({ report, data: report.definition.sample, doc: { number: "T-1", status: "issued", issuedAt: "2026-10-01T09:00:00.000Z" } }) };
}

/** The same page without the keep rules: what printed before the fix. */
const unkept = (r: Rendered): Rendered => ({ ...r, html: r.html.replace("</head>", "<style>[data-report-block] [data-ui=\"text\"][data-variant=\"eyebrow\"] { break-after: auto !important; } [data-report-block=\"bars\"] { break-inside: auto !important; }</style></head>") });

const pageOf = async (html: string, sheet: Rendered["sheet"], text: string) => {
  const read = await readPdf((await printPdf(html, { sheet })).pdf);
  // An eyebrow prints letter-spaced capitals: compare without case or spaces.
  const flat = (t: string) => t.toLowerCase().replace(/\s+/g, "");
  return read.pages.findIndex((p) => p.lines.some((l) => flat(l.text).includes(flat(text))));
};

test("a bars title that would end page 1 moves to page 2 with its bars, and preflight catches one that does not", async () => {
  // How many filler rows page 1 holds, then fillers that put the title near its bottom.
  const probe = render(80).rendered;
  const read = await readPdf((await printPdf(probe.html, { sheet: probe.sheet })).pdf);
  const capacity = read.pages[0]!.lines.filter((l) => /^Filler row \d+/.test(l.text)).length;
  assert.ok(capacity > 10, `page 1 holds ${capacity} rows`);

  let reproduced = false;
  for (let filler = capacity; filler > capacity - 8 && !reproduced; filler--) {
    const { report, rendered } = render(filler);
    const broken = unkept(rendered);
    const titlePage = await pageOf(broken.html, broken.sheet, TITLE);
    const barPage = await pageOf(broken.html, broken.sheet, BARS[0][0]);
    if (titlePage === -1 || titlePage === barPage) continue;
    reproduced = true;
    // Before the fix: the title ends page 1 and its bars start page 2; preflight names it.
    assert.equal(titlePage, 0);
    assert.equal(barPage, 1);
    const pf = await preflight(report, broken);
    const orphan = pf.findings.find((f) => f.code === "orphan-heading");
    assert.ok(orphan, JSON.stringify(pf.findings));
    assert.equal(orphan.block, "bookings");
    assert.equal(orphan.page, 1);

    // With the keep rules: the title prints on the page of its first bar, and preflight is quiet about it.
    assert.equal(await pageOf(rendered.html, rendered.sheet, TITLE), await pageOf(rendered.html, rendered.sheet, BARS[0][0]));
    const ok = await preflight(report, rendered);
    assert.deepEqual(ok.findings.filter((f) => f.code === "orphan-heading"), []);
  }
  assert.ok(reproduced, "some filler length put the title alone at the bottom of page 1");
});
