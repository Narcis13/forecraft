// Worker for numbering.test.ts: its own connection, its own transactions, one document per number.
import { parentPort, workerData } from "node:worker_threads";
import { newId, now, openDb, transaction } from "../../src/db/index.ts";
import { nextNumber } from "../../src/reports/numbering.ts";

const { file, workspaceId, reportId, pattern, count, gate } = workerData as {
  file: string;
  workspaceId: string;
  reportId: string;
  pattern: string;
  count: number;
  gate: Int32Array;
};

const db = openDb(file);
const date = new Date(Date.UTC(2026, 5, 1));
const insert = db.prepare(
  `INSERT INTO documents (id, workspace_id, report_id, version, status, number, data, locale, share_token, created_at, updated_at)
   VALUES (?, ?, ?, 1, 'issued', ?, '{}', 'en', ?, ?, ?)`,
);

// Tell the test we are connected, then wait for everyone so the workers really overlap.
parentPort!.postMessage({ ready: true });
Atomics.wait(gate, 0, 0);

const numbers: string[] = [];
for (let i = 0; i < count; i++) {
  transaction(db, () => {
    const number = nextNumber(db, reportId, { pattern }, date, null);
    insert.run(newId("doc"), workspaceId, reportId, number, newId("shr"), now(), now());
    numbers.push(number);
  });
}
db.close();
parentPort!.postMessage({ numbers });
