// @ui:controller sheet
// @ui:provides open close toggle destroy

import { trapFocus, returnFocus } from "../../core/focus.js";
import { whenExitDone } from "../../core/motion.js";
import { ownParts } from "../../core/dom.js";

export function createSheet(root) {
  // Prevent double-init
  if (root._faqirSheet) return root._faqirSheet;

  // Overlay and panel are direct children; trigger and close buttons are
  // matched by owner, so a nested component's close leaves this one alone.
  const [trigger] = ownParts(root, "trigger");
  const overlay = root.querySelector(":scope > [data-part='overlay']");
  const panel = root.querySelector(":scope > [data-part='panel']");
  const closeButtons = ownParts(root, "close");

  // `panel.focus()` on open does nothing without a tabindex: focus stayed on
  // `body`, out of reach of the trap and the root's Escape listener.
  if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");

  let focusCleanup = null;
  let previouslyFocused = null;
  let prevBodyOverflow = null;

  // Scroll lock: an open modal sheet freezes the page behind it. The guard makes
  // lock/unlock idempotent so overlapping open/close sequences (or a double
  // open) can never leave the body stuck at `overflow: hidden`.
  function lockScroll() {
    if (prevBodyOverflow !== null) return;
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (prevBodyOverflow === null) return;
    document.body.style.overflow = prevBodyOverflow;
    prevBodyOverflow = null;
  }

  // Cancels an in-flight "closing" wait when the sheet is re-opened mid-slide.
  let cancelExitWait = null;

  function open() {
    cancelExitWait?.();
    cancelExitWait = null;
    previouslyFocused = document.activeElement;
    root.dataset.state = "open";
    overlay.hidden = false;
    panel.hidden = false;
    lockScroll();
    focusCleanup = trapFocus(panel);
    panel.focus?.();
  }

  function close() {
    // Already gone, or already sliding out — a second click must not start a
    // second wait on top of the one in flight.
    if (root.dataset.state === "closed" || root.dataset.state === "closing") return;

    root.dataset.state = "closing";

    const onEnd = () => {
      cancelExitWait = null;
      const active = document.activeElement;
      root.dataset.state = "closed";
      overlay.hidden = true;
      panel.hidden = true;
      unlockScroll();
      if (focusCleanup) focusCleanup();
      focusCleanup = null;
      returnFocus(root, previouslyFocused, active);
    };

    // The panel's OWN `transform` — not a close button's `background`, which
    // bubbles up to the panel the moment the pointer touches it and used to eat
    // the one-shot listener, stranding the sheet at "closing" with the overlay
    // still covering the page. See `whenExitDone`. [W2-1]
    cancelExitWait = whenExitDone(panel, "transform", onEnd);
  }

  /**
   * Tear the overlay down NOW — no exit animation, no focus restore.
   *
   * `destroy()` unbound every listener and left the panel and its backdrop
   * exactly where they were: a full-page block whose close button, Escape key
   * and overlay click had all just stopped working, with no way out. An SPA
   * route change destroys controllers and does precisely this. The model is
   * `context-menu`, which has always closed itself on teardown. [W3-2]
   */
  function dismiss() {
    cancelExitWait?.();
    cancelExitWait = null;
    root.dataset.state = "closed";
    if (overlay) overlay.hidden = true;
    if (panel) panel.hidden = true;
    unlockScroll();
    if (focusCleanup) focusCleanup();
    focusCleanup = null;
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  // Event listeners
  function onTriggerClick() {
    open();
  }

  function onOverlayClick() {
    close();
  }

  function onCloseClick() {
    close();
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      e.stopPropagation();
      close();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  overlay?.addEventListener("click", onOverlayClick);
  closeButtons.forEach((btn) => btn.addEventListener("click", onCloseClick));
  root.addEventListener("keydown", onKeyDown);

  function destroy() {
    trigger?.removeEventListener("click", onTriggerClick);
    overlay?.removeEventListener("click", onOverlayClick);
    closeButtons.forEach((btn) =>
      btn.removeEventListener("click", onCloseClick)
    );
    root.removeEventListener("keydown", onKeyDown);
    dismiss();
    delete root._faqirSheet;
  }

  const api = { open, close, toggle, destroy };
  root._faqirSheet = api;
  return api;
}
