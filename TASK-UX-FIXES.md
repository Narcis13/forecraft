# Task — forecraft: fix what a human hits in the browser

Source: a hands-on browser pass on 2026-10-21 (headless Chrome driven like a person, `main` at `a0e4764`).
The journey: sign up → build a 12-field, 3-step wizard form ("Workshop orders": text, email, dropdown, date,
number, radio, checkboxes, repeatable rows, scale, switch, long text, two rules, theme) → publish → submit
8 orders through the public page → read them in the dashboard → build a Survey-summary report on them
→ publish → issue a PDF. Screenshots are in `docs/ux-audit/` (referenced as `[shot NN]`).

Severity: **P0** = wrong data, privacy, or the user is stuck · **P1** = the workflow fights the user ·
**P2** = polish. Each item has a repro, where to look, and what "fixed" means. Add an e2e test per P0/P1.

---

## P0 — broken, wrong or leaking

### 1. Survey summary prints respondents' emails and company names as "In their words" quotes
- Repro: any form with an email/short-text field ≥ 12 chars → Survey summary → issue. Page 2 quotes
  `"elena@example.test"`, `"Popescu Digital SRL"` as testimonials, on a **public share link** `[shot 14]`.
- Where: `src/reports/summary.ts` (~L100–106): every `type: "string"` field (not enum/date) feeds `samples`, and
  L113 flattens all samples into `verbatims`.
- Fix: only free-text fields produce samples (`ui.widget === "textarea"`, i.e. Long text). Never `format: email|uri`,
  never short text. Consider an explicit opt-in (`ui.verbatim: true`) and a designer toggle.

### 2. Survey summary computes wrong numbers
- `mean` on nominal choices: Workshop gets mean **1.9**, Payment **2** (average of enum positions) — `summary.ts` L86.
  Only scale/ordinal fields (`ui.widget === "scale"`) should get `mean/median`.
- Booleans: Newsletter prints **"Yes 4 · No 0 · 100 %"**; 4 people left it off. An untouched switch is *absent* in the
  submission (L68 filters it out as "skipped"), so "No" is always 0. Fix at the source (form submits `false` for
  an untouched switch/checkbox) **and** in the summary (absent boolean ⇒ No).
- Repeatable rows (`array` of objects) are silently dropped: 12 fields, "Questions 11". Add `kind: "rows"` with
  row count and `sum/avg` per numeric column (qty, amount).
- Ties: Card 3 / Invoice 3 → "most chosen: Card". Mark ties (`top` as list, or "Card, Invoice (tie)").
- Date fields: `kind: "date"` has no stats; give `min/max` (earliest/latest date).
- Scale answers are stored as strings `"1"…"5"` (`form` definition uses a string enum) — fine for display, but
  then document it, or store numbers.

### 3. "Add a section" breaks saving and shows a raw API error
- Repro: designer → Sections → **Add a section**. Banner: *"The API refused this definition /schema:
  uiSchema["ui:groups"][3].fields must be a non-empty string array."*; status "Not saved"; uncaught page error;
  the new section is off-screen so the user doesn't even see what they did `[shot 03]`.
- Where: `public/designer.js` serialisation of `ui:groups` / `ui:wizard.steps` (~L288, L363, L425).
- Fix: allow empty sections in the working copy (drop empty groups when serialising, or let the server accept
  them on drafts and reject only at publish with a human message). Scroll to and focus the new section title.

### 4. A wizard submit error on an earlier step leaves the visitor stuck
- Repro: rule "Require Company name when Payment method is Invoice" (Company is on step 1, Payment on step 2).
  Pick Invoice, finish step 3, submit → 422, a single "**This field is required.**" box under the buttons; no field
  name, no step jump `[shot 07]`. Going back to step 1: Company has `required` in the DOM but **no asterisk and no
  inline error**.
