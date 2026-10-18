// @ui:controller table
// @ui:provides sort sortBy clearSort selectRow selectAll deselectAll getSelected getSelectedData setFilter setColumnFilter clearFilters toggleGroup toggleRow toggleDetail expandAll collapseAll startEdit commitEdit cancelEdit moveRow moveColumn hideColumn showColumn toggleColumn setColumnWidth exportCsv getData getState setState refresh destroy

/**
 * Advanced data table controller.
 *
 * Everything beyond the base contract (sort / select) is opt-in through data
 * attributes on the root, so a plain table pays for nothing:
 *
 *   data-multi-sort          shift+click accumulates secondary sorts
 *   data-sort-cycle="tristate"  third header click restores original order
 *   data-selectable[="single|multi"]  row click (de)selects; default multi
 *   data-editable            inline cell editing (dblclick / Enter / F2)
 *   data-tree                tree table driven by tr[data-level] depths
 *   data-groupable           group-header rows collapse/expand their section
 *   data-reorderable         drag rows via [data-part="drag-handle"] (+ arrows)
 *   data-col-reorderable     drag column headers to rearrange columns
 *   data-resizable           column resize handles on headers
 *   data-sticky-header / data-sticky-footer   sticky thead/tfoot in a scroll root
 *   data-navigable           roving-focus grid keyboard navigation (implied by data-editable)
 *   data-responsive="stack"  stacked card layout under the container breakpoint
 *   data-persist="key"       persist sort/filter/width/visibility to localStorage
 *   data-locale / data-currency / data-negatives="red|parens|both"  Intl formatting
 *
 * Column headers (th) may carry: data-sortable, data-type, data-format,
 * data-align, data-editable, data-readonly, data-pin="start|end",
 * data-hide-below="sm|md|lg", data-key, data-min-width, data-max-width.
 * Cells (td) may carry: data-value (raw), data-sort-value, data-format,
 * data-align, data-editable, data-readonly, data-aggregate="sum|avg|min|max|count",
 * data-col (explicit column for aggregate cells with colspan).
 *
 * Runtime state the controller manages: data-selected, data-collapsed,
 * data-filtered, data-editing, data-dragging, data-drop-target/-pos,
 * data-col-hidden, data-negative, data-stripe, data-resized, aria-sort,
 * aria-expanded, aria-level plus the --table-level / --table-pin-offset /
 * --table-thead-h
 * private custom properties.
 *
 * Events (CustomEvent, bubbling): faqir:sort, faqir:selection-change,
 * faqir:filter, faqir:edit-start, faqir:cell-edit, faqir:edit-cancel,
 * faqir:row-reorder, faqir:col-reorder, faqir:col-resize, faqir:group-toggle,
 * faqir:tree-toggle, faqir:row-expand, faqir:col-visibility.
 */
