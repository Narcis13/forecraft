import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { newId, now, openDb, transaction, type DB } from "../../src/db/index.ts";
import { checkPattern, formatNumber, nextNumber, periodOf } from "../../src/reports/numbering.ts";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const failsWith = (status: number) => (err: unknown) => (err as { status?: number }).status === status;

/** A workspace and a report in a fresh database; `file` defaults to memory. */
function setup(file = ":memory:") {
  const db = openDb(file);
  const workspaceId = newId("wsp");
  db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, 'Test', ?)").run(workspaceId, now());
  return { db, workspaceId, reportId: addReport(db, workspaceId) };
}

function addReport(db: DB, workspaceId: string): string {
  const id = newId("rep");
  db.prepare("INSERT INTO reports (id, workspace_id, definition, created_at, updated_at) VALUES (?, ?, '{}', ?, ?)").run(id, workspaceId, now(), now());
  return id;
}

function addDocument(db: DB, workspaceId: string, reportId: string, number: string | null) {
  db.prepare(
    `INSERT INTO documents (id, workspace_id, report_id, version, status, number, data, locale, share_token, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'issued', ?, '{}', 'en', ?, ?, ?)`,
  ).run(newId("doc"), workspaceId, reportId, number, newId("shr"), now(), now());
}

const issue = (db: DB, reportId: string, pattern: string, date: Date) =>
  transaction(db, () => nextNumber(db, reportId, { pattern }, date));

test("checkPattern accepts the documented tokens and plain text", () => {
  for (const pattern of ["INV-{YYYY}-{seq:4}", "{seq}", "R{YY}/{MM}/{seq:9}", "A B_c.1-{seq:1}", "{YYYY}{MM}-{seq:6}", "Nr. {seq}"]) {
    assert.equal(checkPattern(pattern), null, pattern);
  }
});

test("checkPattern refuses a missing or doubled sequence", () => {
  for (const pattern of ["", "INV-2026", "INV-{YYYY}", "{seq}-{seq:3}", "{seq:2}{seq:2}"]) {
    assert.equal(typeof checkPattern(pattern), "string", pattern);
  }
});

test("checkPattern refuses unknown tokens, bad pads and bad characters", () => {
  for (const pattern of ["{DD}-{seq}", "{seq}{foo}", "{seq:0}", "{seq:10}", "<{seq}", "{seq}#", "{seq}\n", "A;B-{seq}", "{seq}>"]) {
    assert.equal(typeof checkPattern(pattern), "string", JSON.stringify(pattern));
  }
});

test("formatNumber fills the tokens", () => {
  const march = day(2026, 3, 5);
  assert.equal(formatNumber("INV-{YYYY}-{seq:4}", 42, march), "INV-2026-0042");
  assert.equal(formatNumber("{YY}/{MM}/{seq}", 7, march), "26/03/7");
  assert.equal(formatNumber("R{YYYY}{MM}-{seq:3}", 7, day(2026, 12, 31)), "R202612-007");
  assert.equal(formatNumber("{seq}", 42, march), "42");
  assert.equal(formatNumber("No. {seq:2}", 5, march), "No. 05");
});

test("formatNumber never truncates a sequence longer than its pad", () => {
  assert.equal(formatNumber("INV-{seq:4}", 12345, day(2026, 1, 1)), "INV-12345");
  assert.equal(formatNumber("INV-{seq:4}", 1000, day(2026, 1, 1)), "INV-1000");
});

test("formatNumber and periodOf read the date in UTC", () => {
  // 2027-01-01 00:30 at +02:00 is still 2026-12-31 22:30 UTC.
  const edge = new Date("2027-01-01T00:30:00+02:00");
  assert.equal(formatNumber("{YYYY}-{MM}-{seq}", 1, edge), "2026-12-1");
  assert.equal(periodOf("{YYYY}-{seq}", edge), "2026");
});

test("periodOf is the year when the pattern has one, and empty otherwise", () => {
  const date = day(2026, 3, 5);
  assert.equal(periodOf("INV-{YYYY}-{seq:4}", date), "2026");
  assert.equal(periodOf("{YY}-{seq}", date), "2026");
  assert.equal(periodOf("{seq}", date), "");
  assert.equal(periodOf("R{MM}-{seq}", date), "");
});

test("the sequence resets every year and carries on per year", () => {
  const { db, reportId } = setup();
  const pattern = "INV-{YYYY}-{seq:4}";
  assert.equal(issue(db, reportId, pattern, day(2026, 3, 5)), "INV-2026-0001");
  assert.equal(issue(db, reportId, pattern, day(2026, 3, 6)), "INV-2026-0002");
  assert.equal(issue(db, reportId, pattern, day(2027, 1, 2)), "INV-2027-0001");
  assert.equal(issue(db, reportId, pattern, day(2026, 12, 30)), "INV-2026-0003");
  const rows = db.prepare("SELECT period, last FROM report_sequences WHERE report_id = ? ORDER BY period").all(reportId);
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ period: "2026", last: 3 }, { period: "2027", last: 1 }]);
  db.close();
});

