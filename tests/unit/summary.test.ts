import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, type DB } from "../../src/db/index.ts";
import { getFormBySlug, insertSubmission } from "../../src/forms/store.ts";
import { compileReport, dataErrors } from "../../src/reports/model.ts";
import { summarize, SUMMARY_SCHEMA, type Summary, type SummaryQuestion } from "../../src/reports/summary.ts";
import { SEED_FORMS, seedDemo } from "../../src/seed.ts";
import { pulseAnswers } from "../../src/seed-reports.ts";

const KINDS = ["choice", "multi", "boolean", "nps", "number", "text", "date"];
const STARTER = join(import.meta.dirname, "..", "..", "src", "reports", "starters", "survey-summary.json");

// ── One demo workspace, with 120 September answers to the pulse survey ─────

const db: DB = openDb(":memory:");
await seedDemo(db, { quiet: true, password: "x-password-1" });

const pulse = getFormBySlug(db, "customer-pulse")!;
const contact = getFormBySlug(db, "contact")!;
assert.ok(pulse && contact);

function submit(formId: string, version: number, data: Record<string, unknown>, at: string): void {
  const sub = insertSubmission(db, formId, version, data, "test");
  db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run(at, sub.id);
}

// The seed leaves a few submissions stamped with the clock; start from nothing so no date can interfere.
db.prepare("DELETE FROM submissions").run();

const ANSWERS = pulseAnswers(120);
for (const a of ANSWERS) submit(pulse.id, pulse.published_version ?? 1, a.answers, a.at);

const CONTACT = SEED_FORMS.find((f) => f.slug === "contact")!.answers;
CONTACT.forEach((answers, i) => submit(contact.id, contact.published_version ?? 1, answers, `2026-09-${String(10 + i).padStart(2, "0")}T09:00:00.000Z`));

const SEPTEMBER = { since: "2026-09-01", until: "2026-09-30" };
const s: Summary = summarize(db, pulse.id, SEPTEMBER);

const day = (at: string) => at.slice(0, 10);
const share = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);
const question = (name: string): SummaryQuestion => s.questions.find((q) => q.name === name)!;

// ── The fixed shape ─────────────────────────────────────────────────────────

test("the seeded fixture is what the assertions below assume", () => {
  assert.equal(ANSWERS.length, 120);
  assert.ok(ANSWERS.every((a) => a.at >= "2026-09-01" && a.at < "2026-10-01"));
});

test("the summary has exactly the documented keys", () => {
  assert.deepEqual(Object.keys(s).sort(), ["form", "nps", "overTime", "period", "questions", "responses", "verbatims"]);
  assert.deepEqual(Object.keys(s).sort(), Object.keys(SUMMARY_SCHEMA).sort());
});

test("form, period and responses describe what was asked", () => {
  assert.deepEqual(s.form, { id: pulse.id, title: "How was your month with forecraft?", description: s.form.description });
  assert.ok(s.form.description.length > 0);
  assert.deepEqual(s.period, SEPTEMBER);
  const days = ANSWERS.map((a) => day(a.at)).sort();
  assert.deepEqual(s.responses, { total: 120, first: days[0], last: days.at(-1) });
});

test("nps: score is an integer and the three groups add up to those who answered", () => {
  const nps = s.nps!;
  assert.ok(nps);
  assert.ok(Number.isInteger(nps.score));
  assert.ok(nps.score >= -100 && nps.score <= 100);
  assert.equal(nps.promoters + nps.passives + nps.detractors, nps.answered);
  assert.equal(nps.answered, 120);
  assert.equal(nps.question, "How likely are you to recommend forecraft to a colleague?");
});

test("nps agrees with a count made straight from the answers", () => {
  const scores = ANSWERS.map((a) => Number(a.answers.recommend));
  const promoters = scores.filter((n) => n >= 9).length;
  const detractors = scores.filter((n) => n <= 6).length;
  const nps = s.nps!;
  assert.equal(nps.promoters, promoters);
  assert.equal(nps.detractors, detractors);
  assert.equal(nps.passives, scores.length - promoters - detractors);
  assert.equal(nps.score, Math.round(((promoters - detractors) / scores.length) * 100));
});

test("nps groups: three of them, counts match, shares add up to about 100", () => {
  const { groups, promoters, passives, detractors } = s.nps!;
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.count), [promoters, passives, detractors]);
  assert.match(groups[0]!.label, /Promoters/);
  assert.match(groups[1]!.label, /Passives/);
  assert.match(groups[2]!.label, /Detractors/);
  const total = groups.reduce((a, g) => a + g.share, 0);
  assert.ok(Math.abs(total - 100) <= 0.2, `shares add up to ${total}`);
  for (const g of groups) assert.equal(g.share, share(g.count, 120));
});

