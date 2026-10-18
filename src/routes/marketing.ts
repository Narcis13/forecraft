// Marketing site: /, /pricing, /docs, /docs/:slug, /for-agents.
import { Hono } from "hono";
import type { Env } from "../api/http.ts";

export function marketingRoutes() {
  const app = new Hono<Env>();
  return app;
}
