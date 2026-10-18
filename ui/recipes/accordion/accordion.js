// @ui:controller accordion
// @ui:provides toggle expand collapse expandAll collapseAll destroy

export function createAccordion(root) {
  // Prevent double-init
  if (root._faqirAccordion) return root._faqirAccordion;

  // Direct children only: a nested accordion's items are its own.
  const getItems = () => [...root.querySelectorAll(":scope > [data-part='item']")];
  const isSingle = () => root.dataset.variant === "single";

  function expand(index) {
    const items = getItems();
    if (index < 0 || index >= items.length) return;

    // In single mode, collapse all others first
    if (isSingle()) {
      items.forEach((item, i) => {
        if (i !== index) collapseItem(item);
      });
    }

    expandItem(items[index]);
  }

  function collapse(index) {
    const items = getItems();
    if (index < 0 || index >= items.length) return;
    collapseItem(items[index]);
  }

  function toggle(index) {
    const items = getItems();
    if (index < 0 || index >= items.length) return;

    if (items[index].dataset.state === "expanded") {
      collapse(index);
    } else {
      expand(index);
    }
  }

  function expandAll() {
    const items = getItems();
    items.forEach((item) => expandItem(item));
  }

  function collapseAll() {
    const items = getItems();
    items.forEach((item) => collapseItem(item));
  }

  function expandItem(item) {
    item.dataset.state = "expanded";
    const trigger = item.querySelector("[data-part='trigger']");
    const content = item.querySelector("[data-part='content']");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    if (content) content.hidden = false;
  }

  function collapseItem(item) {
    item.dataset.state = "collapsed";
    const trigger = item.querySelector("[data-part='trigger']");
    const content = item.querySelector("[data-part='content']");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (content) content.hidden = true;
  }

  /**
   * The index of the item whose own trigger `e` came from, or -1. A trigger of
   * a component nested in the content (a dropdown, another accordion) is not
   * the item's: an item's own trigger is the first one in it, since it comes
   * before the content.
   */
  function triggerIndex(e) {
    const trigger = e.target.closest("[data-part='trigger']");
    const item = trigger?.closest("[data-part='item']");
    if (!item || item.querySelector("[data-part='trigger']") !== trigger) return -1;
    return getItems().indexOf(item);
  }

  function onTriggerClick(e) {
    const index = triggerIndex(e);
    if (index >= 0) toggle(index);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      const index = triggerIndex(e);
      if (index >= 0) {
        e.preventDefault();
        toggle(index);
      }
    }
  }

  root.addEventListener("click", onTriggerClick);
  root.addEventListener("keydown", onKeyDown);

  function destroy() {
    root.removeEventListener("click", onTriggerClick);
    root.removeEventListener("keydown", onKeyDown);
    delete root._faqirAccordion;
  }

  const api = { toggle, expand, collapse, expandAll, collapseAll, destroy };
  root._faqirAccordion = api;
  return api;
}
