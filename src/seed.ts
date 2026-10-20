// The demo workspace: four published forms that show the range, a handful of
// submissions, and an API key printed once. Used by `npm run seed`, the audit
// and the tests.

import { randomBytes } from "node:crypto";
import { createAccount, createApiKey, findUserByEmail, defaultWorkspace } from "./auth/index.ts";
import type { DB } from "./db/index.ts";
import { checkSubmission, compileForm, type FormDefinition } from "./forms/model.ts";
import { createForm, insertSubmission, listForms, publishForm } from "./forms/store.ts";

export const DEMO_EMAIL = "demo@forecraft.dev";

const scale5 = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

export const SEED_FORMS: { slug: string; definition: FormDefinition; answers: Record<string, unknown>[] }[] = [
  {
    slug: "contact",
    definition: {
      schema: {
        title: "Tell us about your project",
        description: "A person on the studio team reads every message and replies within one working day.",
        type: "object",
        properties: {
          name: { type: "string", title: "Your name", minLength: 2, examples: ["Ada Lovelace"] },
          email: { type: "string", format: "email", title: "Work email", examples: ["ada@analytical.engine"] },
          company: { type: "string", title: "Company", description: "Optional — helps us route your message." },
          topic: { type: "string", title: "What is it about?", enum: ["A new project", "A partnership", "Press", "Something else"] },
          budget: { type: "string", title: "Rough budget", enum: ["Under €5k", "€5k – €15k", "€15k – €50k", "Over €50k", "Not sure yet"] },
          message: { type: "string", title: "Message", minLength: 20, maxLength: 2000, description: "What are you building, and by when?" },
          newsletter: { type: "boolean", title: "Send me the monthly studio letter" },
        },
        required: ["name", "email", "topic", "message"],
      },
      ui: {
        name: { width: "half" },
        email: { width: "half" },
        company: { width: "half" },
        topic: { width: "half" },
        message: { widget: "textarea", rows: 6, placeholder: "We are launching…" },
        newsletter: { widget: "switch" },
        "ui:groups": [
          { title: "About you", fields: ["name", "email", "company", "topic"] },
          { title: "The project", description: "Budget appears when this is a new project.", fields: ["budget", "message", "newsletter"] },
        ],
      },
      rules: {
        rules: [
          { id: "budget-for-projects", show: "budget", when: { "==": [{ var: "topic" }, "A new project"] } },
          { id: "budget-required-for-projects", require: "budget", when: { "==": [{ var: "topic" }, "A new project"] } },
        ],
      },
      appearance: {
        theme: "nordic", accent: "theme", layout: "card",
        cover: { image: "", eyebrow: "Studio Halden · Oslo" },
        submitLabel: "Send message",
        thankYou: { title: "Message received", message: "Thank you. Someone from the studio will write back within one working day." },
      },
    },
    answers: [
      { name: "Grace Hopper", email: "grace@navy.example", company: "Compilers Inc.", topic: "A new project", budget: "€15k – €50k", message: "We need a booking flow our support agent can edit on its own. Launch in March.", newsletter: true },
      { name: "Linus Pauling", email: "linus@example.org", topic: "Press", message: "Writing a piece on agent-native tools, would love a quote from the team." },
      { name: "Margaret Hamilton", email: "mh@apollo.example", company: "Apollo Labs", topic: "A partnership", message: "We build evaluation suites for agents and think there is a fit here." },
    ],
  },
  {
    slug: "agents-summit",
    definition: {
      schema: {
        title: "Agents & Interfaces Summit 2026",
        description: "Two days in Lisbon on building software whose first user is an agent. 14–15 May.",
        type: "object",
        properties: {
          fullName: { type: "string", title: "Full name", minLength: 2 },
          email: { type: "string", format: "email", title: "Email", description: "Your ticket and the schedule go here." },
          role: { type: "string", title: "What do you do?", enum: ["Engineer", "Designer", "Product", "Founder", "Researcher", "Something else"] },
          company: { type: "string", title: "Company or project" },
          ticket: { type: "string", title: "Ticket", enum: ["Conference", "Conference + workshops", "Remote"] },
          workshops: {
            type: "array", title: "Workshops", description: "Pick up to all four; seats are first come, first served.",
            items: { type: "string", enum: ["Agent UX", "MCP in production", "Evals that matter", "Forms for agents"] }, uniqueItems: true,
          },
          arrival: { type: "string", format: "date", title: "Arriving on" },
          dietary: { type: "string", title: "Dietary needs", enum: ["None", "Vegetarian", "Vegan", "Gluten-free", "Halal", "Something else"] },
          dietaryOther: { type: "string", title: "Tell us what you need" },
          tshirt: { type: "string", title: "T-shirt size", enum: ["XS", "S", "M", "L", "XL", "XXL"] },
          conduct: { type: "boolean", title: "I have read and agree to the code of conduct" },
        },
        required: ["fullName", "email", "role", "ticket", "conduct"],
      },
      ui: {
        fullName: { width: "half" },
        email: { width: "half" },
        role: { width: "half" },
        company: { width: "half" },
        dietary: { width: "half" },
        tshirt: { width: "half" },
        ticket: { enumLabels: ["Conference — €390", "Conference + workshops — €590", "Remote — €90"] },
        "ui:wizard": {
          label: "Registration steps",
          steps: [
            { title: "You", description: "So we can print a badge that is right.", fields: ["fullName", "email", "role", "company"] },
            { title: "Your ticket", description: "Workshops run on the morning of day two.", fields: ["ticket", "workshops", "arrival"] },
            { title: "Extras", description: "Last bits, then you are in.", fields: ["dietary", "dietaryOther", "tshirt", "conduct"] },
          ],
        },
      },
      rules: {
        rules: [
          { id: "workshops-with-ticket", show: "workshops", when: { "==": [{ var: "ticket" }, "Conference + workshops"] } },
          { id: "arrival-in-person", show: "arrival", when: { "!=": [{ var: "ticket" }, "Remote"] } },
          { id: "dietary-other-shown", show: "dietaryOther", when: { "==": [{ var: "dietary" }, "Something else"] } },
          { id: "dietary-other-required", require: "dietaryOther", when: { "==": [{ var: "dietary" }, "Something else"] } },
          { id: "conduct-accepted", validate: { "==": [{ var: "conduct" }, true] }, path: "conduct", message: "Please accept the code of conduct to register." },
        ],
      },
      appearance: {
        theme: "luxe", accent: "theme", layout: "split",
        cover: { image: "/images/cover-summit.svg", eyebrow: "Lisbon · 14–15 May 2026" },
        submitLabel: "Register",
        thankYou: { title: "You are registered", message: "Your ticket is on its way to your inbox. See you in Lisbon." },
      },
    },
    answers: [
      { fullName: "Ada Lovelace", email: "ada@example.com", role: "Engineer", company: "Analytical", ticket: "Conference + workshops", workshops: ["MCP in production", "Forms for agents"], arrival: "2026-05-13", dietary: "Vegetarian", tshirt: "M", conduct: true },
      { fullName: "Alan Kay", email: "alan@example.com", role: "Researcher", ticket: "Remote", dietary: "None", conduct: true },
      { fullName: "Joan Clarke", email: "joan@example.com", role: "Founder", company: "Bletchley Data", ticket: "Conference", arrival: "2026-05-14", dietary: "Something else", dietaryOther: "No nuts, please", tshirt: "S", conduct: true },
    ],
  },
  {
    slug: "customer-pulse",
    definition: {
      schema: {
        title: "How was your month with forecraft?",
        description: "Six questions, two minutes. Every answer is read by the people who build the product.",
        type: "object",
        properties: {
          recommend: {
            type: "string", title: "How likely are you to recommend forecraft to a colleague?",
            enum: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
            description: "0 is not at all likely, 10 is extremely likely.",
          },
          easy: { type: "string", title: "Building a form takes me less time than it used to.", enum: scale5 },
          agents: { type: "string", title: "My agent creates forms without my help.", enum: scale5 },
          features: {
            type: "array", title: "What did you use this month?",
            items: {
              type: "string",
              enum: [
                "The MCP server, from Claude or another agent host",
                "The REST API directly, from my own code",
                "The drag-and-drop designer in the dashboard",
                "Wizard forms with conditional steps",
                "CSV or JSON exports of submissions",
              ],
            },
          },
          next: {
            type: "string", title: "What should we build next?",
            enum: [
              "File uploads that land in my own storage bucket",
              "Signatures and consent records an auditor would accept",
              "Payments inside a form, with receipts",
              "Webhooks that retry until my server answers",
              "Team roles with per-form permissions",
            ],
          },
          comments: { type: "string", title: "Anything else?", maxLength: 1500 },
        },
        required: ["recommend", "easy", "agents"],
      },
      ui: {
        recommend: { widget: "scale", minLabel: "Not at all likely", maxLabel: "Extremely likely" },
        easy: { widget: "scale", minLabel: "Strongly disagree", maxLabel: "Strongly agree" },
        agents: { widget: "scale", minLabel: "Strongly disagree", maxLabel: "Strongly agree" },
        features: { widget: "checkbox-group" },
        next: { widget: "radio" },
        comments: { widget: "textarea", rows: 4, placeholder: "Bugs, wishes, praise — all welcome." },
        "ui:groups": [
          { title: "The big one", fields: ["recommend"] },
          { title: "Your month", description: "How much do you agree?", fields: ["easy", "agents", "features"] },
          { title: "What comes next", fields: ["next", "comments"] },
        ],
      },
      appearance: {
        theme: "candy", accent: "theme", layout: "page",
        cover: { image: "", eyebrow: "Customer pulse · October" },
        submitLabel: "Send my answers",
        thankYou: { title: "Thank you — really", message: "We read every answer. The roadmap for next month is shaped by what you just told us." },
      },
    },
    answers: [
      { recommend: "9", easy: "Strongly agree", agents: "Agree", features: ["The MCP server, from Claude or another agent host", "CSV or JSON exports of submissions"], next: "Webhooks that retry until my server answers", comments: "The MCP preview tool is magic." },
      { recommend: "7", easy: "Agree", agents: "Neutral", features: ["The drag-and-drop designer in the dashboard"], next: "File uploads that land in my own storage bucket" },
      { recommend: "10", easy: "Strongly agree", agents: "Strongly agree", features: ["The REST API directly, from my own code", "Wizard forms with conditional steps"], next: "Team roles with per-form permissions" },
    ],
  },
  {
    slug: "senior-product-engineer",
    definition: {
      schema: {
        title: "Senior Product Engineer, Agents",
        description: "Remote in Europe. You will build the parts of forecraft that agents touch first: the API, the MCP server and the renderer.",
        type: "object",
        properties: {
          name: { type: "string", title: "Full name", minLength: 2 },
          email: { type: "string", format: "email", title: "Email" },
          location: { type: "string", title: "Where are you based?", examples: ["Lisbon, Portugal"] },
          portfolio: { type: "string", format: "uri", title: "Portfolio or GitHub", examples: ["https://github.com/you"] },
          experience: {
            type: "array", title: "Recent experience", description: "Your last few roles, most recent first.",
            minItems: 1, maxItems: 4,
            items: {
              type: "object",
              properties: {
                company: { type: "string", title: "Company" },
                role: { type: "string", title: "Role" },
                years: { type: "integer", title: "Years", minimum: 0, maximum: 40 },
              },
              required: ["company", "role"],
            },
          },
          referees: {
            type: "array", title: "Referees", description: "Optional. We only contact them after a final interview.",
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                name: { type: "string", title: "Name" },
                email: { type: "string", format: "email", title: "Email" },
              },
            },
          },
          motivation: { type: "string", title: "Why this role?", minLength: 80, maxLength: 3000, description: "A few honest paragraphs beat a polished cover letter." },
          start: { type: "string", format: "date", title: "Earliest start date" },
          authorised: { type: "string", title: "Can you work in the EU without sponsorship?", enum: ["Yes", "No, I would need sponsorship"] },
        },
        required: ["name", "email", "location", "experience", "motivation", "authorised"],
      },
      ui: {
        name: { width: "half" },
        email: { width: "half" },
        location: { width: "half" },
        portfolio: { width: "half" },
        start: { width: "half" },
        authorised: { width: "half" },
        experience: {
          addLabel: "Add another role",
          removeLabel: "Remove this role",
          items: { company: { width: "half" }, role: { width: "half" }, years: { width: "third" } },
        },
        referees: {
          addLabel: "Add a referee",
          removeLabel: "Remove referee",
          items: { name: { width: "half" }, email: { width: "half" } },
        },
        motivation: { widget: "textarea", rows: 7 },
        "ui:groups": [
          { title: "About you", fields: ["name", "email", "location", "portfolio"] },
          { title: "Experience", fields: ["experience", "referees"] },
          { title: "Why us", fields: ["motivation", "start", "authorised"] },
        ],
      },
      appearance: {
        theme: "paper", accent: "theme", layout: "page",
        cover: { image: "/images/cover-careers.svg", eyebrow: "Careers · Engineering" },
        submitLabel: "Send application",
        thankYou: { title: "Application received", message: "Thank you for applying. You will hear from a person, not a template, within ten days." },
      },
    },
    answers: [
      {
        name: "Barbara Liskov", email: "barbara@example.com", location: "Boston, USA", portfolio: "https://github.com/example",
        experience: [{ company: "CLU Systems", role: "Staff Engineer", years: 6 }, { company: "Venus OS", role: "Engineer", years: 4 }],
        motivation: "I have spent a decade on abstractions that other programs consume, and agents are the next consumer. I want to build the API they reach for first.",
        start: "2026-01-12", authorised: "No, I would need sponsorship",
      },
    ],
  },
  {
    slug: "expense-claim",
    definition: {
      schema: {
        title: "Expense claim",
        description: "One trip, line items in a table, receipts noted. Finance reviews every claim within three working days.",
        type: "object",
        properties: {
          claimant: { type: "string", title: "Your name", minLength: 2, examples: ["Ada Lovelace"] },
          email: { type: "string", format: "email", title: "Work email", examples: ["ada@forecraft.dev"] },
          department: { type: "string", title: "Department", enum: ["Engineering", "Product", "Design", "Operations", "Sales"] },
          costCentre: { type: "string", title: "Cost centre", examples: ["ENG-240"] },
          tripPurpose: { type: "string", title: "Purpose of the trip", minLength: 10, maxLength: 500 },
          departOn: { type: "string", format: "date", title: "Departed on" },
          returnOn: { type: "string", format: "date", title: "Returned on" },
          currency: { type: "string", title: "Currency", enum: ["EUR", "USD", "GBP"] },
          lines: {
            type: "array",
            title: "Line items",
            description: "Every receipt on its own row. Dates must fall inside the trip.",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                date: { type: "string", format: "date", title: "Date" },
                category: {
                  type: "string",
                  title: "Category",
                  enum: ["Travel", "Lodging", "Meals", "Supplies", "Other"],
                },
                vendor: { type: "string", title: "Vendor", minLength: 1 },
                amount: { type: "number", title: "Amount", minimum: 0.01, maximum: 50000, multipleOf: 0.01 },
                notes: { type: "string", title: "Notes" },
              },
              required: ["date", "category", "vendor", "amount"],
            },
          },
          advance: { type: "number", title: "Cash advance already paid", minimum: 0, maximum: 50000, multipleOf: 0.01, default: 0 },
          policy: { type: "boolean", title: "I confirm these expenses follow the travel policy" },
        },
        required: ["claimant", "email", "department", "tripPurpose", "departOn", "returnOn", "currency", "lines", "policy"],
      },
      ui: {
        claimant: { width: "half" },
        email: { width: "half" },
        department: { width: "half" },
        costCentre: { width: "half" },
        departOn: { width: "half" },
        returnOn: { width: "half" },
        currency: { width: "half" },
        advance: { width: "half" },
        tripPurpose: { widget: "textarea", rows: 3, placeholder: "Client workshop in Lisbon; product discovery with three customers." },
        lines: {
          addLabel: "Add a line",
          removeLabel: "Remove line",
          items: {
            date: { width: "third" },
            category: { width: "third" },
            vendor: { width: "third" },
            amount: { width: "third" },
            notes: { width: "half", placeholder: "Receipt #…" },
          },
        },
        "ui:groups": [
          { title: "Claimant", fields: ["claimant", "email", "department", "costCentre"] },
          { title: "The trip", fields: ["tripPurpose", "departOn", "returnOn", "currency"] },
          { title: "Expenses", description: "A row per receipt — the table your agent and finance both read.", fields: ["lines", "advance", "policy"] },
        ],
      },
      rules: {
        rules: [
          {
            id: "policy-accepted",
            validate: { "==": [{ var: "policy" }, true] },
            path: "policy",
            message: "Please confirm the expenses follow the travel policy.",
          },
        ],
      },
      appearance: {
        theme: "paper", accent: "blue", layout: "page",
        cover: { image: "", eyebrow: "Finance · Expense claims" },
        submitLabel: "Submit claim",
        thankYou: { title: "Claim received", message: "Finance will review it within three working days. You will get an email when it is approved or needs a receipt." },
      },
    },
    answers: [
      {
        claimant: "Grace Hopper",
        email: "grace@navy.example",
        department: "Engineering",
        costCentre: "ENG-240",
        tripPurpose: "Agents & Interfaces Summit — speak on forms for agents and run the MCP workshop.",
        departOn: "2026-05-13",
        returnOn: "2026-05-16",
        currency: "EUR",
        lines: [
          { date: "2026-05-13", category: "Travel", vendor: "TAP Air Portugal", amount: 218.4, notes: "LIS–OSL return" },
          { date: "2026-05-13", category: "Lodging", vendor: "Hotel da Baixa", amount: 312, notes: "3 nights" },
          { date: "2026-05-14", category: "Meals", vendor: "Time Out Market", amount: 24.5 },
        ],
        advance: 100,
        policy: true,
      },
      {
        claimant: "Alan Kay",
        email: "alan@example.com",
        department: "Product",
        tripPurpose: "Two days of customer visits in Berlin for the Q2 roadmap.",
        departOn: "2026-04-02",
        returnOn: "2026-04-04",
        currency: "EUR",
        lines: [
          { date: "2026-04-02", category: "Travel", vendor: "Deutsche Bahn", amount: 89 },
          { date: "2026-04-02", category: "Lodging", vendor: "Hotel Oderberger", amount: 190 },
        ],
        advance: 0,
        policy: true,
      },
    ],
  },
];

