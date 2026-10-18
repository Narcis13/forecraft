// @ui:controller slider
// @ui:provides setValue getValue getValues setFormatter destroy

/**
 * slider — single-thumb and range (two-thumb) slider.
 *
 * Modes are inferred from the DOM, never from a flag: two-or-more
 * `[data-part="thumb"]` elements ⇒ range mode. Each thumb is an independent
 * `role="slider"` widget with its own keyboard handling and ARIA value state.
 *
 * The controller owns only runtime state: it writes `aria-valuemin/max/now`
 * (and `aria-valuetext`, via a formatter hook), positions thumbs through the
 * `--pos` custom property, reflects the filled span through `--slider-start` /
 * `--slider-end` on the root, and toggles `data-state="dragging"` on the active
 * thumb. All value arithmetic lives in the pure, exported helpers below
 * (`valueFromPointer`, `snapToStep`, `percentOf`) so it is unit-testable without
 * a DOM.
 */
export function createSlider(root) {
  // Prevent double-init.
  if (root._faqirSlider) return root._faqirSlider;

  const track = root.querySelector("[data-part='track']");
  const thumbs = [...root.querySelectorAll("[data-part='thumb']")];
  const isRange = thumbs.length >= 2;
  const last = thumbs.length - 1;

  const min = numAttr(root, "min", 0);
  const max = numAttr(root, "max", 100);
  const step = (() => {
    const s = numAttr(root, "step", 1);
    return s > 0 ? s : 1;
  })();
  // PageUp/PageDown jump: an explicit data-page-step, else ten normal steps.
  const bigStep = (() => {
    const p = numAttr(root, "pageStep", NaN);
    return Number.isFinite(p) && p > 0 ? p : step * 10;
  })();

  // aria-valuetext hook: a formatter set via setFormatter() wins; otherwise a
  // declarative `data-value-suffix` (e.g. "%") produces "<value><suffix>".
  let formatter = null;
  const suffix = root.dataset.valueSuffix || "";

  // Ensure every thumb is a proper, focusable slider even if the author omitted
  // the role/tabindex — screen-reader-correct ARIA must not depend on hand markup.
  thumbs.forEach((thumb) => {
    if (!thumb.hasAttribute("role")) thumb.setAttribute("role", "slider");
    if (!thumb.hasAttribute("tabindex")) {
      thumb.setAttribute("tabindex", isDisabled() ? "-1" : "0");
    }
  });

  // Seed values: prefer an existing aria-valuenow, then the i-th data-value
  // token, then a sensible default (first thumb → min, last → max).
  const dataVals = (root.dataset.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number);

  let values = thumbs.map((thumb, i) => {
    const now = thumb.getAttribute("aria-valuenow");
    if (now !== null && now !== "" && Number.isFinite(Number(now))) return Number(now);
    if (i < dataVals.length && Number.isFinite(dataVals[i])) return dataVals[i];
    return i === 0 ? min : max;
  });
  // Normalize in order so range clamping sees already-normalized lower neighbours.
  thumbs.forEach((_, i) => {
    values[i] = clampForThumb(i, snapToStep(values[i], min, max, step));
  });

  function isDisabled() {
    return root.hasAttribute("data-disabled");
  }

  // Clamp a candidate value to the global bounds and, in range mode, to the
  // adjacent thumbs — this is what stops the two thumbs from crossing.
  function clampForThumb(index, value) {
    let lo = min;
    let hi = max;
    if (isRange) {
      if (index > 0) lo = values[index - 1];
      if (index < last) hi = values[index + 1];
    }
    return Math.min(Math.max(value, lo), hi);
  }

  function boundsFor(index) {
    const lo = isRange && index > 0 ? values[index - 1] : min;
    const hi = isRange && index < last ? values[index + 1] : max;
    return { lo, hi };
  }

  function textFor(value, index) {
    if (typeof formatter === "function") return formatter(value, index);
    if (suffix) return `${value}${suffix}`;
    return null;
  }

  function renderThumb(index) {
    const thumb = thumbs[index];
    const value = values[index];
    const { lo, hi } = boundsFor(index);
    thumb.setAttribute("aria-valuemin", String(lo));
    thumb.setAttribute("aria-valuemax", String(hi));
    thumb.setAttribute("aria-valuenow", String(value));
    const text = textFor(value, index);
    if (text != null) thumb.setAttribute("aria-valuetext", text);
    else thumb.removeAttribute("aria-valuetext");
    thumb.style.setProperty("--pos", `${percentOf(value, min, max)}%`);
  }

  function renderRange() {
    const startPct = isRange ? percentOf(values[0], min, max) : 0;
    const endPct = percentOf(values[isRange ? last : 0], min, max);
    root.style.setProperty("--slider-start", `${startPct}%`);
    root.style.setProperty("--slider-end", `${endPct}%`);
  }

  function render() {
    thumbs.forEach((_, i) => renderThumb(i));
    renderRange();
  }

  function emitChange(index) {
    root.dispatchEvent(
      new CustomEvent("faqir:change", {
        bubbles: true,
        detail: { index, value: values[index], values: values.slice() },
      }),
    );
  }

  // The single mutation seam: snap → clamp (non-crossing) → render → notify.
  function applyValue(index, rawValue, opts) {
    if (index < 0 || index >= thumbs.length) return;
    const next = clampForThumb(index, snapToStep(rawValue, min, max, step));
    const changed = next !== values[index];
    values[index] = next;
    render();
    if (changed && !(opts && opts.silent)) emitChange(index);
  }

  function nearestThumb(value) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < values.length; i++) {
      const d = Math.abs(values[i] - value);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // ── RTL ──────────────────────────────────────────────────────────────────
  // getComputedStyle is authoritative in a browser; fall back to the dir
  // attribute for detached nodes / happy-dom where computed direction is unset.
  function isRTL() {
    if (root.closest('[dir="rtl"]')) return true;
    if (typeof getComputedStyle === "function") {
      try {
        return getComputedStyle(root).direction === "rtl";
      } catch {
        /* jsdom/happy-dom on a detached node — ignore */
      }
    }
    return false;
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (isDisabled()) return;
    const thumb = e.target.closest("[data-part='thumb']");
    if (!thumb || !root.contains(thumb)) return;
    const index = thumbs.indexOf(thumb);
    if (index < 0) return;

    const rtl = isRTL();
    const cur = values[index];
    let next;
    switch (e.key) {
      case "ArrowUp":
        next = cur + step;
        break;
      case "ArrowDown":
        next = cur - step;
        break;
      case "ArrowRight":
        next = cur + (rtl ? -step : step);
        break;
      case "ArrowLeft":
        next = cur + (rtl ? step : -step);
        break;
      case "PageUp":
        next = cur + bigStep;
        break;
      case "PageDown":
        next = cur - bigStep;
        break;
      case "Home":
        next = min; // clampForThumb pins it to the lower neighbour in range mode
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    applyValue(index, next);
  }

  // ── Pointer dragging ─────────────────────────────────────────────────────
  let drag = null; // { index }
  const docHandlers = [];

  function beginDrag(index) {
    drag = { index };
    thumbs[index].dataset.state = "dragging";
    const move = (ev) => onDragMove(ev);
    const end = () => endDrag();
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    docHandlers.push(["pointermove", move], ["pointerup", end], ["pointercancel", end]);
  }

  function onDragMove(ev) {
    if (!drag || !track) return;
    const value = valueFromPointer(ev.clientX, track.getBoundingClientRect(), {
      min,
      max,
      step,
      rtl: isRTL(),
    });
    applyValue(drag.index, value);
  }

  function endDrag() {
    if (!drag) return;
    thumbs[drag.index].removeAttribute("data-state");
    for (const [type, fn] of docHandlers) document.removeEventListener(type, fn);
    docHandlers.length = 0;
    drag = null;
  }

  function onPointerDown(e) {
    if (isDisabled()) return;
    if (typeof e.button === "number" && e.button !== 0) return; // primary button only

    const thumb = e.target.closest("[data-part='thumb']");
    if (thumb && root.contains(thumb)) {
      e.preventDefault();
      const index = thumbs.indexOf(thumb);
      thumb.focus();
      beginDrag(index);
      return;
    }

    // A press anywhere on the track jumps the nearest thumb to that point and
    // starts dragging it — the standard "click-to-set" affordance.
    if (track && (e.target === track || track.contains(e.target))) {
      e.preventDefault();
      const value = valueFromPointer(e.clientX, track.getBoundingClientRect(), {
        min,
        max,
        step,
        rtl: isRTL(),
      });
      const index = nearestThumb(value);
      applyValue(index, value);
      if (thumbs[index]) thumbs[index].focus();
      beginDrag(index);
    }
  }

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointerdown", onPointerDown);

  // Paint initial positions/ARIA without firing a spurious change event.
  render();

  // ── Public API ───────────────────────────────────────────────────────────
  function setValue(index, value) {
    applyValue(index, value);
  }
  function getValue() {
    return isRange ? values.slice() : values[0];
  }
  function getValues() {
    return values.slice();
  }
  function setFormatter(fn) {
    formatter = typeof fn === "function" ? fn : null;
    render();
  }

  function destroy() {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("pointerdown", onPointerDown);
    endDrag();
    delete root._faqirSlider;
  }

  const api = { setValue, getValue, getValues, setFormatter, destroy };
  root._faqirSlider = api;
  return api;
}

// ── Pure value math (no DOM) — unit-tested in isolation ──────────────────────

/** Decimal places implied by a step (so 0.1 + 0.2 doesn't leak float dust). */
function stepDecimals(step) {
  const str = String(step);
  const dot = str.indexOf(".");
  return dot === -1 ? 0 : str.length - dot - 1;
}

/**
 * Snap a raw value onto the nearest step from `min`, clamped to `[min, max]`.
 * @returns {number}
 */
export function snapToStep(value, min, max, step) {
  const s = step > 0 ? step : 1;
  const steps = Math.round((value - min) / s);
  const snapped = Math.min(Math.max(min + steps * s, min), max);
  return Number(snapped.toFixed(stepDecimals(s)));
}

/** Value → percent along the track (0–100), clamped. */
export function percentOf(value, min, max) {
  if (max === min) return 0;
  const p = ((value - min) / (max - min)) * 100;
  return Math.min(Math.max(p, 0), 100);
}

/**
 * Map a pointer x-coordinate to a slider value. Pure: no DOM access — the caller
 * supplies the track rect. Handles RTL by inverting the fraction, so the same
 * arithmetic serves both writing directions.
 *
 * @param {number} clientX pointer x in client coordinates
 * @param {{left:number, width:number}} rect track bounding rect
 * @param {{min:number, max:number, step:number, rtl?:boolean}} opts
 * @returns {number} snapped, clamped value
 */
export function valueFromPointer(clientX, rect, opts) {
  const { min, max, step } = opts;
  const width = rect.width;
  if (!(width > 0)) return min;
  let fraction = (clientX - rect.left) / width;
  fraction = Math.min(Math.max(fraction, 0), 1);
  if (opts.rtl) fraction = 1 - fraction;
  return snapToStep(min + fraction * (max - min), min, max, step);
}

// Read a numeric data-* attribute (dataset key), falling back when absent/NaN.
function numAttr(el, key, fallback) {
  const raw = el.dataset[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
