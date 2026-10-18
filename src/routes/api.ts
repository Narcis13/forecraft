// /api/v1 — the product. The dashboard and the designer are clients of these
// same routes (through the session cookie); agents use a bearer API key.

import { Hono, type Context } from "hono";
import {
  createApiKey, createInvite, listApiKeys, revokeApiKey,
} from "../auth/index.ts";
import type { DB } from "../db/index.ts";
import { checkSubmission, compileForm, DEFAULT_APPEARANCE, THEMES, ACCENTS, LAYOUTS } from "../forms/model.ts";
import { auditHtml, renderFormPage } from "../forms/page.ts";
import {
  countSubmissions, createForm, deleteForm, deleteSubmission, getForm, getFormBySlug, getSubmission, getVersion,
  insertSubmission, listForms, listSubmissions, listVersions, publishForm, toCsv, toResource, updateForm,
  type FormPatch, type FormRow,
} from "../forms/store.ts";
import {
  absoluteUrl, authenticate, clientIp, type Env, ipHash, notFound, Problem, rateLimit, readJson, take,
} from "../api/http.ts";

export function apiRoutes(db: DB) {
  const api = new Hono<Env>();

  // ── Public submission endpoint (no auth) ────────────────────────────────
  api.post("/f/:slug/submissions", async (c) => {
    const row = getFormBySlug(db, c.req.param("slug"));
    if (!row) throw new Problem(404, "not-found", "Not found", "No form with that slug.");
    const ip = ipHash(db, clientIp(c));
    const limited = take(`submit:${ip}`, 10);
    if (!limited.ok) {
      c.header("Retry-After", String(limited.retryAfter));
      throw new Problem(429, "rate-limited", "Too many submissions", "Too many submissions from this address. Try again in a minute.");
    }
    const live = liveVersion(row);
    if (!live) throw new Problem(409, "form-unpublished", "Form not published", "This form has no published version yet.");
    if (row.status === "closed") throw new Problem(409, "form-closed", "Form closed", "This form is no longer accepting responses.");
    if (row.submission_limit !== null && countSubmissions(db, row.id) >= row.submission_limit) {
      throw new Problem(409, "form-full", "Form full", "This form has reached its submission limit.");
    }

    const raw = await readSubmissionBody(c);
    const honeypot = raw instanceof URLSearchParams ? raw.get("_fc_hp") : (raw as Record<string, unknown>)._fc_hp;
    if (raw instanceof URLSearchParams) raw.delete("_fc_hp");
    else delete (raw as Record<string, unknown>)._fc_hp;
    if (honeypot) return c.json({ id: null, received: true }, 202); // a bot: say thanks, keep nothing

    const verdict = checkSubmission(live.form, raw);
    if (!verdict.valid) throw invalidSubmission(verdict.findings);
    const sub = insertSubmission(db, row.id, live.version, verdict.data, ip);
    const a = live.form.appearance;
    return c.json({ id: sub.id, created_at: sub.created_at, thank_you: a.thankYou, redirect: a.redirect }, 201);
  });

  // Everything below needs a key or a session.
  api.use("*", authenticate(db, { allowSession: true }));
  api.use("*", rateLimit(240, (c) => {
    const p = c.var.principal;
    return p.via === "key" ? `key:${p.keyId}` : `user:${p.userId}`;
  }));

  // ── Workspace, members, keys ────────────────────────────────────────────
  api.get("/workspace", (c) => {
    const ws = db.prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?").get(c.var.principal.workspaceId);
    return c.json(ws);
  });

  api.patch("/workspace", async (c) => {
    const body = await readJson(c);
    if (typeof body.name !== "string" || !body.name.trim()) throw invalid([{ pointer: "/name", detail: "A non-empty string." }]);
    db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(body.name.trim(), c.var.principal.workspaceId);
    return c.json(db.prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?").get(c.var.principal.workspaceId));
  });

  api.get("/workspace/members", (c) => {
    const members = db.prepare(
      `SELECT u.id, u.email, u.name, m.role, m.created_at AS joined_at FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.created_at`,
    ).all(c.var.principal.workspaceId);
    const invites = db.prepare(
      "SELECT id, email, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC",
    ).all(c.var.principal.workspaceId);
    return c.json({ members, invites });
  });

  api.post("/workspace/invites", async (c) => {
    const p = c.var.principal;
    if (!p.userId) throw new Problem(403, "session-required", "Sign in to invite", "Invitations are made by a person, from the dashboard.");
    const body = await readJson(c);
    if (typeof body.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
      throw invalid([{ pointer: "/email", detail: "An email address." }]);
    }
    const inv = createInvite(db, p.workspaceId, p.userId, body.email);
    return c.json({ id: inv.id, email: body.email, url: absoluteUrl(c, `/invite/${inv.token}`) }, 201);
  });

  api.get("/keys", (c) => c.json({ items: listApiKeys(db, c.var.principal.workspaceId) }));

  api.post("/keys", async (c) => {
    const body = await readJson(c).catch(() => ({}) as Record<string, unknown>);
    const { key, secret } = createApiKey(db, c.var.principal.workspaceId, typeof body.name === "string" ? body.name : "API key");
    return c.json({ ...key, secret, note: "This is the only time the secret is shown. Store it now." }, 201);
  });

  api.delete("/keys/:id", (c) => {
    if (!revokeApiKey(db, c.var.principal.workspaceId, c.req.param("id"))) throw notFound("active key");
    return c.body(null, 204);
  });

  // ── Forms ───────────────────────────────────────────────────────────────
  const formOut = (c: Context<Env>, row: FormRow) => ({
    ...toResource(db, row),
    url: absoluteUrl(c, `/f/${row.slug}`),
    preview_url: absoluteUrl(c, `/app/forms/${row.id}/preview`),
  });
  const mustForm = (c: Context<Env>) => {
    const row = getForm(db, c.var.principal.workspaceId, c.req.param("id")!);
    if (!row) throw notFound("form");
    return row;
  };

  api.get("/forms", (c) => {
    const items = listForms(db, c.var.principal.workspaceId).map((row) => {
      const { definition: _d, ...rest } = formOut(c, row);
      return rest;
    });
    return c.json({ items });
  });

  api.post("/forms", async (c) => {
    const body = await readJson(c);
    // { definition, slug? } — or, for convenience, the bare definition.
    const wrapped = "definition" in body;
    if (wrapped) {
      const extra = Object.keys(body).filter((k) => k !== "definition" && k !== "slug");
      if (extra.length) throw invalid(extra.map((k) => ({ pointer: `/${k}`, detail: "Unknown key. POST /forms takes definition and slug." })));
    }
    const definition = wrapped ? body.definition : body;
    const slug = wrapped && typeof body.slug === "string" ? checkSlug(body.slug) : undefined;
    if (slug && getFormBySlug(db, slug)) throw new Problem(409, "slug-taken", "Slug taken", `The slug "${slug}" is in use.`);
    const row = createForm(db, c.var.principal.workspaceId, definition, slug);
    c.header("Location", `/api/v1/forms/${row.id}`);
    return c.json(formOut(c, row), 201);
  });

  api.get("/forms/:id", (c) => c.json(formOut(c, mustForm(c))));

  api.patch("/forms/:id", async (c) => {
    const row = mustForm(c);
    const body = await readJson(c);
    const patch: FormPatch = {};
    const errors: { pointer: string; detail: string }[] = [];
    if ("definition" in body) patch.definition = body.definition;
    if ("status" in body) {
      if (body.status !== "open" && body.status !== "closed") errors.push({ pointer: "/status", detail: 'One of "open", "closed".' });
      else patch.status = body.status;
    }
    if ("submission_limit" in body) {
      const v = body.submission_limit;
      if (v !== null && !(Number.isInteger(v) && (v as number) > 0)) errors.push({ pointer: "/submission_limit", detail: "A positive integer, or null for no limit." });
      else patch.submission_limit = v as number | null;
    }
    if ("slug" in body) {
      if (typeof body.slug !== "string") errors.push({ pointer: "/slug", detail: "A string." });
      else {
        patch.slug = checkSlug(body.slug);
        const other = getFormBySlug(db, patch.slug);
        if (other && other.id !== row.id) throw new Problem(409, "slug-taken", "Slug taken", `The slug "${patch.slug}" is in use.`);
      }
    }
    const known = new Set(["definition", "status", "submission_limit", "slug"]);
    for (const k of Object.keys(body)) if (!known.has(k)) errors.push({ pointer: `/${k}`, detail: "Unknown key. PATCH takes definition, status, submission_limit, slug." });
    if (errors.length) throw invalid(errors);
    return c.json(formOut(c, updateForm(db, row, patch)));
  });

  api.delete("/forms/:id", (c) => {
    deleteForm(db, mustForm(c).id);
    return c.body(null, 204);
  });

  api.post("/forms/:id/publish", (c) => {
    const row = mustForm(c);
    compileForm(JSON.parse(row.definition));
    const version = publishForm(db, row);
    return c.json({ version: version.version, published_at: version.published_at, url: absoluteUrl(c, `/f/${row.slug}`) }, 201);
  });

  api.get("/forms/:id/versions", (c) => {
    const row = mustForm(c);
    return c.json({
      items: listVersions(db, row.id).map((v) => ({
        version: v.version, published_at: v.published_at, live: v.version === row.published_version,
        submission_count: (db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE form_id = ? AND version = ?").get(row.id, v.version) as { n: number }).n,
      })),
    });
  });

  api.get("/forms/:id/versions/:version", (c) => {
    const row = mustForm(c);
    const v = getVersion(db, row.id, Number(c.req.param("version")));
    if (!v) throw notFound("version");
    return c.json({ version: v.version, published_at: v.published_at, definition: JSON.parse(v.definition) });
  });

  /** Render a definition (the body's, or the form's draft) and audit it. Nothing is stored. */
  const preview = async (c: Context<Env>, definition: unknown) => {
    const form = compileForm(definition);
    const html = renderFormPage(form, { action: "#", preview: true });
    const audit = await auditHtml(html);
    return c.json({ html, audit, rules: form.rules });
  };
  api.post("/preview", async (c) => {
    const body = await readJson(c);
    return preview(c, "definition" in body ? body.definition : body);
  });
  api.post("/forms/:id/preview", async (c) => {
    const row = mustForm(c);
    const text = (await c.req.text()).trim();
    let body: { definition?: unknown } = {};
    if (text) {
      try { body = JSON.parse(text); } catch { throw new Problem(400, "bad-json", "Malformed JSON", "The request body is not valid JSON."); }
    }
    return preview(c, body.definition ?? JSON.parse(row.definition));
  });

  /** Dry-run a submission against the draft definition: the verdict, nothing stored. */
  api.post("/forms/:id/validate", async (c) => {
    const row = mustForm(c);
    const body = await readJson(c);
    const verdict = checkSubmission(compileForm(JSON.parse(row.definition)), (body.data ?? {}) as Record<string, unknown>);
    return c.json(verdict);
  });

  // ── Submissions ─────────────────────────────────────────────────────────
  api.get("/forms/:id/submissions", (c) => {
    const row = mustForm(c);
    const q = c.req.query();
    const { items, total } = listSubmissions(db, row.id, {
      q: q.q, version: q.version ? Number(q.version) : undefined, since: q.since, until: q.until,
      limit: q.limit ? Number(q.limit) : 50, offset: q.offset ? Number(q.offset) : 0,
    });
    return c.json({ items, total });
  });

  api.get("/forms/:id/submissions/export", (c) => {
    const row = mustForm(c);
    const format = c.req.query("format") ?? "csv";
    const { items } = listSubmissions(db, row.id, { q: c.req.query("q"), limit: 1000 });
    const name = `${row.slug}-submissions`;
    if (format === "json") {
      c.header("Content-Disposition", `attachment; filename="${name}.json"`);
      return c.json({ form: { id: row.id, slug: row.slug }, items });
    }
    if (format !== "csv") throw invalid([{ pointer: "/format", detail: 'One of "csv", "json".' }]);
    const fields = compileForm(JSON.parse(row.definition)).fields.map((f) => f.name);
    return c.body(toCsv(items, fields), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.csv"`,
    });
  });

  api.get("/submissions/:id", (c) => {
    const sub = getSubmission(db, c.var.principal.workspaceId, c.req.param("id"));
    if (!sub) throw notFound("submission");
    return c.json(sub);
  });

  api.delete("/submissions/:id", (c) => {
    const sub = getSubmission(db, c.var.principal.workspaceId, c.req.param("id"));
    if (!sub) throw notFound("submission");
    deleteSubmission(db, sub.id);
    return c.body(null, 204);
  });

  // ── Vocabulary an agent needs to write a definition ──────────────────────
  api.get("/vocabulary", (c) => c.json({ themes: THEMES, accents: ACCENTS, layouts: LAYOUTS, appearance_defaults: DEFAULT_APPEARANCE }));

  function liveVersion(row: FormRow) {
    if (row.published_version === null) return null;
    const v = getVersion(db, row.id, row.published_version)!;
    return { version: v.version, form: compileForm(JSON.parse(v.definition)) };
  }

  return api;
}

function checkSlug(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
    throw invalid([{ pointer: "/slug", detail: "3–64 characters: lowercase letters, digits and dashes." }]);
  }
  return slug;
}

