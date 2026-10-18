// forecraft report designer — the page designer for people.
//
// One object, `def`, is the report definition exactly as the API stores it
// ({ schema, sample, layout, appearance, money, numbering, … }). The canvas, the
// properties panel, the data, appearance and JSON tabs and the preflight list
// are all views of it; every edit goes through apply(), which replaces `def`,
// records undo history, autosaves (PATCH /api/v1/reports/:id) and re-renders
// the canvas — the server's own HTML for the page (POST …/preview, format
// "html", view "canvas") in an iframe, true to scale. After each save the
// preflight runs on the real PDF and the strip shows its pages.
//
// Built on faqir-core (l-data, l-for, l-on) and native HTML5 drag and drop.
(function () {
  "use strict";

  var HISTORY = 60;
  var MM = 96 / 25.4;

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function api(method, path, body) {
    return fetch("/api/v1" + path, {
      method: method,
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (json) {
        if (!res.ok) {
          var err = new Error(json.detail || res.statusText);
          err.problems = json.errors || [];
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  // ── The layout tree ──────────────────────────────────────────────────────
  /** { list, index, parent } of the block with this id, anywhere in the layout. */
  function locate(layout, id) {
    var found = null;
    (function walk(list, parent) {
      for (var i = 0; i < list.length && !found; i++) {
        var b = list[i];
        if (b.id === id) { found = { list: list, index: i, block: b, parent: parent }; return; }
        if (b.block === "section" && Array.isArray(b.blocks)) walk(b.blocks, b);
        if (b.block === "columns" && Array.isArray(b.columns)) b.columns.forEach(function (col) { walk(col, b); });
      }
    })(layout, null);
    return found;
  }

  function allIds(layout) {
    var ids = {};
    (function walk(list) {
      list.forEach(function (b) {
        ids[b.id] = true;
        if (b.block === "section" && Array.isArray(b.blocks)) walk(b.blocks);
        if (b.block === "columns" && Array.isArray(b.columns)) b.columns.forEach(walk);
      });
    })(layout);
    return ids;
  }

  function freshId(layout, base) {
    var ids = allIds(layout);
    var id = base, n = 2;
    while (ids[id]) id = base + "-" + n++;
    return id;
  }

  /** Sensible first content for a block dropped from the palette. */
  function newBlock(name, vocab, layout) {
    var DEFAULTS = {
      letterhead: { name: "Your company", lines: ["Street and number", "Postcode and city"], details: [{ label: "Email", value: "hello@example.com" }] },
      title: { text: "{{ label(\"invoice\") }}", details: [{ label: "{{ label(\"number\") }}", value: "{{ doc.number ?? label(\"draft\") }}" }, { label: "{{ label(\"issueDate\") }}", value: "{{ date(doc.issuedAt) }}" }] },
      facts: { items: [{ label: "Reference", value: "—" }, { label: "Terms", value: "30 days" }] },
      parties: { parties: [{ label: "{{ label(\"billTo\") }}", name: "Customer name", lines: ["Street", "City"] }] },
      table: { rows: "items", columns: [
        { label: "{{ label(\"description\") }}", value: "{{ row.description ?? \"\" }}", width: "wide" },
        { label: "{{ label(\"quantity\") }}", value: "{{ number(row.qty ?? 0) }}", format: "number" },
      ] },
      totals: {},
      text: { markdown: "Write here. Use **bold**, lists and [links](https://example.com); insert data with holes." },
      callout: { title: "Note", markdown: "Something the reader should not miss." },
      signature: { signatures: [{ name: "Name", role: "Role" }, { name: "Name", role: "Role" }] },
      section: { title: "Section", numbered: true, blocks: [] },
      columns: { columns: [[], []] },
      stamp: { text: "{{ label(\"copy\") }}", tone: "default" },
      footer: { lines: ["Company · Address · Registration"] },
      qr: { value: "{{ doc.number ?? \"DRAFT\" }}", caption: "Reference" },
      barcode: { value: "{{ doc.number ?? \"DRAFT\" }}" },
    };
    var base = DEFAULTS[name] ? clone(DEFAULTS[name]) : clone(vocab.blocks[name].example);
    delete base.id;
    delete base.block;
    var b = { id: freshId(layout, name), block: name };
    Object.keys(base).forEach(function (k) { b[k] = base[k]; });
    return b;
  }

  /** Field paths the Insert field picker offers: the schema's, the row's, the system's. */
  function schemaPaths(schema) {
    var out = [];
    (function walk(props, prefix, rowPrefix) {
      Object.keys(props || {}).forEach(function (k) {
        var p = props[k] || {};
        var path = prefix + k;
        if (p.type === "object" && p.properties) walk(p.properties, path + ".", rowPrefix);
        else if (p.type === "array" && p.items && p.items.properties) {
          out.push({ path: path, type: "array", title: p.title || k });
          walk(p.items.properties, "row.", true);
        } else out.push({ path: path, type: p.type + (p.format ? " (" + p.format + ")" : "") + (p.enum ? " (choice)" : ""), title: p.title || k });
      });
    })(schema.properties, "", false);
    return out;
  }

  /** A JSON Schema guessed from example data: strings, numbers, booleans, objects, arrays of objects. */
  function infer(value, title) {
    if (Array.isArray(value)) {
      var first = value.find(function (v) { return v !== null && v !== undefined; });
      if (first && typeof first === "object" && !Array.isArray(first)) {
        var merged = {};
        value.forEach(function (row) { if (row && typeof row === "object") Object.keys(row).forEach(function (k) { if (merged[k] === undefined) merged[k] = row[k]; }); });
        return { type: "array", title: title, items: infer(merged) };
      }
      return { type: "array", title: title, items: first === undefined ? { type: "string" } : infer(first) };
    }
    if (value && typeof value === "object") {
      var props = {};
      Object.keys(value).forEach(function (k) { props[k] = infer(value[k], k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (c) { return c.toUpperCase(); })); });
      return { type: "object", title: title, properties: props };
    }
    var out = { type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string" };
    if (title) out.title = title;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) out.format = "date";
    return out;
  }

  /** Money keys guessed from a lines array's property names (qty, price, vat, …). */
  function guessMoney(schema, lines) {
    var p = (schema.properties[lines] && schema.properties[lines].items && schema.properties[lines].items.properties) || {};
    var names = Object.keys(p);
    var find = function (re) { return names.find(function (n) { return re.test(n); }); };
    var out = { lines: lines };
    var q = find(/^(qty|quantity|count|units?|hours)$/i), u = find(/^(price|unitPrice|unit_price|rate|amount)$/i), t = find(/^(vat|tax|taxRate|tax_rate|vatRate)$/i), dsc = find(/^discount/i);
    if (q) out.quantity = q;
    if (u) out.unitPrice = u;
    if (t) out.taxRate = t;
    if (dsc) out.discount = dsc;
    return out;
  }

  function get(obj, path) {
    return path.split(".").reduce(function (o, k) { return o === undefined || o === null ? undefined : o[k]; }, obj);
  }
  function set(obj, path, value) {
    var keys = path.split(".");
    var last = keys.pop();
    var o = keys.reduce(function (o, k, i) {
      if (o[k] === undefined) o[k] = /^\d+$/.test(keys[i + 1] || last) ? [] : {};
      return o[k];
    }, obj);
    if (value === undefined || value === "") delete o[last];
    else o[last] = value;
  }

  function register(Faqir) {
    Faqir.data("reportDesigner", function () {
      return {
        reportId: "",
        vocabulary: { blocks: {}, themes: [], pairings: [], locales: [] },
        forms: [],
        def: null,
        title: "",
        selected: "",
        selectedType: "",
        footerId: "",
        tab: "layout",
        zoom: "fit",
        zoomFactor: 1,
        status: "saved",
        statusText: "All changes saved",
        problems: [],
        findings: [],
        pages: [],
        preflightRan: false,
        preflightBusy: false,
        fields: [],
        paths: [],
        schemaFields: [],
        sampleText: "",
        sampleError: "",
        jsonText: "",
        jsonError: "",
        bindForm: "",
        themeThumbs: {},
        money: {},
        moneyArrays: [],
        moneyItemProps: [],
        moneyKeys: [{ key: "quantity", label: "Quantity" }, { key: "unitPrice", label: "Unit price" }, { key: "taxRate", label: "Tax rate %" }, { key: "discount", label: "Discount %" }],
        look: {},
        busy: false,
        history: [],
        cursor: -1,
        lastEdit: { key: "", at: 0 },
        saveTimer: 0,
        canvasTimer: 0,
        canvasSeq: 0,
        preflightTimer: 0,
        dragging: null,
        lastText: null,

        init: function () {
          var self = this;
          api("GET", "/reports/" + self.reportId).then(function (r) {
            self.def = r.definition;
            self.history = [JSON.stringify(r.definition)];
            self.cursor = 0;
            self.render();
            self.refreshCanvas(0);
            self.runPreflight(0);
          }, function (err) {
            self.status = "error";
            self.statusText = "Could not load the report: " + err.message;
          });
          window.addEventListener("beforeunload", function (e) {
            if (self.status !== "saved") { e.preventDefault(); e.returnValue = ""; }
          });
          window.addEventListener("resize", function () { self.fit(); });
          var frame = document.getElementById("rd-canvas");
          frame.addEventListener("load", function () { self.wire(frame); });
        },

        // ── The one way to change the definition ─────────────────────────
        apply: function (mutate, opts) {
          opts = opts || {};
          var next = clone(this.def);
          mutate(next);
          this.def = next;
          var snapshot = JSON.stringify(next);
          var now = Date.now();
          if (opts.key && opts.key === this.lastEdit.key && now - this.lastEdit.at < 1200 && this.cursor === this.history.length - 1) {
            this.history[this.cursor] = snapshot;
          } else {
            this.history = this.history.slice(0, this.cursor + 1).concat([snapshot]).slice(-HISTORY);
            this.cursor = this.history.length - 1;
          }
          this.lastEdit = { key: opts.key || "", at: now };
          this.render(opts);
          this.scheduleSave();
          this.refreshCanvas(350);
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
          if (this.selected && !locate(this.def.layout, this.selected)) this.selected = "";
          this.render();
          this.scheduleSave();
          this.refreshCanvas(200);
        },

        // ── Views of the definition ──────────────────────────────────────
        render: function (opts) {
          opts = opts || {};
          var def = this.def;
          this.title = def.schema.title;
          var footer = def.layout.find(function (b) { return b.block === "footer"; });
          this.footerId = footer ? footer.id : "";
          var a = def.appearance || {};
          var d = this.vocabulary.defaults || {};
          var letter = a.letter || {};
          this.look = {
            theme: a.theme || d.theme, accent: a.accent || d.accent, paper: a.paper || d.paper, orientation: a.orientation || d.orientation,
            margins: a.margins || d.margins, type: a.type || d.type, density: a.density || d.density, locale: a.locale || d.locale,
            currency: a.currency || d.currency, logo: a.logo || "", window: Boolean(letter.window), foldMarks: Boolean(letter.foldMarks),
          };
          this.schemaFields = schemaPaths(def.schema);
          this.money = def.money || {};
          var props = def.schema.properties || {};
          this.moneyArrays = Object.keys(props).filter(function (k) { return props[k].type === "array" && props[k].items && props[k].items.properties; });
          var lines = this.money.lines && props[this.money.lines];
          this.moneyItemProps = lines ? Object.keys(lines.items.properties) : [];
          var paths = this.schemaFields.filter(function (f) { return f.type !== "array"; }).map(function (f) { return f.path; });
          this.paths = paths.concat(["doc.number", "doc.issuedAt", "doc.money.total", "doc.money.due", "doc.money.subtotal", "line.net", "line.tax", "i"]);
          if (!opts.fromSample) this.sampleText = JSON.stringify(def.sample, null, 2);
          if (!opts.fromJson) this.jsonText = JSON.stringify(def, null, 2);
          this.renderProps();
        },

        renderProps: function () {
          var self = this;
          var at = self.selected ? locate(self.def.layout, self.selected) : null;
          if (!at) { self.selected = ""; self.fields = []; return; }
          var b = at.block;
          var spec = (self.vocabulary.blocks[b.block] || { props: {} }).props;
          self.selectedType = b.block;
          var fields = [];
          var label = function (k) { return k.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); }); };
          var cellOf = function (key, name, kind, value) {
            var c = { key: key, label: label(name), kind: kind.k === "list" && kind.of.k === "text" ? "lines" : kind.k, value: value };
            if (kind.k === "enum") { c.options = [""].concat(kind.values); c.value = value || ""; }
            if (c.kind === "lines") c.value = (value || []).join(" | ");
            if (kind.k === "bool") c.value = Boolean(value);
            return c;
          };
          Object.keys(spec).forEach(function (name) {
            var kind = spec[name];
            var v = b[name];
            var f = { key: name, label: label(name) + (kind.required ? "" : " (optional)"), kind: kind.k, value: v === undefined ? "" : v, hint: "" };
            if (kind.k === "blocks" || kind.k === "columns") return; // children are edited on the page
            if (kind.k === "enum") { f.options = [""].concat(kind.values); f.value = v || ""; }
            if (kind.k === "bool") f.value = Boolean(v);
            if (kind.k === "expr") f.hint = "A bare expression, e.g. items or doc.money.due != \"0.00\".";
            if (kind.k === "md") f.hint = "Markdown with {{ }} holes. Data is always printed as text.";
            if (kind.k === "asset") f.hint = "asset:ast_… — upload under Appearance.";
            if (kind.k === "list" && kind.of.k === "text") { f.kind = "lines"; f.value = (v || []).join("\n"); f.hint = "One line each."; }
            if (kind.k === "list" && kind.of.k === "object") {
              f.kind = "rows";
              f.addLabel = name === "columns" ? "Add a column" : "Add a row";
              var sub = kind.of.props;
              f.rows = (v || []).map(function (row, i) {
                return {
                  key: name + "." + i, index: i,
                  cells: Object.keys(sub).filter(function (k) { return !(sub[k].k === "list" && sub[k].of.k === "object"); }).map(function (k) {
                    return cellOf(name + "." + i + "." + k, k, sub[k], row[k]);
                  }),
                };
              });
            }
            fields.push(f);
          });
          fields.push({ key: "when", label: "Show when (optional)", kind: "expr", value: b.when || "", hint: "Leave empty to always show it." });
          fields.push({ key: "keep", label: "Keep", kind: "enum", options: ["", "together", "with-next"], value: b.keep || "" });
          self.fields = fields;
        },

        // ── Selection, editing ───────────────────────────────────────────
        select: function (id) {
          this.selected = id;
          this.renderProps();
          this.markSelection();
        },
        setTitle: function (v) { this.apply(function (d) { d.schema.title = v; }, { key: "title" }); },
        setField: function (key, value) {
          var self = this;
          var id = self.selected;
          var kind = null;
          self.fields.forEach(function (f) { if (f.key === key) kind = f.kind; });
          self.apply(function (d) {
            var at = locate(d.layout, id);
            if (!at) return;
            var cellLines = typeof value === "string" && /\.lines$/.test(key);
            if (kind === "lines") value = value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
            else if (cellLines) value = value.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
            set(at.block, key, value);
          }, { key: id + ":" + key });
        },
        addRow: function (key) {
          var id = this.selected;
          this.apply(function (d) {
            var at = locate(d.layout, id);
            var list = get(at.block, key) || [];
            list.push(key === "columns" ? { label: "Column", value: "{{ row.x ?? \"\" }}" } : key === "signatures" ? { name: "Name" } : key === "series" ? { name: "Series", value: "row.value" } : key === "parties" ? { name: "Name" } : key === "items" && at.block.block === "stats" ? { label: "Label", value: "0" } : { label: "Label", value: "Value" });
            set(at.block, key, list);
          });
        },
        removeRow: function (key, index) {
          var id = this.selected;
          this.apply(function (d) {
            var at = locate(d.layout, id);
            var list = get(at.block, key) || [];
            list.splice(index, 1);
            at.block[key] = list;
          });
        },
        removeSelected: function () {
          var id = this.selected;
          if (!id) return;
          this.selected = "";
          this.apply(function (d) { var at = locate(d.layout, id); if (at) at.list.splice(at.index, 1); });
        },
        move: function (step) {
          var id = this.selected;
          this.apply(function (d) {
            var at = locate(d.layout, id);
            if (!at) return;
            var to = at.index + step;
            if (to < 0 || to >= at.list.length) return;
            at.list.splice(at.index, 1);
            at.list.splice(to, 0, at.block);
          });
        },
        addFromPalette: function (e) {
          var el = e.currentTarget || e.target;
          var btn = el.closest ? el.closest("[data-rd-block]") : null;
          if (btn) this.addBlock(btn.getAttribute("data-rd-block"));
        },
        addBlock: function (name) {
          var self = this;
          var b = newBlock(name, self.vocabulary, self.def.layout);
          self.apply(function (d) {
            // A totals block needs money: guess it from the first array of priced lines.
            if (name === "totals" && !d.money) {
              var props = d.schema.properties || {};
              var arr = Object.keys(props).find(function (k) { return props[k].type === "array" && props[k].items && props[k].items.properties; });
              if (arr) d.money = guessMoney(d.schema, arr);
            }
            var at = self.selected ? locate(d.layout, self.selected) : null;
            if (at) at.list.splice(at.index + 1, 0, b);
            else {
              // The footer stays last.
              var fi = d.layout.findIndex(function (x) { return x.block === "footer"; });
              if (fi >= 0 && name !== "footer") d.layout.splice(fi, 0, b); else d.layout.push(b);
            }
          });
          self.select(b.id);
        },

        remember: function (e) { this.lastText = { el: e.target, key: e.target.getAttribute("data-rd-key") }; },
        insertField: function (e) {
          var path = e.target.value;
          e.target.value = "";
          if (!path || !this.lastText || !this.lastText.el.isConnected) return;
          var el = this.lastText.el;
          var pos = el.selectionStart == null ? el.value.length : el.selectionStart;
          var hole = "{{ " + path + " }}";
          el.value = el.value.slice(0, pos) + hole + el.value.slice(el.selectionEnd == null ? pos : el.selectionEnd);
          el.focus();
          el.selectionStart = el.selectionEnd = pos + hole.length;
          this.setField(this.lastText.key, el.value);
        },

        // ── Data, appearance, JSON ───────────────────────────────────────
        setSample: function (text) {
          try {
            var v = JSON.parse(text);
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("The sample is a JSON object.");
            this.sampleError = "";
            this.apply(function (d) { d.sample = v; }, { key: "sample", fromSample: true });
          } catch (err) {
            this.sampleError = err.message;
          }
        },
        inferSchema: function () {
          var guess = infer(this.def.sample, this.def.schema.title);
          this.apply(function (d) {
            Object.keys(guess.properties).forEach(function (k) {
              if (!d.schema.properties[k]) d.schema.properties[k] = guess.properties[k];
            });
          });
          this.toast("Fields added from the sample. Existing fields kept their settings.", "success");
        },
        bindToForm: function () {
          var self = this;
          var id = self.bindForm;
          if (!id) return;
          Promise.all([api("GET", "/forms/" + id), api("GET", "/forms/" + id + "/submissions?limit=1")]).then(function (res) {
            var form = res[0].definition;
            var latest = res[1].items[0];
            self.apply(function (d) {
              var props = {};
              Object.keys(form.schema.properties).forEach(function (k) { var p = clone(form.schema.properties[k]); delete p.required; props[k] = p; });
              d.schema.properties = props;
              delete d.schema.required;
              d.sample = latest ? latest.data : {};
              d.source = { kind: "submission", form: id };
            });
            self.toast("Bound to the form: its fields, its latest answers, its submissions.", "success");
          }, function (err) { self.toast(err.message, "error"); });
        },
        setMoney: function (k, v) {
          this.apply(function (d) {
            if (k === "lines" && !v) { delete d.money; return; }
            d.money = d.money || {};
            if (v) d.money[k] = v; else delete d.money[k];
            if (k === "lines") Object.assign(d.money, guessMoney(d.schema, v));
          });
        },
        setLook: function (k, v) {
          var self = this;
          if (k === "accent" && !/^#[0-9a-fA-F]{6}$/.test(v)) return;
          self.apply(function (d) { d.appearance = d.appearance || {}; d.appearance[k] = v; }, { key: "look:" + k });
        },
        setLetter: function (k, v) {
          this.apply(function (d) { d.appearance = d.appearance || {}; d.appearance.letter = d.appearance.letter || {}; d.appearance.letter[k] = v; });
        },
        pairingNote: function () {
          var t = this.look.type;
          var p = (this.vocabulary.pairings || []).find(function (x) { return x.id === t; });
          return p ? p.note : "";
        },
        uploadLogo: function (e) {
          var self = this;
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          fetch("/api/v1/assets?name=" + encodeURIComponent(file.name), { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" }, credentials: "same-origin" })
            .then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.detail); return j; }); })
            .then(function (asset) { self.setLook("logo", asset.ref); self.toast("Logo uploaded.", "success"); }, function (err) { self.toast(err.message, "error"); });
        },
        setJson: function (text) {
          try {
            var v = JSON.parse(text);
            this.jsonError = "";
            this.apply(function (d) { Object.keys(d).forEach(function (k) { delete d[k]; }); Object.keys(v).forEach(function (k) { d[k] = v[k]; }); }, { key: "json", fromJson: true });
          } catch (err) {
            this.jsonError = "Not valid JSON yet: " + err.message;
          }
        },
        setTab: function (t) {
          this.tab = t;
          if (t === "look") this.themeThumbnails();
          if (t === "layout") this.fit();
        },
        themeThumbnails: function () {
          var self = this;
          (self.vocabulary.themes || []).forEach(function (t, i) {
            if (self.themeThumbs[t]) return;
            var def = clone(self.def);
            def.appearance = def.appearance || {};
            def.appearance.theme = t;
            setTimeout(function () {
              api("POST", "/reports/" + self.reportId + "/preview", { definition: def, format: "png", pages: 1, dpi: 30 }).then(function (r) {
                var next = Object.assign({}, self.themeThumbs);
                next[t] = "data:image/png;base64," + r.images[0].data;
                self.themeThumbs = next;
              }, function () {});
            }, i * 400);
          });
        },

        // ── The canvas ───────────────────────────────────────────────────
        refreshCanvas: function (delay) {
          var self = this;
          clearTimeout(self.canvasTimer);
          self.canvasTimer = setTimeout(function () {
            var seq = ++self.canvasSeq;
            api("POST", "/reports/" + self.reportId + "/preview", { definition: self.def, format: "html", view: "canvas", status: "draft" }).then(function (res) {
              if (seq !== self.canvasSeq) return;
              self.problems = [];
              var frame = document.getElementById("rd-canvas");
              if (frame) frame.srcdoc = res.html;
            }, function (err) {
              self.problems = (err.problems || []).map(function (p) { return (p.pointer ? p.pointer + ": " : "") + p.detail; });
              if (!self.problems.length) self.problems = [err.message];
            });
          }, delay);
        },
        sheetWidth: function () {
          var a = this.look;
          var w = a.paper === "letter" ? 215.9 : 210;
          var h = a.paper === "letter" ? 279.4 : 297;
          return Math.round((a.orientation === "landscape" ? h : w) * MM) + 48;
        },
        setZoom: function (z) { this.zoom = z; this.fit(); },
        fit: function () {
          var desk = document.querySelector("[data-rd-desk]");
          if (!desk) return;
          var w = this.sheetWidth();
          this.zoomFactor = this.zoom === "fit" ? Math.min(1, Math.max(0.4, (desk.clientWidth - 16) / w)) : Number(this.zoom);
        },
        wire: function (frame) {
          var self = this;
          var doc = frame.contentDocument;
          if (!doc) return;
          frame.setAttribute("width", String(self.sheetWidth()));
          frame.setAttribute("height", String(Math.max(600, doc.documentElement.scrollHeight + 8)));
          self.fit();
          doc.querySelectorAll("[data-block]").forEach(function (el) { el.setAttribute("draggable", "true"); });
          var blockAt = function (t) { return t && t.closest ? t.closest("[data-block]") : null; };
          var clear = function () { doc.querySelectorAll("[data-designer-drop]").forEach(function (el) { el.removeAttribute("data-designer-drop"); }); };
          doc.addEventListener("click", function (e) {
            var el = blockAt(e.target);
            if (e.target.closest && e.target.closest("a")) e.preventDefault();
            if (el) self.select(el.getAttribute("data-block"));
          });
          doc.addEventListener("mouseover", function (e) {
            doc.querySelectorAll("[data-designer-hover]").forEach(function (el) { el.removeAttribute("data-designer-hover"); });
            var el = blockAt(e.target);
            if (el) el.setAttribute("data-designer-hover", "");
          });
          doc.addEventListener("dragstart", function (e) {
            var el = blockAt(e.target);
            if (!el) return;
            self.dragging = { move: el.getAttribute("data-block") };
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", self.dragging.move);
          });
          doc.addEventListener("dragover", function (e) {
            if (!self.dragging) return;
            var el = blockAt(e.target);
            if (!el) return;
            e.preventDefault();
            clear();
            var r = el.getBoundingClientRect();
            el.setAttribute("data-designer-drop", e.clientY < r.top + r.height / 2 ? "before" : "after");
          });
          doc.addEventListener("dragleave", function (e) { if (!e.relatedTarget) clear(); });
          doc.addEventListener("drop", function (e) {
            var el = doc.querySelector("[data-designer-drop]");
            e.preventDefault();
            if (!el || !self.dragging) { self.dragEnd(); return; }
            var target = el.getAttribute("data-block");
            var where = el.getAttribute("data-designer-drop");
            clear();
            self.dropAt(target, where);
          });
          doc.addEventListener("keydown", function (e) { self.keys(e); });
          self.markSelection();
        },
        markSelection: function () {
          var frame = document.getElementById("rd-canvas");
          var doc = frame && frame.contentDocument;
          if (!doc) return;
          doc.querySelectorAll("[data-designer-selected]").forEach(function (el) { el.removeAttribute("data-designer-selected"); });
          if (!this.selected) return;
          var el = doc.querySelector('[data-block="' + this.selected.replace(/"/g, "") + '"]');
          if (el) el.setAttribute("data-designer-selected", "");
        },
        dragBlock: function (e) {
          var btn = e.target.closest ? e.target.closest("[data-rd-block]") : e.target;
          var name = btn.getAttribute("data-rd-block");
          this.dragging = { add: name };
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData("text/plain", name);
        },
        dragEnd: function () { this.dragging = null; },
        dropAt: function (target, where) {
          var self = this;
          var drag = self.dragging;
          self.dragging = null;
          if (!drag || drag.move === target) return;
          var added = drag.add ? newBlock(drag.add, self.vocabulary, self.def.layout) : null;
          self.apply(function (d) {
            var moving = added;
            if (drag.move) {
              var from = locate(d.layout, drag.move);
              if (!from) return;
              // A section cannot go inside itself.
              if (JSON.stringify(from.block).indexOf('"id":"' + target + '"') >= 0) return;
              from.list.splice(from.index, 1);
              moving = from.block;
            }
            var at = locate(d.layout, target);
            if (!at) { d.layout.push(moving); return; }
            // Dropping on a section's heading half puts the block inside it.
            if (at.block.block === "section" && where === "after" && Array.isArray(at.block.blocks) && at.block.blocks.length === 0) { at.block.blocks.push(moving); return; }
            at.list.splice(at.index + (where === "after" ? 1 : 0), 0, moving);
          });
          self.select(added ? added.id : drag.move);
        },

        // ── Saving, preflight, publishing ────────────────────────────────
        scheduleSave: function () {
          var self = this;
          self.status = "dirty";
          self.statusText = "Unsaved changes";
          clearTimeout(self.saveTimer);
          self.saveTimer = setTimeout(function () { self.save().catch(function () {}); }, 900);
        },
        save: function () {
          var self = this;
          clearTimeout(self.saveTimer);
          var snapshot = JSON.stringify(self.def);
          self.status = "saving";
          self.statusText = "Saving…";
          return api("PATCH", "/reports/" + self.reportId, { definition: self.def }).then(function () {
            if (JSON.stringify(self.def) !== snapshot) return self.save();
            self.status = "saved";
            self.statusText = "All changes saved";
            self.problems = [];
            self.runPreflight(600);
          }, function (err) {
            self.status = "error";
            self.statusText = "Not saved — see the problems";
            self.problems = (err.problems || []).map(function (p) { return (p.pointer ? p.pointer + ": " : "") + p.detail; });
            throw err;
          });
        },
        runPreflight: function (delay) {
          var self = this;
          clearTimeout(self.preflightTimer);
          self.preflightTimer = setTimeout(function () {
            self.preflightBusy = true;
            api("POST", "/reports/" + self.reportId + "/preview", { format: "png", pages: 8, dpi: 40 }).then(function (r) {
              self.preflightBusy = false;
              self.preflightRan = true;
              self.findings = r.findings;
              self.pages = r.images.map(function (i) { return "data:image/png;base64," + i.data; });
            }, function (err) {
              self.preflightBusy = false;
              // Busy or rate-limited: try again shortly rather than report a false error.
              if (err.status === 503 || err.status === 429) { self.runPreflight(4000); return; }
              self.findings = [{ severity: "error", code: "preview", message: err.message, block: null }];
            });
          }, delay);
        },
        errorCount: function () { return this.findings.filter(function (f) { return f.severity === "error"; }).length; },
        preflightText: function () {
          if (this.preflightBusy) return "Printing the PDF and checking it…";
          if (!this.preflightRan) return "Preflight runs on the real PDF after each save.";
          var e = this.errorCount(), w = this.findings.length - e;
          if (!e && !w) return "Clean: nothing to fix. " + this.pages.length + " page" + (this.pages.length === 1 ? "" : "s") + ".";
          return e + " error" + (e === 1 ? "" : "s") + " (issue is refused until they are fixed), " + w + " warning" + (w === 1 ? "" : "s") + ". Click one to select its block.";
        },
        goToFinding: function (i) {
          var f = this.findings[i];
          if (!f || !f.block) return;
          var tabs = this.$ui("#rd-tabs");
          if (tabs && tabs.select) tabs.select(0);
          this.tab = "layout";
          this.select(f.block);
          var frame = document.getElementById("rd-canvas");
          var el = frame && frame.contentDocument && frame.contentDocument.querySelector('[data-block="' + f.block + '"]');
          if (el) el.scrollIntoView({ block: "center" });
        },
        publish: function () {
          var self = this;
          self.busy = true;
          self.save().then(function () {
            return api("POST", "/reports/" + self.reportId + "/publish");
          }).then(function (v) {
            self.busy = false;
            self.toast("Published version " + v.version + ". New documents use it.", "success");
          }, function (err) {
            self.busy = false;
            self.toast("Not published: " + err.message, "error");
          });
        },
        testDocument: function () {
          var self = this;
          self.busy = true;
          self.save().then(function () {
            return api("GET", "/reports/" + self.reportId);
          }).then(function (r) {
            if (r.published_version === null) throw new Error("Publish first: documents come from a published version.");
            return api("POST", "/reports/" + self.reportId + "/documents", { data: r.definition.sample, issue: false });
          }).then(function (doc) {
            self.busy = false;
            window.open("/app/documents/" + doc.id, "_blank", "noopener");
          }, function (err) {
            self.busy = false;
            self.toast(err.message, "error");
          });
        },
        toast: function (message, tone) {
          var t = this.$ui("#toasts");
          if (t) t.add({ message: message, tone: tone || "default" });
        },
        keys: function (e) {
          var t = e.target;
          var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
          var mod = e.ctrlKey || e.metaKey;
          if (mod && !typing && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
          else if (mod && !typing && (e.key === "y" || e.key === "Y")) { e.preventDefault(); this.redo(); }
          else if (mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); this.save().catch(function () {}); }
          else if (!typing && this.selected && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); this.move(e.key === "ArrowUp" ? -1 : 1); }
          else if (!typing && this.selected && (e.key === "Delete" || e.key === "Backspace") && !mod) { e.preventDefault(); this.removeSelected(); }
        },
      };
    });
  }

  if (window.Faqir) register(window.Faqir);
  else document.addEventListener("faqir:ready", function () { register(window.Faqir); }, { once: true });
})();
