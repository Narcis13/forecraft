# Rules

Rules say what a schema cannot: which fields are on screen, which are required today, what must agree with what, which values are derived, and which wizard step comes next. They live in the definition's `rules` key, run in the browser as people type, and run again on the server before a submission is stored. Same definition, same evaluator, same verdict.

```json
{ "rules": [ { "id": "…", "show": "field", "when": { … } } ], "messages": { "en": { … } } }
```

Every rule has a unique `id` and exactly one verb. A rule that would quietly do nothing (no `id`, two verbs, a `show` with no `when`, a path that is not a field) is rejected when the form is created, with a `422` that points at it.

## The verbs

| Verb | Shape | Effect |
|---|---|---|
| `show` | `{ id, show: "field", when }` | the field is on screen only while `when` holds; a hidden field is never required and its value is dropped |
| `require` | `{ id, require: "field", when }` | the field must be filled in while `when` holds |
| `validate` | `{ id, validate: <logic>, path: "field", message }` | a finding on `path` when the logic is false |
| `compute` | `{ id, compute: "field", value: <logic> }` | the field's value is derived, in the browser and on the server |
| `jump` | `{ id, jump: "step", from: "step", when }` | a wizard's next step |

Several `show` rules on one field must all hold; several `require` rules need only one. `validate` rules skip a blank field, because `required` is the rule that should complain about that.

## One form, four verbs

A workshop order: companies must give a VAT number, the total is computed, and the last day cannot come before the first.

```json
{
  "schema": {
    "title": "Workshop order",
    "type": "object",
    "properties": {
      "kind": { "type": "string", "title": "Who is buying?", "enum": ["Person", "Company"] },
      "company": { "type": "string", "title": "Company name" },
      "vat": { "type": "string", "title": "VAT number" },
      "seats": { "type": "integer", "title": "Seats", "minimum": 1, "maximum": 40 },
      "total": { "type": "number", "title": "Total (€)" },
      "starts": { "type": "string", "format": "date", "title": "First day" },
      "ends": { "type": "string", "format": "date", "title": "Last day" }
    },
    "required": ["kind", "seats", "starts", "ends"]
  },
  "rules": {
    "rules": [
      { "id": "company-shown", "show": "company", "when": { "==": [{ "var": "kind" }, "Company"] } },
      { "id": "vat-shown", "show": "vat", "when": { "==": [{ "var": "kind" }, "Company"] } },
      { "id": "vat-required", "require": "vat", "when": { "==": [{ "var": "kind" }, "Company"] } },
      { "id": "total", "compute": "total", "value": { "*": [{ "var": "seats" }, 120] } },
      { "id": "ends-after-starts", "validate": { "date": [{ "var": "starts" }, "<=", { "var": "ends" }] },
        "path": "ends", "message": "The last day cannot be before the first." }
    ],
    "messages": { "en": { "vat.required": "Companies need a VAT number for the invoice." } }
  }
}
```

Submitted as a company with no VAT number and the days the wrong way round, the server answers:

```json
{
  "type": "https://forecraft.dev/problems/invalid-submission",
  "title": "The submission breaks the form's rules",
  "status": 422,
  "errors": [
    { "pointer": "/vat", "field": "vat", "rule": "required", "detail": "Companies need a VAT number for the invoice." },
    { "pointer": "/ends", "field": "ends", "rule": "ends-after-starts", "detail": "The last day cannot be before the first." }
  ]
}
```

A broken shape constraint reports the constraint (`required`, `minimum`, `format`, …) as its `rule`; a broken `validate` rule reports the rule's `id`. As a person, the same answers are refused in the browser before anything is sent, with the same sentences. A person buying for themselves never sees `company` or `vat`, and if a value for them arrives anyway it is dropped, not stored. `total` is stored as `seats × 120` whatever the client sent.

## Conditions

Conditions and computed values are JSONLogic. The useful subset:

