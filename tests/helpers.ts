// Spin the real server on a random port against a temporary database.

import { serve } from "@hono/node-server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";
import { openDb, type DB } from "../src/db/index.ts";
import { seedDemo, type DemoResult } from "../src/seed.ts";

export interface TestServer {
  url: string;
  db: DB;
  demo: DemoResult | null;
  /** fetch against the server with the demo key (if seeded) as bearer auth. */
  api: (path: string, init?: RequestInit & { json?: unknown; key?: string | null }) => Promise<Response>;
  close: () => Promise<void>;
}

export async function startServer(opts: { seed?: boolean } = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), "forecraft-test-"));
  const db = openDb(join(dir, "test.db"));
  const demo = opts.seed ? await seedDemo(db, { quiet: true, password: "demo-password-1" }) : null;
  const app = createApp(db);
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const api: TestServer["api"] = (path, init = {}) => {
    const headers = new Headers(init.headers);
    const key = init.key === undefined ? demo?.apiKey : init.key;
    if (key) headers.set("authorization", `Bearer ${key}`);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    return fetch(url + path, { ...init, headers, body });
  };

  return {
    url, db, demo, api,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
