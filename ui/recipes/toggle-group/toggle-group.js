// @ui:controller toggle-group
// @ui:provides getValue setValue toggle destroy

/**
 * toggle-group — a single- or multi-select group of toggle buttons built on
 * NATIVE form controls so `l-model` works with zero engine changes:
 *
 *   • single mode → `[data-part="control"]` are `<input type="radio">`; the
 *     committed value is the checked radio's `value` (a string). `l-model` on
 *     the radios two-way-binds a string through the engine's native radio path.
 *   • multi mode → the controls are `<input type="checkbox">`; the value is the
 *     array of checked `value`s. `l-model` binds an array through the engine's
 *     native checkbox-array path.
 *
 * The visible "buttons" are the `[data-part="item"]` labels; the native input
 * is visually hidden (see the CSS) but remains the accessible, focusable
 * control, so the ARIA is the real radio/checkbox semantics of the platform.
 *
 * The controller owns only what CSS and the platform cannot: **roving
 * tabindex** (Arrow/Home/End move a single tab-stop across the group, with
 * focus-follows-selection in single mode per the radiogroup convention),
 * keyboard toggling that is synthetic-event-safe (Space/Enter), single-mode
 * exclusivity when the controls are used standalone (no `l-model`), the
 * `[data-state]` styling hook, and a `faqir:change` notification.
 *
 * Every user mutation funnels through a native `change` event on the affected
 * input, so the engine's `l-model` listener and this controller stay in lockstep.
 * Store-driven `l-model` writes arrive as the engine's `faqir:model` event (and
 * a form `reset`); both re-sync state without a `faqir:change`. A plain script
 * write (`input.checked = x`) is silent and is not observed — use `setValue()`.
 */
export function createToggleGroup(root) {
  // Prevent double-init.
  if (root._faqirToggleGroup) return root._faqirToggleGroup;

  const mode = root.dataset.mode === "multi" ? "multi" : "single";
  const controls = () => [...root.querySelectorAll("[data-part='control']")];
  const enabled = () => controls().filter((el) => !el.disabled);

  // ── value ──────────────────────────────────────────────────────────────────
  function getValue() {
    const checked = controls()
      .filter((el) => el.checked)
      .map((el) => el.value);
    return mode === "multi" ? checked : (checked.length ? checked[0] : null);
  }

  function setValue(val) {
    const cs = controls();
    if (mode === "multi") {
      const set = new Set(Array.isArray(val) ? val : val == null ? [] : [val]);
      cs.forEach((el) => {
        el.checked = set.has(el.value);
      });
    } else {
      cs.forEach((el) => {
        el.checked = el.value === val;
      });
    }
    syncState();
  }

  // ── state reflection + roving tabindex ───────────────────────────────────────
  function checkedIndex() {
    return controls().findIndex((el) => el.checked);
  }

  function tabStopIndex() {
    // The tab-stop follows the checked control; falling back to the first
    // enabled one so the group is always reachable by Tab.
    const checked = checkedIndex();
    if (checked >= 0 && !controls()[checked].disabled) return checked;
    const first = controls().findIndex((el) => !el.disabled);
    return first >= 0 ? first : 0;
  }

  function syncState() {
    const stop = tabStopIndex();
    controls().forEach((el, i) => {
      el.tabIndex = i === stop ? 0 : -1;
      const item = el.closest("[data-part='item']") || el;
      item.dataset.state = el.checked ? "on" : "off";
    });
  }

  function emitChange() {
    root.dispatchEvent(
      new CustomEvent("faqir:change", {
        bubbles: true,
        detail: { value: getValue(), mode },
      }),
    );
  }

  // The single mutation seam: enforce single-mode exclusivity (needed when the
  // group is used without l-model), reflect state, then notify.
  function onChange(e) {
    const el = e.target.closest("[data-part='control']");
    if (!el || !root.contains(el)) return;
    if (mode === "single" && el.checked) {
      controls().forEach((o) => {
        if (o !== el) o.checked = false;
      });
    }
    syncState();
    emitChange();
  }

  // ── keyboard ─────────────────────────────────────────────────────────────────
  function moveFocus(fromIndex, delta) {
    const list = enabled();
    if (!list.length) return;
    const all = controls();
    // Map the absolute index onto the enabled subset, then step.
    let pos = list.indexOf(all[fromIndex]);
    if (pos < 0) pos = 0;
    const next = ((pos + delta) % list.length + list.length) % list.length;
    focusControl(all.indexOf(list[next]));
  }

  function focusControl(index) {
    const cs = controls();
    const el = cs[index];
    if (!el) return;
    cs.forEach((o, i) => {
      o.tabIndex = i === index ? 0 : -1;
    });
    el.focus();
    // radiogroup convention: in single mode, moving focus selects.
    if (mode === "single") select(el);
  }

  function jumpFocus(edge) {
    const list = enabled();
    if (!list.length) return;
    focusControl(controls().indexOf(edge === "first" ? list[0] : list[list.length - 1]));
  }

  // Toggle/select via a dispatched native change, so l-model and onChange run.
  function select(el) {
    if (el.disabled) return;
    if (mode === "multi") {
      el.checked = !el.checked;
    } else {
      el.checked = true;
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function onKeyDown(e) {
    const cs = controls();
    const active = cs.indexOf(document.activeElement);
    const from = active >= 0 ? active : tabStopIndex();
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveFocus(from, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveFocus(from, -1);
        break;
      case "Home":
        e.preventDefault();
        jumpFocus("first");
        break;
      case "End":
        e.preventDefault();
        jumpFocus("last");
        break;
      case " ":
      case "Enter":
        // Drive the toggle ourselves so synthetic events (tests) behave like
        // real ones and l-model always sees a change event.
        if (active >= 0) {
          e.preventDefault();
          select(cs[active]);
        }
        break;
    }
  }

  // Public toggle by value (imperative API).
  function toggle(value) {
    const el = controls().find((c) => c.value === value);
    if (el) select(el);
  }

  // A store-driven `l-model` write sets `.checked` silently and announces it
  // with `faqir:model`; follow it without re-emitting `faqir:change` (the user
  // did not act). A form reset restores defaults silently the same way.
  const form = root.closest("form");
  const onReset = () => setTimeout(syncState, 0);

  root.addEventListener("change", onChange);
  root.addEventListener("faqir:model", syncState);
  root.addEventListener("keydown", onKeyDown);
  if (form) form.addEventListener("reset", onReset);
  syncState();

  function destroy() {
    root.removeEventListener("change", onChange);
    root.removeEventListener("faqir:model", syncState);
    root.removeEventListener("keydown", onKeyDown);
    if (form) form.removeEventListener("reset", onReset);
    delete root._faqirToggleGroup;
  }

  const api = { getValue, setValue, toggle, destroy };
  root._faqirToggleGroup = api;
  return api;
}
