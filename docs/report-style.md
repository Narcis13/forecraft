# Report house style

forecraft's documents should read like paper from a good law firm or accountant: calm,
exact, legible and expensive-looking. The renderer already does most of this for you —
sizes, rules, margins, figures, pagination. This page says what is still yours to
choose, what to choose, and why.

## What the renderer decides (and you do not)

- **Paper and margins.** A4 by default, US Letter when you ask; real print margins
  (`narrow`, `normal`, `wide`). Window letters get DIN 5008 Form B geometry and fold marks.
- **Type sizes.** Body about 10 pt, tables 8.75 pt, fine print 7.5 pt, titles 21 pt,
  labels in small letter-spaced capitals, tabular lining figures in every number.
- **Rules and rhythm.** Hairlines (0.5 pt) in neutral grey, a stronger rule under table
  headers and above the total. Space separates; nothing is boxed.
- **Pagination.** A running footer with the page counter in the document's language on
  every page; a running header from page 2; table headers repeat; rows never split; a
  heading never ends a page; totals stay with the last rows; no blank trailing page.
- **Ink.** Black on white. Every page survives a monochrome laser printer.

There is no setting for any of this, on purpose. If a page looks wrong, preflight says so.

## What you choose

| Choice | Choose | Why |
|---|---|---|
| **Starter** | The nearest one (`invoice`, `letter`, `business-report`, `confirmation`, `survey-summary`) | Each is a finished document; editing one keeps its grid and rhythm |
| **Print theme** | `document` for invoices and statements, `document-serif` for letters, `editorial-document` for reports, `ink-document` for confirmations, `swiss-document` for data | The theme is the paper's voice; keep one per kind of document across a business |
| **Type pairing** | `plex-sans` (invoices), `source-serif` (letters), `editorial` (reports), `inter` (dense numbers) | At most two families plus a mono, all self-hosted, so the PDF is the same on every machine |
| **Accent** | One dark, saturated ink: navy `#1f3a8a`, oxblood `#5b2333`, forest `#14532d`, petrol `#0f4c5c` | It marks three things only — the letterhead rule, eyebrows, the amount due. It must contrast 4.5:1 on white or the API refuses it |
| **Density** | `comfortable`, unless a long table must fit | `compact` is for 40-line invoices, not for letters |
| **Locale and currency** | The customer's, per document if you bill abroad | Dates, decimals, the currency sign and every built-in word follow it |

## How to write the content

- **Bind data, do not paste it.** `{{ customer.name }}`, not "Atlas Retail". Mark optional
  values: `{{ customer.vat ?? "—" }}`. A missing path is an error at issue, by design.
- **Use the built-in words.** `{{ label("invoice") }}`, `label("dueDate")`, `label("amountDue")`:
  they are correct in en, ro, de and fr, and a report can override any of them.
- **Let money compute.** Point `money` at the lines; print `line.net`, the totals block and
  `doc.money.due`. Never compute an amount in an expression.
- **Mono for codes.** IBANs, references and order numbers in pairs set `"mono": true`;
  print IBANs with `iban()`, grouped by four.
- **Short labels.** "Due date", not "Payment due date for this invoice".
- **Text blocks are prose.** Two short paragraphs beat a wall of bold. Markdown links stay
  clickable in the PDF.

## The five most common ways to make a document look cheap

1. **A colourful accent.** Bright blue, orange or green reads as a web app. Use a dark ink,
   and let black do the work.
2. **Everything in a box.** Callouts, tables and totals inside borders and tints. The
   house style separates with space and hairlines; do not ask for more.
3. **Too many columns.** Nine columns on portrait A4 means 6 pt text or wrapped figures.
   Seven is the limit; move details into a column's `note`, or go landscape.
4. **Placeholder content left in.** "Lorem ipsum", "Your company", `—` everywhere, a QR
   that encodes "DRAFT" on an issued document. Preview with your real data and read it.
5. **Low-resolution logos.** A 72-dpi PNG prints soft beside crisp vector type. Upload an
   SVG, or a PNG of at least 600 px across; preflight warns under 200 dpi.

## Before you issue

Preview (`POST /reports/:id/preview`, or `forecraft_preview_report`), read every finding,
and look at the pages it returns. Fix every error — issue is refused while one stands —
and every warning you would be embarrassed to send.
