import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { join, relative } from "node:path";
import type { DB } from "./db/index.ts";
import { type Env, Problem, problemResponse } from "./api/http.ts";
import { DefinitionProblem } from "./forms/model.ts";
import { ReportProblem } from "./reports/model.ts";
import { documentRoutes } from "./routes/documents.ts";
import { apiRoutes } from "./routes/api.ts";
import { publicRoutes } from "./routes/public.ts";
import { pageRoutes } from "./routes/pages.ts";
import { marketingRoutes } from "./routes/marketing.ts";
import { agentRoutes } from "./routes/agents.ts";
import { page } from "./render/index.ts";

const ROOT = join(import.meta.dirname, "..");
const rel = (p: string) => relative(process.cwd(), join(ROOT, p)) || ".";

export function createApp(db: DB) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  app.use("/ui/*", serveStatic({ root: rel("."), onFound: (_p, c) => { c.header("Cache-Control", "public, max-age=3600"); } }));
  app.use("/*", serveStatic({ root: rel("public") }));

  app.route("/api/v1", apiRoutes(db));
  app.route("/", publicRoutes(db));
  app.route("/", documentRoutes(db));
  app.route("/", agentRoutes());
  app.route("/", marketingRoutes());
  app.route("/", pageRoutes(db));

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return problemResponse(c, new Problem(404, "not-found", "Not found", `No route ${c.req.method} ${c.req.path}.`));
    return c.html(page("pages/not-found.faqir", { page: {} }), 404);
  });

  app.onError((err, c) => {
    if (err instanceof Problem) {
      if (typeof err.extra.retry_after === "number") c.header("Retry-After", String(err.extra.retry_after));
      return problemResponse(c, err);
    }
    if (err instanceof ReportProblem) {
      return problemResponse(c, new Problem(422, "invalid-definition", "Invalid report definition", err.message, { errors: err.errors }));
    }
    if (err instanceof DefinitionProblem) {
      return problemResponse(c, new Problem(422, "invalid-definition", "Invalid form definition", err.message, { errors: err.errors }));
    }
    if (err instanceof SyntaxError && c.req.path.startsWith("/api/")) {
      return problemResponse(c, new Problem(400, "bad-json", "Malformed JSON", err.message));
    }
    console.error(err);
    if (c.req.path.startsWith("/api/")) return problemResponse(c, new Problem(500, "internal", "Internal error", "Something broke on our side."));
    return c.text("Internal Server Error", 500);
  });

  return app;
}
