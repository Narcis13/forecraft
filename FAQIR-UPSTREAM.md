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

## Primitives

### 8. No skip link

- **Seen:** every page needs a "Skip to content" link that is hidden until focused.
  No primitive, base style or pattern provides it (`site-header` has none).
- **Where:** `registry/base/reset.css`, `registry/patterns/site-header/`.
- **Here:** `public/app.css` styles `body > a[href="#main"]:first-child`.
- **Suggested fix:** a `skip-link` primitive (or a `data-part="skip"` on
  `site-header`), visually hidden until `:focus-visible`, with an a11y test that it
  is the first tab stop.

---

## Themes

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

---

## Forms (continued)

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

## Recipes and primitives

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
