// @ui:controller calendar
// @ui:provides getValue setValue clear navigate selectDate focusDate setMin setMax setDisabledDates destroy

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function parseISO(str) {
  if (!str) return null;
  const d = new Date(str + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

export function createCalendar(root) {
  // Prevent double-init
  if (root._faqirCalendar) return root._faqirCalendar;

  const navPrev = root.querySelector("[data-part='nav-prev']");
  const navNext = root.querySelector("[data-part='nav-next']");
  const monthLabel = root.querySelector("[data-part='month-label']");
  const gridBody = root.querySelector("[data-part='grid-body']");

  // `grid-body` is the one part every render writes into: without it the first
  // `render()` throws on `gridBody.innerHTML`, taking the date-picker that
  // wraps it down with it. The optional parts (nav, month label) are already
  // guarded individually. [W3-2]
  if (!gridBody) {
    console.warn(
      "[Faqir] calendar needs [data-part='grid-body'] to render into. " +
        "Component left inert.",
      root
    );
    const inert = {
      getValue: () => null,
      setValue() {},
      clear() {},
      navigate() {},
      selectDate() {},
      focusDate() {},
      setMin() {},
      setMax() {},
      setDisabledDates() {},
      destroy() {},
    };
    root._faqirCalendar = inert;
    return inert;
  }

  const today = new Date();
  const mode = root.dataset.mode === "range" ? "range" : "single";

  let minDate = parseISO(root.dataset.min);
  let maxDate = parseISO(root.dataset.max);
  let disabledDates = parseDateList(root.dataset.disabledDates);

  let selectedDate = null;
  let rangeStart = null;
  let rangeEnd = null;
  if (root.dataset.value) {
    if (mode === "range") {
      const parts = root.dataset.value.split(",");
      rangeStart = parseISO(parts[0] && parts[0].trim());
      rangeEnd = parseISO(parts[1] && parts[1].trim());
    } else {
      selectedDate = parseISO(root.dataset.value);
    }
  }

  const initialView = selectedDate || rangeStart || today;
  let viewMonth = initialView.getMonth();
  let viewYear = initialView.getFullYear();
  let focusedDate = null;

  function parseDateList(str) {
    const set = new Set();
    if (str) {
      for (const token of str.split(/[\s,]+/)) {
        if (parseISO(token)) set.add(token);
      }
    }
    return set;
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatAriaLabel(date) {
    return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  function isSameDay(a, b) {
    if (!a || !b) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function isToday(date) {
    return isSameDay(date, today);
  }

  function isDisabled(date) {
    if (minDate && date.getTime() < minDate.getTime()) return true;
    if (maxDate && date.getTime() > maxDate.getTime()) return true;
    return disabledDates.has(formatDate(date));
  }

  function clampToRange(date) {
    if (minDate && date.getTime() < minDate.getTime()) return new Date(minDate);
    if (maxDate && date.getTime() > maxDate.getTime()) return new Date(maxDate);
    return date;
  }

  function buildGrid() {
    // First day of the displayed month
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDow = firstDay.getDay(); // 0=Sun

    // Last day of the displayed month
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const totalDays = lastDay.getDate();

    // Previous month trailing days
    const prevMonthLast = new Date(viewYear, viewMonth, 0);
    const prevMonthDays = prevMonthLast.getDate();

    // Update label
    if (monthLabel) monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    // A whole adjacent month out of bounds means its nav button is a dead end
    if (navPrev) navPrev.disabled = !!(minDate && prevMonthLast.getTime() < minDate.getTime());
    if (navNext) navNext.disabled = !!(maxDate && new Date(viewYear, viewMonth + 1, 1).getTime() > maxDate.getTime());

    // Clear existing
    gridBody.innerHTML = "";

    let dayCount = 1;
    let nextMonthDay = 1;
    const totalCells = Math.ceil((startDow + totalDays) / 7) * 7;
    let row = null;

    for (let i = 0; i < totalCells; i++) {
      // Start a new row every 7 cells
      if (i % 7 === 0) {
        row = document.createElement("tr");
        gridBody.appendChild(row);
      }

      const td = document.createElement("td");
      const btn = document.createElement("button");
      btn.setAttribute("data-part", "day");
      btn.type = "button";

      let date;
      let isOutside = false;

      if (i < startDow) {
        // Previous month
        const day = prevMonthDays - startDow + 1 + i;
        date = new Date(viewYear, viewMonth - 1, day);
        btn.textContent = day;
        isOutside = true;
      } else if (dayCount <= totalDays) {
        // Current month
        date = new Date(viewYear, viewMonth, dayCount);
        btn.textContent = dayCount;
        dayCount++;
      } else {
        // Next month
        date = new Date(viewYear, viewMonth + 1, nextMonthDay);
        btn.textContent = nextMonthDay;
        nextMonthDay++;
        isOutside = true;
      }

      btn.dataset.date = formatDate(date);
      btn.setAttribute("aria-label", formatAriaLabel(date));

      if (isOutside) {
        btn.dataset.outside = "true";
      }

      if (isToday(date)) {
        btn.dataset.today = "true";
      }

      if (isDisabled(date)) {
        // aria-disabled (not the native attribute) keeps the cell reachable by
        // the roving tabindex while blocking selection
        btn.setAttribute("aria-disabled", "true");
        btn.dataset.disabled = "true";
      }

      if (mode === "range") {
        if (isSameDay(date, rangeStart)) {
          btn.dataset.state = "range-start";
          btn.setAttribute("aria-selected", "true");
        } else if (isSameDay(date, rangeEnd)) {
          btn.dataset.state = "range-end";
          btn.setAttribute("aria-selected", "true");
        } else if (
          rangeStart && rangeEnd &&
          date.getTime() > rangeStart.getTime() &&
          date.getTime() < rangeEnd.getTime()
        ) {
          btn.dataset.state = "in-range";
        }
      } else if (isSameDay(date, selectedDate)) {
        btn.setAttribute("aria-selected", "true");
      }

      if (isSameDay(date, focusedDate)) {
        btn.tabIndex = 0;
      } else {
        btn.tabIndex = -1;
      }

      td.appendChild(btn);
      row.appendChild(td);
    }

    // If no focused date set, make the selected or first-of-month focusable
    if (!focusedDate) {
      const anchor = mode === "range" ? rangeStart : selectedDate;
      const defaultFocusDate = anchor &&
        anchor.getMonth() === viewMonth && anchor.getFullYear() === viewYear
        ? anchor
        : new Date(viewYear, viewMonth, 1);
      const defaultBtn = gridBody.querySelector(
        `[data-date="${formatDate(defaultFocusDate)}"]`
      );
      if (defaultBtn) defaultBtn.tabIndex = 0;
    }
  }

  function dayButton(date) {
    return gridBody.querySelector(`[data-date="${formatDate(date)}"]`);
  }

  function focusDate(date) {
    const target = clampToRange(new Date(date));
    focusedDate = target;

    if (target.getMonth() !== viewMonth || target.getFullYear() !== viewYear) {
      viewMonth = target.getMonth();
      viewYear = target.getFullYear();
      buildGrid();
    } else {
      // Update roving tabindex in the current grid
      gridBody.querySelectorAll("[data-part='day']").forEach((btn) => {
        btn.tabIndex = -1;
      });
      const btn = dayButton(target);
      if (btn) btn.tabIndex = 0;
    }

    const btn = dayButton(target);
    if (btn) btn.focus();
  }

  function moveFocus(days) {
    if (!focusedDate) return;
    const next = new Date(focusedDate);
    next.setDate(next.getDate() + days);
    focusDate(next);
  }

  /** Move focus ±N months (PageUp/Down), clamping the day to the target month's length. */
  function moveFocusMonths(months) {
    if (!focusedDate) return;
    const target = new Date(focusedDate.getFullYear(), focusedDate.getMonth() + months, 1);
    const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(focusedDate.getDate(), daysInTarget));
    focusDate(target);
  }

  function selectDate(date) {
    const chosen = new Date(date);
    if (isDisabled(chosen)) return;

    // buildGrid() replaces the focused button — restore focus before emitting,
    // so change listeners (e.g. date-picker closing the popup) keep the final
    // word on where focus lands.
    const hadFocus = root.contains(document.activeElement);
    focusedDate = chosen;

    let detail = null;

    if (mode === "range") {
      if (!rangeStart || rangeEnd || chosen.getTime() < rangeStart.getTime()) {
        // First click, restart after a complete range, or backwards pick
        rangeStart = chosen;
        rangeEnd = null;
      } else {
        rangeEnd = chosen;
        detail = {
          start: formatDate(rangeStart),
          end: formatDate(rangeEnd),
          startObj: new Date(rangeStart),
          endObj: new Date(rangeEnd),
        };
      }
    } else {
      selectedDate = chosen;
      detail = { date: formatDate(selectedDate), dateObj: new Date(selectedDate) };
    }

    buildGrid();

    if (hadFocus) {
      const btn = dayButton(chosen);
      if (btn) btn.focus();
    }

    if (detail) {
      root.dispatchEvent(
        new CustomEvent("faqir:calendar-change", { detail, bubbles: true })
      );
    }
  }

  function getValue() {
    if (mode === "range") {
      return {
        start: rangeStart ? formatDate(rangeStart) : null,
        end: rangeEnd ? formatDate(rangeEnd) : null,
      };
    }
    return selectedDate ? formatDate(selectedDate) : null;
  }

  /** Silent set — updates selection and view without emitting a change event. */
  function setValue(value) {
    if (mode === "range") {
      const parts = String(value).split(",");
      const start = parseISO(parts[0] && parts[0].trim());
      const end = parseISO(parts[1] && parts[1].trim());
      if (!start) return;
      rangeStart = start;
      rangeEnd = end && end.getTime() >= start.getTime() ? end : null;
      viewMonth = start.getMonth();
      viewYear = start.getFullYear();
      buildGrid();
      return;
    }

    const parsed = parseISO(value);
    if (!parsed) return;
    selectedDate = parsed;
    viewMonth = parsed.getMonth();
    viewYear = parsed.getFullYear();
    buildGrid();
  }

  function clear() {
    selectedDate = null;
    rangeStart = null;
    rangeEnd = null;
    buildGrid();
  }

  function navigate(month, year) {
    viewMonth = month;
    viewYear = year;
    focusedDate = new Date(viewYear, viewMonth, 1);
    buildGrid();

    const btn = dayButton(focusedDate);
    if (btn) btn.focus();
  }

  function setMin(value) {
    minDate = parseISO(value);
    buildGrid();
  }

  function setMax(value) {
    maxDate = parseISO(value);
    buildGrid();
  }

  function setDisabledDates(list) {
    disabledDates = parseDateList(Array.isArray(list) ? list.join(",") : list);
    buildGrid();
  }

  /** Show an adjacent month without moving DOM focus (nav-button clicks). */
  function shiftView(delta) {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    } else if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    focusedDate = clampToRange(new Date(viewYear, viewMonth, 1));
    buildGrid();
  }

  function onPrevClick() {
    shiftView(-1);
  }

  function onNextClick() {
    shiftView(1);
  }

  function onGridClick(e) {
    const dayBtn = e.target.closest("[data-part='day']");
    if (dayBtn && dayBtn.dataset.date && dayBtn.getAttribute("aria-disabled") !== "true") {
      selectDate(parseISO(dayBtn.dataset.date));
    }
  }

  function onKeyDown(e) {
    // Grid navigation only applies while a day cell has focus
    const dayBtn = e.target.closest ? e.target.closest("[data-part='day']") : null;
    if (!dayBtn) return;

    if (dayBtn.dataset.date && !isSameDay(focusedDate, parseISO(dayBtn.dataset.date))) {
      focusedDate = parseISO(dayBtn.dataset.date);
    }

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-7);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(7);
        break;
      case "Home":
        e.preventDefault();
        if (focusedDate) moveFocus(-focusedDate.getDay());
        break;
      case "End":
        e.preventDefault();
        if (focusedDate) moveFocus(6 - focusedDate.getDay());
        break;
      case "PageUp":
        e.preventDefault();
        if (e.shiftKey) {
          moveFocusMonths(-12);
        } else {
          moveFocusMonths(-1);
        }
        break;
      case "PageDown":
        e.preventDefault();
        if (e.shiftKey) {
          moveFocusMonths(12);
        } else {
          moveFocusMonths(1);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (focusedDate) selectDate(focusedDate);
        break;
    }
  }

  navPrev?.addEventListener("click", onPrevClick);
  navNext?.addEventListener("click", onNextClick);
  gridBody?.addEventListener("click", onGridClick);
  root.addEventListener("keydown", onKeyDown);

  buildGrid();

  function destroy() {
    navPrev?.removeEventListener("click", onPrevClick);
    navNext?.removeEventListener("click", onNextClick);
    gridBody?.removeEventListener("click", onGridClick);
    root.removeEventListener("keydown", onKeyDown);
    delete root._faqirCalendar;
  }

  const api = {
    getValue,
    setValue,
    clear,
    navigate,
    selectDate,
    focusDate,
    setMin,
    setMax,
    setDisabledDates,
    destroy,
  };
  root._faqirCalendar = api;
  return api;
}
