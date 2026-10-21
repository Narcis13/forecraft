// Shortcut hints. The server writes them the Windows and Linux way ("Ctrl K",
// "Ctrl+Z", "Alt+↑"); on a Mac every element marked data-shortcut-hint says
// ⌘, ⇧ and ⌥ instead, in its text, its aria-label and its title. This runs
// before boot.js starts faqir-core, so hints inside l-if / l-for templates are
// rewritten before they are ever rendered.
(function () {
  "use strict";

  var ua = navigator.userAgentData;
  var mac = ua && ua.platform ? /^mac/i.test(ua.platform) : /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
  document.documentElement.setAttribute("data-platform", mac ? "mac" : "other");
  if (!mac) return;

  function macKeys(text) {
    return text.replace(/Ctrl\+Shift\+/g, "⇧⌘").replace(/Ctrl[+ ]/g, "⌘").replace(/Alt\+/g, "⌥");
  }

  function rewrite(el) {
    ["aria-label", "title"].forEach(function (name) {
      var value = el.getAttribute(name);
      if (value) el.setAttribute(name, macKeys(value));
    });
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (var node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = macKeys(node.nodeValue);
  }

  function scan(root) {
    root.querySelectorAll("[data-shortcut-hint]").forEach(rewrite);
    root.querySelectorAll("template").forEach(function (t) { scan(t.content); });
  }

  scan(document);
})();