test("a pattern without a year never resets, not even by month", () => {
  const { db, reportId } = setup();
  const pattern = "N{MM}-{seq}";
  assert.equal(issue(db, reportId, pattern, day(2026, 1, 15)), "N01-1");
  assert.equal(issue(db, reportId, pattern, day(2026, 2, 15)), "N02-2");
  assert.equal(issue(db, reportId, pattern, day(2027, 1, 15)), "N01-3");
  const rows = db.prepare("SELECT period, last FROM report_sequences WHERE report_id = ?").all(reportId);
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ period: "", last: 3 }]);
  db.close();
});

test("each report counts on its own", () => {
  const { db, workspaceId, reportId } = setup();
  const other = addReport(db, workspaceId);
  assert.equal(issue(db, reportId, "{seq:3}", day(2026, 1, 1)), "001");
  assert.equal(issue(db, reportId, "{seq:3}", day(2026, 1, 1)), "002");
  assert.equal(issue(db, other, "{seq:3}", day(2026, 1, 1)), "001");
  db.close();
});

test("a manual number is trimmed and must be unique within its report", () => {
  const { db, workspaceId, reportId } = setup();
  const manual = (value: string | null | undefined, id = reportId) => transaction(db, () => nextNumber(db, id, { manual: true }, day(2026, 1, 1), value));
  addDocument(db, workspaceId, reportId, "A-1");
  assert.throws(() => manual("A-1"), failsWith(409));
  assert.throws(() => manual("  A-1  "), failsWith(409));
  assert.equal(manual("A-2"), "A-2");
  assert.equal(manual("  A-3 "), "A-3");
  // Another report may use the same number.
  assert.equal(manual("A-1", addReport(db, workspaceId)), "A-1");
  db.close();
});

test("a manual number cannot be empty", () => {
  const { db, reportId } = setup();
  const manual = (value?: string | null) => transaction(db, () => nextNumber(db, reportId, { manual: true }, day(2026, 1, 1), value));
  assert.throws(() => manual(""), failsWith(422));
  assert.throws(() => manual("   "), failsWith(422));
  assert.throws(() => manual(null), failsWith(422));
  assert.throws(() => manual(), failsWith(422));
  db.close();
});

test("a pattern ignores a manual number", () => {
  const { db, reportId } = setup();
  const number = transaction(db, () => nextNumber(db, reportId, { pattern: "INV-{seq:2}" }, day(2026, 1, 1), "MINE-7"));
  assert.equal(number, "INV-01");
  db.close();
});

test("numbers stay gapless and unique with four connections issuing at once", { timeout: 120_000 }, async () => {
  const WORKERS = 4;
  const EACH = 25;
  const pattern = "INV-{YYYY}-{seq:4}";
  const dir = mkdtempSync(join(tmpdir(), "forecraft-numbering-"));
  const file = join(dir, "numbering.db");
  const { db, workspaceId, reportId } = setup(file); // migrates, so the workers only connect
  try {
    const gate = new Int32Array(new SharedArrayBuffer(4));
    const workers = Array.from({ length: WORKERS }, () => {
      const worker = new Worker(new URL("./numbering.worker.ts", import.meta.url), {
        workerData: { file, workspaceId, reportId, pattern, count: EACH, gate },
      });
      let connected!: () => void;
      const ready = new Promise<void>((resolve) => (connected = resolve));
      const done = new Promise<string[]>((resolve, reject) => {
        worker.on("message", (m: { ready?: boolean; numbers?: string[] }) => (m.ready ? connected() : resolve(m.numbers!)));
        worker.on("error", reject);
        worker.on("exit", (code) => code !== 0 && reject(new Error(`worker exited with ${code}`)));
      });
      return { ready, done };
    });
    const all = Promise.all(workers.map((w) => w.done));
    await Promise.race([Promise.all(workers.map((w) => w.ready)), all]);
    Atomics.store(gate, 0, 1);
    Atomics.notify(gate, 0);
    const perWorker = await all;

    const expected = Array.from({ length: WORKERS * EACH }, (_, i) => `INV-2026-${String(i + 1).padStart(4, "0")}`);
    const issued = perWorker.flat();
    assert.equal(new Set(issued).size, issued.length, "no number was issued twice");
    assert.deepEqual([...issued].sort(), expected, "exactly 1..100, no gap");
    for (const own of perWorker) assert.deepEqual([...own].sort(), own, "each connection saw its numbers rise");

    const stored = db.prepare("SELECT number FROM documents WHERE report_id = ? ORDER BY number").all(reportId) as { number: string }[];
    assert.deepEqual(stored.map((r) => r.number), expected);
    const seq = db.prepare("SELECT period, last FROM report_sequences WHERE report_id = ?").get(reportId) as { period: string; last: number };
    assert.equal(seq.last, WORKERS * EACH);
    assert.equal(seq.period, "2026");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
