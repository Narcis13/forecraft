// @ui:core focus
// @ui:provides trapFocus releaseFocus focusFirst getFocusableElements returnFocus

const FOCUSABLE = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Get all focusable elements within a container.
 * @param {Element} container
 * @returns {Element[]}
 */
export function getFocusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden]") && el.offsetParent !== null
  );
}

/**
 * Focus the first focusable element in a container.
 * @param {Element} container
 * @returns {boolean} true if an element was focused
 */
export function focusFirst(container) {
  const els = getFocusableElements(container);
  if (els.length > 0) {
    els[0].focus();
    return true;
  }
  return false;
}

/**
 * Trap focus within a container. Returns a cleanup function.
 * @param {Element} container
 * @returns {Function} release function
 */
export function trapFocus(container) {
  function onKeyDown(e) {
    if (e.key !== "Tab") return;
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  container.addEventListener("keydown", onKeyDown);
  return () => container.removeEventListener("keydown", onKeyDown);
}

/**
 * Release a focus trap (alias for calling the cleanup returned by trapFocus).
 * @param {Function} cleanup
 */
export function releaseFocus(cleanup) {
  if (typeof cleanup === "function") cleanup();
}

/**
 * Return focus to `target` once an overlay has closed — unless focus moved on
 * while it was closing, or `target` has gone. `active` is
 * `document.activeElement` read before the overlay hid its panel (hiding it
 * drops focus to `body`): left on `body` or inside `root`, nobody took it.
 * Otherwise a slow exit animation would yank focus back from whatever the user
 * moved to in the meantime. A `target` that left the document, or sits under
 * `[hidden]` (an opener inside another overlay that has since closed), is
 * skipped too.
 * @param {Element} root
 * @param {Element|null} target
 * @param {Element|null} active
 */
export function returnFocus(root, target, active) {
  if (
    (!active || active === document.body || root.contains(active)) &&
    target?.isConnected &&
    !target.closest("[hidden]")
  ) target.focus?.();
}
