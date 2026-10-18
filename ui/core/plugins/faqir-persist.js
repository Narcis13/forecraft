// @ui:plugin faqir-persist
// @ui:provides l-persist, $persist()
/**
 * faqir-persist — localStorage-backed reactive state. [0.6-05 · §A5]
 *
 *   <div l-data="{ count: 0 }" l-persist="count">
 *     <button @click="count++" l-text="count"></button>
 *   </div>
 *
 * `l-persist="expression"` restores the expression before its first effect and
 * writes every reactive change as JSON. Keys are scoped as
 * `faqir:<namespace>:<key>`; set `data-persist-namespace` or
 * `data-persist-key` when the location-derived defaults are not specific enough.
 * `$persist(key)` reads the current namespace and `$persist(key, value)` writes
 * it, which is useful from `l-init` and event expressions.
 *
 * Storage access is guarded because localStorage can be absent or can throw in
 * privacy/quota modes. Failed writes fall back to module-local memory, keeping
 * the page reactive without throwing. Self-registering, zero dependencies,
 * and ≤ 2 KB gzip.
 */
(function () {
  "use strict";

  var memory = Object.create(null);

  function storage() {
    try {
      var g = typeof globalThis !== "undefined" ? globalThis : window;
      return g.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function namespace(el) {
    var owner = el.closest && el.closest("[data-persist-namespace]");
    if (owner) return owner.getAttribute("data-persist-namespace") || "default";
    try {
      return (location && location.pathname) || "default";
    } catch (e) {
      return "default";
    }
  }

  function fullKey(el, key) {
    return "faqir:" + namespace(el) + ":" + key;
  }

  function readRaw(key) {
    if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
    try {
      var s = storage();
      return s ? s.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      var s = storage();
      if (!s) throw new Error("storage unavailable");
      if (value == null) s.removeItem(key);
      else s.setItem(key, value);
      delete memory[key];
    } catch (e) {
      if (value == null) delete memory[key];
      else memory[key] = value;
    }
  }

  function decode(raw) {
    if (raw == null) return { found: false };
    try {
      return { found: true, value: JSON.parse(raw) };
    } catch (e) {
      return { found: false };
    }
  }

  function encode(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return null;
    }
  }

  function install(Faqir) {
    Faqir.magic("persist", function (el) {
      return function (key, value) {
        var storageKey = fullKey(el, String(key));
        if (arguments.length > 1) {
          writeRaw(storageKey, encode(value));
          return value;
        }
        var saved = decode(readRaw(storageKey));
        return saved.found ? saved.value : undefined;
      };
    });

    Faqir.directive("persist", function (el, dir, scope) {
      var expression = (dir.expression || "").trim();
      if (!expression) {
        console.warn("[Faqir] l-persist requires a state expression");
        return;
      }

      var key = el.getAttribute("data-persist-key") || expression;
      var storageKey = fullKey(el, key);
      var saved = decode(readRaw(storageKey));
      if (saved.found) {
        Faqir.evaluateAssignment(expression + " = " + JSON.stringify(saved.value), scope, el);
      }

      return Faqir.effect(function () {
        writeRaw(storageKey, encode(Faqir.evaluate(expression, scope, el)));
      });
    });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = install;

  var F =
    (typeof globalThis !== "undefined" && globalThis.Faqir) ||
    (typeof window !== "undefined" && window.Faqir);
  if (F && typeof F.plugin === "function") F.plugin(install);
})();
