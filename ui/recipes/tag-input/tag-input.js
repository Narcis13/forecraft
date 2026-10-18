// @ui:controller tag-input
// @ui:provides getValue setValue addTag removeTag clear destroy

import { onOutsideClick } from "../../core/events.js";
import { uid } from "../../core/utils.js";

/**
 * tag-input — a multi-value text input that composes two existing recipes:
 *
 *   • CHIP (primitive) for each committed value — the tags are real
 *     `data-ui="chip"` elements, so they inherit chip.css verbatim (no
 *     duplicated styling) including the dismiss button.
 *   • COMBOBOX behaviour for the optional suggestions listbox — filter-as-you-
 *     type, Arrow/Enter selection, an empty state — mirroring the combobox
 *     recipe's listbox contract.
 *
 * Interaction contract:
 *   • Type + Enter commits the trimmed draft as a tag (unless it duplicates an
 *     existing tag and duplicates are disallowed, the default).
 *   • Backspace on an empty input removes the last tag.
 *   • The chip dismiss button (or the removeTag API) removes a specific tag.
 *   • With a suggestions listbox present, typing filters it; ArrowDown/ArrowUp
 *     highlight; Enter/click commits the highlighted/clicked suggestion.
 *
 * Value exposure:
 *   • getValue() returns the live tag array; setValue(arr) rebuilds the chips.
 *   • Every mutation dispatches `faqir:change` (detail.value = the array) and
 *     mirrors the array as JSON onto the hidden `[data-part="value"]` input,
 *     firing a native `input` event so `l-model` on that input stays in sync
 *     (parse it for the array; getValue()/the event carry the array directly).
 */
