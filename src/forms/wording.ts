// The sentences a visitor reads when an answer is refused — one table for both
// sides. The server words a rejected submission with it (`wordFinding`), and
// the public page hands it to public/form.js, which puts the same sentences on
// the browser's own checks (`data-error-*`), so a field refused in the browser
// and the same field refused by the server say the same thing.

import { DEFAULT_MESSAGES, interpolate } from "@faqir-ui/rules";

export const WORDING = {
  required: "This field is required.",
  email: "Enter a valid email address.",
  uri: "Enter a full web address, starting with https://.",
  date: "Enter a valid date.",
  /** A typed date the page could not read; {example} is today in the visitor's format. */
  dateTyped: "Enter a date like {example}.",
  dateMin: "Choose a date on or after {limit}.",
  dateMax: "Choose a date on or before {limit}.",
  number: "Enter a number.",
  integer: "Enter a whole number.",
  minimum: "Enter {limit} or more.",
  maximum: "Enter {limit} or less.",
  exclusiveMinimum: "Enter more than {limit}.",
  exclusiveMaximum: "Enter less than {limit}.",
  multipleOf: "Enter a multiple of {multipleOf}.",
  minLength: "Use at least {limit} characters.",
  maxLength: "Use at most {limit} characters.",
  pattern: "Check the format of this answer.",
  enum: "Choose one of the options.",
  minItems: "Give at least {limit}.",
  maxItems: "Give at most {limit}.",
  uniqueItems: "Remove the repeated answer.",
  type: "Enter a valid value.",
} as const;

export type Wording = typeof WORDING;

interface Finding { rule: string; message: string; params?: Record<string, unknown> }

/**
 * A finding's sentence in forecraft's words. A message the form's author wrote
 * (the definition's `messages`, a rule's own `message`) is theirs and is kept;
 * only the package's generic English default is replaced.
 */
export function wordFinding(f: Finding): string {
  const builtin = (DEFAULT_MESSAGES as Record<string, string>)[f.rule];
  if (builtin === undefined || f.message !== builtin) return f.message;
  const p = f.params ?? {};
  if (f.rule === "format") {
    const own = { email: WORDING.email, uri: WORDING.uri, date: WORDING.date }[String(p.format)];
    return own ?? f.message;
  }
  if (f.rule === "type") return p.type === "integer" ? WORDING.integer : p.type === "number" ? WORDING.number : WORDING.type;
  const own = (WORDING as Record<string, string>)[f.rule];
  return own === undefined ? f.message : interpolate(own, p);
}
