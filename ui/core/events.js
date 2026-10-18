// @ui:core events
// @ui:provides delegate once onOutsideClick

/**
 * Delegate an event to descendants matching a selector.
 * @param {Element} root
 * @param {string} event
 * @param {string} selector
 * @param {Function} handler
 * @returns {Function} cleanup function
 */
export function delegate(root, event, selector, handler) {
  function listener(e) {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) {
      handler(e, target);
    }
  }
  root.addEventListener(event, listener);
  return () => root.removeEventListener(event, listener);
}

/**
 * Listen for an event once, then auto-remove.
 * @param {Element} el
 * @param {string} event
 * @param {Function} handler
 * @returns {Function} cleanup function (cancels if not yet fired)
 */
export function once(el, event, handler) {
  function listener(e) {
    cleanup();
    handler(e);
  }
  function cleanup() {
    el.removeEventListener(event, listener);
  }
  el.addEventListener(event, listener);
  return cleanup;
}

/**
 * Call handler when a click occurs outside the given element.
 * @param {Element} el
 * @param {Function} handler
 * @returns {Function} cleanup function
 */
export function onOutsideClick(el, handler) {
  function listener(e) {
    if (!el.contains(e.target)) {
      handler(e);
    }
  }
  document.addEventListener("pointerdown", listener);
  return () => document.removeEventListener("pointerdown", listener);
}
