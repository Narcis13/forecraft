# Faqir upstream notes

Bugs, rough edges and missing capabilities found in Faqir UI 1.2.5 (`faqir-ui-cli`,
`@faqir-ui/forms`, `@faqir-ui/rules`, `@faqir-ui/template`, all 1.2.5) while building
**forecraft**, a form platform whose first user is an agent: an API and an MCP server
that create, render and validate forms, a drag-and-drop designer, and public forms
rendered by `@faqir-ui/forms`. Faqir is used as released; it is never forked.

Each entry says what we saw (**Seen**), where it lives in the 1.2.5 source under
`C:\newme\faqir-ui` (**Where**), why it happens when we found out (**Why**), what
forecraft does about it today (**Here**: a scoped workaround, a local patch under
`ui/` marked `/* forecraft patch: see FAQIR-UPSTREAM.md #n */`, or nothing), and a
**Suggested fix** as a change to the upstream repository, with the test that would
guard it.

When an entry is fixed upstream and `faqir upgrade` brings it in, remove the
workaround named under **Here**, and strike the entry. `docs/faqir-digest.md` is the
prioritised shortlist.

---

## Engine (`ui/core/faqir-core.js`)

### 28. Auto-start can boot between two deferred scripts, and `l-rules` is then silently never bound

- **Seen:** found by the e2e suite. A form page loads `faqir-core.js`, then
  `faqir-validate.js`, `faqir-rules.js` and `form.js`, all `defer`. About 4 runs in 6,
  a field a rule hides stayed visible and a rule-required field was not required — no
  error, no warning. Delaying `faqir-rules.js` by 300 ms made it deterministic.
- **Where:** `src/core-src/engine.js`, the "Auto-start logic" block (`ui/core/faqir-core.js`
  ~line 11945): when the core runs with `readyState === "interactive"` — always, for a
  `defer` script — it adds a `DOMContentLoaded` listener **and** `setTimeout(autoStart, 0)`.
  The timer can run between two deferred scripts, so the engine boots before later plugins
  and page `Faqir.data()` registrations exist, and a directive registered afterwards is
  never applied to the already-bound tree.
