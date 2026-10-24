import { serve } from "@hono/node-server";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { precompile } from "./render/index.ts";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST || "127.0.0.1";
const file = process.env.FORECRAFT_DB ?? join(import.meta.dirname, "../data/forecraft.db");
// Compile every page template now, so a broken one fails the boot, not a visitor.
precompile(readdirSync(join(import.meta.dirname, "../templates/pages"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".faqir"))
  .map((f) => `pages/${f.replaceAll("\\", "/")}`));
const db = openDb(file);
const app = createApp(db);

// Behind a proxy (TRUST_PROXY=1) the socket is plain HTTP; X-Forwarded-Proto says what the
// visitor used, so absolute links, the same-origin check and Secure cookies see https.
function forwarded(req: Request): Request {
  if (process.env.TRUST_PROXY !== "1" || req.headers.get("x-forwarded-proto") !== "https") return req;
  const url = new URL(req.url);
  if (url.protocol === "https:") return req;
  url.protocol = "https:";
  return new Request(url, { method: req.method, headers: req.headers, body: req.body, signal: req.signal, duplex: "half" } as RequestInit);
}

const server = serve({ fetch: (req, env) => app.fetch(forwarded(req), env), port, hostname }, (info) => {
  console.log(`forecraft on http://${hostname}:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
