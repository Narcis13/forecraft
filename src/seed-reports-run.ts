// `npm run seed`, phase 2: one report per starter in the demo workspace, and
// six real documents — a paid invoice, a 60-line Romanian invoice, a window
// letter, a US Letter board report, an event confirmation issued from a real
// submission, and a survey summary of 120 seeded responses. Idempotent.

import { insertAsset } from "./assets/index.ts";
import type { DB } from "./db/index.ts";
import { checkSubmission, compileForm } from "./forms/model.ts";
import { getFormBySlug, getVersion, insertSubmission } from "./forms/store.ts";
import { computeMoney } from "./reports/money.ts";
import type { ReportDefinition } from "./reports/model.ts";
import { createDocument } from "./reports/service.ts";
import { fromStarter, loadStarter } from "./reports/starters.ts";
import { createReport, getReport, publishReport, voidDocument, type DocumentRow } from "./reports/store.ts";
import { prng, pulseAnswers } from "./seed-reports.ts";

export interface SeededDocument { name: string; report: string; document: DocumentRow }

/** A quiet vector mark for the invoice's sender: a monogram in a square. */
const NORTHFIELD_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <rect width="40" height="40" fill="#1f3a8a"/>
  <path d="M11 29V11l18 18V11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="square"/>
</svg>`;

/** Whole values replaced as they are (labels), before the substring map. */
const EXACT: Record<string, string> = { Email: "E-mail", Phone: "Telefon" };

function deepReplace<T>(value: T, map: [string, string][]): T {
  if (typeof value === "string" && EXACT[value as string]) return EXACT[value as string] as T;
  if (typeof value === "string") return map.reduce((s: string, [a, b]) => s.split(a).join(b), value as string) as T;
  if (Array.isArray(value)) return value.map((v) => deepReplace(v, map)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepReplace(v, map)])) as T;
  return value;
}

/** ~60 deterministic lines for a Romanian software and services invoice. */
function romanianLines(n = 60) {
  const r = prng(4071);
  const kinds = [
    { d: "Dezvoltare modul facturare electronică (e-Factura)", u: "oră", p: [245, 285], v: 21 },
    { d: "Integrare API transport și urmărire colete", u: "oră", p: [230, 270], v: 21 },
    { d: "Licență anuală platformă de gestiune a depozitului", u: "buc", p: [4800, 6200], v: 21 },
    { d: "Mentenanță și suport tehnic, nivel 2", u: "lună", p: [3200, 3900], v: 21 },
    { d: "Instruire utilizatori, sesiune la sediul clientului", u: "zi", p: [2100, 2600], v: 21 },
    { d: "Găzduire infrastructură cloud, regiunea București", u: "lună", p: [1450, 1980], v: 21 },
    { d: "Manuale tipărite pentru operatori de depozit", u: "buc", p: [38, 62], v: 11 },
    { d: "Audit de securitate și testare de penetrare", u: "zi", p: [3400, 4100], v: 21 },
    { d: "Migrare date din sistemul vechi de evidență", u: "oră", p: [210, 250], v: 21 },
    { d: "Cursuri online pentru șoferi și dispeceri", u: "loc", p: [180, 240], v: 11 },
  ];
  const sites = ["Cluj-Napoca", "București", "Timișoara", "Iași", "Constanța", "Brașov", "Oradea", "Sibiu"];
  // Romanian plurals for the units (1 oră, 15 ore; 1 zi, 4 zile; 1 lună, 3 luni; 1 loc, 2 locuri).
  const plural: Record<string, string> = { oră: "ore", zi: "zile", lună: "luni", buc: "buc", loc: "locuri" };
  let previous = -1;
  return Array.from({ length: n }, (_, i) => {
    // Never the same kind of line twice in a row: real invoices are not that repetitive.
    let at = Math.floor(r() * kinds.length);
    if (at === previous) at = (at + 1 + Math.floor(r() * (kinds.length - 1))) % kinds.length;
    previous = at;
    const k = kinds[at]!;
    const site = sites[Math.floor(r() * sites.length)]!;
    const price = Math.round((k.p[0] + r() * (k.p[1] - k.p[0])) * 100) / 100;
    const qty = k.u === "oră" ? 4 + Math.floor(r() * 36) : k.u === "buc" || k.u === "loc" ? 1 + Math.floor(r() * (k.p[1] < 100 ? 120 : 3)) : 1 + Math.floor(r() * 4);
    return { description: `${k.d}`, ...(i % 7 === 0 ? { detail: `Lucrarea ${String(i + 1).padStart(2, "0")} · ${site}` } : {}), qty, unit: qty === 1 ? k.u : plural[k.u]!, price, vat: k.v };
  });
}

export async function seedReports(db: DB, workspaceId: string, opts: { quiet?: boolean } = {}): Promise<SeededDocument[]> {
  const log = (...a: unknown[]) => { if (!opts.quiet) console.log(...a); };
  const existing = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE workspace_id = ?").get(workspaceId) as { n: number };
  if (existing.n > 0) { log("Reports already seeded; keeping them."); return []; }

  const logo = insertAsset(db, workspaceId, new TextEncoder().encode(NORTHFIELD_LOGO), "northfield-logo.svg");
  const make = (def: ReportDefinition, starter: string) => {
    const row = createReport(db, workspaceId, def, starter);
    publishReport(db, row);
    return getReport(db, workspaceId, row.id)!;
  };
  const out: SeededDocument[] = [];
  const issue = async (name: string, row: ReturnType<typeof make>, input: Parameters<typeof createDocument>[3]) => {
    const { doc } = await createDocument(db, workspaceId, row, input);
    out.push({ name, report: row.id, document: doc });
    log(`  ${name}: ${doc.number} (${doc.title})`);
    return doc;
  };

  // 1. The invoice, issued and paid: en-GB, EUR, one page, SEPA QR, PAID stamp.
  const invoiceDef = loadStarter("invoice");
  invoiceDef.layout[0]!.logo = `asset:${logo.id}`;
  const invoice = make(invoiceDef, "invoice");
  const paidData = structuredClone(invoiceDef.sample) as Record<string, unknown>;
  paidData.paid = Number(computeMoney(paidData, invoiceDef.money!, "EUR").total);
  await issue("invoice", invoice, { data: paidData, issue: true });

  // 2. The long invoice: ro-RO, RON, about 60 lines, three pages.
  const ro = deepReplace(loadStarter("invoice"), [
    ["VAT ID", "CUI"],
    ["Delivered under the master services agreement of 4\u00a0March\u00a02025.", "Conform contractului-cadru de servicii din 4\u00a0martie\u00a02025."],
    ["Payment", "Plata"], ["Please transfer", "Vă rugăm să transferați"], ["quoting", "cu mențiunea"], ["to IBAN", "în contul"],
    ["Payable within 30 days, net. Late payments accrue statutory interest (§ 288 BGB). Questions about this invoice:", "Termen de plată: 30 de zile de la emitere. Întârzierile atrag penalități conform Legii nr. 72/2013. Întrebări despre această factură:"], ["EPC payment code · settled", "Cod de plată EPC · achitat"],
    [" by {{ date(due) }}", " până la {{ date(due) }}"],
  ]) as ReportDefinition;
  ro.schema.title = "Factură";
  ro.appearance = { ...ro.appearance, locale: "ro-RO", currency: "RON", accent: "#7a1f2b" };
  ro.labels = { invoice: "Factură fiscală" };
  ro.numbering = { pattern: "CS-{YYYY}-{seq:5}" };
  ro.sample = {
    seller: {
      name: "Carpatica Software SRL", street: "Str. Republicii nr. 24", city: "400015 Cluj-Napoca", country: "România",
      vat: "RO 38412907", register: "J12/4471/2017", email: "facturare@carpatica.example", phone: "+40 264 555 120",
      bank: "Banca Carpatină SA", iban: "RO49AAAA1B31007593840000", bic: "AAAARO22",
    },
    customer: { name: "Dunărea Logistic SA", street: "Bd. Unirii nr. 15, et. 4", city: "030823 București", country: "România", vat: "RO 14327755" },
    reference: "Comanda 2026/0912", period: "1–30 septembrie 2026", due: "2026-11-14",
    items: romanianLines(60),
    paid: 0,
  };
  const roRow = make(ro, "invoice");
  await issue("invoice-ro", roRow, { data: ro.sample, issue: true });

  // 3. The business letter: en-GB, window address, fold marks, two signatures.
  const letter = make(loadStarter("letter"), "letter");
  await issue("letter", letter, { data: loadStarter("letter").sample, issue: true });

  // 4. The quarterly business report on US Letter.
  const br = make(loadStarter("business-report"), "business-report");
  await issue("business-report", br, { data: loadStarter("business-report").sample, issue: true });

  // 5. The event confirmation, issued from a real submission of the event form.
  const event = getFormBySlug(db, "agents-summit");
  if (event) {
    const def = fromStarter(db, workspaceId, "confirmation", { form: event.id });
    def.schema.title = "Summit confirmation";
    def.layout.unshift({ id: "organiser", block: "letterhead", name: "Halden Studio", lines: ["Rua da Boavista 84 · 1200-066 Lisbon · Portugal"], details: [{ label: "Tickets", value: "tickets@summit.example" }] });
    def.layout.splice(2, 0, {
      id: "attendee", block: "parties", parties: [
        { label: "Attendee", name: "{{ fullName ?? \"\" }}", lines: ["{{ company ?? \"\" }}", "{{ email ?? \"\" }}"] },
        { label: "Ticket", name: "{{ ticket ?? \"—\" }}", lines: ["LX Factory, Rua Rodrigues de Faria 103, Lisbon", "14–15 May 2026 · doors open 08:30"] },
      ],
    });
    // The parties block already prints who and which ticket: the answers leave those out.
    const answersBlock = def.layout.find((b: { id: string }) => b.id === "answers") as { omit?: string[] };
    answersBlock.omit = ["fullName", "email", "company", "ticket"];
    const conf = make(def, "confirmation");
    db.prepare("UPDATE forms SET confirmation_report_id = ?, issue_on_submit = 1, thank_you_link = 1 WHERE id = ?").run(conf.id, event.id);
    const compiled = compileForm(JSON.parse(getVersion(db, event.id, event.published_version ?? 1)!.definition));
    const answers = {
      fullName: "Ines Carvalho", email: "ines.carvalho@lumen.example", role: "Designer", company: "Lumen Studio",
      ticket: "Conference + workshops", workshops: ["Agent UX", "Forms for agents"], arrival: "2026-05-13",
      dietary: "Vegetarian", tshirt: "M", conduct: true,
    };
    const verdict = checkSubmission(compiled, answers);
    if (!verdict.valid) throw new Error(`seed confirmation answers are invalid: ${JSON.stringify(verdict.findings)}`);
    const sub = insertSubmission(db, event.id, event.published_version ?? 1, verdict.data, "seed");
    db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run("2026-04-08T10:42:17.000Z", sub.id);
    await issue("confirmation", conf, { submissionId: sub.id, issue: true });
  }

  // 6. The survey summary of the customer pulse: ~120 deterministic responses in September.
  const pulse = getFormBySlug(db, "customer-pulse");
  if (pulse) {
    const compiled = compileForm(JSON.parse(getVersion(db, pulse.id, pulse.published_version ?? 1)!.definition));
    for (const { answers, at } of pulseAnswers()) {
      const v = checkSubmission(compiled, answers);
      if (!v.valid) continue;
      const s = insertSubmission(db, pulse.id, pulse.published_version ?? 1, v.data, "seed");
      db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run(at, s.id);
    }
    const def = fromStarter(db, workspaceId, "survey-summary", { form: pulse.id });
    def.schema.title = "Customer pulse, September";
    const summary = make(def, "survey-summary");
    await issue("survey-summary", summary, { period: { since: "2026-09-01", until: "2026-09-30" }, issue: true });
  }

  // The blank starter, as a report nobody has issued yet.
  make(loadStarter("blank"), "blank");

  // A voided invoice, so the documents list shows every status.
  const wrong = structuredClone(invoiceDef.sample) as Record<string, unknown>;
  (wrong.customer as Record<string, unknown>).name = "Atlas Retail GmbH";
  const { doc: v } = await createDocument(db, workspaceId, invoice, { data: wrong, issue: true });
  voidDocument(db, v, "Issued to the German entity by mistake; reissued to Atlas Retail Europe B.V.");
  await createDocument(db, workspaceId, invoice, { data: invoiceDef.sample, issue: false });
  return out;
}