export interface DemoResult { userId: string; workspaceId: string; apiKey: string; password: string | null; forms: { id: string; slug: string }[] }

export async function seedDemo(db: DB, opts: { quiet?: boolean; password?: string } = {}): Promise<DemoResult> {
  const log = (...a: unknown[]) => { if (!opts.quiet) console.log(...a); };
  let user = findUserByEmail(db, DEMO_EMAIL);
  let password: string | null = null;
  let workspaceId: string;
  if (user) {
    workspaceId = defaultWorkspace(db, user.id)!;
    log(`Demo account ${DEMO_EMAIL} already exists; keeping it.`);
  } else {
    password = opts.password ?? process.env.FORECRAFT_DEMO_PASSWORD ?? randomBytes(9).toString("base64url");
    const created = await createAccount(db, { email: DEMO_EMAIL, password, name: "Demo", workspace: "Halden Studio" });
    user = { ...created.user, password_hash: "" };
    workspaceId = created.workspace.id;
  }

  const existing = new Set(listForms(db, workspaceId).map((f) => f.slug));
  for (const seed of SEED_FORMS) {
    if (existing.has(seed.slug)) continue;
    const row = createForm(db, workspaceId, seed.definition, seed.slug);
    const v = publishForm(db, row);
    const compiled = compileForm(seed.definition);
    for (const answers of seed.answers) {
      const verdict = checkSubmission(compiled, answers);
      if (!verdict.valid) throw new Error(`seed answers for ${seed.slug} are invalid: ${JSON.stringify(verdict.findings)}`);
      insertSubmission(db, row.id, v.version, verdict.data, "seed");
    }
  }

  const { secret } = createApiKey(db, workspaceId, "Demo key (seed)");
  const forms = listForms(db, workspaceId).map((f) => ({ id: f.id, slug: f.slug }));
  log(`\nDemo workspace ready: ${forms.length} forms.`);
  log(`  Sign in:  ${DEMO_EMAIL}${password ? ` / ${password}` : " (password unchanged)"}`);
  log(`  API key:  ${secret}   ← shown once; store it now`);
  return { userId: user.id, workspaceId, apiKey: secret, password, forms };
}
