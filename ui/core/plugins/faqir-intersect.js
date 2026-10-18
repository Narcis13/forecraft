// @ui:plugin faqir-intersect
// @ui:provides l-intersect
// @ui:modifier l-intersect .leave | Runs when the element leaves the viewport instead of when it enters.
// @ui:modifier l-intersect .once | Disconnects the observer after its first matching observation.
/**
 * faqir-intersect — declarative IntersectionObserver hooks. [0.6-05 · §A5]
 *
 *   <section l-intersect="visible = true"
 *            l-intersect.leave="visible = false"></section>
 *   <div l-intersect.once="loadMore()"></div>
 *
 * The base directive runs on enter; `.leave` runs when the element leaves;
 * `.once` disconnects after its first matching observation. The active entry is
 * available to expressions as `$intersection`. Returning the observer cleanup
 * to faqir-core makes scope teardown disconnect it automatically.
 * Self-registering, zero dependencies, and ≤ 2 KB gzip.
 */
(function () {
  "use strict";

  function install(Faqir) {
    Faqir.directive("intersect", function (el, dir, scope) {
      var IO =
        (typeof globalThis !== "undefined" && globalThis.IntersectionObserver) ||
        (typeof window !== "undefined" && window.IntersectionObserver);
      if (typeof IO !== "function") return;

      var leave = dir.modifiers.indexOf("leave") >= 0;
      var once = dir.modifiers.indexOf("once") >= 0;
      var stopped = false;
      var observer = new IO(function (entries) {
        for (var i = 0; i < entries.length && !stopped; i++) {
          var entry = entries[i];
          var matches = leave ? !entry.isIntersecting : entry.isIntersecting;
          if (!matches) continue;

          scope.$intersection = entry;
          try {
            Faqir.evaluateAssignment(dir.expression, scope, el);
          } finally {
            delete scope.$intersection;
          }

          if (once) {
            stopped = true;
            observer.disconnect();
          }
        }
      });

      observer.observe(el);
      return function () {
        if (stopped) return;
        stopped = true;
        observer.disconnect();
      };
    });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = install;

  var F =
    (typeof globalThis !== "undefined" && globalThis.Faqir) ||
    (typeof window !== "undefined" && window.Faqir);
  if (F && typeof F.plugin === "function") F.plugin(install);
})();