export function createTable(root) {
  // Prevent double-init
  if (root._faqirTable) return root._faqirTable;

  // A table nested in a detail row keeps its own parts and events: `tbody`
  // contains it, so every deep lookup and delegated handler checks `mine`.
  const mine = (el) => el.closest("[data-ui='table']") === root;
  const table = root.querySelector("[data-part='table']");
  const thead = root.querySelector("[data-part='thead']");
  const tbody = root.querySelector("[data-part='tbody']");
  const tfoot = [...root.querySelectorAll("[data-part='tfoot']")].find(mine);
  const headerCheckbox = thead?.querySelector("[data-part='checkbox']");

  // ── Options (read once from the root's opt-in attributes) ──
  const opts = {
    multiSort: root.hasAttribute("data-multi-sort"),
    sortCycle: root.getAttribute("data-sort-cycle") || "toggle",
    editable: root.hasAttribute("data-editable"),
    tree: root.hasAttribute("data-tree"),
    groupable: root.hasAttribute("data-groupable"),
    reorderable: root.hasAttribute("data-reorderable"),
    colReorderable: root.hasAttribute("data-col-reorderable"),
    resizable: root.hasAttribute("data-resizable"),
    selectable: root.getAttribute("data-selectable"), // null | "" | "single" | "multi"
    navigable: root.hasAttribute("data-navigable") || root.hasAttribute("data-editable"),
    responsive: root.getAttribute("data-responsive") || "",
    persistKey: root.getAttribute("data-persist") || "",
    locale: root.getAttribute("data-locale") || document.documentElement.lang || undefined,
    currency: root.getAttribute("data-currency") || "USD",
    negatives: root.getAttribute("data-negatives") || "",
  };
  const accounting = opts.negatives === "parens" || opts.negatives === "both";
  const isRTL = (root.closest("[dir]")?.getAttribute("dir") || "").toLowerCase() === "rtl";

  // ── Internal state ──
  let sorts = []; // [{ index, dir: "ascending"|"descending" }]
  let hasSorted = false;
  let globalFilter = "";
  const columnFilters = new Map(); // colIndex -> string | (raw, cell, row) => boolean
  let lastSelectedIndex = -1;
  let editing = null; // { cell, row, input, oldText, oldValue, colIndex, type }
  let activeCell = null; // roving-tabindex focus target
  let drag = null; // active pointer drag (rows / columns / resize)
  let suppressClickUntil = 0;
  let muted = false; // silences emit() during setState/expandAll
  let observer = null;
  let observerPaused = 0;
  let refreshQueued = false;
  const timers = new Set();
  const cleanups = [];
  const colTypeCache = new Map();
  const originalIndex = new WeakMap();
  let originSeq = 0;

  const collator = new Intl.Collator(opts.locale, { numeric: true, sensitivity: "base" });

  // ── Tiny helpers ──
  const toggleAttr = (el, name, on) => (on ? el.setAttribute(name, "") : el.removeAttribute(name));
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const on = (target, ev, fn, o) => {
    target.addEventListener(ev, fn, o);
    cleanups.push(() => target.removeEventListener(ev, fn, o));
  };

  function emit(type, detail) {
    if (muted) return;
    root.dispatchEvent(new CustomEvent("faqir:" + type, { bubbles: true, detail }));
  }
  function mutedRun(fn) {
    const was = muted;
    muted = true;
    try {
      fn();
    } finally {
      muted = was;
    }
  }

  // ── Row / cell access ──
  const rowsIn = (section, part = "tr") =>
    section ? [...section.children].filter((r) => r.getAttribute("data-part") === part) : [];
  const bodyRows = () => rowsIn(tbody);
  const groupHeaders = () => rowsIn(tbody, "group-header");
  const cellsOf = (row) =>
    [...row.children].filter((c) => {
      const p = c.getAttribute("data-part");
      return p === "td" || p === "th";
    });
  const detailOf = (row) => {
    const n = row.nextElementSibling;
    return n && n.getAttribute("data-part") === "detail-row" ? n : null;
  };
  const isRowVisible = (r) =>
    !r.hasAttribute("data-collapsed") && !r.hasAttribute("data-filtered") && !r.hasAttribute("hidden");
  const visibleBodyRows = () => bodyRows().filter(isRowVisible);

  function headerRowEl() {
    const trs = rowsIn(thead).filter((r) =>
      cellsOf(r).some((c) => c.getAttribute("data-part") === "th")
    );
    return trs[trs.length - 1] || null; // leaf row of (possibly grouped) headers
  }
  const headerCells = () => (headerRowEl() ? cellsOf(headerRowEl()) : []);
  const columnCount = () => headerCells().length;
  const filterRowEl = () => (thead ? rowsIn(thead, "filter-row")[0] || null : null);
  const sortableHeaders = () => headerCells().filter((th) => th.hasAttribute("data-sortable"));

  function headerText(i) {
    const th = headerCells()[i];
    if (!th) return "";
    const clone = th.cloneNode(true);
    for (const junk of clone.querySelectorAll("[data-part='resize-handle'],[data-part='checkbox'],input,button")) {
      junk.remove();
    }
    return (clone.textContent || "").trim();
  }

  /** Every row that has one cell per column (skips colspan rows like group headers). */
  function fullWidthRows() {
    const n = columnCount();
    const out = [];
    const fr = filterRowEl();
    if (headerRowEl()) out.push(headerRowEl());
    if (fr) out.push(fr);
    for (const r of [...bodyRows(), ...rowsIn(tfoot)]) out.push(r);
    return out.filter((r) => cellsOf(r).length === n);
  }
  function forEachColumnCell(i, fn) {
    for (const row of fullWidthRows()) {
      const cell = cellsOf(row)[i];
      if (cell) fn(cell, row);
    }
  }

  // ── Value parsing ──
  const NBSP = /[\u00a0\u202f]/g;
  /** Numeric parse tolerant of currency symbols, thousands separators, and accounting parens. */
  function parseNumeric(str) {
    if (str == null) return NaN;
    let s = String(str).replace(NBSP, " ").trim();
    if (!s) return NaN;
    let negative = false;
    const paren = s.match(/^\((.*)\)$/);
    if (paren) {
      negative = true;
      s = paren[1];
    }
    s = s.replace(/[^0-9.,-]/g, "");
    if (!s) return NaN;
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      // Rightmost separator is the decimal mark; the other groups thousands.
      s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (lastComma >= 0) {
      const parts = s.split(",");
      s = parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2
        ? s.replace(",", ".") // "0,5" → decimal comma
        : s.replace(/,/g, ""); // "1,234,567" → thousands
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, ""); // "1.234.567" → dot-grouped thousands
    }
    const n = parseFloat(s);
    return isNaN(n) ? NaN : negative ? -n : n;
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;
  /** Timestamp for ISO dates and dd/mm/yyyy (or dd.mm.yyyy) strings; NaN otherwise. */
  function parseDateValue(str) {
    const s = String(str == null ? "" : str).trim();
    if (!s) return NaN;
    if (ISO_DATE.test(s)) {
      const t = Date.parse(s.length === 10 ? s + "T00:00:00Z" : s);
      return isNaN(t) ? NaN : t;
    }
    const m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return NaN;
  }

  const cellRaw = (cell) =>
    cell.hasAttribute("data-value")
      ? cell.getAttribute("data-value")
      : (cell.textContent || "").trim();
  const sortRaw = (cell) =>
    cell.hasAttribute("data-sort-value") ? cell.getAttribute("data-sort-value") : cellRaw(cell);

  const NUMERIC_TYPES = { number: 1, currency: 1, percent: 1 };
  const isNumericType = (t) => !!NUMERIC_TYPES[t];

  /** Column type: explicit th data-type / data-format, else sniffed from cells. */
  function columnType(i) {
    if (colTypeCache.has(i)) return colTypeCache.get(i);
    let type = "";
    const th = headerCells()[i];
    type = th?.getAttribute("data-type") || th?.getAttribute("data-format") || "";
    if (!type) {
      let sawAny = false;
      let allNum = true;
      let allDate = true;
      for (const row of bodyRows().slice(0, 25)) {
        const cell = cellsOf(row)[i];
        if (!cell) continue;
        const cf = cell.getAttribute("data-format");
        if (cf) {
          type = cf;
          break;
        }
        const raw = sortRaw(cell);
        if (!raw) continue;
        sawAny = true;
        if (isNaN(parseDateValue(raw))) allDate = false;
        if (isNaN(parseNumeric(raw))) allNum = false;
        if (!allNum && !allDate) break;
      }
      if (!type) type = sawAny && allDate ? "date" : sawAny && allNum ? "number" : "text";
    }
    colTypeCache.set(i, type);
    return type;
  }

  // ── Intl formatting ──
  function formatValue(n, fmt) {
    const o =
      fmt === "currency"
        ? { style: fmt, currency: opts.currency, currencySign: accounting ? "accounting" : "standard" }
        : fmt === "percent"
          ? { style: fmt, maximumFractionDigits: 2 }
          : fmt === "number" && { maximumFractionDigits: 2 };
    try {
      if (o) return new Intl.NumberFormat(opts.locale, o).format(fmt === "percent" ? n / 100 : n);
    } catch {
      /* unknown locale/currency — fall through to raw */
    }
    return String(n);
  }

  function applyNegativeFlag(cell) {
    const fmt = cell.getAttribute("data-format");
    if (!fmt || !isNumericType(fmt)) return;
    const n = parseNumeric(cellRaw(cell));
    toggleAttr(cell, "data-negative", !isNaN(n) && n < 0);
  }

  /** Cells carrying both data-value and data-format render through Intl; text-only cells are never rewritten. */
  function formatCell(cell) {
    if (cell.hasAttribute("data-editing")) return;
    const fmt = cell.getAttribute("data-format");
    if (!fmt) return;
    if (cell.hasAttribute("data-value")) {
      const raw = cell.getAttribute("data-value");
      if (fmt === "date") {
        const t = parseDateValue(raw);
        if (!isNaN(t)) cell.textContent = new Date(t).toLocaleDateString(opts.locale);
      } else if (isNumericType(fmt)) {
        const n = parseNumeric(raw);
        if (!isNaN(n)) cell.textContent = formatValue(n, fmt);
      }
    }
    applyNegativeFlag(cell);
  }

  function applyFormats() {
    for (const row of [...bodyRows(), ...rowsIn(tfoot)]) {
      for (const cell of cellsOf(row)) formatCell(cell);
    }
  }

  // ── Tree helpers ──
  const levelOf = (r) => {
    const v = parseInt(r.getAttribute("data-level") || "0", 10);
    return isNaN(v) ? 0 : v;
  };
  /** Descendant data rows of a tree row (detail rows excluded; group headers terminate). */
  function subtreeRows(row) {
    const out = [];
    const lvl = levelOf(row);
    let n = row.nextElementSibling;
    while (n) {
      const p = n.getAttribute("data-part");
      if (p === "group-header") break;
      if (p === "tr") {
        if (levelOf(n) <= lvl) break;
        out.push(n);
      }
      n = n.nextElementSibling;
    }
    return out;
  }
  const childrenOf = (row) => subtreeRows(row).filter((r) => levelOf(r) === levelOf(row) + 1);
  function parentOf(row) {
    const lvl = levelOf(row);
    if (lvl <= 0) return null;
    let n = row.previousElementSibling;
    while (n) {
      if (n.getAttribute("data-part") === "tr" && levelOf(n) < lvl) return n;
      n = n.previousElementSibling;
    }
    return null;
  }
  function ancestorsOf(row) {
    const out = [];
    let p = parentOf(row);
    while (p) {
      out.push(p);
      p = parentOf(p);
    }
    return out;
  }
  const isTreeParent = (row) => opts.tree && childrenOf(row).length > 0;

  // ── Group helpers ──
  /** Every tbody row (data + detail) between a group header and the next one. */
  function groupMembers(gh) {
    const out = [];
    let n = gh.nextElementSibling;
    while (n && n.getAttribute("data-part") !== "group-header") {
      const p = n.getAttribute("data-part");
      if (p === "tr" || p === "detail-row") out.push(n);
      n = n.nextElementSibling;
    }
    return out;
  }

  // ── MutationObserver (auto-refresh when rows are added/removed externally) ──
  function pauseObserver(fn) {
    observerPaused++;
    try {
      fn();
    } finally {
      observer?.takeRecords();
      observerPaused--;
    }
  }
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 0);
    raf(() => {
      refreshQueued = false;
      if (root._faqirTable) refresh();
    });
  }

  // ── Sorting ──
  function compareCells(a, b, type) {
    const ra = a ? sortRaw(a) : "";
    const rb = b ? sortRaw(b) : "";
    if (ra === rb) return 0;
    if (!ra) return 1; // empties last (flipped by direction like everything else)
    if (!rb) return -1;
    if (type === "date") {
      const na = parseDateValue(ra);
      const nb = parseDateValue(rb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
    }
    const na = parseNumeric(ra);
    const nb = parseNumeric(rb);
    if (!isNaN(na) && !isNaN(nb) && type !== "text") return na - nb;
    return collator.compare(ra, rb);
  }

  function rememberOrder() {
    for (const r of bodyRows()) if (!originalIndex.has(r)) originalIndex.set(r, originSeq++);
  }

  function rowComparator() {
    if (!sorts.length) {
      return (a, b) => (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
    }
    const specs = sorts.map((s) => ({ ...s, type: columnType(s.index) }));
    return (a, b) => {
      for (const s of specs) {
        const v = compareCells(cellsOf(a)[s.index], cellsOf(b)[s.index], s.type);
        if (v) return s.dir === "ascending" ? v : -v;
      }
      return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
    };
  }

  function buildForest(rows) {
    const forest = [];
    const stack = [];
    for (const row of rows) {
      const node = { row, children: [] };
      const level = levelOf(row);
      while (stack.length && levelOf(stack[stack.length - 1].row) >= level) stack.pop();
      (stack.length ? stack[stack.length - 1].children : forest).push(node);
      stack.push(node);
    }
    return forest;
  }
  function sortForest(forest, cmp) {
    forest.sort((a, b) => cmp(a.row, b.row));
    for (const n of forest) sortForest(n.children, cmp);
  }
  function flattenForest(forest, out) {
    for (const n of forest) {
      out.push(n.row);
      flattenForest(n.children, out);
    }
    return out;
  }

  /** tbody structure as segments delimited by group headers. */
  function segments() {
    const segs = [];
    let cur = { header: null, rows: [] };
    for (const child of tbody ? [...tbody.children] : []) {
      const part = child.getAttribute("data-part");
      if (part === "group-header") {
        if (cur.header || cur.rows.length) segs.push(cur);
        cur = { header: child, rows: [] };
      } else if (part === "tr") {
        cur.rows.push(child);
      }
    }
    if (cur.header || cur.rows.length) segs.push(cur);
    return segs;
  }

  function updateSortIndicators() {
    for (const th of sortableHeaders()) {
      th.setAttribute("aria-sort", "none");
      th.removeAttribute("data-sort-order");
    }
    sorts.forEach((s, i) => {
      const th = headerCells()[s.index];
      if (th?.hasAttribute("data-sortable")) {
        th.setAttribute("aria-sort", s.dir);
        if (sorts.length > 1) th.setAttribute("data-sort-order", String(i + 1));
      }
    });
  }

  function applySorts() {
    if (!tbody || bodyRows().length === 0) return;
    if (!sorts.length && !hasSorted) return; // nothing to do yet
    hasSorted = true;
    rememberOrder();
    updateSortIndicators();

    const details = new Map();
    for (const r of bodyRows()) details.set(r, detailOf(r));
    const cmp = rowComparator();

    const order = [];
    for (const seg of segments()) {
      if (seg.header) order.push(seg.header);
      let rows;
      if (opts.tree) {
        const forest = buildForest(seg.rows);
        sortForest(forest, cmp);
        rows = flattenForest(forest, []);
      } else {
        rows = seg.rows.slice().sort(cmp);
      }
      for (const r of rows) {
        order.push(r);
        const d = details.get(r);
        if (d) order.push(d);
      }
    }
    const emptyRow = rowsIn(tbody, "empty")[0];
    pauseObserver(() => {
      for (const node of order) tbody.appendChild(node);
      if (emptyRow) tbody.appendChild(emptyRow);
    });
    refreshStripes();
  }

  function sortChanged() {
    applySorts();
    emit("sort", { sorts: sorts.map((s) => ({ column: s.index, direction: s.dir })) });
    scheduleStateSave();
  }

  /** Legacy API: sort one column with an explicit direction. */
  function sort(columnIndex, direction) {
    if (!tbody || bodyRows().length === 0) return;
    sorts = [{ index: columnIndex, dir: direction }];
    sortChanged();
  }

  /** Multi-sort API: sortBy([{ column, direction }...]). */
  function sortBy(specs) {
    if (!tbody || bodyRows().length === 0) return;
    sorts = (specs || [])
      .map((s) => ({
        index: s.column != null ? s.column : s.index,
        dir: s.direction || s.dir || "ascending",
      }))
      .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < columnCount());
    sortChanged();
  }

  function clearSort() {
    if (!sorts.length) return;
    sorts = [];
    sortChanged();
  }

  function handleSortRequest(idx, additive) {
    const existing = sorts.find((s) => s.index === idx);
    let dir = "ascending";
    if (existing) {
      if (existing.dir === "ascending") dir = "descending";
      else dir = opts.sortCycle === "tristate" ? null : "ascending";
    }
    if (additive && opts.multiSort) {
      if (dir === null) sorts = sorts.filter((s) => s.index !== idx);
      else if (existing) existing.dir = dir;
      else sorts.push({ index: idx, dir });
    } else {
      sorts = dir === null ? [] : [{ index: idx, dir }];
    }
    sortChanged();
  }

  // ── Selection ──
  function setRowSelected(row, selected) {
    toggleAttr(row, "data-selected", selected);
    const checkbox = row.querySelector("[data-part='checkbox']");
    if (checkbox) checkbox.checked = !!selected;
  }

  function selectRow(index) {
    const rows = bodyRows();
    if (index < 0 || index >= rows.length) return;
    const row = rows[index];
    setRowSelected(row, !row.hasAttribute("data-selected"));
    lastSelectedIndex = index;
    selectionChanged();
  }

  function selectAll() {
    const filtered = !!globalFilter || columnFilters.size > 0;
    for (const row of bodyRows()) {
      if (filtered && row.hasAttribute("data-filtered")) continue;
      setRowSelected(row, true);
    }
    selectionChanged();
  }

  function deselectAll() {
    for (const row of bodyRows()) setRowSelected(row, false);
    lastSelectedIndex = -1;
    selectionChanged();
  }

  function getSelected() {
    return bodyRows()
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.hasAttribute("data-selected"))
      .map(({ index }) => index);
  }

  function selectRange(fromIndex, toIndex) {
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rows = bodyRows();
    for (let i = start; i <= end; i++) {
      if (i >= 0 && i < rows.length && isRowVisible(rows[i])) setRowSelected(rows[i], true);
    }
  }

  function selectionChanged() {
    updateHeaderCheckbox();
    emit("selection-change", { selected: getSelected() });
  }

  function updateHeaderCheckbox() {
    if (!headerCheckbox) return;
    const rows = visibleBodyRows();
    const n = rows.filter((r) => r.hasAttribute("data-selected")).length;
    headerCheckbox.checked = n > 0 && n === rows.length;
    headerCheckbox.indeterminate = n > 0 && n < rows.length;
  }

  // ── Filtering ──
  function matchQuery(cell, query, type) {
    const q = String(query).trim();
    if (!q) return true;
    if (!cell) return false;
    if (isNumericType(type) || type === "date") {
      const val = type === "date" ? parseDateValue(cellRaw(cell)) : parseNumeric(cellRaw(cell));
      const parseQ = (s) => (type === "date" ? parseDateValue(s) : parseNumeric(s));
      const range = q.match(/^(.+?)\.\.(.+)$/);
      if (range) {
        const a = parseQ(range[1]);
        const b = parseQ(range[2]);
        return !isNaN(val) && !isNaN(a) && !isNaN(b) && val >= a && val <= b;
      }
      const op = q.match(/^(>=|<=|!=|=|>|<)\s*(.+)$/);
      if (op) {
        const b = parseQ(op[2]);
        if (isNaN(b) || isNaN(val)) return false;
        switch (op[1]) {
          case ">": return val > b;
          case ">=": return val >= b;
          case "<": return val < b;
          case "<=": return val <= b;
          case "=": return val === b;
          case "!=": return val !== b;
        }
      }
    }
    return (cell.textContent || "").toLowerCase().includes(q.toLowerCase());
  }

  function rowMatches(row) {
    const cells = cellsOf(row);
    if (globalFilter) {
      const hay = cells
        .map((c) => (c.textContent || "") + " " + (c.getAttribute("data-value") || ""))
        .join(" ")
        .toLowerCase();
      if (!hay.includes(globalFilter.toLowerCase())) return false;
    }
    for (const [idx, f] of columnFilters) {
      const cell = cells[idx];
      if (typeof f === "function") {
        if (!f(cell ? cellRaw(cell) : "", cell, row)) return false;
      } else if (!matchQuery(cell, f, columnType(idx))) {
        return false;
      }
    }
    return true;
  }

  function updateEmptyRow(visibleCount) {
    const emptyRow = tbody ? rowsIn(tbody, "empty")[0] : null;
    if (emptyRow) toggleAttr(emptyRow, "hidden", visibleCount > 0);
  }

  function applyFilters() {
    if (!tbody) return;
    const rows = bodyRows();
    const active = !!globalFilter || columnFilters.size > 0;
    const matched = new Set();
    if (active) {
      for (const r of rows) if (rowMatches(r)) matched.add(r);
      if (opts.tree) {
        // A matching row keeps its ancestor path visible.
        for (const r of [...matched]) for (const a of ancestorsOf(r)) matched.add(a);
      }
    }
    let visible = 0;
    for (const r of rows) {
      const show = !active || matched.has(r);
      toggleAttr(r, "data-filtered", !show);
      const d = detailOf(r);
      if (d) toggleAttr(d, "data-filtered", !show);
      if (show && isRowVisible(r)) visible++;
    }
    for (const gh of groupHeaders()) {
      const any = groupMembers(gh).some(
        (m) => m.getAttribute("data-part") === "tr" && !m.hasAttribute("data-filtered")
      );
      toggleAttr(gh, "data-filtered", active && !any);
    }
    updateEmptyRow(visible);
    refreshStripes();
    updateHeaderCheckbox();
    computeAggregates();
    setupNavigability();
    emit("filter", { query: globalFilter, visible, total: rows.length });
    scheduleStateSave();
  }

  function setFilter(query) {
    globalFilter = String(query == null ? "" : query);
    applyFilters();
  }
  function setColumnFilter(colIndex, query) {
    if (query == null || query === "") columnFilters.delete(colIndex);
    else columnFilters.set(colIndex, query);
    applyFilters();
  }
  function clearFilters() {
    globalFilter = "";
    columnFilters.clear();
    syncFilterInputs();
    applyFilters();
  }
  function syncFilterInputs() {
    const g = [...root.querySelectorAll("[data-part='filter']")].find(mine);
    if (g && g.value !== globalFilter) g.value = globalFilter;
    const fr = filterRowEl();
    if (!fr) return;
    cellsOf(fr).forEach((cell, i) => {
      const input = cell.querySelector("[data-part='filter-input']");
      if (!input) return;
      const val = columnFilters.get(i);
      input.value = typeof val === "string" ? val : "";
    });
  }

  // ── Collapse / expand (groups, tree, detail rows) ──
  function toggleGroup(ghOrIndex, force) {
    const gh = typeof ghOrIndex === "number" ? groupHeaders()[ghOrIndex] : ghOrIndex;
    if (!gh) return;
    const collapsed = gh.getAttribute("data-state") === "collapsed";
    const expand = force !== undefined ? !!force : collapsed;
    gh.setAttribute("data-state", expand ? "expanded" : "collapsed");
    gh.querySelector("[data-part='expander']")?.setAttribute("aria-expanded", String(expand));
    for (const m of groupMembers(gh)) toggleAttr(m, "data-collapsed", !expand);
    refreshStripes();
    updateHeaderCheckbox();
    setupNavigability();
    emit("group-toggle", { group: gh, expanded: expand });
  }

  function revealChildren(row) {
    for (const c of childrenOf(row)) {
      c.removeAttribute("data-collapsed");
      detailOf(c)?.removeAttribute("data-collapsed");
      if (isTreeParent(c) && c.getAttribute("aria-expanded") !== "false") revealChildren(c);
    }
  }

  function toggleRow(rowOrIndex, force) {
    const row = typeof rowOrIndex === "number" ? bodyRows()[rowOrIndex] : rowOrIndex;
    if (!row || !isTreeParent(row)) return;
    const expanded = row.getAttribute("aria-expanded") !== "false";
    const expand = force !== undefined ? !!force : !expanded;
    row.setAttribute("aria-expanded", String(expand));
    row.querySelector("[data-part='expander']")?.setAttribute("aria-expanded", String(expand));
    if (expand) {
      revealChildren(row);
    } else {
      for (const d of subtreeRows(row)) {
        d.setAttribute("data-collapsed", "");
        detailOf(d)?.setAttribute("data-collapsed", "");
      }
    }
    refreshStripes();
    updateHeaderCheckbox();
    setupNavigability();
    emit("tree-toggle", { row, expanded: expand });
  }

  /** Master/detail: show or hide a row's [data-part='detail-row'] via the hidden attribute. */
  function toggleDetail(rowOrIndex, force) {
    const row = typeof rowOrIndex === "number" ? bodyRows()[rowOrIndex] : rowOrIndex;
    const detail = row && detailOf(row);
    if (!detail) return;
    const expand = force !== undefined ? !!force : detail.hasAttribute("hidden");
    toggleAttr(detail, "hidden", !expand);
    row.querySelector("[data-part='row-toggle']")?.setAttribute("aria-expanded", String(expand));
    emit("row-expand", { row, detail, expanded: expand });
  }

  function setAllExpanded(expand) {
    mutedRun(() => {
      for (const gh of groupHeaders()) toggleGroup(gh, expand);
      if (opts.tree) for (const r of bodyRows()) if (isTreeParent(r)) toggleRow(r, expand);
    });
    refreshStripes();
  }
  const expandAll = () => setAllExpanded(true);
  const collapseAll = () => setAllExpanded(false);

  // ── Aggregates (tfoot, group headers, tree parents) ──
  function writeAggregate(cell, rows, ownIndex) {
    const fn = cell.getAttribute("data-aggregate");
    const col = cell.hasAttribute("data-col")
      ? parseInt(cell.getAttribute("data-col"), 10)
      : ownIndex != null
        ? ownIndex
        : cellsOf(cell.parentElement).indexOf(cell);
    const values = [];
    for (const r of rows) {
      const c = cellsOf(r)[col];
      if (!c) continue;
      const n = parseNumeric(cellRaw(c));
      if (!isNaN(n)) values.push(n);
    }
    let out = null;
    switch (fn) {
      case "count": out = rows.length; break;
      case "sum": out = values.reduce((a, b) => a + b, 0); break;
      case "avg": out = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; break;
      case "min": out = values.length ? Math.min(...values) : null; break;
      case "max": out = values.length ? Math.max(...values) : null; break;
      default: return;
    }
    if (out == null) {
      cell.textContent = "";
      cell.removeAttribute("data-value");
      return;
    }
    cell.setAttribute("data-value", String(out));
    const fmt =
      fn === "count"
        ? cell.getAttribute("data-format")
        : cellFormatOf(cell, col) || "number";
    cell.textContent = fmt ? formatValue(out, fmt) : String(out);
    applyNegativeFlag(cell);
  }

  function computeAggregates() {
    const visRows = bodyRows().filter((r) => !r.hasAttribute("data-filtered"));
    for (const row of rowsIn(tfoot)) {
      for (const cell of cellsOf(row)) {
        if (cell.hasAttribute("data-aggregate")) writeAggregate(cell, visRows);
      }
    }
    for (const gh of groupHeaders()) {
      const members = groupMembers(gh).filter(
        (r) => r.getAttribute("data-part") === "tr" && !r.hasAttribute("data-filtered")
      );
      for (const cell of cellsOf(gh)) {
        if (cell.hasAttribute("data-aggregate")) writeAggregate(cell, members);
      }
    }
    if (opts.tree) {
      for (const row of bodyRows()) {
        const cells = cellsOf(row);
        const aggCells = cells.filter((c) => c.hasAttribute("data-aggregate"));
        if (!aggCells.length) continue;
        const desc = subtreeRows(row).filter((r) => !r.hasAttribute("data-filtered"));
        if (!desc.length) continue; // leaf with a stray data-aggregate: leave authored value
        for (const cell of aggCells) writeAggregate(cell, desc, cells.indexOf(cell));
      }
    }
  }

  // ── Striping (JS-managed so hidden rows never break the pattern) ──
  function refreshStripes() {
    if (!(root.getAttribute("data-variant") || "").includes("striped")) return;
    let i = 0;
    for (const r of bodyRows()) {
      if (!isRowVisible(r)) {
        r.removeAttribute("data-stripe");
        continue;
      }
      r.setAttribute("data-stripe", i % 2 ? "even" : "odd");
      i++;
    }
  }

  // ── Inline editing ──
  function isCellEditable(cell) {
    if (!cell || cell.getAttribute("data-part") !== "td") return false;
    if (cell.hasAttribute("data-readonly")) return false;
    if (cell.hasAttribute("data-editable")) return true;
    if (!opts.editable) return false;
    const row = cell.parentElement;
    if (!row || row.getAttribute("data-part") !== "tr" || !tbody?.contains(row)) return false;
    if (cell.querySelector("input,button,select,a,textarea")) return false;
    const idx = cellsOf(row).indexOf(cell);
    const th = headerCells()[idx];
    if (th?.hasAttribute("data-readonly")) return false;
    const marked = headerCells().filter((h) => h.hasAttribute("data-editable"));
    return marked.length ? !!th?.hasAttribute("data-editable") : true;
  }

  function cellFormatOf(cell, colIndex) {
    return cell.getAttribute("data-format") || headerCells()[colIndex]?.getAttribute("data-format") || "";
  }

  function startEdit(a, b) {
    let cell = null;
    if (a instanceof Element) cell = a;
    else {
      const row = bodyRows()[a];
      if (row) cell = cellsOf(row)[b] || null;
    }
    if (!cell || !isCellEditable(cell)) return false;
    if (editing) {
      if (editing.cell === cell) return true;
      if (!commitEdit()) cancelEdit();
    }
    const row = cell.parentElement;
    const colIndex = cellsOf(row).indexOf(cell);
    const type = columnType(colIndex);
    const oldText = (cell.textContent || "").trim();
    const oldValue = cell.getAttribute("data-value");
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-part", "cell-input");
    if (isNumericType(type)) input.inputMode = "decimal";
    input.setAttribute("aria-label", "Edit " + (headerText(colIndex) || "cell"));
    input.value = oldValue != null ? oldValue : oldText;
    editing = { cell, row, input, oldText, oldValue, colIndex, type };
    cell.setAttribute("data-editing", "");
    cell.textContent = "";
    cell.appendChild(input);
    input.addEventListener("keydown", onEditorKeydown);
    input.addEventListener("blur", onEditorBlur);
    input.focus();
    try {
      input.select();
    } catch {
      /* select() unsupported in some environments */
    }
    emit("edit-start", { cell, row, rowIndex: bodyRows().indexOf(row), colIndex, value: input.value });
    return true;
  }

  function finishEditor(newText, newValue) {
    const { cell, oldValue } = editing;
    const numeric = isNumericType(editing.type) || isNumericType(cellFormatOf(cell, editing.colIndex));
    editing = null;
    cell.removeAttribute("data-editing");
    cell.textContent = newText;
    if (newValue != null && (oldValue != null || numeric)) cell.setAttribute("data-value", newValue);
    applyNegativeFlag(cell);
  }

  function commitEdit(focusBack) {
    if (!editing) return false;
    const { cell, row, input, oldText, oldValue, colIndex } = editing;
    const fmt = cellFormatOf(cell, colIndex);
    const numeric = isNumericType(editing.type) || isNumericType(fmt);
    const rawInput = input.value;
    let newValue = null;
    let newText = rawInput.trim();
    if (numeric && newText !== "") {
      const n = parseNumeric(rawInput);
      if (isNaN(n)) {
        input.setAttribute("data-invalid", "");
        input.focus();
        return false;
      }
      newValue = String(n);
      newText = isNumericType(fmt) ? formatValue(n, fmt) : newText;
    } else if (numeric) {
      newValue = "";
    }
    const before = oldValue != null ? oldValue : oldText;
    const after = newValue != null ? newValue : newText;
    finishEditor(newText, newValue);
    computeAggregates();
    if (String(before) !== String(after)) {
      emit("cell-edit", {
        cell,
        row,
        rowIndex: bodyRows().indexOf(row),
        colIndex,
        oldValue: before,
        value: after,
        text: newText,
      });
    }
    if (focusBack && opts.navigable) focusCell(cell);
    return true;
  }

  function cancelEdit(focusBack) {
    if (!editing) return false;
    const { cell, row, oldText, oldValue, colIndex } = editing;
    finishEditor(oldText, oldValue);
    formatCell(cell);
    emit("edit-cancel", { cell, row, rowIndex: bodyRows().indexOf(row), colIndex });
    if (focusBack && opts.navigable) focusCell(cell);
    return true;
  }

  function nextEditableCell(cell, dir) {
    const row = cell.parentElement;
    const rows = visibleBodyRows();
    let r = rows.indexOf(row);
    if (r < 0) return null;
    let c = cellsOf(row).indexOf(cell) + dir;
    while (r >= 0 && r < rows.length) {
      const cells = cellsOf(rows[r]);
      while (c >= 0 && c < cells.length) {
        if (isCellEditable(cells[c])) return cells[c];
        c += dir;
      }
      r += dir;
      if (r >= 0 && r < rows.length) c = dir > 0 ? 0 : cellsOf(rows[r]).length - 1;
    }
    return null;
  }

  function onEditorKeydown(e) {
    if (!editing) return;
    e.stopPropagation(); // keep grid navigation away from typing
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit(true);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const from = editing.cell;
      if (commitEdit()) {
        const next = nextEditableCell(from, e.shiftKey ? -1 : 1);
        if (next) startEdit(next);
      }
    } else {
      e.target.removeAttribute("data-invalid");
    }
  }
  function onEditorBlur(e) {
    if (!editing || editing.input !== e.target) return;
    if (!commitEdit()) cancelEdit();
  }

  // ── Column operations ──
  const remapIndex = (i, from, to) =>
    i === from ? to : from < to ? (i > from && i <= to ? i - 1 : i) : i >= to && i < from ? i + 1 : i;

  function moveColumn(from, to) {
    const n = columnCount();
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    pauseObserver(() => {
      for (const row of fullWidthRows()) {
        const cells = cellsOf(row);
        const cell = cells[from];
        const target = cells[to];
        if (!cell || !target) continue;
        if (from < to) target.after(cell);
        else target.before(cell);
      }
    });
    sorts = sorts.map((s) => ({ ...s, index: remapIndex(s.index, from, to) }));
    const remapped = new Map();
    for (const [i, f] of columnFilters) remapped.set(remapIndex(i, from, to), f);
    columnFilters.clear();
    for (const [i, f] of remapped) columnFilters.set(i, f);
    colTypeCache.clear();
    refreshPins();
    emit("col-reorder", { from, to });
    scheduleStateSave();
  }

  function setColumnHidden(i, hidden) {
    const th = headerCells()[i];
    if (!th) return;
    forEachColumnCell(i, (cell) => toggleAttr(cell, "data-col-hidden", hidden));
    refreshPins();
    setupNavigability();
    emit("col-visibility", { column: i, hidden: !!hidden });
    scheduleStateSave();
  }
  const hideColumn = (i) => setColumnHidden(i, true);
  const showColumn = (i) => setColumnHidden(i, false);
  function toggleColumn(i, force) {
    const th = headerCells()[i];
    if (!th) return;
    const hidden = th.hasAttribute("data-col-hidden");
    setColumnHidden(i, force !== undefined ? !force : !hidden);
  }

  function columnBounds(th) {
    const min = parseFloat(th.getAttribute("data-min-width")) || 40;
    const max = parseFloat(th.getAttribute("data-max-width")) || Infinity;
    return { min, max };
  }

  function setColumnWidth(i, width) {
    const th = headerCells()[i];
    if (!th) return;
    const { min, max } = columnBounds(th);
    const w = Math.max(min, Math.min(max, width));
    th.style.width = w + "px";
    root.setAttribute("data-resized", "");
    refreshPins();
    emit("col-resize", { column: i, width: w });
    scheduleStateSave();
  }

  // ── Pinned (sticky) columns ──
  const widthOf = (th) => th.offsetWidth || parseFloat(th.style.width) || 0;

  function refreshPins() {
    const hcs = headerCells();
    const startPins = [];
    const endPins = [];
    hcs.forEach((th, i) => {
      if (th.hasAttribute("data-col-hidden")) return;
      const p = th.getAttribute("data-pin");
      if (p === "start") startPins.push(i);
      else if (p === "end") endPins.push(i);
    });
    if (!startPins.length && !endPins.length) return;
    const setPin = (i, side, offset, isEdge) => {
      forEachColumnCell(i, (cell) => {
        cell.setAttribute("data-pin", side);
        cell.style.setProperty("--table-pin-offset", offset + "px");
        toggleAttr(cell, "data-pin-edge", isEdge);
      });
    };
    let acc = 0;
    startPins.forEach((i, k) => {
      setPin(i, "start", acc, k === startPins.length - 1);
      acc += widthOf(hcs[i]);
    });
    acc = 0;
    [...endPins].reverse().forEach((i, k) => {
      setPin(i, "end", acc, k === endPins.length - 1);
      acc += widthOf(hcs[i]);
    });
  }

  // ── Row moving (API + drag & drop) ──
  /** The DOM block a data row drags with: the row, its detail row, and (tree) its subtree. */
  function rowBlock(row) {
    const block = [row];
    const d = detailOf(row);
    if (d) block.push(d);
    if (opts.tree) {
      for (const sub of subtreeRows(row)) {
        block.push(sub);
        const sd = detailOf(sub);
        if (sd) block.push(sd);
      }
    }
    return block;
  }

  function performRowMove(row, targetRow, pos) {
    if (!row || !targetRow || row === targetRow) return false;
    const block = rowBlock(row);
    if (block.includes(targetRow)) return false;
    if (opts.tree && parentOf(targetRow) !== parentOf(row)) return false; // siblings only
    const anchor =
      pos === "after" ? rowBlock(targetRow)[rowBlock(targetRow).length - 1].nextElementSibling : targetRow;
    pauseObserver(() => {
      for (const node of block) tbody.insertBefore(node, anchor);
    });
    refreshStripes();
    computeAggregates();
    return true;
  }

  function moveRow(from, to) {
    const rows = bodyRows();
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return false;
    const moved = performRowMove(rows[from], rows[to], from < to ? "after" : "before");
    if (moved) emit("row-reorder", { from, to, row: rows[from] });
    return moved;
  }

  // ── Drag & drop (rows, columns, resize) — pointer-based ──
  function clearDropMarkers() {
    for (const el of root.querySelectorAll("[data-drop-target]")) {
      el.removeAttribute("data-drop-target");
      el.removeAttribute("data-drop-pos");
    }
  }

  function elementAt(e) {
    try {
      return document.elementFromPoint(e.clientX, e.clientY);
    } catch {
      return null; // elementFromPoint missing or throwing (headless)
    }
  }

  function resolveRowAt(e) {
    let row = elementAt(e)?.closest?.("[data-part='tr']");
    if (!row) row = e.target?.closest?.("[data-part='tr']");
    return row && tbody?.contains(row) ? row : null;
  }

  /** "before"/"after" the pointer's half of el: vertical for rows, horizontal (RTL-aware) for columns. */
  function dropPos(e, el, horizontal) {
    const rect = el.getBoundingClientRect?.();
    const size = rect && (horizontal ? rect.width : rect.height);
    if (!size) return "after";
    const before = horizontal ? e.clientX < rect.left + size / 2 !== isRTL : e.clientY < rect.top + size / 2;
    return before ? "before" : "after";
  }

  function bindDocDrag() {
    document.addEventListener("pointermove", onDocPointerMove);
    document.addEventListener("pointerup", onDocPointerUp);
    document.addEventListener("keydown", onDragKeydown, true);
  }
  function unbindDocDrag() {
    document.removeEventListener("pointermove", onDocPointerMove);
    document.removeEventListener("pointerup", onDocPointerUp);
    document.removeEventListener("keydown", onDragKeydown, true);
  }
  cleanups.push(unbindDocDrag);

  function cancelDrag() {
    if (!drag) return;
    if (drag.kind === "row") drag.row.removeAttribute("data-dragging");
    if (drag.kind === "col") drag.th.removeAttribute("data-dragging");
    clearDropMarkers();
    drag = null;
    unbindDocDrag();
  }
  function onDragKeydown(e) {
    if (e.key === "Escape") cancelDrag();
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const handle = e.target.closest("[data-part='drag-handle']");
    if (handle && opts.reorderable) {
      const row = handle.closest("[data-part='tr']");
      if (row && tbody?.contains(row)) {
        drag = { kind: "row", row, startY: e.clientY || 0, active: false };
        bindDocDrag();
        e.preventDefault();
      }
      return;
    }
    const rh = e.target.closest("[data-part='resize-handle']");
    if (rh && opts.resizable) {
      const th = rh.closest("[data-part='th']");
      const idx = headerCells().indexOf(th);
      if (idx >= 0) {
        drag = { kind: "resize", th, index: idx, startX: e.clientX || 0, startW: widthOf(th) };
        bindDocDrag();
        e.preventDefault();
      }
      return;
    }
    if (opts.colReorderable) {
      const th = e.target.closest("[data-part='th']");
      if (
        th &&
        headerRowEl()?.contains(th) &&
        !e.target.closest("input,button,select,textarea,[data-part='resize-handle']")
      ) {
        drag = { kind: "col", th, startX: e.clientX || 0, active: false };
        bindDocDrag();
        // no preventDefault: a motionless press must still become a sort click
      }
    }
  }

  function onDocPointerMove(e) {
    if (!drag) return;
    if (drag.kind === "resize") {
      const dx = ((e.clientX || 0) - drag.startX) * (isRTL ? -1 : 1);
      const { min, max } = columnBounds(drag.th);
      const w = Math.max(min, Math.min(max, drag.startW + dx));
      drag.th.style.width = w + "px";
      drag.width = w;
      root.setAttribute("data-resized", "");
      return;
    }
    if (drag.kind === "row") {
      if (!drag.active && Math.abs((e.clientY || 0) - drag.startY) > 3) {
        drag.active = true;
        drag.row.setAttribute("data-dragging", "");
      }
      if (!drag.active) return;
      clearDropMarkers();
      const target = resolveRowAt(e);
      if (!target || target === drag.row || rowBlock(drag.row).includes(target)) return;
      if (opts.tree && parentOf(target) !== parentOf(drag.row)) return; // siblings only
      target.setAttribute("data-drop-target", "");
      target.setAttribute("data-drop-pos", dropPos(e, target));
      return;
    }
    if (drag.kind === "col") {
      if (!drag.active && Math.abs((e.clientX || 0) - drag.startX) > 4) {
        drag.active = true;
        drag.th.setAttribute("data-dragging", "");
      }
      if (!drag.active) return;
      clearDropMarkers();
      let th = elementAt(e)?.closest?.("[data-part='th']");
      if (!th) th = e.target?.closest?.("[data-part='th']");
      if (!th || th === drag.th || !headerRowEl()?.contains(th)) return;
      th.setAttribute("data-drop-target", "");
      th.setAttribute("data-drop-pos", dropPos(e, th, true));
    }
  }

  function onDocPointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    unbindDocDrag();
    if (d.kind === "resize") {
      if (d.width != null) {
        refreshPins();
        emit("col-resize", { column: d.index, width: d.width });
        scheduleStateSave();
      }
      return;
    }
    if (d.kind === "row") {
      const target = root.querySelector("[data-part='tr'][data-drop-target]");
      d.row.removeAttribute("data-dragging");
      if (d.active) suppressClickUntil = Date.now() + 100;
      if (target) {
        const pos = target.getAttribute("data-drop-pos") || "after";
        const rows = bodyRows();
        const from = rows.indexOf(d.row);
        clearDropMarkers();
        if (performRowMove(d.row, target, pos)) {
          emit("row-reorder", { from, to: bodyRows().indexOf(d.row), row: d.row });
        }
      }
      clearDropMarkers();
      return;
    }
    if (d.kind === "col") {
      const target = thead?.querySelector("[data-part='th'][data-drop-target]");
      d.th.removeAttribute("data-dragging");
      if (d.active) suppressClickUntil = Date.now() + 100;
      if (target) {
        const pos = target.getAttribute("data-drop-pos") || "after";
        const hcs = headerCells();
        const from = hcs.indexOf(d.th);
        let to = hcs.indexOf(target);
        if (pos === "after" && from > to) to += 1;
        if (pos === "before" && from < to) to -= 1;
        clearDropMarkers();
        moveColumn(from, to);
      }
      clearDropMarkers();
    }
  }

  // ── CSV export / data extraction ──
  function csvColumns(includeHidden) {
    const cols = [];
    headerCells().forEach((th, i) => {
      if (!includeHidden && th.hasAttribute("data-col-hidden")) return;
      if (th.hasAttribute("data-csv-skip")) return;
      if (th.querySelector("[data-part='checkbox']")) return;
      cols.push(i);
    });
    return cols;
  }

  function exportCsv(o = {}) {
    const all = o.all === true;
    const sep = o.separator || ",";
    const cols = csvColumns(all);
    const esc = (s) => {
      s = String(s == null ? "" : s);
      return /[",;\n]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map((i) => esc(headerText(i))).join(sep)];
    for (const row of bodyRows()) {
      if (!all && row.hasAttribute("data-filtered")) continue;
      const cells = cellsOf(row);
      lines.push(
        cols
          .map((i) => {
            const c = cells[i];
            return esc(c ? cellRaw(c) : "");
          })
          .join(sep)
      );
    }
    const csv = lines.join("\n");
    if (o.filename && typeof Blob !== "undefined" && typeof URL !== "undefined" && URL.createObjectURL) {
      try {
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = o.filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        /* download unavailable (headless) — the string is still returned */
      }
    }
    return csv;
  }

  function rowData(row) {
    const cells = cellsOf(row);
    const out = {};
    headerCells().forEach((th, i) => {
      if (th.querySelector("[data-part='checkbox']")) return;
      const key = th.getAttribute("data-key") || headerText(i) || "col" + i;
      const c = cells[i];
      out[key] = c ? cellRaw(c) : "";
    });
    if (row.hasAttribute("data-row-id")) out._id = row.getAttribute("data-row-id");
    return out;
  }
  const getData = (o = {}) =>
    bodyRows()
      .filter((r) => o.all === true || !r.hasAttribute("data-filtered"))
      .map(rowData);
  const getSelectedData = () => bodyRows().filter((r) => r.hasAttribute("data-selected")).map(rowData);

  // ── State persistence ──
  function getState() {
    return {
      sorts: sorts.map((s) => ({ ...s })),
      filter: globalFilter,
      columnFilters: [...columnFilters].filter(([, v]) => typeof v === "string"),
      widths: headerCells().map((th) => th.style.width || null),
      hidden: headerCells().map((th) => th.hasAttribute("data-col-hidden")),
    };
  }

  function setState(state) {
    if (!state || typeof state !== "object") return;
    mutedRun(() => {
      if (Array.isArray(state.widths)) {
        state.widths.forEach((w, i) => {
          if (w) setColumnWidth(i, parseFloat(w));
        });
      }
      if (Array.isArray(state.hidden)) {
        state.hidden.forEach((h, i) => setColumnHidden(i, !!h));
      }
      let filterDirty = false;
      if (Array.isArray(state.columnFilters)) {
        columnFilters.clear();
        for (const [i, v] of state.columnFilters) {
          if (typeof v === "string" && v) columnFilters.set(+i, v);
        }
        filterDirty = true;
      }
      if (typeof state.filter === "string") {
        globalFilter = state.filter;
        filterDirty = true;
      }
      if (filterDirty) {
        syncFilterInputs();
        applyFilters();
      }
      if (Array.isArray(state.sorts) && state.sorts.length) {
        sorts = state.sorts
          .map((s) => ({ index: s.index != null ? s.index : s.column, dir: s.dir || s.direction || "ascending" }))
          .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < columnCount());
        applySorts();
      }
    });
  }

  let saveTimer = null;
  function scheduleStateSave() {
    if (!opts.persistKey || muted) return;
    clearTimeout(saveTimer);
    saveTimer = later(() => {
      try {
        localStorage.setItem("faqir-table:" + opts.persistKey, JSON.stringify(getState()));
      } catch {
        /* storage unavailable */
      }
    }, 150);
  }
  function restoreState() {
    if (!opts.persistKey) return;
    try {
      const raw = localStorage.getItem("faqir-table:" + opts.persistKey);
      if (raw) setState(JSON.parse(raw));
    } catch {
      /* corrupt state is discarded */
    }
  }

  // ── Structural setup (run at init and on refresh) ──
  function mirrorColumnAttrs() {
    const hcs = headerCells();
    const n = hcs.length;
    if (!n) return;
    for (const row of [...bodyRows(), ...rowsIn(tfoot)]) {
      const cells = cellsOf(row);
      if (cells.length !== n) continue;
      hcs.forEach((th, i) => {
        for (const attr of ["data-align", "data-format", "data-hide-below"]) {
          const v = th.getAttribute(attr);
          if (v && !cells[i].hasAttribute(attr)) cells[i].setAttribute(attr, v);
        }
      });
    }
  }

  function treeCellOf(row) {
    return (
      cellsOf(row).find(
        (c) => !c.querySelector("[data-part='checkbox'],[data-part='drag-handle']")
      ) || cellsOf(row)[0]
    );
  }

  function injectExpander(cell, isParent) {
    let existing = cell.querySelector("[data-part='expander']");
    if (existing) {
      // A leaf placeholder must become a real button when the row gains children (and vice versa).
      const isButton = existing.tagName === "BUTTON";
      if (isParent === isButton) return existing;
      existing.remove();
      existing = null;
    }
    const el = document.createElement(isParent ? "button" : "span");
    if (isParent) el.type = "button";
    el.setAttribute("data-part", "expander");
    if (isParent) el.setAttribute("aria-label", "Toggle");
    else {
      el.setAttribute("data-leaf", "");
      el.setAttribute("aria-hidden", "true");
    }
    cell.insertBefore(el, cell.firstChild);
    return el;
  }

  function setupTree() {
    if (!opts.tree || !tbody) return;
    table?.setAttribute("role", "treegrid");
    for (const row of bodyRows()) {
      const level = levelOf(row);
      row.setAttribute("aria-level", String(level + 1));
      const cell = treeCellOf(row);
      if (!cell) continue;
      cell.setAttribute("data-tree-cell", "");
      cell.style.setProperty("--table-level", String(level));
      const parent = isTreeParent(row);
      const expander = injectExpander(cell, parent);
      if (parent) {
        if (!row.hasAttribute("aria-expanded")) row.setAttribute("aria-expanded", "true");
        expander.setAttribute("aria-expanded", row.getAttribute("aria-expanded"));
        if (row.getAttribute("aria-expanded") === "false") {
          for (const d of subtreeRows(row)) {
            d.setAttribute("data-collapsed", "");
            detailOf(d)?.setAttribute("data-collapsed", "");
          }
        }
      } else {
        row.removeAttribute("aria-expanded");
      }
    }
  }

  function setupGroups() {
    if (!opts.groupable || !tbody) return;
    for (const gh of groupHeaders()) {
      const cell = cellsOf(gh)[0];
      if (!cell) continue;
      const expander = injectExpander(cell, true);
      if (!gh.hasAttribute("data-state")) gh.setAttribute("data-state", "expanded");
      const expanded = gh.getAttribute("data-state") !== "collapsed";
      expander.setAttribute("aria-expanded", String(expanded));
      if (!expanded) for (const m of groupMembers(gh)) m.setAttribute("data-collapsed", "");
    }
  }

  function setupDetails() {
    if (!tbody) return;
    for (const row of bodyRows()) {
      const toggle = row.querySelector("[data-part='row-toggle']");
      const detail = detailOf(row);
      if (!toggle || !detail) continue;
      if (toggle.getAttribute("aria-expanded") === "false") detail.setAttribute("hidden", "");
      else toggle.setAttribute("aria-expanded", String(!detail.hasAttribute("hidden")));
    }
  }

  function setupLabels() {
    if (opts.responsive !== "stack") return;
    const n = columnCount();
    for (const row of [...bodyRows(), ...rowsIn(tfoot)]) {
      const cells = cellsOf(row);
      if (cells.length !== n) continue;
      cells.forEach((cell, i) => {
        if (!cell.hasAttribute("data-label")) cell.setAttribute("data-label", headerText(i));
      });
    }
  }

  function injectResizeHandles() {
    if (!opts.resizable) return;
    headerCells().forEach((th) => {
      if (th.hasAttribute("data-no-resize")) return;
      if (th.querySelector("[data-part='resize-handle']")) return;
      const handle = document.createElement("span");
      handle.setAttribute("data-part", "resize-handle");
      handle.setAttribute("aria-hidden", "true");
      th.appendChild(handle);
    });
  }

  // ── Keyboard navigation (roving tabindex grid) ──
  function navMatrix() {
    const rows = [];
    const hr = headerRowEl();
    if (hr) rows.push(hr);
    for (const child of tbody ? [...tbody.children] : []) {
      const p = child.getAttribute("data-part");
      if ((p === "tr" || p === "group-header") && isRowVisible(child)) rows.push(child);
    }
    for (const r of rowsIn(tfoot)) rows.push(r);
    return rows;
  }

  // APG grid: links, buttons and fields inside a navigable grid's cells leave the
  // Tab order (Enter/F2 reaches them, Escape comes back). The table's own controls
  // stay focusable. destroy() puts the original tabindex back.
  const demoted = new WeakMap();
  const cellControls = (cell) =>
    [...cell.querySelectorAll("input,select,textarea,button,a[href],[tabindex]")].filter(
      (el) => mine(el) && !el.closest("[data-part='checkbox'],[data-part='drag-handle'],[data-part='expander'],[data-part='row-toggle']")
    );

  // Re-run after anything that can take the Tab stop away (refresh, filter,
  // collapse, column hide): only the Tab stop moves, never focus.
  function setupNavigability() {
    if (opts.navigable) {
      const rows = navMatrix();
      // A stale stop — its row removed, filtered or collapsed, or its column hidden —
      // is dropped so the first visible cell takes over.
      if (activeCell && (!rows.includes(activeCell.parentElement) || activeCell.hasAttribute("data-col-hidden"))) {
        activeCell.setAttribute("tabindex", "-1");
        activeCell = null;
      }
      let first = null;
      for (const row of rows) {
        for (const cell of cellsOf(row)) {
          if (!first && !activeCell && !cell.hasAttribute("data-col-hidden")) first = cell;
          cell.setAttribute("tabindex", cell === (activeCell || first) ? "0" : "-1");
          for (const el of cellControls(cell)) {
            if (!demoted.has(el)) demoted.set(el, el.getAttribute("tabindex"));
            el.setAttribute("tabindex", "-1");
          }
        }
      }
      if (!activeCell) activeCell = first;
    } else {
      // Sortable headers must stay keyboard-operable even without grid navigation.
      for (const th of sortableHeaders()) th.setAttribute("tabindex", "0");
    }
  }

  function focusCell(cell) {
    if (!cell) return;
    if (activeCell && activeCell !== cell) activeCell.setAttribute("tabindex", "-1");
    activeCell = cell;
    cell.setAttribute("tabindex", "0");
    cell.focus();
  }

  function moveFocus(rowDelta, colDelta, edge) {
    const cell = activeCell;
    if (!cell) return;
    const row = cell.parentElement;
    const rows = navMatrix();
    let r = rows.indexOf(row);
    if (r < 0) return;
    let cells = cellsOf(row);
    let c = cells.indexOf(cell);
    if (edge === "rowStart") c = 0;
    else if (edge === "rowEnd") c = cells.length - 1;
    else if (edge === "gridStart") {
      r = 0;
      c = 0;
    } else if (edge === "gridEnd") {
      r = rows.length - 1;
      c = cellsOf(rows[r]).length - 1;
    } else {
      r = Math.max(0, Math.min(rows.length - 1, r + rowDelta));
      cells = cellsOf(rows[r]);
      c = Math.max(0, Math.min(cells.length - 1, c + colDelta));
    }
    cells = cellsOf(rows[r]);
    let target = cells[Math.min(c, cells.length - 1)];
    // Skip hidden columns in the direction of travel.
    let guard = cells.length;
    while (target && target.hasAttribute("data-col-hidden") && guard--) {
      const i = cells.indexOf(target) + (colDelta < 0 ? -1 : 1);
      target = cells[i];
    }
    if (target) focusCell(target);
  }

  function onFocusIn(e) {
    if (!opts.navigable) return;
    const cell = e.target.closest("[data-part='td'],[data-part='th']");
    if (!cell || cell === activeCell || !root.contains(cell)) return;
    if (e.target !== cell && !demoted.has(e.target)) return; // the table's own control, not the cell
    if (activeCell) activeCell.setAttribute("tabindex", "-1");
    activeCell = cell;
    cell.setAttribute("tabindex", "0");
  }

  // ── Event handlers ──
  function onHeaderClick(e) {
    if (Date.now() < suppressClickUntil) return;
    if (e.target.closest("[data-part='resize-handle'],[data-part='checkbox'],[data-part='filter-input'],input,button,select,textarea")) {
      return;
    }
    const th = e.target.closest("[data-part='th'][data-sortable]");
    if (!th) return;
    const columnIndex = headerCells().indexOf(th);
    if (columnIndex < 0) return;
    handleSortRequest(columnIndex, e.shiftKey);
  }

  function onHeaderCheckboxChange() {
    if (headerCheckbox.checked) selectAll();
    else deselectAll();
  }

  function onRowCheckboxChange(e) {
    const checkbox = e.target.closest("[data-part='checkbox']");
    if (!checkbox || checkbox === headerCheckbox) return;
    const row = checkbox.closest("[data-part='tr']");
    if (!row || !tbody?.contains(row)) return;
    const rows = bodyRows();
    const index = rows.indexOf(row);
    if (index < 0) return;
    if (e.shiftKey && lastSelectedIndex >= 0) {
      e.preventDefault();
      selectRange(lastSelectedIndex, index);
      selectionChanged();
      return;
    }
    toggleAttr(row, "data-selected", checkbox.checked);
    lastSelectedIndex = index;
    selectionChanged();
  }

  function onRootClick(e) {
    if (Date.now() < suppressClickUntil) return;
    const expander = e.target.closest("[data-part='expander']");
    if (expander && !expander.hasAttribute("data-leaf") && root.contains(expander)) {
      const gh = expander.closest("[data-part='group-header']");
      if (gh && tbody?.contains(gh)) {
        toggleGroup(gh);
        return;
      }
      const treeRow = expander.closest("[data-part='tr']");
      if (treeRow && tbody?.contains(treeRow)) {
        toggleRow(treeRow);
        return;
      }
    }
    const rowToggle = e.target.closest("[data-part='row-toggle']");
    if (rowToggle && root.contains(rowToggle)) {
      const r = rowToggle.closest("[data-part='tr']");
      if (r && tbody?.contains(r)) toggleDetail(r);
      return;
    }
    if (opts.groupable) {
      const gh = e.target.closest("[data-part='group-header']");
      if (gh && tbody?.contains(gh) && !e.target.closest("a,button,input,select,textarea")) {
        toggleGroup(gh);
        return;
      }
    }
    if (e.target.closest("[data-part='checkbox']")) return;
    const row = e.target.closest("[data-part='tr']");
    if (!row || !tbody?.contains(row)) return;
    if (e.target.closest("a,button,input,select,textarea") || editing) return;
    const rows = bodyRows();
    const index = rows.indexOf(row);
    if (index < 0) return;
    if (e.shiftKey && lastSelectedIndex >= 0) {
      selectRange(lastSelectedIndex, index);
      selectionChanged();
      return;
    }
    if (opts.selectable != null) {
      if (opts.selectable === "single") {
        const wasSelected = row.hasAttribute("data-selected");
        for (const r of rows) setRowSelected(r, false);
        setRowSelected(row, !wasSelected);
      } else {
        setRowSelected(row, !row.hasAttribute("data-selected"));
      }
      lastSelectedIndex = index;
      selectionChanged();
    }
  }

  function onDblClick(e) {
    const cell = e.target.closest("[data-part='td']");
    if (cell && tbody?.contains(cell) && isCellEditable(cell)) startEdit(cell);
  }

  const filterTimers = new Map();
  function onFilterInput(e) {
    const t = e.target;
    if (!t || !t.matches) return;
    if (t.matches("[data-part='filter']")) {
      clearTimeout(filterTimers.get("global"));
      filterTimers.set(
        "global",
        later(() => setFilter(t.value), 120)
      );
      return;
    }
    if (t.matches("[data-part='filter-input']")) {
      const fr = filterRowEl();
      const cell = t.closest("[data-part='td'],[data-part='th']");
      if (!fr || !cell) return;
      const col = cellsOf(fr).indexOf(cell);
      if (col < 0) return;
      clearTimeout(filterTimers.get(col));
      filterTimers.set(
        col,
        later(() => setColumnFilter(col, t.value), 120)
      );
    }
  }

  function onKeydown(e) {
    if (editing) return; // the editor's own keydown handler owns these keys
    const target = e.target;

    // Drag handle: arrow keys move the row among its siblings (subtrees stay attached).
    const handle = target.closest?.("[data-part='drag-handle']");
    if (handle && opts.reorderable && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const row = handle.closest("[data-part='tr']");
      if (row && tbody?.contains(row)) {
        e.preventDefault();
        const down = e.key === "ArrowDown";
        const siblings = opts.tree
          ? bodyRows().filter((r) => parentOf(r) === parentOf(row))
          : bodyRows();
        const sibling = siblings[siblings.indexOf(row) + (down ? 1 : -1)];
        if (sibling) {
          const from = bodyRows().indexOf(row);
          if (performRowMove(row, sibling, down ? "after" : "before")) {
            emit("row-reorder", { from, to: bodyRows().indexOf(row), row });
          }
        }
      }
      return;
    }

    const cell = target.closest?.("[data-part='td'],[data-part='th']");

    // Escape in a cell's control returns to the cell.
    if (e.key === "Escape" && demoted.has(target)) {
      e.preventDefault();
      focusCell(cell);
      return;
    }

    // Never hijack typing or native control activation (buttons own Enter/Space via click).
    if (target.closest?.("input,select,textarea,button,a")) return;

    const inHeader = cell && thead?.contains(cell);

    // Sortable header keyboard activation.
    if (inHeader && (e.key === "Enter" || e.key === " ") && cell.hasAttribute("data-sortable")) {
      e.preventDefault();
      const idx = headerCells().indexOf(cell);
      if (idx >= 0) handleSortRequest(idx, e.shiftKey);
      return;
    }

    // Header column ops (navigable focus on th).
    if (inHeader && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      if (opts.colReorderable) {
        e.preventDefault();
        const idx = headerCells().indexOf(cell);
        const delta = (e.key === "ArrowRight") !== isRTL ? 1 : -1;
        moveColumn(idx, idx + delta);
        return;
      }
    }
    if (inHeader && e.ctrlKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      if (opts.resizable) {
        e.preventDefault();
        const idx = headerCells().indexOf(cell);
        const delta = (e.key === "ArrowRight") !== isRTL ? 16 : -16;
        setColumnWidth(idx, widthOf(cell) + delta);
        return;
      }
    }

    if (!opts.navigable || !cell || !root.contains(cell)) return;

    // Select-all.
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      if (opts.selectable != null || headerCheckbox) {
        e.preventDefault();
        selectAll();
      }
      return;
    }

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-1, 0);
        return;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(1, 0);
        return;
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(0, isRTL ? 1 : -1);
        return;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(0, isRTL ? -1 : 1);
        return;
      case "Home":
        e.preventDefault();
        moveFocus(0, 0, e.ctrlKey ? "gridStart" : "rowStart");
        return;
      case "End":
        e.preventDefault();
        moveFocus(0, 0, e.ctrlKey ? "gridEnd" : "rowEnd");
        return;
      case "PageUp":
        e.preventDefault();
        moveFocus(-10, 0);
        return;
      case "PageDown":
        e.preventDefault();
        moveFocus(10, 0);
        return;
      case "Enter":
      case "F2": {
        const row = cell.parentElement;
        if (row.getAttribute("data-part") === "group-header") {
          e.preventDefault();
          toggleGroup(row);
          return;
        }
        if (isTreeParent(row) && !isCellEditable(cell)) {
          e.preventDefault();
          toggleRow(row);
          return;
        }
        if (isCellEditable(cell)) {
          e.preventDefault();
          startEdit(cell);
          return;
        }
        const ctl = cellControls(cell)[0];
        if (ctl) {
          e.preventDefault();
          ctl.focus();
        }
        return;
      }
      case " ": {
        const row = cell.parentElement;
        if (row.getAttribute("data-part") === "group-header") {
          e.preventDefault();
          toggleGroup(row);
          return;
        }
        if (opts.selectable != null || row.querySelector("[data-part='checkbox']")) {
          const index = bodyRows().indexOf(row);
          if (index >= 0) {
            e.preventDefault();
            selectRow(index);
          }
        }
        return;
      }
    }
  }

  // ── Sticky + responsive measurements ──
  // The breakpoint canon (src/utils/breakpoints.ts, task 0.8-01) in px, the unit
  // clientWidth speaks. It is a literal here and not an import because the build
  // inlines every controller into one UMD closure and strips its import lines
  // (scripts/build-core.mjs) — so the equality is enforced from the outside
  // instead: tests/responsive-canon.test.ts parses this very object out of the
  // shipped controller and compares it to BREAKPOINTS, and would fail on any
  // edit that made the engine a second source of truth. `sm` was 480 in 1.x —
  // its own ladder, half a tier below the canon; the CSS ceilings it paired with
  // are now min-width floors.
  const STACK_BREAKPOINTS = { sm: 640, md: 768, lg: 1024 };
  function stackBreakpoint() {
    const v = root.getAttribute("data-stack-below") || "md";
    return STACK_BREAKPOINTS[v] || parseFloat(v) || STACK_BREAKPOINTS.md;
  }
  /** Below the breakpoint, stack mode re-renders rows as labelled cards (CSS keys off data-stacked). */
  function updateStackMode() {
    if (opts.responsive !== "stack") return;
    const width = root.clientWidth || root.getBoundingClientRect?.().width || 0;
    if (!width) return; // headless environment — leave any authored data-stacked alone
    toggleAttr(root, "data-stacked", width < stackBreakpoint());
  }

  function measureSticky() {
    const needsHeaderVar =
      root.hasAttribute("data-sticky-header") || bodyRows().some((r) => r.dataset.pin === "top");
    if (needsHeaderVar && thead && thead.offsetHeight) {
      root.style.setProperty("--table-thead-h", thead.offsetHeight + "px");
    }
    refreshPins();
    updateStackMode();
  }

  // ── Refresh (full structural rescan; safe to call after external DOM changes) ──
  function refresh() {
    colTypeCache.clear();
    rememberOrder();
    mirrorColumnAttrs();
    setupTree();
    setupGroups();
    setupDetails();
    injectResizeHandles();
    applyFormats();
    setupLabels();
    setupNavigability();
    computeAggregates();
    if (globalFilter || columnFilters.size) {
      mutedRun(applyFilters);
    } else {
      updateEmptyRow(visibleBodyRows().length);
    }
    refreshPins();
    refreshStripes();
    updateHeaderCheckbox();
  }

  // ── Lifecycle ──
  function destroy() {
    cancelDrag();
    if (editing) cancelEdit();
    for (const fn of cleanups) fn();
    cleanups.length = 0;
    observer?.disconnect();
    observer = null;
    for (const el of root.querySelectorAll("[tabindex]")) {
      if (demoted.has(el)) {
        const t = demoted.get(el);
        t == null ? el.removeAttribute("tabindex") : el.setAttribute("tabindex", t);
      }
    }
    for (const t of timers) clearTimeout(t);
    timers.clear();
    clearTimeout(saveTimer);
    delete root._faqirTable;
  }

  // ── Wire up ──
  if (thead) on(thead, "click", onHeaderClick);
  if (headerCheckbox) on(headerCheckbox, "change", onHeaderCheckboxChange);
  const onOwn = (target, ev, fn) => on(target, ev, (e) => mine(e.target) && fn(e));
  if (tbody) onOwn(tbody, "change", onRowCheckboxChange);
  onOwn(root, "click", onRootClick);
  onOwn(root, "dblclick", onDblClick);
  onOwn(root, "keydown", onKeydown);
  onOwn(root, "input", onFilterInput);
  onOwn(root, "pointerdown", onPointerDown);
  onOwn(root, "focusin", onFocusIn);
  if (typeof window !== "undefined") {
    let resizeTimer = null;
    const onWinResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = later(measureSticky, 150);
    };
    on(window, "resize", onWinResize);
  }
  if (typeof MutationObserver !== "undefined" && tbody) {
    observer = new MutationObserver(() => {
      if (!observerPaused) queueRefresh();
    });
    observer.observe(tbody, { childList: true });
  }
  if (typeof ResizeObserver !== "undefined") {
    let sizeTimer = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(sizeTimer);
      sizeTimer = later(measureSticky, 100);
    });
    ro.observe(root);
    cleanups.push(() => ro.disconnect());
  }

  refresh();
  restoreState();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(measureSticky);

  const api = {
    // legacy surface (unchanged)
    sort,
    selectRow,
    selectAll,
    deselectAll,
    getSelected,
    destroy,
    // sorting
    sortBy,
    clearSort,
    // filtering
    setFilter,
    setColumnFilter,
    clearFilters,
    // grouping / tree / detail
    toggleGroup,
    toggleRow,
    toggleDetail,
    expandAll,
    collapseAll,
    // editing
    startEdit,
    commitEdit,
    cancelEdit,
    // structure
    moveRow,
    moveColumn,
    hideColumn,
    showColumn,
    toggleColumn,
    setColumnWidth,
    // data
    exportCsv,
    getData,
    getSelectedData,
    // state
    getState,
    setState,
    refresh,
  };
  root._faqirTable = api;
  return api;
}
