// @ui:core faqir-core.mjs
// @ui:provides esm-entry
//
// ESM entry for the engine beside it — for `<script type="module">`, Vite,
// Rollup, esbuild and webpack:
//
//     import Faqir from "./ui/core/faqir-core.mjs";
//     Faqir.data("counter", () => ({ n: 0 }));
//
// `faqir-core.js` is UMD, and which of its branches runs depends on who loads
// it. Served raw (Vite dev, a plain `<script type="module">`) it has no
// `module`/`exports`, takes the global branch, sets `globalThis.Faqir` and
// exports nothing. A bundler that sees its `typeof exports` check (Vite's
// production build) wraps it as CommonJS instead: it then exports the engine and
// sets NO global — so a page that worked in dev lost `window.Faqir`, and with it
// every plugin and every inline expression that reads it, in production. The
// namespace import below takes whichever of the two it got, and the global is
// published either way, because the classic-script plugins in `plugins/`
// self-register against it.
//
// The engine boots one task after it is evaluated, so registrations made right
// after this import are seen. For `@faqir-ui/core` from npm, import the package
// instead: its own ESM build is real ESM and touches no global.
import * as engine from "./faqir-core.js";

const Faqir = engine.default || globalThis.Faqir;
if (!globalThis.Faqir) globalThis.Faqir = Faqir;

export default Faqir;

export const version = Faqir.version;

// ── Reactivity ──
export const reactive = Faqir.reactive;
export const effect = Faqir.effect;
export const batch = Faqir.batch;
export const untrack = Faqir.untrack;
export const nextTick = Faqir.nextTick;

// ── Expressions ──
export const evaluate = Faqir.evaluate;
export const evaluateAssignment = Faqir.evaluateAssignment;

// ── Registration ──
export const data = Faqir.data;
export const store = Faqir.store;
export const directive = Faqir.directive;
export const magic = Faqir.magic;
export const plugin = Faqir.plugin;
export const controller = Faqir.controller;

// ── Lifecycle ──
export const start = Faqir.start;
export const initTree = Faqir.initTree;
export const destroy = Faqir.destroy;

// ── Inspection ──
export const inspect = Faqir.inspect;
export const devtools = Faqir.devtools;
