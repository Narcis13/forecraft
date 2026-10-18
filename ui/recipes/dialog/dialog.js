// @ui:controller dialog
// @ui:provides open close toggle destroy

import { trapFocus, returnFocus } from "../../core/focus.js";
import { whenExitDone } from "../../core/motion.js";
import { ownParts } from "../../core/dom.js";

/**
 * Shared modal-dialog controller.
 *
 * It drives both the `dialog` recipe and the `alert-dialog` recipe — the two are
 * one controller, distinguished only by the panel's ARIA role. When the panel
 * declares `role="alertdialog"` the controller switches to the WAI-ARIA
 * alertdialog contract:
 *   - the overlay backdrop does NOT dismiss (only an explicit choice closes it);
 *   - focus lands on the least-destructive action (cancel/close), not the panel;
 *   - Escape still closes by default, but a `data-confirm-required` root traps it
 *     so the user must pick confirm or cancel;
 *   - the footer's `[data-part="confirm"]` / `[data-part="cancel"]` actions emit
 *     cancelable `faqir:confirm` / `faqir:cancel` events (a prevented confirm
 *     keeps the dialog open for async work).
 * A plain `role="dialog"` panel behaves exactly as before.
 */
export function createDialog(root) {
  // Prevent double-init
  if (root._faqirDialog) return root._faqirDialog;

  // Overlay and panel are direct children. Trigger and actions may be wrapped
  // in layout primitives, so they are matched by owner: a popover's close
  // button inside the panel belongs to the popover and must not close this.
  const [trigger] = ownParts(root, "trigger");
  const overlay = root.querySelector(":scope > [data-part='overlay']");
  const panel = root.querySelector(":scope > [data-part='panel']");
  const closeButtons = ownParts(root, "close");
  const confirmButtons = ownParts(root, "confirm");
  const cancelButtons = ownParts(root, "cancel");

  // The role is the seam between `dialog` and `alert-dialog` — read it from the
  // markup so a single controller serves both recipes.
  const isAlert = !!panel && panel.getAttribute("role") === "alertdialog";

  // `panel.focus()` on open does nothing without a tabindex: focus stayed on
  // `body`, out of reach of the trap and the root's Escape listener.
  if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");

  let focusCleanup = null;
  let previouslyFocused = null;

  /** A confirm-required alertdialog traps Escape/overlay until an action is taken. */
  function confirmRequired() {
    return isAlert && root.hasAttribute("data-confirm-required");
  }

  /** Emit a cancelable, bubbling `faqir:<type>` event; returns the event. */
  function emit(type, detail) {
    const event = new CustomEvent("faqir:" + type, {
      bubbles: true,
      cancelable: true,
      detail: detail || {},
    });
    root.dispatchEvent(event);
    return event;
  }

  /** On open, focus the least-destructive action for an alert, else the panel. */
  function focusInitial() {
    if (isAlert) {
      const target = cancelButtons[0] || closeButtons[0] || panel;
      target?.focus?.();
    } else {
      panel?.focus?.();
    }
  }

  // Cancels an in-flight "closing" wait when the dialog is re-opened mid-exit.
  let cancelExitWait = null;

  function open() {
    // A second open() (trigger plus an external trigger, say) must not stack
    // another focus trap or overwrite the focus to restore on close.
    if (root.dataset.state === "open" && focusCleanup) return;
    cancelExitWait?.();
    cancelExitWait = null;
    // Re-opened mid-exit: the trap and the focus to restore are still live.
    if (!focusCleanup) previouslyFocused = document.activeElement;
    root.dataset.state = "open";
    overlay.hidden = false;
    panel.hidden = false;
    if (!focusCleanup) focusCleanup = trapFocus(panel);
    focusInitial();
  }

  function close() {
    // Already gone, or already animating out — a second click (confirm then
    // close, say) must not start a second wait on top of the one in flight.
    if (root.dataset.state === "closed" || root.dataset.state === "closing") return;

    root.dataset.state = "closing";

    const onEnd = () => {
      cancelExitWait = null;
      const active = document.activeElement;
      root.dataset.state = "closed";
      overlay.hidden = true;
      panel.hidden = true;
      if (focusCleanup) focusCleanup();
      focusCleanup = null;
      returnFocus(root, previouslyFocused, active);
    };

    // The panel's own exit motion. A footer button's `background` transitionend
    // bubbles here the instant the pointer touches it, and used to eat the
    // one-shot listener — snapping the panel away mid-animation at best, and at
    // worst leaving it up. No property filter: the panel's exit is an
    // `animation` in some themes and a `transition` in others. See
    // `whenExitDone`. [W2-1]
    cancelExitWait = whenExitDone(panel, null, onEnd);
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
  // In alert mode, dismissing without confirming is a cancel; the plain dialog
  // just closes.
  function onCloseClick() {
    if (isAlert) emit("cancel", { reason: "close" });
    close();
  }
  function onCancelClick() {
    emit("cancel", { reason: "cancel" });
    close();
  }
  function onConfirmClick() {
    const variant =
      panel?.getAttribute("data-variant") ||
      root.getAttribute("data-variant") ||
      "default";
    const event = emit("confirm", { variant });
    // A handler may keep the dialog open (e.g. to await a destructive request)
    // by calling preventDefault() on the confirm event.
    if (!event.defaultPrevented) close();
  }
  function onKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      // WAI-ARIA allows Escape to close an alertdialog, but a confirm-required
      // variant traps it so the user must make an explicit choice.
      if (confirmRequired()) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (isAlert) emit("cancel", { reason: "escape" });
      close();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  // An alertdialog must not dismiss on overlay click — only an explicit choice
  // closes it — so the overlay handler is bound for plain dialogs only.
  if (!isAlert) overlay?.addEventListener("click", onOverlayClick);
  closeButtons.forEach((btn) => btn.addEventListener("click", onCloseClick));
  confirmButtons.forEach((btn) => btn.addEventListener("click", onConfirmClick));
  cancelButtons.forEach((btn) => btn.addEventListener("click", onCancelClick));
  root.addEventListener("keydown", onKeyDown);

  // Support external triggers: any element with [data-open="{dialog-id}"]
  const externalTriggers = root.id
    ? document.querySelectorAll(`[data-open="${root.id}"]`)
    : [];
  if (externalTriggers.length) {
    externalTriggers.forEach((el) =>
      el.addEventListener("click", onTriggerClick)
    );
  }

  function destroy() {
    trigger?.removeEventListener("click", onTriggerClick);
    if (!isAlert) overlay?.removeEventListener("click", onOverlayClick);
    closeButtons.forEach((btn) =>
      btn.removeEventListener("click", onCloseClick)
    );
    confirmButtons.forEach((btn) =>
      btn.removeEventListener("click", onConfirmClick)
    );
    cancelButtons.forEach((btn) =>
      btn.removeEventListener("click", onCancelClick)
    );
    root.removeEventListener("keydown", onKeyDown);
    if (externalTriggers.length) {
      externalTriggers.forEach((el) =>
        el.removeEventListener("click", onTriggerClick)
      );
    }
    dismiss();
    delete root._faqirDialog;
  }

  const api = { open, close, toggle, destroy };
  root._faqirDialog = api;
  return api;
}
