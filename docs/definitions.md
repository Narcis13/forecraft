# Form definitions

A form is one JSON document with four keys. The API accepts and returns it, the designer edits it, and the public page renders it. There is no second representation.

```json
{
  "schema": { "…": "JSON Schema: the data" },
  "ui": { "…": "UI schema: widgets, groups, wizard steps" },
  "rules": { "…": "cross-field logic: show, require, validate, compute, jump" },
  "appearance": { "…": "theme, accent, scheme, layout, cover, submit label, thank-you, redirect" }
}
```

Only `schema` is required. Any other top-level key is rejected with a `422` that points at it.

## A complete example

```json
{
  "schema": {
    "title": "Book a demo",
    "description": "Thirty minutes with someone who builds forecraft.",
    "type": "object",
    "properties": {
      "name": { "type": "string", "title": "Your name", "minLength": 2 },
      "email": { "type": "string", "format": "email", "title": "Work email" },
      "team": { "type": "string", "title": "Team size", "enum": ["Just me", "2–10", "11–50", "51–200", "More"] },
      "agents": {
        "type": "array",
        "title": "Which agents do you run?",
        "items": { "type": "string", "enum": ["Claude", "GPT", "Gemini", "Our own"] },
        "uniqueItems": true
      },
      "date": { "type": "string", "format": "date", "title": "Preferred day" },
      "notes": { "type": "string", "title": "Anything we should know?", "maxLength": 1000 }
    },
    "required": ["name", "email", "team"]
  },
  "ui": {
    "notes": { "widget": "textarea", "rows": 4, "placeholder": "We want our agent to…" },
    "ui:groups": [
      { "title": "About you", "fields": ["name", "email", "team"] },
      { "title": "The call", "fields": ["agents", "date", "notes"] }
    ]
  },
  "rules": {
    "rules": [
      { "id": "notes-for-big-teams", "require": "notes", "when": { "in": [{ "var": "team" }, ["51–200", "More"]] } }
    ]
  },
  "appearance": {
    "theme": "nordic",
    "accent": "blue",
    "layout": "split",
    "cover": { "image": "", "eyebrow": "Demo · 30 minutes" },
    "submitLabel": "Book the call",
    "thankYou": { "title": "Booked", "message": "A calendar invite is on its way." }
  }
}
```

## `schema`

A JSON Schema whose root is `"type": "object"`. The root `title` is the form's title and is required; the root `description` is shown under it. The form renders the subset below and rejects anything else with an error that names the path, so nothing is silently dropped.

| Schema | Renders as |
|---|---|
| `string` | text input |
| `string` + `format: "email"` / `"uri"` | email / URL input |
| `string` + `format: "date"` | date picker |
| `string` + `enum` (1–4 values) | radio group |
| `string` + `enum` (5 or more) | select |
| `number` / `integer` | number input (`minimum`, `maximum`, `multipleOf`) |
| `boolean` | checkbox (or a switch with `"widget": "switch"`) |
| `array` of `enum` strings (1–4 / 5 or more) | checkbox group / multi-select |
| `array` of `object` | repeatable group with add and remove buttons (`minItems`, `maxItems`) |
| nested `object` | a fieldset card |

