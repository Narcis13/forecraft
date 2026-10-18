# Task — forecraft, phase 1

Goal: Build **forecraft**, a full SaaS prototype for forms in the agentic era: AI agents first, humans second, can set up, design, publish and collect submissions for forms (the Jotform / Typeform job, rebuilt around an API and an MCP server rather than around a mouse). Every pixel of the product — marketing site, auth, dashboard, the human drag-and-drop form designer, the public forms themselves, the thank-you pages — is built with **Faqir UI 1.2.5** from npm. Nothing else draws UI.
Done when: every command under **Checks** passes, every item under **Acceptance** is observed, and `docs/screenshots/` holds the Chrome screenshots listed there.
Scope: this folder (`C:\newme\forecraft`) and everything you create inside it. **Read-only:** `C:\newme\faqir-ui` (the upstream checkout, for reading source and docs only; never edit it, never run its scripts, never publish from it), `C:\newme\indirect` (a sibling project you may read for conventions), and everything else on this machine.
Limit: 8 hours or 60 iterations, whichever comes first.
Subagents: 5
Branch: new, `feat/phase-1` (this folder is not a git repository yet; see **Git**)
PR: no (no remote exists; see **Git**)
Unattended: yes

If a missing detail would change the result, pick the safest sensible default and record it under Decisions in `PROGRESS.md`. For anything else, choose a sensible default, say what it is, and start.

---

## The product

forecraft is a form platform whose first user is an agent. A human can do everything an agent can, through the dashboard and the designer, but the API and the MCP server are the product; the UI is one more client of the same API. Think of it as the form tool you would build if you expected most forms to be created by a Claude or GPT acting for a person, and most submissions to be read by one.

**One form definition, three faces.** A form is a JSON Schema (the data), a Faqir UI schema (the widgets, groups, wizard steps), an optional `@faqir-ui/rules` definition (cross-field logic), and an appearance (theme, accent, layout, cover, thank-you). That one JSON document is what an agent sends over the API, what the designer edits visually, and what `@faqir-ui/forms` renders as the public form. Never let three representations exist.

### What ships in phase 1

1. **Marketing site** (`/`, `/pricing`, `/docs`, `/for-agents`): a landing page built from Faqir 1.2 patterns (`site-header`, hero, `bento`, `logo-cloud`, `testimonials`, `faq`, `cta`) with motion (`reveal`, `backdrop`, `glow`, `marquee`, `spotlight`) used with taste. `/for-agents` is the page an agent reads: it says how to get a key, links `/llms.txt`, `/openapi.json` and the MCP install line. `/docs` is rendered from markdown you write.
2. **Accounts and workspaces**: email + password sign-up and sign-in (session cookie, scrypt hashes from `node:crypto`), one workspace per account on sign-up, members can be invited by email address (no email is sent in phase 1; the invite is a link shown on screen). Per-workspace **API keys** (`fc_live_…`, shown once, stored hashed, revocable). This is a prototype: no billing, no email delivery, no OAuth.
3. **The API** (`/api/v1`, JSON, bearer API key or session): forms CRUD, versions (`publish` snapshots the definition; the public form always serves the latest published version), submissions (list, get, export CSV/JSON, delete), workspace and keys. Validation of a submission runs server-side with `@faqir-ui/rules` on the same definition the browser enforced, so the server's verdict is the browser's verdict. Errors are RFC 9457 problem details. `/openapi.json` describes all of it and `/llms.txt` summarises it for agents. Rate limit per key (in-memory is fine).
4. **The MCP server** (`packages/mcp`, stdio; for now `node packages/mcp/index.mjs`): wraps the API for any MCP host. Tools at minimum: `forecraft_create_form`, `forecraft_update_form`, `forecraft_get_form`, `forecraft_list_forms`, `forecraft_publish_form`, `forecraft_preview_form` (returns the rendered HTML and the audit result so the agent can self-check), `forecraft_list_submissions`, `forecraft_get_submission`. A resource `forecraft://form/{id}` returns the definition. Auth by `FORECRAFT_API_KEY` and `FORECRAFT_URL` env vars. Add it to this repository's `.mcp.json` so the next session can use it.
5. **Dashboard** (`/app/...`): forms list, form page (overview, submissions table with filters and CSV export, share panel with the public URL and an embed snippet, settings, versions), workspace settings, API keys. Faqir `dashboard-shell`, `crud-table`, `settings-page` patterns and the `table`, `dialog`, `drawer`, `toast`, `command-palette` recipes. Empty states that actually help ("Create your first form, or ask your agent to").
6. **The human designer** (`/app/forms/:id/design`): the old-style drag-and-drop editor for people. Three panes: a palette of field types on the left, the canvas in the middle, a properties panel on the right. Drag a field type onto the canvas; reorder by drag; select a field to edit label, name, placeholder, required, options, validation, width, help text; group fields into sections; switch the form to wizard mode and arrange steps; a rules tab for show/hide and require-when logic; an appearance tab (theme, accent, cover image URL, layout, thank-you message, redirect). A **JSON tab** shows the exact definition the API would return, editable, with live validation; the visual canvas and the JSON tab are two views of one object. **Live preview** renders the real public form (via the same server render) in an iframe, with a phone/desktop toggle. Built on faqir-core (`l-data`, `l-for`, `l-on`) and native HTML5 drag and drop; no React, no Vue, no editor library. Autosave with a visible "saved" state; publish from the designer.
7. **Public forms** (`/f/:slug`): rendered by `@faqir-ui/forms` `renderForm` on the server, driven by `faqir-core.js`, `faqir-validate.js` and `faqir-rules.js` in the browser. Single-page or wizard. Cover/hero when the form has one. Submit without a full-page reload (fetch to the API, then the thank-you state or redirect). Closed forms and submission limits show a proper closed page. Honeypot field and a per-IP rate limit for spam. Accessible: keyboard-only completion, visible focus, errors announced, reduced motion respected.
8. **Seed and demo**: `npm run seed` creates a demo workspace, a demo API key (printed once; `.env.example` carries only a placeholder), and four published forms that show the range: a contact form, a multi-step event registration (wizard, rules), a customer survey (ratings, scales, long choices), and a job application (file-free, repeatable groups). These are also the forms you screenshot.

