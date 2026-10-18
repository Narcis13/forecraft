// @ui:plugin faqir-mask
// @ui:provides l-mask
/**
 * faqir-mask — caret-safe input masking. [0.6-06 · §A5]
 *
 *   <input l-model="phone" l-mask="(999) 999-9999">
 *
 * Pattern tokens are `9` (digit), `a` (ASCII letter), and `*` (any character);
 * every other character is a literal inserted by the formatter. The displayed
 * input value is masked while `l-model` receives the raw token characters.
 * `faqir:mask` bubbles after edits with `{ raw, value, caret }` for controllers
 * such as input-otp. The pure `maskEdit()` function owns all edit/caret math;
 * this directive is only a thin beforeinput/paste/model bridge.
 *
 * Self-registering, zero dependencies, and ≤ 2 KB gzip.
 */
(function () {
  "use strict";

  var TOKENS = { "9": /[0-9]/, a: /[A-Za-z]/, "*": /[^]/ };

  // `in` is safe: callers pass one character, and no inherited Object
  // property has a one-character name.
  function isToken(ch) {
    return ch in TOKENS;
  }

  function tokenTypes(mask) {
    var out = [];
    for (var i = 0; i < mask.length; i++) if (isToken(mask[i])) out.push(mask[i]);
    return out;
  }

  function accepts(token, ch) {
    return !!ch && TOKENS[token].test(ch);
  }

  /** Extract token characters from either raw or already-formatted input. */
  function readRaw(mask, value, startSlot) {
    var types = tokenTypes(mask);
    var slot = startSlot || 0;
    var raw = "";
    var text = String(value == null ? "" : value);
    var maskIndex = 0;
    var seenSlots = 0;

    while (maskIndex < mask.length && seenSlots < slot) {
      if (isToken(mask[maskIndex])) seenSlots++;
      maskIndex++;
    }

    for (var i = 0; i < text.length && slot < types.length; i++) {
      var ch = text[i];
      while (maskIndex < mask.length && !isToken(mask[maskIndex])) {
        if (ch === mask[maskIndex]) {
          maskIndex++;
          ch = "";
          break;
        }
        maskIndex++;
      }
      if (!ch) continue;
      if (accepts(types[slot], ch)) {
        raw += ch;
        slot++;
        while (maskIndex < mask.length && !isToken(mask[maskIndex])) maskIndex++;
        maskIndex++;
      }
    }
    return raw;
  }

  /** Format raw token characters and retain raw-index ↔ display-position maps. */
  function format(mask, rawValue) {
    var raw = readRaw(mask, rawValue, 0);
    var value = "";
    var starts = [];
    var ends = [];
    var rawIndex = 0;

    for (var i = 0; i < mask.length; i++) {
      var part = mask[i];
      if (isToken(part)) {
        if (rawIndex >= raw.length) break;
        starts[rawIndex] = value.length;
        value += raw[rawIndex++];
        ends[rawIndex - 1] = value.length;
      } else if (raw.length > 0) {
        value += part;
      }
    }
    return { raw: raw, value: value, starts: starts, ends: ends };
  }

  function rawIndexAt(formatted, displayPosition) {
    var position = Math.max(0, Number(displayPosition) || 0);
    var rawIndex = 0;
    for (var i = 0; i < formatted.ends.length; i++) {
      if (formatted.ends[i] <= position) rawIndex = i + 1;
      else break;
    }
    return rawIndex;
  }

  function caretAt(formatted, rawIndex) {
    if (rawIndex < formatted.raw.length) return formatted.starts[rawIndex];
    return formatted.value.length;
  }

  /**
   * Pure edit engine.
   * @param {string} mask
   * @param {string} priorValue canonical masked value before the edit
   * @param {{inputType?:string,data?:string|null,selectionStart?:number,selectionEnd?:number}} edit
   * @returns {{raw:string,value:string,caret:number}}
   */
  function maskEdit(mask, priorValue, edit) {
    mask = String(mask || "");
    var types = tokenTypes(mask);
    if (!types.length) throw new Error("l-mask pattern requires at least one 9, a, or * token");

    edit = edit || {};
    var prior = format(mask, priorValue);
    var displayStart = edit.selectionStart == null ? prior.value.length : edit.selectionStart;
    var displayEnd = edit.selectionEnd == null ? displayStart : edit.selectionEnd;
    var start = rawIndexAt(prior, Math.min(displayStart, displayEnd));
    var end = rawIndexAt(prior, Math.max(displayStart, displayEnd));
    var inputType = edit.inputType || "insertText";
    var raw = prior.raw;
    var caretRaw = start;

    if (inputType.indexOf("delete") === 0) {
      // Every delete* is prevented by the directive, so every one is handled
      // here: a collapsed caret deletes by character, by mask group (a "word":
      // tokens with no literal between them), or by line (all before/after the
      // caret, or everything for an undirected line delete). Undirected
      // content deletes (deleteContent, a collapsed cut) are no-ops.
      var back = /Backward$/.test(inputType);
      var fwd = /Forward$/.test(inputType);
      var line = /Line/.test(inputType);
      var word = line || /Word/.test(inputType);
      var from = start;
      var to = end;
      // Whether a word/line step may continue past slot boundary i: a literal
      // between token slots i-1 and i ends a word; nothing ends a line.
      var more = function (i) { return line || prior.starts[i] === prior.ends[i - 1]; };
      if (start === end) {
        if (back && from > 0) do from--; while (word && from > 0 && more(from));
        if (fwd && to < raw.length) do to++; while (word && to < raw.length && more(to));
      }
      raw = raw.slice(0, from) + raw.slice(to);
      caretRaw = from;
    } else {
      var inserted = readRaw(mask, edit.data == null ? "" : edit.data, start);
      raw = (raw.slice(0, start) + inserted + raw.slice(end)).slice(0, types.length);
      caretRaw = start + inserted.length;
    }

    var next = format(mask, raw);
    return { raw: next.raw, value: next.value, caret: caretAt(next, caretRaw) };
  }

  function modelExpression(el) {
    for (var i = 0; i < el.attributes.length; i++) {
      if (el.attributes[i].name.indexOf("l-model") === 0) {
        return el.attributes[i].value;
      }
    }
    return "";
  }

  function install(Faqir) {
    Faqir.directive("mask", function (el, dir, scope) {
      if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        console.warn("[Faqir] l-mask must be used on an input or textarea");
        return;
      }
      if (el._faqirMask) {
        if (el._faqirMask._scope === scope) return;
        el._faqirMask.destroy();
      }

      var pattern = String(dir.expression || "").trim();
      try {
        maskEdit(pattern, "", {});
      } catch (error) {
        console.warn("[Faqir] " + error.message);
        return;
      }

      var model = modelExpression(el);
      var destroyed = false;
      var renderId = 0;
      var pendingCaret = null;
      var initial = formatResult(el.value);
      var raw = initial.raw;

      function paint(result, caret) {
        raw = result.raw;
        if (el.value !== result.value) el.value = result.value;
        if (caret !== false) {
          // try: some input types (email, number) throw on selection APIs.
          try {
            el.setSelectionRange(result.caret, result.caret);
          } catch (e) {}
        }
      }

      function emit(result) {
        el.dispatchEvent(
          new CustomEvent("faqir:mask", {
            bubbles: true,
            detail: { raw: result.raw, value: result.value, caret: result.caret },
          }),
        );
      }

      function commit(result, shouldEmit) {
        paint(result, true);
        if (model) {
          pendingCaret = result.caret;
          Faqir.evaluateAssignment(model + " = " + JSON.stringify(result.raw), scope, el);
          // l-model also reflects the raw scope value into el.value. Repaint after
          // the reactive flush so the visible value remains masked regardless of
          // directive attribute order.
          var id = ++renderId;
          Faqir.nextTick(function () {
            if (!destroyed && id === renderId) {
              var repaint = formatResult(raw);
              repaint.caret = pendingCaret == null ? repaint.caret : pendingCaret;
              pendingCaret = null;
              paint(repaint, true);
            }
          });
        }
        if (shouldEmit !== false) emit(result);
        return result;
      }

      function formatResult(value) {
        return maskEdit(pattern, "", {
          inputType: "insertFromPaste",
          data: value,
          selectionStart: 0,
          selectionEnd: 0,
        });
      }

      function edit(inputType, data, selectionStart, selectionEnd) {
        return commit(
          maskEdit(pattern, el.value, {
            inputType: inputType,
            data: data,
            selectionStart: selectionStart == null ? el.selectionStart : selectionStart,
            selectionEnd: selectionEnd == null ? el.selectionEnd : selectionEnd,
          }),
        );
      }

      function setRaw(value, caret, shouldEmit) {
        var result = formatResult(value);
        if (caret != null) {
          var formatted = format(pattern, result.raw);
          result.caret = caretAt(formatted, Math.max(0, Math.min(Number(caret) || 0, result.raw.length)));
        }
        return commit(result, shouldEmit);
      }

      function onBeforeInput(event) {
        var type = event.inputType || "";
        if (type.indexOf("insert") !== 0 && type.indexOf("delete") !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        edit(type, event.data);
      }

      function onPaste(event) {
        var data = event.clipboardData;
        if (!data || typeof data.getData !== "function") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        edit("insertFromPaste", data.getData("text"));
      }

      function onInput(event) {
        // Fallback for autofill/IME paths that skip cancelable beforeinput.
        event.stopImmediatePropagation();
        var caret = el.selectionStart;
        var result = formatResult(el.value);
        result.caret = Math.min(caret == null ? result.value.length : caret, result.value.length);
        commit(result);
      }

      el.addEventListener("beforeinput", onBeforeInput, true);
      el.addEventListener("paste", onPaste, true);
      el.addEventListener("input", onInput, true);

      var api;
      function cleanup() {
        if (destroyed) return;
        destroyed = true;
        el.removeEventListener("beforeinput", onBeforeInput, true);
        el.removeEventListener("paste", onPaste, true);
        el.removeEventListener("input", onInput, true);
        if (stopModel) stopModel();
        if (el._faqirMask === api) delete el._faqirMask;
      }

      api = {
        edit: edit,
        getRaw: function () { return raw; },
        setRaw: setRaw,
        destroy: cleanup,
        _scope: scope,
      };
      el._faqirMask = api;
      paint(initial, false);

      var stopModel = null;
      if (model) {
        stopModel = Faqir.effect(function () {
          var value = Faqir.evaluate(model, scope, el);
          var id = ++renderId;
          Faqir.nextTick(function () {
            if (!destroyed && id === renderId) {
              var repaint = formatResult(value);
              if (pendingCaret != null && repaint.raw === raw) {
                repaint.caret = pendingCaret;
                pendingCaret = null;
                paint(repaint, true);
              } else {
                paint(repaint, false);
              }
            }
          });
        });
      }

      return cleanup;
    });
  }

  install.maskEdit = maskEdit;
  if (typeof module !== "undefined" && module.exports) module.exports = install;

  var F = typeof globalThis !== "undefined" ? globalThis.Faqir : window.Faqir;
  if (F && typeof F.plugin === "function") F.plugin(install);
})();
