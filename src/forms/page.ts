// The public face of a form: the page `/f/:slug` serves, the preview the API
// returns and the designer's live iframe all come from this one function.

import { spawn } from "node:child_process";
import { join } from "node:path";
import { page } from "../render/index.ts";
import type { CompiledForm } from "./model.ts";

const SCENES: Record<string, string> = { card: "aurora", split: "spotlight", page: "grid" };

export interface FormPageOptions {
  action: string;
  preview: boolean;
  /** The published version this page shows; sent back so answers are checked against it. */
  version?: number;
}

export function renderFormPage(form: CompiledForm, opts: FormPageOptions): string {
  const a = form.appearance;
  const schema = form.definition.schema;
  return page("pages/form.faqir", {
    page: {
      title: schema.title,
      description: schema.description ?? null,
      skin: a.theme,
      accent: a.accent === "theme" ? null : a.accent,
      scheme: a.scheme === "auto" ? null : a.scheme,
      layout: a.layout,
      measure: "narrow",
      titleSize: a.layout === "split" ? "3xl" : "display",
      // A wizard draws its own card per step; anything else sits on one card unless the layout is "page".
      framed: !form.wizard && a.layout !== "page",
      scene: SCENES[a.layout],
      coverImage: a.cover?.image || null,
      eyebrow: a.cover?.eyebrow || null,
      formHtml: form.html,
      wizard: form.wizard,
      submitLabel: a.submitLabel,
      thankYou: a.thankYou,
      redirect: a.redirect,
      preview: opts.preview,
      action: opts.action,
      version: opts.version ?? null,
      state: { status: "idle", message: "", confirmation: "" },
    },
  });
}

export function renderClosedPage(form: CompiledForm, reason: "closed" | "full" | "unpublished"): string {
  const a = form.appearance;
  return page("pages/closed.faqir", {
    page: {
      title: form.definition.schema.title,
      skin: a.theme,
      accent: a.accent === "theme" ? null : a.accent,
      scheme: a.scheme === "auto" ? null : a.scheme,
      reason,
    },
  });
}

export interface AuditResult {
  passed: boolean;
  counts: { critical: number; error: number; warning: number; info: number };
  findings: { rule_id: string; severity: string; line: number; message: string }[];
}

const CLI = join(import.meta.dirname, "../../node_modules/faqir-ui-cli/dist/faqir.mjs");
const PROJECT = join(import.meta.dirname, "../..");

// At most two audits run at once, each for at most 15 s: every designer edit
// previews, and each preview is a process.
const MAX_AUDITS = 2;
let running = 0;
const waiting: (() => void)[] = [];

/** `faqir audit --stdin --json` over one page (the CLI is the only audit 1.2.5 ships; FAQIR-UPSTREAM.md #7). */
export async function auditHtml(html: string): Promise<AuditResult> {
  if (running >= MAX_AUDITS) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await runAudit(html);
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function runAudit(html: string): Promise<AuditResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "audit", "--stdin", "--json"], { cwd: PROJECT, env: { ...process.env, FAQIR_FORCE_NODE: "1", NO_COLOR: "1" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 15_000);
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out);
        resolve({
          passed: json.passed,
          counts: json.counts,
          findings: (json.results ?? []).map((r: { rule_id: string; severity: string; line: number; message: string }) => ({
            rule_id: r.rule_id, severity: r.severity, line: r.line, message: r.message,
          })),
        });
      } catch (err) {
        reject(new Error(`faqir audit gave no JSON: ${out.slice(0, 300)}`));
      }
    });
    child.stdin.end(html);
  });
}