| Family | Operators |
|---|---|
| data | `var`, `missing`, `missing_some` |
| logic | `if`, `and`, `or`, `!`, `!!` |
| compare | `==`, `===`, `!=`, `!==`, `<`, `<=`, `>`, `>=` |
| arithmetic | `+`, `-`, `*`, `/`, `%`, `min`, `max` |
| strings and lists | `cat`, `substr`, `in`, `some`, `all`, `none` |
| forecraft extras | `date` (compare ISO dates), `regex` (a literal pattern) |

```json
{ "in": [{ "var": "team" }, ["51–200", "More"]] }
{ "and": [{ "==": [{ "var": "plan" }, "Team"] }, { ">": [{ "var": "seats" }, 10] }] }
{ "date": [{ "var": "starts" }, "<=", { "var": "ends" }] }
{ "regex": ["^[A-Z]{2}\\d{9}$", { "var": "vat" }] }
```

`==` is loose, which is what form data wants (`"5" == 5`); use `===` when it is not. An unknown operator is an error, never a silent `null`.

## Messages

`messages[locale]` overrides any sentence. Keys are tried as `"<field>.<rule>"`, then `"<rule>"`, so one field can be special without restating the rest. `{limit}`, `{actual}`, `{title}` and `{path}` are filled in from the finding.

```json
{ "messages": { "en": { "required": "Please fill this in.", "seats.maximum": "We can seat {limit} at most." } } }
```

## Rules the schema already implies

You do not have to write rules for what JSON Schema can say. These become rules automatically, with stable ids:

- `if` / `then` / `else` with `const` or `enum` tests: `then.properties` are shown and `then.required` required while the condition holds; `else` takes the opposite. A branch decides visibility only; a constraint inside it is an error (write a `validate` rule).
- `dependentRequired: { "card": ["city"] }`: `city` is required once `card` is filled in.
- A wizard step with `when` (in `ui:wizard`): the step is skipped when the condition does not hold, and its fields are hidden so the server never demands them.

```json
{
  "schema": {
    "title": "Checkout",
    "type": "object",
    "properties": {
      "plan": { "type": "string", "title": "Plan", "enum": ["Free", "Paid"] },
      "invoice": { "type": "string", "format": "email", "title": "Invoice email" },
      "card": { "type": "string", "title": "Card reference" },
      "city": { "type": "string", "title": "Billing city" }
    },
    "required": ["plan"],
    "if": { "properties": { "plan": { "const": "Paid" } } },
    "then": { "properties": { "invoice": {} }, "required": ["invoice"] },
    "dependentRequired": { "card": ["city"] }
  }
}
```

## Wizards and `jump`

In a `ui:wizard`, give a step a `when` and forecraft writes the `jump` for you. Steps are numbered from `"0"`.

```json
{
  "schema": {
    "title": "Summit registration",
    "type": "object",
    "properties": {
      "mode": { "type": "string", "title": "How are you joining?", "enum": ["In person", "Remote"] },
      "hotel": { "type": "boolean", "title": "Book me a hotel" },
      "nights": { "type": "integer", "title": "Nights", "minimum": 1, "maximum": 5 },
      "name": { "type": "string", "title": "Name on the badge" }
    },
    "required": ["mode", "name"]
  },
  "ui": {
    "ui:wizard": {
      "label": "Registration steps",
      "steps": [
        { "title": "Mode", "fields": ["mode"] },
        { "title": "Stay", "fields": ["hotel", "nights"], "when": { "==": [{ "var": "mode" }, "In person"] } },
        { "title": "You", "fields": ["name"] }
      ]
    }
  }
}
```

Remote attendees go from step 0 straight to step 2, and the server does not ask them about a hotel.

## Check a submission without storing it

`POST /api/v1/forms/:id/validate` with `{ "data": { … } }` returns the verdict against the draft (`valid`, `findings`, and the cleaned `data`) and stores nothing. `POST /api/v1/forms/:id/preview` returns the compiled `rules` the page will carry.