### Quality bar

We aim for the highest quality possible. The public forms must be **stunning**: a person should want to fill them in. Concretely:

- Every form page uses a real Faqir theme (31 ship; `faqir theme generate` makes more from one accent). The appearance tab exposes theme and accent; the four seed forms use four different themes so the screenshots prove the range.
- Typography, spacing and motion come from tokens, never from ad-hoc CSS. If you find yourself writing a CSS rule that Faqir should have provided, that is an upstream note (see **Faqir upstream loop**), and your local workaround is scoped and commented.
- Entrance motion (`reveal`, staggered groups) on the form's sections; `backdrop` or a cover behind the hero when the form has one; a `stamp` or `badge` for "closed" and "preview"; all of it still and plain under `prefers-reduced-motion`.
- The designer feels like a tool, not a demo: drag feedback, drop indicators, keyboard reordering (alt+arrow), undo/redo (at least 20 steps), unsaved-changes guard.
- The marketing site would pass as a real launch page. Copy is short, specific and about agents.
- Phone width works everywhere a person goes: marketing, auth, public forms, dashboard lists. The designer may require a wide viewport and should say so on a phone.

## Stack (decided; change only with a recorded reason)

The simplest stack that fits a framework built on "no classes, no build step, zero dependencies":

- **Runtime:** Node 24 (installed: 24.19). TypeScript with Node's native type stripping (`node file.ts`); no bundler, no transpile step. Bun is not installed; do not require it.
- **Server:** `hono` with `@hono/node-server`. Routes under `src/routes/`. Static files from `public/` and the Faqir `ui/` directory.
- **Database:** SQLite through the built-in `node:sqlite`; no ORM. Hand-written migrations in `src/db/migrations/*.sql`, applied at boot. Database file at `data/forecraft.db` (git-ignored). Submissions are stored as JSON text plus indexed columns (form id, version, created_at, ip hash).
- **Rendering:** server-rendered HTML. Pages are `.faqir` templates compiled with `@faqir-ui/template` (`/compile` once at boot, cached) and rendered with `render`. Public forms are produced by `@faqir-ui/forms` `renderForm` inside a page template. Interactivity in the browser is faqir-core plus its plugins, nothing else.
- **Faqir ownership:** `npm i -D faqir-ui-cli@1.2.5`, then `npx faqir init` with `output_dir: ./ui`, `npx faqir add …` for what you use, `npx faqir fonts add …` for self-hosted fonts, `npx faqir context --skill`. Commit `ui/` and `faqir.config.json`. Runtime packages: `@faqir-ui/forms@1.2.5`, `@faqir-ui/rules@1.2.5`, `@faqir-ui/template@1.2.5`. Pin all four to 1.2.5 exactly.
- **Session tooling:** add `@faqir-ui/mcp` to `.mcp.json` (`npx -y @faqir-ui/mcp`) and use `faqir_get_manifest`, `faqir_audit_html` and `faqir_generate` while authoring markup. Use Context7 for Hono and `node:sqlite` docs; do not guess APIs.
- **Validation:** JSON Schema shape via `@faqir-ui/rules` (it covers the subset `@faqir-ui/forms` renders; if a form needs more than that subset, the API rejects the definition with a clear message rather than adding ajv).
- **Tests:** `node --test` for unit and API tests (spin the server on a random port against a temp database). Playwright (`@playwright/test`, Chromium only) for a small end-to-end suite: sign up, create a form via API, open the public form, submit, see it in the dashboard, round-trip the designer. `npx playwright install chromium` is allowed.
- **Lint:** `npx faqir audit` over every HTML and `.faqir` output, as a check, not a suggestion. `tsc --noEmit` for types.
- **No** React, Vue, Tailwind, Prisma, Drizzle, Zod, Express, Next, Vite, or any CSS of your own beyond `public/app.css` for page-level composition that tokens cannot express. Each exception goes in `FAQIR-UPSTREAM.md`.

