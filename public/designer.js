// forecraft designer — the drag-and-drop editor for people.
//
// One object, `def`, is the form definition exactly as the API returns it
// ({ schema, ui, rules, appearance }). The canvas, the properties panel, the
// rules list, the appearance controls and the JSON tab are all views of it;
// every edit goes through apply(), which replaces `def`, records undo history,
// autosaves (PATCH /api/v1/forms/:id) and refreshes the live preview
// (POST /api/v1/preview → the real public page in an iframe).
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
    { id: "multi", label: "Checkboxes", icon: "check-check", schema: { type: "array", title: "Pick any", items: { type: "string", enum: ["One", "Two", "Three"] }, uniqueItems: true }, ui: { widget: "checkbox-group" } },
    { id: "scale", label: "Scale 1–5", icon: "star", schema: { type: "string", title: "How would you rate it?", enum: ["1", "2", "3", "4", "5"] }, ui: { widget: "radio" } },
    { id: "yesno", label: "Checkbox", icon: "check", schema: { type: "boolean", title: "I agree" } },
    { id: "switch", label: "Switch", icon: "sliders-horizontal", schema: { type: "boolean", title: "Turn it on" }, ui: { widget: "switch" } },
  ];
  var KIND = {};
  KINDS.forEach(function (k) { KIND[k.id] = k; });

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function kindOf(schema, ui) {
    ui = ui || {};
    var widget = ui.widget || ui["ui:widget"];
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

  function kindMeta(id) {
    return KIND[id] || { id: id, label: id === "repeat" ? "Repeatable group" : "Group", icon: "layers" };
  }

  /** "What's your name?" → "whatsYourName" (unique among `taken`). */
  function nameFor(title, taken) {
    var words = String(title).toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 4);
    var base = words.map(function (w, i) { return i ? w[0].toUpperCase() + w.slice(1) : w; }).join("") || "field";
    if (/^[0-9]/.test(base)) base = "f" + base;
    var name = base, n = 2;
    while (taken[name]) name = base + n++;
    return name;
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

  // ── Conditions in plain words (the rules tab) ────────────────────────────
  function conditionFor(field, op, value, kind) {
    var v = { var: field };
    if (op === "filled") return { "!": { missing: [field] } };
    if (op === "empty") return { missing: [field] };
    if (kind === "yesno" || kind === "switch") return { "==": [v, op === "eq"] };
    if (kind === "multi") return op === "eq" ? { in: [value, v] } : { "!": { in: [value, v] } };
    if (kind === "number") value = Number(value);
    return op === "eq" ? { "==": [v, value] } : { "!=": [v, value] };
  }

  function describeCondition(when, titleOf) {
    if (!when || typeof when !== "object") return null;
    var op = Object.keys(when)[0];
    var args = when[op];
    var q = function (x) { return "“" + x + "”"; };
    if ((op === "==" || op === "!=") && args[0] && args[0].var !== undefined) {
      if (args[1] === true) return titleOf(args[0].var) + (op === "==" ? " is ticked" : " is not ticked");
      if (args[1] === false) return titleOf(args[0].var) + (op === "==" ? " is not ticked" : " is ticked");
      return titleOf(args[0].var) + (op === "==" ? " is " : " is not ") + q(args[1]);
    }
    if (op === "in" && args[1] && args[1].var !== undefined) return titleOf(args[1].var) + " includes " + q(args[0]);
    if (op === "missing") return titleOf(args[0]) + " is empty";
    if (op === "!" && args.missing) return titleOf(args.missing[0]) + " is filled in";
    if (op === "!" && args.in) return titleOf(args.in[1].var) + " does not include " + q(args.in[0]);
    return null;
  }

  function register(Faqir) {
    Faqir.data("designer", function () {
      return {
        formId: "",
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
        // editor state
        kinds: KINDS,
        selected: "",
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
        slug: "",
        publishing: false,
        announce: "",
        history: [],
        cursor: -1,
        lastEdit: { key: "", at: 0 },
        saveTimer: 0,
        previewTimer: 0,
        ruleDraft: { verb: "show", target: "", field: "", op: "eq", value: "" },

        init: function () {
          var self = this;
          api("GET", "/forms/" + self.formId).then(function (form) {
            self.slug = form.slug;
            self.def = form.definition;
            self.history = [JSON.stringify(form.definition)];
            self.cursor = 0;
            self.loaded = true;
            self.render();
            self.refreshPreview(0);
          }, function (err) {
            self.status = "error";
            self.statusText = "Could not load the form: " + err.message;
          });
          window.addEventListener("beforeunload", function (e) {
            if (self.status === "dirty" || self.status === "saving") { e.preventDefault(); e.returnValue = ""; }
          });
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
          if (!fromJson) {
            this.jsonText = JSON.stringify(def, null, 2);
            this.jsonError = "";
          }
        },

        describeRules: function () {
          var self = this;
          var titleOf = function (n) { var f = self.def.schema.properties[n]; return f ? "“" + (f.title || n) + "”" : "“" + n + "”"; };
          return ((this.def.rules && this.def.rules.rules) || []).map(function (r) {
            var cond = describeCondition(r.when, titleOf);
            var text;
            if (r.show !== undefined) text = "Show " + titleOf(r.show) + (cond ? " when " + cond : " (custom condition)");
            else if (r.require !== undefined) text = "Require " + titleOf(r.require) + (cond ? " when " + cond : " (custom condition)");
            else if (r.validate !== undefined) text = "Check " + titleOf(r.path) + ": " + (r.message || r.id);
            else text = "Custom rule " + r.id + " (edit it in the JSON tab)";
            return { id: r.id, text: text, verb: r.show !== undefined ? "show" : r.require !== undefined ? "require" : "other" };
          });
        },

        field: function () {
          if (!this.selected || !this.def) return null;
          var s = this.def.schema.properties[this.selected];
          if (!s) return null;
          var ui = (this.def.ui && this.def.ui[this.selected]) || {};
          var kind = kindOf(s, ui);
          var options = s.enum || (s.items && s.items.enum) || null;
          return {
            name: this.selected,
            kind: kind,
            kindLabel: kindMeta(kind).label,
            title: s.title || "",
            description: s.description || "",
            placeholder: ui.placeholder || ui["ui:placeholder"] || "",
            required: (this.def.schema.required || []).indexOf(this.selected) >= 0,
            options: options ? options.join("\n") : "",
            hasOptions: !!options,
            isText: s.type === "string" && !options && !s.format,
            isNumber: s.type === "number" || s.type === "integer",
            hasPlaceholder: s.type !== "boolean" && !options && s.type !== "array",
            minLength: s.minLength === undefined ? "" : s.minLength,
            maxLength: s.maxLength === undefined ? "" : s.maxLength,
            minimum: s.minimum === undefined ? "" : s.minimum,
            maximum: s.maximum === undefined ? "" : s.maximum,
          };
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
            var list = d.ui && (d.ui["ui:wizard"] ? d.ui["ui:wizard"].steps : d.ui["ui:groups"]);
            if (list) {
              var sec = list[si === undefined ? list.length - 1 : si];
              sec.fields.splice(index === undefined ? sec.fields.length : index, 0, name);
            } else if (index !== undefined) {
              reorderTop(d, name, index);
            }
          });
          this.selected = name;
          this.announce = kind.label + " added";
        },

        moveField: function (name, si, index) {
          var self = this;
          this.apply(function (d) {
            var list = d.ui && (d.ui["ui:wizard"] ? d.ui["ui:wizard"].steps : d.ui["ui:groups"]);
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
          self.announce = "Moved";
        },

        nudge: function (name, delta) {
          var pos = this.position(name);
          var sec = this.sections[pos.si];
          var to = pos.fi + delta;
          if (to >= 0 && to < sec.fields.length) {
            this.moveField(name, pos.si, delta > 0 ? to + 1 : to);
          } else if (delta < 0 && pos.si > 0) {
            this.moveField(name, pos.si - 1, this.sections[pos.si - 1].fields.length);
          } else if (delta > 0 && pos.si < this.sections.length - 1) {
            this.moveField(name, pos.si + 1, 0);
          } else return;
          this.announce = "Moved " + (delta < 0 ? "up" : "down");
          var self = this;
          setTimeout(function () { var el = document.getElementById("field-" + name); if (el) el.focus(); self.selected = name; }, 30);
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
              var list = d.ui["ui:wizard"] ? d.ui["ui:wizard"].steps : d.ui["ui:groups"];
              if (list) list.forEach(function (s) { s.fields = s.fields.filter(function (n) { return n !== name; }); });
            }
            if (d.rules && d.rules.rules) {
              d.rules.rules = d.rules.rules.filter(function (r) { return JSON.stringify(r).indexOf('"' + name + '"') < 0; });
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
            var list = d.ui && (d.ui["ui:wizard"] ? d.ui["ui:wizard"].steps : d.ui["ui:groups"]);
            if (list) list.forEach(function (s) { var i = s.fields.indexOf(name); if (i >= 0) s.fields.splice(i + 1, 0, copy); });
          });
          this.selected = copy;
        },

        // ── Drag and drop ─────────────────────────────────────────────────
        dragKind: function (e, kindId) {
          e.dataTransfer.setData("text/plain", "kind:" + kindId);
          e.dataTransfer.effectAllowed = "copy";
          this.dragging = { kind: kindId };
        },
        dragField: function (e, name) {
          e.dataTransfer.setData("text/plain", "field:" + name);
          e.dataTransfer.effectAllowed = "move";
          this.dragging = { field: name };
        },
        dragEnd: function () { this.dragging = null; this.drop = null; },
        overField: function (e, si, fi) {
          e.preventDefault();
          var rect = e.currentTarget.getBoundingClientRect();
          var index = e.clientY > rect.top + rect.height / 2 ? fi + 1 : fi;
          if (!this.drop || this.drop.si !== si || this.drop.index !== index) this.drop = { si: si, index: index };
        },
        overEnd: function (e, si) {
          e.preventDefault();
          var index = this.sections[si].fields.length;
          if (!this.drop || this.drop.si !== si || this.drop.index !== index) this.drop = { si: si, index: index };
        },
        isDrop: function (si, index) { return !!this.drop && this.drop.si === si && this.drop.index === index; },
        dropHere: function (e) {
          e.preventDefault();
          var data = e.dataTransfer.getData("text/plain");
          var at = this.drop;
          this.drop = null;
          this.dragging = null;
          if (!at || !data) return;
          if (data.indexOf("kind:") === 0) this.addKind(data.slice(5), at.si, at.index);
          else if (data.indexOf("field:") === 0) this.moveField(data.slice(6), at.si, at.index);
        },
        leaveCanvas: function (e) {
          if (!e.currentTarget.contains(e.relatedTarget)) this.drop = null;
        },

        cardKey: function (e, name) {
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
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
          this.tab = "build";
        },

        // ── Properties ────────────────────────────────────────────────────
        setProp: function (prop, value) {
          var name = this.selected;
          if (!name) return;
          this.apply(function (d) {
            var s = d.schema.properties[name];
            var num = function (v) { return v === "" || v === null ? undefined : Number(v); };
            if (prop === "title") s.title = value;
            else if (prop === "description") { if (value) s.description = value; else delete s.description; }
            else if (prop === "placeholder") {
              d.ui = d.ui || {};
              d.ui[name] = d.ui[name] || {};
              if (value) d.ui[name].placeholder = value; else delete d.ui[name].placeholder;
              if (!Object.keys(d.ui[name]).length) delete d.ui[name];
            } else if (prop === "required") {
              var req = (d.schema.required || []).filter(function (n) { return n !== name; });
              if (value) req.push(name);
              if (req.length) d.schema.required = req; else delete d.schema.required;
            } else if (prop === "options") {
              var opts = String(value).split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
              opts = opts.filter(function (x, i) { return opts.indexOf(x) === i; });
              if (!opts.length) opts = ["Option A"];
              if (s.items) s.items.enum = opts; else s.enum = opts;
            } else if (["minLength", "maxLength", "minimum", "maximum"].indexOf(prop) >= 0) {
              var n = num(value);
              if (n === undefined || isNaN(n)) delete s[prop]; else s[prop] = n;
            }
          }, { key: name + ":" + prop });
        },

        rename: function (value) {
          var from = this.selected;
          var to = String(value).trim();
          if (!from || !to || to === from) return;
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) { this.announce = "A name is letters, digits and _ and starts with a letter."; return; }
          if (this.def.schema.properties[to]) { this.announce = "Another field already has that name."; return; }
          this.apply(function (d) {
            var props = {};
            Object.keys(d.schema.properties).forEach(function (k) { props[k === from ? to : k] = d.schema.properties[k]; });
            d.schema.properties = props;
            if (d.schema.required) d.schema.required = d.schema.required.map(function (n) { return n === from ? to : n; });
            if (d.ui) {
              if (d.ui[from]) { d.ui[to] = d.ui[from]; delete d.ui[from]; }
              var list = d.ui["ui:wizard"] ? d.ui["ui:wizard"].steps : d.ui["ui:groups"];
              if (list) list.forEach(function (s) { s.fields = s.fields.map(function (n) { return n === from ? to : n; }); });
            }
            if (d.rules && d.rules.rules) {
              d.rules.rules = JSON.parse(JSON.stringify(d.rules.rules)
                .split('{"var":"' + from + '"}').join('{"var":"' + to + '"}')
                .split('"show":"' + from + '"').join('"show":"' + to + '"')
                .split('"require":"' + from + '"').join('"require":"' + to + '"')
                .split('"path":"' + from + '"').join('"path":"' + to + '"')
                .split('"missing":["' + from + '"]').join('"missing":["' + to + '"]'));
            }
          });
          this.selected = to;
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
          this.apply(function (d) {
            var list = mode === "wizard" ? d.ui["ui:wizard"].steps : d.ui["ui:groups"];
            list.push({ title: word + " " + (list.length + 1), fields: [] });
          });
          this.announce = word + " added — drag fields into it";
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
        draftField: function () {
          var f = this.def && this.def.schema.properties[this.ruleDraft.field];
          if (!f) return { kind: "", options: [] };
          var kind = kindOf(f, this.def.ui && this.def.ui[this.ruleDraft.field]);
          return { kind: kind, options: f.enum || (f.items && f.items.enum) || [], boolean: f.type === "boolean" };
        },
        addRule: function () {
          var r = this.ruleDraft;
          if (!r.target || !r.field || r.target === r.field) { this.announce = "Pick the field to " + r.verb + " and a different field to watch."; return; }
          var info = this.draftField();
          if ((r.op === "eq" || r.op === "neq") && !info.boolean && r.value === "") { this.announce = "Pick or type the value to compare with."; return; }
          var when = conditionFor(r.field, r.op, r.value, info.kind);
          var self = this;
          this.apply(function (d) {
            d.rules = d.rules || {};
            d.rules.rules = d.rules.rules || [];
            var base = r.verb + "-" + r.target.toLowerCase(), id = base, n = 2;
            var taken = d.rules.rules.map(function (x) { return x.id; });
            while (taken.indexOf(id) >= 0) id = base + "-" + n++;
            var rule = { id: id };
            rule[r.verb] = r.target;
            rule.when = when;
            d.rules.rules.push(rule);
          });
          self.ruleDraft = { verb: r.verb, target: "", field: "", op: "eq", value: "" };
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
          if (key === "thanksTitle") return (a.thankYou && a.thankYou.title) || "Thank you!";
          if (key === "thanksMessage") return (a.thankYou && a.thankYou.message) || "Your answers are in. You can close this page.";
          var defaults = { theme: "default", accent: "theme", scheme: "auto", layout: "card", submitLabel: "Submit", redirect: "" };
          return a[key] === undefined || a[key] === null ? defaults[key] : a[key];
        },
        setLook: function (key, value) {
          this.apply(function (d) {
            var a = d.appearance = d.appearance || {};
            if (key === "coverImage" || key === "eyebrow") {
              a.cover = a.cover || { image: "", eyebrow: "" };
              a.cover[key === "coverImage" ? "image" : "eyebrow"] = value;
              if (!a.cover.image && !a.cover.eyebrow) delete a.cover;
            } else if (key === "thanksTitle" || key === "thanksMessage") {
              a.thankYou = a.thankYou || { title: "Thank you!", message: "Your answers are in. You can close this page." };
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
        scheduleSave: function () {
          var self = this;
          self.status = "dirty";
          self.statusText = "Unsaved changes";
          clearTimeout(self.saveTimer);
          self.saveTimer = setTimeout(function () { self.save(); }, 800);
        },
        save: function () {
          var self = this;
          clearTimeout(self.saveTimer);
          var snapshot = JSON.stringify(self.def);
          self.status = "saving";
          self.statusText = "Saving…";
          return api("PATCH", "/forms/" + self.formId, { definition: self.def }).then(function () {
            if (JSON.stringify(self.def) !== snapshot) return self.save();
            self.status = "saved";
            self.statusText = "All changes saved";
            self.problems = [];
          }, function (err) {
            self.status = "error";
            self.statusText = "Not saved — fix the problems below";
            self.problems = (err.problems || []).map(function (p) { return (p.pointer ? p.pointer + ": " : "") + p.detail; });
            throw err;
          });
        },
        refreshPreview: function (delay) {
          var self = this;
          clearTimeout(self.previewTimer);
          self.previewTimer = setTimeout(function () {
            api("POST", "/preview", { definition: self.def }).then(function (res) {
              var frame = document.getElementById("designer-preview");
              if (frame) frame.srcdoc = res.html;
              self.audit = res.audit;
            }, function (err) {
              self.problems = (err.problems || []).map(function (p) { return (p.pointer ? p.pointer + ": " : "") + p.detail; });
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
          self.publishing = true;
          self.save().then(function () {
            return api("POST", "/forms/" + self.formId + "/publish");
          }).then(function (v) {
            self.publishing = false;
            self.announce = "Published version " + v.version;
            var t = self.$ui("#toasts");
            if (t) t.add({ message: "Published version " + v.version + ". The public link serves it now.", tone: "success" });
          }, function (err) {
            self.publishing = false;
            var t = self.$ui("#toasts");
            if (t) t.add({ message: "Not published: " + err.message, tone: "error" });
          });
        },

        keys: function (e) {
          var t = e.target;
          var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
          var mod = e.ctrlKey || e.metaKey;
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