test("every question has a name, a title, a documented kind and answered + skipped = total", () => {
  assert.ok(s.questions.length > 0);
  for (const q of s.questions) {
    assert.ok(q.name && q.title, JSON.stringify(q));
    assert.ok(KINDS.includes(q.kind), `${q.name}: ${q.kind}`);
    assert.equal(q.answered + q.skipped, s.responses.total, q.name);
    assert.ok(Number.isInteger(q.answered) && q.answered >= 0 && q.skipped >= 0);
  }
});

test("questions come in form order and are classified by what they ask", () => {
  const definition = JSON.parse((db.prepare("SELECT definition FROM forms WHERE id = ?").get(pulse.id) as { definition: string }).definition);
  assert.deepEqual(s.questions.map((q) => q.name), Object.keys(definition.schema.properties));
  assert.deepEqual(s.questions.map((q) => [q.name, q.kind]), [
    ["recommend", "nps"], ["easy", "choice"], ["agents", "choice"], ["features", "multi"], ["next", "choice"], ["comments", "text"],
  ]);
});

test("choice, multi, boolean and nps questions carry options with label, count and share", () => {
  for (const q of s.questions.filter((x) => ["choice", "multi", "boolean", "nps"].includes(x.kind))) {
    assert.ok(q.options && q.options.length > 0, q.name);
    for (const o of q.options) {
      assert.equal(typeof o.label, "string", q.name);
      assert.ok(o.label.length > 0);
      assert.ok(Number.isInteger(o.count) && o.count >= 0);
      assert.equal(o.share, share(o.count, q.answered), `${q.name}/${o.label}`);
      assert.ok(o.share >= 0 && o.share <= 100);
    }
  }
});

test("a choice question's counts add up to those who answered; a multi question's do not need to", () => {
  for (const name of ["recommend", "easy", "agents", "next"]) {
    const q = question(name);
    assert.equal(q.options!.reduce((a, o) => a + o.count, 0), q.answered, name);
  }
  const features = question("features");
  assert.ok(features.options!.reduce((a, o) => a + o.count, 0) >= features.answered);
  assert.ok(features.options!.every((o) => o.count <= features.answered));
});

