import { serve } from "@hono/node-server";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { precompile } from "./render/index.ts";
import { browserCheck } from "./reports/pdf.ts";

const port = Number(process.env.PORT ?? 3000);
const file = process.env.FORECRAFT_DB ?? join(import.meta.dirname, "../data/forecraft.db");
// Compile every page template now, so a broken one fails the boot, not a visitor.
precompile(readdirSync(join(import.meta.dirname, "../templates/pages"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".faqir"))
  .map((f) => `pages/${f.replaceAll("\\", "/")}`));
// Reports print in Chromium, which `npm install` does not fetch: say so once, and boot anyway.
void browserCheck().then((problem) => { if (problem) console.warn(`forecraft: reports cannot print. ${problem}`); });
const db = openDb(file);
const app = createApp(db);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`forecraft on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