- Where: `public/form.js` (mapping server errors to fields/steps), rule → required-marker rendering.
- Fix: (a) map each server error pointer to its field, jump to the first step that has one, show it inline;
  (b) the error summary names fields ("Company name is required"); (c) rule-required fields show the `*`
  live; (d) ideally validate rule-required fields when leaving the step that *triggers* them.

### 5. Rules that target a repeatable group leave an empty shell
- Repro: rule "Show Line items when Extras is filled in". Console: `[Faqir] l-rules: rule "show-lineitems" names an
  absent field "lineItems"`. The group's box, its row card and "Remove row/Add a row" stay visible; only the inner
  inputs are hidden `[shot 05, 08]`.
- Fix: rules on an array field hide/show the whole fieldset (or the Rules tab must not offer array fields as
  targets). Add an e2e test.

### 6. "Issue a document" issues immediately — numbered, permanent, no confirmation, no period
- Repro: Reports → a summary report → **Issue a document**. It goes straight to an *issued* `SUM-2026-001` with a SHA-256
  `[shot 17]`. For a summary, the period is the whole point, yet nothing asks for it.
- Fix: a dialog — period (since/until, presets "last 7/30 days, this month") for summary reports, data/submission
  picker for others, a clear "Issue (numbered, cannot be edited)" vs "Save as draft" choice.

### 7. The report designer designs against fake data, not the bound form
- Repro: Reports → Survey summary, form = Workshop orders. Canvas shows "How was your month with forecraft?", 120
  responses, NPS +31 `[shot 11]`. Preflight validates against that sample, so `questions[5].mean` (Seats) and
  `questions[6].options` (Payment) are reported **missing** although they exist in the real data. The only way out
  was copying the JSON from a test document into Data → Sample by hand.
- Also: Data → "Bind to a form" shows "Choose a form…" although the JSON has `source: { kind: "summary", form }`.
- Fix: when `source.kind === "summary"`, compute the sample from the bound form's submissions (fall back to a
  synthetic sample shaped like *that* form's questions when there are none). Show the bound form in the Data tab.

### 8. No way to make a report that lists submissions
- Sources are `data` (send it yourself), `submission` (one document per submission) and `summary` (aggregates only).
  "Show my form's data" — a register of every order with seats, payment and line-item totals — is impossible from
  the UI.
- Fix: a `submissions` source (rows = submissions in a period, with `sum/avg/count` helpers) and a starter
  "Submissions register" with a table block preset to the form's columns.

### 9. Report endpoints 500 when the PDF browser is missing
- On this machine `playwright-core@1.64.1` wanted `chromium_headless_shell-1248`, not installed → every report
  preview was a bare **500**; Preflight tab spun on "…" forever; the canvas still showed a stale page.
- Fix: catch the launch error in `src/reports/pdf.ts:getBrowser`, return a 503 problem with
  "Run `npx playwright install --only-shell chromium`", show it in the designer; check at server start and log
  once. Add the command to README "Run it" (after `npm install`).

---

## P1 — the workflow fights the user

### Form designer
10. **Repeatable rows has no column editor.** Adding it creates fixed columns `label / qty / amount`, editable only in
    the raw JSON tab. Inspector needs: columns (add/remove/reorder, type, label, required, width), min/max rows,
    add/remove button labels.
11. **Default row template wraps**: widths half + third + third > 1 row → "Amount" drops to its own line `[shot 05]`.
    Use third/third/third or half/quarter/quarter.
12. **Field name (key) never follows the label.** "Short answer" → `shortAnswer`, a second one → `shortAnswer2`,
    choices → `choose`, `pickOne`, `pickAny`. These keys show up in exports and report expressions. Auto-slug the
    name from the label until the user edits the name by hand (lock it after publish, with a warning).
13. **Public URL is frozen as `/f/untitled-form-088f77`** because the slug is taken from the default title at
    creation (`src/forms/store.ts:70`). Re-derive the slug from the title until first publish; show the URL and a
    "Change" link in the publish toast.
14. **Clicking "Open the designer" creates a form row immediately**, so abandoned visits leave "Untitled form"
    drafts. Create on first change, or clean up empty drafts.
