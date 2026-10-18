# Faqir digest — what forecraft would fix first

The ten entries of [`FAQIR-UPSTREAM.md`](../FAQIR-UPSTREAM.md) most worth fixing in the
next Faqir release, ordered by how much they hurt forecraft × how general they are.
Each links its entry number.

1. **#28 — Auto-start can boot between deferred scripts and silently drop `l-rules`.**
   Rules (hide, require) were simply not applied in ~4 of 6 page loads, with no warning.
   Fix: no `setTimeout` boot for classic scripts; warn when a directive arrives after boot.
2. **#29 — The date-picker's named input holds display text.**
   `FormData` and native submits send "October 15, 2026", which the schema's own `format: date` rejects.
   Fix: visible input unnamed, ISO value in a hidden named input.
3. **#1 — The rules definition a form carries is only available inside its HTML.**
   Every server that re-validates must render and regex the script element back out.
   Fix: export `rulesFor(schema, ui, opts)` (or return `{ html, rules }`).
4. **#3 / #4 — Two submit shapes and no shared hook; wizard answers vanish from `FormData`.**
   Single-page and wizard forms need different SPA-submit code, and the data reader that copes with disabled steps is private.
   Fix: one `faqir:valid-submit` event carrying the coerced data.
5. **#16 — Generated forms have the wrong rhythm.**
   Section-sized gaps between top-level fields, none inside group and step cards; every form needs CSS.
   Fix: `data-gap` on the form and a flow root in card bodies.
6. **#14 — `renderForm` emits `data-ui="checkbox-group"`, unknown to the registry.**
   The renderer's own output fails the audit it is meant to pass.
   Fix: a `checkbox-group` in the checkbox primitive; audit the forms drift fixtures.
7. **#2 — A single-page form has no submit button.**
   Every page must add one outside the form with `form="…"`.
   Fix: emit a footer with `i18n.submitLabel`, opt-out via option.
8. **#7 — No programmatic audit in any npm package.**
   An agent-facing preview spawns the CLI per call (~1 s).
   Fix: publish `auditHtml()` (the MCP tool's code) as a package export.
9. **#17 — No scale or rating input; `radio-group` cannot go horizontal.**
   Surveys (NPS, Likert) are the commonest forms and look like lists.
   Fix: `data-orientation` on radio/checkbox groups and a `scale` widget.
10. **#11 — `alert-dialog` requires a trigger, which forces it inside `<main>`.**
    Row-level destructive confirmations cannot use it without a landmark warning.
    Fix: make the trigger optional, as `dialog` already does.

Close behind: #9 (runtime accent), #15 (date-picker dialog in `<main>`), #27 (fieldset
card legend), #13 (command-palette item targets), #18 (synthesised bold for one-weight
heading fonts).
