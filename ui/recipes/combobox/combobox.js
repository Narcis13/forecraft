// @ui:controller combobox
// @ui:provides open close filter selectOption getValue setValue destroy

import { onOutsideClick } from "../../core/events.js";
import { uid } from "../../core/utils.js";

export function createCombobox(root) {
  // Prevent double-init
  if (root._faqirCombobox) return root._faqirCombobox;

  const input = root.querySelector("[data-part='input']");
  const listbox = root.querySelector("[data-part='listbox']");
  const emptyEl = root.querySelector("[data-part='empty']");
  const options = () =>
    [...root.querySelectorAll("[data-part='option']")];

  let highlightedIndex = -1;
  let outsideClickCleanup = null;
  let selectedValue = "";

  /**
   * `aria-activedescendant` — the half of the combobox pattern that was declared
   * and never implemented.  [W3-4]
   *
   * The markup publishes `role="combobox"` and `aria-autocomplete="list"`, which
   * is the APG contract: as the user arrows through the list, the combobox must
   * name the active option so a screen reader announces it. Highlighting was
   * tracked in `data-highlighted` alone and the options carried no `id`, so
   * there was nothing to point at and nothing was ever announced — the widget
   * claimed a pattern it did not implement. The axe gate structurally cannot see
   * this: it evaluates static DOM, and the defect exists only mid-navigation.
   *
   * Ids are minted on demand so authored ids are respected and generated markup
   * needs none.
   */
  function optionId(opt) {
    if (!opt.id) opt.id = uid("faqir-option");
    return opt.id;
  }

  function setActiveDescendant(opt) {
    if (opt) input.setAttribute("aria-activedescendant", optionId(opt));
    else input.removeAttribute("aria-activedescendant");
  }

  function open() {
    root.dataset.state = "open";
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");

    outsideClickCleanup = onOutsideClick(root, close);
  }

  function close() {
    root.dataset.state = "closed";
    listbox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    clearHighlight();

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  function clearHighlight() {
    const allOptions = options();
    allOptions.forEach((opt) => {
      opt.removeAttribute("data-highlighted");
      opt.setAttribute("aria-selected", "false");
    });
    setActiveDescendant(null);
    highlightedIndex = -1;
  }

  function highlightOption(index) {
    const allOptions = visibleOptions();
    if (allOptions.length === 0) return;

    // Clamp index
    if (index < 0) index = allOptions.length - 1;
    if (index >= allOptions.length) index = 0;

    // Clear previous
    options().forEach((opt) => {
      opt.removeAttribute("data-highlighted");
      opt.setAttribute("aria-selected", "false");
    });

    allOptions[index].setAttribute("data-highlighted", "");
    allOptions[index].setAttribute("aria-selected", "true");
    allOptions[index].scrollIntoView({ block: "nearest" });
    setActiveDescendant(allOptions[index]);
    highlightedIndex = index;
  }

  function visibleOptions() {
    return options().filter((opt) => !opt.hasAttribute("data-hidden"));
  }

  function filter(query) {
    const allOptions = options();
    const lowerQuery = query.toLowerCase();
    let visibleCount = 0;

    allOptions.forEach((opt) => {
      const text = opt.textContent.toLowerCase();
      if (text.includes(lowerQuery)) {
        opt.removeAttribute("data-hidden");
        visibleCount++;
      } else {
        opt.setAttribute("data-hidden", "");
      }
    });

    // Show/hide empty state
    if (emptyEl) {
      emptyEl.hidden = visibleCount > 0;
    }

    clearHighlight();

    return visibleCount;
  }

  function selectOption(index) {
    const visible = visibleOptions();
    if (index < 0 || index >= visible.length) return;

    const opt = visible[index];
    selectedValue = opt.textContent.trim();
    input.value = selectedValue;

    // Mark as selected
    options().forEach((o) => o.setAttribute("aria-selected", "false"));
    opt.setAttribute("aria-selected", "true");

    close();
  }

  function getValue() {
    return selectedValue;
  }

  function setValue(val) {
    selectedValue = val;
    input.value = val;
  }

  // ── Event Handlers ──

  function onInput() {
    const query = input.value;
    if (root.dataset.state !== "open") {
      open();
    }
    filter(query);
  }

  function onInputFocus() {
    if (root.dataset.state !== "open") {
      open();
    }
  }

  function onInputKeyDown(e) {
    const visible = visibleOptions();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (root.dataset.state !== "open") open();
        highlightOption(highlightedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (root.dataset.state !== "open") open();
        highlightOption(highlightedIndex - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visible.length) {
          selectOption(highlightedIndex);
        }
        break;
      case "Escape":
        // Only ours while the list is open; a closed combobox lets Escape reach
        // the dialog it sits in rather than swallowing it. [W3-2]
        if (root.dataset.state === "open") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case "Home":
        if (root.dataset.state === "open" && visible.length > 0) {
          e.preventDefault();
          highlightOption(0);
        }
        break;
      case "End":
        if (root.dataset.state === "open" && visible.length > 0) {
          e.preventDefault();
          highlightOption(visible.length - 1);
        }
        break;
    }
  }

  function onListboxClick(e) {
    const opt = e.target.closest("[data-part='option']");
    if (!opt) return;

    const visible = visibleOptions();
    const index = visible.indexOf(opt);
    if (index >= 0) {
      selectOption(index);
    }
  }

  input?.addEventListener("input", onInput);
  input?.addEventListener("focus", onInputFocus);
  input?.addEventListener("keydown", onInputKeyDown);
  listbox?.addEventListener("click", onListboxClick);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close();
    input?.removeEventListener("input", onInput);
    input?.removeEventListener("focus", onInputFocus);
    input?.removeEventListener("keydown", onInputKeyDown);
    listbox?.removeEventListener("click", onListboxClick);
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirCombobox;
  }

  const api = { open, close, filter, selectOption, getValue, setValue, destroy };
  root._faqirCombobox = api;
  return api;
}
