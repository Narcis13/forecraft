// @ui:controller pagination
// @ui:provides setPage getPage setTotal render destroy

export function createPagination(root) {
  // Prevent double-init
  if (root._faqirPagination) return root._faqirPagination;

  const nav = root.querySelector("[data-part='nav']");
  const prevBtn = root.querySelector("[data-part='prev']");
  const nextBtn = root.querySelector("[data-part='next']");

  let currentPage = 1;
  let totalPages = 1;

  // Initialize from existing DOM
  const activeBtn = root.querySelector("[data-part='page'][data-state='active']");
  if (activeBtn) {
    currentPage = parseInt(activeBtn.dataset.page, 10) || 1;
  }

  const allPageBtns = root.querySelectorAll("[data-part='page']");
  if (allPageBtns.length > 0) {
    const lastBtn = allPageBtns[allPageBtns.length - 1];
    totalPages = parseInt(lastBtn.dataset.page, 10) || 1;
  }

  function getPageButtons() {
    return [...root.querySelectorAll("[data-part='page']")];
  }

  function updateActiveState() {
    getPageButtons().forEach((btn) => {
      const page = parseInt(btn.dataset.page, 10);
      if (page === currentPage) {
        btn.dataset.state = "active";
        btn.setAttribute("aria-current", "page");
      } else {
        delete btn.dataset.state;
        btn.removeAttribute("aria-current");
      }
    });

    // Update prev/next disabled state
    if (prevBtn) {
      prevBtn.disabled = currentPage <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = currentPage >= totalPages;
    }
  }

  function emitPageChange() {
    root.dispatchEvent(
      new CustomEvent("faqir:page-change", {
        detail: { page: currentPage },
        bubbles: true,
      })
    );
  }

  function setPage(n) {
    const page = Math.max(1, Math.min(n, totalPages));
    if (page === currentPage) return;
    currentPage = page;
    updateActiveState();
    emitPageChange();
  }

  function getPage() {
    return currentPage;
  }

  function setTotal(n) {
    totalPages = Math.max(1, n);
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }
    updateActiveState();
  }

  // Rebuild the numbered page buttons + ellipses from the windowing math for the
  // given (current, total). Prev/next are preserved; only [data-part='page'] and
  // [data-part='ellipsis'] nodes are replaced. Does not emit page-change — it is
  // a render, not a user action. Clicks keep working via nav's delegated handler.
  function render(current, total) {
    if (!nav) return;
    totalPages = Math.max(1, Math.floor(total) || 1);
    currentPage = Math.max(1, Math.min(Math.floor(current) || 1, totalPages));

    nav
      .querySelectorAll("[data-part='page'], [data-part='ellipsis']")
      .forEach((el) => el.remove());

    const frag = root.ownerDocument.createDocumentFragment();
    for (const item of paginationWindow(currentPage, totalPages)) {
      if (item === "ellipsis") {
        const span = root.ownerDocument.createElement("span");
        span.setAttribute("data-part", "ellipsis");
        span.textContent = "…";
        frag.appendChild(span);
      } else {
        const btn = root.ownerDocument.createElement("button");
        btn.setAttribute("data-part", "page");
        btn.dataset.page = String(item);
        btn.textContent = String(item);
        frag.appendChild(btn);
      }
    }

    if (nextBtn && nextBtn.parentNode === nav) {
      nav.insertBefore(frag, nextBtn);
    } else {
      nav.appendChild(frag);
    }

    updateActiveState();
  }

  // Event: click on page button
  function onNavClick(e) {
    const pageBtn = e.target.closest("[data-part='page']");
    if (pageBtn) {
      const page = parseInt(pageBtn.dataset.page, 10);
      if (!isNaN(page)) {
        setPage(page);
      }
      return;
    }
  }

  function onPrevClick() {
    if (currentPage > 1) {
      setPage(currentPage - 1);
    }
  }

  function onNextClick() {
    if (currentPage < totalPages) {
      setPage(currentPage + 1);
    }
  }

  nav?.addEventListener("click", onNavClick);
  prevBtn?.addEventListener("click", onPrevClick);
  nextBtn?.addEventListener("click", onNextClick);

  // Initialize disabled states
  updateActiveState();

  function destroy() {
    nav?.removeEventListener("click", onNavClick);
    prevBtn?.removeEventListener("click", onPrevClick);
    nextBtn?.removeEventListener("click", onNextClick);
    delete root._faqirPagination;
  }

  const api = { setPage, getPage, setTotal, render, destroy };
  root._faqirPagination = api;
  return api;
}

/**
 * Pure windowing math: given the current page and total page count, return the
 * ordered list of items to display — page numbers interleaved with `"ellipsis"`
 * tokens where a run of pages is collapsed. A gap of exactly one page is never
 * collapsed to an ellipsis (the single page is shown instead), matching the
 * common MUI/APG pagination pattern.
 *
 * @param {number} currentPage   1-based active page (clamped into range).
 * @param {number} totalPages    Total page count (>= 0; 0 → []).
 * @param {object} [options]
 * @param {number} [options.siblingCount=1]  Pages shown either side of current.
 * @param {number} [options.boundaryCount=1] Pages pinned at each end.
 * @returns {Array<number|"ellipsis">}
 */
export function paginationWindow(currentPage, totalPages, options = {}) {
  const siblingCount = Math.max(0, Math.floor(options.siblingCount ?? 1));
  const boundaryCount = Math.max(0, Math.floor(options.boundaryCount ?? 1));

  const total = Math.max(0, Math.floor(totalPages) || 0);
  if (total <= 0) return [];
  const current = Math.min(Math.max(1, Math.floor(currentPage) || 1), total);

  const range = (start, end) => {
    const out = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  };

  const startPages = range(1, Math.min(boundaryCount, total));
  const endPages = range(Math.max(total - boundaryCount + 1, boundaryCount + 1), total);

  const siblingsStart = Math.max(
    Math.min(current - siblingCount, total - boundaryCount - siblingCount * 2 - 1),
    boundaryCount + 2
  );
  const siblingsEnd = Math.min(
    Math.max(current + siblingCount, boundaryCount + siblingCount * 2 + 2),
    endPages.length > 0 ? endPages[0] - 2 : total - 1
  );

  return [
    ...startPages,
    ...(siblingsStart > boundaryCount + 2
      ? ["ellipsis"]
      : boundaryCount + 1 < total - boundaryCount
        ? [boundaryCount + 1]
        : []),
    ...range(siblingsStart, siblingsEnd),
    ...(siblingsEnd < total - boundaryCount - 1
      ? ["ellipsis"]
      : total - boundaryCount > boundaryCount
        ? [total - boundaryCount]
        : []),
    ...endPages,
  ];
}
