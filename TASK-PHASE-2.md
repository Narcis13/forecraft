# Task — forecraft, phase 2: reports and documents

Goal: Add **reports** to forecraft: documents that print — invoices, letters, confirmations, business reports, survey summaries — each produced from one JSON definition plus data, rendered as an A4 (or US Letter) PDF that looks like it came from a serious firm's office, not from a web app. Agents create, preview, check and issue them through the API and the MCP server; people do the same in a page designer; everyone else opens a link or a PDF. Every pixel, on screen and on paper, is **Faqir UI 1.2.5**: its `document` pattern, its document tokens and its five print themes. Nothing else draws, with one sanctioned exception (charts, below).
Done when: every command under **Checks** passes, every item under **Acceptance** is observed, and `docs/samples/` holds the PDFs and page images listed there.
Scope: this folder (`C:\newme\forecraft`) and everything inside it. **Read-only:** `C:\newme\faqir-ui` (the upstream checkout: read its source, docs, scaffolds and print tests; never edit it, never run its scripts, never publish from it), and everything else on this machine.
Limit: 10 hours or 75 iterations, whichever comes first.
Subagents: 6
Branch: new, `feat/phase-2-reports`, from `main` (phase 1 is merged there at `b906c69`)
PR: yes, one draft PR into `main` at **Finish**; never merge it
Unattended: yes

If a missing detail would change the result, pick the safest sensible default and record it under Decisions in `PROGRESS.md`. For anything else, choose a sensible default, say what it is, and start.

---

## The product

Phase 1 made forecraft the form tool whose first user is an agent. Phase 2 closes the loop: data comes in through forms (or straight from an agent) and goes out as documents a business can send: an invoice to a client, a confirmation to an attendee, a quarterly report to a board, a survey summary to a team. The agent that built the form can now issue the paper.

Two new nouns, parallel to phase 1's:

| Phase 1 | Phase 2 |
|---|---|
| **Form**: a definition, versioned, published | **Report**: a definition (data schema, layout, appearance), versioned, published |
| **Submission**: data that came in | **Document**: one issue of a report with its data. Numbered, immutable once issued, an HTML view and a PDF. Listed, shared by link, voided, never edited |

**One report definition, three faces, again.** The JSON an agent sends, what the designer edits visually, and what the renderer turns into HTML and PDF are one document. The designer and the API are two clients of it; the renderer is the only code that knows how a block becomes markup. Never let a second representation exist: no stored HTML beside the definition, no designer-only state.

**Taste lives in the renderer, not in the definition.** A definition says *what*: a letterhead, a table of line items bound to `items`, a totals block, payment terms. For appearance it picks from curated values: a print theme, one accent, a paper size, a type pairing, a density. It never says font sizes, colours, margins or positions. That is how an agent that knows nothing about typography still issues a document that looks expensive, and how a person dragging blocks cannot make an ugly one. Every knob you are tempted to add is a question to answer in the renderer instead.

### The report definition

This is the shape, not the final schema. Refine it, keep it one document, and record what changed:

```jsonc
{
  "schema":     { /* JSON Schema of the data: phase 1's supported subset, plus arrays of objects for line items.
                     The report's name and description are the schema's root title and description, as for forms. */ },
  "sample":     { /* example data, valid against schema: what previews, the designer and the starters render */ },
  "layout":     [ /* ordered blocks from the vocabulary below; each { "id", "block", ...props, "when"?, "keep"? } */ ],
  "appearance": { "theme": "document", "accent": "#1f3a8a", "paper": "a4", "orientation": "portrait",
                  "margins": "normal", "type": "plex-sans", "density": "comfortable",
                  "locale": "en-GB", "currency": "EUR", "logo": "asset:…",
                  "letter": { "window": true, "foldMarks": true } },
  "money":      { "lines": "items", "quantity": "qty", "unitPrice": "price", "taxRate": "vat",
                  "discount": "discount", "prices": "net", "rounding": "line" },      // optional: invoices, quotes, receipts
  "numbering":  { "pattern": "INV-{YYYY}-{seq:4}" },                                  // or { "manual": true }; optional
  "documentTitle": "{{ customer.name }} · {{ money(doc.money.total) }}",             // a document's name in lists
  "source":     { "kind": "data" }    // or { "kind": "submission", "form": "<id>" } or { "kind": "summary", "form": "<id>" }
}
```

