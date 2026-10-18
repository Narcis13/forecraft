import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type DB = DatabaseSync;

const MIGRATIONS = join(import.meta.dirname, "migrations");

/** Open (or create) the database and apply any migration not yet applied. */
export function openDb(file: string): DB {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT name FROM migrations").all() as { name: string }[]).map((r) => r.name),
  );
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    transaction(db, () => {
      db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
      db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(name, now());
    });
  }
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** A per-database secret, generated on first use and kept in `meta` (never in a file). */
export function secret(db: DB, key: string): string {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (row) return row.value;
  const value = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, value);
  return value;
}

export function now(): string {
  return new Date().toISOString();
}

/** `frm_3Kx9…` — a prefixed random id; the prefix says what it is in a log line. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("base64url").replace(/[-_]/g, "x")}`;
}