test("counts agree with the raw answers", () => {
  const recommend = question("recommend");
  assert.equal(recommend.options!.length, 11);
  assert.deepEqual(recommend.options!.map((o) => o.label), ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  for (const o of recommend.options!) assert.equal(o.count, ANSWERS.filter((a) => a.answers.recommend === o.label).length, o.label);

  const features = question("features");
  for (const o of features.options!) assert.equal(o.count, ANSWERS.filter((a) => (a.answers.features as string[] | undefined)?.includes(o.label)).length, o.label);
  assert.equal(features.answered, ANSWERS.filter((a) => (a.answers.features as string[] | undefined)?.length).length);

  const next = question("next");
  assert.equal(next.answered, ANSWERS.filter((a) => a.answers.next !== undefined).length);
  assert.equal(next.skipped, 120 - next.answered);
  assert.ok(next.skipped > 0, "some respondents skipped the optional question");

  const comments = question("comments");
  assert.equal(comments.answered, ANSWERS.filter((a) => typeof a.answers.comments === "string").length);
});

test("multi options are listed most chosen first", () => {
  const counts = question("features").options!.map((o) => o.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

test("the top option is the most chosen one", () => {
  for (const q of s.questions.filter((x) => x.options?.length && x.kind !== "text")) {
    assert.ok(q.top, q.name);
    assert.equal(q.top.count, Math.max(...q.options!.map((o) => o.count)), q.name);
    assert.ok(q.options!.some((o) => o.label === q.top!.label && o.count === q.top!.count));
  }
});

test("scales and the NPS question give mean, min, max and median", () => {
  for (const name of ["easy", "agents"]) {
    const q = question(name);
    assert.ok(q.min! >= 1 && q.max! <= 5, name);
    assert.ok(q.mean! >= q.min! && q.mean! <= q.max!, name);
    assert.ok(q.median! >= q.min! && q.median! <= q.max!, name);
  }
  const nps = question("recommend");
  const scores = ANSWERS.map((a) => Number(a.answers.recommend));
  assert.equal(nps.min, Math.min(...scores));
  assert.equal(nps.max, Math.max(...scores));
  assert.equal(nps.mean, Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10);
  assert.equal(question("features").mean, undefined);
});

test("text questions carry up to six distinct samples, newest first", () => {
  const comments = question("comments");
  const samples = comments.samples!;
  assert.ok(samples.length > 0 && samples.length <= 6);
  assert.equal(new Set(samples.map((x) => x.text)).size, samples.length);
  assert.deepEqual(samples.map((x) => x.at), samples.map((x) => x.at).sort().reverse());
  const written = new Set(ANSWERS.map((a) => a.answers.comments));
  for (const x of samples) {
    assert.ok(written.has(x.text), x.text);
    assert.match(x.at, /^2026-09-\d\d$/);
  }
});

test("verbatims: at most 8, unique texts, newest first, each naming its question", () => {
  assert.ok(s.verbatims.length > 0 && s.verbatims.length <= 8);
  assert.equal(new Set(s.verbatims.map((v) => v.text)).size, s.verbatims.length);
  assert.deepEqual(s.verbatims.map((v) => v.at), s.verbatims.map((v) => v.at).sort().reverse());
  const titles = new Set(s.questions.map((q) => q.title));
  for (const v of s.verbatims) {
    assert.deepEqual(Object.keys(v).sort(), ["at", "question", "text"]);
    assert.ok(titles.has(v.question));
  }
});

test("overTime has one entry per day of a 30-day period, and the counts add up to the total", () => {
  assert.equal(s.overTime.length, 30);
  assert.deepEqual(s.overTime.map((p) => p.label), Array.from({ length: 30 }, (_, i) => String(i + 1)));
  assert.deepEqual(s.overTime.map((p) => p.start), Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`));
  assert.equal(s.overTime.reduce((a, p) => a + p.count, 0), s.responses.total);
  for (const p of s.overTime) assert.equal(p.count, ANSWERS.filter((a) => day(a.at) === p.start).length, p.start);
});

test("the same question asked twice gets the same answer", () => {
  assert.deepEqual(summarize(db, pulse.id, SEPTEMBER), s);
});

// ── Periods ─────────────────────────────────────────────────────────────────

test("a shorter period counts only its own days, both ends included", () => {
  const sub = summarize(db, pulse.id, { since: "2026-09-10", until: "2026-09-19" });
  const inside = ANSWERS.filter((a) => day(a.at) >= "2026-09-10" && day(a.at) <= "2026-09-19");
  assert.ok(inside.length > 0 && inside.length < 120);
  assert.equal(sub.responses.total, inside.length);
  assert.equal(sub.overTime.length, 10);
  assert.equal(sub.overTime.reduce((a, p) => a + p.count, 0), inside.length);
  assert.deepEqual(sub.period, { since: "2026-09-10", until: "2026-09-19" });
  assert.equal(sub.nps!.answered, inside.length);
  for (const q of sub.questions) assert.equal(q.answered + q.skipped, inside.length, q.name);
});

test("one single day is a period of its own", () => {
  const busy = ANSWERS.map((a) => day(a.at)).sort().at(-1)!;
  const sub = summarize(db, pulse.id, { since: busy, until: busy });
  assert.equal(sub.responses.total, ANSWERS.filter((a) => day(a.at) === busy).length);
  assert.equal(sub.overTime.length, 1);
});

test("an unreadable date is ignored, like a missing one", () => {
  const open = summarize(db, pulse.id, { since: "last tuesday", until: "2026-09-30" });
  assert.equal(open.responses.total, 120);
  assert.equal(open.period.since, s.responses.first);
  const all = summarize(db, pulse.id, {});
  assert.equal(all.responses.total, 120);
  assert.deepEqual(all.period, { since: s.responses.first, until: s.responses.last });
});

test("an unknown form is an error", () => {
  assert.throws(() => summarize(db, "frm_nope", SEPTEMBER), /no form frm_nope/);
});

test("overTime is per day up to 31 days, per week beyond, per month beyond 26 weeks", () => {
  const august = summarize(db, pulse.id, { since: "2026-08-01", until: "2026-08-31" });
  assert.equal(august.overTime.length, 31);
  assert.equal(august.overTime[0]!.label, "1");

  const thirtyTwoDays = summarize(db, pulse.id, { since: "2026-08-31", until: "2026-10-01" });
  assert.ok(thirtyTwoDays.overTime.length <= 6, "weeks, not days");
  assert.ok(thirtyTwoDays.overTime.every((p) => new Date(`${p.start}T00:00:00Z`).getUTCDay() === 1), "weeks start on a Monday");
  assert.equal(thirtyTwoDays.overTime.reduce((a, p) => a + p.count, 0), 120);

  const quarter = summarize(db, pulse.id, { since: "2026-07-01", until: "2026-09-30" });
  assert.equal(quarter.overTime.reduce((a, p) => a + p.count, 0), 120);
  assert.ok(quarter.overTime.length > 10 && quarter.overTime.length < 20);

  const year = summarize(db, pulse.id, { since: "2026-01-01", until: "2026-12-31" });
  assert.equal(year.overTime.length, 12);
  assert.deepEqual(year.overTime.map((p) => p.label).slice(0, 3), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(year.overTime.find((p) => p.label === "2026-09")!.count, 120);
});

// ── Nothing to summarise ────────────────────────────────────────────────────

test("an empty period has total 0 and an NPS that nobody answered", () => {
  const e = summarize(db, pulse.id, { since: "2026-08-01", until: "2026-08-31" });
  assert.equal(e.responses.total, 0);
  assert.deepEqual(e.responses, { total: 0, first: "2026-08-01", last: "2026-08-31" });
  assert.ok(e.nps);
  assert.equal(e.nps.answered, 0);
  assert.equal(e.nps.score, 0);
  assert.deepEqual([e.nps.promoters, e.nps.passives, e.nps.detractors], [0, 0, 0]);
  assert.deepEqual(e.nps.groups.map((g) => [g.count, g.share]), [[0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(e.verbatims, []);
  assert.equal(e.overTime.length, 31);
  assert.ok(e.overTime.every((p) => p.count === 0));
  for (const q of e.questions) {
    assert.equal(q.answered, 0, q.name);
    assert.equal(q.skipped, 0, q.name);
    assert.ok(Number.isFinite(q.options?.[0]?.share ?? 0));
    assert.ok((q.options ?? []).every((o) => o.count === 0 && o.share === 0), q.name);
    assert.equal(q.mean, undefined, q.name);
  }
  assert.deepEqual(e.questions.find((q) => q.kind === "text")!.samples, []);
});

test("with no answers there is no 'most chosen' option to name", () => {
  const e = summarize(db, pulse.id, { since: "2026-08-01", until: "2026-08-31" });
  for (const q of e.questions.filter((x) => x.options?.length)) assert.equal(q.top, undefined, q.name);
});

test("a form without an NPS question has nps null", () => {
  const c = summarize(db, contact.id, SEPTEMBER);
  assert.equal(c.nps, null);
  assert.equal(c.responses.total, CONTACT.length);
  assert.ok(c.questions.length > 0);
  assert.deepEqual(new Set(c.questions.map((q) => q.kind)), new Set(["text", "choice", "boolean"]));
  for (const q of c.questions) assert.equal(q.answered + q.skipped, CONTACT.length, q.name);
});

test("a form with no submissions and no period has nothing to chart", () => {
  db.prepare("DELETE FROM submissions WHERE form_id = ?").run(contact.id);
  const c = summarize(db, contact.id, {});
  assert.equal(c.nps, null);
  assert.deepEqual(c.responses, { total: 0, first: "", last: "" });
  assert.deepEqual(c.overTime, []);
  assert.deepEqual(c.verbatims, []);
  const inSeptember = summarize(db, contact.id, SEPTEMBER);
  assert.equal(inSeptember.nps, null);
  assert.equal(inSeptember.responses.total, 0);
});

// ── The summary meets its report's schema ───────────────────────────────────

const starter = JSON.parse(readFileSync(STARTER, "utf8"));
const rules = compileReport(starter).rules;

test("the survey-summary starter's schema declares exactly the summary's top-level parts", () => {
  assert.deepEqual(Object.keys(starter.schema.properties).sort(), Object.keys(SUMMARY_SCHEMA).sort());
  assert.deepEqual(starter.source.kind, "summary");
});

test("a summary validates against the survey-summary starter's schema", () => {
  assert.deepEqual(dataErrors(rules, s as unknown as Record<string, unknown>), []);
});

test("so do an empty one and one without NPS", () => {
  const empty = summarize(db, pulse.id, { since: "2026-08-01", until: "2026-08-31" });
  assert.deepEqual(dataErrors(rules, empty as unknown as Record<string, unknown>), []);
  const noNps = summarize(db, contact.id, SEPTEMBER);
  assert.equal(noNps.nps, null);
  assert.deepEqual(dataErrors(rules, noNps as unknown as Record<string, unknown>), []);
  const week = summarize(db, pulse.id, { since: "2026-07-01", until: "2026-09-30" });
  assert.deepEqual(dataErrors(rules, week as unknown as Record<string, unknown>), []);
});

test("the schema check is not vacuous: a wrong type is reported at its pointer", () => {
  const broken = { ...s, responses: { ...s.responses, total: "many" }, overTime: [{ label: "1", start: "2026-09-01", count: 1.5 }] };
  const pointers = dataErrors(rules, broken as unknown as Record<string, unknown>).map((e) => e.pointer);
  assert.ok(pointers.includes("/responses/total"), JSON.stringify(pointers));
  assert.ok(pointers.includes("/overTime/0/count"), JSON.stringify(pointers));
});

test("the starter compiles with the sample, and its sample has the summary's shape", () => {
  const sample = starter.sample as Record<string, unknown>;
  assert.deepEqual(Object.keys(sample).sort(), Object.keys(s).sort());
});
