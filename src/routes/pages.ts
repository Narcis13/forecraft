import { Hono } from "hono";
import type { DB } from "../db/index.ts";
import type { Env } from "../api/http.ts";
import { page } from "../render/index.ts";

export function pageRoutes(_db: DB) {
  const app = new Hono<Env>();
  return app;
}