15. **Date field is read-only**: you cannot type a date, only click month by month (a birth date is 300+ clicks)
    `[shot 06]`. Accept typed input in the locale format; add month/year selectors; start the week per locale (it's
    Sunday-first for en-GB). Designer has no min/max date.
16. **Number field**: no integer/decimal choice, step, prefix/suffix (€, seats), or default value.
17. **Scale 1–5**: the inspector shows an "Options" textarea (meaningless for a scale), but no way to edit the end
    labels — the default "Poor / Excellent" is wrong for "experience level".
18. **Rules editor is too thin**: only equals / not equals / filled / empty. Numbers need `> ≥ < ≤`; checkboxes need
    "includes"; no "and/or" of conditions; no "hide" verb; no computed fields (e.g. total = seats × price).
19. **Drag-and-drop reordering was unreliable** in one session: dragging *Seats* onto *Workshop* moved *Extras*
    instead (reproduced twice across a reload, then not again; keyboard Alt+↑/↓ was always right). Needs a
    Playwright drag test across a scrolled canvas — suspect stale `drop` state from an earlier `dragover`
    (`public/designer.js` `overField`/`dropHere` ~L469–490): reset `this.drop` on `dragstart`.
20. **Alt+↓ on the last field of a section jumps to the next section** — good — but holding it skips empty sections
    straight to the last one; there is no drag target for an *empty* section other than the "Drop here" line.
21. **Inspector keeps showing the last field** on Rules/Appearance/JSON/Preview tabs; "The form" description panel
    is unreachable once a field was selected. Show form-level settings when no field is selected and on non-Build tabs.
22. **Publish feedback**: the toast "Published version 1. The public link serves it now." has no link or copy button;
    the Publish button looks the same before and after.

### Public form
23. Third-width dropdown truncates its value ("Advanced Reac…") `[shot 06]`.
24. On phone, the date input stays narrow while every other field is full width; the Line items box touches the
    last checkbox `[shot 08]`.
25. Required errors on step 1 are browser-native strings ("Please fill in this field.") — make them consistent with
    the server's wording and the theme.

### Dashboard / responses
26. Responses table shows only the first 4 fields — no column chooser; the expanded row is one field per ~95 px
    with raw ISO dates (`2026-12-03`) `[shot 10]`.
27. "Republish" is the primary button on the responses page even when nothing changed.
28. Search placeholder is cut off ("Any word in any answe").

### Report designer
29. **New blocks arrive with placeholder bindings to fields that don't exist**: stats → `{{ money(revenue) }}`,
    bars → `channels` / `row.name`, chart → `quarters` / `row.revenue` / "Revenue by quarter". Each immediately
    becomes a preflight error. Seed new blocks from the current schema (first array, first numeric field), or leave
    them empty with a hint.
30. **New blocks are appended at the end without scrolling to them**; with nothing selected the user sees no change.
    Scroll to and select the new block.
31. **Stats rows have no visible labels** — four bare inputs per row (Label/Value/Change/Trend shown only as their
    current values, and new rows are prefilled with the literal text "Label") `[shot 12]`. Easy to type into the wrong
    box; I did. Add visible labels or a compact grid with headers.
32. **"Insert field" list is unusable**: `row.label` appears three times (three different arrays), invoice-only paths
    (`doc.money.total`, `line.net`) are offered on a survey summary, and there is no way to pick *one question*
    (e.g. "Seats → mean"). Group paths by array, hide irrelevant system paths, and add a helper such as
    `question("seats").mean` — positional `questions[5]` breaks as soon as the form changes.
33. **Preflight flags guarded expressions**: `{{ questions[5] ? number(questions[5].mean, 1) : "—" }}` is still
    `missing-data`, so its own advice ("write … ?? …") is the only accepted form. Analyse ternary branches lazily.
34. **No array literal**: `questions[3].options ?? []` → `bad-expr … unexpected "["`; there is no way to say "empty list
    if missing" for `rows`.
