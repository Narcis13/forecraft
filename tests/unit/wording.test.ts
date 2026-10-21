import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MESSAGES } from "@faqir-ui/rules";
import { wordFinding } from "../../src/forms/wording.ts";

test("the package's defaults become forecraft's sentences", () => {
  assert.equal(wordFinding({ rule: "format", message: DEFAULT_MESSAGES.format, params: { format: "email" } }), "Enter a valid email address.");
  assert.equal(wordFinding({ rule: "type", message: DEFAULT_MESSAGES.type, params: { type: "integer" } }), "Enter a whole number.");
  assert.equal(wordFinding({ rule: "minimum", message: DEFAULT_MESSAGES.minimum, params: { limit: 2 } }), "Enter 2 or more.");
  assert.equal(wordFinding({ rule: "required", message: DEFAULT_MESSAGES.required }), "This field is required.");
});

test("an author's own sentence, and a rule's, are kept", () => {
  assert.equal(wordFinding({ rule: "required", message: "We need your VAT number." }), "We need your VAT number.");
  assert.equal(wordFinding({ rule: "ends-after-starts", message: "The last day cannot be before the first." }), "The last day cannot be before the first.");
});
