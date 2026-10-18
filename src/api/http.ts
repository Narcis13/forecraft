// Shared HTTP plumbing: RFC 9457 problem details, auth resolution, rate limits.

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { createHash } from "node:crypto";
import { keyPrincipal, type Principal, SESSION_COOKIE, sessionPrincipal } from "../auth/index.ts";
import { type DB, secret } from "../db/index.ts";

export type Env = { Variables: { principal: Principal; db: DB } };

export const PROBLEM_BASE = "https://forecraft.dev/problems/";

/** An error the API turns into `application/problem+json`. */
export class Problem extends Error {
  status: number;
  type: string;
  title: string;
  extra: Record<string, unknown>;
  constructor(status: number, slug: string, title: string, detail?: string, extra: Record<string, unknown> = {}) {
    super(detail ?? title);
    this.status = status;
    this.type = PROBLEM_BASE + slug;
    this.title = title;
    this.extra = extra;
  }
}

export function problemResponse(c: Context, p: Problem): Response {
  return c.body(
    JSON.stringify({ type: p.type, title: p.title, status: p.status, detail: p.message, instance: new URL(c.req.url).pathname, ...p.extra }, null, 2),
    p.status as 400,
    { "content-type": "application/problem+json" },
  );
}

export const notFound = (what: string) => new Problem(404, "not-found", "Not found", `No ${what} with that id in this workspace.`);

/** Resolve a bearer API key or a session cookie into `c.var.principal`. */
export function authenticate(db: DB, opts: { allowSession: boolean }): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    let principal: Principal | null = null;
    if (header) {
      const m = /^Bearer\s+(\S+)$/i.exec(header);
      principal = m ? keyPrincipal(db, m[1]!) : null;
      if (!principal) throw new Problem(401, "unauthorized", "Invalid API key", "The bearer token is not an active forecraft API key (fc_live_…).");
    } else if (opts.allowSession) {
      const token = getCookie(c, SESSION_COOKIE);
      principal = token ? sessionPrincipal(db, token) : null;
      // A cookie rides along on cross-site requests; a write must come from our own pages.
      if (principal && !["GET", "HEAD"].includes(c.req.method) && !sameOrigin(c)) {
        throw new Problem(403, "cross-origin", "Cross-origin request refused", "Session-authenticated writes must come from this origin.");
      }
    }
    if (!principal) {
      throw new Problem(401, "unauthorized", "Authentication required", "Send `Authorization: Bearer fc_live_…` (create a key in the dashboard under API keys).");
    }
    c.set("principal", principal);
    await next();
  };
}

export function sameOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return c.req.header("sec-fetch-site") !== "cross-site";
  return origin === new URL(c.req.url).origin;
}

// ── Rate limiting (in memory; a token bucket per key) ─────────────────────

const buckets = new Map<string, { tokens: number; at: number }>();

/** `true` when allowed. `perMinute` tokens refill continuously; a burst of `perMinute` is allowed. */
export function take(key: string, perMinute: number): { ok: boolean; retryAfter: number; remaining: number } {
  const t = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: t };
  b.tokens = Math.min(perMinute, b.tokens + ((t - b.at) / 60_000) * perMinute);
  b.at = t;
  // Bounded: when full, forget the bucket touched longest ago (Map keeps insertion
  // order and every take() re-inserts), never everyone's at once.
  buckets.delete(key);
  if (buckets.size >= 50_000) buckets.delete(buckets.keys().next().value!);
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil(((1 - b.tokens) * 60_000) / perMinute / 1000), remaining: 0 };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true, retryAfter: 0, remaining: Math.floor(b.tokens) };
}

export function rateLimit(perMinute: number, keyOf: (c: Context<Env>) => string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const r = take(keyOf(c), perMinute);
    c.header("RateLimit-Limit", String(perMinute));
    c.header("RateLimit-Remaining", String(r.remaining));
    if (!r.ok) {
      c.header("Retry-After", String(r.retryAfter));
      throw new Problem(429, "rate-limited", "Too many requests", `Slow down: ${perMinute} requests per minute. Retry in ${r.retryAfter}s.`);
    }
    await next();
  };
}

/** The socket's address. `X-Forwarded-For` is believed only behind a proxy you name (TRUST_PROXY=1). */
export function clientIp(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  const socket = env?.incoming?.socket?.remoteAddress || "unknown";
  if (process.env.TRUST_PROXY !== "1") return socket;
  return c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || socket;
}

/** A salted hash of the client IP: enough to rate-limit and spot spam, not to identify anyone. */
export function ipHash(db: DB, ip: string): string {
  return createHash("sha256").update(secret(db, "ip_salt")).update(ip).digest("hex").slice(0, 32);
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new Problem(400, "bad-json", "Malformed JSON", "The request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Problem(400, "bad-json", "Malformed JSON", "The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function absoluteUrl(c: Context, path: string): string {
  return new URL(path, c.req.url).toString();
}
