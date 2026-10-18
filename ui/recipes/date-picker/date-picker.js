// @ui:controller date-picker
// @ui:provides open close getValue setValue navigate selectDate destroy

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

  function syncInput(dateStr, dateObj) {
    input.value = formatDisplay(dateObj);
    input.dataset.value = dateStr;
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
    const parsed = new Date(dateStr + "T00:00:00");
    if (!isNaN(parsed.getTime())) {
      calendar.setValue(dateStr);
      syncInput(dateStr, parsed);
    }
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

  trigger?.addEventListener("click", onTriggerClick);
  root.addEventListener("faqir:calendar-change", onCalendarChange);
  root.addEventListener("keydown", onRootKeyDown);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close();
    trigger?.removeEventListener("click", onTriggerClick);
    root.removeEventListener("faqir:calendar-change", onCalendarChange);
    root.removeEventListener("keydown", onRootKeyDown);
    if (outsideClickCleanup) outsideClickCleanup();
    calendar.destroy();
    delete root._faqirDatePicker;
  }

  const api = { open, close, getValue, setValue, navigate, selectDate, destroy };
  root._faqirDatePicker = api;
  return api;
}
