// The server Playwright starts: a fresh database in test-results/, every run.
import { mkdirSync, rmSync } from "node:fs";

const file = "test-results/e2e.db";
mkdirSync("test-results", { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
process.env.FORECRAFT_DB = file;
await import("../src/server.ts");
