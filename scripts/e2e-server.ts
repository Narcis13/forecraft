// The server Playwright starts: a fresh database in test-results/, every run,
// seeded with the demo workspace (forms, reports, issued documents) so specs
// can sign in as the demo user. Seeding the reports prints real PDFs (about ten
// seconds); the server only starts listening once it is done, so Playwright's
// readiness check on /health stays correct.
import { mkdirSync, rmSync } from "node:fs";
import { openDb } from "../src/db/index.ts";
import { closeBrowser } from "../src/reports/pdf.ts";
import { seedDemo } from "../src/seed.ts";
import { seedReports } from "../src/seed-reports-run.ts";

const DEMO_PASSWORD = "e2e-demo-password-1";

const file = "test-results/e2e.db";
mkdirSync("test-results", { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
process.env.FORECRAFT_DB = file;

const db = openDb(file);
const demo = await seedDemo(db, { quiet: true, password: DEMO_PASSWORD });
await seedReports(db, demo.workspaceId, { quiet: true });
await closeBrowser();
db.close();

await import("../src/server.ts");
