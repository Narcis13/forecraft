import { join } from "node:path";
import { openDb } from "../src/db/index.ts";
import { seedDemo } from "../src/seed.ts";

const db = openDb(process.env.FORECRAFT_DB ?? join(import.meta.dirname, "../data/forecraft.db"));
await seedDemo(db);
db.close();
