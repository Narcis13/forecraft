// The words the renderer writes itself, per language. A report overrides any of
// them with `labels` (a flat { key: text } map); `{n}` and `{total}` are the
// page counter's places.

export const LANGUAGES = ["en", "ro", "de", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

const en = {
  invoice: "Invoice", creditNote: "Credit note", quote: "Quote", receipt: "Receipt", letter: "Letter", report: "Report",
  confirmation: "Confirmation", summary: "Summary", record: "Submission record",
  number: "Number", date: "Date", issueDate: "Issue date", dueDate: "Due date", period: "Period", reference: "Reference",
  page: "Page {n} of {total}",
  from: "From", billTo: "Bill to", shipTo: "Ship to", to: "To",
  description: "Description", quantity: "Qty", unitPrice: "Unit price", amount: "Amount", rate: "Rate",
  subtotal: "Subtotal", discount: "Discount", vat: "VAT", tax: "Tax", total: "Total", paid: "Paid", amountDue: "Amount due",
  draft: "Draft", void: "Void", copy: "Copy", paidStamp: "Paid",
  bank: "Bank", iban: "IBAN", bic: "BIC", paymentTerms: "Payment terms", scanToPay: "Scan to pay",
  signature: "Signature", name: "Name", role: "Role", place: "Place",
  submitted: "Submitted", answers: "Answers", responses: "Responses", average: "Average", nps: "Net Promoter Score",
  promoters: "Promoters", passives: "Passives", detractors: "Detractors", yes: "Yes", no: "No", none: "—",
  table: "Data table", of: "of",
};
export type LabelKey = keyof typeof en;
export type Labels = Record<LabelKey, string>;

const ro: Labels = {
  invoice: "Factură", creditNote: "Factură de stornare", quote: "Ofertă", receipt: "Chitanță", letter: "Scrisoare", report: "Raport",
  confirmation: "Confirmare", summary: "Rezumat", record: "Fișa răspunsului",
  number: "Număr", date: "Data", issueDate: "Data emiterii", dueDate: "Scadența", period: "Perioada", reference: "Referință",
  page: "Pagina {n} din {total}",
  from: "Furnizor", billTo: "Cumpărător", shipTo: "Livrare la", to: "Către",
  description: "Descriere", quantity: "Cant.", unitPrice: "Preț unitar", amount: "Valoare", rate: "Cotă",
  subtotal: "Subtotal", discount: "Reducere", vat: "TVA", tax: "Taxe", total: "Total", paid: "Achitat", amountDue: "Total de plată",
  draft: "Ciornă", void: "Anulat", copy: "Copie", paidStamp: "Achitat",
  bank: "Banca", iban: "IBAN", bic: "BIC", paymentTerms: "Termen de plată", scanToPay: "Scanați pentru plată",
  signature: "Semnătura", name: "Nume", role: "Funcția", place: "Locul",
  submitted: "Trimis", answers: "Răspunsuri", responses: "Răspunsuri", average: "Media", nps: "Net Promoter Score",
  promoters: "Promotori", passives: "Pasivi", detractors: "Detractori", yes: "Da", no: "Nu", none: "—",
  table: "Tabel de date", of: "din",
};

const de: Labels = {
  invoice: "Rechnung", creditNote: "Gutschrift", quote: "Angebot", receipt: "Quittung", letter: "Brief", report: "Bericht",
  confirmation: "Bestätigung", summary: "Zusammenfassung", record: "Antwortprotokoll",
  number: "Nummer", date: "Datum", issueDate: "Rechnungsdatum", dueDate: "Fällig am", period: "Zeitraum", reference: "Referenz",
  page: "Seite {n} von {total}",
  from: "Von", billTo: "Rechnungsempfänger", shipTo: "Lieferadresse", to: "An",
  description: "Beschreibung", quantity: "Menge", unitPrice: "Einzelpreis", amount: "Betrag", rate: "Satz",
  subtotal: "Zwischensumme", discount: "Rabatt", vat: "USt.", tax: "Steuer", total: "Gesamt", paid: "Bezahlt", amountDue: "Zu zahlen",
  draft: "Entwurf", void: "Storniert", copy: "Kopie", paidStamp: "Bezahlt",
  bank: "Bank", iban: "IBAN", bic: "BIC", paymentTerms: "Zahlungsbedingungen", scanToPay: "Zum Bezahlen scannen",
  signature: "Unterschrift", name: "Name", role: "Funktion", place: "Ort",
  submitted: "Eingegangen", answers: "Antworten", responses: "Antworten", average: "Durchschnitt", nps: "Net Promoter Score",
  promoters: "Promotoren", passives: "Passive", detractors: "Kritiker", yes: "Ja", no: "Nein", none: "—",
  table: "Datentabelle", of: "von",
};

const fr: Labels = {
  invoice: "Facture", creditNote: "Avoir", quote: "Devis", receipt: "Reçu", letter: "Lettre", report: "Rapport",
  confirmation: "Confirmation", summary: "Synthèse", record: "Fiche de réponse",
  number: "Numéro", date: "Date", issueDate: "Date d’émission", dueDate: "Échéance", period: "Période", reference: "Référence",
  page: "Page {n} sur {total}",
  from: "Émetteur", billTo: "Facturer à", shipTo: "Livrer à", to: "À",
  description: "Désignation", quantity: "Qté", unitPrice: "Prix unitaire", amount: "Montant", rate: "Taux",
  subtotal: "Sous-total", discount: "Remise", vat: "TVA", tax: "Taxe", total: "Total", paid: "Réglé", amountDue: "Montant dû",
  draft: "Brouillon", void: "Annulé", copy: "Copie", paidStamp: "Payé",
  bank: "Banque", iban: "IBAN", bic: "BIC", paymentTerms: "Conditions de paiement", scanToPay: "Scanner pour payer",
  signature: "Signature", name: "Nom", role: "Fonction", place: "Lieu",
  submitted: "Envoyé", answers: "Réponses", responses: "Réponses", average: "Moyenne", nps: "Net Promoter Score",
  promoters: "Promoteurs", passives: "Passifs", detractors: "Détracteurs", yes: "Oui", no: "Non", none: "—",
  table: "Tableau de données", of: "sur",
};

const SETS: Record<Language, Labels> = { en, ro, de, fr };
export const LABEL_KEYS = Object.keys(en) as LabelKey[];

/** "ro-RO" → "ro"; anything unknown → "en". */
export function languageOf(locale: string): Language {
  const lang = locale.split("-")[0]!.toLowerCase();
  return (LANGUAGES as readonly string[]).includes(lang) ? (lang as Language) : "en";
}

export function labelsFor(locale: string, overrides?: Partial<Record<string, string>>): Labels {
  return { ...SETS[languageOf(locale)], ...(overrides ?? {}) } as Labels;
}
