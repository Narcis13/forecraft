// @ui:plugin faqir-validate
// @ui:provides l-validate
// @ui:modifier l-validate .async | On `l-validate:<name>`, marks a validator whose expression answers with a promise: the field-group sits in `data-state="validating"` while it is out, runs are debounced 250ms and the newest wins, and a rejection is a failure rather than a silent pass.
/**
 * faqir-validate — declarative + programmatic form validation. [0.6-02 · 1.1B-03 · §7.1, §A5, §8.3]
 * Everything the field-group contract needs, driven from markup or from JS.
 *
 *   <form l-validate>
 *     <div data-ui="field-group">
 *       <label data-part="label" for="email">Work email</label>
 *       <input data-part="input" id="email" name="email" type="email" required
 *              l-validate:company="isCompanyEmail(value)"
 *              l-validate:taken.async="isFree(value)"
 *              data-error-company="Use your company address."
 *              data-error-taken="That address is already registered.">
 *       <p data-part="error"></p>
 *     </div>
 *   </form>
 *
 * Reflects each control's native `ValidityState` (plus any custom validators)
 * into the enclosing `[data-ui="field-group"]`: sets `data-state="invalid"`,
 * fills the group's `[data-part="error"]` with a message, and wires
 * `aria-invalid` (+ `aria-describedby` to the error part when it has an id).
 * No JavaScript is required from the page author for the full validation UX.
 *
 * ── Revalidation policy (the exact UX contract) ─────────────────────────────
 *   • On **submit**: every field is validated. If any is invalid the submit is
 *     blocked (`preventDefault`) and focus moves to the first offender. When all
 *     are clean the browser submits natively — unless `l-validate` carries an
 *     expression, which is then treated as an on-valid hook (SPA submit) and run
 *     while the native submit is suppressed.
 *   • **After the first submit attempt**, each field additionally revalidates
 *     live — on `blur` (error surfaces when you leave it) and on `input` (error
 *     clears as you fix it). Before that first attempt, typing is never
 *     interrupted with errors. (`blur` doesn't bubble, so both are captured.)
 *   • A submit that has to wait on an async check is blocked, not abandoned:
 *     when every check has answered it either focuses the first offender or
 *     completes — the on-valid hook if the form declares one, otherwise a
 *     native `form.submit()`, which fires no submit event and cannot re-enter.
 *
 * ── Custom validators ───────────────────────────────────────────────────────
 *   `l-validate:<name>="expr"` on a control runs only after native constraints
 *   pass. `expr` is evaluated with the control's current `value` (and `$el`) in
 *   scope; a falsy result marks the field invalid. Its message comes from
 *   `data-error-<name>`, then `data-error`, then a default. Multiple named
 *   validators may coexist on one control; the first to fail wins.
 *
 *   `l-validate:<name>.async="expr"` is the same thing for an expression that
 *   answers with a promise. The field-group enters `data-state="validating"`
 *   while it is out, the run is debounced 250 ms as you type and the newest run
 *   wins, and a rejected promise is a failure with a built-in message — never a
 *   silent pass. (An `.async`-less validator that returns a promise is awaited
 *   too, because a promise is truthy and would otherwise pass everything; the
 *   dev build says so.)
 *
 * ── Programmatic validators ─────────────────────────────────────────────────
 *   `Faqir.validate.register(form, field, name, fn, message?)` adds a validator
 *   to the control(s) named `field`, and returns a function that removes it
 *   again (as does `unregister(form, field, name?)` — no `name` drops the
 *   field's lot). `fn(value, { el, form, data })` answers `true`, `false`, a
 *   message string, or a promise of those; `data` is the form's `l-data` scope.
 *   Registered validators run after native constraints and after the attribute
 *   validators, in registration order, first failure wins. Their message chain
 *   is: the string `fn` returned → the `message` argument → `data-error-<name>`
 *   → `data-error` → a default.
 *
 *   `Faqir.validate.run(form)` validates the whole form and resolves to whether
 *   it is clean. It flushes any pending debounce, waits for every async check,
 *   and — like a submit attempt — turns live revalidation on, so the errors it
 *   surfaces can be cleared by typing. Both take a form element or a selector.
 *
 * ── Message resolution (when a field is invalid) ────────────────────────────
 *   custom-validator message → `data-error-<constraint>` → `data-error`
 *   → the browser's native `validationMessage` → a built-in default.
 *
 * Escape hatch: `data-validate-ignore` on a control opts it out entirely.
 *
 * Self-registers via `Faqir.plugin` when a global `Faqir` is present (load it
 * after faqir-core) and is also exported for bundlers/tests. It installs the
 * optional `Faqir.validate` member — plugin-installed surface, declared in
 * `faqir-core.d.ts` as optional for exactly that reason. Zero dependencies,
 * ≤ 3 KB gzip. The only attributes it owns are `data-state="invalid"` and
 * `data-state="validating"` on the group, `aria-invalid`/`aria-describedby`
 * on the control and `novalidate` on the form (the plugin replaces the
 * browser's own bubbles) — the frozen five-attribute protocol is untouched.
 */
