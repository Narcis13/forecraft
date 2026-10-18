import { serve } from "@hono/node-server";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb } from "./db/index.ts";

const port = Number(process.env.PORT ?? 3000);
const file = process.env.FORECRAFT_DB ?? join(import.meta.dirname, "../data/forecraft.db");
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
