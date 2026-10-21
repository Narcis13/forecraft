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

  function titleCase(k) {
    return String(k).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (c) { return c.toUpperCase(); });
  }

  /**
   * What the data holds, for seeding new blocks: its lists of rows (with the
   * keys every row has, by type), its numbers and its strings. Lists inside
   * a null object (no NPS question, say) are not there, so nothing binds them.
   */
  function shapeOf(data) {
    var out = { arrays: [], numbers: [], strings: [] };
    (function walk(v, prefix, depth) {
      if (!v || typeof v !== "object" || depth > 3) return;
      Object.keys(v).forEach(function (k) {
        var x = v[k], path = prefix + k;
        if (Array.isArray(x)) {
          var rows = x.filter(function (r) { return r && typeof r === "object" && !Array.isArray(r); });
          if (!rows.length) return;
          var every = function (key, test) { return rows.every(function (r) { return test(r[key]); }); };
          var keys = Object.keys(rows[0]);
          out.arrays.push({
            path: path,
            strings: keys.filter(function (key) { return every(key, function (y) { return typeof y === "string"; }); }),
            numbers: keys.filter(function (key) { return every(key, function (y) { return typeof y === "number"; }); }),
            scalars: keys.filter(function (key) { return every(key, function (y) { return y === null || typeof y === "string" || typeof y === "number"; }); }),
          });
        } else if (x && typeof x === "object") walk(x, path + ".", depth + 1);
        else if (typeof x === "number") out.numbers.push(path);
        else if (typeof x === "string") out.strings.push(path);
      });
    })(data, "", 0);
    return out;
  }

  /** The first of `preferred` in `keys`, else the first key that is not an id or a row number. */
  function pick(keys, preferred) {
    return preferred.find(function (k) { return keys.indexOf(k) >= 0; }) || keys.find(function (k) { return !/^(id|number|i)$/.test(k) && !/_at$/.test(k); }) || "";
  }

  /** The title the schema gives `key` of the rows of `path` (or of `path` itself), else the key, readable. */
  function titleOf(schema, path, key) {
    var node = { properties: schema.properties };
    path.split(".").forEach(function (k) { node = node && node.properties && node.properties[k]; });
    if (key) node = node && node.items && node.items.properties && node.items.properties[key];
    return (node && node.title) || titleCase(key || path.replace(/\./g, " "));
  }

  /**
   * Sensible first content for a block dropped from the palette, seeded from
   * the data the report really sees (`ctx.data`, `ctx.schema`): the first
   * list of rows, its label and its first number. With nothing to bind, a
   * block starts empty with a hint, never bound to fields that do not exist.
   */
  function newBlock(name, vocab, layout, ctx) {
    ctx = ctx || {};
    var schema = ctx.schema || { properties: {} };
    var shape = shapeOf(ctx.data || {});
    var LABELS = ["label", "title", "name", "description", "text"];
    var NUMBERS = ["count", "total", "value", "amount", "answered", "qty", "quantity", "price"];
    // A list with something to name each row by and something to count.
    var measured = shape.arrays.find(function (a) { return pick(a.strings, LABELS) && pick(a.numbers, NUMBERS); });
    var listed = shape.arrays[0];
    var bars = function () {
      if (!measured) return { rows: "[]", label: "", value: "0" };
      var l = pick(measured.strings, LABELS), n = pick(measured.numbers, NUMBERS);
      return { rows: measured.path, label: "{{ row." + l + " }}", value: "row." + n, title: titleOf(schema, measured.path, n) + " by " + titleOf(schema, measured.path, l).toLowerCase() };
    };
    var DEFAULTS = {
      letterhead: { name: "Your company", lines: ["Street and number", "Postcode and city"], details: [{ label: "Email", value: "hello@example.com" }] },
      title: { text: ctx.title || "{{ label(\"invoice\") }}", details: [{ label: "{{ label(\"number\") }}", value: "{{ doc.number ?? label(\"draft\") }}" }, { label: "{{ label(\"issueDate\") }}", value: "{{ date(doc.issuedAt) }}" }] },
      facts: { items: [{ label: "Reference", value: "—" }, { label: "Terms", value: "30 days" }] },
      parties: { parties: [{ label: "{{ label(\"billTo\") }}", name: "Customer name", lines: ["Street", "City"] }] },
      table: listed ? {
        rows: listed.path,
        columns: listed.scalars.filter(function (k) { return !/^(id|i)$/.test(k); }).slice(0, 4).map(function (k, i) {
          var c = { label: titleOf(schema, listed.path, k), value: "{{ row." + k + " ?? \"\" }}" };
          if (listed.numbers.indexOf(k) >= 0) c.format = "number";
          else if (i === 0) c.width = "wide";
          return c;
        }),
      } : { rows: "[]", columns: [{ label: "Column", value: "" }], empty: "Nothing to list yet." },
      // Without priced lines (no money), a totals block lists what the data totals.
      totals: ctx.money ? {} : { items: [shape.numbers.length ? { label: titleOf(schema, shape.numbers[0]), value: "{{ number(" + shape.numbers[0] + ") }}", emphasis: true } : { label: "Total", value: "", emphasis: true }] },
      text: { markdown: "Write here. Use **bold**, lists and [links](https://example.com); insert data with holes." },
      callout: { title: "Note", markdown: "Something the reader should not miss." },
      stats: { items: [shape.numbers.length ? { label: titleOf(schema, shape.numbers[0]), value: "{{ number(" + shape.numbers[0] + ") }}" } : { label: "", value: "" }] },
      bars: bars(),
      chart: (function () {
        var b = bars();
        return { kind: "column", rows: b.rows, label: b.label, series: [{ name: measured ? titleOf(schema, measured.path, b.value.slice(4)) : "", value: b.value }], format: "number", title: b.title || "" };
      })(),
      quote: (function () {
        var said = shape.arrays.find(function (a) { return a.strings.indexOf("text") >= 0; });
        return said ? { rows: said.path, text: "{{ row.text }}" } : { text: "A sentence worth quoting.", name: "" };
      })(),
      signature: { signatures: [{ name: "Name", role: "Role" }, { name: "Name", role: "Role" }] },
      section: { title: "Section", numbered: true, blocks: [] },
      columns: { columns: [[], []] },
      stamp: { text: "{{ label(\"copy\") }}", tone: "default" },
      footer: { lines: [ctx.title ? "{{ doc.title }} · {{ doc.number ?? label(\"draft\") }}" : "Company · Address · Registration"] },
      qr: { value: "{{ doc.number ?? \"DRAFT\" }}", caption: "Reference" },
      barcode: { value: "{{ doc.number ?? \"DRAFT\" }}" },
      faqir: { source: "+callout(variant=\"muted\")\n  @content\n    p Write here." },
      image: { src: ctx.asset || "", alt: ctx.alt || "Figure" },
    };
    var base = DEFAULTS[name] ? clone(DEFAULTS[name]) : clone(vocab.blocks[name].example);
    delete base.id;
    delete base.block;
    if (base.title === "") delete base.title;
    var b = { id: freshId(layout, name), block: name };
    Object.keys(base).forEach(function (k) { b[k] = base[k]; });
    return b;
  }

  /**
   * The Insert field picker: the data's own fields, then one group per list of
   * rows ("questions[] →" offers row.title, row.answered…), then the document's
   * values that exist for this report (money only with money, the submission
   * only for a submission source). A path is offered once per group.
   */
  function pathGroups(schema, def) {
    var top = { label: "Fields", items: [] };
    var groups = [top];
    (function walk(props, prefix, group, trail) {
      Object.keys(props || {}).forEach(function (k) {
        var p = props[k] || {};
        var path = prefix + k;
        if (p.type === "object" && p.properties) walk(p.properties, path + ".", group, trail);
        else if (p.type === "array" && p.items && p.items.properties) {
          group.items.push({ path: path, label: path + " (a list of rows)" });
          var name = trail + path.replace(/^row\./, "") + "[] →";
          var g = { label: name, items: [] };
          groups.push(g);
          walk(p.items.properties, "row.", g, name + " ");
        } else group.items.push({ path: path, label: path + (/0–100/.test(p.description || "") ? " (a percentage, 0–100)" : "") });
      });
    })(schema.properties, "", top, "");
    var doc = { label: "The document", items: ["doc.title", "doc.number", "doc.issuedAt"].map(function (p) { return { path: p, label: p }; }) };
    if (def.money) ["doc.money.subtotal", "doc.money.tax", "doc.money.total", "doc.money.due", "line.net", "line.tax"].forEach(function (p) { doc.items.push({ path: p, label: p }); });
    if (def.source && def.source.kind === "submission") ["doc.submission.id", "doc.submission.created_at"].forEach(function (p) { doc.items.push({ path: p, label: p }); });
    groups.push(doc);
    groups.forEach(function (g) {
      var seen = {};
      g.items = g.items.filter(function (it) { if (seen[it.path]) return false; seen[it.path] = true; return true; });
    });
    return groups.filter(function (g) { return g.items.length; });
  }

  /** A's properties, with B's added where A has none (the schema first, what the data shows second). */
  function mergeSchema(a, b) {
    var out = clone(a || { properties: {} });
    out.properties = out.properties || {};
    Object.keys((b && b.properties) || {}).forEach(function (k) {
      var x = out.properties[k], y = b.properties[k];
      if (!x) out.properties[k] = y;
      else if (x.type === "object" && y.type === "object") out.properties[k] = mergeSchema(x, y);
      else if (x.type === "array" && y.type === "array" && x.items && y.items && y.items.properties) out.properties[k] = Object.assign({}, x, { items: mergeSchema(x.items, y.items) });
    });
    return out;
  }

  /** What each stat of a summary question means, for the Pick a question list. */
  var STAT_LABELS = {
    answered: "answered", skipped: "skipped", mean: "mean", median: "median", min: "lowest", max: "highest", earliest: "earliest", latest: "latest",
    "top.label": "most chosen", "top.count": "most chosen, count", "top.share": "most chosen, share (0–100)", options: "options (a list of rows)", tops: "tied options (a list)",
    samples: "written answers (a list)", "rows.total": "rows in all", "rows.perSubmission": "rows per submission",
  };

  /** Field paths the Data tab lists: the schema's, and each list's row fields (keyed by their list). */
  function schemaPaths(schema) {
    var out = [];
    (function walk(props, prefix, list) {
      Object.keys(props || {}).forEach(function (k) {
        var p = props[k] || {};
        var path = prefix + k;
        if (p.type === "object" && p.properties) walk(p.properties, path + ".", list);
        else if (p.type === "array" && p.items && p.items.properties) {
          out.push({ key: list + path, path: path, type: "array", title: p.title || k });
          walk(p.items.properties, "row.", list + path + "[].");
        } else out.push({ key: list + path, path: path, type: (p.type || "any") + (p.format ? " (" + p.format + ")" : "") + (p.enum ? " (choice)" : ""), title: (p.title || k) + (p.description ? " — " + p.description : "") });
      });
    })(schema.properties, "", "");
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
  /** Sets obj[path]; an empty value removes the key, unless `keepEmpty` (a required text stays ""). */
  function set(obj, path, value, keepEmpty) {
    var keys = path.split(".");
    var last = keys.pop();
    var o = keys.reduce(function (o, k, i) {
      if (o[k] === undefined) o[k] = /^\d+$/.test(keys[i + 1] || last) ? [] : {};
      return o[k];
    }, obj);
    if (value === undefined || (value === "" && !keepEmpty)) delete o[last];
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
        pathGroups: [],
        schemaFields: [],
        // The data the report really sees (GET …/sample): the bound form's
        // submissions, a synthetic sample shaped like the form, or the sample.
        data: null,
        dataOrigin: "",
        dataCount: 0,
        dataKey: "",
        sourceKind: "data",
        questions: [],
        question: "",
        questionStats: [],
        published: false,
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
        revealId: "",

        init: function () {
          var self = this;
          api("GET", "/reports/" + self.reportId).then(function (r) {
            self.def = r.definition;
            self.published = r.published_version !== null;
            self.history = [JSON.stringify(r.definition)];
            self.cursor = 0;
            self.render();
            self.loadData();
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
          var source = def.source || { kind: "data" };
          this.sourceKind = source.kind;
          this.bindForm = source.form || "";
          this.renderData();
          // The source changed (bound, unbound, edited as JSON, undone): fetch what it gives.
          if (this.dataKey && JSON.stringify(source) !== this.dataKey) this.loadData();
          if (!opts.fromSample) this.sampleText = JSON.stringify(def.sample, null, 2);
          if (!opts.fromJson) this.jsonText = JSON.stringify(def, null, 2);
          this.renderProps();
        },

        /** The views that depend on the data: the Insert field groups, the questions to pick from. */
        renderData: function () {
          var self = this;
          var data = self.currentData();
          self.pathGroups = pathGroups(mergeSchema(self.def.schema, infer(data)), self.def);
          var qs = self.sourceKind === "summary" && data && Array.isArray(data.questions) ? data.questions : [];
          self.questions = qs.map(function (q) { return { name: q.name, label: (q.title || q.name) + (q.kind ? " (" + q.kind + ")" : "") }; });
          if (!qs.some(function (q) { return q.name === self.question; })) self.question = "";
          self.renderStats();
        },
        /** What the canvas prints: the form's data for a summary or a register, else the sample. */
        currentData: function () {
          var live = this.sourceKind === "summary" || this.sourceKind === "submissions";
          return live && this.data ? this.data : (this.def.sample || {});
        },
        /** The data the report really sees, from the server: the form's submissions, or a sample shaped like it. */
        loadData: function () {
          var self = this;
          var source = self.def.source || { kind: "data" };
          var key = JSON.stringify(source);
          self.dataKey = key;
          var query = source.form ? "?form=" + encodeURIComponent(source.form) + "&kind=" + encodeURIComponent(source.kind) : "";
          return api("GET", "/reports/" + self.reportId + "/sample" + query).then(function (r) {
            if (self.dataKey !== key) return r;
            self.data = r.data;
            self.dataOrigin = r.origin;
            self.dataCount = r.count || 0;
            self.renderData();
            return r;
          }, function () {
            if (self.dataKey !== key) return;
            self.data = null;
            self.dataOrigin = "";
            self.renderData();
          });
        },
        formTitle: function (id) {
          var f = this.forms.find(function (x) { return x.id === id; });
          return f ? f.title : "";
        },
        /** Where the canvas's data comes from, in a sentence. */
        dataNote: function () {
          var form = this.formTitle(this.bindForm) || "the form";
          if (this.sourceKind === "summary" || this.sourceKind === "submissions") {
            if (this.dataOrigin === "submissions") return this.dataCount + " submission" + (this.dataCount === 1 ? "" : "s") + " from " + form + ".";
            if (this.dataOrigin === "synthetic") return "Synthetic sample shaped like " + form + ": it has no submissions yet.";
            return "Reading the submissions of " + form + "…";
          }
          if (this.sourceKind === "submission") return "One document per submission of " + form + ". The canvas prints its latest submission.";
          return "Data sent with each document. The canvas prints the sample data.";
        },
        renderStats: function () {
          var self = this;
          var data = self.currentData();
          var q = self.question && (data.questions || []).find(function (x) { return x.name === self.question; });
          var out = [];
          if (q) (function walk(o, prefix) {
            Object.keys(o).forEach(function (k) {
              var v = o[k], path = prefix + k;
              if (!prefix && /^(name|title|kind)$/.test(k)) return;
              if (Array.isArray(v)) out.push({ path: path, label: STAT_LABELS[path] || path + " (a list)" });
              else if (v && typeof v === "object") { if (!prefix) walk(v, path + "."); }
              else if (v !== null && v !== undefined) out.push({ path: path, label: (STAT_LABELS[path] || path) + " · " + v });
            });
          })(q, "");
          self.questionStats = out;
        },
        pickQuestion: function (name) {
          this.question = name;
          this.renderStats();
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
          var PLACEHOLDERS = { label: "e.g. Responses", value: "Text, or {{ path }}", change: "e.g. +12 % on May", name: "Name", role: "Role", note: "Small print", mono: "", date: "Date", details: "Label: value | …", lines: "Line | line" };
          var cellOf = function (key, name, kind, value) {
            var c = { key: key, label: label(name), kind: kind.k === "list" && kind.of.k === "text" ? "lines" : kind.k, value: value === undefined ? "" : value, required: Boolean(kind.required), placeholder: PLACEHOLDERS[name] || "" };
            if (kind.k === "enum") { c.options = [""].concat(kind.values); c.value = value || ""; }
            if (c.kind === "lines") c.value = (value || []).join(" | ");
            if (kind.k === "bool") c.value = Boolean(value);
            if (kind.k === "expr") c.placeholder = name === "value" && b.block === "chart" ? "row.count" : "A path";
            return c;
          };
          Object.keys(spec).forEach(function (name) {
            var kind = spec[name];
            var v = b[name];
            var f = { key: name, label: label(name) + (kind.required ? "" : " (optional)"), kind: kind.k, value: v === undefined ? "" : v, hint: "", required: Boolean(kind.required) };
            if (kind.k === "blocks" || kind.k === "columns") return; // children are edited on the page
            if (kind.k === "enum") { f.options = [""].concat(kind.values); f.value = v || ""; }
            if (kind.k === "bool") f.value = Boolean(v);
            if (kind.k === "expr") f.hint = name === "rows" ? "A list in the data, e.g. " + (self.firstList() || "items") + ". [] is an empty list." : "A bare expression, e.g. items or doc.money.due != \"0.00\".";
            if (kind.k === "md") f.hint = "Markdown with {{ }} holes. Data is always printed as text.";
            if (kind.k === "asset") f.hint = "asset:ast_… — upload under Appearance.";
            if (kind.k === "list" && kind.of.k === "text") { f.kind = "lines"; f.value = (v || []).join("\n"); f.hint = "One line each."; }
            if (kind.k === "list" && kind.of.k === "object") {
              f.kind = "rows";
              f.addLabel = name === "columns" ? "Add a column" : name === "series" ? "Add a series" : "Add a row";
              var sub = kind.of.props;
              var keys = Object.keys(sub).filter(function (k) { return !(sub[k].k === "list" && sub[k].of.k === "object"); });
              f.heads = keys.map(function (k) { return label(k); });
              f.rows = (v || []).map(function (row, i) {
                return { key: name + "." + i, index: i, cells: keys.map(function (k) { return cellOf(name + "." + i + "." + k, k, sub[k], row[k]); }) };
              });
              if (!f.rows.length) f.hint = "No rows yet.";
            }
            fields.push(f);
          });
          fields.push({ key: "when", label: "Show when (optional)", kind: "expr", value: b.when || "", hint: "Leave empty to always show it. When it is false for this data, the block is not on the page and Move up / down step over it." });
          fields.push({ key: "keep", label: "Keep", kind: "enum", options: ["", "together", "with-next"], value: b.keep || "" });
          self.fields = fields;
        },
        firstList: function () {
          var a = shapeOf(this.currentData()).arrays[0];
          return a ? a.path : "";
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
          var kind = null, required = false;
          self.fields.forEach(function (f) {
            if (f.key === key) { kind = f.kind; required = f.required; }
            (f.rows || []).forEach(function (r) { r.cells.forEach(function (c) { if (c.key === key) required = c.required; }); });
          });
          self.apply(function (d) {
            var at = locate(d.layout, id);
            if (!at) return;
            var cellLines = typeof value === "string" && /\.lines$/.test(key);
            if (kind === "lines") value = value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
            else if (cellLines) value = value.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
            // A required text (a stat's label, say) may be empty while it is being typed; it stays "".
            set(at.block, key, value, required && kind !== "enum" && kind !== "expr");
          }, { key: id + ":" + key });
        },
        addRow: function (key) {
          var id = this.selected;
          this.apply(function (d) {
            var at = locate(d.layout, id);
            var list = get(at.block, key) || [];
            // New rows start empty: the placeholders say what goes where.
            list.push(key === "columns" ? { label: "", value: "" } : key === "signatures" ? { name: "" } : key === "series" ? { name: "", value: "0" } : key === "parties" ? { name: "" } : { label: "", value: "" });
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
        /** The ids of the blocks the canvas shows (a block whose `when` is false for this data is not there). */
        shownBlocks: function () {
          var frame = document.getElementById("rd-canvas");
          var doc = frame && frame.contentDocument;
          if (!doc || !doc.querySelector("[data-block]")) return null;
          var ids = {};
          doc.querySelectorAll("[data-block]").forEach(function (el) { ids[el.getAttribute("data-block")] = true; });
          return ids;
        },
        /**
         * One place up or down on the page. Blocks the page does not show are
         * stepped over, so every move is visible; a block moves into a section
         * it meets (at its end going up, at its start going down) and out of
         * its own section at either end.
         */
        move: function (step) {
          var id = this.selected;
          var shown = this.shownBlocks();
          var hidden = function (b) { return b.block === "footer" || b.block === "watermark" || Boolean(b.when && shown && !shown[b.id]); };
          var nests = function (b) { return ["section", "columns", "footer", "watermark"].indexOf(b.block) < 0; };
          this.apply(function (d) {
            var at = locate(d.layout, id);
            if (!at) return;
            var list = at.list, j = at.index + step;
            while (j >= 0 && j < list.length && hidden(list[j])) j += step;
            if (j >= 0 && j < list.length) {
              var next = list[j];
              list.splice(at.index, 1);
              if (next.block === "section" && Array.isArray(next.blocks) && nests(at.block)) {
                if (step < 0) next.blocks.push(at.block); else next.blocks.unshift(at.block);
              } else {
                var k = list.indexOf(next);
                list.splice(step < 0 ? k : k + 1, 0, at.block);
              }
            } else if (at.parent && at.parent.block === "section") {
              var outer = locate(d.layout, at.parent.id);
              list.splice(at.index, 1);
              outer.list.splice(step < 0 ? outer.index : outer.index + 1, 0, at.block);
            }
          });
          this.reveal(id);
        },
        addFromPalette: function (e) {
          var el = e.currentTarget || e.target;
          var btn = el.closest ? el.closest("[data-rd-block]") : null;
          if (btn) this.addBlock(btn.getAttribute("data-rd-block"));
        },
        /** What a new block is seeded from: the data the canvas prints and its shape. */
        seedContext: function (image) {
          var data = this.currentData();
          return { data: data, schema: mergeSchema(this.def.schema, infer(data)), title: "{{ doc.title }}", asset: image && image.ref, alt: image && image.alt };
        },
        addBlock: function (name, image) {
          var self = this;
          // An image needs its picture first: choose it, upload it, then add the block.
          if (name === "image" && !image) { self.pickImage(null); return; }
          if (!self.canAdd(name)) return;
          // A totals block needs money: guess it from the first array of priced lines (a quantity and a price).
          var money = name === "totals" && !self.def.money ? self.guessedMoney() : null;
          var ctx = self.seedContext(image);
          ctx.money = Boolean(self.def.money || money);
          var b = newBlock(name, self.vocabulary, self.def.layout, ctx);
          self.apply(function (d) {
            if (name === "totals" && !d.money && money) d.money = money;
            var at = self.selected ? locate(d.layout, self.selected) : null;
            if (at && name !== "footer") at.list.splice(at.index + 1, 0, b);
            else {
              // The footer stays last.
              var fi = d.layout.findIndex(function (x) { return x.block === "footer"; });
              if (fi >= 0 && name !== "footer") d.layout.splice(fi, 0, b); else d.layout.push(b);
            }
          });
          self.select(b.id);
          self.reveal(b.id);
        },
        guessedMoney: function () {
          var props = this.def.schema.properties || {};
          var self = this;
          var found = null;
          Object.keys(props).some(function (k) {
            if (props[k].type !== "array" || !props[k].items || !props[k].items.properties) return false;
            var m = guessMoney(self.def.schema, k);
            if (m.quantity && m.unitPrice) found = m;
            return Boolean(found);
          });
          return found;
        },
        /** The answers block prints the bound submission: elsewhere it could only print an error. */
        canAdd: function (name) {
          if (name !== "answers" || this.sourceKind === "submission") return true;
          this.toast("The answers block prints a submission: bind the report to a form, one document per submission (Data tab).", "default");
          return false;
        },
        /** Bring a block into view: on the canvas once it is drawn, and its properties at the top of the panel. */
        reveal: function (id) {
          this.revealId = id;
          var props = document.querySelector("[data-designer-props]");
          if (props) props.scrollTop = 0;
          this.scrollToBlock();
        },
        scrollToBlock: function () {
          var frame = document.getElementById("rd-canvas");
          var el = this.revealId && frame && frame.contentDocument && frame.contentDocument.querySelector('[data-block="' + this.revealId.replace(/"/g, "") + '"]');
          if (!el) return;
          this.revealId = "";
          el.scrollIntoView({ block: "center" });
        },
        pickImage: function (drop) {
          var self = this;
          var input = document.createElement("input");
          input.type = "file";
          input.accept = "image/png,image/jpeg,image/webp,image/svg+xml";
          input.addEventListener("change", function () {
            var file = input.files && input.files[0];
            if (!file) return;
            self.upload(file).then(function (asset) {
              var image = { ref: asset.ref, alt: titleCase(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")) };
              if (drop) { self.dragging = { add: "image", image: image }; self.dropAt(drop.target, drop.where); }
              else self.addBlock("image", image);
            }, function (err) { self.toast(err.message, "error"); });
          });
          input.click();
        },
        upload: function (file) {
          return fetch("/api/v1/assets?name=" + encodeURIComponent(file.name), { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" }, credentials: "same-origin" })
            .then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.detail); return j; }); });
        },

        remember: function (e) { this.lastText = { el: e.target, key: e.target.getAttribute("data-rd-key"), kind: e.target.getAttribute("data-rd-kind") || "text" }; },
        /** Put `expr` into the field last typed in: bare in an expression field, as a {{ }} hole in text. */
        insertPath: function (expr, hole) {
          if (!this.lastText || !this.lastText.el.isConnected) {
            this.toast("Click into a text field of the block first, then insert.", "default");
            return;
          }
          var el = this.lastText.el;
          var pos = el.selectionStart == null ? el.value.length : el.selectionStart;
          var text = this.lastText.kind === "expr" ? expr : "{{ " + (hole || expr) + " }}";
          el.value = el.value.slice(0, pos) + text + el.value.slice(el.selectionEnd == null ? pos : el.selectionEnd);
          el.focus();
          el.selectionStart = el.selectionEnd = pos + text.length;
          this.setField(this.lastText.key, el.value);
        },
        insertField: function (e) {
          var path = e.target.value;
          e.target.value = "";
          if (path) this.insertPath(path);
        },
        /** question("seats").mean: a summary question by its name, so the report survives a reordered form. */
        insertStat: function (e) {
          var stat = e.target.value;
          e.target.value = "";
          if (!stat || !this.question) return;
          var expr = "question(\"" + this.question + "\")." + stat;
          this.insertPath(expr, /^(mean|median|avg)$/.test(stat) ? "number(" + expr + ", 1)" : expr);
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
        /** The Data tab's source: none (data sent with each document), or a form read one of three ways. */
        setSourceKind: function (kind) {
          this.sourceKind = kind;
          if (kind === "data") {
            this.apply(function (d) { d.source = { kind: "data" }; });
            this.toast("No form: each document prints the data sent with it.", "success");
          } else if (this.bindForm) this.bindToForm();
        },
        /**
         * Bind to the chosen form, read the chosen way: the schema, the sample
         * and the source become what the server says that source gives (its
         * submissions, or a sample shaped like them when there are none).
         */
        bindToForm: function () {
          var self = this;
          var id = self.bindForm;
          if (!id) return;
          var kind = self.sourceKind === "data" ? "submission" : self.sourceKind;
          api("GET", "/reports/" + self.reportId + "/sample?form=" + encodeURIComponent(id) + "&kind=" + kind).then(function (r) {
            self.dataKey = JSON.stringify({ kind: kind, form: id });
            self.data = r.data;
            self.dataOrigin = r.origin;
            self.dataCount = r.count || 0;
            self.apply(function (d) {
              d.schema = Object.assign({}, r.schema, { title: d.schema.title });
              if (d.schema.description === undefined && r.schema.description) d.schema.description = r.schema.description;
              d.sample = r.data;
              d.source = { kind: kind, form: id };
            });
            self.toast(kind === "submission" ? "Bound to " + self.formTitle(id) + ": one document per submission." : kind === "summary" ? "Bound to " + self.formTitle(id) + ": a summary of its submissions." : "Bound to " + self.formTitle(id) + ": a register of its submissions.", "success");
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
        themeName: function (t) {
          var info = (this.vocabulary.themeInfo || {})[t];
          return info ? info.name : t;
        },
        themeNote: function (t) {
          var info = (this.vocabulary.themeInfo || {})[t];
          return info ? info.note : "";
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
          self.upload(file).then(function (asset) { self.setLook("logo", asset.ref); self.toast("Logo uploaded.", "success"); }, function (err) { self.toast(err.message, "error"); });
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
          // The Layout panel is unhidden after this handler: measure the desk once it shows.
          var self = this;
          if (t === "layout") requestAnimationFrame(function () { requestAnimationFrame(function () { self.fit(); }); });
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
              if (seq !== self.canvasSeq) return;
              // Busy or rate-limited: draw it again shortly rather than report a refusal.
              if (err.status === 503 || err.status === 429) { self.refreshCanvas(2000); return; }
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
        /** Fit, 100 % or 150 %: the desk keeps the same place in the document, not the same pixel offset. */
        setZoom: function (z) {
          var desk = document.querySelector("[data-rd-desk]");
          var room = desk ? desk.scrollHeight - desk.clientHeight : 0;
          var at = room > 0 ? desk.scrollTop / room : 0;
          this.zoom = z;
          this.fit();
          if (!desk) return;
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              desk.scrollTop = at * Math.max(0, desk.scrollHeight - desk.clientHeight);
              desk.scrollLeft = Math.max(0, (desk.scrollWidth - desk.clientWidth) / 2);
            });
          });
        },
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
          self.scrollToBlock();
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
          if (drag.add === "image" && !drag.image) { self.pickImage({ target: target, where: where }); return; }
          if (drag.add && !self.canAdd(drag.add)) return;
          var money = drag.add === "totals" && !self.def.money ? self.guessedMoney() : null;
          var ctx = self.seedContext(drag.image);
          ctx.money = Boolean(self.def.money || money);
          var added = drag.add ? newBlock(drag.add, self.vocabulary, self.def.layout, ctx) : null;
          self.apply(function (d) {
            if (money) d.money = money;
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
          self.reveal(added ? added.id : drag.move);
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
            self.published = true;
            self.toast("Published version " + v.version + ". New documents use it.", "success");
          }, function (err) {
            self.busy = false;
            self.toast("Not published: " + err.message, "error");
          });
        },
        /** Issue a document from the published version: the issue dialog asks for its period, submission or data. */
        testDocument: function () {
          var self = this;
          if (!self.published) return;
          self.busy = true;
          self.save().then(function () {
            self.busy = false;
            window.dispatchEvent(new CustomEvent("issue-open"));
            var dialog = self.$ui("#issue-document");
            if (dialog) dialog.open();
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
          // Keys inside the issue dialog are the dialog's.
          if (t && t.closest && t.closest('[data-ui="dialog"]')) return;
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