export function createTagInput(root) {
  // Prevent double-init.
  if (root._faqirTagInput) return root._faqirTagInput;

  const taglist = root.querySelector("[data-part='taglist']");
  const input = root.querySelector("[data-part='input']");
  const listbox = root.querySelector("[data-part='listbox']");
  const emptyEl = root.querySelector("[data-part='empty']");
  const valueEl = root.querySelector("[data-part='value']");
  const allowDuplicates = root.hasAttribute("data-allow-duplicates");

  const options = () =>
    listbox ? [...listbox.querySelectorAll("[data-part='option']")] : [];
  const visibleOptions = () => options().filter((o) => !o.hasAttribute("data-hidden"));

  let values = [];
  let highlightedIndex = -1;
  let outsideClickCleanup = null;

  // ── Chip rendering (reuses the chip primitive markup) ────────────────────────
  function makeChip(value) {
    const chip = document.createElement("span");
    chip.dataset.ui = "chip";
    chip.dataset.part = "tag";

    const label = document.createElement("span");
    label.dataset.part = "label";
    label.textContent = value;

    const dismiss = document.createElement("button");
    dismiss.dataset.part = "dismiss";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", `Remove ${value}`);
    dismiss.textContent = "×";

    chip.append(label, dismiss);
    return chip;
  }

  function readInitialTags() {
    if (!taglist) return [];
    return [...taglist.querySelectorAll("[data-part='tag'] [data-part='label']")].map(
      (l) => l.textContent.trim(),
    );
  }

  function isDuplicate(value) {
    const needle = value.toLowerCase();
    return values.some((v) => v.toLowerCase() === needle);
  }

  // ── value sync ───────────────────────────────────────────────────────────────
  function syncValueSeam() {
    if (!valueEl) return;
    const next = JSON.stringify(values);
    if (valueEl.value !== next) {
      valueEl.value = next;
      valueEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function emit(name, detail) {
    root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  function commitMutation(extraDetail) {
    syncValueSeam();
    emit("faqir:change", { value: values.slice(), ...extraDetail });
  }

  // ── add / remove ─────────────────────────────────────────────────────────────
  function addTag(raw) {
    const value = String(raw == null ? "" : raw).trim();
    if (!value) return false;
    if (!allowDuplicates && isDuplicate(value)) return false;

    values.push(value);
    if (taglist) {
      const chip = makeChip(value);
      if (input && input.parentNode === taglist) {
        taglist.insertBefore(chip, input);
      } else {
        taglist.appendChild(chip);
      }
    }
    commitMutation({ added: value });
    return true;
  }

  function removeTag(value) {
    const index = values.findIndex((v) => v === value);
    if (index < 0) return false;
    values.splice(index, 1);
    if (taglist) {
      const chip = [...taglist.querySelectorAll("[data-part='tag']")].find(
        (c) => c.querySelector("[data-part='label']")?.textContent.trim() === value,
      );
      chip?.remove();
    }
    commitMutation({ removed: value });
    return true;
  }

  function removeLast() {
    if (!values.length) return false;
    return removeTag(values[values.length - 1]);
  }

  function clear() {
    if (!values.length) return;
    values = [];
    if (taglist) {
      taglist.querySelectorAll("[data-part='tag']").forEach((c) => c.remove());
    }
    commitMutation({ cleared: true });
  }

  function getValue() {
    return values.slice();
  }

  function setValue(next) {
    const arr = Array.isArray(next) ? next : [];
    // Rebuild chips from scratch to mirror the requested value exactly.
    if (taglist) {
      taglist.querySelectorAll("[data-part='tag']").forEach((c) => c.remove());
    }
    values = [];
    for (const v of arr) {
      const value = String(v).trim();
      if (!value) continue;
      if (!allowDuplicates && isDuplicate(value)) continue;
      values.push(value);
      if (taglist) {
        const chip = makeChip(value);
        if (input && input.parentNode === taglist) taglist.insertBefore(chip, input);
        else taglist.appendChild(chip);
      }
    }
    commitMutation({ set: true });
  }

  // ── suggestions listbox (combobox behaviour) ─────────────────────────────────
  function openList() {
    if (!listbox) return;
    root.dataset.state = "open";
    listbox.hidden = false;
    input?.setAttribute("aria-expanded", "true");
    outsideClickCleanup = onOutsideClick(root, closeList);
  }

  function closeList() {
    if (!listbox) return;
    root.dataset.state = "closed";
    listbox.hidden = true;
    input?.setAttribute("aria-expanded", "false");
    clearHighlight();
    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  /**
   * `aria-activedescendant`, for the same reason as `combobox`: the field
   * publishes `role="combobox"` + `aria-autocomplete="list"`, so it owes the
   * reader the name of the active suggestion. [W3-4]
   */
  function optionId(opt) {
    if (!opt.id) opt.id = uid("faqir-suggestion");
    return opt.id;
  }

  function setActiveDescendant(opt) {
    if (!input) return;
    if (opt) input.setAttribute("aria-activedescendant", optionId(opt));
    else input.removeAttribute("aria-activedescendant");
  }

  function clearHighlight() {
    options().forEach((o) => o.removeAttribute("data-highlighted"));
    setActiveDescendant(null);
    highlightedIndex = -1;
  }

  function highlight(index) {
    const vis = visibleOptions();
    if (!vis.length) return;
    if (index < 0) index = vis.length - 1;
    if (index >= vis.length) index = 0;
    options().forEach((o) => o.removeAttribute("data-highlighted"));
    vis[index].setAttribute("data-highlighted", "");
    vis[index].scrollIntoView?.({ block: "nearest" });
    setActiveDescendant(vis[index]);
    highlightedIndex = index;
  }

  function filterSuggestions(query) {
    const q = query.toLowerCase();
    let count = 0;
    options().forEach((o) => {
      const text = o.textContent.toLowerCase();
      const alreadyChosen = !allowDuplicates && isDuplicate(o.textContent.trim());
      if (text.includes(q) && !alreadyChosen) {
        o.removeAttribute("data-hidden");
        count++;
      } else {
        o.setAttribute("data-hidden", "");
      }
    });
    if (emptyEl) emptyEl.hidden = count > 0;
    clearHighlight();
    return count;
  }

  // ── event handlers ───────────────────────────────────────────────────────────
  function onInput() {
    if (!listbox) return;
    if (root.dataset.state !== "open") openList();
    filterSuggestions(input.value);
  }

  function onInputKeyDown(e) {
    switch (e.key) {
      case "Enter": {
        e.preventDefault();
        const vis = visibleOptions();
        if (listbox && highlightedIndex >= 0 && highlightedIndex < vis.length) {
          if (addTag(vis[highlightedIndex].textContent.trim())) {
            input.value = "";
            filterSuggestions("");
          }
        } else if (input.value.trim()) {
          if (addTag(input.value)) {
            input.value = "";
            if (listbox) filterSuggestions("");
          }
        }
        break;
      }
      case "Backspace":
        if (input.value === "") {
          e.preventDefault();
          removeLast();
          if (listbox) filterSuggestions("");
        }
        break;
      case "ArrowDown":
        if (listbox) {
          e.preventDefault();
          if (root.dataset.state !== "open") openList();
          highlight(highlightedIndex + 1);
        }
        break;
      case "ArrowUp":
        if (listbox) {
          e.preventDefault();
          if (root.dataset.state !== "open") openList();
          highlight(highlightedIndex - 1);
        }
        break;
      case "Escape":
        if (listbox && root.dataset.state === "open") {
          e.preventDefault();
          // The suggestion list is what closes; the form around it stays. [W3-2]
          e.stopPropagation();
          closeList();
        }
        break;
    }
  }

  function onTaglistClick(e) {
    const dismiss = e.target.closest("[data-part='dismiss']");
    if (!dismiss) return;
    const chip = dismiss.closest("[data-part='tag']");
    const value = chip?.querySelector("[data-part='label']")?.textContent.trim();
    if (value != null) {
      removeTag(value);
      input?.focus();
    }
  }

  function onListboxClick(e) {
    const opt = e.target.closest("[data-part='option']");
    if (!opt || opt.hasAttribute("data-hidden")) return;
    if (addTag(opt.textContent.trim())) {
      if (input) input.value = "";
      filterSuggestions("");
      input?.focus();
    }
  }

  // ── wire up ──────────────────────────────────────────────────────────────────
  values = readInitialTags();
  syncValueSeam();

  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", onInputKeyDown);
  taglist?.addEventListener("click", onTaglistClick);
  listbox?.addEventListener("click", onListboxClick);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    closeList();
    input?.removeEventListener("input", onInput);
    input?.removeEventListener("keydown", onInputKeyDown);
    taglist?.removeEventListener("click", onTaglistClick);
    listbox?.removeEventListener("click", onListboxClick);
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirTagInput;
  }

  const api = { getValue, setValue, addTag, removeTag, clear, destroy };
  root._faqirTagInput = api;
  return api;
}
