// @ui:controller sidebar
// @ui:provides toggle expand collapse open close isMobile getState destroy

import { trapFocus, focusFirst } from "../../core/focus.js";
import { ownParts } from "../../core/dom.js";

/**
 * sidebar — a collapsible application sidebar with three modes:
 *
 *   • expanded — desktop, full-width with labels (default)
 *   • rail     — desktop, icons-only
 *   • drawer   — mobile, an off-canvas overlay panel (closed ↔ open)
 *
 * The single source of truth is `data-state` on the root; its value is one of
 * `expanded`, `rail`, `drawer` (mobile, closed) or `drawer-open` (mobile, open).
 * Agents can set the initial state declaratively — the controller reconciles it
 * with the current breakpoint on init.
 *
 * A `matchMedia` query (default `(max-width: 768px)`, overridable with
 * `data-breakpoint`) decides desktop vs mobile. `toggle()` is breakpoint-aware:
 * expanded ↔ rail on desktop, open ↔ close on mobile. The desktop preference
 * (expanded/rail) persists across a trip through the mobile breakpoint, so
 * resizing back to desktop restores what the user last chose.
 *
 * The mobile drawer is a proper modal surface: focus is trapped in the panel,
 * Escape and an overlay click close it, body scroll is locked while open, and
 * focus returns to whatever opened it. When the drawer is closed on mobile the
 * panel is `inert` + `aria-hidden`, so its links never sit in the tab order
 * off-screen. Every toggle button's `aria-expanded` tracks the live state.
 */
export function createSidebar(root) {
  // Prevent double-init.
  if (root._faqirSidebar) return root._faqirSidebar;

  const overlay = root.querySelector(":scope > [data-part='overlay']");
  const panel = root.querySelector(":scope > [data-part='panel']") || root;

  // Toggle buttons: the sidebar's own `[data-part='trigger']`s, plus external
  // triggers in the app shell that point at this sidebar by id. Both call
  // toggle(). A dropdown's trigger in the footer belongs to the dropdown: it
  // used to have its aria-expanded forced and its click rail the sidebar.
  const internalTriggers = ownParts(root, "trigger");
  const externalTriggers = root.id
    ? [...document.querySelectorAll(`[data-sidebar-toggle="${root.id}"]`)]
    : [];
  const triggers = [...internalTriggers, ...externalTriggers];

  // Persistent desktop preference (expanded ↔ rail) and mobile open flag, both
  // seeded from the declared data-state so the initial render is intent-preserving.
  const declared = root.dataset.state || "expanded";
  let desktopState = declared === "rail" ? "rail" : "expanded";
  let drawerOpen = declared === "drawer-open";

  // Responsive breakpoint. `data-breakpoint` is a max-width in px (default 768).
  const bp = (() => {
    const n = parseInt(root.dataset.breakpoint || "", 10);
    return Number.isFinite(n) && n > 0 ? n : 768;
  })();
  const query = `(max-width: ${bp}px)`;
  const mql =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query)
      : null;

  function isMobile() {
    return mql ? !!mql.matches : false;
  }

  // Modal bookkeeping for the mobile drawer.
  let focusCleanup = null;
  let previouslyFocused = null;
  let prevBodyOverflow = null;

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
  function releaseFocusTrap() {
    if (focusCleanup) focusCleanup();
    focusCleanup = null;
  }

  function getState() {
    return root.dataset.state || "";
  }

  /**
   * Reconcile every reflected attribute with the current model + breakpoint.
   * Pure DOM writes — never dispatches an event, so it is safe to call on init.
   */
  function render() {
    const mobile = isMobile();
    const state = mobile ? (drawerOpen ? "drawer-open" : "drawer") : desktopState;
    root.dataset.state = state;

    // Overlay only exists as a hit-target when the drawer is open.
    if (overlay) overlay.hidden = state !== "drawer-open";

    // Closed mobile drawer: keep the off-screen panel out of the tab order and
    // the a11y tree. Any other state is a live, interactive surface.
    if (panel && panel !== root) {
      if (state === "drawer") {
        panel.setAttribute("inert", "");
        panel.setAttribute("aria-hidden", "true");
      } else {
        panel.removeAttribute("inert");
        panel.removeAttribute("aria-hidden");
      }
    }

    // aria-expanded reflects "is the sidebar showing its content?": labels on
    // desktop, an open drawer on mobile.
    const expanded = mobile ? drawerOpen : desktopState === "expanded";
    for (const t of triggers) t.setAttribute("aria-expanded", String(expanded));
  }

  // ── Mobile drawer open/close ───────────────────────────────────────────────
  function open() {
    if (drawerOpen) return;
    previouslyFocused = document.activeElement;
    drawerOpen = true;
    render();
    lockScroll();
    focusCleanup = trapFocus(panel);
    if (!focusFirst(panel)) panel.focus?.();
  }

  function close() {
    if (!drawerOpen) return;
    drawerOpen = false;
    render();
    unlockScroll();
    releaseFocusTrap();
    previouslyFocused?.focus?.();
    previouslyFocused = null;
  }

  // ── Desktop expand/collapse ────────────────────────────────────────────────
  function expand() {
    desktopState = "expanded";
    render();
  }
  function collapse() {
    desktopState = "rail";
    render();
  }

  // ── Breakpoint-aware toggle ────────────────────────────────────────────────
  function toggle() {
    if (isMobile()) {
      drawerOpen ? close() : open();
    } else {
      desktopState === "expanded" ? collapse() : expand();
    }
  }

  // When the viewport crosses the breakpoint, tear down any live drawer modality
  // (a drawer left open as the window widens must not keep the scroll lock or the
  // focus trap) and re-render into the mode the new breakpoint calls for.
  function onMediaChange() {
    if (!isMobile() && drawerOpen) {
      drawerOpen = false;
      unlockScroll();
      releaseFocusTrap();
      previouslyFocused = null;
    }
    render();
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && isMobile() && drawerOpen) {
      e.stopPropagation();
      close();
    }
  }

  function onTriggerClick(e) {
    e.preventDefault();
    toggle();
  }

  function onOverlayClick() {
    close();
  }

  for (const t of triggers) t.addEventListener("click", onTriggerClick);
  overlay?.addEventListener("click", onOverlayClick);
  root.addEventListener("keydown", onKeyDown);
  if (mql) {
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", onMediaChange);
    else if (typeof mql.addListener === "function") mql.addListener(onMediaChange);
  }

  // Paint the reconciled initial state (no event).
  render();

  function destroy() {
    // A destroyed sidebar left mid-drawer is a dead overlay: the scrim still
    // covers the page, and its trigger, Escape and overlay click have all just
    // stopped working. Collapse the drawer first, without restoring focus —
    // teardown must not yank focus to an element on its way out. [W3-2]
    if (drawerOpen) {
      drawerOpen = false;
      render();
    }
    previouslyFocused = null;
    for (const t of triggers) t.removeEventListener("click", onTriggerClick);
    overlay?.removeEventListener("click", onOverlayClick);
    root.removeEventListener("keydown", onKeyDown);
    if (mql) {
      if (typeof mql.removeEventListener === "function") mql.removeEventListener("change", onMediaChange);
      else if (typeof mql.removeListener === "function") mql.removeListener(onMediaChange);
    }
    unlockScroll();
    releaseFocusTrap();
    delete root._faqirSidebar;
  }

  const api = { toggle, expand, collapse, open, close, isMobile, getState, destroy };
  root._faqirSidebar = api;
  return api;
}
