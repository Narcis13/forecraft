// @ui:core motion
// @ui:provides waitForTransition whenExitDone animate prefersReducedMotion

/**
 * Check if the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Wait for a CSS transition or animation to end on an element.
 * Resolves immediately if no transition/animation is active or reduced motion is preferred.
 * @param {Element} el
 * @returns {Promise<void>}
 */
export function waitForTransition(el) {
  if (prefersReducedMotion()) return Promise.resolve();

  const style = getComputedStyle(el);
  const hasDuration =
    parseFloat(style.transitionDuration) > 0 ||
    (style.animationName !== "none" && parseFloat(style.animationDuration) > 0);

  if (!hasDuration) return Promise.resolve();

  return new Promise((resolve) => {
    function done(e) {
      if (e.target !== el) return;
      el.removeEventListener("transitionend", done);
      el.removeEventListener("animationend", done);
      resolve();
    }
    el.addEventListener("transitionend", done);
    el.addEventListener("animationend", done);
  });
}

/**
 * Apply a class-based animation, wait for it to finish, then remove the class.
 * @param {Element} el
 * @param {string} className
 * @returns {Promise<void>}
 */
export async function animate(el, className) {
  el.classList.add(className);
  await waitForTransition(el);
  el.classList.remove(className);
}

/** The four events an exit can end with, bound and unbound from one list. */
const EXIT_EVENTS = ["transitionend", "transitioncancel", "animationend", "animationcancel"];

/**
 * Run `done` once `el` has finished its exit motion — the single place every
 * "closing → closed" controller waits.
 *
 * `transitionend` BUBBLES. A panel that contains a button — every dialog,
 * drawer and sheet in the registry ships one, and the drawer manifest marks the
 * close button `required` — receives that button's own `background`
 * transitionend the instant a pointer lands on it. A one-shot listener spends
 * itself on that event, and the panel's own `transform` transitionend, when it
 * arrives, finds nobody listening: `closing` never became `closed`, the overlay
 * stayed up, `body` stayed at `overflow: hidden`.
 *
 * Hence: only `el`'s own motion counts, only `property` when one is named,
 * `transitioncancel`/`animationcancel` count as over, and a duration-sized timer
 * runs `done` even when no event ever arrives. `done` runs at most once —
 * synchronously when there is no motion to wait for.
 *
 * The engine carries an identical implementation in its own closure, so a recipe
 * behaves the same imported as a module or loaded from `faqir-core.js`. [W2-1]
 *
 * @param {Element} el
 * @param {string|null} property  CSS property to wait for, or null for any.
 * @param {() => void} done
 * @returns {() => void} cancels a pending wait (re-entrant open).
 */
export function whenExitDone(el, property, done) {
  let settled = false;
  let timer = null;

  const unbind = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const event of EXIT_EVENTS) el.removeEventListener(event, onMotionEvent);
  };

  const settle = () => {
    if (settled) return;
    settled = true;
    unbind();
    done();
  };

  function onMotionEvent(e) {
    if (e.target !== el) return;
    if (property && e.propertyName && e.propertyName !== property) return;
    settle();
  }

  let ms = 0;
  try {
    ms = longestMotionMs(getComputedStyle(el));
  } catch {
    // No computed style (a bare test DOM) — treat it as "no motion".
  }

  if (!(ms > 0)) {
    settle();
    return () => {};
  }

  for (const event of EXIT_EVENTS) el.addEventListener(event, onMotionEvent);
  // A couple of frames of slack before the fallback takes over from the event.
  timer = setTimeout(settle, ms + 50);

  return () => {
    if (settled) return;
    settled = true;
    unbind();
  };
}

// Largest number in a comma-separated CSS time list, in ms ("0.3s, 150ms" → 300).
function longestTimeMs(value) {
  return String(value ?? "")
    .split(",")
    .reduce((max, part) => {
      const raw = part.trim();
      const n = parseFloat(raw);
      if (Number.isNaN(n)) return max;
      const ms = raw.includes("ms") ? n : n * 1000;
      return ms > max ? ms : max;
    }, 0);
}

// An upper bound on how long an element's motion can run: the longest transition
// or animation plus the longest delay. Deliberately an over-estimate — it sizes a
// fallback timer, and a fallback that fires early is worse than one that fires late.
function longestMotionMs(style) {
  const transition = longestTimeMs(style.transitionDuration) + longestTimeMs(style.transitionDelay);
  const animation = longestTimeMs(style.animationDuration) + longestTimeMs(style.animationDelay);
  return Math.max(transition, animation);
}