(function () {
  "use strict";

  // Non-field / non-validatable input types — skipped when scanning a form.
  var SKIP_TYPES = { submit: 1, button: 1, reset: 1, image: 1, hidden: 1 };

  // The two `data-state` values this plugin owns. Any other state on the group
  // is the author's (or a controller's) and is never cleared by a verdict.
  var OWNED = { invalid: 1, validating: 1 };

  // ValidityState flag → (author-message attribute suffix, built-in fallback).
  // Checked in order; the first failing flag decides the message.
  var CONSTRAINTS = [
    ["valueMissing", "required", "This field is required."],
    ["typeMismatch", "type", "Please enter a valid value."],
    ["patternMismatch", "pattern", "Please match the requested format."],
    ["tooShort", "short", "Please lengthen this value."],
    ["tooLong", "long", "Please shorten this value."],
    ["rangeUnderflow", "min", "Value is too small."],
    ["rangeOverflow", "max", "Value is too large."],
    ["stepMismatch", "step", "Please enter a valid value."],
    ["badInput", "input", "Please enter a valid value."]
  ];

  var ATTR = "l-validate:";
  var ASYNC = ".async";
  var DEBOUNCE_MS = 250;
  var INVALID = "This field is invalid.";
  // A check that throws or rejects never answered, so it is not the author's
  // message — and it is certainly not a pass.
  var CHECK_FAILED = "Could not check this field. Please try again.";

  var F = null; // the engine, from install()
  var contexts = new WeakMap(); // form → { scope, submitted }
  var registered = new WeakMap(); // form → Map(field name → [{ name, fn, message }])
  var runs = new WeakMap(); // control → { seq, timer, async }

  function isFormField(el) {
    var tag = el.tagName;
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return false;
    if (el.disabled) return false;
    if (el.hasAttribute("data-validate-ignore")) return false;
    if (tag === "INPUT" && SKIP_TYPES[el.type]) return false;
    return true;
  }

  function fields(form) {
    var out = [];
    var all = form.querySelectorAll("input, select, textarea");
    for (var i = 0; i < all.length; i++) if (isFormField(all[i])) out.push(all[i]);
    return out;
  }

  // Per-control bookkeeping: `seq` is the last-wins token, `timer` the pending
  // debounce, `async` whether this control has ever been seen to go async.
  function slot(el) {
    var s = runs.get(el);
    if (!s) {
      s = { seq: 0, timer: 0, async: false };
      runs.set(el, s);
    }
    return s;
  }

  function valueOf(el) {
    return "value" in el ? el.value : null;
  }

  // Message shown once a control is invalid — see header for the priority order.
  function messageFor(el) {
    var v = el.validity;
    if (v.customError) return el.validationMessage || INVALID;
    for (var i = 0; i < CONSTRAINTS.length; i++) {
      if (v[CONSTRAINTS[i][0]]) {
        return (
          el.getAttribute("data-error-" + CONSTRAINTS[i][1]) ||
          el.getAttribute("data-error") ||
          el.validationMessage ||
          CONSTRAINTS[i][2]
        );
      }
    }
    return el.validationMessage || INVALID;
  }

  function group(el) {
    return el.closest('[data-ui="field-group"]');
  }

  // Dev-build diagnostic. The production engine's `report` is an empty function,
  // so this costs one call and says nothing in a shipped page.
  function report(message, el) {
    if (F && F.devtools && F.devtools.report) F.devtools.report(message, el);
  }

  // Set (or clear) the group state this plugin owns. An author's "disabled"
  // survives a clear; a verdict still overwrites it, as it always has.
  function setGroupState(el, next) {
    var g = group(el);
    if (!g) return;
    if (next) g.setAttribute("data-state", next);
    else if (OWNED[g.getAttribute("data-state")]) g.removeAttribute("data-state");
  }

  // Reflect a control's verdict onto itself + its field-group. The plugin owns
  // the group's `[data-part="error"]` text.
  function applyState(el, valid, message) {
    var g = group(el);
    var err = g && g.querySelector('[data-part="error"]');
    if (valid) {
      el.removeAttribute("aria-invalid");
      setGroupState(el, null);
      if (err) {
        err.textContent = "";
        if (err.id && el.getAttribute("aria-describedby") === err.id)
          el.removeAttribute("aria-describedby");
      }
    } else {
      el.setAttribute("aria-invalid", "true");
      setGroupState(el, "invalid");
      if (err) {
        err.textContent = message;
        if (err.id && !el.getAttribute("aria-describedby"))
          el.setAttribute("aria-describedby", err.id);
      }
    }
  }

  // Waiting on an async check: the previous verdict is gone and the new one has
  // not arrived. `validating` is the state the field-group contract already
  // declares for exactly this moment.
  function markValidating(el) {
    applyState(el, true, "");
    setGroupState(el, "validating");
  }

  // ── Checks ────────────────────────────────────────────────────────────────
  // A check is a thunk returning true / false / a message / a promise of those,
  // carrying the message to show when it answers falsy.

  function check(el, name, run, message) {
    run.msg =
      message ||
      el.getAttribute("data-error-" + name) ||
      el.getAttribute("data-error") ||
      INVALID;
    return run;
  }

  // The custom validators declared on a control, in attribute order. With no
  // `l-validate` context (a bare `Faqir.validate.run`) there is no scope for
  // their expressions to read, so they are skipped rather than run into a
  // ReferenceError that would mark every field invalid.
  function attrChecks(el, ctx) {
    var out = [];
    if (!ctx) return out;
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (attr.name.indexOf(ATTR) !== 0) continue;
      var name = attr.name.slice(ATTR.length);
      var declared = name.length > ASYNC.length && name.slice(-ASYNC.length) === ASYNC;
      if (declared) name = name.slice(0, -ASYNC.length);
      out.push(check(el, name, expressionCheck(el, attr.value, ctx, declared), null));
    }
    return out;
  }

  // `Object.create(scope)` inherits from the engine's reactive PROXY, and a
  // plain assignment on a child object still runs that proxy's `set` trap
  // (`receiver` is the child, the trap is the prototype's): `local.value = …`
  // would write into the page's data, and `local.$el = …` is refused outright —
  // a TypeError under "use strict" in a real browser, which is where this was
  // found. happy-dom never showed it. `defineProperty` writes the own property
  // directly and consults no trap. [1.1B-03]
  function define(obj, key, value) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  function expressionCheck(el, expression, ctx, declared) {
    return function () {
      var local = Object.create((ctx && ctx.scope) || Object.prototype);
      define(local, "value", valueOf(el));
      define(local, "$el", el);
      var answer = F.evaluate(expression, local, el);
      if (!declared && thenable(answer)) {
        report(
          'l-validate:… ="' + expression + '" returned a promise. A promise is ' +
            "truthy, so the field would always pass — write it as " +
            "l-validate:<name>.async so the verdict is awaited.",
          el
        );
      }
      return answer;
    };
  }

  // The validators registered for this control's `name`, in registration order.
  function registeredChecks(form, el, ctx) {
    var byField = registered.get(form);
    var list = byField && el.name ? byField.get(el.name) : null;
    var out = [];
    for (var i = 0; list && i < list.length; i++) {
      out.push(registeredCheck(form, el, list[i], ctx));
    }
    return out;
  }

  function registeredCheck(form, el, entry, ctx) {
    var c = check(
      el,
      entry.name,
      function () {
        return entry.fn(valueOf(el), {
          el: el,
          form: form,
          data: (ctx && ctx.scope) || null
        });
      },
      entry.message
    );
    c.speaks = true; // a string answer is its message, not a truthy pass
    return c;
  }

  function thenable(value) {
    return !!value && typeof value.then === "function";
  }

  // null when the check passed, otherwise the message to show. Only a
  // registered validator may answer with its own sentence; an attribute
  // expression keeps 1.0's reading, where any truthy value — a non-empty string
  // included, as in l-validate:nonblank="value.trim()" — is a pass.
  function verdict(c, value) {
    if (value === true) return null;
    if (c.speaks && typeof value === "string") return value || c.msg;
    return value ? null : c.msg;
  }

  // Run checks in order, first failure wins. Returns null (all passed) or a
  // message — or a promise of either, the moment a check answers with one.
  function runChecks(checks, i) {
    for (; i < checks.length; i++) {
      var c = checks[i];
      var value;
      try {
        value = c();
      } catch (e) {
        return CHECK_FAILED;
      }
      if (thenable(value)) {
        var next = i + 1;
        return value.then(
          function (settled) {
            var m = verdict(c, settled);
            return m === null ? runChecks(checks, next) : m;
          },
          function () {
            return CHECK_FAILED;
          }
        );
      }
      var message = verdict(c, value);
      if (message !== null) return message;
    }
    return null;
  }

  // A custom check has answered. The message also goes onto the control as its
  // custom validity, so `el.validity.valid` and `form.checkValidity()` agree
  // with what the field-group is showing.
  function settle(el, message) {
    if (message !== null) el.setCustomValidity(message);
    applyState(el, message === null, message || "");
  }

  // Validate one control and reflect the verdict. Returns true/false, or a
  // Promise<boolean> when a check went async. Cancels any pending debounce on
  // this control, so a submit flushes what typing had deferred.
  function validateField(form, el, ctx) {
    var s = slot(el);
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = 0;
    }
    var token = ++s.seq;

    el.setCustomValidity(""); // clear any prior custom verdict
    if (!el.validity.valid) {
      applyState(el, false, messageFor(el));
      return false;
    }

    var out = runChecks(attrChecks(el, ctx).concat(registeredChecks(form, el, ctx)), 0);
    if (!thenable(out)) {
      settle(el, out);
      return out === null;
    }

    s.async = true; // from now on this control's live runs are debounced
    markValidating(el);
    return out.then(function (message) {
      // A newer run owns the DOM — answer, but touch nothing.
      if (s.seq !== token) return message === null;
      settle(el, message);
      return message === null;
    });
  }

  // True when this control is known to take time: it declares an `.async`
  // validator, or a previous run of it went async (a registered `fn` only
  // reveals that by returning a promise).
  function isSlow(el) {
    var s = slot(el);
    if (s.async) return true;
    for (var i = 0; i < el.attributes.length; i++) {
      var n = el.attributes[i].name;
      if (n.indexOf(ATTR) === 0 && n.slice(-ASYNC.length) === ASYNC) {
        s.async = true;
        return true;
      }
    }
    return false;
  }

  // Typing into a slow control: hold the run for 250 ms and let the newest one
  // win, rather than firing a request per keystroke. Sync-only controls still
  // answer on the keystroke — that is the "error clears as you fix it" half of
  // the revalidation policy.
  function schedule(form, el, ctx) {
    var s = slot(el);
    if (s.timer) clearTimeout(s.timer);
    markValidating(el);
    s.timer = setTimeout(function () {
      s.timer = 0;
      validateField(form, el, ctx);
    }, DEBOUNCE_MS);
  }

  function firstInvalid(list, verdicts) {
    for (var i = 0; i < list.length; i++) if (!verdicts[i]) return list[i];
    return null;
  }

  function focusField(el) {
    if (typeof el.focus === "function") el.focus();
  }

  function hookExpression(dir) {
    return dir.expression && dir.expression.trim() ? dir.expression : null;
  }

  // Every check has answered after a submit that had to wait. Either focus the
  // first offender, or finish the submit the wait interrupted — unless the
  // page's own submit handler cancelled it (`@submit.prevent` on an SPA form):
  // that submit was never going to navigate, and a native one now would.
  function finishSubmit(form, list, verdicts, ctx, dir, cancelled) {
    var bad = firstInvalid(list, verdicts);
    if (bad) {
      focusField(bad);
      return;
    }
    if (hookExpression(dir)) {
      F.evaluateAssignment(dir.expression, ctx.scope, form);
      return;
    }
    if (cancelled()) return;
    // Native submit: fires no submit event, so the listener below cannot
    // re-enter and the async pass cannot loop.
    if (typeof form.submit === "function") form.submit();
  }

  // Validate every control of a form, whoever asked. Returns a Promise<boolean>
  // so a caller that does not care whether any check was async can just wait.
  function validateAll(form, ctx) {
    var list = fields(form);
    var results = [];
    for (var i = 0; i < list.length; i++) results.push(validateField(form, list[i], ctx));
    return Promise.all(results).then(function (verdicts) {
      return firstInvalid(list, verdicts) === null;
    });
  }

  // ── The programmatic surface, installed as `Faqir.validate` ───────────────

  function host(target, what) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el || !el.querySelectorAll) {
      throw new TypeError(
        "Faqir.validate." + what + ": no form element matched " + JSON.stringify(target)
      );
    }
    return el;
  }

  function indexOfName(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return i;
    return -1;
  }

  var api = {
    register: function (form, field, name, fn, message) {
      var el = host(form, "register");
      if (typeof fn !== "function") {
        throw new TypeError("Faqir.validate.register: `fn` must be a function");
      }
      var byField = registered.get(el);
      if (!byField) {
        byField = new Map();
        registered.set(el, byField);
      }
      var list = byField.get(field);
      if (!list) {
        list = [];
        byField.set(field, list);
      }
      var entry = { name: name, fn: fn, message: message || null };
      var at = indexOfName(list, name);
      // Re-registering a name replaces it in place, so registration ORDER is
      // the order the names were first seen — not the order they were last set.
      if (at === -1) list.push(entry);
      else list[at] = entry;

      if (!el.querySelector('[name="' + field + '"]')) {
        report(
          'Faqir.validate.register("' + field + '", "' + name + '") matches no ' +
            "control in this form — it will never run.",
          el
        );
      }
      return function () {
        api.unregister(el, field, name);
      };
    },

    unregister: function (form, field, name) {
      var el = host(form, "unregister");
      var byField = registered.get(el);
      if (!byField) return;
      if (name === undefined) {
        byField.delete(field);
        return;
      }
      var list = byField.get(field);
      var at = list ? indexOfName(list, name) : -1;
      if (at !== -1) list.splice(at, 1);
    },

    run: function (form) {
      var el = host(form, "run");
      var ctx = contexts.get(el) || null;
      if (ctx) ctx.submitted = true; // the errors are on screen — let typing clear them
      else {
        report(
          "Faqir.validate.run() on a form with no l-validate. Native constraints " +
            "and registered validators still run, but its l-validate:<name> " +
            "expressions have no scope to read and are skipped.",
          el
        );
      }
      return validateAll(el, ctx);
    }
  };

  function install(Faqir) {
    F = Faqir;
    // Plugin-installed surface. Declared optional in faqir-core.d.ts because a
    // page that never loads this file does not have it. Always this instance's:
    // the directive below replaces any earlier one, so a second copy of this file
    // (two script tags, a bundle beside the CDN) must not leave `register()`
    // writing to a registry the live directive no longer reads.
    Faqir.validate = api;

    Faqir.directive("validate", function (form, dir, scope) {
      var ctx = { scope: scope, submitted: false };
      contexts.set(form, ctx);
      // This plugin runs the constraints and shows the messages. Left on, the
      // browser's own validation cancels an invalid submit before any submit
      // event fires, so a real browser never reached the handler below.
      form.noValidate = true;

      // Submit: validate everything; block + focus the first offender when dirty.
      form.addEventListener("submit", function (e) {
        ctx.submitted = true;
        var list = fields(form);
        var results = [];
        var waiting = false;
        for (var i = 0; i < list.length; i++) {
          var r = validateField(form, list[i], ctx);
          results.push(r);
          if (thenable(r)) waiting = true;
        }

        // A check is still out: this turn cannot decide the submit, so block it
        // and resume once every answer is in. Blocking sets `defaultPrevented`
        // for everyone, so whether ANOTHER handler cancelled it — before this
        // one, or after — is kept by watching this event's preventDefault.
        if (waiting) {
          var cancelledByPage = e.defaultPrevented;
          var prevent = e.preventDefault;
          e.preventDefault = function () {
            cancelledByPage = true;
            return prevent.call(e);
          };
          prevent.call(e);
          Promise.all(results).then(function (verdicts) {
            finishSubmit(form, list, verdicts, ctx, dir, function () {
              return cancelledByPage;
            });
          });
          return;
        }

        var firstBad = firstInvalid(list, results);
        if (firstBad) {
          e.preventDefault();
          focusField(firstBad);
          return;
        }
        // Clean. A non-empty `l-validate` expression is an on-valid hook (SPA
        // submit): run it and keep the browser from navigating. Otherwise let
        // the native submit proceed.
        if (hookExpression(dir)) {
          e.preventDefault();
          Faqir.evaluateAssignment(dir.expression, scope, form);
        }
      });

      // After the first submit attempt, revalidate the touched field live.
      function live(e) {
        if (!ctx.submitted || !isFormField(e.target)) return;
        if (e.type === "input" && isSlow(e.target)) schedule(form, e.target, ctx);
        else validateField(form, e.target, ctx);
      }
      form.addEventListener("blur", live, true);
      form.addEventListener("input", live, true);
    });
  }

  // CommonJS / bundler export (tests import the installer directly).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = install;
  }

  // Browser self-registration: attach as soon as a global Faqir exists.
  var G =
    (typeof globalThis !== "undefined" && globalThis.Faqir) ||
    (typeof window !== "undefined" && window.Faqir);
  if (G && typeof G.plugin === "function") {
    G.plugin(install);
  }
})();
