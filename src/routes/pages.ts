// Server-rendered pages for people: sign-up/in, invites and the dashboard.
// Reads go straight to the store; every write the dashboard makes goes
// through /api/v1 from public/app.js, like any other client.

import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  acceptInvite, createAccount, createSession, defaultWorkspace, deleteSession, findInvite, findUserByEmail,
  listApiKeys, type Principal, SESSION_COOKIE, sessionPrincipal, verifyPassword,
} from "../auth/index.ts";
import type { DB } from "../db/index.ts";
import { clientIp, type Env, ipHash, sameOrigin, take } from "../api/http.ts";
import { ACCENTS, compileForm, DEFAULT_APPEARANCE, THEMES } from "../forms/model.ts";
import { renderFormPage } from "../forms/page.ts";
import {
  countSubmissions, getForm, getVersion, listForms, listSubmissions, listVersions, toResource, type FormRow,
} from "../forms/store.ts";
import { page } from "../render/index.ts";
import { reportPageRoutes } from "./report-pages.ts";

export type PageEnv = Env & { Variables: { user: { id: string; email: string; name: string } } };

export function pageRoutes(db: DB) {
  const app = new Hono<PageEnv>();

  const startSession = (c: Context, userId: string, workspaceId: string) => {
    setCookie(c, SESSION_COOKIE, createSession(db, userId, workspaceId), {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: 30 * 86400, secure: new URL(c.req.url).protocol === "https:",
    });
  };

  // ── Auth ────────────────────────────────────────────────────────────────
  /** Password attempts: 30 a minute per address (offices share one), 10 per email; each runs scrypt. */
  const throttled = (c: Context, email: string) =>
    !take(`auth-ip:${ipHash(db, clientIp(c))}`, 30).ok || !take(`auth-email:${email.trim().toLowerCase()}`, 10).ok;
  const TOO_MANY = "Too many attempts. Wait a minute and try again.";

  const authPage = (mode: "login" | "register", extra: Record<string, unknown> = {}) =>
    page("pages/auth.faqir", {
      page: {
        mode,
        heading: mode === "login" ? "Welcome back" : "Create your workspace",
        lede: mode === "login" ? "Sign in to your forms, keys and submissions." : "One workspace, an API key, and forms your agent can build. Free while in prototype.",
        action: mode === "login" ? "/signin" : "/signup",
        submit: mode === "login" ? "Sign in" : "Create account",
        error: null,
        email: "",
        name: "",
        invite: null,
        ...extra,
      },
    });

  app.get("/signin", (c) => c.html(authPage("login")));
  app.get("/signup", (c) => c.html(authPage("register")));

  app.post("/signin", async (c) => {
    if (!sameOrigin(c)) return c.text("Cross-origin form post refused", 403);
    const form = await c.req.parseBody();
    const email = String(form.email ?? "");
    if (throttled(c, email)) return c.html(authPage("login", { error: TOO_MANY, email }), 429);
    const user = findUserByEmail(db, email);
    if (!user || !(await verifyPassword(String(form.password ?? ""), user.password_hash))) {
      return c.html(authPage("login", { error: "That email and password do not match an account.", email }), 401);
    }
    startSession(c, user.id, defaultWorkspace(db, user.id)!);
    return c.redirect("/app", 303);
  });

  app.post("/signup", async (c) => {
    if (!sameOrigin(c)) return c.text("Cross-origin form post refused", 403);
    const form = await c.req.parseBody();
    const email = String(form.email ?? "").trim();
    const name = String(form.name ?? "").trim();
    const password = String(form.password ?? "");
    if (throttled(c, email)) return c.html(authPage("register", { error: TOO_MANY, email, name }), 429);
    const error = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? "Enter a valid email address."
      : password.length < 8 ? "Use a password of at least 8 characters."
      : findUserByEmail(db, email) ? "An account with that email already exists. Sign in instead."
      : null;
    if (error) return c.html(authPage("register", { error, email, name }), 422);
    const { user, workspace } = await createAccount(db, { email, password, name });
    startSession(c, user.id, workspace.id);
    return c.redirect("/app", 303);
  });

  app.post("/signout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/", 303);
  });

  // An invite link: sign up (or in) and join the inviting workspace.
  app.get("/invite/:token", (c) => {
    const inv = findInvite(db, c.req.param("token"));
    if (!inv) return c.html(page("pages/not-found.faqir", { page: {} }), 404);
    return c.html(authPage("register", {
      heading: `Join ${inv.workspace_name}`,
      lede: "You were invited to this workspace. Create an account (or use your existing password) to join.",
      action: `/invite/${c.req.param("token")}`, submit: "Join workspace", email: inv.email, invite: inv.workspace_name,
    }));
  });

  app.post("/invite/:token", async (c) => {
    if (!sameOrigin(c)) return c.text("Cross-origin form post refused", 403);
    const inv = findInvite(db, c.req.param("token"));
    if (!inv) return c.html(page("pages/not-found.faqir", { page: {} }), 404);
    const form = await c.req.parseBody();
    // An invite is for the address it was sent to.
    const email = inv.email;
    const password = String(form.password ?? "");
    if (throttled(c, email)) return c.html(authPage("register", { error: TOO_MANY, email }), 429);
    const again = (error: string) => c.html(authPage("register", {
      heading: `Join ${inv.workspace_name}`, lede: "You were invited to this workspace.", action: `/invite/${c.req.param("token")}`,
      submit: "Join workspace", email, error, invite: inv.workspace_name,
    }), 422);
    let user = findUserByEmail(db, email);
    if (user) {
      if (!(await verifyPassword(password, user.password_hash))) return again("That account exists; enter its password to join.");
    } else {
      if (password.length < 8) return again("Use a password of at least 8 characters.");
      user = { ...(await createAccount(db, { email, password, name: String(form.name ?? "") })).user, password_hash: "" };
    }
    acceptInvite(db, inv.id, inv.workspace_id, user.id);
    startSession(c, user.id, inv.workspace_id);
    return c.redirect("/app", 303);
  });

  // ── Dashboard ───────────────────────────────────────────────────────────
  const guard = async (c: Context<PageEnv>, next: () => Promise<void>) => {
    const token = getCookie(c, SESSION_COOKIE);
    const principal: Principal | null = token ? sessionPrincipal(db, token) : null;
    if (!principal) return c.redirect("/signin", 303);
    c.set("principal", principal);
    c.set("user", db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(principal.userId) as PageEnv["Variables"]["user"]);
    await next();
  };
  app.use("/app", guard);
  app.use("/app/*", guard);

  const shell = (c: Context<PageEnv>, nav: string, heading: string, extra: Record<string, unknown>) => {
    const forms = listForms(db, c.var.principal.workspaceId);
    const titles = forms.map((f) => (JSON.parse(f.definition) as { schema: { title: string } }).schema.title);
    // The palette routes by label, so two forms with one title get their address added.
    const label = (i: number) => titles.indexOf(titles[i]!) !== titles.lastIndexOf(titles[i]!) ? `${titles[i]} (/f/${forms[i]!.slug})` : titles[i]!;
    const groups = [
      { label: "Go to", items: [
        { label: "Forms", href: "/app" }, { label: "Reports", href: "/app/reports" }, { label: "Documents", href: "/app/documents" }, { label: "API keys", href: "/app/keys" }, { label: "Workspace settings", href: "/app/settings" },
        { label: "Docs", href: "/docs" }, { label: "For agents", href: "/for-agents" },
      ] },
      { label: "Forms", items: forms.map((f, i) => ({ label: label(i), href: `/app/forms/${f.id}` })) },
      { label: "Design", items: forms.map((f, i) => ({ label: `Design: ${label(i)}`, href: `/app/forms/${f.id}/design` })) },
    ].filter((g) => g.items.length > 0);
    return {
      nav,
      heading,
      user: c.var.user,
      paletteGroups: groups,
      paletteRoutes: Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.label, i.href]))),
      ...extra,
    };
  };

  app.get("/app", (c) => {
    const forms = listForms(db, c.var.principal.workspaceId).map((row) => formSummary(row));
    const ws = db.prepare("SELECT name FROM workspaces WHERE id = ?").get(c.var.principal.workspaceId) as { name: string };
    const totals = {
      forms: forms.length,
      live: forms.filter((f) => f.live).length,
      responses: forms.reduce((n, f) => n + f.responses, 0),
    };
    return c.html(page("pages/app/forms.faqir", {
      page: shell(c, "forms", "Forms", { forms, totals, workspace: ws.name, origin: new URL(c.req.url).origin }),
    }));
  });

  function formSummary(row: FormRow) {
    const r = toResource(db, row);
    return {
      id: r.id, slug: r.slug, title: r.title, responses: r.submission_count, updated: r.updated_at,
      live: r.published_version !== null && r.status === "open", status: r.status, version: r.published_version,
      draft: r.has_unpublished_changes,
      statusLabel: r.status === "closed" ? "Closed" : r.published_version === null ? "Draft" : `Live · v${r.published_version}`,
      statusVariant: r.status === "closed" ? "destructive" : r.published_version === null ? "secondary" : "success",
    };
  }

  const mustForm = (c: Context<PageEnv>) => getForm(db, c.var.principal.workspaceId, c.req.param("id")!);

  const formPage = (c: Context<PageEnv>, row: FormRow, tab: string, extra: Record<string, unknown>) => {
    const summary = formSummary(row);
    const origin = new URL(c.req.url).origin;
    return shell(c, "forms", summary.title, {
      form: { ...summary, url: `${origin}/f/${row.slug}` },
      tab,
      tabs: [
        { id: "overview", label: "Overview", href: `/app/forms/${row.id}` },
        { id: "submissions", label: "Submissions", href: `/app/forms/${row.id}/submissions` },
        { id: "share", label: "Share", href: `/app/forms/${row.id}/share` },
        { id: "settings", label: "Settings", href: `/app/forms/${row.id}/settings` },
        { id: "versions", label: "Versions", href: `/app/forms/${row.id}/versions` },
      ],
      ...extra,
    });
  };

  app.get("/app/forms/:id", (c) => {
    const row = mustForm(c);
    if (!row) return c.notFound();
    const compiled = compileForm(JSON.parse(row.definition));
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const recent = listSubmissions(db, row.id, { limit: 5 }).items.map((s) => ({
      id: s.id, created: s.created_at, summary: compiled.fields.slice(0, 2).map((f) => s.data[f.name]).filter((v) => v !== undefined),
    }));
    return c.html(page("pages/app/form-overview.faqir", {
      page: formPage(c, row, "overview", {
        stats: {
          total: countSubmissions(db, row.id),
          week: listSubmissions(db, row.id, { since: weekAgo, limit: 1 }).total,
          fields: compiled.fields.length,
          versions: listVersions(db, row.id).length,
        },
        recent,
        appearance: compiled.appearance,
        wizard: compiled.wizard,
      }),
    }));
  });

  app.get("/app/forms/:id/submissions", (c) => {
    const row = mustForm(c);
    if (!row) return c.notFound();
    const compiled = compileForm(JSON.parse(row.definition));
    const q = c.req.query("q") ?? "";
    const version = c.req.query("version") ?? "";
    const { items, total } = listSubmissions(db, row.id, { q: q || undefined, version: version ? Number(version) : undefined, limit: 200 });
    const columns = compiled.fields.slice(0, 4);
    const rows = items.map((s) => ({
      id: s.id,
      created: s.created_at,
      version: s.version,
      cells: columns.map((col) => s.data[col.name] ?? null),
      answers: compiled.fields.filter((f) => s.data[f.name] !== undefined).map((f) => ({ label: f.title, value: s.data[f.name] })),
    }));
    const exportQuery = (q ? `&q=${encodeURIComponent(q)}` : "") + (version ? `&version=${encodeURIComponent(version)}` : "");
    return c.html(page("pages/app/form-submissions.faqir", {
      page: formPage(c, row, "submissions", {
        columns, rows, total, q, version,
        versions: listVersions(db, row.id).map((v) => ({ value: String(v.version), label: `Version ${v.version}`, selected: String(v.version) === version })),
        csvHref: `/api/v1/forms/${row.id}/submissions/export?format=csv${exportQuery}`,
        jsonHref: `/api/v1/forms/${row.id}/submissions/export?format=json${exportQuery}`,
      }),
    }));
  });

  app.get("/app/forms/:id/share", (c) => {
    const row = mustForm(c);
    if (!row) return c.notFound();
    const url = `${new URL(c.req.url).origin}/f/${row.slug}`;
    const embed = `<iframe src="${url}" title="${(JSON.parse(row.definition) as { schema: { title: string } }).schema.title.replace(/"/g, "&quot;")}" width="100%" height="900" style="border:0" loading="lazy"></iframe>`;
    return c.html(page("pages/app/form-share.faqir", {
      page: formPage(c, row, "share", {
        url, embed, urlJson: JSON.stringify(url), embedJson: JSON.stringify(embed),
        submitUrl: `${new URL(c.req.url).origin}/api/v1/f/${row.slug}/submissions`,
      }),
    }));
  });

  app.get("/app/forms/:id/settings", (c) => {
    const row = mustForm(c);
    if (!row) return c.notFound();
    return c.html(page("pages/app/form-settings.faqir", {
      page: formPage(c, row, "settings", {
        settings: { formId: row.id, open: row.status === "open", limit: row.submission_limit === null ? "" : String(row.submission_limit), slug: row.slug },
        documents: {
          reportId: row.confirmation_report_id ?? "", issue: Boolean(row.issue_on_submit), link: Boolean(row.thank_you_link),
          // Reports that print this form's submissions: the confirmations it can issue.
          reports: (db.prepare("SELECT id, definition FROM reports WHERE workspace_id = ? ORDER BY updated_at DESC").all(row.workspace_id) as { id: string; definition: string }[])
            .map((r) => ({ id: r.id, def: JSON.parse(r.definition) as { schema: { title: string }; source?: { kind: string; form?: string } } }))
            .filter((r) => r.def.source?.kind === "submission" && r.def.source.form === row.id)
            .map((r) => ({ id: r.id, title: r.def.schema.title, selected: r.id === row.confirmation_report_id })),
        },
      }),
    }));
  });

  app.get("/app/forms/:id/versions", (c) => {
    const row = mustForm(c);
    if (!row) return c.notFound();
    const versions = listVersions(db, row.id).map((v) => ({
      version: v.version, published: v.published_at, live: v.version === row.published_version,
      responses: listSubmissions(db, row.id, { version: v.version, limit: 1 }).total,
      href: `/api/v1/forms/${row.id}/versions/${v.version}`,
    }));
    return c.html(page("pages/app/form-versions.faqir", { page: formPage(c, row, "versions", { versions }) }));
  });

  /** The drag-and-drop designer. It loads and saves the definition through /api/v1. */
  app.get("/app/forms/:id/design", (c) => {
    const row = mustForm(c);
    if (!row) return c.notFound();
    return c.html(page("pages/app/designer.faqir", {
      page: {
        formId: row.id,
        slug: row.slug,
        title: (JSON.parse(row.definition) as { schema: { title: string } }).schema.title,
        themes: THEMES,
        accents: ACCENTS,
        defaults: DEFAULT_APPEARANCE,
      },
    }));
  });

  /** The draft, rendered exactly as the public page will be, marked as a preview. */
  app.get("/app/forms/:id/preview", (c) => {
    const row = mustForm(c);
    if (!row) return c.notFound();
    const v = c.req.query("version");
    const def = v ? getVersion(db, row.id, Number(v))?.definition : row.definition;
    if (!def) return c.notFound();
    return c.html(renderFormPage(compileForm(JSON.parse(def)), { action: "#", preview: true }));
  });

  reportPageRoutes(app, db, shell);

  app.get("/app/keys", (c) => {
    const keys = listApiKeys(db, c.var.principal.workspaceId).map((k) => ({ ...k, active: !k.revoked_at }));
    return c.html(page("pages/app/keys.faqir", {
      page: shell(c, "keys", "API keys", { keys, origin: new URL(c.req.url).origin }),
    }));
  });

  app.get("/app/settings", (c) => {
    const ws = db.prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?").get(c.var.principal.workspaceId) as { id: string; name: string; created_at: string };
    const members = db.prepare(
      "SELECT u.email, u.name, m.role, m.created_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at",
    ).all(ws.id);
    const invites = db.prepare("SELECT email, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC").all(ws.id);
    return c.html(page("pages/app/settings.faqir", {
      page: shell(c, "settings", "Workspace", { workspace: ws, members, invites, state: { name: ws.name } }),
    }));
  });

  return app;
}
