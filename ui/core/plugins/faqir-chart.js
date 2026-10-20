// @ui:plugin faqir-chart
// @ui:controller chart
// @ui:provides redraw, destroy
/**
 * faqir-chart — draws a chart's data table as an inline SVG bar, column or line chart. [forecraft #36]
 *
 *   <figure data-ui="chart" data-variant="column">
 *     <figcaption data-part="caption">Revenue, k€</figcaption>
 *     <table data-part="data"> … </table>
 *   </figure>
 *
 * The table is the source of truth and the SVG a progressive enhancement: without this plugin the table is the chart; once it draws, the root takes data-state="drawn", the table stays in the page for assistive technology and paper, and the SVG (role="img", an aria-label that reads the numbers) redraws when the table or the width changes. Colours, type and rules come from the component's custom properties; bar and column value axes start at zero; series differ by lightness, and lines also by dash. Runs with or without faqir-core.
 */
(function () {
  "use strict";

  // One dash pattern per series, so lines survive greyscale even where two
  // lightness bands print close together.
  var DASH = ["", "6 4", "2 3", "9 3 2 3"];
  var KIND = { bar: "Bar", column: "Column", line: "Line" };

  var text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

  // A direct child part — never one of a nested component's.
  function part(root, name) {
    for (var c = root.firstElementChild; c; c = c.nextElementSibling) {
      if (c.getAttribute("data-part") === name) return c;
    }
    return null;
  }

  /**
   * The chart a root's table describes: { kind, title, categories, series },
   * each series { name, values, texts }. Null when no cell holds a number.
   * A cell's number is its data-value, else its text read in `locale`: the
   * locale's decimal mark kept, grouping and units dropped.
   */
  function read(root, locale) {
    var table = part(root, "data");
    if (!table) return null;
    var mark = (1.5).toLocaleString(locale).charAt(1);
    var num = (cell) => {
      var raw = cell.getAttribute("data-value");
      if (raw == null) {
        raw = text(cell).replace(/\u2212/g, "-").split(mark).map((s) => s.replace(/[^\d-]/g, "")).join(".");
      }
      var n = parseFloat(raw);
      return isFinite(n) ? n : null;
    };
    var head = table.querySelectorAll("thead tr");
    var names = head.length ? Array.from(head[head.length - 1].cells, text).slice(1) : [];
    var rows = Array.from(table.querySelectorAll("tbody tr"), (row) => row.cells).filter((cells) => cells.length > 1);
    var series = [];
    var count = Math.max.apply(null, rows.map((cells) => cells.length - 1).concat(0));
    for (var j = 1; j <= count; j++) {
      series.push({
        name: names[j - 1] || "",
        values: rows.map((cells) => (cells[j] ? num(cells[j]) : null)),
        texts: rows.map((cells) => (cells[j] ? text(cells[j]) : "")),
      });
    }
    var kind = root.getAttribute("data-variant");
    return series.some((s) => s.values.some((v) => v != null))
      ? {
          kind: KIND[kind] ? kind : "column",
          title: text(part(root, "caption")) || text(table.caption),
          categories: rows.map((cells) => text(cells[0])),
          series: series,
        }
      : null;
  }

  // A tick step of 1, 2 or 5 × 10ⁿ giving about five intervals over the domain.
  function scale(lo, hi) {
    if (hi === lo) {
      hi += Math.abs(hi) / 2 || 1;
      lo -= Math.abs(lo) / 2;
    }
    var raw = (hi - lo) / 5;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / mag;
    var step = mag * (f > 5 ? 10 : f > 2 ? 5 : f > 1 ? 2 : 1);
    return {
      lo: Math.floor(lo / step + 1e-9) * step,
      hi: Math.ceil(hi / step - 1e-9) * step,
      step: step,
    };
  }

  var r = (v) => Math.round(v * 10) / 10;

  /**
   * The chart's geometry, pure: no DOM, the same answer on a server. Options:
   * width (px, default 640), height (column and line), fontSize (px, default
   * 12), locale (tick labels). Text is measured as 0.6 em a character.
   */
  function layout(m, o) {
    o = o || {};
    var W = Math.max(o.width || 640, 240);
    var fs = o.fontSize || 12;
    var pad = fs / 2;
    var kind = m.kind;
    var bar = kind === "bar";
    var line = kind === "line";
    var cats = m.categories;
    var n = cats.length;
    var list = m.series;
    var S = list.length;
    var wide = (s) => s.length * fs * 0.6;
    var most = (a) => Math.max.apply(null, a.map(wide).concat(0));

    var all = [];
    list.forEach((s) => s.values.forEach((v) => v != null && all.push(v)));
    var lo = Math.min.apply(null, all);
    var hi = Math.max.apply(null, all);
    // Bars and columns encode length: their value axis always holds zero.
    if (!line) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    var sc = scale(lo, hi);
    var dec = Math.max(0, -Math.floor(Math.log10(sc.step) + 1e-9));
    var ticks = [];
    for (var t = sc.lo; t <= sc.hi + sc.step / 2; t += sc.step) ticks.push(+t.toFixed(10));
    var tickText = ticks.map((v) => v.toLocaleString(o.locale, { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    var names = list.map((s) => s.name);

    var label =
      (m.title ? m.title + ". " : "") +
      KIND[kind] + " chart. " +
      list
        .map((s) =>
          (S > 1 && s.name ? s.name + ": " : "") +
          cats.map((c, i) => (s.texts[i] ? c + " " + s.texts[i] : "")).filter(Boolean).join(", "))
        .join("; ") + ".";

    function draw(legend) {
      var g = { width: W, kind: kind, label: label, domain: [sc.lo, sc.hi], grid: [], axis: [], series: [], legend: null, baseline: null, direct: S > 1 && !legend };
      var top = 0;
      if (legend) {
        var lx = 0;
        var ly = fs;
        g.legend = names.map((name) => {
          var kw = 18 + wide(name);
          if (lx && lx + kw > W) {
            lx = 0;
            ly += fs + pad;
          }
          var key = { x: lx, y: ly, name: name };
          lx += kw + fs;
          return key;
        });
        top = ly + pad;
      }

      var x0, x1, y0, y1, H, band, val, base;
      var barT = Math.round(fs * 1.5);
      if (bar) {
        band = S * barT + barT / 2;
        x0 = Math.min(most(cats), W * 0.35) + pad;
        x1 = W - Math.min(Math.max(most([].concat.apply([], list.map((s) => s.texts))), wide(tickText[tickText.length - 1]) / 2), W * 0.25) - pad;
        y0 = top + pad;
        y1 = y0 + n * band;
        H = y1 + fs + pad * 2;
        val = (v) => x0 + ((v - sc.lo) / (sc.hi - sc.lo)) * (x1 - x0);
        base = val(0);
        ticks.forEach((v, i) => {
          g.grid.push({ x1: r(val(v)), y1: r(y0), x2: r(val(v)), y2: r(y1) });
          g.axis.push({ x: r(val(v)), y: r(y1 + fs + pad / 2), text: tickText[i], anchor: "middle" });
        });
        // A category label longer than its column is cut, with an ellipsis.
        var keep = Math.floor((x0 - pad) / (fs * 0.6));
        cats.forEach((c, i) => {
          g.axis.push({ x: r(x0 - pad / 2), y: r(y0 + i * band + band / 2 + fs * 0.35), text: c.length > keep ? c.slice(0, keep - 1) + "\u2026" : c, anchor: "end" });
        });
        g.baseline = { x1: r(base), y1: r(y0), x2: r(base), y2: r(y1) };
      } else {
        var endW = line && S > 1 && !legend ? most(names) + pad * 1.5 : pad;
        if (endW > W * 0.3) return null;
        x0 = most(tickText) + pad;
        x1 = W - endW;
        y0 = top + fs + pad;
        H = top + (o.height || Math.round(Math.min(Math.max(W * 0.5, 200), 360)));
        y1 = H - fs - pad * 2;
        band = (x1 - x0) / n;
        val = (v) => y1 - ((v - sc.lo) / (sc.hi - sc.lo)) * (y1 - y0);
        base = val(Math.min(Math.max(0, sc.lo), sc.hi));
        ticks.forEach((v, i) => {
          g.grid.push({ x1: r(x0), y1: r(val(v)), x2: r(x1), y2: r(val(v)) });
          g.axis.push({ x: r(x0 - pad / 2), y: r(val(v) + fs * 0.35), text: tickText[i], anchor: "end" });
        });
        // Category labels thin out (every k-th) rather than collide.
        var k = Math.ceil((most(cats) + pad) / band);
        cats.forEach((c, i) => {
          if (i % k === 0) g.axis.push({ x: r(x0 + band * (i + 0.5)), y: r(y1 + fs + pad / 2), text: c, anchor: "middle" });
        });
        if (sc.lo <= 0 && sc.hi >= 0) g.baseline = { x1: r(x0), y1: r(val(0)), x2: r(x1), y2: r(val(0)) };
      }
      g.height = Math.round(H);
      g.plot = { x: r(x0), y: r(y0), width: r(x1 - x0), height: r(y1 - y0) };

      var thick = bar ? barT : (band * 0.8) / S;
      var fits = true;
      var at = -1;
      // Series names go on the first category whose every mark can hold its name.
      if (!line && S > 1 && !legend) {
        for (var c = 0; c < n && at < 0; c++) {
          if (list.every((s) => {
            var v = s.values[c];
            return v > 0 && Math.abs(val(v) - base) >= wide(s.name) + pad * 2 && thick >= fs + 2;
          })) at = c;
        }
        fits = at >= 0;
      }

      list.forEach((s, j) => {
        var out = { name: s.name, dash: line ? DASH[j % 4] : "", marks: [], labels: [], path: "", tag: null };
        var pen = "M";
        var last = null;
        s.values.forEach((v, i) => {
          if (v == null) {
            pen = "M";
            return;
          }
          var t = s.texts[i];
          var tw = wide(t);
          var e = val(v);
          if (bar) {
            var y = y0 + i * band + barT / 4 + j * barT;
            var lx = v < 0 ? e - pad / 2 : e + pad / 2;
            out.marks.push({ x: r(Math.min(e, base)), y: r(y), width: r(Math.abs(e - base)), height: r(barT - 1) });
            if (v < 0 ? lx - tw >= x0 : lx + tw <= W) out.labels.push({ x: r(lx), y: r(y + barT / 2 + fs * 0.35), text: t, anchor: v < 0 ? "end" : "start" });
            if (i === at) out.tag = { x: r(base + pad), y: r(y + barT / 2 + fs * 0.35), text: s.name, anchor: "start" };
          } else if (line) {
            var px = x0 + band * (i + 0.5);
            out.path += pen + r(px) + " " + r(e);
            pen = "L";
            last = e;
            out.marks.push({ cx: r(px), cy: r(e), r: 3 });
            if (S === 1 && band >= most(s.texts) + 4) out.labels.push({ x: r(px), y: r(e - pad), text: t, anchor: "middle" });
          } else {
            var x = x0 + i * band + band * 0.1 + j * thick;
            out.marks.push({ x: r(x), y: r(Math.min(e, base)), width: r(Math.max(thick - 1, 1)), height: r(Math.abs(e - base)) });
            // Above a column, below a negative one — and never into the category row.
            if (tw <= (S === 1 ? band : thick) - 2 && (v >= 0 || e + fs <= y1)) out.labels.push({ x: r(x + thick / 2), y: r(v < 0 ? e + fs : e - pad / 2), text: t, anchor: "middle" });
            if (i === at) out.tag = { x: r(x + thick / 2 + fs * 0.35), y: r(base - pad), text: s.name, anchor: "start", rotate: true };
          }
        });
        if (line && S > 1 && !legend && last != null) out.tag = { x: r(x1 + pad / 2), y: last + fs * 0.35, text: s.name, anchor: "start" };
        g.series.push(out);
      });

      // End-of-line names: spread apart so none collides, inside the chart.
      if (line && S > 1 && !legend) {
        var tags = g.series.map((s) => s.tag).filter(Boolean).sort((a, b) => a.y - b.y);
        tags.forEach((t, i) => {
          if (i && t.y < tags[i - 1].y + fs + 2) t.y = tags[i - 1].y + fs + 2;
          t.y = r(t.y);
        });
        fits = !tags.length || (tags[0].y >= fs && tags[tags.length - 1].y <= H - pad);
      }
      return legend || fits ? g : null;
    }

    return draw(false) || draw(true);
  }

  var esc = (s) => String(s).replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");

  function el(tag, a, inner) {
    var s = "<" + tag;
    for (var k in a) if (a[k] !== "" && a[k] != null) s += " " + k + '="' + esc(a[k]) + '"';
    return s + (inner == null ? "/>" : ">" + inner + "</" + tag + ">");
  }

  var words = (t, part) =>
    el("text", { "data-part": part, x: t.x, y: t.y, "text-anchor": t.anchor, transform: t.rotate ? "rotate(-90 " + t.x + " " + t.y + ")" : "" }, esc(t.text));

  /** The SVG markup for a layout — a string, so a server can emit it too. */
  function svg(g) {
    var line = g.kind === "line";
    var out =
      el("g", { "data-part": "grid" }, g.grid.map((l) => el("line", l)).join("")) +
      el("g", { "data-part": "axis" }, g.axis.map((t) => words(t)).join("")) +
      el("g", { "data-part": "marks" }, g.series.map((s) =>
        el("g", { "data-part": "series" },
          (line ? el("path", { "data-part": "line", d: s.path, "stroke-dasharray": s.dash }) : "") +
          s.marks.map((m) => el(line ? "circle" : "rect", Object.assign({ "data-part": "mark" }, m))).join("") +
          s.labels.map((t) => words(t, "label")).join("") +
          (s.tag ? words(s.tag, "name") : ""))).join(""));
    if (g.baseline) out += el("line", Object.assign({ "data-part": "baseline" }, g.baseline));
    if (g.legend) {
      out += el("g", { "data-part": "legend" }, g.legend.map((k, j) => {
        var y = k.y - 4;
        var swatch = line
          ? el("line", { "data-part": "swatch", x1: k.x, y1: y, x2: k.x + 14, y2: y, "stroke-dasharray": DASH[j % 4] })
          : el("rect", { "data-part": "swatch", x: k.x, y: y - 5, width: 10, height: 10 });
        return el("g", { "data-part": "key" }, swatch + el("text", { x: k.x + 18, y: k.y }, esc(k.name)));
      }).join(""));
    }
    return el("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 " + g.width + " " + g.height, width: g.width, height: g.height, role: "img", "aria-label": g.label }, out);
  }

  /**
   * The controller: draws `root`'s table into its plot part and keeps it drawn.
   * Idempotent; returns the existing API on a second call.
   */
  function createChart(root) {
    if (root._faqirChart) return root._faqirChart;
    var table = part(root, "data");
    if (!table) return null;
    var plot = part(root, "plot");
    if (!plot) {
      plot = document.createElement("div");
      plot.setAttribute("data-part", "plot");
      root.insertBefore(plot, table);
    }
    var lang = root.closest("[lang]");
    var locale = lang ? lang.getAttribute("lang") : undefined;
    var width = 0;
    // The plot's width is the root's content width: the plot itself is
    // display: none while it is empty, so it cannot be measured before a draw.
    var inner = () => {
      var cs = getComputedStyle(root);
      return root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    };
    var mo = typeof MutationObserver === "function" && new MutationObserver(redraw);
    var ro = typeof ResizeObserver === "function" && new ResizeObserver(() => {
      if (Math.abs(inner() - width) >= 1) redraw();
    });

    /** Read the data table again and redraw the chart; false when it holds no number. */
    function redraw() {
      var m = read(root, locale);
      width = inner();
      if (!m) {
        plot.innerHTML = "";
        delete root.dataset.state;
        return false;
      }
      plot.innerHTML = svg(layout(m, { width: width || 640, fontSize: parseFloat(getComputedStyle(plot).fontSize), locale: locale }));
      root.dataset.state = "drawn";
      return true;
    }

    /** Stop watching the table, remove the drawing and show the table again. */
    function destroy() {
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
      plot.innerHTML = "";
      delete root.dataset.state;
      delete root._faqirChart;
    }

    var api = { redraw: redraw, destroy: destroy };
    root._faqirChart = api;
    redraw();
    if (mo) mo.observe(table, { childList: true, subtree: true, characterData: true, attributes: true });
    if (ro) ro.observe(root);
    return api;
  }

  function sweep() {
    if (typeof document !== "undefined") document.querySelectorAll('[data-ui="chart"]').forEach(createChart);
  }

  function install(Faqir) {
    Faqir.controller("chart", createChart);
    sweep();
  }

  install.createChart = createChart;
  install.read = read;
  install.layout = layout;
  install.svg = svg;

  // CommonJS / bundler export (tests import the installer and the pure layout).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = install;
  }

  // Browser registration: through faqir-core when it is there, else on its own.
  var F =
    (typeof globalThis !== "undefined" && globalThis.Faqir) ||
    (typeof window !== "undefined" && window.Faqir);
  if (F && typeof F.controller === "function") {
    F.plugin(install);
  } else if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sweep);
    else sweep();
  }
})();
