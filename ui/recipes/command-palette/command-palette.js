// @ui:controller command-palette
// @ui:provides open close filter selectItem registerCommand destroy

import { trapFocus, returnFocus } from "../../core/focus.js";
import { uid } from "../../core/utils.js";

export function createCommandPalette(root) {
  // Prevent double-init
  if (root._faqirCommandPalette) return root._faqirCommandPalette;

  const overlay = root.querySelector("[data-part='overlay']");
  const panel = root.querySelector("[data-part='panel']");
  const searchInput = root.querySelector("[data-part='search']");
  const list = root.querySelector("[data-part='list']");
  const emptyEl = root.querySelector("[data-part='empty']");
  const items = () =>
    [...root.querySelectorAll("[data-part='item']")];
  const groups = () =>
    [...root.querySelectorAll("[data-part='group']")];

  let highlightedIndex = -1;
  let focusCleanup = null;
  let previouslyFocused = null;
  const registeredCommands = [];

  function open() {
    previouslyFocused = document.activeElement;
    root.dataset.state = "open";
    overlay.hidden = false;
    panel.hidden = false;

    // Reset search and highlights
    searchInput.value = "";
    filter("");
    clearHighlight();

    focusCleanup = trapFocus(panel);
    searchInput.focus();
  }

  /**
   * Everything `close()` does EXCEPT moving focus.
   *
   * `destroy()` used to leave an open overlay standing with nothing listening —
   * a dead widget the user cannot dismiss. Closing it on teardown is the fix
   * (`context-menu` is the model), but teardown must not also yank focus
   * somewhere: on an SPA route change the element it would restore to is
   * usually on its way out of the document. [W3-2]
   */
  function dismiss() {
    root.dataset.state = "closed";
    overlay.hidden = true;
    panel.hidden = true;
    // A closed palette must not still name an active item: `aria-activedescendant`
    // pointing into a hidden list is a reference a reader can follow to nothing. [W3-4]
    clearHighlight();

    if (focusCleanup) {
      focusCleanup();
      focusCleanup = null;
    }
  }

  function close() {
    const active = document.activeElement;
    dismiss();
    // The opener may have left with another overlay — the downstream palette
    // was opened from inside a dialog that closed underneath it.
    returnFocus(root, previouslyFocused, active);
  }

  /**
   * `aria-activedescendant` — the declared half of the combobox pattern. [W3-4]
   *
   * The search field publishes `role="combobox"` and `aria-autocomplete="list"`,
   * which obliges it to name the active item as the user arrows through the
   * results. Highlighting lived in `data-highlighted` alone and the items had no
   * `id`, so a screen-reader user heard nothing move. The axe gate cannot see
   * this — it reads static DOM, and the defect exists only mid-navigation.
   */
  function itemId(item) {
    if (!item.id) item.id = uid("faqir-command");
    return item.id;
  }

  function setActiveDescendant(item) {
    if (!searchInput) return;
    if (item) searchInput.setAttribute("aria-activedescendant", itemId(item));
    else searchInput.removeAttribute("aria-activedescendant");
  }

  function clearHighlight() {
    items().forEach((item) => {
      item.removeAttribute("data-highlighted");
      item.setAttribute("aria-selected", "false");
    });
    setActiveDescendant(null);
    highlightedIndex = -1;
  }

  function visibleItems() {
    return items().filter((item) => !item.hasAttribute("data-hidden"));
  }

  function highlightItem(index) {
    const visible = visibleItems();
    if (visible.length === 0) return;

    // Clamp index
    if (index < 0) index = visible.length - 1;
    if (index >= visible.length) index = 0;

    // Clear previous
    items().forEach((item) => {
      item.removeAttribute("data-highlighted");
      item.setAttribute("aria-selected", "false");
    });

    visible[index].setAttribute("data-highlighted", "");
    visible[index].setAttribute("aria-selected", "true");
    visible[index].scrollIntoView({ block: "nearest" });
    setActiveDescendant(visible[index]);
    highlightedIndex = index;
  }

  function filter(query) {
    const allItems = items();
    const allGroups = groups();
    const lowerQuery = query.toLowerCase();
    let totalVisible = 0;

    // Track visible items per group
    const groupVisibility = new Map();
    allGroups.forEach((g) => groupVisibility.set(g, 0));

    allItems.forEach((item) => {
      const label = item.querySelector("[data-part='item-label']");
      const text = (label || item).textContent.toLowerCase();

      if (text.includes(lowerQuery)) {
        item.removeAttribute("data-hidden");
        totalVisible++;
        // Find parent group
        const parentGroup = item.closest("[data-part='group']");
        if (parentGroup && groupVisibility.has(parentGroup)) {
          groupVisibility.set(parentGroup, groupVisibility.get(parentGroup) + 1);
        }
      } else {
        item.setAttribute("data-hidden", "");
      }
    });

    // Hide groups with no visible items
    allGroups.forEach((group) => {
      if (groupVisibility.get(group) === 0) {
        group.setAttribute("data-hidden", "");
      } else {
        group.removeAttribute("data-hidden");
      }
    });

    // Show/hide empty state
    if (emptyEl) {
      emptyEl.hidden = totalVisible > 0;
    }

    clearHighlight();

    return totalVisible;
  }

  function selectItem(index) {
    const visible = visibleItems();
    if (index < 0 || index >= visible.length) return;

    const item = visible[index];

    // Fire a custom event for the application to handle
    const event = new CustomEvent("command-select", {
      bubbles: true,
      detail: {
        item,
        label: item.querySelector("[data-part='item-label']")?.textContent || item.textContent
      }
    });
    root.dispatchEvent(event);

    // Check registered commands
    const label = (item.querySelector("[data-part='item-label']") || item).textContent.trim();
    const cmd = registeredCommands.find((c) => c.label === label);
    if (cmd?.action) cmd.action();

    close();
  }

  function registerCommand(cmd) {
    registeredCommands.push(cmd);
  }

  // ── Event Handlers ──

  function onSearchInput() {
    filter(searchInput.value);
  }

  function onSearchKeyDown(e) {
    const visible = visibleItems();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        highlightItem(highlightedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        highlightItem(highlightedIndex - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visible.length) {
          selectItem(highlightedIndex);
        }
        break;
      case "Escape":
        // The palette is an overlay in its own right: dismissing it must not
        // also dismiss whatever it was opened over. [W3-2]
        if (root.dataset.state === "open") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case "Home":
        if (visible.length > 0) {
          e.preventDefault();
          highlightItem(0);
        }
        break;
      case "End":
        if (visible.length > 0) {
          e.preventDefault();
          highlightItem(visible.length - 1);
        }
        break;
    }
  }

  function onOverlayClick() {
    close();
  }

  function onItemClick(e) {
    const item = e.target.closest("[data-part='item']");
    if (!item) return;

    const visible = visibleItems();
    const index = visible.indexOf(item);
    if (index >= 0) {
      selectItem(index);
    }
  }

  /**
   * Cmd/Ctrl+K — one owner per press.
   *
   * Every instance listens on `document`, so a page with three palettes used to
   * open three stacked focus traps. The first instance to act prevents default
   * and every later one (or one an app handler pre-empted) stands down;
   * `data-no-shortcut` opts an instance out entirely, read live, and a palette
   * whose root has left the document without `destroy()` (an SPA route change)
   * no longer claims the press from the live one. The key is
   * matched case-insensitively (Caps Lock sends "K"), falling back to the
   * physical key on a non-Latin layout; Shift is left alone because Cmd+Shift+K
   * is a browser and app chord of its own.
   */
  function onGlobalKeyDown(e) {
    if (e.defaultPrevented || !root.isConnected || root.hasAttribute("data-no-shortcut")) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat || e.isComposing) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "k" && (/^[a-z]$/.test(k) || e.code !== "KeyK")) return;
    e.preventDefault();
    if (root.dataset.state === "open") {
      close();
    } else {
      open();
    }
  }

  searchInput?.addEventListener("input", onSearchInput);
  searchInput?.addEventListener("keydown", onSearchKeyDown);
  overlay?.addEventListener("click", onOverlayClick);
  list?.addEventListener("click", onItemClick);
  document.addEventListener("keydown", onGlobalKeyDown);

  function destroy() {
    dismiss();
    searchInput?.removeEventListener("input", onSearchInput);
    searchInput?.removeEventListener("keydown", onSearchKeyDown);
    overlay?.removeEventListener("click", onOverlayClick);
    list?.removeEventListener("click", onItemClick);
    document.removeEventListener("keydown", onGlobalKeyDown);
    if (focusCleanup) focusCleanup();
    delete root._faqirCommandPalette;
  }

  const api = { open, close, filter, selectItem, registerCommand, destroy };
  root._faqirCommandPalette = api;
  return api;
}
