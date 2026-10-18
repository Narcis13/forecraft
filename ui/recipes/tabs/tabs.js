// @ui:controller tabs
// @ui:provides activate destroy

export function createTabs(root) {
  // Prevent double-init
  if (root._faqirTabs) return root._faqirTabs;

  // Direct children only: a component nested in a panel (a collapsible's
  // summary, another tabs) has parts of the same names, and a deep query took
  // them for this component's tabs and shifted the trigger↔panel pairing.
  const list = root.querySelector(":scope > [data-part='list']");
  const triggers = () => [
    ...root.querySelectorAll(":scope > [data-part='list'] > [data-part='trigger']"),
  ];
  const panels = () => [...root.querySelectorAll(":scope > [data-part='panel']")];

  function activate(index) {
    const allTriggers = triggers();
    const allPanels = panels();

    if (index < 0 || index >= allTriggers.length) return;

    // Deactivate all
    allTriggers.forEach((trigger, i) => {
      trigger.setAttribute("aria-selected", "false");
      trigger.setAttribute("tabindex", "-1");
      if (allPanels[i]) allPanels[i].hidden = true;
    });

    // Activate target
    allTriggers[index].setAttribute("aria-selected", "true");
    allTriggers[index].removeAttribute("tabindex");
    if (allPanels[index]) allPanels[index].hidden = false;
  }

  function getActiveIndex() {
    return triggers().findIndex(
      (t) => t.getAttribute("aria-selected") === "true"
    );
  }

  function onTriggerClick(e) {
    const trigger = e.target.closest("[data-part='trigger']");
    if (!trigger) return;
    const index = triggers().indexOf(trigger);
    if (index >= 0) {
      activate(index);
      trigger.focus();
    }
  }

  function onKeyDown(e) {
    const allTriggers = triggers();
    const current = getActiveIndex();
    let next = -1;

    switch (e.key) {
      case "ArrowRight":
        next = (current + 1) % allTriggers.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + allTriggers.length) % allTriggers.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = allTriggers.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    activate(next);
    allTriggers[next].focus();
  }

  list?.addEventListener("click", onTriggerClick);
  list?.addEventListener("keydown", onKeyDown);

  function destroy() {
    list?.removeEventListener("click", onTriggerClick);
    list?.removeEventListener("keydown", onKeyDown);
    delete root._faqirTabs;
  }

  const api = { activate, getActiveIndex, destroy };
  root._faqirTabs = api;
  return api;
}