- **Expressions are `@faqir-ui/template` expressions.** Read `C:\newme\faqir-ui\docs\template.md` §6, §8, §9 and §13 before designing anything. A prop that *renders* is template text with `{{ }}` holes; a prop that *decides* or *selects* (`when`, `rows`) is a bare expression. One expression language for the whole feature: no second one, no `eval`. The engine's "missing is an error" is a feature here: a missing path is a preflight error in preview and a 422 at issue, and `??` is how a definition says a value is optional.
- **Helpers** are host functions registered with the engine: `money`, `number`, `percent`, `date`, `datetime`, `label` (the localised built-in words), `iban` (grouped by four), `sum`, `count` and `avg` over an array by key, `round`, `join`, `upper`, and `epc` (a SEPA payment QR payload, EPC069-12). Keep the list short, document each one, and make each one total and locale-correct (`Intl`, the document's locale).
- **System values** live under one reserved root, `doc`, which the schema may not declare: `doc.number`, `doc.status`, `doc.issuedAt`, `doc.locale`, `doc.currency`, `doc.money` (lines, subtotal, per-rate taxes, total, paid, due), `doc.labels`, and `doc.submission` when the source is a submission.
- **Money is exact.** `money` turns lines into integer minor units (BigInt) using the currency's ISO 4217 digits. It computes line nets, discounts, per-rate tax and totals with an explicit rounding rule (`line` or `total`, half away from zero) and exposes the result as `doc.money`. The printed lines, the tax breakdown and the total add up to the cent, every time, and no float ever touches money. `@faqir-ui/rules` JSONLogic has no `reduce`: that is an upstream note, not a reason to compute money in it.
- **Numbering is gapless.** A number is assigned only at issue, inside the same SQLite transaction that marks the document issued. Drafts have no number and print `DRAFT` with a watermark. A voided document keeps its number and prints `VOID`. `{YYYY}` resets the sequence yearly. `manual` takes the number from the request and enforces uniqueness per report.
- **Sources.** `data`: the caller sends the data. `submission`: the data is a submission's answers plus `doc.submission`, so a form can issue its own confirmation (record how a later change to the form reaches a bound report). `summary`: forecraft computes the data from a form's submissions over a period chosen at issue: counts, per-question distributions, averages, NPS, submissions over time and a sample of free-text answers, in one fixed, documented shape that the layout binds to.
- **Validation.** The data is validated as in phase 1: shape via `@faqir-ui/rules` on `schema`, with 422 problems that name the JSON pointer. The definition is validated just as strictly: every expression is compiled at save time, and a diagnostic is a 422 that names the block's pointer and the line and column inside the expression.
- **Lifecycle.** As with forms, preview works on the working copy and documents are issued only from a published version. A document records the version it came from and re-renders identically from it.

### Block vocabulary

Each block renders through a `.faqir` partial in `templates/reports/blocks/`, composed from Faqir components, so its output is canonical markup that passes `faqir audit`. Start from Faqir's own document compositions: the `document` pattern and its `document-print.html` reference, and the `invoice` and `report` scaffolds in `C:\newme\faqir-ui\src\scaffolds\documents.ts` (also reachable through `faqir_scaffold_page`).

| Block | Composed from | For |
|---|---|---|
| `letterhead` | `doc-header`, `image` (logo asset), `text`, `key-value` | sender identity on the first page |
| `title` | heading, eyebrow, `key-value` | document type, number, key dates |
| `parties` | `description-list` or `key-value` in a `grid` | from, bill to, ship to; with `appearance.letter.window` the first party sits in the envelope window |
| `facts` | `key-value` (grid) | references, dates, terms, PO numbers |
| `table` | `table` recipe with `data-format` number/currency/percent | rows bound to an array; columns with label, value, format, align and a width hint; footer rows |
| `totals` | `key-value`, table-footer styling | subtotal, discount, tax per rate, total, paid, due |
| `text` | prose compiled from markdown | paragraphs, lists, emphasis, links |
| `callout` | `callout` | payment instructions, notes |
| `stats` | `stat` | KPI figures |
| `bars` | `progress` | shares and distributions, labelled with figures |
| `chart` | inline SVG (the sanctioned exception) | bar, column, line; nothing else |
| `quote` | `quote` | verbatims, testimonials |
| `section` | `section` and a heading | grouping, with optional `1.` / `1.1` numbering |
| `columns` | `grid` | two or three columns of child blocks |
| `signature` | `signature` | signing lines with name, role, date |
| `qr`, `barcode` | `qr-code`, `barcode` | payment, check-in, verification |
| `image` | `image` | figures from assets, with captions |
| `stamp`, `watermark` | `stamp`, `watermark` | PAID, VOID, COPY, DRAFT |
| `separator`, `page-break` | `separator`, `page-break` | structure |
| `answers` | `key-value`, and `table` for repeatable groups | every answer of a bound submission, in form order, with zero configuration |
| `footer` | `doc-footer` | legal lines, registration, bank details, the page counter |
| `faqir` | an `@faqir-ui/template` fragment | the escape hatch |

Every block has an `id` (stable and unique; the designer and preflight address blocks by it) and takes `when` and `keep` (`together` or `with-next`) for pagination.

- **Markdown** in `text` is compiled at save time from marked's tokens into template nodes (headings, paragraphs, lists, emphasis, and links checked by the engine's URL allow-list), with holes kept as holes. Never `raw`, never HTML from markdown. Data inserted into text is always escaped text.
- **The `faqir` block** holds a fragment of Faqir template source for what the vocabulary lacks. It is compiled with `raw: false`, its component calls are checked against the manifests, its AST is linted to refuse `style` and `class` attributes (so even a custom block speaks in tokens), and it is bounded in size and render steps. Agents get full expressive power; nobody gets arbitrary HTML, CSS or JavaScript.
- **Charts** are the one thing Faqir does not draw. A `chart` block is rendered on the server as inline SVG by one module, `src/reports/chart.ts`: bar, column and line only; colours, type and rules read Faqir custom properties, never a literal colour; zero-based value axes for bars; direct labels instead of legends where they fit; series that stay distinguishable in greyscale; `role="img"`, an `aria-label`, and the numbers also available as a table. Write the upstream entry proposing a `chart` primitive with exactly these semantics on the same day you write the module.

