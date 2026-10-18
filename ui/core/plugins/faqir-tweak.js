// @ui:plugin faqir-tweak
// @ui:provides l-tweak
/**
 * faqir-tweak — a live theme studio for any Faqir page.
 *
 *   <aside l-tweak aria-label="Theme studio"></aside>
 *
 * Mounts a panel of dials into the element: scheme and density, the accent's
 * hue and chroma, the radius, spacing, type and motion scales, the heading
 * voice, easing personality, hover lift, edge weight, depth and material.
 * Every dial writes design tokens onto `<html>` as inline custom properties —
 * nothing is recompiled, every component on the page follows at once — and
 * `Faqir.tweak.css()` hands back the overrides as a `:root` block to paste
 * into a theme. The state persists in localStorage, so a tweak survives a
 * reload. Self-registering, zero dependencies.
 */
(function () {
  "use strict";

  var KEY = "faqir:tweak";
  var root = typeof document !== "undefined" ? document.documentElement : null;

  // Token families each scale dial multiplies. A dial never invents a value:
  // it reads what the theme computed, scales the number, keeps the unit.
  var SCALES = {
    radius: ["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-2xl"],
    space: ["--space-0h", "--space-1", "--space-1h", "--space-2", "--space-2h", "--space-3", "--space-3h", "--space-4", "--space-5", "--space-6", "--space-7", "--space-8", "--space-10", "--space-12", "--space-16", "--space-20", "--space-24", "--space-32", "--control-height-sm", "--control-height-md", "--control-height-lg"],
    type: ["--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl", "--text-3xl", "--text-4xl"],
    speed: ["--duration-instant", "--duration-fast", "--duration-normal", "--duration-slow", "--duration-slower", "--duration-slowest", "--motion-stagger", "--motion-ambient-duration"],
  };
  var ACCENT = ["--color-primary", "--color-primary-hover", "--color-primary-active", "--color-primary-subtle", "--color-ring"];
  var SHADOWS = ["--shadow-xs", "--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-xl"];
  var EASING = { spring: "var(--ease-spring)", bounce: "var(--ease-bounce)", linear: "var(--ease-linear)" };
  var BORDER = { hairline: ["sm", "md"], regular: ["md", "lg"], heavy: ["lg", "lg"] };
  var FONTS = { sans: "var(--font-sans)", serif: "var(--font-serif)", mono: "var(--font-mono)" };
  var TEXTURES = ["none", "grain", "paper", "dots", "grid", "stripes", "mesh"];

  var DEFAULTS = {
    scheme: "", density: "", hue: 0, chroma: 1, radius: 1, space: 1, type: 1, speed: 1,
    weight: "", tracking: "", headingFont: "", bodyFont: "", easing: "",
    lift: "", ambient: "", border: "", depth: "", page: "", surface: "",
  };

  var base = null; // token → computed value, read once before the first write
  var attrs = null; // the page's own data-theme / data-density
  var wrote = { "data-theme": null, "data-density": null }; // what the studio last set
  var state = null;
  var applied = [];
  var panels = [];

  function computed(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function capture() {
    if (base) return;
    base = {};
    Object.keys(SCALES).forEach(function (k) {
      SCALES[k].forEach(function (t) { base[t] = computed(t); });
    });
    ACCENT.forEach(function (t) { base[t] = computed(t); });
    attrs = {};
  }

  // "0.375rem" × 1.5 → "0.5625rem"; a value with no leading number is kept.
  function scaled(value, k) {
    var m = /^(-?[\d.]+)([a-z%]*)$/.exec(value);
    if (!m) return value;
    return String(Math.round(parseFloat(m[1]) * k * 10000) / 10000) + m[2];
  }

  // The complete override set for a state: token → value. One pure function,
  // so the panel, the export and the restore all agree on what a state means.
  function overrides(s) {
    var out = {};
    ["radius", "space", "type", "speed"].forEach(function (k) {
      if (+s[k] !== 1) SCALES[k].forEach(function (t) { out[t] = scaled(base[t], +s[k]); });
    });
    if (+s.hue !== 0 || +s.chroma !== 1) {
      ACCENT.forEach(function (t) {
        out[t] = "oklch(from " + base[t] + " l calc(c * " + s.chroma + ") calc(h + " + s.hue + "))";
      });
    }
    if (s.weight) out["--heading-weight"] = s.weight;
    if (s.tracking) out["--heading-tracking"] = s.tracking + "em";
    if (FONTS[s.headingFont]) out["--font-heading"] = FONTS[s.headingFont];
    if (FONTS[s.bodyFont]) { out["--font-body"] = FONTS[s.bodyFont]; out["--font-ui"] = FONTS[s.bodyFont]; }
    if (EASING[s.easing]) {
      out["--ease-default"] = EASING[s.easing];
      out["--motion-enter-ease"] = EASING[s.easing];
      out["--motion-reveal-ease"] = EASING[s.easing];
    }
    if (s.lift) out["--motion-hover-lift"] = s.lift;
    if (s.ambient === "paused") out["--motion-ambient-play"] = "paused";
    if (BORDER[s.border]) {
      out["--border-width"] = "var(--border-width-" + BORDER[s.border][0] + ")";
      out["--border-width-strong"] = "var(--border-width-" + BORDER[s.border][1] + ")";
    }
    if (s.depth === "flat") SHADOWS.forEach(function (t) { out[t] = "none"; });
    if (s.depth === "deep") SHADOWS.forEach(function (t, i) { out[t] = "var(" + SHADOWS[Math.min(i + 1, 4)] + ")"; });
    if (s.page) out["--texture-page"] = "var(--texture-" + s.page + ")";
    if (s.surface) out["--texture-surface"] = "var(--texture-" + s.surface + ")";
    return out;
  }

  // A page may switch its own data-theme after the studio is open (a theme
  // toggle); an attribute the studio did not write is the page's, and is what a
  // cleared dial goes back to.
  function setAttr(name, value) {
    var current = root.getAttribute(name);
    if (current !== wrote[name]) attrs[name] = current;
    var next = value || attrs[name];
    if (next) root.setAttribute(name, next);
    else root.removeAttribute(name);
    wrote[name] = next || null;
  }

  function apply(next) {
    capture();
    state = {};
    Object.keys(DEFAULTS).forEach(function (k) { state[k] = next && k in next ? next[k] : DEFAULTS[k]; });
    applied.forEach(function (t) { root.style.removeProperty(t); });
    var out = overrides(state);
    applied = Object.keys(out);
    applied.forEach(function (t) { root.style.setProperty(t, out[t]); });
    setAttr("data-theme", state.scheme);
    setAttr("data-density", state.density);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    panels.forEach(function (sync) { sync(); });
    return state;
  }

  function css() {
    capture();
    var out = overrides(state || DEFAULTS);
    var lines = Object.keys(out).map(function (t) { return "  " + t + ": " + out[t] + ";"; });
    var head = [];
    if (state && state.scheme) head.push('data-theme="' + state.scheme + '"');
    if (state && state.density) head.push('data-density="' + state.density + '"');
    return (head.length ? "/* <html " + head.join(" ") + "> */\n" : "") + ":root {\n" + lines.join("\n") + "\n}\n";
  }

  function restore() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved) apply(saved);
    } catch (e) {}
    return state;
  }

  // ── The panel ──
  // Built from the registry's own primitives, so the studio is styled by the
  // very tokens it edits. Every control is labelled; every value is announced.
  function h(tag, attributes, children) {
    var el = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (k) {
      if (attributes[k] == null) return;
      if (k === "text") el.textContent = attributes[k];
      else el.setAttribute(k, attributes[k]);
    });
    (children || []).forEach(function (c) { el.appendChild(c); });
    return el;
  }

  var uid = 0;

  function merged(next) {
    var s = {};
    Object.keys(state).forEach(function (k) { s[k] = state[k]; });
    Object.keys(next).forEach(function (k) { s[k] = next[k]; });
    return s;
  }

  function range(key, min, max, step, format) {
    var input = h("input", { type: "range", min: min, max: max, step: step, "data-tweak": key });
    var out = h("output", { "data-ui": "text", "data-size": "sm", "data-variant": "muted" });
    input.addEventListener("input", function () {
      var next = {}; next[key] = +input.value;
      apply(merged(next));
    });
    return {
      input: input,
      node: h("div", { "data-ui": "cluster", "data-gap": "3", "data-align": "center" }, [input, out]),
      sync: function () { input.value = state[key]; out.textContent = format(state[key]); },
    };
  }

  function select(key, options) {
    var input = h("select", { "data-ui": "select", "data-tweak": key });
    options.forEach(function (o) { input.appendChild(h("option", { value: o[0], text: o[1] })); });
    input.addEventListener("change", function () {
      var next = {}; next[key] = input.value;
      apply(merged(next));
    });
    return { input: input, node: input, sync: function () { input.value = state[key]; } };
  }

  function section(title, open, rows) {
    return h("details", { "data-ui": "collapsible", "data-variant": "bordered", open: open ? "" : null }, [
      h("summary", { "data-part": "trigger", text: title }),
      h("div", { "data-part": "content" }, [h("div", { "data-ui": "stack", "data-gap": "4" }, rows)]),
    ]);
  }

  function times(v) { return "× " + v; }
  function pct(v) { return Math.round(v * 100) + "%"; }

  function mount(el) {
    capture();
    if (!state && !restore()) apply(null);
    var controls = [];
    function row(label, c) {
      controls.push(c);
      var id = "faqir-tweak-" + ++uid;
      c.input.setAttribute("id", id);
      return h("div", { "data-ui": "field-group" }, [h("label", { "data-ui": "label", "for": id, text: label }), c.node]);
    }
    var textures = TEXTURES.map(function (t) { return [t === "none" ? "" : t, t]; });
    var defaultOr = function (pairs) { return [["", "Theme default"]].concat(pairs); };

    var status = h("p", { "data-ui": "text", "data-size": "sm", "data-variant": "muted", "aria-live": "polite" });
    var copy = h("button", { "data-ui": "button", "data-variant": "primary", type: "button", text: "Copy CSS" });
    copy.addEventListener("click", function () {
      var text = css();
      var done = function () { status.textContent = "Copied " + applied.length + " overrides."; };
      var show = function () { status.textContent = text; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, show);
      else show();
    });
    var reset = h("button", { "data-ui": "button", "data-variant": "outline", type: "button", text: "Reset" });
    reset.addEventListener("click", function () { apply(null); status.textContent = "Back to the theme."; });

    var panel = h("div", { "data-ui": "stack", "data-gap": "3" }, [
      section("Scheme & density", true, [
        row("Colour scheme", select("scheme", defaultOr([["light", "Light"], ["dark", "Dark"], ["auto", "Follow the system"]]))),
        row("Density", select("density", defaultOr([["compact", "Compact"], ["comfortable", "Comfortable"], ["spacious", "Spacious"]]))),
      ]),
      section("Accent", true, [
        row("Hue shift", range("hue", -180, 180, 5, function (v) { return v + "°"; })),
        row("Chroma", range("chroma", 0, 2, 0.05, times)),
      ]),
      section("Shape & space", false, [
        row("Radius", range("radius", 0, 2.5, 0.05, times)),
        row("Spacing", range("space", 0.6, 1.5, 0.05, times)),
        row("Edges", select("border", defaultOr([["hairline", "Hairline"], ["regular", "Regular"], ["heavy", "Heavy"]]))),
        row("Depth", select("depth", defaultOr([["flat", "Flat"], ["deep", "One step deeper"]]))),
      ]),
      section("Type", false, [
        row("Type scale", range("type", 0.8, 1.3, 0.025, pct)),
        row("Heading weight", select("weight", defaultOr([["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"], ["900", "Black"]]))),
        row("Heading tracking", select("tracking", defaultOr([["-0.04", "Tight"], ["0", "Normal"], ["0.06", "Wide"]]))),
        row("Heading face", select("headingFont", defaultOr([["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]]))),
        row("Body face", select("bodyFont", defaultOr([["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]]))),
      ]),
      section("Motion", false, [
        row("Speed", range("speed", 0.25, 2, 0.05, times)),
        row("Easing", select("easing", defaultOr([["spring", "Spring"], ["bounce", "Bounce"], ["linear", "Linear"]]))),
        row("Hover lift", select("lift", defaultOr([["0 -1px", "Subtle"], ["0 -2px", "Lift"], ["0 -4px", "Float"]]))),
        row("Ambient loops", select("ambient", defaultOr([["paused", "Paused"]]))),
      ]),
      section("Material", false, [
        row("Page texture", select("page", textures)),
        row("Surface texture", select("surface", textures)),
      ]),
      h("div", { "data-ui": "cluster", "data-gap": "2" }, [copy, reset]),
      status,
    ]);

    var sync = function () { controls.forEach(function (c) { c.sync(); }); };
    panels.push(sync);
    sync();
    el.appendChild(panel);
    return function () {
      panels.splice(panels.indexOf(sync), 1);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    };
  }

  function install(Faqir) {
    Faqir.tweak = {
      apply: apply,
      reset: function () { return apply(null); },
      css: css,
      restore: restore,
      get state() { return state; },
    };
    Faqir.directive("tweak", function (el) {
      if (!root || el.__faqirTweak) return;
      el.__faqirTweak = true;
      var unmount = mount(el);
      return function () {
        el.__faqirTweak = false;
        unmount();
      };
    });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = install;

  var F =
    (typeof globalThis !== "undefined" && globalThis.Faqir) ||
    (typeof window !== "undefined" && window.Faqir);
  if (F && typeof F.plugin === "function") F.plugin(install);
})();