- **Why:** the timer exists for module imports (README: "boots one task after it is
  imported, so registrations on the following lines are seen"); for a classic `defer`
  script the `DOMContentLoaded` listener alone is correct.
- **Here:** both layouts load the core with `data-manual`, and `public/boot.js`, the last
  deferred script, calls `Faqir.start()`. `tests/e2e/faqir-boot.spec.ts` guards it.
- **Suggested fix:** schedule the timer only for a module (no `currentScript`); for a
  classic script rely on `DOMContentLoaded`. And make a directive registered after boot
  (a late plugin) scan the bound tree once, or at least warn in the dev build. Test: a page
  whose plugin script arrives 300 ms late still binds `l-rules`.

### 10. Plain JavaScript cannot reach a component's controller

- **Seen:** the dashboard shows a toast after an API call. From an expression,
  `$ui('#toasts').add({…})` works; from plain JavaScript there is no public accessor —
  the controller sits on a private `_faqir…` property of the element.
- **Where:** `src/core-src/engine.js`, `getControllerApi` (private); the public
  `Faqir` object has `data`, `store`, `directive`, `controller`, `inspect`, but no
  `ui(el)`.
- **Here:** every behaviour that needs a controller is a `Faqir.data` component in
  `public/app.js`, whose methods reach `this.$ui(...)`.
- **Suggested fix:** `Faqir.ui(elOrSelector)` returning the controller API (the same
  function `$ui` calls).

---

## Forms (`@faqir-ui/forms`)

### 1. The rules definition a form carries cannot be had without parsing the HTML

- **Seen:** forecraft validates every submission on the server with the same
  definition the page enforces. `renderForm(schema, ui, { rules })` derives that
  definition (fields from the schema, `if/then/else`, `dependentRequired`, wizard
  jumps, the author's rules) and writes it into
  `<script type="application/json" id="<prefix>-rules">`, but returns only the HTML
  string. A server that wants the definition has to render the form and pull the JSON
  back out of the markup with a regular expression.
- **Where:** `packages/forms/src/index.js`, `renderForm` (the block after
  "Rules, part two", which builds `rulesDefinition` and passes it only to
  `rulesScriptLines`). `rulesFieldsFrom`, `conditionalRules`,
  `dependentRequiredRules` and `wizardJumpRules` are module-private.
- **Why:** the package's contract is "only builds strings"; the definition was
  never meant to leave as data.
- **Here:** `src/forms/model.ts` `compileForm` always passes `rules: {}` (so a form
  with no rules still carries a definition) and `extractRules` parses the script
  element out of the HTML. It depends on the exact `id="fc-rules">\n` shape of the
  output.
- **Suggested fix:** export `rulesFor(jsonSchema, uiSchema, opts)` returning the same
  object `renderForm` embeds (or `renderForm(..., { returnRules: true })` returning
  `{ html, rules }`). Test: for every case in `tests/forms.test.ts` that emits a rules
  script, `JSON.parse(script) deepEquals rulesFor(...)`.

### 2. A single-page form renders no submit button

- **Seen:** `renderForm` of a schema without `ui:wizard` returns a `<form>` whose last
  child is the last field-group. There is no submit button and no i18n key or option
  that adds one, although `i18n.submitLabel` exists and is used — by the wizard only.
- **Where:** `packages/forms/src/index.js`, `renderForm`: `renderWizard` pushes
  Back/Next/Submit buttons; the non-wizard branch pushes only field lines.
- **Why:** the `form-page` pattern it mirrors has no button either.
- **Here:** `templates/pages/form.faqir` adds
  `<button type="submit" form="fc-form" data-ui="button" …>` after the form, using
  the `form` attribute so it can sit outside the generated markup.
- **Suggested fix:** emit a footer with a submit button labelled `i18n.submitLabel`
  for single-page forms too (opt out with `opts.submit: false`), and add the button
  to the `form-page` pattern's canonical HTML so the drift test keeps them in step.

### 3. A wizard's last step marks the form "submitted" and nothing else

- **Seen:** on the final step the wizard's `l-validate` on-valid hook runs
  `$el.dataset.state = 'submitted'` and prevents the native submit. A page that
  posts the answers has to watch for that attribute; a single-page form instead lets
  a clean submit through natively. Two forms from the same renderer need two
  different submit integrations, and neither is documented as the way to post.
- **Where:** `packages/forms/src/index.js`, `renderForm`, the `formAttrs` block for
  `wizard` (`l-validate="step < last ? (...) : ($el.dataset.state = 'submitted')"`).
- **Here:** `public/form.js` listens for `submit` on the document (after the form's
  own handlers), and sends when either `!e.defaultPrevented` (single page) or
  `form.dataset.state === "submitted"` (wizard); on a failed send it removes the
  state so the person can retry.
- **Suggested fix:** dispatch one event both shapes share — e.g. `faqir:valid-submit`
  on the form, with the coerced data as `detail` — and document it as the SPA hook.
  Test: a wizard and a single-page form both fire it exactly once on a valid submit.

### 4. Answers on other wizard steps are not in `FormData`

- **Seen:** the wizard disables the controls of every inactive step, so
  `new FormData(form)` on the last step holds only the last step's answers. The
  `faqir-rules` plugin knows this and reads disabled-by-someone-else controls itself,
  but that reader is private.
- **Where:** `packages/rules/src/plugin.js` (the form reader described in the README
  under "The form's data is read from its controls the way FormData reads them, with
  one difference").
- **Here:** `public/form.js` `pairs()` re-implements the reader: every named control,
  skipping only those whose `field-group` a rule hid.
- **Suggested fix:** expose the reader (`Faqir.rules.data(form)` or a `formData()`
  method on `$rules`), and pass its result in the event of #3.

### 5. The form's title is always an `<h1>` inside the form

- **Seen:** a root `title` renders as `<h1>` as the first child of `<form>` and also
  becomes `aria-label`. A page that composes its own hero (cover image, eyebrow,
  stamp) above the card has to remove `title` and `description` from the schema
  before rendering, and loses the form's accessible name with them.
- **Where:** `packages/forms/src/index.js`, `renderForm`, the `output.push` of `<h1>`
  and of the description paragraph.
- **Here:** `compileForm` strips `title`/`description` from the root before rendering
  and the page template renders them in its own header.
- **Suggested fix:** `opts.heading: false` (keep `aria-label`, drop the `<h1>`), or
  `opts.labelledBy: "<id>"` so the page's own heading names the form.

### 6. No field-level layout: every field is full width

- **Seen:** the designer lets a person set a field's width (full, half). The UI schema
  has no key for it, and an unknown UI key throws, so there is nowhere to put it.
- **Where:** `packages/forms/src/index.js`, the UI key allow-list used by
  `validateFieldSchema` / `buildFieldGroup`.
- **Here:** width is not offered in phase 1 (recorded under Decisions in
  `PROGRESS.md`).
- **Suggested fix:** a `width` UI key (`"full" | "half" | "third"`) emitted as a
  `data-span` on the `field-group`, with `field-group` / `form-page` CSS placing groups
  on a two- or three-column grid from the `md` tier.

### 14. `renderForm` emits `data-ui="checkbox-group"`, which is not a Faqir component

- **Seen:** every enum-array field (`features` on `/f/customer-pulse`, `workshops`
  on `/f/agents-summit`) renders
  `<div data-ui="checkbox-group" role="group" aria-labelledby="…">`, and
  `faqir audit` reports `unknown-component: data-ui="checkbox-group" is not a Faqir
  component — no component, alias or base-layer value of that name exists`. The
  renderer's own output is not clean against the registry it targets. (`radio-group`
  is fine: the `radio` primitive's CSS declares it.)
- **Where:** `packages/forms/src/index.js`, `renderCheckboxGroup` (line ~1412);
  `registry/primitives/checkbox/` has no group.
- **Here:** nothing; the warning is listed in `PROGRESS.md`.
- **Suggested fix:** add `checkbox-group` to the `checkbox` primitive (CSS and manifest,
  mirroring `radio-group`), and make the forms drift test audit its output against the
  registry so an unknown `data-ui` fails it.

### 15. A date field puts a dialog inside `<main>`

- **Seen:** a `format: "date"` field renders the `date-picker` recipe, whose calendar
  popover is a dialog. A form lives in `<main>`, so every page with a date field gets
  the `landmark` warning "Dialog <div> is nested inside <main> — move it out of the main
  content flow". A form field cannot move out of `<main>`.
- **Where:** `src/audit/rules.ts` (the `landmark` rule's dialog check) against
  `packages/forms/src/index.js` `renderDatePicker`.
- **Here:** nothing; the warning is listed in `PROGRESS.md`.
- **Suggested fix:** the `landmark` rule should exempt a dialog that is a part of an
  inline control (`date-picker`, `combobox`, `select-custom` panels) — or the date-picker
  should be a popover (`popover` attribute, top layer), which no landmark contains.

### 16. Fields inside a group or a wizard step have no vertical rhythm, and top-level fields too much

- **Seen:** the generated `<form>` is a flow root, so top-level field-groups are
  separated by `--section-gap-sm` (section-sized gaps between two inputs). Inside a
  `ui:groups` fieldset card or a wizard step card, field-groups sit in a card body,
  which is not a flow root, so they touch: the next label starts right under the
  previous input. Same form, two rhythms, neither right.
- **Where:** `registry/base/rhythm.css` (flow roots exclude `[data-ui]` elements, so a
  `fieldset data-ui="card"` is not one); `packages/forms/src/index.js` `fieldsetCard`
  and `renderWizard`.
- **Here:** `templates/pages/form.faqir` puts `data-gap="6"` on the `<section>` around
  the form (the inherited `--flow-space` tunes the top level, no CSS); `public/app.css`
  gives `form [data-ui="card"] > [data-part="body"]` a grid gap.
- **Suggested fix:** `renderForm` emits `data-gap` on the form (an `opts.gap`, default
  `4`), and `card`'s body becomes a flow root (or `field-group` gets its own
  `field-group + field-group` spacing). Visual test: a grouped form and a wizard step
  have the same gap between fields as a flat form.

### 17. No scale or rating input; `radio-group` has no horizontal orientation

- **Seen:** the customer survey needs a 0–10 recommendation scale and agree/disagree
  scales. `renderForm` offers radio and select only, `radio-group` is always a vertical
  column, and the `rating` primitive is read-only (`use-as-an-input` is in its unsafe
  transforms). Eleven stacked radios are a poor survey.
- **Where:** `registry/primitives/radio/radio.css` (`[data-ui="radio-group"]` is
  `flex-direction: column`, no variant); `registry/primitives/rating/`;
  `packages/forms/src/index.js` widget table.
- **Here:** `public/app.css` lays out any radio group with 7+ options as a wrapping row
  of bordered segments (`:has(> [data-ui="radio-label"]:nth-child(7))`), with the
  checked one in `--color-primary-subtle`.
- **Suggested fix:** `data-orientation="horizontal"` on `radio-group` (and
  `checkbox-group`), a `scale` widget in `@faqir-ui/forms` for string/integer enums
  that renders it with min/max captions, and an input variant of `rating`
  (radios under a star mask) as a `rating` widget.

---

## Template (`@faqir-ui/template`)

### 26. Inline text before punctuation gets a stray space

- **Seen:** every node renders on its own line, and HTML renders a line break as a
  space, so `code` followed by piped `| .` renders "`x` ." — inline-rich sentences
  (a code span, then a comma) cannot be written without `raw`.
- **Where:** `packages/template/src/render.js` (the one-node-per-line rule, §12.1 of
  `docs/template.md`).
- **Here:** `/for-agents` writes that list with `raw`; other copy was reworded.
- **Suggested fix:** a "glue" marker (for example a piped line starting with `|<`)
  that joins to the previous node without whitespace, documented beside §12.1.

### 34. No recursion means one dispatcher per nesting level

- **Seen:** report blocks nest (a section holds blocks; columns hold blocks). A partial
  that includes itself is `include-cycle` at compile time, so a block tree cannot be
  drawn by one recursive "draw a block" partial.
- **Where:** `packages/template/src/compile.js` (include-cycle detection), §10.3 of
  `docs/template.md`. Deliberate (decision 9), and right for untrusted templates.
- **Why:** bounded recursion is safe — the engine already bounds steps and output —
  but the cycle check is structural, not depth-based.
- **Here:** `templates/reports/dispatch.faqir`, `dispatch-1.faqir`, `dispatch-2.faqir`
  and `blocks/section-1|2`, `columns-1|2`: the same dispatch three times, and the
  model refuses containers deeper than two levels.
- **Suggested fix:** allow a self-include with an explicit depth budget
  (`include "x.faqir" (…) depth=3`), counted against `include-depth`; test: a
  three-level tree renders, a four-level one is `include-depth` at render.

---

## Primitives and base styles

### 8. No skip link

- **Seen:** every page needs a "Skip to content" link that is hidden until focused.
  No primitive, base style or pattern provides it (`site-header` has none).
- **Where:** `registry/base/reset.css`, `registry/patterns/site-header/`.
- **Here:** `public/app.css` styles `body > a[href="#main"]:first-child`.
- **Suggested fix:** a `skip-link` primitive (or a `data-part="skip"` on
  `site-header`), visually hidden until `:focus-visible`, with an a11y test that it
  is the first tab stop.

### 23. `nav` never wraps

- **Seen:** a horizontal `nav` of six links overflows a phone viewport: the root is
  `display: flex` with no `flex-wrap`, and no variant wraps or scrolls.
- **Where:** `registry/primitives/nav/nav.css` line ~6.
- **Here:** the docs pages use the `vertical` variant in a sidebar.
- **Suggested fix:** `flex-wrap: wrap` on the horizontal and pill variants (or an
  `overflow-x: auto` scroller with scroll-snap for the underline variant).

### 24. Prose tables widen the page on a phone

- **Seen:** a wide markdown table inside `data-ui="prose"` pushes the page into
  horizontal scroll at 375px.
- **Where:** `registry/base/prose.css` `[data-ui="prose"] table` (line ~143): no
  overflow handling.
- **Here:** `src/routes/marketing.ts`'s markdown renderer wraps each table in a
  focusable `role="region"` with an `aria-label`; `public/app.css` gives it
  `overflow-x: auto`.
- **Suggested fix:** style a `[data-ui="prose"] [data-part="table-wrap"]` (or
  `figure > table`) scroller in `prose.css` and document the wrapper.

### 27. A `ui:groups` fieldset card's `<legend>` notches the card border

- **Seen:** `@faqir-ui/forms` renders each `ui:groups` group as
  `<fieldset data-ui="card" data-variant="outlined"><legend data-part="title">…</legend>
  <div data-part="body">…`. `card.css` styles a `div` card: on a fieldset the legend keeps
  the browser's rendering, sitting on the top border with a gap cut into it, flush to
  the edge while the body is inset by `--card-padding` (`/f/customer-pulse`,
  `/f/senior-product-engineer`).
- **Where:** `registry/primitives/card/card.css` (no `fieldset` / `legend` rules);
  `packages/forms/src/index.js` `fieldsetCard`.
- **Here:** `public/app.css` floats the legend full width with the card's part padding
  and clears the body after it.
- **Suggested fix:** in `card.css`, `fieldset[data-ui="card"]` resets `min-inline-size`
  and `margin`, and `> legend[data-part="title"]` is floated (or `display: contents` on a
  wrapper) and padded like `[data-part="header"]`; a visual test of a grouped form.

### 31. Visually hidden text exists only as a class

- **Seen:** the designer needs labels that only assistive tech reads (the form title
  input in the toolbar, section titles, a live region). `base/reset.css` ships the
  pattern as `.sr-only`, but the protocol forbids `class` (`no-class-attribute`
  warns), so the one sanctioned helper cannot be used.
- **Where:** `registry/base/reset.css` (`.sr-only`).
- **Here:** `public/app.css` re-implements it as `[data-designer-sr]`.
- **Suggested fix:** a base-layer `data-ui="visually-hidden"` (or a `hidden-until-focus`
  variant that also covers #8's skip link), with `.sr-only` kept as an alias.

---

## Recipes

### 11. `alert-dialog` requires its own trigger, which keeps it inside `<main>`

- **Seen:** deleting a response is a row action; the confirmation is one dialog opened
  from any row. `dialog` made its trigger optional in 0.9-04; `alert-dialog` still
  requires `[data-part="trigger"]` (`required-slot`, critical). With the trigger inside
  the alert-dialog root, the root must sit where the button is — inside `<main>` —
  which is the `landmark` warning "Dialog nested inside <main>".
- **Where:** `registry/recipes/alert-dialog/alert-dialog.manifest.json`, slot `trigger`
  `required: true`.
- **Here:** destructive confirmations use `dialog` with `data-variant="danger"` on the
  panel, placed in the layout's `dialogs` block outside `<main>`, and opened with
  `$ui('#id').open()`; the row passes its id with `$dispatch`.
- **Suggested fix:** make the trigger optional as for `dialog` (the controller already
  has `open()`), so an alert-dialog can live at the end of `<body>`.

### 13. `command-palette` items declare no target

- **Seen:** a navigation palette needs each item to say where it goes. The item
  declares no `data-value` / `href`, so `data-href` is an `unknown-attribute` warning,
  and the `command-select` event carries only the element and its label.
- **Where:** `registry/recipes/command-palette/command-palette.manifest.json`
  (`slots.item`, no attributes); `command-palette.js` `selectItem`.
- **Here:** `templates/layouts/app.faqir` routes by label: a `palette` component in
  `public/app.js` holds a label → URL map passed as `data-prop-routes`.
- **Suggested fix:** declare `data-value` on items and pass it as `detail.value`; and
  let an item be an `<a href>` that the controller follows on Enter.

### 25. `toggle-group` items keep `data-state="off"` when a binding checks them

- **Seen:** in the designer the mode switch is a segmented `toggle-group` whose radios
  carry `:checked="mode === 'wizard'"`. The right radio is checked and the segmented
  thumb follows it (the CSS reads `:checked`), but every item keeps
  `data-state="off"`: the controller only syncs `data-state` on `change` events, which a
  programmatic `checked` does not fire.
- **Where:** `registry/recipes/toggle-group/toggle-group.js` (state sync in the change
  listener).
- **Here:** nothing; the visible state is right because the CSS reads `:checked`.
- **Suggested fix:** sync `data-state` from `checked` on `faqir:model` and on a
  `MutationObserver`/effect pass, or derive it in CSS only.

### 29. A date-picker's input holds display text, so `FormData` submits "October 15, 2026"

- **Seen:** found by the e2e suite. A `format: "date"` field renders the `date-picker`
  recipe; after picking a day the readonly input's `value` is "October 15, 2026" and the
  ISO date is only in `input.dataset.value`. Anything that reads the form the standard way
  (`new FormData(form)`, a native submit) sends the display text, which the same
  definition's `format: "date"` then refuses on the server (422).
- **Where:** `registry/recipes/date-picker/date-picker.js` (`input.dataset.value = dateStr`
  beside a formatted `value`); `packages/forms/src/index.js` `renderDatePicker` gives the
  readonly display input the field's `name`.
- **Here:** `public/form.js` `pairs()` sends `dataset.value` for inputs inside a
  `date-picker`. `tests/e2e/date-field.spec.ts` guards it.
- **Suggested fix:** keep the display text in the visible input without a `name`, and put
  the ISO value in a hidden `<input name>` the picker updates (the pattern native date
  inputs follow), so `FormData` and native submits carry what the schema validates. Test:
  `new FormData(form).get(name)` is ISO after a pick.

---

## Patterns

### 12. `auth-form`'s canonical card fails `card`'s required body

- **Seen:** the `auth-form` pattern's reference HTML puts `header`, `error`, `form`,
  `separator`, `social` and `footer` directly in `<div data-ui="card">`. Copied as is,
  `faqir audit` reports `critical required-slot: Missing required slot
  [data-part="body"] in <div data-ui="card">`.
- **Where:** `registry/patterns/auth-form/auth-form.html` (both variants, lines 10 and
  95).
- **Here:** `templates/pages/auth.faqir` wraps the error and the form in
  `<div data-part="body">`.
- **Suggested fix:** wrap them in the card body in the pattern's HTML, and audit every
  pattern's reference HTML in the registry test (`audit:registry`) so a pattern cannot
  ship markup its own components reject.

### 19. `feature-grid` headings ignore the heading voice

- **Seen:** `feature-grid` titles use `--font-body` at `--weight-bold`, while `bento`,
  `faq`, `testimonials`, `cta` and `pricing` use `--font-heading` and
  `--heading-weight`. On a page with a serif heading face the feature titles are the
  only sans-serif bold headings.
- **Where:** `registry/patterns/feature-grid/feature-grid.css`, the title rule
  (`font-family: var(--font-body)` around line 12, `font-weight: var(--weight-bold)`
  around line 21).
- **Here:** the marketing block in `public/app.css` re-points the title to the heading
  voice.
- **Suggested fix:** use `--font-heading` / `--heading-weight` as the other patterns
  do; a test that every pattern's title rule reads the heading tokens.

### 20. A hero inside a backdrop hides the backdrop

- **Seen:** `hero` paints `background-color: var(--hero-bg, var(--color-bg))`, so a
  hero wrapped in `backdrop` covers the backdrop's light unless the page sets
  `--hero-bg: transparent` by hand (the CSS comment says so; the manifest does not).
- **Where:** `registry/patterns/hero/hero.css` line ~20.
- **Here:** the marketing block in `public/app.css` sets `--hero-bg: transparent` on the
  landing hero.
- **Suggested fix:** `[data-ui="backdrop"] [data-ui="hero"] { --hero-bg: transparent }`
  in the hero's own CSS, or document it in the manifest's safe transforms.

### 21. The split hero's headline stops at `--text-4xl`

- **Seen:** only the cover layout of `hero` has a display-size knob
  (`--hero-display-size`); the split layout's headline is capped at `--text-4xl`, small
  for a launch page at 1440px.
- **Where:** `registry/patterns/hero/hero.css`.
- **Here:** the marketing block in `public/app.css` overrides it from the `lg` tier.
- **Suggested fix:** honour `--hero-display-size` in every layout.

### 22. The body's rhythm opens a gap between a sticky header and `main`

- **Seen:** `body` is a flow root, so `--flow-space` (3rem) separates `site-header`
  from `main`, leaving a band of plain background above a full-bleed hero backdrop.
- **Where:** `registry/base/rhythm.css` (flow roots include `body`);
  `registry/patterns/site-header/`.
- **Here:** marketing pages set `margin-block-start: 0` on their `main`.
- **Suggested fix:** exclude `[data-ui="site-header"] + *` (or any sticky/fixed
  header) from the flow margin.

### 30. `dashboard-shell`'s reference markup covers a phone with its sidebar

- **Seen:** the pattern's canonical HTML (and the SKILL example) puts
  `data-state="expanded"` on the sidebar. Copied as is, a 390px phone shows the sidebar
  as a fixed overlay over the whole dashboard, with no way to close it: off-canvas is the
  phone default only when the state is absent. And the `sidebar-toggle` part stays visible
  from the `md` tier up, where the sidebar is docked and the toggle does nothing.
- **Where:** `registry/patterns/dashboard-shell/dashboard-shell.html` (every variant) and
  `dashboard-shell.css` (no rule for `sidebar-toggle` from `md` up; no controller wires it).
- **Here:** `templates/layouts/app.faqir` binds `:data-state="nav ? 'expanded' : null"`
  from an `l-data` on the shell with a header toggle; `public/app.css` hides the toggle
  from `md` up.
- **Suggested fix:** ship the canonical markup without a sidebar state (or with a small
  controller that toggles it from `sidebar-toggle`, closes on Escape and on overlay
  click), and hide `sidebar-toggle` where the sidebar is docked. A phone-width visual
  test of the pattern's reference page.

---

## Themes and fonts

### 9. No runtime accent: a brand colour needs the CLI

- **Seen:** the form designer's appearance tab offers a theme and an accent. A
  theme is one `data-skin` and one scoped stylesheet (`faqir theme bundle --scope`,
  which works very well), but an accent has no runtime form: `faqir theme generate`
  is a CLI that writes files, and `faqir-tweak` writes inline tokens from JS.
- **Where:** `src/commands/theme.ts` (`generate`), `registry/core/plugins/faqir-tweak.js`
  (`ACCENT`, which already lists the five tokens an accent moves).
- **Here:** `public/app.css` defines eight `[data-accent="…"]` hues that re-point
  `--color-primary`, `-hover`, `-active`, `-subtle` and `--color-ring` with relative
  colour syntax over the theme's own primary lightness.
- **Suggested fix:** a `data-accent` axis in `tokens/semantic.css` with a fixed set of
  named hues (and `--accent-hue` for any other), computed with relative colour syntax
  so every theme keeps its own lightness and chroma; `contrast-tokens` should check
  each named hue against each theme.

### 18. A one-weight heading font gets a synthesised bold

- **Seen:** `faqir fonts add instrument-serif --role heading` installs one weight
  (400). Most themes ask for `--heading-weight: var(--weight-semibold)` or bold, and
  card titles and stat values ask for their own weights in the heading face; the browser
  fakes the bold, which smears the serif on every heading (marketing site, dashboard
  card titles).
- **Where:** `src/commands/fonts.ts` (the catalog knows the family is static) and
  `tokens/` (nothing clamps `--heading-weight` to the installed weights).
- **Here:** `public/app.css` sets `font-synthesis-weight: none` on `body`, and the
  marketing pages set `--heading-weight: var(--weight-normal)`.
- **Suggested fix:** `faqir fonts add` writes the family's available weights into
  `fonts.css` and, for a static single-weight family, `font-synthesis-weight: none`
  on the role it fills (or warns that the active theme's heading weight is not
  available).

---

## CLI / audit (`faqir-ui-cli`)

### 7. No programmatic audit in any npm package

- **Seen:** forecraft's API returns an audit with every preview, so an agent can
  self-check what it built. The only audit 1.2.5 ships is the CLI, so each preview
  spawns `node node_modules/faqir-ui-cli/dist/faqir.mjs audit --stdin --json`
  (about one second, most of it start-up).
- **Where:** `src/audit/html-audit.ts` (the auditor), `src/commands/audit.ts` (the
  only caller that ships); `src/audit/browser.ts` is built for the docs site, not
  published.
- **Here:** `src/forms/page.ts` `auditHtml` spawns the CLI.
- **Suggested fix:** publish `auditHtml(html, { components })` from a package
  (`@faqir-ui/audit`, or an export of `@faqir-ui/mcp`), the same code the MCP tool
  `faqir_audit_html` runs. Test: the package and `faqir audit --stdin --json` give the
  same findings for the audit fixtures.

---

## Print and documents

Found while building forecraft's reports: invoices, letters, reports, confirmations and
survey summaries printed by headless Chromium (playwright-core 1.64.1, Chromium 149) from
the `document` pattern, the doc tokens and the five print themes. Each suggested fix names
the case it would add to Faqir's own print matrix (`tests/visual/print/matrix.ts`).

### 32. A document's paper, margins and accent need per-document CSS

- **Seen:** `@page { size: var(--page-format) … }` reads tokens, but `@page` cannot be
  scoped to an element, so two documents on different paper (an A4 invoice, a Letter
  report) cannot be told apart by an attribute; and a print accent from a brand hex is
  #9 again, now on paper.
- **Where:** `registry/patterns/document/document.css` (`@page` at the top);
  `registry/tokens/document.css` (`--page-format` and margins at `:root` only).
- **Why:** page boxes are not elements; only named pages (`page: name`) select them.
- **Here:** the renderer writes one `<style data-report-page>` per document with the
  paper, margins, accent and page counter, built from validated enums and one checked
  hex (`src/reports/render.ts`, `documentCss`).
- **Suggested fix:** ship named pages per format and orientation (`@page faqir-a4-portrait`,
  …) selected by `[data-ui="document"][data-format][data-orientation] { page: … }`, and a
  `--doc-accent` token the print themes read for their one accent. Matrix case: one HTML
  page with an A4 and a Letter document prints 595.28 × 841.89 then 612 × 792.

### 33. The page counter is an English literal

- **Seen:** every printed page says `Page 1 / 2`, in English, in a Romanian invoice.
  There is no token or attribute for the words.
- **Where:** `registry/patterns/document/document.css`, `@bottom-right { content: "Page "
  counter(page) " / " counter(pages); }`.
- **Here:** the per-document style (#32) replaces the margin box with the document's
  label ("Pagina 2 din 3", "Seite 2 von 3").
- **Suggested fix:** `content: var(--doc-page-label-before) counter(page)
  var(--doc-page-label-between) counter(pages)` is not valid CSS, so ship it as named
  pages per language or as `data-page-label` on the document read through `attr()` where
  supported. Matrix case: `lang="ro"` document prints "Pagina 1 din 3".

### 35. Installing a print family takes a role from the app

- **Seen:** `faqir fonts add ibm-plex-sans` must assign a role, and each role has one
  family, so adding a document face silently replaces `--font-body` (or heading, ui, mono)
  for every app page.
- **Where:** `src/fonts/install.ts` (`assignRoles`: "a role has exactly ONE family").
- **Here:** a second Faqir project, `print/faqir.config.json` (output `ui/print/`), owns
  IBM Plex Sans, Serif, Mono and Source Serif 4; documents load `ui/print/fonts.css` and
  name families through the doc tokens. Newsreader did not fit (four roles per project).
  The phase 1 pages are unchanged.
- **Suggested fix:** `faqir fonts add <family> --role none` (install the faces, emit the
  `@font-face` rules, set no role), or a `document` role that sets `--doc-font`. Test:
  adding a role-less family leaves `fonts.css`'s role block byte-identical.

### 36. No `chart` primitive

- **Seen:** a business report and a survey summary need a bar, column or line chart; the
  report scaffold ships a placeholder image ("REPLACE REPORT IMAGE").
- **Where:** `src/scaffolds/documents.ts` (`REPORT_IMAGE`); no chart in the registry.
- **Here:** `src/reports/chart.ts` lays out bar / column / line as plain geometry and
  `templates/reports/blocks/chart.faqir` draws inline SVG with `data-series` /
  `data-role` attributes that `public/print.css` fills from tokens.
- **Suggested fix:** a `chart` primitive with exactly these semantics: `data-kind="bar|column|line"`;
  colours, type and rules from custom properties only (no literal colour); value axes
  start at zero for bars and columns; direct labels on marks instead of a legend where
  they fit; series distinguished by lightness and, for lines, dash pattern, so they
  survive greyscale; `role="img"` with an `aria-label` that reads the numbers; and the
  same numbers available as a `table` (a `data-part="data"` table, visually hidden on
  paper). Matrix case: a three-series column chart printed in greyscale keeps three
  distinct lightness bands.

### 37. The font catalogue has no italics

- **Seen:** markdown emphasis in a document comes out as a browser-slanted oblique: the
  catalogue installs `normal` styles only (`…-wght-normal.woff2`, `…-400-normal.woff2`).
- **Where:** `src/fonts/catalog.ts` (the curated list; "a project that needs … a true
  italic is past what a curated list" — line 41).
- **Here:** `font-synthesis: none` on documents, so emphasis stays upright rather than
  fake; strong still works (every weight used is installed).
- **Suggested fix:** offer the italic files for the editorial and document families
  (Plex Sans/Serif, Source Serif 4, Newsreader), opt-in (`--italic`). Matrix case: an
  `<em>` in the report reference embeds a font whose name ends in `-Italic`.

### 38. The print themes name system fonts

- **Seen:** `document`, `editorial-document`, `ink-document` and `swiss-document` set
  `--doc-font: 'Arial', 'Helvetica Neue'`; `document-serif` sets Georgia and Times New
  Roman; the `report` variant forces `--doc-font: Georgia, 'Times New Roman', serif`. The
  same document prints in different faces on Windows and Linux, and with fallback glyphs
  for ș ț on some.
- **Where:** `registry/themes/*-document.css` (`--doc-font`, `--doc-heading-font`,
  `--font-sans`, `--font-mono`); `registry/patterns/document/document.css`, variant `report`.
- **Here:** `public/print.css` re-points `--doc-font`, `--doc-heading-font`, `--font-*`
  per type pairing to self-hosted families, and documents use no pattern variant.
  Preflight's `font-fallback` reads the PDF's font list to prove it.
- **Suggested fix:** print themes default to the project's role families (`var(--font-body)`)
  and name system faces only as fallbacks; the `report` variant reads `--doc-serif` instead
  of a literal. Matrix case: the report reference's PDF embeds only fonts from `fonts.css`.

### 39. The running header repeats on page 1

- **Seen:** in Chromium the `doc-header` is `position: fixed` (no `running()`), so it
  prints on every page, including page 1 above the letterhead.
- **Where:** `registry/patterns/document/document.css`, `@media print` doc-header block.
- **Here:** `[data-report-mask]`, an absolutely positioned strip of paper over the header
  area on page 1 only (`public/print.css`).
- **Suggested fix:** a `data-header="from-page-2"` option on the pattern that ships this
  mask (Chromium) and `@page :first { @top-center { content: none } }` (paged engines).
  Matrix case: the three-page reference shows no header text on page 1.

### 40. Nothing paints in the page margins

- **Seen:** DIN 5008 fold marks (105 mm, 210 mm) and the punch mark (148.5 mm) belong in
  the left margin. An element positioned there is clipped; a root or `@page` background
  is not painted in the margins either.
- **Where:** Chromium's page box; the pattern's geometry assumes all margins are `@page`
  margins (`registry/patterns/document/document.css`).
- **Here:** the renderer sets the left page margin to 0 and `print.css` rebuilds it as
  padding on the document, so marks and the envelope window sit at exact sheet
  coordinates.
- **Suggested fix:** a `letter` variant of the pattern with fold marks, punch mark and a
  Form A/B address window as tokens (`--doc-window-top`, …). Matrix case: a letter
  reference with marks at 105 / 148.5 / 210 mm, measured on the PNG.

### 41. key-value's grid variants misplace grouped pairs

- **Seen:** the manifest allows `dl > div > dt + dd` grouping, but in the horizontal and
  `data-cols` variants the `<div>` is one grid cell, so a list of three grouped pairs lays
  out as two pairs per row; and `data-cols` right-aligns every value.
- **Where:** `registry/primitives/key-value/key-value.css` (`grid-template-columns: auto
  1fr`; `[data-cols] > … [data-part="value"] { text-align: end }`).
- **Here:** `templates/reports/pairs.faqir` writes flat `dt`/`dd`; a grid of single-pair
  vertical lists (`cells.faqir`) draws "label over value" cells; totals use a subgrid row.
- **Suggested fix:** `[data-ui="key-value"] > div:not([data-ui]) { display: contents }` in
  the grid variants (or `grid-column: 1 / -1; display: grid; grid-template-columns:
  subgrid`). Matrix case: an invoice header with grouped pairs aligns label/value columns.

### 42. A table footer repeats on every printed page

- **Seen:** `tfoot` is `display: table-footer-group` in print, which Chromium repeats at
  the foot of every page the table spans — an invoice's "Total" printed on page 1 of 3.
- **Where:** `registry/recipes/table/table.css`, `@media print` (`[data-part="tfoot"]`).
- **Here:** totals are their own block (key-value) after the table; table footer rows are
  a second `tbody`.
- **Suggested fix:** a `data-print-footer="last"` option that sets the tfoot to
  `table-row-group`, documented beside the repeating header. Matrix case: a 60-row
  invoice prints its total once.

### 43. The pattern's `@page` rules become global once bundled

- **Seen:** after `faqir add document` the bundle's `@page` sets every page's margins and
  a "Page N / M" counter, so printing any app page (a submissions table) now carries the
  document's counter and 15 mm margins.
- **Where:** `registry/patterns/document/document.css` (top-level `@page`), copied into
  `ui/faqir.bundle.css` by `faqir bundle`.
- **Here:** nothing; documents override with their own `@page` (#32).
- **Suggested fix:** a named page (`@page faqir-document`) applied by
  `[data-ui="document"] { page: faqir-document }`. Matrix case: a non-document page printed
  with the bundle has no counter.

### 44. The QR encoder stops at version 10 and keeps a two-module quiet zone

- **Seen:** `encodeQR` throws "Data too long for QR versions 1–10" past about 213 bytes at
  ECL M, and only logs a warning: the element stays empty. Its SVG has a 2-module quiet
  zone where ISO/IEC 18004 asks for 4.
- **Where:** `registry/recipes/qr-code/qr-code.js` (`selectVersion`, `matrixToSVG` `quiet = 2`).
- **Here:** preflight's `qr-capacity` finds an empty `qr-code` after the controllers ran;
  print.css pads the element with paper. EPC payloads (≤ 331 bytes by spec) fit in practice.
- **Suggested fix:** versions up to 40, a `data-state="error"` (and an `error` event) when
  encoding fails, and a 4-module quiet zone. Matrix case: a 300-byte payload renders.

### 45. A progress bar's value cannot come from a server template

- **Seen:** `progress`'s fill width is `style="width: {value}%"`; `@faqir-ui/template` refuses
  data in `style` (`unsafe-attr`), rightly, so a server-rendered distribution cannot set it.
- **Where:** `registry/primitives/progress/progress.manifest.json` (`templates.html`).
- **Here:** `templates/reports/blocks/bars.faqir` passes the value through an `l-data`
  island and sets the width with faqir-core's `:style`, so the renderer runs faqir-core
  before printing.
- **Suggested fix:** read the width from `aria-valuenow` with typed `attr()` where supported,
  or `data-value` steps (`data-value="0..100"` in 5 % steps) in pure CSS. Matrix case: a
  printed progress at 40 % without JavaScript.

### 46. `table` is not callable from a template

- **Seen:** `+table` is `unknown-component`: the registry table lists it as unavailable
  ("boolean prop `no-resize` declares an attr but is not a valid prop name").
- **Where:** `registry/recipes/table/table.manifest.json` (prop `no-resize`);
  `@faqir-ui/template/registry` `unavailable`.
- **Here:** document tables are plain canonical markup (`data-ui="table"` …).
- **Suggested fix:** rename the prop `noResize` with `attr: "data-no-resize"`; the
  registry test should fail on any recipe listed as unavailable for a naming reason.

### 47. The running footer and the page counter cannot share a line

- **Seen:** the footer is a fixed element inside the page area and the counter is the
  bottom-right margin box, so "Page 1 of 2" always sits a line below the footer's text.
  Moving the fixed footer into the margin (a negative inset) breaks pagination: Chromium
  moves it to the top of the next page.
- **Where:** `registry/patterns/document/document.css` (doc-footer fixed block and
  `@bottom-right`).
- **Here:** accepted: the counter prints right-aligned just under the footer rule's last line.
- **Suggested fix:** carry the counter inside the footer as a `data-part="page-counter"`
  that paged engines fill and Chromium fills from the margin box, or document the
  composition. Matrix case: footer text and counter on one baseline.

---

## What worked unusually well (do not break)

- **One definition, browser and server.** `@faqir-ui/rules` in the page (`l-rules`) and on
  the server (`coerce` → `validate`) gave the same verdict on every case we tried,
  including hidden fields, wizard steps and form pairs vs JSON. Findings carry `path` and
  `rule`, which became forecraft's 422 problem body with no mapping layer.
- **`renderForm` refuses rather than guesses.** Unknown keys, bad partitions and
  unsupported keywords throw with a path; forecraft turns those messages straight into
  `errors[].pointer` for agents.
- **`faqir theme bundle --scope`.** Thirty-one scoped themes from one command each; a public
  form switches theme with one `data-skin` and one stylesheet, with no build.
- **`@faqir-ui/template`.** Manifest-checked component calls caught wrong parts and
  variants at compile time; `l-data=json(...)` and `data-prop-*` made server data reach
  faqir-core safely; templates compile once and render fast.
- **`faqir audit --stdin --json`.** A stable JSON contract, good messages that name the
  fix ("move it out of the main content flow"), and fast enough to run on every preview.
- **`Faqir.data` + `$ui` + `$dispatch`.** The designer (drag and drop, undo, autosave,
  live preview) is one registered component with no framework; dialogs, tabs, the
  command palette and toasts were driven entirely from expressions.
- **Inherited `--flow-space`.** Setting `data-gap` on an ancestor flow root tuned the
  spacing of markup we could not touch.
