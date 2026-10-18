// The share view's toolbar: print the sheet, copy the link. Everything else on
// the page is the document itself, the same markup the PDF prints.
document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-report-print], [data-report-copy]") : null;
  if (!target) return;
  if (target.hasAttribute("data-report-print")) {
    window.print();
    return;
  }
  const link = target.getAttribute("data-report-copy") || location.href;
  try {
    await navigator.clipboard.writeText(link);
    const label = target.textContent;
    target.textContent = "Link copied";
    setTimeout(() => { target.textContent = label; }, 1600);
  } catch {
    window.prompt("Copy this link", link);
  }
});