Per field you may use `title`, `description`, `default`, `examples` (the first becomes the placeholder), `const`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum` and `multipleOf`. A top-level `required` array marks required fields; a nested object has its own.

A date field (`format: "date"`) may also carry `formatMinimum` and `formatMaximum`, the earliest and latest date as `YYYY-MM-DD`. The browser and the server both refuse a date outside them.

Conditional keywords are understood and become rules: `if` / `then` / `else` (and `allOf` of them) decide which fields are shown and required, and `dependentRequired` requires fields once a trigger is filled in. See [rules](/docs/rules).

## `ui`

Mirrors the schema: a key per field, with these options.

| Key | For | Example |
|---|---|---|
| `widget` | any field | `"textarea"`, `"switch"`, `"radio"`, `"select"`, `"checkbox-group"`, `"multi-select"`, `"date-picker"`, `"scale"` |
| `placeholder` | inputs, textareas | `"We are launching…"` |
| `rows` | a textarea | `6` |
| `enumLabels` | enums | `["Conference — €390", "Remote — €90"]` (one label per value) |
| `width` | scalars and enum arrays | `"full"`, `"half"`, `"third"` — multi-column from the tablet tier up |
| `orientation` | radio / checkbox-group | `"vertical"` (default) or `"horizontal"` |
| `minLabel`, `maxLabel` | `scale` widget | captions under the first and last choice |
| `addLabel`, `removeLabel`, `items` | repeatable groups | `"Add another role"`; `items` is per-column UI (including `width`) |
| `prefix`, `suffix` | `number` / `integer` | `"€"`, `"seats"` — a unit shown inside the input (at most 12 characters) |
| `verbatim` | a long-text field (`"widget": "textarea"`) | `true` lets a survey summary quote its answers word for word |

Two root keys arrange the top-level fields. Use one or the other; every field must appear exactly once.

- `"ui:groups": [{ "title", "description?", "fields": [...] }]` puts fields in titled sections.
- `"ui:wizard": { "label", "steps": [{ "title", "description?", "fields": [...], "when?" }] }` makes a multi-step form. A step's `when` (a rules condition) skips that step when it does not hold; the first and last steps cannot have one.

## `rules`

A [`@faqir-ui/rules`](/docs/rules) definition: `{ "rules": [...], "messages"?: {...}, "defaultLocale"?: "en" }`. The field map is derived from the schema, so you only write what the schema cannot say. The browser enforces it as people type; the server re-checks it on every submission.

## `appearance`

Every key is optional; the defaults are shown.

| Key | Default | Values |
|---|---|---|
| `theme` | `"default"` | one of the 31 themes below |
| `accent` | `"theme"` | `theme`, `rose`, `red`, `orange`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink` (Faqir `data-accent` hues) |
| `scheme` | `"auto"` | `auto` (follows the device), `light`, `dark` |
| `layout` | `"card"` | `card`, `split` (cover beside the form), `page` |
| `cover` | `null` | `{ "image": "https://…" or "/path" or "", "eyebrow": "…" }` |
| `submitLabel` | `"Submit"` | any short text |
| `thankYou` | `{ "title": "Thank you!", "message": "Your answers are in. You can close this page." }` | `{ title, message }` |
| `redirect` | `null` | an `http(s)` URL to send people to after submitting |

The 31 themes: `aurora`, `brutalist`, `candy`, `clay`, `clinical`, `contrast`, `deco`, `default`, `document`, `document-serif`, `editorial`, `editorial-document`, `fintech`, `glass`, `ink`, `ink-document`, `luxe`, `memphis`, `midnight`, `monolith`, `neo`, `neumorph`, `nordic`, `organic`, `paper`, `slate`, `soft`, `sunset`, `swiss`, `swiss-document`, `terminal`. `GET /api/v1/vocabulary` returns the current list, the accents, the layouts and the appearance defaults.

## Drafts, versions and slugs

- Creating or patching a form changes its **draft**. `has_unpublished_changes` says whether the draft differs from what is live.
- `POST /api/v1/forms/:id/publish` snapshots the draft as the next **version**. The public URL `/f/<slug>` always serves the latest published version, and every submission records the version it was made against.
- A **slug** is 3–64 characters of lowercase letters, digits and dashes. Leave it out and one is made from the title, and until the form is first published it follows the title: retitle "Untitled form" to "Workshop orders" and `untitled-form-088f77` becomes `workshop-orders-088f77`. A slug you chose, and the slug of a published form, never change on their own.

## Errors in a definition

A definition that cannot be rendered is a `422` problem whose `errors` say where:

```json
{
  "type": "https://forecraft.dev/problems/invalid-definition",
  "title": "Invalid form definition",
  "status": 422,
  "errors": [{ "pointer": "/schema", "detail": "unsupported type \"strin\" at jsonSchema.properties.age.type." }]
}
```

Fix the path the pointer names and send it again. `POST /api/v1/preview` checks a definition without creating anything.
