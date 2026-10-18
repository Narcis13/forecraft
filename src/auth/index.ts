import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { type DB, newId, now, transaction } from "../db/index.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;

export const SESSION_COOKIE = "fc_session";
export const KEY_PREFIX = "fc_live_";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(actual, expected);
}

export interface User { id: string; email: string; name: string; created_at: string }
export interface Workspace { id: string; name: string; created_at: string }

/** Sign-up: the account and its own workspace, in one transaction. */
export async function createAccount(db: DB, input: { email: string; password: string; name?: string; workspace?: string }) {
  const passwordHash = await hashPassword(input.password);
  return transaction(db, () => {
    const user: User = { id: newId("usr"), email: input.email.trim(), name: (input.name ?? "").trim(), created_at: now() };
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.email, user.name, passwordHash, user.created_at);
    const workspace: Workspace = {
      id: newId("wsp"),
      name: input.workspace?.trim() || `${user.name || user.email.split("@")[0]}'s workspace`,
      created_at: now(),
    };
    db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(workspace.id, workspace.name, workspace.created_at);
    db.prepare("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .run(workspace.id, user.id, now());
    return { user, workspace };
  });
}

export function findUserByEmail(db: DB, email: string) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim()) as (User & { password_hash: string }) | undefined;
}

/** The first workspace a user belongs to — the one a fresh session opens. */
export function defaultWorkspace(db: DB, userId: string): string | undefined {
  const row = db.prepare("SELECT workspace_id FROM members WHERE user_id = ? ORDER BY created_at LIMIT 1").get(userId) as
    | { workspace_id: string } | undefined;
  return row?.workspace_id;
}

export function createSession(db: DB, userId: string, workspaceId: string): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, workspace_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha256(token), userId, workspaceId, now(), expires);
  return token;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export interface Principal {
  workspaceId: string;
  userId: string | null;
  via: "session" | "key";
  keyId: string | null;
}

export function sessionPrincipal(db: DB, token: string): Principal | null {
  const row = db.prepare(
    `SELECT s.user_id, s.workspace_id FROM sessions s
     JOIN members m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).get(sha256(token), now()) as { user_id: string; workspace_id: string } | undefined;
  return row ? { workspaceId: row.workspace_id, userId: row.user_id, via: "session", keyId: null } : null;
}

// ── API keys ──────────────────────────────────────────────────────────────

export interface ApiKeyRow { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

/** Returns the secret once; only its hash is stored. */
export function createApiKey(db: DB, workspaceId: string, name: string): { key: ApiKeyRow; secret: string } {
  const secret = KEY_PREFIX + randomBytes(24).toString("base64url");
  const key: ApiKeyRow = { id: newId("key"), name: name.trim() || "API key", prefix: secret.slice(0, 12), created_at: now(), last_used_at: null, revoked_at: null };
  db.prepare("INSERT INTO api_keys (id, workspace_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(key.id, workspaceId, key.name, key.prefix, sha256(secret), key.created_at);
  return { key, secret };
}

export function keyPrincipal(db: DB, secret: string): Principal | null {
  if (!secret.startsWith(KEY_PREFIX)) return null;
  const row = db.prepare("SELECT id, workspace_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(sha256(secret)) as
    | { id: string; workspace_id: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now(), row.id);
  return { workspaceId: row.workspace_id, userId: null, via: "key", keyId: row.id };
}

export function listApiKeys(db: DB, workspaceId: string): ApiKeyRow[] {
  return db.prepare(
    "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC",
  ).all(workspaceId) as unknown as ApiKeyRow[];
}

export function revokeApiKey(db: DB, workspaceId: string, id: string): boolean {
  const res = db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL")
    .run(now(), id, workspaceId);
  return Number(res.changes) > 0;
}

// ── Invites ───────────────────────────────────────────────────────────────

export function createInvite(db: DB, workspaceId: string, createdBy: string, email: string): { id: string; token: string } {
  const token = randomBytes(24).toString("base64url");
  const id = newId("inv");
  db.prepare("INSERT INTO invites (id, workspace_id, email, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, email.trim(), sha256(token), createdBy, now());
  return { id, token };
}

export function findInvite(db: DB, token: string) {
  return db.prepare(
    `SELECT i.id, i.email, i.workspace_id, w.name AS workspace_name FROM invites i
     JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = ? AND i.accepted_at IS NULL`,
  ).get(sha256(token)) as { id: string; email: string; workspace_id: string; workspace_name: string } | undefined;
}

export function acceptInvite(db: DB, inviteId: string, workspaceId: string, userId: string): void {
  transaction(db, () => {
    db.prepare("INSERT OR IGNORE INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)")
      .run(workspaceId, userId, now());
    db.prepare("UPDATE invites SET accepted_at = ? WHERE id = ?").run(now(), inviteId);
  });
}