35. **`share` units are undocumented** — it is already a percent (37.5), so `percent(row.share * 100)` printed
    "6,520 %". Say "0–100" in the field list / vocabulary, or make it 0–1 like most libraries.
36. **Missing values render as `‹questions[5].mean›` and overflow into the next stat** ("…mean›The MCP server")
    `[shot 13]`. Ellipsise or wrap inside the cell.
37. **Move up/down silently steps over hidden blocks** (NPS blocks hidden by `when`): two clicks did nothing visible.
    Skip hidden blocks or show them dimmed on the canvas. Blocks also can't be moved *into* a section.
38. **Orphaned block title in the PDF**: "BOOKINGS PER WORKSHOP" sits at the bottom of page 1, its bars on page 2
    `[shot 15, 16]` — Preflight said "clean". Keep a block's title with its body (`break-after: avoid`), and let
    preflight catch an orphaned heading.
39. **"Issue a test document" is enabled before the first publish** and only flashes a 3-second toast "Publish first".
    Disable it with a tooltip, or let it render a draft from the working copy.
40. The footer still says "Workshop orders · Draft" after renaming the report; the document page heading is just
    "Draft" next to a "Draft" badge (use the document title); "Pages: —" on a rendered draft.
41. The default Survey summary layout prints "Written answers" for **number** and **date** questions (Seats has a
    mean of 3.8 in the data) — the table should show mean/range for numbers and earliest–latest for dates.
42. The stats starter row has "Trend: up" preset; it prints a trend arrow for a value that has no trend.

---

## P2 — polish

43. App header: the page `h1` ("Forms", "Workshop orders") sits on the top bar's bottom border `[shot 01, 09]`.
44. Empty-state card and the two "From Claude… / From a terminal" cards touch (no gap) `[shot 01]`.
45. Big stat numbers use a serif "1" that reads as a lowercase "l" `[shot 09]`.
46. Forms filter input is ~28 px tall, out of step with every other control.
47. Shortcut hint says "Ctrl K" on macOS (should be ⌘K); the designers say "Ctrl+Z" too.
48. Sidebar email is truncated with no tooltip.
49. Designer palette: "Repeatable rows" icon is a solid black square (missing icon) `[shot 02]`; "Checkboxes" and
    "Checkbox" have near-identical icons.
50. Designer canvas has ~90 px of dead space above the tabs; the right panel starts 10 px lower than the left.
51. Report designer header is two rows out of line (title at one height, toolbar at another) `[shot 11]` — match the
    form designer's single 60 px bar.
52. Theme picker lists 31 raw slugs (`neumorph`, `swiss-document`) with no swatch or preview.
53. Signup: page jumps from the dark marketing site to a light auth card; the "forecraft" wordmark floats outside
    the card's left edge; after signup nothing mentions the API key the signup copy promised (the Keys page has
    "No keys yet").
54. Marketing hero is blank for ~1 s on load (fade-in from opacity 0) — render visible first.
55. The Fit/100 %/150 % zoom keeps the iframe's scroll position, so switching zoom lands mid-document.

---

## Verified OK (don't break these)

Signup + session; autosave ("All changes saved"); undo in both designers; keyboard reorder (Alt+↑/↓); delete
field/block; sections → wizard; theme/accent/eyebrow/submit label; preview with audit; publish + versions; public
wizard Back/Next keeps answers; repeatable rows add/remove; date picker; 8 submissions accepted; responses table,
row expand, CSV/JSON export (CSV flattens line items correctly); report publish, test document, issued PDF with
number, share link; slug is editable in form Settings → Public address; no horizontal scroll on phone.

## Environment note

`npm install` does not fetch the Chromium build that `playwright-core` (used by `src/reports/pdf.ts`) needs. Until
#9 is fixed: `npx playwright install --only-shell chromium`.

## Suggested order

1 → 2 → 4 → 3 → 6 → 7 → 5 → 9, then 10–13 (form designer), 29–33 (report designer), 8 (new source), the rest.