Layout:

```
forecraft/
├── src/            server: app.ts, routes/, db/, render/, forms/, auth/, api/
├── templates/      .faqir page templates and partials
├── public/         app.css, designer.js, form.js, images
├── ui/             Faqir-owned files (faqir init / add); committed
├── packages/mcp/   the forecraft MCP server
├── tests/          unit, api, e2e
├── docs/           docs pages (markdown), screenshots/
├── data/           sqlite (ignored)
├── FAQIR-UPSTREAM.md
├── PROGRESS.md     (ignored)
└── package.json    scripts: dev, start, seed, test, test:e2e, typecheck, audit, check
```

## Checks

Run all of these before the first change (baseline: expected to fail or not exist) and after every milestone:

```bash
npm run check
```

`check` = `typecheck` + `audit` + `test`. Plus, at milestones that touch the browser:

```bash
npm run test:e2e
```

And `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health` returns `200` while `npm start` is running.

## Acceptance (observe each one; do not infer)

1. An agent with only an API key and `curl` can: create a form from a JSON Schema + UI schema, preview it (HTML + audit result), publish it, read the public URL, and later list and export its submissions. Document the exact curl sequence in `docs/for-agents.md`.
2. An MCP host (test with `node packages/mcp/index.mjs` over stdio and a scripted `tools/list` + `tools/call`) can do the same through the tools listed above.
3. A person can sign up, land in an empty dashboard, create a form in the designer by dragging five different field types, group two of them into a section, add one show-when rule, switch to wizard mode with two steps, pick a theme, publish, open the public URL, fill it in on a phone-width viewport, and see the submission with its answers in the dashboard table and in the CSV export.
4. A submission that breaks a rule is rejected in the browser before it is sent and, when sent with curl around the browser, rejected by the server with a 422 problem that names the field and the rule.
5. Every HTML page the server emits audits clean with `faqir audit` (no errors; warnings listed in `PROGRESS.md` with a reason).
6. The four seed forms render on four different themes and are screenshotted desktop and phone: `docs/screenshots/{contact,event,survey,application}-{desktop,phone}.png`, plus `landing-desktop.png`, `dashboard-desktop.png`, `designer-desktop.png`. A reviewer looking only at those screenshots should say "stunning", not "fine".
7. `FAQIR-UPSTREAM.md` exists with at least the header and a numbered entry for every rough edge found (see below), and `docs/faqir-digest.md` holds the prioritised shortlist.

## Faqir upstream loop (the compounding part)

forecraft is also the next test bed for Faqir UI. The deal: we build on the released 1.2.5, we never fork it, and everything it makes hard is written down precisely enough that the maintainer can fix it upstream in one sitting.

