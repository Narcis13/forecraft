// @ui:controller toast
// @ui:provides add dismiss dismissAll destroy

import { uid } from "../../core/utils.js";
import { whenExitDone } from "../../core/motion.js";

export function createToastContainer(root) {
  // Prevent double-init
  if (root._faqirToast) return root._faqirToast;

  const toasts = new Map();

  /**
   * Add a new toast to the container.
   *
   * `message`, `icon` and `actionLabel` are TEXT. They are written with
   * `textContent`, never `innerHTML`, because the overwhelmingly common call is
   * `add({ message: err.message })` or a message built from a name the server
   * echoed back — values the caller did not author. Markup in any of them is
   * inert, exactly as it is in `l-text` (see `docs/security.md` §4).
   *
   * `iconHtml` is the explicit opt-in for markup — an inline `<svg>` glyph is
   * the reason it exists. It is assigned to `innerHTML` verbatim and is
   * therefore an `l-html`-class surface: never pass a value you did not author.
   * When both are given, `iconHtml` wins.
   *
   * @param {Object} options
   * @param {string} options.message - Toast message text (escaped)
   * @param {string} [options.tone="default"] - default|success|error|warning
   * @param {string} [options.icon] - Icon TEXT (a glyph such as "★"); escaped
   * @param {string} [options.iconHtml] - Icon markup, written unescaped. Author-supplied only.
   * @param {string} [options.actionLabel] - Action button label (escaped)
   * @param {Function} [options.onAction] - Action button callback
   * @param {number} [options.duration=5000] - Auto-dismiss delay in ms (0 to disable)
   * @returns {string} toast id
   */
  function add(options = {}) {
    const {
      message = "",
      tone = "default",
      icon = "",
      iconHtml = "",
      actionLabel = "",
      onAction = null,
      duration = 5000,
    } = options;

    const id = uid("toast");
    const el = document.createElement("div");
    el.dataset.part = "toast";
    el.dataset.variant = tone;
    el.dataset.state = "entering";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    // Build inner content as NODES, not as a concatenated string. The same
    // pattern as file-upload.js and tag-input.js, and for the same reason:
    // every value below may come from outside the page's author.
    if (icon || iconHtml) {
      const iconEl = document.createElement("span");
      iconEl.dataset.part = "icon";
      iconEl.setAttribute("aria-hidden", "true");
      // Opt-in markup wins over the escaped text form; see the doc comment.
      if (iconHtml) iconEl.innerHTML = iconHtml;
      else iconEl.textContent = icon;
      el.appendChild(iconEl);
    }

    const messageEl = document.createElement("span");
    messageEl.dataset.part = "message";
    messageEl.textContent = message;
    el.appendChild(messageEl);

    if (actionLabel) {
      const action = document.createElement("button");
      action.dataset.part = "action";
      action.textContent = actionLabel;
      el.appendChild(action);
    }

    const close = document.createElement("button");
    close.dataset.part = "close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\u2715"; // ✕ — was `&#x2715;` in the old innerHTML string
    el.appendChild(close);

    root.appendChild(el);

    // Transition from entering to visible on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (el.dataset.state === "entering") {
          el.dataset.state = "visible";
        }
      });
    });

    register(el, id, { onAction, duration });

    return id;
  }

  /**
   * Bring one toast element under the controller: wire its close and action
   * buttons, start its auto-dismiss timer, and record it so `dismiss` can find
   * it. Shared by `add()` and by the adoption of authored toasts on init.
   */
  function register(el, id, { onAction = null, duration = 0 } = {}) {
    el.dataset.toastId = id;

    const closeBtn = el.querySelector("[data-part='close']");
    const onCloseClick = () => dismiss(id);
    closeBtn?.addEventListener("click", onCloseClick);

    const actionBtn = el.querySelector("[data-part='action']");
    const onActionClick = () => {
      if (onAction) onAction();
      dismiss(id);
    };
    if (actionBtn) {
      actionBtn.addEventListener("click", onActionClick);
    }

    let timer = null;
    if (duration > 0) {
      timer = setTimeout(() => dismiss(id), duration);
    }

    toasts.set(id, {
      el,
      timer,
      closeBtn,
      onCloseClick,
      actionBtn,
      onActionClick,
    });

    return id;
  }

  /**
   * Dismiss a toast by id with exit animation.
   * @param {string} id
   */
  function dismiss(id) {
    const entry = toasts.get(id);
    // Already exiting (close clicked while the timer fires, say): one exit wait.
    if (!entry || entry.cancelExitWait) return;

    const { el, timer, closeBtn, onCloseClick, actionBtn, onActionClick } = entry;

    if (timer) clearTimeout(timer);

    // Start exit animation
    el.dataset.state = "exiting";

    const onEnd = () => {
      closeBtn?.removeEventListener("click", onCloseClick);
      if (actionBtn) actionBtn.removeEventListener("click", onActionClick);
      el.remove();
      toasts.delete(id);
    };

    // The toast's own exit motion. Its close button and action button both
    // transition `background` on hover, and those events bubble up to the toast
    // element — a one-shot listener spent itself on the first of them and the
    // toast was ripped out mid-slide, or (when no further event came) left in
    // the stack forever. See `whenExitDone`. [W2-1]
    entry.cancelExitWait = whenExitDone(el, null, onEnd);
  }

  /**
   * Dismiss all toasts.
   */
  function dismissAll() {
    const ids = [...toasts.keys()];
    ids.forEach((id) => dismiss(id));
  }

  function destroy() {
    // Clear all toasts immediately without animation
    for (const [id, entry] of toasts) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.cancelExitWait) entry.cancelExitWait();
      entry.closeBtn?.removeEventListener("click", entry.onCloseClick);
      if (entry.actionBtn) entry.actionBtn.removeEventListener("click", entry.onActionClick);
      entry.el.remove();
    }
    toasts.clear();
    delete root._faqirToast;
  }

  // Adopt the toasts already in the markup.
  //
  // `add()` used to be the only way into the registry, so a toast written by
  // hand — the reference page's own stack, the manifest template, anything an
  // agent copies out of the docs — had a close button that was wired to
  // nothing. It looked right, it was in the a11y tree, it did nothing at all
  // when clicked, and nothing anywhere said so. [W2-1]
  for (const el of root.querySelectorAll("[data-part='toast']")) {
    if (el.dataset.toastId) continue;
    register(el, uid("toast"));
  }

  const api = { add, dismiss, dismissAll, destroy };
  root._faqirToast = api;
  return api;
}
