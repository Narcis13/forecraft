// forecraft public form: send a form that faqir-validate has passed, without a
// page reload, then show the thank-you state (or follow the redirect).
//
// The form is rendered by @faqir-ui/forms and driven by faqir-core,
// faqir-validate and faqir-rules. Both a single-page form and a wizard fire
// `faqir:valid-submit` with the coerced answers in `event.detail`
// (Faqir.rules.data when rules are loaded); this file posts them. Around that
// it does what the rendered form does not do yet, each named in
// FAQIR-UPSTREAM.md: refusals in forecraft's words (#55), repeatable groups a
// rule can hide (#52), a typed, locale-aware date field (#53, #54), the `*` a
// rule adds, and a wizard that goes back to the step with the problem (#56).
//
// This file runs before public/boot.js starts faqir-core, so markup it adds is
// bound like the rendered markup.
(function () {
  "use strict";

  var config = document.querySelector("[data-form-config]");
  var form = document.getElementById("fc-form");
  if (!config || !form) return;
  var sending = false;
  var WORDS = readJson(config.dataset.wording) || {};
  var DATES = readJson(config.dataset.dates) || {};
  var LOCALE = navigator.language || document.documentElement.lang || "en";
  var CONTROLS = "input, select, textarea";

  function readJson(text) {
    try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
  }

  function say(key, params) {
    return String(WORDS[key] || WORDS.type || "").replace(/\{(\w+)\}/g, function (all, k) {
      return params && params[k] !== undefined ? String(params[k]) : all;
    });
  }

  function groupOf(el) {
    return el.closest('[data-ui="field-group"]');
  }

  // ── Refusals in forecraft's words (FAQIR-UPSTREAM.md #55) ──────────────────
  // faqir-validate prefers data-error-<constraint> to the browser's own sentence.

  function word(el) {
    if (el.type === "hidden" || el.type === "button" || el.type === "submit") return;
    function set(name, text) { if (!el.hasAttribute(name)) el.setAttribute(name, text); }
    set("data-error-required", say("required"));
    if (el.type === "email") set("data-error-type", say("email"));
    if (el.type === "url") set("data-error-type", say("uri"));
    if (el.type === "number") {
      set("data-error-input", say("number"));
      if (el.hasAttribute("min")) set("data-error-min", say("minimum", { limit: el.getAttribute("min") }));
      if (el.hasAttribute("max")) set("data-error-max", say("maximum", { limit: el.getAttribute("max") }));
      var step = el.getAttribute("step");
      if (step === "1") set("data-error-step", say("integer"));
      else if (step && step !== "any") set("data-error-step", say("multipleOf", { multipleOf: step }));
    }
    if (el.hasAttribute("minlength")) set("data-error-short", say("minLength", { limit: el.getAttribute("minlength") }));
    if (el.hasAttribute("maxlength")) set("data-error-long", say("maxLength", { limit: el.getAttribute("maxlength") }));
    if (el.hasAttribute("pattern")) set("data-error-pattern", say("pattern"));
  }

  function eachControl(fn) {
    form.querySelectorAll(CONTROLS).forEach(fn);
    // Rows are cloned from their template, so the template carries the words too.
    form.querySelectorAll("template").forEach(function (t) { t.content.querySelectorAll(CONTROLS).forEach(fn); });
  }

  eachControl(word);

  // ── Repeatable groups a rule can hide (FAQIR-UPSTREAM.md #52) ──────────────
  // The rule hides each row's inputs; the group's card, rows and buttons go with
  // them through this binding, and data-rules-path is what the patched plugin
  // counts as the field's control before the first row is drawn.

  form.querySelectorAll("template[l-for]").forEach(function (t) {
    var fieldset = t.parentElement && t.parentElement.closest("fieldset");
    var named = t.content.querySelector('[name*="[]."]');
    if (!fieldset || !named) return;
    var path = named.getAttribute("name").split("[].")[0];
    fieldset.setAttribute("data-rules-path", path);
    fieldset.setAttribute("l-bind:hidden", "$rules.visible['" + path + "'] === false");
  });

  // ── The wizard ────────────────────────────────────────────────────────────

  var steps = [];
  for (var i = 0; i < form.children.length; i++) {
    var child = form.children[i];
    if (child.tagName === "SECTION" && child.hasAttribute(":hidden")) steps.push(child);
  }
  // The wizard's `step` lives in the form's scope; this element is the way in
  // from plain JavaScript (FAQIR-UPSTREAM.md #56).
  var port = null;
  if (steps.length) {
    port = document.createElement("div");
    port.hidden = true;
    port.setAttribute("l-on:fc-step", "step = $event.detail");
    form.insertBefore(port, form.firstChild);
  }
  var visited = { 0: true };

  function currentStep() {
    for (var i = 0; i < steps.length; i++) if (!steps[i].hidden) return i;
    return 0;
  }

  function stepOf(el) {
    for (var i = 0; i < steps.length; i++) if (steps[i].contains(el)) return i;
    return -1;
  }

  // Show step `index`, then run `then` once its controls are enabled.
  function goToStep(index, then) {
    if (port && index >= 0 && index !== currentStep()) {
      port.dispatchEvent(new CustomEvent("fc-step", { detail: index }));
      setTimeout(then, 0);
    } else then();
  }

  // ── Errors painted by the page ────────────────────────────────────────────
  // The same slot faqir-validate writes into, cleared as soon as the visitor
  // changes the answer.

  function paint(el, message) {
    var group = groupOf(el);
    if (!group) return;
    var slot = group.querySelector('[data-part="error"]');
    group.setAttribute("data-state", "invalid");
    el.setAttribute("aria-invalid", "true");
    if (slot) slot.textContent = message;
    if (group.hasAttribute("data-fc-painted")) return;
    group.setAttribute("data-fc-painted", "");
    function clear() {
      group.removeEventListener("input", clear);
      group.removeEventListener("change", clear);
      if (!group.hasAttribute("data-fc-painted")) return;
      group.removeAttribute("data-fc-painted");
      if (group.getAttribute("data-state") === "invalid") group.removeAttribute("data-state");
      el.removeAttribute("aria-invalid");
      if (slot) slot.textContent = "";
    }
    group.addEventListener("input", clear);
    group.addEventListener("change", clear);
  }

  function unpaint(el) {
    var group = groupOf(el);
    if (group && group.hasAttribute("data-fc-painted")) group.dispatchEvent(new Event("change"));
  }

  // ── Required markers that follow the rules ────────────────────────────────
  // A `require` rule toggles `required` on a control; its label gets the same
  // `*` a field required by the schema has, for as long as the rule holds.

  function datePartner(el) {
    var picker = el.closest('[data-ui="date-picker"]');
    return picker && el.getAttribute("data-part") === "value" ? picker.querySelector('[data-part="input"]') : null;
  }

  function syncMarkers() {
    form.querySelectorAll('[data-ui="field-group"]').forEach(function (group) {
      var label = group.querySelector(':scope > [data-part="label"]');
      if (!label) return;
      var required = false;
      group.querySelectorAll(CONTROLS).forEach(function (el) {
        // A date's rule-required value input passes the demand to the input people type in.
        var shown = datePartner(el);
        if (shown && shown.required !== el.required && !shown.hasAttribute("data-fc-authored-required")) shown.required = el.required;
        if (el.required) required = true;
      });
      var own = label.querySelector("[data-fc-rule]");
      var authored = label.querySelector('[data-part="required"]:not([data-fc-rule])');
      if (required && !own && !authored) {
        var mark = document.createElement("span");
        mark.setAttribute("data-part", "required");
        mark.setAttribute("data-fc-rule", "");
        mark.textContent = "*";
        label.appendChild(document.createTextNode(" "));
        label.appendChild(mark);
      } else if (!required && own) {
        if (own.previousSibling && own.previousSibling.nodeType === 3) own.previousSibling.remove();
        own.remove();
      }
    });
  }

  var markerQueued = false;
  new MutationObserver(function () {
    if (markerQueued) return;
    markerQueued = true;
    queueMicrotask(function () { markerQueued = false; syncMarkers(); });
  }).observe(form, { subtree: true, attributes: true, attributeFilter: ["required"] });
  form.querySelectorAll('[data-ui="date-picker"] [data-part="input"][required]').forEach(function (el) {
    el.setAttribute("data-fc-authored-required", "");
  });

  // ── Dates: typed in the visitor's format, Monday-first where weeks are ─────
  // (FAQIR-UPSTREAM.md #53, #54)

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var FORMAT = dateFormat();

  // The order and separator of a numeric date here: day/month/year for en-GB,
  // month/day/year for en-US, day.month.year for de and ro.
  function dateFormat() {
    var order = [];
    var sep = "/";
    try {
      new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" })
        .formatToParts(new Date(2026, 9, 21)).forEach(function (p) {
          if (p.type === "day" || p.type === "month" || p.type === "year") order.push(p.type);
          else if (p.type === "literal" && order.length === 1) sep = p.value.replace(/[^./-]/g, "") || sep;
        });
    } catch (e) { order = []; }
    if (order.length !== 3) order = ["day", "month", "year"];
    return { order: order, sep: sep };
  }

  function weekStart() {
    try {
      var loc = new Intl.Locale(LOCALE);
      var info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
      if (info && info.firstDay) return info.firstDay % 7;
    } catch (e) { /* an old browser: fall through */ }
    return /-(US|CA|MX|BR|JP|KR|PH|IL|SA|IN|AU)$/i.test(LOCALE) || LOCALE === "en" ? 0 : 1;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function show(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var parts = { year: m[1], month: m[2], day: m[3] };
    return FORMAT.order.map(function (k) { return parts[k]; }).join(FORMAT.sep);
  }

  function placeholder() {
    var parts = { day: "dd", month: "mm", year: "yyyy" };
    return FORMAT.order.map(function (k) { return parts[k]; }).join(FORMAT.sep);
  }

  // What was typed, as an ISO date, or null: the visitor's order with any of
  // / . - or a space between, a two-digit year in this century, or ISO itself.
  function parse(text) {
    var t = String(text).trim();
    var y, mo, d;
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; } else {
      var bits = t.split(/[\s./-]+/);
      if (bits.length !== 3 || !bits.every(function (b) { return /^\d+$/.test(b); })) return null;
      var at = {};
      FORMAT.order.forEach(function (k, i) { at[k] = +bits[i]; });
      y = at.year < 100 && String(bits[FORMAT.order.indexOf("year")]).length <= 2 ? 2000 + at.year : at.year;
      mo = at.month; d = at.day;
    }
    var date = new Date(y, mo - 1, d);
    if (y < 1000 || date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return y + "-" + pad(mo) + "-" + pad(d);
  }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  var WEEK_START = weekStart();

  form.querySelectorAll('[data-ui="date-picker"]').forEach(function (picker) {
    var input = picker.querySelector('[data-part="input"]');
    var value = picker.querySelector('[data-part="value"]');
    var calendar = picker.querySelector('[data-ui="calendar"]');
    if (!input || !value || !calendar) return;
    var bounds = DATES[value.name] || {};

    input.removeAttribute("readonly");
    input.setAttribute("autocomplete", "off");
    if (!input.hasAttribute("placeholder")) input.setAttribute("placeholder", placeholder());
    // A date that cannot be read (or is out of range) fails here, in faqir-validate's
    // own pass, with the sentence set on data-error-date at the time.
    input.setAttribute("l-validate:date", "!$el.dataset.fcBad");

    calendar.setAttribute("data-week-start", String(WEEK_START));
    if (bounds.min) calendar.setAttribute("data-min", bounds.min);
    if (bounds.max) calendar.setAttribute("data-max", bounds.max);
    var heads = calendar.querySelectorAll("thead th");
    if (heads.length === 7 && WEEK_START) {
      var row = heads[0].parentElement;
      for (var k = 0; k < WEEK_START; k++) row.appendChild(row.firstElementChild);
    }

    // Month and year selects beside the month label, for a date years away.
    var label = calendar.querySelector('[data-part="month-label"]');
    var month = document.createElement("select");
    var year = document.createElement("select");
    month.setAttribute("aria-label", "Month");
    year.setAttribute("aria-label", "Year");
    month.setAttribute("data-fc-month", "");
    year.setAttribute("data-fc-year", "");
    [month, year].forEach(function (s) {
      s.setAttribute("data-ui", "select");
      s.setAttribute("data-size", "sm");
      s.setAttribute("data-validate-ignore", "");
    });
    MONTHS.forEach(function (name, i) { month.add(new Option(name, String(i))); });
    var now = new Date().getFullYear();
    var first = bounds.min ? +bounds.min.slice(0, 4) : now - 100;
    var last = bounds.max ? +bounds.max.slice(0, 4) : now + 10;
    for (var yr = last; yr >= first; yr--) year.add(new Option(String(yr), String(yr)));
    var both = document.createElement("span");
    both.setAttribute("data-fc-month-year", "");
    both.appendChild(month);
    both.appendChild(year);
    if (label) {
      label.hidden = true;
      label.after(both);
    }

    function api() { return window.Faqir.ui(picker); }

    // The calendar writes "October 2026" into the hidden label; the selects follow it.
    function follow() {
      var m = /^(\w+) (\d{4})$/.exec(label ? label.textContent : "");
      if (!m) return;
      month.value = String(MONTHS.indexOf(m[1]));
      if (!year.querySelector('option[value="' + m[2] + '"]')) year.add(new Option(m[2], m[2]));
      year.value = m[2];
    }
    if (label) new MutationObserver(follow).observe(label, { childList: true, characterData: true, subtree: true });
    function jump(e) {
      var cal = window.Faqir.ui(calendar);
      if (!cal) return;
      cal.navigate(+month.value, +year.value);
      e.target.focus();
    }
    month.addEventListener("change", jump);
    year.addEventListener("change", jump);

    function bad(message) {
      if (message) {
        input.dataset.fcBad = "true";
        input.setAttribute("data-error-date", message);
        paint(input, message);
      } else {
        delete input.dataset.fcBad;
        unpaint(input);
      }
    }

    // What was typed becomes the value, in the visitor's format, or a refusal.
    function commit() {
      var text = input.value.trim();
      var picked = api();
      if (!picked) return;
      if (!text) {
        bad(null);
        if (value.value) picked.clear();
        return;
      }
      var iso = parse(text);
      var problem = !iso ? say("dateTyped", { example: show(todayIso()) })
        : bounds.min && iso < bounds.min ? say("dateMin", { limit: show(bounds.min) })
        : bounds.max && iso > bounds.max ? say("dateMax", { limit: show(bounds.max) })
        : null;
      if (problem) {
        if (value.value) picked.clear();
        input.value = text;
        bad(problem);
        return;
      }
      bad(null);
      if (value.value !== iso) picked.setValue(iso);
      input.value = show(iso);
    }

    input.addEventListener("change", commit);
    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commit();
      var picked = api();
      if (picked && picker.dataset.state === "open") picked.close();
    });
    // A day picked in the calendar (or a value set above): the visitor's format.
    value.addEventListener("change", function () {
      bad(null);
      input.value = show(value.value);
      // faqir-validate re-checks a field on its `input`; the hidden value has none of its own.
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    document.addEventListener("DOMContentLoaded", function () {
      if (value.value) input.value = show(value.value);
      follow();
    });
  });

  // ── A dropdown whose choices do not fit its share of the row ──────────────
  // A closed select cannot wrap, so a narrow one cuts its value off. From the md
  // tier up (where widths apply), such a dropdown takes the whole row and the
  // fields beside it close up on the next; the title names the choice anyway.

  var measure = document.createElement("canvas").getContext("2d");
  var wide = window.matchMedia("(min-width: 48rem)");

  function fitSelect(select) {
    var group = groupOf(select);
    var row = group.parentElement;
    // A row on a step not shown has no width yet; it is measured when it is shown.
    if (!row || !measure || row.clientWidth === 0) return;
    group.removeAttribute("data-fc-span");
    if (!wide.matches) return;
    var style = getComputedStyle(select);
    measure.font = style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
    var longest = 0;
    for (var i = 0; i < select.options.length; i++) longest = Math.max(longest, measure.measureText(select.options[i].text).width);
    var need = longest + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2 * parseFloat(style.borderLeftWidth) + 4;
    var gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    var column = (row.clientWidth - 5 * gap) / 6;
    var span = group.getAttribute("data-span") === "half" ? 3 : 2;
    if (span * column + (span - 1) * gap < need) group.setAttribute("data-fc-span", "6");
  }

  function fitSelects() {
    form.querySelectorAll('[data-ui="field-group"][data-span] > [data-part="input"] > select:not([multiple])').forEach(fitSelect);
  }

  function titleSelects() {
    form.querySelectorAll("select:not([multiple])").forEach(function (select) {
      var chosen = select.selectedIndex > 0 ? select.options[select.selectedIndex].text : "";
      if (chosen) select.title = chosen;
      else select.removeAttribute("title");
    });
  }

  form.addEventListener("change", function (e) {
    if (e.target.tagName === "SELECT") titleSelects();
  });
  document.addEventListener("DOMContentLoaded", function () {
    fitSelects();
    titleSelects();
    syncMarkers();
    if (typeof ResizeObserver !== "function") return;
    var rows = new ResizeObserver(fitSelects);
    form.querySelectorAll('[data-ui="field-group"][data-span]').forEach(function (g) { rows.observe(g.parentElement); });
  });

  // ── Leaving a step: what an answer here made required on an earlier one ────

  function blank(el) {
    if (el.type === "radio") return !form.querySelector('input[type="radio"][name="' + CSS.escape(el.name) + '"]:checked');
    if (el.type === "checkbox") return !el.checked;
    var picker = el.closest('[data-ui="date-picker"]');
    if (picker && el.getAttribute("data-part") === "input") {
      var value = picker.querySelector('[data-part="value"]');
      return !value || !value.value;
    }
    return !String(el.value).trim();
  }

  function shown(el) {
    return !el.closest('[data-ui="field-group"][hidden], [data-rules-path][hidden]');
  }

  function firstGap(step) {
    var list = step.querySelectorAll(CONTROLS);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.type === "hidden" || !el.required || !shown(el)) continue;
      if (blank(el)) return el;
    }
    return null;
  }

  if (steps.length) {
    new MutationObserver(function () { visited[currentStep()] = true; })
      .observe(form, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    // Capture on the document: before faqir-validate's own submit listener.
    document.addEventListener("submit", function (e) {
      if (e.target !== form) return;
      var here = currentStep();
      for (var s = 0; s < here; s++) {
        if (!visited[s]) continue;
        var gap = firstGap(steps[s]);
        if (!gap) continue;
        e.preventDefault();
        e.stopImmediatePropagation();
        goToStep(s, function () {
          window.Faqir.validate.run(form).then(function () { gap.focus(); });
        });
        return;
      }
    }, true);
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  function fail(message) {
    if (form.dataset.state === "submitted") delete form.dataset.state;
    form.dispatchEvent(new CustomEvent("fc-failed", { bubbles: true, detail: message }));
  }

  // Honeypot and published-version sit outside the form (form="fc-form") so the
  // page chrome can own them; fold them into the JSON body the API expects.
  function extras() {
    var out = {};
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.name === "_fc_hp" || el.name === "_fc_v") out[el.name] = el.value;
    }
    return out;
  }

  // An untouched checkbox or switch says "no": send false rather than nothing,
  // as the server stores it too (src/forms/model.ts `untouched`). Not for a
  // control a rule hides, and not for a choice in a checkbox group.
  function untouched(body) {
    form.querySelectorAll('input[type="checkbox"]:not(:checked)').forEach(function (el) {
      if (!el.name || el.closest('[data-ui="checkbox-group"]') || !shown(el)) return;
      var keys = el.name.replace(/\[(\d+)\]/g, ".$1").split(".");
      var at = body;
      for (var i = 0; i < keys.length - 1; i++) {
        if (at[keys[i]] === undefined || at[keys[i]] === null) at[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
        at = at[keys[i]];
      }
      if (at[keys[keys.length - 1]] === undefined) at[keys[keys.length - 1]] = false;
    });
    return body;
  }

  // The control a server error points at: `lineItems.0.label` is the control
  // named `lineItems[0].label`; a date is the input people type in.
  function controlFor(path) {
    var name = path.replace(/\.(\d+)(?=\.|$)/g, "[$1]");
    var el = form.querySelector('[name="' + CSS.escape(name) + '"]');
    return el && (datePartner(el) || el);
  }

  function titleOf(el) {
    var group = groupOf(el);
    var label = group && group.querySelector('[data-part="label"]');
    if (!label) return "";
    var copy = label.cloneNode(true);
    copy.querySelectorAll('[data-part="required"]').forEach(function (m) { m.remove(); });
    return copy.textContent.replace(/\s+/g, " ").trim();
  }

  // "Company name is required." — the summary names the field it is about.
  function sentence(error, el) {
    var title = el ? titleOf(el) : "";
    var where = "";
    var row = /^(.+?)\.(\d+)\./.exec(error.field || "");
    if (row && el) {
      var set = el.closest("fieldset[data-rules-path]");
      var legend = set && set.querySelector("legend");
      where = (legend ? legend.textContent.trim() : row[1]) + ", row " + (+row[2] + 1) + ": ";
    }
    if (!title) {
      var group = form.querySelector('[data-rules-path="' + CSS.escape(error.field || "") + '"] legend');
      title = group ? group.textContent.trim() : error.field || "";
    }
    if (error.rule === "required") return where + title + " is required.";
    return where + (title ? title + ": " : "") + error.detail;
  }

  function showErrors(errors) {
    var found = errors.map(function (error) {
      var el = error.field ? controlFor(error.field) : null;
      var box = !el && error.field ? form.querySelector('[data-rules-path="' + CSS.escape(error.field) + '"]') : null;
      return { error: error, el: el, step: stepOf(el || box) };
    });
    var target = -1;
    found.forEach(function (f) { if (f.step >= 0 && (target < 0 || f.step < target)) target = f.step; });
    goToStep(target, function () {
      var first = null;
      found.forEach(function (f) {
        if (!f.el) return;
        paint(f.el, f.error.detail);
        if (!first && (target < 0 || f.step === target)) first = f.el;
      });
      if (first) first.focus();
    });
    return found.map(function (f) { return sentence(f.error, f.el); }).join(" ");
  }

  document.addEventListener("faqir:valid-submit", function (e) {
    if (e.target !== form) return;
    e.preventDefault();
    if (sending) return;

    if (config.dataset.preview === "true") {
      form.dispatchEvent(new CustomEvent("fc-sent", { bubbles: true }));
      return;
    }

    sending = true;
    var body = Object.assign(untouched(Object.assign({}, e.detail || {})), extras());
    fetch(config.dataset.action, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ data: body }),
    })
      .then(function (res) {
        return res.json().then(function (payload) { return { ok: res.ok, body: payload }; });
      })
      .then(function (r) {
        sending = false;
        if (!r.ok) {
          var errors = r.body && r.body.errors;
          fail(errors && errors.length ? showErrors(errors) : (r.body && r.body.detail) || "Something went wrong. Please try again.");
          return;
        }
        if (config.dataset.redirect) {
          window.location.assign(config.dataset.redirect);
          return;
        }
        // A form that issues its confirmation links to the PDF on the thank-you state.
        var doc = r.body && r.body.document;
        form.dispatchEvent(new CustomEvent("fc-sent", { bubbles: true, detail: doc && doc.link ? doc.pdf_url : null }));
        var main = document.getElementById("main");
        if (main) main.scrollIntoView({ block: "start" });
      })
      .catch(function () {
        sending = false;
        fail("We could not reach the server. Check your connection and try again.");
      });
  });
})();
