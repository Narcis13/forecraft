// Phase 2 seed data: deterministic, pseudo-random customer-pulse answers (so a
// survey summary's numbers mean something), and the inputs of the six seed
// documents. Companies, people, VAT numbers and IBANs are invented; the IBANs
// are the IBAN registry's own published examples (valid checksums, no account).

/** mulberry32: a small, seedable PRNG — the same answers on every machine. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCALE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const FEATURES = [
  "The MCP server, from Claude or another agent host",
  "The REST API directly, from my own code",
  "The drag-and-drop designer in the dashboard",
  "Wizard forms with conditional steps",
  "CSV or JSON exports of submissions",
];
const NEXT = [
  "File uploads that land in my own storage bucket",
  "Signatures and consent records an auditor would accept",
  "Payments inside a form, with receipts",
  "Webhooks that retry until my server answers",
  "Team roles with per-form permissions",
];
const COMMENTS = [
  "The preview tool catches my agent’s mistakes before anyone sees them. That alone is worth it.",
  "Exports are great, but I would love a scheduled weekly CSV to our shared drive.",
  "Our support agent now builds the intake forms itself; I only review them. Huge time saver.",
  "Wizard steps confused two of our older customers — a progress label would help.",
  "Please add file uploads. We still email PDFs around for the onboarding packet.",
  "The designer feels fast. Undo saved me twice this month.",
  "I want the confirmation emails to carry our own letterhead.",
  "Rules are powerful but I needed the docs for the second one. Examples of ‘require when’ would help.",
  "Stable, quick, and the API errors tell me exactly which field is wrong.",
  "We moved three tools onto forecraft this quarter. Pricing for teams would make it four.",
];

/** `n` answers to the customer-pulse form, with submission times spread over September 2026. */
export function pulseAnswers(n = 120, seed = 20260930): { answers: Record<string, unknown>; at: string }[] {
  const r = prng(seed);
  const pick = <T>(xs: T[], weights: number[]): T => {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let i = 0; i < xs.length; i++) { x -= weights[i]!; if (x < 0) return xs[i]!; }
    return xs.at(-1)!;
  };
  const out: { answers: Record<string, unknown>; at: string }[] = [];
  for (let i = 0; i < n; i++) {
    const recommend = pick(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], [1, 1, 1, 1, 2, 3, 5, 12, 20, 28, 26]);
    const happy = Number(recommend) >= 8;
    const answers: Record<string, unknown> = {
      recommend,
      easy: pick(SCALE, happy ? [1, 2, 6, 34, 40] : [5, 12, 30, 25, 8]),
      agents: pick(SCALE, happy ? [2, 6, 18, 38, 26] : [10, 20, 34, 18, 6]),
    };
    const features = FEATURES.filter((_, j) => r() < [0.62, 0.48, 0.55, 0.27, 0.34][j]!);
    if (features.length) answers.features = features;
    if (r() < 0.86) answers.next = pick(NEXT, [30, 14, 18, 24, 14]);
    if (r() < 0.22) answers.comments = COMMENTS[Math.floor(r() * COMMENTS.length)]!;
    // 1–30 September 2026, weekdays twice as likely, office hours.
    let day = 1 + Math.floor(r() * 30);
    const dow = new Date(Date.UTC(2026, 8, day)).getUTCDay();
    if ((dow === 0 || dow === 6) && r() < 0.5) day = Math.min(30, day + (dow === 6 ? 2 : 1));
    const at = new Date(Date.UTC(2026, 8, day, 7 + Math.floor(r() * 10), Math.floor(r() * 60), Math.floor(r() * 60))).toISOString();
    out.push({ answers, at });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}
