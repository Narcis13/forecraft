// @ui:controller dropdown
// @ui:provides open close toggle destroy

import { onOutsideClick } from "../../core/events.js";
import { createMenuNavigation } from "../../core/menu-navigation.js";

export function createDropdown(root) {
  // Prevent double-init
  if (root._faqirDropdown) return root._faqirDropdown;

  const trigger = root.querySelector("[data-part='trigger']");
  const menu = root.querySelector("[data-part='menu']");

  // Incomplete markup — a wrapper emitted without one of its parts, which is
  // what a generator interrupted mid-component produces — used to throw a
  // TypeError out of the first dereference below. The engine contains that now
  // (the component fails, the page survives), but "Cannot read properties of
  // null" is a poor way to say which part is missing. Say it, and hand back an
  // inert API so `$ui.open()` is a no-op rather than a second crash. [W3-2]
  if (!trigger || !menu) {
    console.warn(
      "[Faqir] dropdown needs [data-part='trigger'] and [data-part='menu'] — " +
        `missing ${[!trigger && "trigger", !menu && "menu"].filter(Boolean).join(" and ")}. ` +
        "Component left inert.",
      root
    );
    const inert = { open() {}, close() {}, toggle() {}, destroy() {} };
    root._faqirDropdown = inert;
    return inert;
  }

  let outsideClickCleanup = null;

  const navigation = createMenuNavigation(menu, {
    onEscape() {
      close();
    },
    onTab() {
      close({ restoreFocus: false });
    },
  });

  function open(options = {}) {
    const focus = options.focus || "first";
    root.dataset.state = "open";
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");

    if (focus === "last") navigation.focusLast();
    else navigation.focusFirst();

    // Close on outside click
    if (outsideClickCleanup) outsideClickCleanup();
    outsideClickCleanup = onOutsideClick(root, () => close({ restoreFocus: false }));
  }

  function close(options = {}) {
    const restoreFocus = options.restoreFocus !== false;
    root.dataset.state = "closed";
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }

    if (restoreFocus) trigger.focus();
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  function onTriggerClick() {
    toggle();
  }

  function onTriggerKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (root.dataset.state !== "open") open({ focus: e.key === "ArrowUp" ? "last" : "first" });
      else if (e.key === "ArrowUp") navigation.focusLast();
      else navigation.focusFirst();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  trigger?.addEventListener("keydown", onTriggerKeyDown);

  // Delegate item clicks
  function onMenuClick(e) {
    const item = e.target.closest("[data-part='item']");
    if (
      item &&
      item.closest('[role="menu"]') === menu &&
      !item.disabled &&
      item.getAttribute("aria-disabled") !== "true"
    ) close();
  }
  menu?.addEventListener("click", onMenuClick);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close({ restoreFocus: false });
    trigger?.removeEventListener("click", onTriggerClick);
    trigger?.removeEventListener("keydown", onTriggerKeyDown);
    menu?.removeEventListener("click", onMenuClick);
    navigation.destroy();
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirDropdown;
  }

  const api = { open, close, toggle, destroy };
  root._faqirDropdown = api;
  return api;
}
