# Reports and documents

A **report** is one JSON definition — the data's schema, a sample, a layout of blocks and a
few curated appearance choices — that prints as an A4 or US Letter PDF. A **document** is
one issue of a report with its data: numbered at issue, immutable from then on, with an
HTML view, a PDF and a private share link. Agents create, preview and issue them through
the API or the MCP server; people do the same in the report designer.

| Forms (phase 1) | Reports |
|---|---|
| A definition, versioned, published | A definition, versioned, published |
| A submission: data that came in | A document: data that goes out, numbered, voided but never edited |

The definition is the only representation. The designer edits it, the API stores it, and
the renderer — the only code that knows markup — turns it into a `document` pattern page
in a Faqir print theme, then Chromium prints that page to PDF.

## The definition

```jsonc
{
  "schema":     { "type": "object", "title": "Invoice", "properties": { … } },
  "sample":     { … },
  "layout":     [ { "id": "title", "block": "title", "text": "{{ label(\"invoice\") }}" }, … ],
  "appearance": { "theme": "document", "accent": "#1f3a8a", "paper": "a4", "orientation": "portrait",
                  "margins": "normal", "type": "plex-sans", "density": "comfortable",
                  "locale": "en-GB", "currency": "EUR", "logo": "asset:ast_…",
                  "letter": { "window": false, "foldMarks": false } },
  "money":      { "lines": "items", "quantity": "qty", "unitPrice": "price", "taxRate": "vat",
                  "discount": "discount", "prices": "net", "rounding": "line", "paid": "paid" },
  "numbering":  { "pattern": "INV-{YYYY}-{seq:4}" },
  "documentTitle": "{{ customer.name }} · {{ money(doc.money.total) }}",
  "runningHeader": "{{ label(\"invoice\") }} {{ doc.number ?? label(\"draft\") }} · {{ customer.name }}",
  "labels":     { "invoice": "Tax invoice" },
  "source":     { "kind": "data" }
}
```

- **`schema`** — the data's shape: JSON Schema (phase 1's subset, plus arrays of objects).
  Its root `title` and `description` are the report's name and description. `doc` is
  reserved and may not be declared.
- **`sample`** — example data, valid against the schema. Previews, the designer canvas, the
  shelf thumbnails and the starters render it.
- **`layout`** — the blocks, in order (below). Every block has a stable `id`, a `block`
  name, and optionally `when` (a bare expression: the block renders when it is truthy) and
  `keep` (`together` or `with-next`).
- **`appearance`** — curated choices only: a print theme, one accent hex, paper,
  orientation, margins, a type pairing, density, locale, currency, a logo asset and the
  window-letter options. There is no setting for a size, a colour or a position; anything
  else is a 422 that says so. See [report style](/docs/report-style).
- **`money`** — for invoices, quotes and receipts: which array holds the lines and which
  keys hold the quantity, unit price, tax rate and discount.
- **`numbering`** — `{ "pattern": … }` or `{ "manual": true }`.
- **`documentTitle`** — a document's name in lists; **`runningHeader`** — the header text
  from page 2 on. Both are template text.
- **`labels`** — overrides of the built-in words (see `GET /api/v1/vocabulary/reports`).
- **`source`** — `{ "kind": "data" }`, `{ "kind": "submission", "form": "frm_…" }` or
  `{ "kind": "summary", "form": "frm_…" }`.

Every fault is a 422 problem whose `errors[]` name the JSON pointer — and, inside an
expression, the `line`, `column` and `code`:

```jsonc
{ "pointer": "/layout/1/text", "code": "bad-hole", "line": 1, "column": 4,
  "detail": "bad-hole at line 1, column 4: {{ without a closing }} — in \"Hi {{ customer.name\"" }
```

## Expressions

Expressions are `@faqir-ui/template` expressions, evaluated by the
engine itself — never `eval`.

