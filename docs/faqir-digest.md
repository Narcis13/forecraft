# Faqir digest — what forecraft would fix first

The ten entries of [`FAQIR-UPSTREAM.md`](../FAQIR-UPSTREAM.md) most worth fixing in the
next Faqir release, across both phases (forms, then reports and documents), ordered by
how much they hurt forecraft × how general they are. Phase 1's digest is in git history.

1. **#38 — The print themes name system fonts.**
   Arial, Georgia and Times New Roman print differently on Windows and Linux, and the `report` variant forces Georgia; every document page has to re-point `--doc-font`.
   Fix: print themes default to the project's role families; system faces only as fallbacks.
2. **#28 — Auto-start can boot between deferred scripts and silently drop `l-rules`.**
   Rules were not applied in most page loads, with no warning — the worst kind of bug for a form tool.
   Fix: no `setTimeout` boot for classic scripts; warn when a directive arrives after boot.
3. **#32 / #9 — No per-document paper or runtime accent.**
   `@page` cannot be scoped, so two documents (A4 and Letter) cannot share a stylesheet, and a brand accent needs the CLI — on screen and now on paper.
   Fix: named pages per format/orientation, and a `--doc-accent` the print themes read.
4. **#39 / #47 — Chromium's running header and footer are a fixed fallback.**
   The header prints on page 1 under the letterhead, and the footer can never share a line with the page counter; a mask hides the header but leaves its text in the PDF.
   Fix: margin-box strings for Chromium, with `:first` suppression and a shared footer rule.
5. **#33 — The page counter is an English literal.**
   "Page 1 / 2" in a Romanian invoice; no token or attribute changes the words.
   Fix: a localisable counter (named pages per language or `attr()` where supported).
6. **#35 — Installing a font always takes a role from the app.**
   A document face replaces the app's body or heading type; forecraft runs a second Faqir project just to own its print fonts.
   Fix: `faqir fonts add <family> --role none`, or a `document` role.
7. **#29 — The date-picker's named input holds display text.**
   `FormData` sends "October 15, 2026", which the schema's own `format: date` rejects.
   Fix: an unnamed visible input and the ISO value in a hidden named input.
8. **#1 — The rules a form carries are only available inside its HTML.**
   Every server that re-validates must render the form and regex the definition back out.
   Fix: export `rulesFor(schema, ui, opts)`, or return `{ html, rules }`.
9. **#42 / #41 — Print behaviour of `table` and `key-value`.**
   A `tfoot` repeats on every printed page (an invoice total on page 1 of 3), and grouped key-value pairs misplace in the grid variants.
   Fix: `data-print-footer="last"`; grouping divs as `display: contents` (or subgrid).
10. **#36 / #44 — No chart primitive; a QR encoder capped at version 10.**
    Reports need bar, column and line charts with token colours and greyscale-safe series; a failed QR encode leaves an empty element with only a console warning.
    Fix: a `chart` primitive with exactly the semantics in #36; QR versions to 40, an error state, a 4-module quiet zone.

Close behind: #43 (`@page` rules global once bundled), #40 (nothing paints in page
margins: fold marks need a zero margin), #48 (three print themes differ only in hue),
#37 (no italics in the catalogue), #3 / #4 (two submit shapes, wizard answers missing
from `FormData`), #14 (`checkbox-group` unknown to the audit), #45 (progress width as a
style attribute), #50 (faqir-core needs `unsafe-eval`, so no strict CSP), #49 (a quote in a
document: mark above, attribution larger than the text), #51 (codes keep their quiet zone
inside the box).

## What worked unusually well (both phases)

- **`@faqir-ui/template`** carried the whole report renderer: one expression language
  for agents' bindings, compile-time diagnostics with line and column that became 422
  pointers, `??` for optional data, manifest-checked component calls, escaping by context
  (a `javascript:` link in data is refused), and the `l-data` island for the one value the
  server could not write (a progress width).
- **The `document` pattern and doc tokens** gave a print-ready sheet in one element: the
  `doc-*` tokens retuned the whole page from one stylesheet, the table's print rules
  repeated headers and kept rows whole, and `box-decoration-break: clone` handled every
  page's padding.
- **`qr-code`, `barcode`, `signature`, `stamp`, `watermark`** printed as real vector
  marks with no extra code; the EPC payment QR and the Code 128 ticket both scan.
- **`faqir audit --stdin --json`** checked 71 pages, including the share view of every
  document, with no exceptions needed.
- **`@faqir-ui/rules`** validated report data with the same JSON Schema subset and the
  same pointer-carrying findings as phase 1's forms.
