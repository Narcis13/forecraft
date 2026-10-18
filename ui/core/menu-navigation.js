// @ui:core menu-navigation
// @ui:provides createMenuNavigation

const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const MENU_OWNER_SELECTOR = '[role="menu"], [role="menubar"]';

/**
 * Shared keyboard and focus navigation for menus and menubars.
 *
 * The helper deliberately owns movement only. Controllers remain responsible
 * for opening/closing popups and reflecting component state.
 *
 * @param {Element} container element carrying role=menu or role=menubar
 * @param {object} [options]
 * @param {"vertical"|"horizontal"} [options.orientation="vertical"]
 * @param {boolean} [options.roving=false] maintain one tabindex=0 item
 * @param {(item: Element, event: KeyboardEvent) => void} [options.onActivate]
 * @param {(event: KeyboardEvent) => void} [options.onEscape]
 * @param {(event: KeyboardEvent) => void} [options.onTab]
 */
export function createMenuNavigation(container, options = {}) {
  const horizontal = options.orientation === "horizontal";
  const roving = options.roving === true;
  const forwardKey = horizontal ? "ArrowRight" : "ArrowDown";
  const backwardKey = horizontal ? "ArrowLeft" : "ArrowUp";

  function candidates() {
    return [...container.querySelectorAll(MENU_ITEM_SELECTOR)].filter(
      (item) => item.closest(MENU_OWNER_SELECTOR) === container,
    );
  }

  // Native disabled controls cannot receive focus. aria-disabled menuitems stay
  // in the arrow sequence per the WAI-ARIA menu pattern; activation is blocked
  // separately below.
  function items() {
    return candidates().filter((item) => !item.disabled);
  }

  function current() {
    const all = items();
    const active = document.activeElement;
    if (all.includes(active)) return active;
    return roving ? all.find((item) => item.tabIndex === 0) || null : null;
  }

  function sync(preferred) {
    if (!roving) return preferred || current();

    const all = items();
    let active = all.includes(preferred) ? preferred : null;
    if (!active && all.includes(document.activeElement)) active = document.activeElement;
    if (!active) active = all.find((item) => item.tabIndex === 0) || all[0] || null;

    for (const item of candidates()) item.tabIndex = item === active ? 0 : -1;
    return active;
  }

  function focus(index) {
    const all = items();
    if (all.length === 0) return null;

    const item = all[((index % all.length) + all.length) % all.length];
    sync(item);
    item.focus();
    return item;
  }

  function currentIndex() {
    return items().indexOf(current());
  }

  function focusFirst() {
    return focus(0);
  }

  function focusLast() {
    return focus(items().length - 1);
  }

  function focusNext() {
    const index = currentIndex();
    return focus(index < 0 ? 0 : index + 1);
  }

  function focusPrevious() {
    const index = currentIndex();
    return focus(index < 0 ? items().length - 1 : index - 1);
  }

  function eventItem(event) {
    const item = event.target.closest?.(MENU_ITEM_SELECTOR);
    if (item?.closest(MENU_OWNER_SELECTOR) === container) return item;
    return event.target === container ? current() : null;
  }

  function onKeyDown(event) {
    // Nested menu events bubble through their parent menubar. Only the nearest
    // menu/menubar owns a menuitem's key handling. Escape and Tab still belong
    // to an empty menu, including legacy markup where the container lacks a role.
    const owner = event.target.closest?.(MENU_OWNER_SELECTOR);
    if (owner ? owner !== container : event.target !== container) return;

    if (event.key === "Escape" && options.onEscape) {
      event.preventDefault();
      // Escape DISMISSES ONE THING. Without stopping it here the same keystroke
      // reached every ancestor overlay: closing a dropdown inside a dialog
      // closed the dialog too, and with it whatever the user had typed. The
      // callback opts out by returning `false` — its way of saying "this
      // Escape was not mine", so it still reaches whatever encloses us. [W3-2]
      const handled = options.onEscape(event);
      if (handled !== false) event.stopPropagation();
      return;
    }
    if (event.key === "Tab" && options.onTab) {
      options.onTab(event);
      return;
    }

    const targetItem = eventItem(event);
    if (!targetItem) return;

    if (event.key === forwardKey) {
      event.preventDefault();
      focusNext();
      return;
    }
    if (event.key === backwardKey) {
      event.preventDefault();
      focusPrevious();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusFirst();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusLast();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (targetItem.getAttribute("aria-disabled") !== "true") {
        if (options.onActivate) options.onActivate(targetItem, event);
        else targetItem.click();
      }
    }
  }

  function onFocusIn(event) {
    const item = eventItem(event);
    if (item) sync(item);
  }

  container.addEventListener("keydown", onKeyDown);
  if (roving) container.addEventListener("focusin", onFocusIn);
  sync();

  function destroy() {
    container.removeEventListener("keydown", onKeyDown);
    if (roving) container.removeEventListener("focusin", onFocusIn);
  }

  return {
    items,
    current,
    sync,
    focus,
    focusFirst,
    focusLast,
    focusNext,
    focusPrevious,
    destroy,
  };
}
