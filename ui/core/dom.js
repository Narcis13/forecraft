// @ui:core dom
// @ui:provides $ $$ closest create owns ownParts

/**
 * Query a single element within a scope.
 * @param {string} selector
 * @param {Element|Document} [scope=document]
 * @returns {Element|null}
 */
export const $ = (selector, scope = document) => scope.querySelector(selector);

/**
 * Query all matching elements within a scope.
 * @param {string} selector
 * @param {Element|Document} [scope=document]
 * @returns {Element[]}
 */
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Find the closest ancestor (or self) matching a selector.
 * @param {Element} el
 * @param {string} selector
 * @returns {Element|null}
 */
export const closest = (el, selector) => el.closest(selector);

/**
 * Create an element with attributes and children.
 * @param {string} tag
 * @param {Record<string, string>} [attrs={}]
 * @param {...(string|Node)} children
 * @returns {HTMLElement}
 */
export function create(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

/**
 * A part's owner: the nearest `[data-ui]` that is not a layout primitive an
 * author may wrap parts in (a dialog's close button inside a `cluster`, say).
 * `src/core-src/engine.js` §6 carries the same selector.
 */
const OWNER =
  "[data-ui]:not([data-ui=stack],[data-ui=cluster],[data-ui=grid],[data-ui=container],[data-ui=surface],[data-ui=switcher],[data-ui=aspect-ratio])";

/**
 * Does `root` own `el`? True when the nearest `[data-ui]` above `el`, looking
 * through layout primitives, is `root`. It starts from the parent because a part
 * can itself carry `data-ui` (`<button data-ui="button" data-part="close">`).
 * A part of a component nested inside `root` (a dropdown's trigger in a dialog)
 * is owned by that component, not by `root`.
 * @param {Element} root
 * @param {Element} el
 * @returns {boolean}
 */
export const owns = (root, el) => el.parentElement?.closest(OWNER) === root;

/**
 * Every `[data-part="{part}"]` inside `root` that `root` owns (see `owns`).
 * @param {Element} root
 * @param {string} part
 * @returns {Element[]}
 */
export const ownParts = (root, part) =>
  [...root.querySelectorAll(`[data-part='${part}']`)].filter((el) => owns(root, el));
