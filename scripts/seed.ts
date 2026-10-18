import { join } from "node:path";
import { openDb } from "../src/db/index.ts";
import { seedDemo } from "../src/seed.ts";
import { seedReports } from "../src/seed-reports-run.ts";
import { closeBrowser } from "../src/reports/pdf.ts";

const db = openDb(process.env.FORECRAFT_DB ?? join(import.meta.dirname, "../data/forecraft.db"));
const demo = await seedDemo(db);
console.log("Reports and documents:");
await seedReports(db, demo.workspaceId);
await closeBrowser();
db.close();
