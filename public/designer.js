// forecraft designer — the drag-and-drop editor for people.
//
// One object, `def`, is the form definition exactly as the API returns it
// ({ schema, ui, rules, appearance }). The canvas, the properties panel, the
// rules list, the appearance controls and the JSON tab are all views of it;
// every edit goes through apply(), which replaces `def`, records undo history,
// autosaves (PATCH /api/v1/forms/:id) and refreshes the live preview
// (POST /api/v1/preview → the real public page in an iframe).
//
// A new form is not stored until its first change: the page opens on a starter
// definition and the first save creates it (POST /api/v1/forms).
//
// Built on faqir-core (l-data, l-for, l-on) and native HTML5 drag and drop.
(function () {
  "use strict";

  var HISTORY = 60;

  // Field types on the palette: what each adds to the schema and the UI schema.
  var KINDS = [
    { id: "text", label: "Short text", icon: "type", schema: { type: "string", title: "Short answer" } },
    { id: "textarea", label: "Long text", icon: "text-align-start", schema: { type: "string", title: "Long answer" }, ui: { widget: "textarea", rows: 4 } },
    { id: "email", label: "Email", icon: "mail", schema: { type: "string", format: "email", title: "Email" } },
    { id: "number", label: "Number", icon: "hash", schema: { type: "number", title: "Number" } },
    { id: "date", label: "Date", icon: "calendar", schema: { type: "string", format: "date", title: "Date" } },
    { id: "url", label: "Link", icon: "link", schema: { type: "string", format: "uri", title: "Website" } },
    { id: "choice", label: "Single choice", icon: "circle-check", schema: { type: "string", title: "Pick one", enum: ["Option A", "Option B", "Option C"] }, ui: { widget: "radio" } },
    { id: "dropdown", label: "Dropdown", icon: "chevron-down", schema: { type: "string", title: "Choose", enum: ["First", "Second", "Third", "Fourth", "Fifth"] }, ui: { widget: "select" } },
    { id: "multi", label: "Checkboxes", icon: "list", schema: { type: "array", title: "Pick any", items: { type: "string", enum: ["One", "Two", "Three"] }, uniqueItems: true }, ui: { widget: "checkbox-group" } },
    { id: "scale", label: "Scale", icon: "star", schema: { type: "string", title: "How would you rate it?", enum: ["1", "2", "3", "4", "5"] }, ui: { widget: "scale", minLabel: "Poor", maxLabel: "Excellent" } },
    { id: "yesno", label: "Checkbox", icon: "check", schema: { type: "boolean", title: "I agree" } },
    { id: "switch", label: "Switch", icon: "sliders-horizontal", schema: { type: "boolean", title: "Turn it on" }, ui: { widget: "switch" } },
    {
      id: "repeat",
      label: "Repeatable rows",
      icon: "layers",
      schema: {
        type: "array",
        title: "Line items",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            label: { type: "string", title: "Label" },
            qty: { type: "integer", title: "Qty", minimum: 1, maximum: 9999 },
            amount: { type: "number", title: "Amount", minimum: 0 },
          },
          required: ["label", "qty"],
        },
      },
      // Three thirds fill one row from the tablet tier up.
      ui: {
        addLabel: "Add a row",
        removeLabel: "Remove row",
        items: { label: { width: "third" }, qty: { width: "third" }, amount: { width: "third" } },
      },
    },
  ];
  var KIND = {};
  KINDS.forEach(function (k) { KIND[k.id] = k; });

  // The column types a repeatable row can hold (rows take scalars only; a row's choice is a dropdown).
  var COLUMN_TYPES = [
    { id: "text", label: "Text", schema: { type: "string" } },
    { id: "number", label: "Number", schema: { type: "number" } },
    { id: "integer", label: "Whole number", schema: { type: "integer" } },
    { id: "email", label: "Email", schema: { type: "string", format: "email" } },
    { id: "date", label: "Date", schema: { type: "string", format: "date" } },
    { id: "dropdown", label: "Dropdown", schema: { type: "string", enum: ["Option A", "Option B"] } },
    { id: "checkbox", label: "Checkbox", schema: { type: "boolean" } },
  ];

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function kindOf(schema, ui) {
    ui = ui || {};
    var widget = ui.widget || ui["ui:widget"];
    if (widget === "scale") return "scale";
    if (schema.type === "boolean") return widget === "switch" ? "switch" : "yesno";
    if (schema.type === "number" || schema.type === "integer") return "number";
    if (schema.type === "array") return schema.items && schema.items.type === "object" ? "repeat" : "multi";
    if (schema.type === "object") return "object";
    if (schema.enum) {
      if (schema.enum.join(",") === "1,2,3,4,5") return "scale";
      if (widget === "select" || (!widget && schema.enum.length > 4)) return "dropdown";
      return "choice";
    }
    if (schema.format === "email") return "email";
    if (schema.format === "date") return "date";
    if (schema.format === "uri") return "url";
    if (widget === "textarea") return "textarea";
    return "text";
  }

  function columnType(s) {
    if (s.type === "boolean") return "checkbox";
    if (s.type === "integer") return "integer";
    if (s.type === "number") return "number";
    if (s.enum) return "dropdown";
    if (s.format === "email") return "email";
    if (s.format === "date") return "date";
    return "text";
  }

  function kindMeta(id) {
    return KIND[id] || { id: id, label: id === "repeat" ? "Repeatable group" : "Group", icon: "layers" };
  }

  /** "What's your name?" → "whatsYourName" (unique among `taken`). */
  function nameFor(title, taken) {
    var plain = String(title).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    var words = plain.replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).filter(Boolean).slice(0, 4);
    var base = words.map(function (w, i) { return i ? w[0].toUpperCase() + w.slice(1) : w; }).join("") || "field";
    if (/^[0-9]/.test(base)) base = "f" + base;
    var name = base, n = 2;
    while (taken[name]) name = base + n++;
    return name;
  }

  /** The keys of `obj` other than `name`, as a lookup. */
  function others(obj, name) {
    var out = {};
    Object.keys(obj).forEach(function (k) { if (k !== name) out[k] = true; });
    return out;
  }

  /** A name still follows its label while it is the name the label would make. */
  function followsLabel(props, name) {
    var s = props[name];
    return !!s && nameFor(s.title || "", others(props, name)) === name;
  }

  // ── Field references in rules ─────────────────────────────────────────────
  // A rule names fields as its target (show, require, compute, path) and inside
  // its logic: {var: n}, {var: [n, default]}, {missing: [n…]}, {missing_some: [k, [n…]]}.
  // "addr.city" and "rows[0].n" refer to the fields addr and rows.
  var TARGETS = ["show", "require", "compute", "path"];
  function refersTo(ref, name) {
    return ref === name || (typeof ref === "string" && (ref.indexOf(name + ".") === 0 || ref.indexOf(name + "[") === 0));
  }
  function mapLogic(node, fn) {
    if (Array.isArray(node)) return node.map(function (n) { return mapLogic(n, fn); });
    if (!node || typeof node !== "object") return node;
    var out = {};
    Object.keys(node).forEach(function (op) {
      var arg = node[op];
      if (op === "var") out.var = Array.isArray(arg) ? [typeof arg[0] === "string" ? fn(arg[0]) : arg[0]].concat(arg.slice(1)) : typeof arg === "string" ? fn(arg) : arg;
      else if (op === "missing" && Array.isArray(arg)) out.missing = arg.map(function (n) { return typeof n === "string" ? fn(n) : mapLogic(n, fn); });
      else if (op === "missing_some" && Array.isArray(arg)) out.missing_some = [arg[0], (arg[1] || []).map(fn)];
      else out[op] = mapLogic(arg, fn);
    });
    return out;
  }
  /** Rewrite every field a rule names: fn(name) → new name. */
  function mapRule(rule, fn) {
    var out = {};
    Object.keys(rule).forEach(function (k) {
      out[k] = TARGETS.indexOf(k) >= 0 && typeof rule[k] === "string" ? fn(rule[k]) : k === "id" || k === "message" ? rule[k] : mapLogic(rule[k], fn);
    });
    return out;
  }
  function ruleUses(rule, name) {
    var hit = false;
    mapRule(rule, function (n) { if (refersTo(n, name)) hit = true; return n; });
    return hit;
  }

  function sectionList(d) {
    return d.ui && (d.ui["ui:wizard"] ? d.ui["ui:wizard"].steps : d.ui["ui:groups"]);
  }

  /** Rename field `from` to `to` everywhere the definition names it. */
  function renameIn(d, from, to) {
    var props = {};
    Object.keys(d.schema.properties).forEach(function (k) { props[k === from ? to : k] = d.schema.properties[k]; });
    d.schema.properties = props;
    if (d.schema.required) d.schema.required = d.schema.required.map(function (n) { return n === from ? to : n; });
    if (d.ui) {
      if (d.ui[from]) { d.ui[to] = d.ui[from]; delete d.ui[from]; }
      var list = sectionList(d);
      if (list) list.forEach(function (s) { s.fields = s.fields.map(function (n) { return n === from ? to : n; }); });
    }
    var swap = function (n) { return refersTo(n, from) ? to + n.slice(from.length) : n; };
    if (d.rules && d.rules.rules) d.rules.rules = d.rules.rules.map(function (r) { return mapRule(r, swap); });
    if (d.ui && d.ui["ui:wizard"]) d.ui["ui:wizard"].steps.forEach(function (st) { if (st.when) st.when = mapLogic(st.when, swap); });
  }

  /** Set or clear one key of a field's UI schema, dropping what is left empty. */
  function setUi(d, name, key, value) {
    d.ui = d.ui || {};
    d.ui[name] = d.ui[name] || {};
    if (value === undefined || value === "" || value === null || value === false) delete d.ui[name][key]; else d.ui[name][key] = value;
    if (!Object.keys(d.ui[name]).length) delete d.ui[name];
    if (!Object.keys(d.ui).length) delete d.ui;
  }

  /**
   * What is saved: the working copy without its empty sections. A section you
   * just added has no fields yet, which the renderer refuses; it stays on the
   * canvas until you fill or remove it.
   */
  function serialise(def) {
    var list = sectionList(def);
    if (!list || list.every(function (s) { return s.fields.length; })) return def;
    var out = clone(def);
    var key = out.ui["ui:wizard"] ? "ui:wizard" : "ui:groups";
    var kept = sectionList(out).filter(function (s) { return s.fields.length; });
    if (key === "ui:wizard") out.ui["ui:wizard"].steps = kept; else out.ui["ui:groups"] = kept;
    return out;
  }

  function api(method, path, body) {
    return fetch("/api/v1" + path, {
      method: method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var err = new Error(json.detail || res.statusText);
          err.problems = json.errors || [{ pointer: "", detail: json.detail }];
          throw err;
        }
        return json;
      });
    });
  }

  // ── Problems in plain words ──────────────────────────────────────────────
  // The API names a fault by JSON pointer and the renderer by its own path
  // (uiSchema["ui:groups"][3].fields). People know sections and labels.
  function humanProblem(p, def) {
    var props = (def && def.schema && def.schema.properties) || {};
    var label = function (n) { return props[n] ? "“" + (props[n].title || n) + "”" : "“" + n + "”"; };
    var place = function (text) {
      return String(text)
        .replace(/uiSchema\["ui:groups"\]\[(\d+)\](\.\w+)?/g, function (_m, i) { return "Section " + (Number(i) + 1); })
        .replace(/uiSchema\["ui:wizard"\]\.steps\[(\d+)\](\.\w+)?/g, function (_m, i) { return "Step " + (Number(i) + 1); })
        .replace(/uiSchema\["ui:groups"\]/g, "A section")
        .replace(/uiSchema\["ui:wizard"\](\.steps)?/g, "A step")
        .replace(/(?:schema|uiSchema)(?:\.properties)?\.([A-Za-z_]\w*)((?:\.\w+|\[\d+\])*)/g, function (_m, n) { return label(n); });
    };
    var detail = String(p.detail || "");
    var pointer = String(p.pointer || "");
    if (/fields must be a non-empty/.test(detail)) return place(detail.split(" ")[0]) + " has no fields yet. Drag a field into it, or remove it.";
    var unknown = /references unknown property "([^"]+)"/.exec(detail);
    if (unknown) return place(detail.split(" ")[0]) + " lists a field that is no longer on the form (" + unknown[1] + "). Fix it in the JSON tab.";
    if (/more than once/.test(detail)) return "A field sits in two sections at once. Fix it in the JSON tab.";
    if (/^\/rules/.test(pointer) && /rule-refs/.test(detail)) return "A rule names a field that is not on the form any more. Delete the rule, or fix it in the JSON tab.";
    if (/^\/rules/.test(pointer)) return "A rule cannot work as written: " + detail.replace(/^[\w-]+: /, "");
    if (pointer === "/schema/title") return "The form needs a title.";
    var m = /^\/(?:ui|schema\/properties)\/([^/]+)/.exec(pointer);
    if (m && props[m[1]]) return label(m[1]) + ": " + place(detail);
    return place(detail) || "The form could not be saved.";
  }

  // ── Conditions in plain words (the rules tab) ────────────────────────────
  var OPS = {
    eq: "is", neq: "is not", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most",
    includes: "includes", excludes: "does not include", filled: "is filled in", empty: "is empty",
    ticked: "is ticked", unticked: "is not ticked",
  };
  var DATE_OPS = { gt: "is after", gte: "is on or after", lt: "is before", lte: "is on or before" };
  var MATH = { "+": "+", "-": "−", "*": "×", "/": "÷" };

  function opsFor(kind) {
    if (kind === "yesno" || kind === "switch") return ["ticked", "unticked"];
    if (kind === "multi") return ["includes", "excludes", "filled", "empty"];
    if (kind === "number" || kind === "scale" || kind === "date") return ["eq", "neq", "gt", "gte", "lt", "lte", "filled", "empty"];
    return ["eq", "neq", "filled", "empty"];
  }

  function conditionFor(field, op, value, kind) {
    var v = { var: field };
    if (op === "filled") return { "!": { missing: [field] } };
    if (op === "empty") return { missing: [field] };
    if (op === "ticked") return { "==": [v, true] };
    if (op === "unticked") return { "!=": [v, true] };
    if (op === "includes") return { in: [value, v] };
    if (op === "excludes") return { "!": { in: [value, v] } };
    var sym = { eq: "==", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
    if (kind === "date" && op !== "eq" && op !== "neq") return { date: [v, sym, value] };
    if (kind === "number" || (kind === "scale" && op !== "eq" && op !== "neq")) value = Number(value);
    var out = {};
    out[sym] = [v, value];
    return out;
  }

  function describeCondition(when, titleOf) {
    if (!when || typeof when !== "object") return null;
    var op = Object.keys(when)[0];
    var args = when[op];
    var q = function (x) { return "“" + x + "”"; };
    var syms = { ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" };
    if ((op === "and" || op === "or") && Array.isArray(args)) {
      var parts = args.map(function (a) { return describeCondition(a, titleOf); });
      return parts.indexOf(null) >= 0 ? null : parts.join(op === "and" ? " and " : " or ");
    }
    if ((op === "==" || op === "!=") && args[0] && args[0].var !== undefined) {
      if (args[1] === true) return titleOf(args[0].var) + (op === "==" ? " is ticked" : " is not ticked");
      if (args[1] === false) return titleOf(args[0].var) + (op === "==" ? " is not ticked" : " is ticked");
      return titleOf(args[0].var) + (op === "==" ? " is " : " is not ") + q(args[1]);
    }
    if (syms[op] && Array.isArray(args) && args.length === 2 && args[0] && args[0].var !== undefined) return titleOf(args[0].var) + " " + OPS[syms[op]] + " " + args[1];
    if (op === "date" && Array.isArray(args) && args[0] && args[0].var !== undefined && syms[args[1]]) return titleOf(args[0].var) + " " + DATE_OPS[syms[args[1]]] + " " + args[2];
    if (op === "in" && args[1] && args[1].var !== undefined) return titleOf(args[1].var) + " includes " + q(args[0]);
    if (op === "missing") return titleOf(args[0]) + " is empty";
    if (op === "!" && args.missing) return titleOf(args.missing[0]) + " is filled in";
    if (op === "!" && args.in) return titleOf(args.in[1].var) + " does not include " + q(args.in[0]);
    return null;
  }

  function describeFormula(value, titleOf) {
    var op = value && typeof value === "object" ? Object.keys(value)[0] : "";
    var args = op && value[op];
    if (!MATH[op] || !Array.isArray(args) || args.length !== 2 || !args[0] || args[0].var === undefined) return null;
    var right = args[1] && args[1].var !== undefined ? titleOf(args[1].var) : args[1];
    return titleOf(args[0].var) + " " + MATH[op] + " " + right;
  }

  function blankCondition() { return { field: "", op: "eq", value: "" }; }
  function blankRule(verb) { return { verb: verb || "show", target: "", match: "all", conditions: [blankCondition()], a: "", math: "*", b: "", bNumber: "" }; }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return Promise.resolve();
  }

  function register(Faqir) {
    Faqir.data("designer", function () {
      return {
        formId: "",
        starter: null,
        slug: "",
        themes: [],
        accents: [],
        def: null,
        loaded: false,
        // views of `def`, rebuilt by render()
        mode: "flat",
        sections: [],
        rulesView: [],
        fieldOptions: [],
        jsonText: "",
        publishState: "draft",
        // editor state
        kinds: KINDS,
        columnTypes: COLUMN_TYPES,
        selected: "",
        editKey: "",
        tab: "build",
        device: "desktop",
        drop: null,
        dragging: null,
        status: "saved",
        statusText: "All changes saved",
        problems: [],
        jsonError: "",
        audit: null,
        title: "",
        publishing: false,
        announce: "",
        history: [],
        cursor: -1,
        lastEdit: { key: "", at: 0 },
        lastNudge: 0,
        saveTimer: 0,
        inflight: null,
        previewTimer: 0,
        previewSeq: 0,
        defaults: {},
        // What the public link serves: its definition (JSON text) and field names.
        publishedVersion: null,
        publishedJson: "",
        publishedNames: {},
        unlocked: {},
        ruleDraft: blankRule("show"),

        init: function () {
          var self = this;
          window.addEventListener("beforeunload", function (e) {
            if (self.status !== "saved") { e.preventDefault(); e.returnValue = ""; } // dirty, saving, or refused by the API
          });
          if (!self.formId) { self.start(self.starter); return; }
          api("GET", "/forms/" + self.formId).then(function (form) {
            self.slug = form.slug;
            self.publishedVersion = form.published_version;
            self.start(form.definition);
            if (form.published_version === null) return;
            return api("GET", "/forms/" + self.formId + "/versions/" + form.published_version).then(function (v) {
              self.markPublished(v.definition);
            });
          }).catch(function (err) {
            self.status = "error";
            self.statusText = "Could not load the form: " + err.message;
          });
        },
        start: function (definition) {
          this.def = definition;
          this.history = [JSON.stringify(definition)];
          this.cursor = 0;
          this.loaded = true;
          this.render();
          this.refreshPreview(0);
        },
        markPublished: function (definition) {
          var names = {};
          Object.keys(definition.schema.properties).forEach(function (n) { names[n] = true; });
          this.publishedJson = JSON.stringify(definition);
          this.publishedNames = names;
          this.render();
        },

        // ── The one way to change the definition ──────────────────────────
        apply: function (mutate, opts) {
          opts = opts || {};
          var next = clone(this.def);
          mutate(next);
          this.def = next;
          var snapshot = JSON.stringify(next);
          var now = Date.now();
          // Typing into one property coalesces into one undo step.
          if (opts.key && opts.key === this.lastEdit.key && now - this.lastEdit.at < 1200 && this.cursor === this.history.length - 1) {
            this.history[this.cursor] = snapshot;
          } else {
            this.history = this.history.slice(0, this.cursor + 1).concat([snapshot]).slice(-HISTORY);
            this.cursor = this.history.length - 1;
          }
          this.lastEdit = { key: opts.key || "", at: now };
          this.render(opts.fromJson);
          this.scheduleSave();
          this.refreshPreview(500);
        },

        undo: function () { this.travel(-1); },
        redo: function () { this.travel(1); },
        canUndo: function () { return this.cursor > 0; },
        canRedo: function () { return this.cursor < this.history.length - 1; },
        travel: function (step) {
          var to = this.cursor + step;
          if (to < 0 || to >= this.history.length) return;
          this.cursor = to;
          this.def = JSON.parse(this.history[to]);
          this.lastEdit = { key: "", at: 0 };
          if (this.selected && !this.def.schema.properties[this.selected]) this.selected = "";
          this.render();
          this.scheduleSave();
          this.refreshPreview(300);
          this.announce = step < 0 ? "Undone" : "Redone";
        },

        // ── Views ─────────────────────────────────────────────────────────
        render: function (fromJson) {
          var def = this.def;
          if (!def) return;
          var ui = def.ui || {};
          var props = def.schema.properties;
          var required = def.schema.required || [];
          var self = this;
          var card = function (name) {
            var s = props[name] || {};
            var kind = kindOf(s, ui[name]);
            var meta = kindMeta(kind);
            return { name: name, title: s.title || name, kind: kind, kindLabel: meta.label, icon: meta.icon, required: required.indexOf(name) >= 0 };
          };
          var list;
          if (ui["ui:wizard"]) {
            this.mode = "wizard";
            list = ui["ui:wizard"].steps;
          } else if (ui["ui:groups"]) {
            this.mode = "sections";
            list = ui["ui:groups"];
          } else {
            this.mode = "flat";
            list = [{ title: "", fields: Object.keys(props) }];
          }
          this.sections = list.map(function (sec, i) {
            return { key: self.mode + i, index: i, title: sec.title || "", description: sec.description || "", fields: sec.fields.map(card) };
          });
          this.fieldOptions = Object.keys(props).map(card);
          this.title = def.schema.title;
          this.rulesView = this.describeRules();
          this.publishState = this.publishedVersion === null ? "draft" : JSON.stringify(serialise(def)) === this.publishedJson ? "live" : "changed";
          if (!fromJson) {
            this.jsonText = JSON.stringify(def, null, 2);
            this.jsonError = "";
          }
        },

        titleOf: function (n) {
          var f = this.def.schema.properties[n];
          return f ? "“" + (f.title || n) + "”" : "“" + n + "”";
        },

        describeRules: function () {
          var self = this;
          var titleOf = function (n) { return self.titleOf(n); };
          return ((this.def.rules && this.def.rules.rules) || []).map(function (r) {
            var text, verb;
            var hidden = r.show !== undefined && /^hide-/.test(r.id) && r.when && r.when["!"] !== undefined;
            if (hidden) {
              var inner = describeCondition(r.when["!"], titleOf);
              text = "Hide " + titleOf(r.show) + (inner ? " when " + inner : " (custom condition)");
              verb = "hide";
            } else if (r.show !== undefined) {
              var cond = describeCondition(r.when, titleOf);
              text = "Show " + titleOf(r.show) + (cond ? " when " + cond : " (custom condition)");
              verb = "show";
            } else if (r.require !== undefined) {
              var req = describeCondition(r.when, titleOf);
              text = "Require " + titleOf(r.require) + (req ? " when " + req : " (custom condition)");
              verb = "require";
            } else if (r.compute !== undefined) {
              var formula = describeFormula(r.value, titleOf);
              text = "Calculate " + titleOf(r.compute) + (formula ? " = " + formula : " (custom formula)");
              verb = "compute";
            } else if (r.validate !== undefined) {
              text = "Check " + titleOf(r.path) + ": " + (r.message || r.id);
              verb = "check";
            } else {
              text = "Custom rule " + r.id + " (edit it in the JSON tab)";
              verb = "other";
            }
            return { id: r.id, text: text, verb: verb };
          });
        },

        /** The field the inspector shows: the selected one, on the Build tab only. */
        inspecting: function () { return this.tab === "build" ? this.field() : null; },

        field: function () {
          if (!this.selected || !this.def) return null;
          var name = this.selected;
          var props = this.def.schema.properties;
          var s = props[name];
          if (!s) return null;
          var ui = (this.def.ui && this.def.ui[name]) || {};
          var kind = kindOf(s, ui);
          var options = kind === "scale" ? null : s.enum || (s.items && s.items.enum) || null;
          var isNumber = kind === "number";
          var range = kind === "scale" ? (s.enum ? { from: Number(s.enum[0]), to: Number(s.enum[s.enum.length - 1]) } : { from: s.minimum, to: s.maximum }) : null;
          var published = !!this.publishedNames[name];
          return {
            name: name,
            kind: kind,
            kindLabel: kindMeta(kind).label,
            title: s.title || "",
            description: s.description || "",
            placeholder: ui.placeholder || ui["ui:placeholder"] || "",
            width: ui.width || ui["ui:width"] || "full",
            required: (this.def.schema.required || []).indexOf(name) >= 0,
            options: options ? options.join("\n") : "",
            hasOptions: !!options,
            isText: s.type === "string" && !options && !s.format && kind !== "scale",
            isNumber: isNumber,
            isScalar: s.type !== "array" && s.type !== "object",
            hasPlaceholder: s.type !== "boolean" && !options && s.type !== "array" && kind !== "scale",
            minLength: s.minLength === undefined ? "" : s.minLength,
            maxLength: s.maxLength === undefined ? "" : s.maxLength,
            minimum: s.minimum === undefined ? "" : s.minimum,
            maximum: s.maximum === undefined ? "" : s.maximum,
            // Number
            numberKind: s.type === "integer" ? "integer" : "number",
            step: s.multipleOf === undefined ? (s.step === undefined ? "" : s.step) : s.multipleOf,
            prefix: ui.prefix || "",
            suffix: ui.suffix || "",
            defaultValue: s.default === undefined ? "" : s.default,
            computed: isNumber && this.computedBy(name),
            // Scale
            isScale: kind === "scale",
            scaleFrom: range ? range.from : "",
            scaleTo: range ? range.to : "",
            minLabel: ui.minLabel || ui["ui:minLabel"] || "",
            maxLabel: ui.maxLabel || ui["ui:maxLabel"] || "",
            // Long text
            isLongText: kind === "textarea",
            verbatim: !!ui.verbatim,
            // Date
            isDate: kind === "date",
            earliest: s.formatMinimum || "",
            latest: s.formatMaximum || "",
            // Repeatable rows
            isRepeat: kind === "repeat",
            minItems: s.minItems === undefined ? "" : s.minItems,
            maxItems: s.maxItems === undefined ? "" : s.maxItems,
            addLabel: ui.addLabel || ui["ui:addLabel"] || "",
            removeLabel: ui.removeLabel || ui["ui:removeLabel"] || "",
            columns: kind === "repeat" ? this.columns(name) : [],
            // Name
            published: published,
            locked: published && !this.unlocked[name],
            follows: !published && followsLabel(props, name),
          };
        },

        /** The rule that computes `name`, if one does. */
        computedBy: function (name) {
          var rules = (this.def.rules && this.def.rules.rules) || [];
          for (var i = 0; i < rules.length; i++) if (rules[i].compute === name) return rules[i].id;
          return "";
        },

        columns: function (name) {
          var s = this.def.schema.properties[name];
          var row = (s.items && s.items.properties) || {};
          var req = (s.items && s.items.required) || [];
          var itemsUi = (this.def.ui && this.def.ui[name] && this.def.ui[name].items) || {};
          return Object.keys(row).map(function (key, ci) {
            var c = row[key];
            var cu = itemsUi[key] || {};
            return {
              key: key, index: ci, title: c.title || key, type: columnType(c), required: req.indexOf(key) >= 0,
              width: cu.width || cu["ui:width"] || "full", options: (c.enum || []).join("\n"),
            };
          });
        },

        // ── Adding, moving, removing fields ───────────────────────────────
        addKind: function (kindId, si, index) {
          var kind = KIND[kindId];
          if (!kind) return;
          var name;
          this.apply(function (d) {
            name = nameFor(kind.schema.title, d.schema.properties);
            var props = {};
            var order = Object.keys(d.schema.properties);
            order.forEach(function (k) { props[k] = d.schema.properties[k]; });
            props[name] = clone(kind.schema);
            d.schema.properties = props;
            if (kind.ui) { d.ui = d.ui || {}; d.ui[name] = clone(kind.ui); }
            var list = sectionList(d);
            if (list) {
              var sec = list[si === undefined ? list.length - 1 : si];
              sec.fields.splice(index === undefined ? sec.fields.length : index, 0, name);
            } else if (index !== undefined) {
              reorderTop(d, name, index);
            }
          });
          this.select(name);
          this.announce = kind.label + " added";
        },

        moveField: function (name, si, index) {
          this.apply(function (d) {
            var list = sectionList(d);
            if (list) {
              var from = -1, at = -1;
              list.forEach(function (s, i) { var j = s.fields.indexOf(name); if (j >= 0) { from = i; at = j; } });
              list[from].fields.splice(at, 1);
              if (from === si && at < index) index--;
              list[si].fields.splice(index, 0, name);
            } else {
              var keys = Object.keys(d.schema.properties);
              var cur = keys.indexOf(name);
              if (cur < index) index--;
              reorderTop(d, name, index);
            }
          });
          this.announce = "Moved";
        },

        nudge: function (name, delta) {
          var pos = this.position(name);
          var sec = this.sections[pos.si];
          var to = pos.fi + delta;
          var into = pos.si;
          if (to >= 0 && to < sec.fields.length) {
            this.moveField(name, pos.si, delta > 0 ? to + 1 : to);
          } else if (delta < 0 && pos.si > 0) {
            into = pos.si - 1;
            this.moveField(name, into, this.sections[into].fields.length);
          } else if (delta > 0 && pos.si < this.sections.length - 1) {
            into = pos.si + 1;
            this.moveField(name, into, 0);
          } else return;
          this.lastNudge = Date.now();
          this.announce = into === pos.si ? "Moved " + (delta < 0 ? "up" : "down")
            : "Moved to " + (this.mode === "wizard" ? "step " : "section ") + (into + 1);
          this.selected = name;
          // The card is re-created in its new place; give it focus back so the next Alt+arrow moves it again.
          var refocus = function () { var el = document.getElementById("field-" + name); if (el && document.activeElement !== el) el.focus(); };
          Promise.resolve().then(refocus);
          setTimeout(refocus, 0);
          setTimeout(refocus, 60);
        },

        position: function (name) {
          for (var i = 0; i < this.sections.length; i++) {
            for (var j = 0; j < this.sections[i].fields.length; j++) if (this.sections[i].fields[j].name === name) return { si: i, fi: j };
          }
          return { si: 0, fi: 0 };
        },

        removeField: function (name) {
          if (Object.keys(this.def.schema.properties).length <= 1) { this.announce = "A form needs at least one field."; return; }
          this.apply(function (d) {
            delete d.schema.properties[name];
            if (d.schema.required) d.schema.required = d.schema.required.filter(function (n) { return n !== name; });
            if (d.ui) {
              delete d.ui[name];
              var list = sectionList(d);
              if (list) list.forEach(function (s) {
                s.fields = s.fields.filter(function (n) { return n !== name; });
                if (s.when && ruleUses({ when: s.when }, name)) delete s.when;
              });
            }
            if (d.rules && d.rules.rules) {
              d.rules.rules = d.rules.rules.filter(function (r) { return !ruleUses(r, name); });
              if (!d.rules.rules.length) delete d.rules.rules;
            }
          });
          if (this.selected === name) this.selected = "";
          this.announce = "Field removed";
        },

        duplicate: function (name) {
          var copy;
          this.apply(function (d) {
            copy = nameFor(d.schema.properties[name].title || name, d.schema.properties);
            var props = {};
            Object.keys(d.schema.properties).forEach(function (k) {
              props[k] = d.schema.properties[k];
              if (k === name) props[copy] = clone(d.schema.properties[k]);
            });
            d.schema.properties = props;
            if (d.ui && d.ui[name]) d.ui[copy] = clone(d.ui[name]);
            var list = sectionList(d);
            if (list) list.forEach(function (s) { var i = s.fields.indexOf(name); if (i >= 0) s.fields.splice(i + 1, 0, copy); });
          });
          this.select(copy);
        },

        // ── Drag and drop ─────────────────────────────────────────────────
        // Where a drop lands is worked out from the drop event itself; `drop`
        // only paints the indicator, so a stale one can never move the wrong field.
        dragKind: function (e, kindId) {
          e.dataTransfer.setData("text/plain", "kind:" + kindId);
          e.dataTransfer.effectAllowed = "copy";
          this.drop = null;
          this.dragging = { kind: kindId };
        },
        dragField: function (e, name) {
          e.dataTransfer.setData("text/plain", "field:" + name);
          e.dataTransfer.effectAllowed = "move";
          this.drop = null;
          this.dragging = { field: name };
        },
        dragEnd: function () { this.dragging = null; this.drop = null; },
        landing: function (e, fi) {
          var rect = e.currentTarget.getBoundingClientRect();
          return e.clientY > rect.top + rect.height / 2 ? fi + 1 : fi;
        },
        mark: function (si, index) {
          if (!this.drop || this.drop.si !== si || this.drop.index !== index) this.drop = { si: si, index: index };
        },
        overField: function (e, si, fi) {
          e.preventDefault();
          e.stopPropagation();
          this.mark(si, this.landing(e, fi));
        },
        overEnd: function (e, si) {
          e.preventDefault();
          e.stopPropagation();
          this.mark(si, this.sections[si].fields.length);
        },
        // Anywhere else in a section (its head, its padding): the end of that section.
        overSection: function (e, si) {
          e.preventDefault();
          this.mark(si, this.sections[si].fields.length);
        },
        isDrop: function (si, index) { return !!this.drop && this.drop.si === si && this.drop.index === index; },
        isDropSection: function (si) { return !!this.drop && this.drop.si === si; },
        dropHere: function (e, si, fi) {
          e.preventDefault();
          e.stopPropagation();
          var data = e.dataTransfer.getData("text/plain");
          var index = fi === undefined ? this.sections[si].fields.length : this.landing(e, fi);
          this.drop = null;
          this.dragging = null;
          if (!data) return;
          if (data.indexOf("kind:") === 0) this.addKind(data.slice(5), si, index);
          else if (data.indexOf("field:") === 0) this.moveField(data.slice(6), si, index);
        },
        leaveCanvas: function (e) {
          if (!e.currentTarget.contains(e.relatedTarget)) this.drop = null;
        },

        cardKey: function (e, name) {
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            // Holding the keys repeats them faster than a person can follow: one step at a time.
            if (e.repeat && Date.now() - this.lastNudge < 180) return;
            this.nudge(name, e.key === "ArrowUp" ? -1 : 1);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.select(name);
          } else if (e.key === "Delete") {
            e.preventDefault();
            this.removeField(name);
          }
        },

        select: function (name) {
          this.selected = name;
          this.editKey = name + ":" + Date.now();
          this.tab = "build";
        },
        /** A click on the canvas's empty space puts the form back in the inspector. */
        canvasClick: function (e) {
          if (this.tab !== "build") return;
          if (e.target.closest("[data-designer-field], button, input, select, textarea, a, label, [role='tab']")) return;
          this.selected = "";
        },

        // ── Properties ────────────────────────────────────────────────────
        setProp: function (prop, value) {
          var name = this.selected;
          if (!name) return;
          var renamed = name;
          var self = this;
          this.apply(function (d) {
            var s = d.schema.properties[name];
            var num = function (v) { return v === "" || v === null || v === undefined ? undefined : Number(v); };
            var int = s.type === "integer";
            if (prop === "title") {
              // The name follows the label until someone names it by hand, and never once published.
              var follow = !self.publishedNames[name] && followsLabel(d.schema.properties, name);
              s.title = value;
              if (follow) {
                var next = nameFor(value, others(d.schema.properties, name));
                if (next !== name) { renameIn(d, name, next); renamed = next; }
              }
            } else if (prop === "description") { if (value) s.description = value; else delete s.description; }
            else if (["placeholder", "prefix", "suffix", "minLabel", "maxLabel", "addLabel", "removeLabel"].indexOf(prop) >= 0) {
              setUi(d, name, prop, value);
            } else if (prop === "verbatim") {
              setUi(d, name, "verbatim", value ? true : undefined);
            } else if (prop === "width") {
              setUi(d, name, "width", value && value !== "full" ? value : undefined);
            } else if (prop === "required") {
              var req = (d.schema.required || []).filter(function (n) { return n !== name; });
              if (value) req.push(name);
              if (req.length) d.schema.required = req; else delete d.schema.required;
            } else if (prop === "options") {
              var opts = String(value).split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
              opts = opts.filter(function (x, i) { return opts.indexOf(x) === i; });
              if (!opts.length) opts = ["Option A"];
              if (s.items) s.items.enum = opts; else s.enum = opts;
              var ui = d.ui && d.ui[name];
              if (ui && ui.enumLabels && ui.enumLabels.length !== opts.length) setUi(d, name, "enumLabels", undefined);
              if (s.default !== undefined && (Array.isArray(s.default) ? s.default.some(function (x) { return opts.indexOf(x) < 0; }) : opts.indexOf(s.default) < 0)) delete s.default;
            } else if (["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"].indexOf(prop) >= 0) {
              var n = num(value);
              if (n !== undefined && int && (prop === "minimum" || prop === "maximum")) n = Math.round(n);
              if (n === undefined || isNaN(n)) delete s[prop]; else s[prop] = n;
            } else if (prop === "numberKind") {
              // Whole numbers: the bounds, step and default round to integers.
              s.type = value === "integer" ? "integer" : "number";
              if (s.type === "integer") {
                ["minimum", "maximum", "default"].forEach(function (k) { if (typeof s[k] === "number") s[k] = Math.round(s[k]); });
                if (s.multipleOf !== undefined && s.multipleOf % 1) delete s.multipleOf;
                if (s.step !== undefined && s.step % 1) delete s.step;
              }
            } else if (prop === "step") {
              var st = num(value);
              delete s.step;
              if (st === undefined || isNaN(st) || st <= 0 || (int && st % 1)) delete s.multipleOf; else s.multipleOf = st;
            } else if (prop === "default") {
              var dv = num(value);
              if (dv === undefined || isNaN(dv)) delete s.default; else s.default = int ? Math.round(dv) : dv;
            } else if (prop === "scaleFrom" || prop === "scaleTo") {
              var cur = s.enum ? { from: Number(s.enum[0]), to: Number(s.enum[s.enum.length - 1]) } : { from: s.minimum, to: s.maximum };
              var lo = prop === "scaleFrom" ? Number(value) : cur.from;
              var hi = prop === "scaleTo" ? Number(value) : cur.to;
              if (isNaN(lo) || isNaN(hi) || hi <= lo || hi - lo > 20) return;
              if (s.enum) {
                var values = [];
                for (var v = lo; v <= hi; v++) values.push(String(v));
                s.enum = values;
                if (s.default !== undefined && values.indexOf(s.default) < 0) delete s.default;
                if (d.ui && d.ui[name] && d.ui[name].enumLabels) setUi(d, name, "enumLabels", undefined);
              } else {
                s.minimum = lo;
                s.maximum = hi;
              }
            } else if (prop === "formatMinimum" || prop === "formatMaximum") {
              if (value) s[prop] = value; else delete s[prop];
            }
          }, { key: this.editKey + ":" + prop });
          if (renamed !== name) this.selected = renamed;
        },

        rename: function (value) {
          var from = this.selected;
          var to = String(value).trim();
          if (!from || !to || to === from) return;
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) { this.announce = "A name is letters, digits and _ and starts with a letter."; return; }
          if (this.def.schema.properties[to]) { this.announce = "Another field already has that name."; return; }
          this.apply(function (d) { renameIn(d, from, to); });
          if (this.unlocked[from]) { var u = Object.assign({}, this.unlocked); u[to] = true; this.unlocked = u; }
          this.selected = to;
        },
        unlockName: function () {
          var u = Object.assign({}, this.unlocked);
          u[this.selected] = true;
          this.unlocked = u;
          var self = this;
          setTimeout(function () { var el = document.getElementById("prop-name"); if (el) { el.focus(); el.select(); } self.announce = "The name can be changed now"; }, 0);
        },

        // ── Repeatable rows: columns ──────────────────────────────────────
        editRow: function (mutate, key) {
          var name = this.selected;
          this.apply(function (d) {
            var s = d.schema.properties[name];
            var items = s.items;
            d.ui = d.ui || {};
            var ui = d.ui[name] = d.ui[name] || {};
            ui.items = ui.items || {};
            mutate(items, ui.items, d);
            Object.keys(ui.items).forEach(function (k) { if (!items.properties[k] || !Object.keys(ui.items[k]).length) delete ui.items[k]; });
            if (!Object.keys(ui.items).length) delete ui.items;
            if (items.required && !items.required.length) delete items.required;
            if (!Object.keys(ui).length) delete d.ui[name];
            if (!Object.keys(d.ui).length) delete d.ui;
          }, key ? { key: this.editKey + ":" + key } : undefined);
        },
        setColumn: function (ci, prop, value) {
          this.editRow(function (items, itemsUi) {
            var keys = Object.keys(items.properties);
            var key = keys[ci];
            var c = items.properties[key];
            if (prop === "title") {
              var follow = nameFor(c.title || "", others(items.properties, key)) === key;
              c.title = value;
              var next = follow ? nameFor(value, others(items.properties, key)) : key;
              if (next !== key) {
                var props = {};
                keys.forEach(function (k) { props[k === key ? next : k] = items.properties[k]; });
                items.properties = props;
                if (items.required) items.required = items.required.map(function (n) { return n === key ? next : n; });
                if (itemsUi[key]) { itemsUi[next] = itemsUi[key]; delete itemsUi[key]; }
              }
            } else if (prop === "type") {
              var t = COLUMN_TYPES.filter(function (x) { return x.id === value; })[0];
              if (!t) return;
              var out = clone(t.schema);
              out.title = c.title;
              items.properties[key] = out;
              if (itemsUi[key]) delete itemsUi[key].placeholder;
            } else if (prop === "required") {
              var req = (items.required || []).filter(function (n) { return n !== key; });
              if (value) req.push(key);
              items.required = req;
            } else if (prop === "width") {
              itemsUi[key] = itemsUi[key] || {};
              if (value && value !== "full") itemsUi[key].width = value; else delete itemsUi[key].width;
            } else if (prop === "options") {
              var opts = String(value).split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
              opts = opts.filter(function (x, i) { return opts.indexOf(x) === i; });
              c.enum = opts.length ? opts : ["Option A"];
            }
          }, "col:" + ci + ":" + prop);
        },
        addColumn: function () {
          this.editRow(function (items, itemsUi) {
            // A column's key follows its label, like a field's name.
            var title = "Column " + (Object.keys(items.properties).length + 1);
            var key = nameFor(title, items.properties);
            items.properties[key] = { type: "string", title: title };
            itemsUi[key] = { width: "third" };
          });
          this.announce = "Column added";
        },
        removeColumn: function (ci) {
          var cols = this.columns(this.selected);
          if (cols.length <= 1) { this.announce = "Rows need at least one column."; return; }
          this.editRow(function (items, itemsUi) {
            var key = Object.keys(items.properties)[ci];
            delete items.properties[key];
            delete itemsUi[key];
            if (items.required) items.required = items.required.filter(function (n) { return n !== key; });
          });
          this.announce = "Column removed";
        },
        moveColumn: function (ci, delta) {
          this.editRow(function (items) {
            var keys = Object.keys(items.properties);
            var to = ci + delta;
            if (to < 0 || to >= keys.length) return;
            var k = keys.splice(ci, 1)[0];
            keys.splice(to, 0, k);
            var props = {};
            keys.forEach(function (x) { props[x] = items.properties[x]; });
            items.properties = props;
          });
        },

        setTitle: function (value) {
          this.apply(function (d) { d.schema.title = value || "Untitled form"; }, { key: "form:title" });
        },
        setDescription: function (value) {
          this.apply(function (d) { if (value) d.schema.description = value; else delete d.schema.description; }, { key: "form:description" });
        },

        // ── Sections and wizard steps ─────────────────────────────────────
        setMode: function (mode) {
          if (mode === this.mode) return;
          var current = this.sections.map(function (s) { return { title: s.title, description: s.description, fields: s.fields.map(function (f) { return f.name; }) }; });
          this.apply(function (d) {
            d.ui = d.ui || {};
            delete d.ui["ui:groups"];
            delete d.ui["ui:wizard"];
            var all = Object.keys(d.schema.properties);
            var clean = function (list, word) {
              return list.map(function (s, i) {
                // Default names follow the mode ("Section 2" becomes "Step 2"); real titles stay.
                var named = s.title && !/^(Section|Step) \d+$/.test(s.title);
                var out = { title: named ? s.title : word + " " + (i + 1), fields: s.fields };
                if (s.description) out.description = s.description;
                return out;
              });
            };
            if (mode === "sections") {
              d.ui["ui:groups"] = current.length > 1 ? clean(current, "Section") : [{ title: "Section 1", fields: all }];
            } else if (mode === "wizard") {
              var steps = current.length > 1 ? clean(current, "Step") : [
                { title: "Step 1", fields: all.slice(0, Math.ceil(all.length / 2)) },
                { title: "Step 2", fields: all.slice(Math.ceil(all.length / 2)) },
              ];
              d.ui["ui:wizard"] = { label: "Steps", steps: steps };
            }
            if (!Object.keys(d.ui).length) delete d.ui;
          });
          this.announce = mode === "flat" ? "One page, no sections" : mode === "sections" ? "Sections on one page" : "Wizard: one step per page";
        },

        addSection: function () {
          var word = this.mode === "wizard" ? "Step" : "Section";
          if (this.mode === "flat") { this.setMode("sections"); }
          var mode = this.mode;
          var at;
          this.apply(function (d) {
            var list = mode === "wizard" ? d.ui["ui:wizard"].steps : d.ui["ui:groups"];
            list.push({ title: word + " " + (list.length + 1), fields: [] });
            at = list.length - 1;
          });
          this.announce = word + " added — drag fields into it";
          // Show what happened: the new section, its title ready to type over.
          setTimeout(function () {
            var input = document.getElementById("sec-title-" + at);
            if (!input) return;
            input.scrollIntoView({ block: "center", behavior: "smooth" });
            input.focus({ preventScroll: true });
            input.select();
          }, 30);
        },

        removeSection: function (si) {
          var mode = this.mode;
          this.apply(function (d) {
            var list = mode === "wizard" ? d.ui["ui:wizard"].steps : d.ui["ui:groups"];
            if (list.length <= 1) return;
            var gone = list.splice(si, 1)[0];
            list[Math.max(0, si - 1)].fields = list[Math.max(0, si - 1)].fields.concat(gone.fields);
          });
        },

        moveSection: function (si, delta) {
          var mode = this.mode;
          var to = si + delta;
          if (to < 0 || to >= this.sections.length) return;
          this.apply(function (d) {
            var list = mode === "wizard" ? d.ui["ui:wizard"].steps : d.ui["ui:groups"];
            var s = list.splice(si, 1)[0];
            list.splice(to, 0, s);
          });
        },

        setSection: function (si, prop, value) {
          var mode = this.mode;
          this.apply(function (d) {
            var list = mode === "wizard" ? d.ui["ui:wizard"].steps : d.ui["ui:groups"];
            if (value) list[si][prop] = value; else if (prop === "description") delete list[si][prop]; else list[si][prop] = "Untitled";
          }, { key: "section:" + si + ":" + prop });
        },

        // ── Rules ─────────────────────────────────────────────────────────
        fieldInfo: function (name) {
          var f = this.def && this.def.schema.properties[name];
          if (!f) return { kind: "", options: [], boolean: false };
          var kind = kindOf(f, this.def.ui && this.def.ui[name]);
          return { kind: kind, options: f.enum || (f.items && f.items.enum) || [], boolean: f.type === "boolean" };
        },
        /** The comparisons that make sense for the field a condition watches. */
        opsFor: function (ci) {
          var c = this.ruleDraft.conditions[ci];
          var kind = this.fieldInfo(c && c.field).kind;
          return opsFor(kind).map(function (id) { return { id: id, label: kind === "date" && DATE_OPS[id] ? DATE_OPS[id] : OPS[id] }; });
        },
        needsValue: function (ci) {
          var c = this.ruleDraft.conditions[ci];
          return !!c && ["filled", "empty", "ticked", "unticked"].indexOf(c.op) < 0;
        },
        valueOptions: function (ci) {
          var c = this.ruleDraft.conditions[ci];
          return this.fieldInfo(c && c.field).options;
        },
        valueType: function (ci) {
          var kind = this.fieldInfo(this.ruleDraft.conditions[ci].field).kind;
          return kind === "number" ? "number" : kind === "date" ? "date" : "text";
        },
        numberFields: function () {
          return this.fieldOptions.filter(function (f) { return f.kind === "number"; });
        },
        setDraft: function (prop, value) {
          var next = Object.assign({}, this.ruleDraft);
          next[prop] = value;
          if (prop === "verb" && (value === "compute") !== (this.ruleDraft.verb === "compute")) next.target = "";
          this.ruleDraft = next;
        },
        setCondition: function (ci, prop, value) {
          var list = this.ruleDraft.conditions.map(function (c) { return Object.assign({}, c); });
          list[ci][prop] = value;
          if (prop === "field") {
            // A new field: start from its first comparison, with no stale value.
            list[ci].op = opsFor(this.fieldInfo(value).kind)[0];
            list[ci].value = "";
          }
          this.setDraft("conditions", list);
        },
        addCondition: function () { this.setDraft("conditions", this.ruleDraft.conditions.concat([blankCondition()])); },
        removeCondition: function (ci) {
          if (this.ruleDraft.conditions.length <= 1) return;
          this.setDraft("conditions", this.ruleDraft.conditions.filter(function (_c, i) { return i !== ci; }));
        },
        addRule: function () {
          var r = this.ruleDraft;
          var self = this;
          var rule;
          if (!r.target) { this.announce = r.verb === "compute" ? "Pick the number field to calculate." : "Pick the field to " + r.verb + "."; return; }
          if (r.verb === "compute") {
            var b = r.b === "#" ? Number(r.bNumber) : { var: r.b };
            if (!r.a || !r.b || (r.b === "#" && (r.bNumber === "" || isNaN(b)))) { this.announce = "Pick what to calculate it from."; return; }
            if (r.a === r.target || r.b === r.target) { this.announce = "A field cannot be calculated from itself."; return; }
            var value = {};
            value[r.math] = [{ var: r.a }, b];
            rule = { compute: r.target, value: value };
          } else {
            var parts = [];
            for (var i = 0; i < r.conditions.length; i++) {
              var c = r.conditions[i];
              var info = this.fieldInfo(c.field);
              if (!c.field || c.field === r.target) { this.announce = "Pick a different field to watch for each condition."; return; }
              if (this.needsValue(i) && c.value === "") { this.announce = "Pick or type the value to compare with."; return; }
              if (info.kind === "number" && this.needsValue(i) && isNaN(Number(c.value))) { this.announce = "Type a number to compare with."; return; }
              parts.push(conditionFor(c.field, c.op, c.value, info.kind));
            }
            var when = parts.length === 1 ? parts[0] : r.match === "any" ? { or: parts } : { and: parts };
            // The engine's verb is show; "hide when X" is "show unless X" (its id keeps the intent for the list).
            if (r.verb === "hide") rule = { show: r.target, when: { "!": when } };
            else if (r.verb === "require") rule = { require: r.target, when: when };
            else rule = { show: r.target, when: when };
          }
          this.apply(function (d) {
            d.rules = d.rules || {};
            d.rules.rules = d.rules.rules || [];
            var base = r.verb + "-" + r.target.toLowerCase(), id = base, n = 2;
            var taken = d.rules.rules.map(function (x) { return x.id; });
            while (taken.indexOf(id) >= 0) id = base + "-" + n++;
            d.rules.rules.push(Object.assign({ id: id }, rule));
          });
          self.ruleDraft = blankRule(r.verb);
          this.announce = "Rule added";
        },
        removeRule: function (id) {
          this.apply(function (d) {
            d.rules.rules = d.rules.rules.filter(function (r) { return r.id !== id; });
            if (!d.rules.rules.length) delete d.rules.rules;
            if (!Object.keys(d.rules).length) delete d.rules;
          });
        },

        // ── Appearance ────────────────────────────────────────────────────
        look: function (key) {
          var a = (this.def && this.def.appearance) || {};
          if (key === "coverImage") return (a.cover && a.cover.image) || "";
          if (key === "eyebrow") return (a.cover && a.cover.eyebrow) || "";
          var def = this.defaults; // the server's DEFAULT_APPEARANCE, passed as data-prop-defaults
          if (key === "thanksTitle") return (a.thankYou && a.thankYou.title) || def.thankYou.title;
          if (key === "thanksMessage") return (a.thankYou && a.thankYou.message) || def.thankYou.message;
          return a[key] === undefined || a[key] === null ? def[key] || "" : a[key];
        },
        themeName: function () {
          var id = this.look("theme");
          var t = this.themes.filter(function (x) { return x.id === id; })[0];
          return t ? t.name : id;
        },
        swatch: function (t) {
          return { "--swatch-bg": t.swatch.bg, "--swatch-fg": t.swatch.fg, "--swatch-primary": t.swatch.primary, "--swatch-surface": t.swatch.surface };
        },
        setLook: function (key, value) {
          var thanks = this.defaults.thankYou;
          this.apply(function (d) {
            var a = d.appearance = d.appearance || {};
            if (key === "coverImage" || key === "eyebrow") {
              a.cover = a.cover || { image: "", eyebrow: "" };
              a.cover[key === "coverImage" ? "image" : "eyebrow"] = value;
              if (!a.cover.image && !a.cover.eyebrow) delete a.cover;
            } else if (key === "thanksTitle" || key === "thanksMessage") {
              a.thankYou = a.thankYou || { title: thanks.title, message: thanks.message };
              a.thankYou[key === "thanksTitle" ? "title" : "message"] = value;
            } else if (key === "redirect") {
              if (value) a.redirect = value; else delete a.redirect;
            } else {
              a[key] = value;
            }
          }, { key: "look:" + key });
        },

        // ── JSON tab ──────────────────────────────────────────────────────
        editJson: function (text) {
          this.jsonText = text;
          var parsed;
          try { parsed = JSON.parse(text); } catch (e) { this.jsonError = "Not valid JSON yet: " + e.message; return; }
          if (!parsed || typeof parsed !== "object" || !parsed.schema || typeof parsed.schema.properties !== "object") {
            this.jsonError = "A definition is an object with a schema that has properties.";
            return;
          }
          this.jsonError = "";
          this.apply(function (d) {
            Object.keys(d).forEach(function (k) { delete d[k]; });
            Object.keys(parsed).forEach(function (k) { d[k] = parsed[k]; });
          }, { key: "json", fromJson: true });
          if (this.selected && !this.def.schema.properties[this.selected]) this.selected = "";
        },
        formatJson: function () { this.jsonText = JSON.stringify(this.def, null, 2); this.jsonError = ""; },

        // ── Saving, preview, publishing ───────────────────────────────────
        publicUrl: function () { return this.slug ? window.location.origin + "/f/" + this.slug : ""; },
        settingsHref: function () { return this.formId ? "/app/forms/" + this.formId + "/settings#set-slug" : ""; },
        publishLabel: function () {
          return this.publishing ? "Publishing…" : this.publishState === "live" ? "Published" : this.publishState === "changed" ? "Publish changes" : "Publish";
        },
        scheduleSave: function () {
          var self = this;
          self.status = "dirty";
          self.statusText = "Unsaved changes";
          clearTimeout(self.saveTimer);
          self.saveTimer = setTimeout(function () { self.save().catch(function () { /* shown in the problems callout */ }); }, 800);
        },
        save: function () {
          var self = this;
          clearTimeout(self.saveTimer);
          // One request at a time: above all, never two POSTs creating two forms.
          if (self.inflight) return self.inflight.then(function () { return self.status === "saved" ? null : self.save(); });
          var snapshot = JSON.stringify(self.def);
          var body = { definition: serialise(self.def) };
          self.status = "saving";
          self.statusText = "Saving…";
          var request = self.formId ? api("PATCH", "/forms/" + self.formId, body) : api("POST", "/forms", body).then(function (form) {
            self.formId = form.id;
            // The address bar now names the stored form, so a reload opens it.
            window.history.replaceState(null, "", "/app/forms/" + form.id + "/design");
            return form;
          });
          self.inflight = request.then(function (form) {
            self.inflight = null;
            self.slug = form.slug;
            self.problems = [];
            if (JSON.stringify(self.def) !== snapshot) return self.save();
            self.status = "saved";
            self.statusText = "All changes saved";
          }, function (err) {
            self.inflight = null;
            self.status = "error";
            self.statusText = "Not saved — see the note below";
            self.problems = self.explain(err);
            throw err;
          });
          return self.inflight;
        },
        explain: function (err) {
          var def = this.def;
          var seen = {};
          return (err.problems || [{ detail: err.message }]).map(function (p) { return humanProblem(p, def); })
            .filter(function (t) { if (seen[t]) return false; seen[t] = true; return true; });
        },
        refreshPreview: function (delay) {
          var self = this;
          clearTimeout(self.previewTimer);
          self.previewTimer = setTimeout(function () {
            var seq = ++self.previewSeq;
            api("POST", "/preview", { definition: serialise(self.def) }).then(function (res) {
              if (seq !== self.previewSeq) return; // a newer preview is on its way
              var frame = document.getElementById("designer-preview");
              if (frame) frame.srcdoc = res.html;
              self.audit = res.audit;
              if (self.status !== "error") self.problems = [];
            }, function (err) {
              if (seq !== self.previewSeq) return;
              self.problems = self.explain(err);
            });
          }, delay);
        },
        auditText: function () {
          if (!this.audit) return "Checking…";
          var c = this.audit.counts;
          if (!c.error && !c.critical) return c.warning ? "Audit clean · " + c.warning + " note" + (c.warning === 1 ? "" : "s") : "Audit clean";
          return (c.error + c.critical) + " audit error" + (c.error + c.critical === 1 ? "" : "s");
        },
        publish: function () {
          var self = this;
          if (self.publishing) return;
          self.publishing = true;
          self.save().then(function () {
            return api("POST", "/forms/" + self.formId + "/publish");
          }).then(function (v) {
            self.publishing = false;
            self.publishedVersion = v.version;
            self.markPublished(serialise(self.def));
            self.announce = "Published version " + v.version;
            self.publishedToast(v);
          }, function (err) {
            self.publishing = false;
            var t = self.$ui("#toasts");
            if (t) t.add({ message: "Not published: " + (self.explain(err)[0] || err.message), tone: "error" });
          });
        },
        /** The toast says where the form lives: open it, copy it, or change the address. */
        publishedToast: function (v) {
          var self = this;
          var url = v.url || self.publicUrl();
          var t = self.$ui("#toasts");
          if (!t) return;
          var id = t.add({
            message: "Published version " + v.version + ". It is live at",
            tone: "success",
            duration: 15000,
            actionLabel: "Copy link",
            onAction: function () { copyText(url).then(function () { self.announce = "Link copied"; }); },
          });
          var message = document.querySelector('[data-toast-id="' + id + '"] [data-part="message"]');
          if (!message) return;
          var link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = url.replace(/^https?:\/\//, "");
          link.setAttribute("data-designer-toast-link", "");
          var change = document.createElement("a");
          change.href = self.settingsHref();
          change.textContent = "Change";
          message.append(" ", link, " · ", change);
        },

        keys: function (e) {
          var t = e.target;
          var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
          var mod = e.ctrlKey || e.metaKey;
          // A key that lands while the moved card is being re-drawn (focus on the page) still moves it.
          if (e.altKey && !typing && (e.key === "ArrowUp" || e.key === "ArrowDown") && this.selected && t === document.body) { this.cardKey(e, this.selected); return; }
          if (mod && !typing && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
          else if (mod && !typing && (e.key === "y" || e.key === "Y")) { e.preventDefault(); this.redo(); }
          else if (mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); this.save().catch(function () {}); }
        },
      };
    });
  }

  /** Move top-level property `name` to position `index` (property order is field order). */
  function reorderTop(d, name, index) {
    var keys = Object.keys(d.schema.properties).filter(function (k) { return k !== name; });
    keys.splice(Math.max(0, Math.min(index, keys.length)), 0, name);
    var props = {};
    keys.forEach(function (k) { props[k] = d.schema.properties[k]; });
    d.schema.properties = props;
  }

  register(window.Faqir);
})();
