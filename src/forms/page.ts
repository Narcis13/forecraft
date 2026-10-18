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
      measure: a.layout === "page" ? "content" : "narrow",
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
      state: { status: "idle", message: "" },
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

/** `faqir audit --stdin --json` over one page (the CLI is the only audit 1.2.5 ships; see FAQIR-UPSTREAM.md). */
export function auditHtml(html: string): Promise<AuditResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "audit", "--stdin", "--json"], { cwd: PROJECT, env: { ...process.env, FAQIR_FORCE_NODE: "1", NO_COLOR: "1" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => {
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
