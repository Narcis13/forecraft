// Machine-readable descriptions for agents: /openapi.json and /llms.txt.
import { Hono } from "hono";
import type { Env } from "../api/http.ts";

export function agentRoutes() {
  const app = new Hono<Env>();
  return app;
}