- Keep `FAQIR-UPSTREAM.md` in the format already used by `C:\newme\indirect\FAQIR-UPSTREAM.md` (read its header and two entries before you write your first). One numbered entry per issue, under a section (Engine, Plugins, Forms, Rules, Template, Primitives, Recipes, Patterns, Themes, CLI/audit, MCP, Docs), each with **Seen** (what you did and what happened, with the page and the markup), **Where** (file and function in the 1.2.5 source under `C:\newme\faqir-ui`, which you read but never edit), **Why** (the cause, when you found it), **Here** (what forecraft does about it today: a scoped workaround, a local patch under `ui/`, or nothing), and **Suggested fix** (concrete, as a change to the upstream repository, with the test that would guard it).
- Write the entry **in the same step you hit the issue**, before moving on. Not at the end.
- Missing capability counts as much as a bug: a widget `@faqir-ui/forms` cannot render (file upload, signature, rating scale, matrix, address, phone with country), a token the themes lack, a pattern the designer needed, a CLI command that would have saved an hour, a manifest field the MCP server should expose, a doc page that was wrong. Also record **what worked unusually well**, in one short section at the end, so the maintainer knows what not to break.
- Local patches to files under `ui/` are allowed only when there is no scoped workaround, and every patch has an entry and a `/* forecraft patch: see FAQIR-UPSTREAM.md #n */` comment at the top of the file, so `faqir upgrade` conflicts are deliberate.
- Never edit `C:\newme\faqir-ui`. Never open an issue or PR on GitHub from this session. The maintainer applies the digest by hand.
- At **Finish**, write `docs/faqir-digest.md`: the ten entries most worth fixing first, ordered by (how much it hurt forecraft) × (how general it is), each in three lines, each linking its entry number. This is the handoff into the next Faqir release.

## How to work

1. **Orient.** If `PROGRESS.md` exists, read it, confirm it still matches the code, and resume from its next step. Read only what the next decision needs. Before writing any Faqir markup, read the relevant manifest (MCP `faqir_get_manifest` or `ui/**/*.manifest.json`); before touching `@faqir-ui/forms`, `@faqir-ui/rules` or `@faqir-ui/template`, read that package's README from `node_modules`.
2. **Baseline.** Run the checks before changing anything and note the result. Every change is measured against it.
3. **Small steps.** Make one bounded change and run the checks it affects. Keep it if it moves toward done; revert just that change if it doesn't. Don't repeat a failed approach without a new reason.
4. **Simpler wins.** When two solutions work equally well, keep the one with less code. Removing code without losing anything counts as progress. Don't add abstractions, config, or files the task doesn't need. The form definition is one JSON document; resist a second model.
5. **Don't touch the evaluator.** Never edit, skip, or loosen a check to make it pass. That includes `faqir audit` rules and the `audit.forbid_directives` list. If a check looks wrong, record it in `PROGRESS.md` and move on.

Suggested order (milestones; each one commits): scaffold + Faqir init + health + checks skeleton → DB + auth + workspaces + API keys → form model + API + `@faqir-ui/forms` public render + rules validation → public form page polished on one theme → dashboard → MCP server → seed + four themed forms → designer (canvas, properties, JSON tab, preview) → designer (rules, wizard, appearance, undo) → marketing site → e2e + screenshots → Finish.

## Subagents

Use them when they save real time or context. Otherwise, do the work yourself.

- **Good fits:** independent pieces that can run in parallel, wide codebase searches, a fresh-eyes review at the end. **Poor fits:** small tasks and tightly coupled edits.
- **Pick the cheapest model that can do the job well.** Sonnet 5.5 for well-defined work: searching, mechanical edits, writing tests, following a clear plan. Opus 5.5 for ambiguous design, hard debugging, and the final review.
- **Brief them fully.** A subagent doesn't see this conversation. Give it the goal, the files, its scope, the Faqir rules above (attribute protocol, no custom CSS, audit must pass, write upstream entries), and exactly what to return.
- **No overlapping edits.** Two subagents never edit the same files at the same time.
- **Verify before keeping.** A subagent saying "done" is a claim. Run the checks on its work yourself.
- **Only you commit.** Subagents edit files; they don't touch git.
- Stay within the subagent limit above, counting every agent you start. Good candidates here: the marketing site (one agent, after the dashboard exists so it shares the header), the MCP server (one agent, after the API is stable), the Playwright suite (one agent, near the end), the final review (one agent, Opus).

