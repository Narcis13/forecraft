// @ui:plugin faqir-collapse
// @ui:provides l-collapse
/**
 * faqir-collapse — height auto-animation for a boolean expression. [0.4-11 · §A5]
 *
 *   <div l-collapse="open"> … </div>
 *
 * When the bound expression is truthy the element animates from 0 → its natural
 * height and settles at `height: auto`; when falsy it animates back to 0 and is
 * hidden. Honors `prefers-reduced-motion` (snaps, no animation) and leaves NO
 * inline `height` residue in either resting state — so content stays responsive.
 *
 * Self-registers via `Faqir.plugin` when a global `Faqir` is present (load it
 * after faqir-core), and is also exported for bundlers/tests. Zero dependencies,
 * ≤ 2 KB gzip. State it manipulates is inline style only — the DOM contract's
 * `data-*` attributes are untouched.
 */
(function () {
  "use strict";

  function prefersReducedMotion() {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // Settle on transitionend, or a timeout fallback so we never hang when the
  // height does not actually change or the event is missed.
  function whenSettled(el, cb) {
    var done = false;
    function finish(e) {
      if (e && e.target !== el) return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeEventListener("transitionend", finish);
      cb();
    }
    el.addEventListener("transitionend", finish);
    var timer = setTimeout(finish, 400);
  }

  // Reset every inline property this plugin owns → no height/overflow/transition
  // residue in a resting state.
  function clearInline(el) {
    el.style.height = "";
    el.style.overflow = "";
    el.style.transition = "";
  }

  function install(Faqir) {
    Faqir.directive("collapse", function (el, dir, scope) {
      var open = null; // unknown until the first effect run

      return Faqir.effect(function () {
        var next = !!Faqir.evaluate(dir.expression, scope, el);
        if (next === open) return;
        var firstRun = open === null;
        open = next;

        // First paint or reduced motion: snap to the resting state, no animation.
        if (firstRun || prefersReducedMotion()) {
          clearInline(el);
          el.style.display = next ? "" : "none";
          return;
        }

        el.style.overflow = "hidden";
        el.style.transition =
          "height var(--motion-enter-duration, var(--duration-normal, 200ms)) " +
          "var(--motion-enter-ease, var(--ease-out, ease))";

        if (next) {
          // opening: 0 → scrollHeight → auto
          el.style.display = "";
          el.style.height = "0px";
          void el.offsetHeight; // reflow so the 0 start commits
          el.style.height = el.scrollHeight + "px";
          whenSettled(el, function () {
            clearInline(el); // height: auto, no residue
          });
        } else {
          // closing: current height → 0 → hidden
          el.style.height = el.scrollHeight + "px";
          void el.offsetHeight; // reflow so the explicit start commits
          el.style.height = "0px";
          whenSettled(el, function () {
            clearInline(el);
            el.style.display = "none";
          });
        }
      });
    });
  }

  // CommonJS / bundler export (tests import the installer directly).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = install;
  }

  // Browser self-registration: attach as soon as a global Faqir exists.
  var F =
    (typeof globalThis !== "undefined" && globalThis.Faqir) ||
    (typeof window !== "undefined" && window.Faqir);
  if (F && typeof F.plugin === "function") {
    F.plugin(install);
  }
})();