- A prop that **renders** is template text with holes: `"Due {{ date(due) }}"`.
- A prop that **decides or selects** (`when`, `rows`, a chart series' `value`) is a bare
  expression: `"items"`, `"doc.money.due != \"0.00\""`.
- Paths read the data; `doc` holds the system values. Inside a `table` row: `row` (the item),
  `i` (its index) and `line` (the computed money line, when the rows are the money lines).
- **Missing is an error.** A path the data lacks is a `missing-data` finding in preview and
  a 422 at issue. Say a value is optional with `??`: `{{ customer.vat ?? "—" }}`.
- No assignment, no functions, no globals; `+ - * / %`, comparisons, `&& || !`, `? :`, `??`.

### Helpers

| Helper | Does |
|---|---|
| `money(amount, currency?)` | An amount in the document's locale, with the currency's digits (more for a unit price that has them). Exact. |
| `number(value, digits?)` | A number in the locale. |
| `percent(value, digits?)` | 19 → 19 % (spacing per locale). |
| `date(iso, style?)` / `datetime(iso)` | Dates in the locale, UTC; `long` (default), `medium`, `short`. |
| `label(key)` | A built-in word in the document's language (`invoice`, `subtotal`, `vat`, `total`, `amountDue`, `dueDate`, `page`, …). |
| `iban(value)` | Grouped by four, upper case. |
| `sum(array, key)`, `count(array, key?)`, `avg(array, key)` | Over an array of objects; `sum` is exact. |
| `round(value, digits?)` | Half away from zero. |
| `join(array, separator?, key?)`, `upper(text)` | Text helpers. |
| `epc(name, iban, amount, reference, bic?)` | A SEPA credit-transfer QR payload (EPC069-12) for a `qr` block. EUR documents only. |

### System values

`doc.number` (null on a draft), `doc.status`, `doc.issuedAt`, `doc.locale`, `doc.currency`,
`doc.money` (`lines`, `subtotal`, `discount`, `taxes[{rate, base, tax}]`, `tax`, `total`,
`paid`, `due`), `doc.labels`, and `doc.submission` (`id`, `created_at`, `form`, `groups`)
when the source is a submission.

## Money

`money` turns the lines into integer minor units (BigInt) at the currency's ISO 4217
digits. A line's amount is `quantity × unitPrice`, less its discount percentage, rounded
half away from zero; with `rounding: "line"` each line's tax is rounded and summed, with
`"total"` tax is rounded once per rate. `prices: "gross"` takes tax out of the unit price
instead of adding it. The result — `doc.money` — is decimal strings with exactly the
currency's digits, so the printed lines, the tax breakdown and the total always agree to
the cent: subtotal is the sum of the line nets, tax the sum of the rates, total =
subtotal + tax, due = total − paid. No float touches an amount.

## Numbering

A number is assigned only at issue, inside the same SQLite transaction that marks the
document issued — a failed issue never consumes one, and two concurrent issues never get
the same. Drafts have no number and print `DRAFT` across every page; a voided document
keeps its number and prints `VOID`. Tokens: `{YYYY}` and `{YY}` (the sequence restarts
each year), `{MM}`, `{seq}` and `{seq:N}` (padded to N digits). `{ "manual": true }` takes
`number` from the issue request and refuses a number the report already used (409).

## Sources

- **`data`** — the caller sends the data with each document.
- **`submission`** — the data is a form submission's answers, plus `doc.submission`, so a
  form can issue its own confirmation. The report's schema is the form's (the
  confirmation starter copies it when it is created); a later change to the form reaches
  the report when you rebind it in the designer (Data → Bind to a form) and publish.
- **`summary`** — forecraft computes the data from a form's submissions over a period
  given at issue (`"period": { "since": "2026-09-01", "until": "2026-09-30" }`), in one fixed
  shape: `form`, `period`, `responses {total, first, last}`, `nps {score, promoters,
  passives, detractors, answered, question, groups}` (or null), `questions[]` (each with
  `kind`, `answered`, `skipped`, and `options[{label, count, share}]`, `top`, `mean`,
  `samples`), `verbatims[]` and `overTime[]`. `GET /api/v1/vocabulary/reports` returns it as
  JSON Schema (`summary_shape`).

## Lifecycle

Preview works on the working copy (or a definition in the body); documents are issued
only from a published version, and a document records that version and always re-renders
from it. An issued document's PDF is printed once — at issue, or on first download when it
was issued by a public submission — stored with its SHA-256, and every download serves
those bytes. Issued documents never change: `PATCH` is a 409; void one with a reason and
issue another.

## Preflight

Every preview and every issue is preflighted: layout checks run in Chromium under print
media at the page's width, pagination checks read the PDF itself. Each finding is
`{ severity, code, message, block, page? }`. Errors block issue; warnings are listed.

| Code | Severity | Checks |
|---|---|---|
| `missing-data` | error | A path the data does not have, with its block |
| `missing-asset` | error | A logo or image whose asset id is not in this workspace |
| `expression-error` | error | An expression that cannot be evaluated with this data |
| `overflow` | error | Anything wider than the content box, including unbreakable strings |
| `cell-overflow` | error | A table cell wider than its column |
| `too-many-columns` | error | More than 7 columns portrait, 10 landscape |
| `window-overlap` | error | Anything but the address inside a window letter's window |
| `qr-capacity` | error | A QR payload the qr-code recipe cannot encode |
| `barcode-value` | error | A barcode value outside Code 128-B |
| `font-fallback` | error | Any glyph in a family the report did not declare (from the PDF's font list) |
| `page-limit` | error | More than 40 pages |
| `orphan-heading` | warning | A heading that is the last thing on a page |
| `split-totals` | warning | Totals on a later page than the rows they total |
| `blank-page` | warning | A page with nothing but its header and footer |
| `image-resolution` | warning | An image under 200 dpi at its printed size |

## The API

All under `/api/v1`, with an API key or a session. Problems are RFC 9457.

| Route | Does |
|---|---|
| `GET /vocabulary/reports` | Blocks (with examples), helpers, themes, pairings, locales, papers, preflight codes, the summary shape |
| `GET /report-starters` | The starters |
| `GET, POST /reports` | List; create from `{ starter, title?, appearance?, sample?, form? }` or a definition |
| `GET, PATCH, DELETE /reports/:id` | The working copy; DELETE is refused (409 `has-documents`) once a document was issued |
| `POST /reports/:id/publish`, `GET /reports/:id/versions[/:v]` | Versions |
| `POST /reports/:id/preview` | `{ definition?, data?, submission?, period?, format: png \| pdf \| html, pages?, dpi? }` → preflight and page images |
| `POST /reports/:id/documents` | `{ data \| submission \| period, issue?, number?, locale?, currency? }` |
| `GET /documents`, `GET, PATCH, DELETE /documents/:id` | Filter by `report`, `status`, exact `number`, `q`, `since`, `until`; drafts only change |
| `GET /documents/:id/pdf` | The PDF, named after its number |
| `POST /documents/:id/issue`, `/void`, `/share/rotate` | Issue a draft, void with a `reason`, revoke the share link |
| `GET /submissions/:id/pdf` | Any submission, printed through the built-in submission record |
| `POST /assets`, `GET /assets[/:id]` | Logos and figures (PNG, JPEG, WebP, SVG), sniffed by their bytes |

Public: `/d/:token` (the share view: the sheet on a desk, with Download, Print and Copy
link), `/d/:token.pdf`, `/assets/:id`. Renders draw from their own rate-limit bucket; a full
renderer queue is a 503 with `Retry-After`.

## Blocks

Every block takes `id`, `block`, `when` and `keep` besides the props below. Template text
props take `{{ }}` holes; expressions are bare.

### Structure

#### `letterhead`

Sender identity on the first page: logo, name, address lines and registration details.

| Prop | Kind |
|---|---|
| `name` (required) | template text |
| `logo` | asset:ast_… |
| `lines` | list of template text |
| `details` | list of { label, value, mono? } |

```jsonc
{
  "id": "letterhead",
  "block": "letterhead",
  "name": "{{ seller.name }}",
  "logo": "asset:ast_…",
  "lines": [
    "{{ seller.street }}",
    "{{ seller.city }}"
  ],
  "details": [
    {
      "label": "VAT",
      "value": "{{ seller.vat }}"
    }
  ]
}
```

#### `title`

The document's type, number and key dates.

| Prop | Kind |
|---|---|
| `eyebrow` | template text |
| `text` (required) | template text |
| `details` | list of { label, value, mono? } |

```jsonc
{
  "id": "title",
  "block": "title",
  "text": "{{ label(\"invoice\") }}",
  "details": [
    {
      "label": "{{ label(\"number\") }}",
      "value": "{{ doc.number ?? label(\"draft\") }}"
    },
    {
      "label": "{{ label(\"issueDate\") }}",
      "value": "{{ date(doc.issuedAt) }}"
    }
  ]
}
```

#### `section`

A heading and the blocks it groups; numbered 1. / 1.1 when `numbered` is true.

| Prop | Kind |
|---|---|
| `title` (required) | template text |
| `numbered` | true/false |
| `blocks` | blocks |

```jsonc
{
  "id": "summary",
  "block": "section",
  "title": "Executive summary",
  "numbered": true,
  "blocks": []
}
```

#### `columns`

Two or three columns of child blocks.

| Prop | Kind |
|---|---|
| `columns` (required) | 2–3 lists of blocks |

```jsonc
{
  "id": "cols",
  "block": "columns",
  "columns": [
    [],
    []
  ]
}
```

#### `separator`

A hairline rule.

```jsonc
{
  "id": "rule",
  "block": "separator"
}
```

#### `page-break`

Start a new page.

```jsonc
{
  "id": "break",
  "block": "page-break"
}
```

#### `footer`

The running footer: legal lines, registration, bank details. The page counter is added for you.

| Prop | Kind |
|---|---|
| `lines` (required) | list of template text |

```jsonc
{
  "id": "footer",
  "block": "footer",
  "lines": [
    "{{ seller.name }} · {{ seller.registration }}",
    "{{ seller.bank }} · IBAN {{ iban(seller.iban) }}"
  ]
}
```

### Data

#### `parties`

From, bill to, ship to. With appearance.letter.window the first party sits in the envelope window.

| Prop | Kind |
|---|---|
| `parties` (required) | list of { label?, name, lines?, details? } |

```jsonc
{
  "id": "parties",
  "block": "parties",
  "parties": [
    {
      "label": "{{ label(\"billTo\") }}",
      "name": "{{ customer.name }}",
      "lines": [
        "{{ customer.street }}",
        "{{ customer.city }}"
      ]
    }
  ]
}
```

#### `facts`

References, dates, terms and PO numbers as a grid of labelled values.

| Prop | Kind |
|---|---|
| `items` (required) | list of { label, value, mono? } |
| `cols` | `1` · `2` · `3` · `4` |

```jsonc
{
  "id": "facts",
  "block": "facts",
  "items": [
    {
      "label": "{{ label(\"dueDate\") }}",
      "value": "{{ date(due) }}"
    },
    {
      "label": "PO",
      "value": "{{ po ?? \"—\" }}"
    }
  ]
}
```

#### `table`

Rows bound to an array, with formatted columns. In a row: `row`, `i`, and `line` (the computed money line) when the rows are the money lines.

| Prop | Kind |
|---|---|
| `rows` (required) | expression |
| `columns` (required) | list of { label, value, note?, format?, align?, width? } |
| `footer` | list of { label, value, mono? } |
| `empty` | template text |
| `caption` | template text |

```jsonc
{
  "id": "items",
  "block": "table",
  "rows": "items",
  "columns": [
    {
      "label": "{{ label(\"description\") }}",
      "value": "{{ row.description }}",
      "width": "wide"
    },
    {
      "label": "{{ label(\"quantity\") }}",
      "value": "{{ number(row.qty) }}",
      "format": "number"
    },
    {
      "label": "{{ label(\"amount\") }}",
      "value": "{{ money(line.net) }}",
      "format": "currency"
    }
  ]
}
```

#### `totals`

Subtotal, discount, tax per rate, total, paid and due — from doc.money when `items` is not given.

| Prop | Kind |
|---|---|
| `items` | list of { label, value, emphasis? } |
| `due` | true/false |

```jsonc
{
  "id": "totals",
  "block": "totals"
}
```

#### `answers`

Every answer of the bound submission, in form order, with zero configuration; omit lists field names another block already prints.

| Prop | Kind |
|---|---|
| `title` | template text |
| `omit` | list of template text |

```jsonc
{
  "id": "answers",
  "block": "answers",
  "omit": [
    "email"
  ]
}
```

### Content

#### `text`

Markdown prose: paragraphs, lists, emphasis, links. Holes are kept; data is always escaped text.

| Prop | Kind |
|---|---|
| `markdown` (required) | markdown |
| `size` | `body` · `small` · `fine` |

```jsonc
{
  "id": "terms",
  "block": "text",
  "markdown": "Payment within **14 days** of {{ date(doc.issuedAt) }}. Questions: [billing@example.com](mailto:billing@example.com)."
}
```

#### `callout`

Payment instructions, notes and conditions, set apart.

| Prop | Kind |
|---|---|
| `title` | template text |
| `markdown` (required) | markdown |
| `tone` | `muted` · `info` · `warning` · `success` |

```jsonc
{
  "id": "pay",
  "block": "callout",
  "title": "How to pay",
  "markdown": "Transfer {{ money(doc.money.due) }} to {{ iban(seller.iban) }}, reference {{ doc.number ?? \"—\" }}."
}
```

#### `stats`

KPI figures: a label, a value and an optional change.

| Prop | Kind |
|---|---|
| `items` (required) | list of { label, value, change?, trend? } |

```jsonc
{
  "id": "kpis",
  "block": "stats",
  "items": [
    {
      "label": "Revenue",
      "value": "{{ money(revenue) }}",
      "change": "+18% y/y",
      "trend": "up"
    }
  ]
}
```

#### `bars`

Shares and distributions as labelled bars with their figures.

| Prop | Kind |
|---|---|
| `rows` (required) | expression |
| `label` (required) | template text |
| `value` (required) | expression |
| `display` | template text |
| `max` | expression |
| `title` | template text |

```jsonc
{
  "id": "shares",
  "block": "bars",
  "rows": "channels",
  "label": "{{ row.name }}",
  "value": "row.share",
  "display": "{{ percent(row.share) }}"
}
```

#### `chart`

Bar, column or line chart drawn as inline SVG from Faqir tokens, with the numbers also as a table.

| Prop | Kind |
|---|---|
| `kind` (required) | `bar` · `column` · `line` |
| `rows` (required) | expression |
| `label` (required) | template text |
| `series` (required) | list of { name, value } |
| `format` | `number` · `currency` · `percent` |
| `title` | template text |
| `caption` | template text |

```jsonc
{
  "id": "revenue",
  "block": "chart",
  "kind": "column",
  "rows": "quarters",
  "label": "{{ row.name }}",
  "series": [
    {
      "name": "Revenue",
      "value": "row.revenue"
    }
  ],
  "format": "currency",
  "title": "Revenue by quarter"
}
```

#### `quote`

A verbatim or testimonial with its attribution; with `rows`, one per row (`row` in scope).

| Prop | Kind |
|---|---|
| `text` (required) | template text |
| `name` | template text |
| `role` | template text |
| `rows` | expression |

```jsonc
{
  "id": "voice",
  "block": "quote",
  "text": "{{ comment.text }}",
  "name": "{{ comment.who ?? \"\" }}"
}
```

#### `image`

A figure from an uploaded asset, with a caption.

| Prop | Kind |
|---|---|
| `src` (required) | asset:ast_… |
| `alt` (required) | template text |
| `caption` | template text |
| `size` | `sm` · `md` · `lg` · `full` |

```jsonc
{
  "id": "figure",
  "block": "image",
  "src": "asset:ast_…",
  "alt": "Site plan",
  "caption": "Figure 1. Site plan"
}
```

### Office

#### `signature`

Signing lines with name, role and date, kept with their labels.

| Prop | Kind |
|---|---|
| `signatures` (required) | list of { name, role?, date? } |

```jsonc
{
  "id": "sign",
  "block": "signature",
  "signatures": [
    {
      "name": "{{ seller.signatory }}",
      "role": "Director"
    },
    {
      "name": "{{ customer.contact }}",
      "role": "{{ customer.name }}"
    }
  ]
}
```

#### `qr`

A QR code (payment, check-in, verification).

| Prop | Kind |
|---|---|
| `value` (required) | template text |
| `caption` | template text |
| `size` | `sm` · `md` · `lg` |

```jsonc
{
  "id": "pay-qr",
  "block": "qr",
  "value": "{{ epc(seller.name, seller.iban, doc.money.due, doc.number ?? \"DRAFT\") }}",
  "caption": "{{ label(\"scanToPay\") }}"
}
```

#### `barcode`

A Code 128 barcode of printable ASCII.

| Prop | Kind |
|---|---|
| `value` (required) | template text |
| `caption` | template text |
| `size` | `sm` · `md` · `lg` |

```jsonc
{
  "id": "ticket",
  "block": "barcode",
  "value": "{{ doc.number ?? \"DRAFT\" }}"
}
```

#### `stamp`

PAID, COPY or another mark, in Faqir's stamp, turned a few degrees.

| Prop | Kind |
|---|---|
| `text` (required) | template text |
| `tone` | `default` · `primary` · `destructive` · `success` |

```jsonc
{
  "id": "paid",
  "block": "stamp",
  "text": "{{ label(\"paidStamp\") }}",
  "tone": "success",
  "when": "doc.money.due == \"0.00\""
}
```

#### `watermark`

Diagonal text across every page (DRAFT and VOID are added for you).

| Prop | Kind |
|---|---|
| `text` (required) | template text |

```jsonc
{
  "id": "copy",
  "block": "watermark",
  "text": "{{ label(\"copy\") }}"
}
```

### Advanced

#### `faqir`

A fragment of Faqir template source for what the vocabulary lacks. No raw, no style, no class; manifests are checked.

| Prop | Kind |
|---|---|
| `source` (required) | Faqir template source |

```jsonc
{
  "id": "custom",
  "block": "faqir",
  "source": "+callout(variant=\"muted\")\n  @content\n    p {{ note }}"
}
```