## Visual check

For anything a person will look at (UI, layout, styles, forms, generated pages), open it in Chrome and look at it before calling it done.

- Start the dev server if needed, open the page in a new tab, and take a screenshot.
- Compare it with what was asked. Try the main interaction (drag a field; submit a form; open a dialog), check the console for errors, and check a phone-width viewport for every public and marketing page.
- Look at each seed form on its theme, light and dark where the theme has both, and with `prefers-reduced-motion` once.
- Treat this as one of the checks: fix what looks wrong, then look again. Save the final screenshots listed under Acceptance to `docs/screenshots/`.
- Leave my other tabs and logged-in accounts alone.
- If Chrome isn't connected, say so in `PROGRESS.md` and use the built-in browser pane; never claim something looks right without seeing it.

## Git

Commits and pushes to the work branch are pre-approved. You don't need to ask.

- **Init.** This folder is not a repository. `git init -b main`, write `.gitignore` (`node_modules/`, `data/`, `.env`, `test-results/`, `playwright-report/`), make the first commit on `main` with the scaffold, then `git switch -c feat/phase-1` and do all work there. Unattended work never lands directly on `main`.
- **Remote.** There is none. Do not create one (that is outward-facing). If one named `origin` appears later, push after every commit; until then, note "no remote" once in `PROGRESS.md` and keep committing locally.
- **Commit at each milestone**, meaning a step that passes its checks and leaves nothing worse than the baseline. Stage only the files you changed. Never commit secrets, `.env`, `data/`, build output, or `PROGRESS.md` (add it to `.git/info/exclude`). Keep messages short: what changed and why.
- **Never** force-push, rewrite history, merge to `main`, or open anything on GitHub.

## When I'm away (`Unattended: yes`)

- Don't wait for me. Where you'd normally ask, pick the safest reasonable option, record it under Decisions, and keep going.
- Anything on the ask-first list below: don't do it. Leave it as a next step for me.
- If one part is blocked, record why and move to another part. When nothing useful is left or the limit is reached, run Finish and stop. Don't spin.
- Keep `PROGRESS.md` current after every milestone. On a long run your context may get compacted, and this file is how you stay on track.
- If a Faqir limitation blocks a feature outright, ship the feature in its reduced form, write the upstream entry, and say so under Decisions. Do not fork Faqir to get around it.

## Guardrails

- Stay inside scope. `C:\newme\faqir-ui` is read-only; its git state must be untouched at the end (`git -C C:\newme\faqir-ui status --porcelain` prints nothing).
- Ask before anything else irreversible or outward-facing: deploy, publish to npm, create a remote, delete data, send messages, spend money.
- Commit before a risky edit so it can be undone.
- Before retrying an external write, check whether the first attempt already landed.
- Secrets: generate the session secret and seed key at runtime, print the seed key once, never write a real key to a committed file.

## Progress file

Keep `PROGRESS.md` (out of git via `.git/info/exclude`). Short:

- **Done:** finished milestones and their check results
- **Decisions:** choices that shape the result, and why
- **Tried and failed:** what didn't work, and why
- **Faqir:** count of upstream entries so far, and the last one's number
- **Git:** branch, last commit, "no remote"
- **Next:** one concrete step to resume from

## Finish

1. Reread the full diff once with fresh eyes (a review subagent on Opus works well here). Look for bugs, leftover debug code, duplicated form-model logic, custom CSS that a token could replace, and complexity you can remove.
2. Rerun all checks on the final version, including `test:e2e` and the Chrome check with the final screenshots.
3. Write `docs/faqir-digest.md` (see the upstream loop) and make sure `FAQIR-UPSTREAM.md` is complete and in format.
4. Commit the final state.
5. Report briefly:
   - branch and last commit
   - what changed, with file paths, and the exact curl sequence an agent uses
   - each check: pass or fail, with the real output for failures
   - for visual changes, what you looked at in Chrome and where the screenshots are
   - if you used subagents: how many, which model, and for what
   - the top five Faqir upstream entries, one line each
   - decisions made without me, and anything unresolved

If the limit or a blocker stops you, say exactly what's left. Never report a result you didn't observe.