### What ships in phase 2

1. **The renderer** (`src/reports/`): definition plus data becomes one HTML document (a `document` pattern page in the report's theme, self-hosted fonts, no external request), which becomes a PDF. Formatting is locale-correct everywhere. Built-in label sets for `en`, `ro`, `de` and `fr` cover the words the renderer writes itself (Invoice, Page 1 of 3, Subtotal, VAT, Total, Amount due, Due date, Draft, Void, Paid, Copy, …) and are overridable per report (`labels`). `locale` and `currency` can be overridden per document, so one invoice report can bill abroad.
2. **PDF** (`src/reports/pdf.ts`): headless Chromium through `playwright-core`. Keep one browser warm and use a fresh context per render. Call `page.pdf` with the CSS page size, backgrounds on, browser headers and footers off, tagged, and with an outline for documents that have headings. Every request the page makes is intercepted and either served from disk or the database (`/ui/`, `/public/`, `/assets/`, and the document itself, for example on a fake origin answered entirely by `page.route`) or aborted. The renderer never touches the network and does not need the HTTP server to be running. Faqir controllers that draw (`qr-code`, `barcode`) run before printing: wait for them and for `document.fonts.ready`. Add a render timeout, a page limit, a concurrency cap with a queue, and a 503 with `Retry-After` when the queue is full. An issued document's PDF is rendered once (at issue, or on first download when issue happened inside a public submission) and stored with its SHA-256; every download serves those bytes. Drafts render on demand. Record warm and cold render times for a one-page document; warm should be under 2 s on this machine.
3. **Preflight** (`src/reports/preflight.ts`) is the print shop's check, run on every preview and before every issue. It returns findings `{ severity, code, message, block, page? }` that an agent can act on:
   - `missing-data`: the path and the block.
   - `overflow`: anything wider than the page's content box, including unbreakable strings like IBANs and URLs.
   - `cell-overflow`, and `too-many-columns` (more than the paper and orientation hold legibly).
   - `orphan-heading`: a heading or section title that is the last thing on a page.
   - `split-totals`: totals or payment details separated from the rows they total.
   - `blank-page` and `page-limit`.
   - `image-resolution`: under 200 dpi at printed size.
   - `font-fallback`: any glyph set in a family the report did not declare, read from the PDF's font list.
   - `qr-capacity`: a payload the QR recipe cannot encode.

   Layout checks run in Chromium under print media at the paper's width; pagination checks read the PDF itself with `pdfjs-dist` (text positions per page, fonts). Errors block issue; warnings are listed. The page images that come back with a preview are the PDF's own pages, never screenshots of a screen layout.
4. **Starters** (`src/reports/starters/*.json`): at least **invoice**, **business letter**, **business report**, **confirmation** (asks for a form when it is created; check-in QR and barcode), **survey summary** (summary source) and **blank**. Each one is a complete, stunning definition with realistic sample data, and each is the first thing an agent or a person sees when they create a report ("Start from an invoice"). Nobody should need to start from blank.
5. **The API** (`/api/v1`; phase 1's auth, problem details, rate limits and OpenAPI discipline):
   - Reports: CRUD, versions and publish.
   - `POST /reports/:id/preview`: `data` is optional and falls back to `sample`; `format` is `html`, `pdf` or `png`; returns preflight and page images.
   - `POST /reports/:id/documents`: create a draft or issue directly.
   - Documents: list (filter by report, status, date, number), get, `…/pdf`, issue, void (with a reason), rotate the share link, delete (drafts only). Issued documents are immutable: a PATCH is a 409 problem.
   - `GET /submissions/:id/pdf` prints any submission of any form through a built-in **submission record** (the `answers` block in the pattern's `form` variant), with zero setup.
   - `POST /assets` takes logos and figures (PNG, JPEG, WebP, SVG): size-limited, sniffed by magic bytes, stored in SQLite, served with `nosniff` and, for SVG, a sandboxing CSP. Reports reference assets by id, never by remote URL.
   - `GET /vocabulary/reports` lists the blocks with one JSON example each, the helpers, print themes, type pairings, locales, paper sizes and preflight codes. `GET /report-starters` lists the starters.
   - `/openapi.json` and `/llms.txt` cover all of it. PDF and PNG renders draw from their own, smaller rate-limit bucket, and issue-on-submit renders count against the form's per-IP limit.
6. **The MCP server** gains `forecraft_get_report_vocabulary`, `forecraft_list_report_starters`, `forecraft_create_report` (from a starter or a full definition), `forecraft_update_report`, `forecraft_get_report`, `forecraft_list_reports`, `forecraft_preview_report`, `forecraft_publish_report`, `forecraft_issue_document`, `forecraft_list_documents`, `forecraft_get_document`, `forecraft_void_document` and `forecraft_upload_asset`. `forecraft_preview_report` returns the preflight **and the pages as MCP image content** (capped, for example the first four pages at about 100 dpi), so a multimodal agent sees what it made. Resources: `forecraft://report/{id}` (the definition) and `forecraft://document/{id}` (metadata, data and the PDF as a blob). Each tool description teaches the house style in two sentences, not twenty.
7. **Public document view** (`/d/:token`, `/d/:token.pdf`): on screen, the document is paper on a desk (the `document` pattern's screen styles), with a toolbar outside the sheet (Download PDF, Print, Copy link) that is hidden in print. It is `noindex`, its token is a random 128-bit value, and rotating the token revokes the link. Printing this page in Chromium produces the same pages as the server PDF; other browsers are best effort, and you record how they do. At phone width the sheet runs edge to edge and stays readable.
8. **Dashboard** (`/app/reports`, `/app/documents`):
   - The reports library is a shelf of real page thumbnails: page 1 of each published version, rendered once and cached.
   - A report page: overview, a documents table with status and number filters, versions, and settings (numbering, source, share defaults).
   - A documents list across all reports, and a document page: the sheet, plus download, print, copy link, rotate link, void with a reason, and the data as JSON.
   - Phase 1's form pages gain a PDF action on every submission row and a **Documents** setting: the confirmation report for this form, issue on submit (on or off), and a link on the thank-you state (on or off). When that is on, the thank-you state shows "Download your confirmation (PDF)".
   - Empty states that help: "Start from an invoice, or ask your agent to".
9. **The report designer** (`/app/reports/:id/design`) is the same three-pane tool as the form designer, built the same way (faqir-core, native drag and drop, no editor library), except that the canvas is the page.
   - **Left:** the block palette, grouped into structure, data, content, office and advanced.
   - **Centre:** the real document, rendered by the server renderer with the sample data on a true-scale sheet in the report's theme, zoomable (fit, 100 %, 150 %). Hover outlines, selection, drag reordering with drop indicators, keyboard reordering (alt+arrow).
   - **Right:** properties for the selected block: text with holes, an **Insert field** picker built from the schema's paths, formats, a column editor for tables, `when`, `keep`.
   - **Tabs:**
     - **Layout.**
     - **Data:** the schema as a field list; a sample data editor with live validation; infer a schema from the sample; bind to a form (schema from the form, sample from its latest submission).
     - **Appearance:** print themes as thumbnails, accent, paper, orientation, margins, type pairing, density, locale, currency, logo upload, letter window and fold marks.
     - **JSON:** the exact definition, editable, validated live.
     - **Preflight:** the findings (click one to select its block) and a strip of real page thumbnails that refreshes after each save.
   - Undo/redo (at least 20 steps), autosave with a visible state, an unsaved-changes guard, publish, and "Issue a test document". Wide viewport only, and it says so on a phone.
10. **Seed and samples.** `npm run seed` adds one report per starter to the phase 1 demo workspace, plus six real documents:
    - an invoice, issued and marked paid: `en-GB`, EUR, one page, SEPA QR, PAID stamp;
    - a long invoice: `ro-RO`, RON, about 60 lines, three pages;
    - a business letter: `en-GB`, window address, fold marks, signatures for two parties;
    - a quarterly business report on **US Letter**: cover, numbered sections, stats, a chart, tables, an outline;
    - an event confirmation issued from a real submission of the phase 1 event registration form: QR and barcode;
    - a survey summary of the phase 1 customer survey (seed about 120 deterministic, pseudo-random submissions so the numbers mean something).

    Five print themes: both invoices on `document`, the letter on `document-serif`, the business report on `editorial-document`, the confirmation on `ink-document` and the survey summary on `swiss-document`. `npm run samples` writes each document to `docs/samples/<name>.pdf` and every page to `docs/samples/<name>-p<n>.png` at 150 dpi.
11. **Docs:**
    - `docs/reports.md`: concepts, the definition, every block with an example, expressions and helpers, money, numbering, sources and preflight codes.
    - `docs/report-style.md`: the house style below, written for agents. It says what to choose and why, and lists the five most common ways to make a document look cheap.
    - `docs/for-agents.md` gains the reports curl sequence and `docs/mcp.md` the new tools. `/for-agents` and `llms.txt` gain a short "issue your first invoice" path.
    - The marketing landing page gains one section about documents, with a real thumbnail. Nothing else on the marketing site changes.

### Quality bar: the house style

We aim for the highest quality possible. The documents must be **stunning in the way serious paper is**: calm, exact, legible and expensive-looking. A reviewer holding the printed invoice should think "a law firm or a good accountant sent this", never "a web app exported this". Concretely, and encoded in the renderer so every report gets it for free:

- **Paper.** A4 (210 × 297 mm) by default, US Letter supported, portrait by default and landscape per report. Margins are real print margins from the doc tokens (`narrow`, `normal`, `wide`), never edge-to-edge content. No screen chrome, shadow, rounded corner, gradient, glow, texture or motion reaches paper.
- **Type.** Self-hosted families only (`npx faqir fonts add`; IBM Plex Sans, Serif and Mono, Source Serif 4, Newsreader and Inter are in the catalogue). At most two families per document plus a mono for codes and IBANs, and every weight that is used is installed (no synthesised bold or italic). Point sizes for print: body about 9.5–10.5 pt, tables 8.5–9 pt, fine print 7.5–8 pt, titles 16–24 pt; line height 1.3–1.5. Tabular lining figures in every numeric context. Labels and eyebrows in small, letter-spaced capitals. `lang` on the document, so hyphenation and quotation marks follow the locale. Diacritics render in the document's own face (ă â î ș ț ä ö ü ß é è ç € £), with no fallback glyph anywhere; preflight proves it.
- **Ink.** Everything reads in pure black on white. At most one accent, from one hex value, used for at most three kinds of element (for example the top rule, the eyebrow and the amount due). Every page still reads when converted to greyscale and printed on a monochrome laser printer. Tints only where they survive greyscale; `print-color-adjust: exact` only where a tint carries meaning.
- **Grid and rules.** One column grid per document: the letterhead, the parties, the table's first column and the footer share a left edge, and amounts share a right edge. Hairline rules (about 0.5 pt) in neutral grey. Space separates more than lines do; no boxes around everything.
- **Figures.** Numbers are right-aligned on tabular figures, with decimals consistent per currency, the currency written the way the locale writes it, and negative amounts unmistakable. The total sits under a rule and stands out by weight and size, never by a coloured box alone. A table never has more columns than its paper holds legibly, and preflight says so before a person sees it.
- **Pagination.** A running footer on every page with the localised page counter ("Page 2 of 3", "Pagina 2 din 3"). A running header from page 2 on for multi-page documents (document type, number, counterparty), and none on page 1 under a letterhead. Table headers repeat on every page; rows never split; a heading never ends a page; totals and payment details never leave the last rows; signatures never separate from their labels; widows and orphans at least 2; no blank trailing page.
- **Office details.** The letter starter puts the recipient's address in a DIN 5008 Form B window field and draws fold marks (105 mm and 210 mm) and a punch mark (148.5 mm) in the left margin, faint and exact. A window envelope must show the address and nothing else. Stamps (`PAID`, `VOID`, `COPY`) use Faqir's `stamp`, turned a few degrees, in the right ink. Drafts carry a `DRAFT` watermark and no number. A SEPA invoice carries an EPC payment QR. IBANs print in mono, grouped by four.
- **Fidelity.** Real, selectable, searchable text (the tests extract it). Fonts embedded, and only the declared ones. SVG logos stay vector, and links stay clickable. PDF metadata carries the title (from `<title>`) and the language. If Chromium cannot set author and subject without post-processing, record that and leave them out; do not add a PDF library for it. File names are the document number (`INV-2026-0042.pdf`). The same definition version, data and locale give the same pages on any machine (Windows here, Linux later): no system font, no network, no clock except `doc.issuedAt`.
- **Screen.** The share view and the designer canvas show the same sheet the PDF prints, on a desk, in the theme's own paper colour. Documents are always light ink on paper, whatever the viewer's colour scheme.

The surfaces around the documents keep phase 1's bar: the designer feels like a tool, the reports library looks like a shelf of real paper, and every page a person visits works at phone width except the designer, which says it needs a wide screen.

## Stack (phase 1's, plus these decisions; change only with a recorded reason)

- Everything under phase 1's **Stack** still holds: Node 24 with type stripping, Hono, `node:sqlite` with hand-written migrations (`src/db/migrations/002_…sql` onward), server-rendered `.faqir` templates, faqir-core in the browser, Faqir 1.2.5 pinned exactly, and none of React, Vue, Tailwind, an ORM, Zod, Express, Next or Vite. No CSS of your own beyond `public/app.css`, plus `public/print.css` if, and only if, a document needs page-level composition that tokens cannot express (DIN geometry, fold marks). Comment every rule there with its upstream entry.
- **Faqir additions:** `npx faqir add document page-break signature qr-code barcode`, plus whatever else the blocks need. The five document themes are already scoped in `ui/themes/`. Read each manifest before writing markup that uses it (`faqir_get_manifest`), and run `faqir_audit_html` on rendered documents while you build.
- **Fonts, carefully:** `faqir fonts add` always assigns a role, and a role has exactly one family, so installing a print family can silently take `body` or `heading` away from the app's own type. Work out how to install the print families without changing the app's look, and confirm the phase 1 pages still match `docs/screenshots/` afterwards. Whatever it takes is an upstream entry.
- **New runtime dependencies, and only these:** `playwright-core@1.64.1` (the same version as `@playwright/test`, so one Chromium serves the renderer and the tests), and `pdfjs-dist` at an exact version at least two weeks old, used to rasterise PDF pages inside the same headless Chromium and to read text, positions and fonts out of PDFs in preflight and tests. Test-only, a QR decoder such as `jsqr` may be a devDependency, to prove the codes scan. Add no Puppeteer, Paged.js, pdfkit, pdf-lib, chart library, QR generator, decimal library or second template engine: Chromium lays out, Faqir draws, `@faqir-ui/template` templates and BigInt counts money. Use Context7 for Playwright (`page.pdf`, `page.route`, browser contexts), pdf.js and `node:sqlite`; do not guess APIs.
- **Chromium** is installed with `npx playwright install chromium` (allowed). The README says what a Linux host needs (`npx playwright install --with-deps chromium`); deploying is out of scope.
- **Read these upstream references before writing the renderer:** the `document` pattern (manifest, CSS, `document-print.html`), `tokens/document.css` and `tokens/doc-aliases.css`, the five `*-document` themes, the `invoice` and `report` scaffolds, and Faqir's own print harness (`C:\newme\faqir-ui\playwright.print.config.ts` and `tests/visual/print/`), which shows how Faqir itself expects Chromium to produce and check PDFs.

Layout additions:

```
src/reports/        model.ts (the definition), blocks.ts, render.ts, pdf.ts, preflight.ts, money.ts,
                    helpers.ts, numbering.ts, summary.ts, chart.ts, store.ts, starters/*.json
src/assets/         upload, sniffing, serving
templates/reports/  document.faqir, blocks/*.faqir
templates/pages/app/  reports, documents and report-designer pages
public/             report-designer.js, document.js
tests/print/        PDF tests (the real renderer, pdfjs-dist assertions)
scripts/samples.ts  docs/samples/*.pdf and page PNGs
docs/               reports.md, report-style.md, samples/
```

## Checks

Phase 1's checks are the baseline and must stay green. Run them before the first change (they are expected to pass at `b906c69`; record anything that does not) and after every milestone:

```bash
npm run check
```

`check` becomes `typecheck` + `audit` + `test` + `test:print`, where:

- `audit` also renders and audits every new page: the reports library, a report page, the designer, the documents list, a document page, and the share view of every seed document. Widening what the audit covers is expected; loosening it is not.
- `test` gains unit and API tests for:
  - the definition model: every 422 names its pointer, including expression diagnostics inside a block;
  - money, with at least twelve vectors: 0.1 + 0.2, 3 × 33.333, mixed 19 % / 9 % / 5 % rates, a line discount, half-way rounding in both modes, a credit note with negative lines, and a zero-decimal currency such as JPY;
  - numbering: gapless under concurrent issues, the yearly reset, manual uniqueness;
  - helpers in each locale;
  - markdown compilation: no HTML gets through;
  - the `faqir` block: it refuses `raw`, `style`, `class` and unknown components;
  - assets: a script disguised as a PNG is refused;
  - the summary shape;
  - the API end to end, including immutability (409) and share-link rotation.
- `test:print` (`node --test "tests/print/**/*.test.ts"`) renders every starter and seed document with the real renderer and asserts on the PDF:
  - page size (A4 595.28 × 841.89 pt, Letter 612 × 792 pt, ±0.5) and page count;
  - the number, the total and the counterparty in the text;
  - the page counter on every page, and the table header on every page that has rows;
  - the last row and the total on the same page, and no blank page;
  - embedded fonts are exactly the declared families;
  - title and language metadata, an outline for the business report, and clickable links where the definition has them.

At milestones that touch the browser:

```bash
npm run test:e2e
```

It gains the report designer journey and the confirmation-on-submit journey. And `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health` still returns `200` while `npm start` is running.

## Acceptance (observe each one; do not infer)

1. **An agent with only an API key and `curl`** can upload a logo, list the starters, create a report from the invoice starter with its own company and accent, preview it (HTML, preflight, page PNGs), publish it, issue a document from JSON data and receive its number, PDF URL and share URL, download the PDF, void it with a reason, and issue the next one with the next number. The exact sequence is in `docs/for-agents.md`, and you ran it verbatim.
2. **An MCP host** (a scripted `tools/list` and `tools/call` over stdio against `node packages/mcp/index.mjs`) can do the same, and `forecraft_preview_report` returns page images as MCP image content alongside the preflight.
3. **A person** can do all of this:
   - sign up, then create a report from blank in the designer by dragging in a letterhead, a title, a facts block, a table bound to `items` with four columns, a totals block, a text block and a signature;
   - bind fields through the Insert field picker, and pick a print theme, an accent, the paper and a locale;
   - reach a clean preflight, publish, issue a document from the dashboard and download the PDF;
   - open the share link at phone width.

   Printing the share view in Chromium gives the same page count as the server PDF.
4. **Forms meet documents.** A person sets the event registration form's confirmation report and fills in the public form at phone width. The thank-you state offers "Download your confirmation (PDF)", and that PDF carries their answers, a QR code that scans (decode it) and a barcode. Every submission of every form prints from the submissions table through the zero-setup submission record.
5. **Money adds up.** In the PDF text of the issued invoices, the lines, the VAT breakdown and the totals agree to the cent, and the money vectors pass.
6. **Pagination holds.** The 60-line `ro-RO` invoice is three pages, with "Pagina n din 3" on each, the running header from page 2, the table header repeated, no split row, the totals with the last rows and no blank page. `test:print` asserts it, and you saw it on the page images.
7. **Preflight catches what it claims.** Seed a definition with a nine-column portrait table, a missing path, a heading that lands last on a page, a 72-dpi logo, an unbreakable 80-character string and a QR payload too long to encode. It gets exactly those findings, with the right block ids, and after the fixes it is clean. Issue is refused while an error stands.
8. **Every HTML page the server emits audits clean** with `faqir audit`, including the share views of all seed documents. Warnings are listed in `PROGRESS.md` with a reason.
9. **The samples are stunning.** `docs/samples/` holds the PDF and the 150-dpi page PNGs of the six seed documents, and `docs/screenshots/` gains `reports-desktop.png`, `report-designer-desktop.png`, `document-desktop.png`, `document-phone.png` and `thank-you-confirmation-phone.png`. A reviewer looking only at those files should say "I would send this to a client", not "fine". Every sample page is still fully legible in greyscale.
10. **Same pages everywhere.** The font list of every sample PDF holds only the self-hosted families, and re-rendering a sample gives the same page count and text.
11. **`FAQIR-UPSTREAM.md`** has a numbered entry, from #32 on, for every print and document rough edge found, under a new **Print and documents** section where they fit, and `docs/faqir-digest.md` is updated (see below).

## Faqir upstream loop (continues)

Phase 2 is the first real consumer of Faqir's document layer (the `document` pattern, the doc tokens, the five print themes, `page-break`, `signature`, `qr-code`, `barcode`, `stamp`, `watermark`), so expect it to find more than phase 1 did. The rules and the format are phase 1's (Seen / Where / Why / Here / Suggested fix, in the same file), numbering continues from **#32**, and each entry is written in the step where you hit the issue. Add a **Print and documents** section. A suggested print fix comes with the case it would add to Faqir's own print matrix (`tests/visual/print/matrix.ts`).

Suspects worth checking early. These are leads, not entries: write one only after you have seen the problem, with the markup and the page.

- The print themes name system fonts (`Arial`, `Georgia`, `Times New Roman`), which differ between Windows and Linux. Font roles are project-wide, so a report cannot choose its own pairing, and installing a family takes a role.
- The `document` pattern's page counter is an English literal in a margin box, and its `@page` rules become global once bundled.
- Chromium has no `running()`, so the fixed-position header fallback may repeat on page 1 under a letterhead.
- `qr-code` and `barcode` render only in the browser, and the QR encoder stops at version 10 (an EPC payload can exceed it).
- There is no `chart` primitive and no paper size beyond A4 and Letter (A5 confirmations, A3 reports). There is no way to set an accent at runtime: #9 again, now on paper.
- `@faqir-ui/rules` JSONLogic has no array aggregation, so a form cannot total its own repeatable rows.
- Check how the pattern's markup does as a tagged PDF and an outline, how `table`, `key-value` and `stamp` behave across page breaks, and whether tints survive print without `print-color-adjust`.

At **Finish**, rewrite `docs/faqir-digest.md` as the ten entries most worth fixing first across both phases (phase 1's digest stays in git history), ordered by (how much it hurt forecraft) × (how general it is), three lines each, each linking its entry number. Add what the document layer got right to "What worked unusually well".

## How to work

1. **Orient.** Rename phase 1's `PROGRESS.md` to `PROGRESS-PHASE-1.md` (add it to `.git/info/exclude`), start a new `PROGRESS.md`, and resume from it from then on. Read only what the next decision needs: the manifest before Faqir markup, `docs/template.md` before `@faqir-ui/template`, and the upstream references under **Stack** before the renderer.
2. **Baseline.** Run the checks before changing anything and note the result.
3. **Spike the risk first.** Before the model, the API or the designer, prove the hard part end to end in its smallest form: one hard-coded invoice through `.faqir` partials, the `document` pattern, a print theme and self-hosted fonts, then `playwright-core` to a PDF and `pdfjs-dist` to page PNGs, and look at the pages. Check the running footer, the page counter, the repeated table header, the drawn QR and the embedded fonts. Everything else is built on what this spike teaches; record what it taught.
4. **Small steps.** Make one bounded change, run the checks it affects, and keep it or revert it. Don't repeat a failed approach without a new reason.
5. **Simpler wins.** When two solutions work equally well, keep the one with less code. The report definition is one JSON document, the renderer is the only place that knows markup, and the expression language is Faqir's. Resist a second model, a second template language and a second money path.
6. **Don't touch the evaluator.** Never edit, skip or loosen a check to make it pass. That includes `faqir audit` rules, `audit.forbid_directives`, the money vectors and the print assertions. If a check looks wrong, record it in `PROGRESS.md` and move on.

Suggested order (milestones; each one commits and pushes):

1. baseline and progress file
2. spike: one invoice to PDF and PNG, looked at
3. definition model, money, helpers, numbering, expression compilation
4. block partials, renderer, preflight
5. assets, API, share view
6. starters, invoice and letter first, looking at every page
7. MCP tools
8. dashboard: library, documents, document page, form integration, thank-you link
9. designer: canvas, palette, properties, data tab
10. designer: appearance, JSON, preflight, undo, publish
11. summary source, chart, business report, survey summary
12. seed and samples
13. e2e and screenshots
14. docs
15. Finish

## Subagents

Use them when they save real time or context. Otherwise, do the work yourself.

- **Good fits:** independent pieces that can run in parallel, wide searches, fresh eyes. **Poor fits:** small tasks and tightly coupled edits. The renderer and the block partials are yours.
- **Pick the cheapest model that can do the job well.** Sonnet 5.5 for well-defined work; Opus 5.5 for ambiguous design, hard debugging, the critique and the final review.
- **Brief them fully.** A subagent doesn't see this conversation. Give it the goal, the files, its scope, the Faqir rules (attribute protocol, no custom CSS, audit must pass, write upstream entries), the house style when it touches documents, and exactly what to return.
- **No overlapping edits.** Two subagents never edit the same files at the same time.
- **Verify before keeping.** A subagent saying "done" is a claim. Run the checks on its work yourself.
- **Only you commit.** Subagents edit files; they don't touch git.
- Stay within the subagent limit above, counting every agent you start. Good candidates:
  - the money and numbering test vectors, written from this spec before the implementation (Sonnet, early);
  - the MCP tools, OpenAPI and `llms.txt` (Sonnet, after the API is stable);
  - the Playwright additions (Sonnet, near the end);
  - **an art-director critique** (Opus, twice: after the first two starters, and before Finish). It sees only the page PNGs and `docs/report-style.md`, never the code, and returns a ranked list of what makes each page look less than expensive;
  - the final review (Opus).

## Visual check

For anything a person will look at, open it and look at it before calling it done. Documents are looked at **as pages**:

- Look at the PDF's own pages (the page PNGs, and the PDF itself in a browser viewer), never only the HTML. A screen layout tells you nothing about where page 2 starts.
- Look at each page at full size, and at zoomed crops (about 300 %) of the letterhead, the table edges, the totals, the stamp and the footer. Check alignment to the grid, figure alignment, hairline weight and the letter-spacing of capitals, and that nothing touches a margin.
- Look at each page in greyscale once.
- Compare the share view printed by Chromium with the server PDF: same page count, same breaks.
- For the surfaces (designer, library, documents, share view, thank-you state), try the main interaction, check the console, and check phone width.
- Fix what looks wrong, then look again; that loop is one of the checks. Save the files listed under Acceptance.
- Leave my other tabs and logged-in accounts alone.
- If Chrome isn't connected, use the built-in browser pane and say so in `PROGRESS.md`; never claim something looks right without seeing it.

## Git

Commits and pushes to the work branch are pre-approved. You don't need to ask.

- **Branch.** `git switch main`, `git pull --ff-only`, then `git switch -c feat/phase-2-reports`. All work happens there; nothing lands on `main` directly.
- **Remote.** `origin` exists (GitHub). Push the work branch after every commit (`git push -u origin feat/phase-2-reports` the first time).
- **Commit at each milestone**, meaning a step that passes its checks and leaves nothing worse than the baseline. Stage only the files you changed. Never commit secrets, `.env`, `data/`, `test-results/`, `PROGRESS.md` or `PROGRESS-PHASE-1.md`. Do commit `docs/samples/`: it is the deliverable a reviewer opens. Keep messages short: what changed and why.
- **PR.** At **Finish**, open one draft PR from `feat/phase-2-reports` into `main` with `gh pr create --draft`, with the Finish report as its body. Never merge it, and never mark it ready.
- **Never** force-push, rewrite history, push to `main`, or touch any other branch or repository.

## When I'm away (`Unattended: yes`)

- Don't wait for me. Where you'd normally ask, pick the safest reasonable option, record it under Decisions, and keep going.
- Anything on the ask-first list below: don't do it. Leave it as a next step for me.
- If one part is blocked, record why and move to another part. When nothing useful is left or the limit is reached, run Finish and stop. Don't spin.
- Keep `PROGRESS.md` current after every milestone. On a long run your context may get compacted, and this file is how you stay on track.
- If a Faqir limitation blocks a feature outright, ship the feature in its reduced form, write the upstream entry, and say so under Decisions. Do not fork Faqir to get around it.
- If the limit approaches, cut from the end of the suggested order, never from the house style: fewer stunning starters beat more adequate ones.

## Guardrails

- Stay inside scope. `C:\newme\faqir-ui` is read-only; its git state must be untouched at the end (`git -C C:\newme\faqir-ui status --porcelain` prints nothing).
- Ask before anything else irreversible or outward-facing: deploy, publish to npm, change the repository's settings, delete data, send messages or email, spend money. The draft PR above is the one exception.
- Commit before a risky edit so it can be undone.
- Before retrying an external write (a push, the PR), check whether the first attempt already landed.
- Secrets: as in phase 1. Seed data uses invented companies, people, addresses, VAT numbers and IBANs (valid checksums, no real accounts); no real person's or company's details.
- The renderer is a browser running data someone else wrote. Keep the network allow-list, the timeouts, the page limit and the concurrency cap on in every environment, tests included.

## Progress file

Keep `PROGRESS.md` (out of git via `.git/info/exclude`). Short:

- **Done:** finished milestones and their check results
- **Decisions:** choices that shape the result, and why
- **Tried and failed:** what didn't work, and why
- **Faqir:** count of upstream entries so far, and the last one's number
- **Git:** branch, last commit, pushed or not
- **Next:** one concrete step to resume from

## Finish

1. Reread the full diff once with fresh eyes (a review subagent on Opus works well here). Look for bugs, leftover debug code, a second model of the definition, float arithmetic near money, network access from the renderer, custom CSS that a token could replace, and complexity you can remove.
2. Run the art-director critique on the final samples, fix what it ranks highest, and regenerate the samples.
3. Rerun all checks on the final version, including `test:e2e`, `test:print`, `npm run samples` and the visual check.
4. Rewrite `docs/faqir-digest.md`, and make sure `FAQIR-UPSTREAM.md` is complete and in format.
5. Commit, push, and open the draft PR.
6. Report briefly:
   - branch, last commit and the PR link
   - what changed, with file paths, and the exact curl sequence an agent uses to issue an invoice
   - each check: pass or fail, with the real output for failures
   - what you looked at (which pages, at what zoom, in greyscale) and where the samples are
   - if you used subagents: how many, which model, and for what
   - the top five Faqir upstream entries, one line each
   - decisions made without me, and anything unresolved

If the limit or a blocker stops you, say exactly what's left. Never report a result you didn't observe.
