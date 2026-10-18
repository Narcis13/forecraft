// @ui:controller alert-dialog
// @ui:provides open close toggle destroy

import { createDialog } from "../dialog/dialog.js";

/**
 * alert-dialog reuses the `dialog` controller wholesale — there is no forked or
 * duplicated controller here. An alert dialog IS a dialog whose panel carries
 * `role="alertdialog"`; the shared controller in ../dialog/dialog.js reads that
 * role and switches on the WAI-ARIA alertdialog behaviours (no overlay-dismiss,
 * focus the least-destructive action, guarded Escape, confirm/cancel events).
 * This factory only exists so the recipe is discoverable under its own
 * `data-ui="alert-dialog"` name and auto-registers from the built core.
 */
export function createAlertDialog(root) {
  // Resolve the shared dialog factory in both worlds this controller runs in:
  //   • as an ES module (behaviour tests, `faqir add`): the `import` above binds
  //     `createDialog` directly.
  //   • inlined into the built registry/core/faqir-core.js: scripts/build-core.mjs
  //     strips the import, but every recipe factory is registered on the engine's
  //     private `controllerRegistry`, so pick `dialog` up from there.
  // `typeof` is used because a bare reference to a stripped/undeclared binding
  // would throw — `typeof` on an unknown identifier is the one safe probe.
  const dialogFactory =
    (typeof createDialog === "function" && createDialog) ||
    (typeof controllerRegistry !== "undefined" && controllerRegistry["dialog"]);

  if (typeof dialogFactory !== "function") {
    throw new Error("alert-dialog requires the dialog controller to be available");
  }
  return dialogFactory(root);
}
