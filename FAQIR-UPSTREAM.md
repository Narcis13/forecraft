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