function invalid(errors: { pointer: string; detail: string }[]) {
  return new Problem(422, "invalid-request", "Invalid request", errors.map((e) => `${e.pointer}: ${e.detail}`).join("; "), { errors });
}

export function invalidSubmission(findings: { path: string; rule: string; message: string }[]) {
  return new Problem(422, "invalid-submission", "The submission breaks the form's rules",
    findings.map((f) => `${f.path}: ${f.message} (${f.rule})`).join("; "),
    { errors: findings.map((f) => ({ pointer: `/${f.path.replace(/\./g, "/").replace(/\[(\d+)\]/g, "/$1")}`, field: f.path, rule: f.rule, detail: f.message })) });
}

async function readSubmissionBody(c: Context): Promise<Record<string, unknown> | URLSearchParams> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await readJson(c);
    return (typeof body.data === "object" && body.data !== null ? body.data : body) as Record<string, unknown>;
  }
  if (type.includes("application/x-www-form-urlencoded")) return new URLSearchParams(await c.req.text());
  if (type.includes("multipart/form-data")) {
    const fd = await c.req.formData();
    const params = new URLSearchParams();
    fd.forEach((v, k) => { if (typeof v === "string") params.append(k, v); });
    return params;
  }
  throw new Problem(415, "unsupported-media-type", "Unsupported media type", "Send application/json ({ \"data\": { … } }) or a form encoding.");
}
