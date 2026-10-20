// @ui:controller date-picker
// @ui:provides open close getValue setValue clear navigate selectDate destroy

import { onOutsideClick } from "../../core/events.js";
import { createCalendar } from "../calendar/calendar.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function createDatePicker(root) {
  // Prevent double-init
  if (root._faqirDatePicker) return root._faqirDatePicker;

  const trigger = root.querySelector("[data-part='trigger']");
  const input = root.querySelector("[data-part='input']");
  const popup = root.querySelector("[data-part='calendar']");
  // The submitted value. The visible input shows "October 15, 2026"; a form
  // must send 2026-10-15, so a picker inside one carries a hidden input with
  // the field's `name`, and this controller keeps it holding the ISO date.
  // Optional: without it the picker works as before, the ISO date on
  // `input.dataset.value`.
  const valueInput = root.querySelector(":scope > [data-part='value']");

  // The month grid is the standalone `calendar` recipe. Canonical markup nests
  // [data-ui="calendar"] inside the popup; legacy flat markup (grid parts
  // directly inside the popup) still works — the popup itself then acts as the
  // calendar root.
  const calendarRoot = root.querySelector("[data-ui='calendar']") || popup;

  // `input` carries the value and the aria-expanded state, `popup` is what
  // opens; either one missing made every open()/close() throw. `trigger` is
  // optional — an input-only date picker opens from the field. [W3-2]
  if (!input || !popup) {
    console.warn(
      "[Faqir] date-picker needs [data-part='input'] and [data-part='calendar'] — " +
        `missing ${[!input && "input", !popup && "calendar"].filter(Boolean).join(" and ")}. ` +
        "Component left inert.",
      root
    );
    const inert = {
      open() {},
      close() {},
      getValue: () => null,
      setValue() {},
      clear() {},
      navigate() {},
      selectDate() {},
      destroy() {},
    };
    root._faqirDatePicker = inert;
    return inert;
  }
  const calendar = createCalendar(calendarRoot);

  const today = new Date();
  let outsideClickCleanup = null;

  function formatDisplay(date) {
    return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  // `dateObj` null is no date. The submitted value is announced the way typing
  // into a field would be — `input` then `change`, bubbling — so l-model,
  // faqir-validate and faqir-rules all see the new answer; not when it did not
  // change, and not on the `silent` sync at start-up.
  function syncInput(dateStr, dateObj, silent) {
    input.value = dateObj ? formatDisplay(dateObj) : "";
    input.dataset.value = dateStr;
    if (valueInput && valueInput.value !== dateStr) {
      valueInput.value = dateStr;
      if (!silent) {
        for (const type of ["input", "change"]) valueInput.dispatchEvent(new Event(type, { bubbles: true }));
      }
    }
  }

  function open() {
    root.dataset.state = "open";
    popup.hidden = false;
    input.setAttribute("aria-expanded", "true");

    // Focus the selected day, or the first of the current month
    const value = calendar.getValue();
    const target = value
      ? new Date(value + "T00:00:00")
      : new Date(today.getFullYear(), today.getMonth(), 1);
    calendar.focusDate(target);

    outsideClickCleanup = onOutsideClick(root, close);
  }

  function close() {
    root.dataset.state = "closed";
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  function selectDate(date) {
    // Delegates to the calendar; input update, close and the faqir:date-change
    // re-emit all happen in onCalendarChange.
    calendar.selectDate(date);
  }

  function getValue() {
    return calendar.getValue();
  }

  function setValue(dateStr) {
    show(dateStr);
  }

  function show(dateStr, silent) {
    const parsed = new Date(dateStr + "T00:00:00");
    if (!isNaN(parsed.getTime())) {
      calendar.setValue(dateStr);
      syncInput(dateStr, parsed, silent);
    }
  }

  // No date: the calendar, the visible input and the submitted value all empty.
  function clear() {
    calendar.clear();
    syncInput("", null);
  }

  function navigate(month, year) {
    calendar.navigate(month, year);
  }

  // Event: calendar selection committed
  function onCalendarChange(e) {
    if (!e.detail || !e.detail.date) return;
    syncInput(e.detail.date, e.detail.dateObj);
    close();
    input.focus();

    root.dispatchEvent(
      new CustomEvent("faqir:date-change", {
        detail: { date: e.detail.date, dateObj: e.detail.dateObj },
        bubbles: true,
      })
    );
  }

  // Event: trigger/input click
  function onTriggerClick() {
    if (root.dataset.state === "open") {
      close();
    } else {
      open();
    }
  }

  // Event: escape on root (bubbles up from the calendar grid too)
  function onRootKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      e.preventDefault();
      // Closing the calendar popup is the whole action — a date picker inside a
      // dialog must not take the dialog down with it. [W3-2]
      e.stopPropagation();
      close();
      input.focus();
    }
  }

  // Start-up: a value the server rendered into the hidden input is the
  // selection — the calendar shows it and the visible input reads it as a
  // person would. Silent: nothing changed.
  const initialValue = valueInput ? valueInput.value : "";
  if (initialValue) show(initialValue, true);

  // A form reset puts the visible input back to its default text but never
  // touches a hidden input, so the rendered value is restored here — after
  // the reset has run, since `reset` fires before it does.
  const form = valueInput && valueInput.form;
  let resetTimer;
  function onFormReset() {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (initialValue ? setValue(initialValue) : clear()));
  }

  trigger?.addEventListener("click", onTriggerClick);
  root.addEventListener("faqir:calendar-change", onCalendarChange);
  root.addEventListener("keydown", onRootKeyDown);
  form?.addEventListener("reset", onFormReset);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close();
    trigger?.removeEventListener("click", onTriggerClick);
    root.removeEventListener("faqir:calendar-change", onCalendarChange);
    root.removeEventListener("keydown", onRootKeyDown);
    form?.removeEventListener("reset", onFormReset);
    clearTimeout(resetTimer);
    if (outsideClickCleanup) outsideClickCleanup();
    calendar.destroy();
    delete root._faqirDatePicker;
  }

  const api = { open, close, getValue, setValue, clear, navigate, selectDate, destroy };
  root._faqirDatePicker = api;
  return api;
}
