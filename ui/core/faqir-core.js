// ============================================================================
// registry/core/faqir-core.js
//
// GENERATED FILE — DO NOT EDIT BY HAND.
// Assembled by scripts/build-core.mjs (task 0.3-03) from:
//   engine:      src/core-src/engine.js
//   core helper: registry/core/menu-navigation.js
//   controllers: 29 recipe factories → accordion, alert-dialog, barcode, calendar, carousel, combobox, command-palette, context-menu, date-picker, dialog, drawer, dropdown, file-upload, input-otp, menubar, pagination, popover, qr-code, select-custom, sheet, sidebar, slider, table, tabs, tag-input, toast, toggle-group, tooltip, tree-view
//
// PRODUCTION BUILD — dev-only diagnostics stripped at assembly time.
// Load faqir-core.dev.js instead while developing for full warnings.
// Regenerate with: bun run build:core
// Package version: 1.3.0
// ============================================================================

/**
 * Faqir Core — the running version is `Faqir.version` (stamped at build time).
 * Alpine-style reactivity for the Faqir UI component system.
 * Zero dependencies. CDN-ready. Agent-native.
 *
 * Usage:
 *   <script src="faqir-core.js"></script>
 *   — or —
 *   <script src="faqir-core.js" type="module"></script>
 *   — or —
 *   import Faqir from './faqir-core.js'
 */
(function(global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    var Faqir = factory();
    global.Faqir = Faqir;
    if (typeof globalThis !== 'undefined') globalThis.Faqir = Faqir;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // Section 0: Dev-build seam  [task 0.7-12]
  // ═══════════════════════════════════════════════════════
  //
  // `faqir-core.js` (production) and `faqir-core.dev.js` are assembled from THIS
  // one source by scripts/build-core.mjs. Three markers decide what each build
  // keeps:
  //
  //                                the WHOLE LINE is dropped for production.
  //   // @faqir:dev-start … end  — the same, for a multi-line region.
  //   // @faqir:dev-diagnostics  — replaced by src/core-src/dev-diagnostics.js
  //                                in the dev build, dropped in production.
  //
  // Every dev-only message string therefore lives in dev-diagnostics.js and
  // never reaches the production file (proved by tests/build/dev-build.test.ts).
  //
  // `devHooks` is the only seam: null in production, an object of reporters in
  // the dev build. Call sites read `if (devHooks)` on a dev-marked line, so
  // production carries neither the guard nor the message.
  var devHooks = null;

  // ═══════════════════════════════════════════════════════
  // Section 1: Reactive Engine
  // ═══════════════════════════════════════════════════════

  let currentEffect = null;
  const effectStack = [];
  let batchDepth = 0;
  const pendingEffects = new Set();
  let flushScheduled = false;

  const reactiveMap = new WeakMap();
  const ARRAY_MUTATORS = new Set(['push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'reverse']);

  function reactive(obj) {
    if (obj.__isReactive) return obj;
    if (reactiveMap.has(obj)) return reactiveMap.get(obj);

    const deps = Object.create(null);

    const proxy = new Proxy(obj, {
      get(target, key, receiver) {
        if (key === '__isReactive') return true;
        if (key === '__deps') return deps;
        if (key === '__target') return target;

        if (currentEffect && typeof key === 'string') {
          if (!deps[key]) deps[key] = new Set();
          deps[key].add(currentEffect);
          currentEffect._deps.add(deps[key]);
        }

        const value = Reflect.get(target, key, receiver);

        // Intercept array mutation methods to trigger 'length' deps,
        // since internal length updates bypass the setter's change check.
        if (Array.isArray(target) && typeof value === 'function' && ARRAY_MUTATORS.has(key)) {
          return function() {
            const result = value.apply(target, arguments);
            if (deps['length']) {
              for (const eff of deps['length']) {
                pendingEffects.add(eff);
              }
              scheduleFlush();
            }
            return result;
          };
        }

        // Deep reactivity: wrap nested arrays and plain objects so that
        // mutations like array.push() / array.splice() trigger effects.
        if (value !== null && typeof value === 'object'
            && !value.__isReactive
            && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
          return reactive(value);
        }

        return value;
      },

      set(target, key, value, receiver) {
        const oldValue = target[key];
        const result = Reflect.set(target, key, value, receiver);

        if (oldValue !== value && deps[key]) {
          for (const eff of deps[key]) {
            pendingEffects.add(eff);
          }
          scheduleFlush();
        }

        return result;
      }
    });

    reactiveMap.set(obj, proxy);
    return proxy;
  }

  function effect(fn) {
    const execute = () => {
      cleanup(execute);

      currentEffect = execute;
      effectStack.push(execute);

      try {
        fn();
      } finally {
        effectStack.pop();
        currentEffect = effectStack[effectStack.length - 1] || null;
      }
    };

    execute._deps = new Set();
    execute();

    return () => cleanup(execute);
  }

  function cleanup(execute) {
    for (const depSet of execute._deps) {
      depSet.delete(execute);
    }
    execute._deps.clear();
  }

  function scheduleFlush() {
    if (batchDepth > 0) return;
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flushEffects);
  }

  function flushEffects() {
    flushScheduled = false;
    var iterations = 0;
    while (pendingEffects.size > 0) {
      // Effects that keep re-triggering each other (a writes b, b writes a)
      // would loop forever. The cap stops that, but dropping work silently
      // hides the bug, so it is reported in every build.
      if (++iterations > 100) {
        console.warn('[Faqir] Effect loop: dropped ' + pendingEffects.size + ' effect(s) after 100 flushes; effects keep re-triggering each other');
        pendingEffects.clear();
        break;
      }
      var effects = [...pendingEffects];
      pendingEffects.clear();
      for (var i = 0; i < effects.length; i++) {
        try {
          effects[i]();
        } catch (e) {
          console.warn('[Faqir] Effect error:', e);
        }
      }
    }
  }

  function batch(fn) {
    batchDepth++;
    try {
      fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        flushEffects();
      }
    }
  }

  function untrack(fn) {
    const prev = currentEffect;
    currentEffect = null;
    try {
      return fn();
    } finally {
      currentEffect = prev;
    }
  }

  // ═══════════════════════════════════════════════════════
  // Section 2: Expression Evaluator
  // ═══════════════════════════════════════════════════════

  const expressionCache = new Map();

  function evaluate(expression, scope, el) {
    try {
      const fn = compileExpression(expression);
      return fn.call(scope, scope, el, el);
    } catch (e) {
      console.warn('[Faqir] Expression error: "' + expression + '"', e);
      return undefined;
    }
  }

  function evaluateAssignment(expression, scope, el) {
    try {
      const fn = compileStatement(expression);
      fn.call(scope, scope, el, el);
    } catch (e) {
      console.warn('[Faqir] Statement error: "' + expression + '"', e);
    }
  }

  // Write a value into a scope property WITHOUT putting the value into source.
  //
  // l-model used to build "prop = '" + value + "'" and compile it, which meant
  // (a) anything typed into an input was executed as JavaScript, (b) a backslash
  // or newline silently corrupted or broke the write, and (c) every distinct
  // value compiled and permanently cached its own Function. Passing the value
  // through a reserved scope slot — the same trick handleOn uses for $event —
  // fixes all three: one compiled statement per binding, and user data is never
  // parsed as code.
  function writeModel(prop, value, scope, el) {
    scope.$modelValue = value;
    try {
      evaluateAssignment(prop + ' = $modelValue', scope, el);
    } finally {
      delete scope.$modelValue;
    }
  }

  // `$el` and `$this` are both the element the directive is written on. Inside
  // `with($scope)` the scope's own `$el` magic (the root) wins, so `$el` only
  // reaches this parameter where nothing shadows it: a top-level `l-data`,
  // evaluated against `{}`. `$this` is never a scope key, so it always reaches
  // it. [1.1F-06]
  function compileExpression(expr) {
    var key = 'expr:' + expr;
    if (expressionCache.has(key)) return expressionCache.get(key);

    var fn = new Function(
      '$scope', '$el', '$this',
      'with($scope) { return (' + expr + ') }'
    );
    expressionCache.set(key, fn);
    return fn;
  }

  function compileStatement(expr) {
    var key = 'stmt:' + expr;
    if (expressionCache.has(key)) return expressionCache.get(key);

    var fn = new Function(
      '$scope', '$el', '$this',
      'with($scope) { ' + expr + ' }'
    );
    expressionCache.set(key, fn);
    return fn;
  }

  // ═══════════════════════════════════════════════════════
  // Section 3: Directive System
  // ═══════════════════════════════════════════════════════

  // --- Shared state ---
  var scopeCounter = 0;
  var dataRegistry = new Map();
  var customDirectives = new Map();
  var globalStores = {};

  // --- 3.0 Declared vocabulary  [task 1.0R-03] ---
  //
  // The engine's public surface, declared once, in comments only — the minifier
  // drops them, so this costs zero shipped bytes. `src/generator/skill.ts` reads
  // these lines into `.claude/skills/faqir-creator/references/directives.md`, so
  // the reference an agent is sent to is not a transcription: add a line here
  // and the row appears. `tests/generator/skill.test.ts` greps this file for
  // every `l-…` and `$…` name it mentions and fails on any the engine
  // implements without a line below — which is why something that is NOT public
  // vocabulary (the evaluator's own `$scope` binding) is declared `internal`
  // with its reason rather than left out.
  //
  // Fields are ` | `-separated; never use `|` inside one.
  //   @ui:directive <attribute> | <shorthand> | <placement> | <example> | <what it does>
  //   @ui:modifier  <attribute> <.modifier> | <what it does>
  //   @ui:magic     $<name> | <where it resolves> | <what it is>
  //
  // The three lists that already exist as code — PRIORITY (§3.2), KEY_MAP
  // (§3.9) and MOTION_PRESETS (§3.14) — are read from the code itself, not
  // repeated here.
  //
  // @ui:directive l-data | — | any element, which becomes the scope root | l-data="{ count: 0 }" | Declares a reactive scope from an object literal, or from a name registered with `Faqir.data()`. `data-prop-*` attributes are JSON-parsed and merged over it. Descendants share the scope until the next `l-data`. Its methods are bound to the scope, so `this` is the component even when an `l-for` row calls them; a function assigned later is not bound.
  // @ui:directive l-init | — | a scope root, beside `l-data` | l-init="load()" | Runs once, after the scope exists and its `l-source` bindings are injected, with the subtree's controllers already started. In `l-if` / `l-for` content it runs after insertion: bindings, insert, controllers, then `l-init` / first `l-effect`.
  // @ui:directive l-source:<name> | — | a scope root, beside `l-data` | l-source:tasks="/api/tasks" | Binds a REST collection into the scope as `<name>`, `<name>Loading`, `<name>Error` and the `$<name>` CRUD controller. See below.
  // @ui:directive l-text | — | any element | l-text="count" | Writes the value to `textContent`; `null` and `undefined` write an empty string.
  // @ui:directive l-html | — | any element | l-html="body" | Writes the value to `innerHTML`, unsanitized — never pass user input. The dev engine reports every use.
  // @ui:directive l-bind:<attr> | :<attr> | any element | :disabled="loading" | Binds one attribute. `class` and `style` take a string, an array or an object and merge with what is there: each run removes only what its previous run set, so static markup, `l-show` and controllers keep theirs. Boolean attributes are added or removed; `null`, `undefined` and `false` remove the attribute.
  // @ui:directive l-on:<event> | @<event> | any element | @click="count++" | Adds a listener for `<event>`. Inside the expression `$event` is the DOM event.
  // @ui:directive l-model | — | an input, textarea or select, or `[data-ui="switch"]` | l-model="name" | Two-way binding. A checkbox bound to an array is a checkbox group; radios bind by value; `<select multiple>` is not handled. The modifiers below apply to the text-like branch (input, textarea, number) only.
  // @ui:directive l-show | — | any element | l-show="open" | Toggles `display: none`, leaving the element in the DOM. Runs `l-transition` on each flip.
  // @ui:directive l-if | — | a `<template>` element | <template l-if="open"> | Inserts and removes the template's content. Removal tears the subtree down: cleanups run and in-flight `l-source` requests abort.
  // @ui:directive l-for | — | a `<template>` element | <template l-for="(task, i) in tasks"> | Repeats the template's content once per item, with the item and index names bound in a child scope.
  // @ui:directive l-key | — | the same `<template>` as `l-for` | l-key="task.id" | The reconciliation key. Without it items are matched by position, so a reorder re-renders rather than moves; the dev engine reports that case.
  // @ui:directive l-ref | — | any element | l-ref="field" | Registers the element on the scope's `$refs` under that name — also from inside `l-if`, `l-for` and `l-teleport`, where the scope is the enclosing one. In an `l-for` the last row rendered wins, and the ref is cleared when that row goes. Effects that read it re-run when it appears or goes.
  // @ui:directive l-effect | — | any element | l-effect="document.title = title" | Runs the expression immediately, then again whenever a value it read changes.
  // @ui:directive l-cloak | — | any element | l-cloak | Removed from every element once the tree is initialized. Faqir's CSS (`base/reset.css`) hides `[l-cloak]` until then; the engine injects no style, so a page without that CSS needs its own `[l-cloak] { display: none }` rule.
  // @ui:directive l-transition | — | an `l-show` element, or a top-level element inside a `<template l-if>` | l-transition="slide-up" | Names the motion preset for that element's enter/leave cycle. The engine only stamps `data-motion`; the CSS animates.
  // @ui:directive l-teleport | — | any element | l-teleport="body" | Moves the element into the first element matching the value, which is a plain CSS selector rather than an expression.
  //
  // @ui:modifier l-model .number | Casts the input value with `parseFloat` (`0` when it does not parse).
  // @ui:modifier l-model .trim | Trims the input value before assigning.
  // @ui:modifier l-model .lazy | Binds on `change` instead of `input`.
  // @ui:modifier l-model .debounce | Debounces the write by 300ms. Fixed — unlike `l-on`, this one reads no time.
  // @ui:modifier l-on .prevent | `preventDefault()` before the expression runs.
  // @ui:modifier l-on .stop | `stopPropagation()` before the expression runs.
  // @ui:modifier l-on .self | Ignores the event unless `event.target` is the element itself.
  // @ui:modifier l-on .once | Listener option `once` — removed after it fires.
  // @ui:modifier l-on .capture | Listener option `capture`.
  // @ui:modifier l-on .passive | Listener option `passive`.
  // @ui:modifier l-on .window | Listens on `window` instead of the element.
  // @ui:modifier l-on .document | Listens on `document` instead of the element.
  // @ui:modifier l-on .debounce | Debounces the handler, 250ms by default. A custom time is part of the same modifier — `.debounce500ms`, `.debounce2s`. A dotted `.debounce.500ms` is TWO modifiers and the time is ignored.
  // @ui:modifier l-on .throttle | Throttles the handler, 250ms by default. Takes a time the same way — `.throttle1s`.
  // @ui:modifier l-source .lazy | Skips the load on init — the collection stays empty until `$<name>.load()`.
  // @ui:modifier l-source .optimistic | Applies create/update/remove to the local array first and rolls back if the request fails.
  // @ui:modifier l-source .poll | Re-loads on an interval, 30000ms by default. Takes the interval: `.poll.5000`.
  // @ui:modifier l-source .key | Names the identity property, `id` by default: `.key.uuid`.
  //
  // @ui:magic $el | every expression | The scope ROOT — the element carrying `l-data`, not the element the expression is written on. Every magic that walks the DOM starts from here.
  // @ui:magic $this | every expression | The element the directive is written on — the `<input>` carrying `l-init`, the button carrying `@click`. In `l-data` and a root's `l-init` it is the root; in `l-for`'s list and `l-key` expressions, the `<template>`. Not a scope key, so `Faqir.magic()` cannot shadow it.
  // @ui:magic $refs | every expression | The scope's `l-ref` elements, keyed by name. Cleared entry by entry as elements are destroyed.
  // @ui:magic $store | every expression | Every store registered with `Faqir.store()`.
  // @ui:magic $state | every expression | `data-state` of the `[data-ui]` closest to the scope root. Writable — assigning sets the attribute — and reads re-run when a controller changes it.
  // @ui:magic $variant | every expression | `data-variant` of the same `[data-ui]`, writable and observed the same way.
  // @ui:magic $ui | every expression | The controller API of that same `[data-ui]` — `$ui.open()`. Also callable, to reach ANOTHER component's controller by CSS selector: `$ui('#detail-drawer').open()`, which returns `null` when nothing matches or the match has no controller. `Faqir.ui(selectorOrElement)` is the same lookup from plain JavaScript.
  // @ui:magic $dispatch | every expression | `$dispatch('name', detail)` fires a bubbling, composed `CustomEvent` from the scope root.
  // @ui:magic $nextTick | every expression | `$nextTick(fn)` queues `fn` as a microtask, so it runs after the effects a mutation queued have flushed and the DOM is updated.
  // @ui:magic $watch | every expression | `$watch('key', function (value, old) { … })` — returns a disposer.
  // @ui:magic $id | every expression | `$id('label')` returns `faqir-<scope>-label`, stable for the scope and unique across scopes.
  // @ui:magic $event | `l-on` expressions only | The DOM event being handled. Set for the duration of the handler and deleted again after it, so it reads as `undefined` anywhere else.
  // @ui:magic $scope | internal | the evaluator compiles every expression to `with($scope) { … }`, so the name runs through the engine source as that compiled function's own parameter. Page code never writes it.
  // @ui:magic $modelValue | internal | `l-model`'s transport slot. The value a control produces is placed here and the assignment compiles to `prop = $modelValue`, so what the user typed is never spliced into source and never reaches the compiler. Set for the duration of one write and deleted after it; page code never sees it.
  //
  // --- 3.1 Attribute Parsing ---

  function parseDirectives(el) {
    var directives = [];

    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      var name = attr.name;
      var directive = null;

      if (name.startsWith('l-')) {
        if (name.startsWith('l-bind:')) {
          var rest = name.slice(7);
          var parts = rest.split('.');
          directive = {
            type: 'bind',
            arg: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        } else if (name.startsWith('l-on:')) {
          var rest = name.slice(5);
          var parts = rest.split('.');
          directive = {
            type: 'on',
            arg: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        } else if (name.startsWith('l-source:')) {
          var rest = name.slice(9);
          var parts = rest.split('.');
          directive = {
            type: 'source',
            arg: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        } else {
          var rest = name.slice(2);
          var parts = rest.split('.');
          directive = {
            type: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        }
      } else if (name.startsWith(':')) {
        var rest = name.slice(1);
        var parts = rest.split('.');
        directive = {
          type: 'bind',
          arg: parts[0],
          expression: attr.value,
          modifiers: parts.slice(1),
          raw: name
        };
      } else if (name.startsWith('@')) {
        var rest = name.slice(1);
        var parts = rest.split('.');
        directive = {
          type: 'on',
          arg: parts[0],
          expression: attr.value,
          modifiers: parts.slice(1),
          raw: name
        };
      }

      if (directive) directives.push(directive);
    }

    return directives;
  }

  // --- 3.2 Directive Priority ---

  var PRIORITY = {
    'data': 1,
    'source': 1,
    'for': 2,
    'if': 3,
    'bind': 10,
    'on': 10,
    'text': 10,
    'html': 10,
    'model': 10,
    'show': 10,
    'transition': 10,
    'ref': 10,
    'init': 20,
    'effect': 20,
    'cloak': 100,
    'teleport': 100
  };

  // --- 3.3 DOM Tree Walker ---

  // Directives `initScope` has already consumed by the time `initTree` gets to
  // apply the rest. Everything else written on a scope root has to be applied
  // HERE: `walkChildren` visits descendants only, so a directive on the root
  // element itself is seen by nobody else. Until 1.0 only plugin directives were
  // run here, which made `l-effect`, `l-on`, `l-text`, `l-show`, `l-bind`,
  // `l-model` and `l-ref` inert — with no error — on the one element the docs
  // point authors at ("a scope root, beside `l-data`"). [W2-1]
  var ROOT_CONSUMED = { data: 1, source: 1, init: 1 };

  // `l-init` and each `l-effect`'s first run, held back while a structural
  // render builds content that is not in the document yet. [1.1F-03]
  var pendingInits = null;

  function runInit(fn) {
    if (pendingInits) pendingInits.push(fn); else fn();
  }

  // `l-if` / `l-for` content ran its `l-init` and its effects' first pass while
  // still detached — before insertion, and before any controller inside it had
  // started — so `$ui('#x')` there was null, and an effect that read nothing
  // reactive never ran again. `render` binds and inserts, and returns the nodes
  // it inserted; their controllers start next, and only then does the held work
  // run: bindings → insertion → controllers → `l-init` / `l-effect`. A render
  // nested inside another (an `l-if` in an `l-for` row) joins the outer one,
  // which alone knows when the content is attached. Controllers are not started
  // on content that is still detached. Untracked, so nothing the held work reads
  // subscribes the structural effect that rendered it. [1.1F-03]
  function renderThenInit(render) {
    if (pendingInits) return render();
    var queue = pendingInits = [];
    var nodes;
    try { nodes = render(); } finally { pendingInits = null; }
    untrack(function() {
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 1 && nodes[i].isConnected) startControllers(nodes[i]);
      }
      for (var q = 0; q < queue.length; q++) queue[q]();
    });
  }

  function initTree(root, parentScope) {
    var scope = initScope(root, parentScope);

    var rootDirectives = parseDirectives(root);
    rootDirectives.sort(function(a, b) {
      return (PRIORITY[a.type] || 10) - (PRIORITY[b.type] || 10);
    });
    for (var i = 0; i < rootDirectives.length; i++) {
      var rootDir = rootDirectives[i];
      if (ROOT_CONSUMED[rootDir.type]) continue;
      // `l-if` / `l-for` claim the element they sit on and re-render it from a
      // template. A scope root is not a template slot — it is the thing the
      // structural directive would have to destroy — so they stay the parent
      // walk's business and are skipped rather than applied to `root` itself.
      if (rootDir.type === 'if' || rootDir.type === 'for') continue;
      applyDirective(root, rootDir, scope);
    }

    walkChildren(root, scope);
  }

  function walkChildren(el, scope) {
    var children = [].slice.call(el.children);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];

      // Skip elements already initialized by l-for or l-if — or teleported here
      // by an earlier sibling's l-teleport, which bound them (and, with an
      // l-data of their own, scoped them) on the way out.
      if (child.__faqirStray || (child.__faqirScope && !child.hasAttribute('l-data'))) {
        continue;
      }

      // Only l-data creates a new scope boundary.
      // data-ui elements inherit the parent scope so directives
      // inside Faqir components can access the enclosing reactive data.
      if (child.hasAttribute('l-data')) {
        initTree(child, scope);
        continue;
      }

      processElement(child, scope);
      // Skip walkChildren if structural directive (l-if/l-for) removed the element
      if (child.parentNode) {
        walkChildren(child, scope);
      }
    }
  }

  // Directives that live OUTSIDE every scope root.
  //
  // Bootstrap only ever walked out from `[l-data]` / `[data-ui]` elements, so an
  // attribute on anything else was parsed by nobody. The canonical `l-validate`
  // markup — `<form l-validate>` wrapping a `[data-ui="field-group"]`, straight
  // out of the plugin's own documentation — has no `l-data` anywhere, which is
  // why the plugin looked "completely inert": it was registered, the attribute
  // was on the form, and no code path ever reached the form to apply it. Same
  // for a bare `@click` or `l-text` on a page that never declared a scope.
  //
  // This sweep binds them against the implicit document scope. It stops at any
  // element that already owns a scope — that subtree was walked from its own
  // root — so it visits only the parts of the page nothing else claimed. [W2-1]
  function walkUnscoped(el, scope) {
    var children = [].slice.call(el.children);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      // `__faqirStray` is this sweep's equivalent of `__faqirScope`: stray
      // elements never get a scope of their own, so without a mark a second
      // `Faqir.start()` re-bound every one of them and each `@click` fired
      // twice. The subtree was walked with it the first time, so skipping the
      // element skips the subtree too. [W3-1]
      if (child.__faqirScope || child.__faqirStray) continue;
      child.__faqirStray = true;
      processElement(child, scope);
      if (child.parentNode) walkUnscoped(child, scope);
    }
  }

  // The scope those stray directives evaluate against: empty data, magics rooted
  // at `<body>`. Created once, on first use, so a page with no stray directive
  // pays nothing for it.
  var strayScope = null;

  // The element a scope's `$refs` live on, keyed by the scope object. Not
  // `findScopeRoot`: `__faqirScope` also marks "already initialised", so an
  // `l-if` clone or an `l-for` row carries it too, and a ref resolved by walking
  // up landed on the clone while `$refs` read the real root — invisible. A
  // teleported element has left the root's subtree, and a stray element has no
  // stamped ancestor at all. A WeakMap rather than a scope property, because a
  // read through the reactive scope inside a structural effect would subscribe
  // it. [1.1F-01]
  var scopeRoots = new WeakMap();

  function getStrayScope() {
    if (!strayScope) {
      if (!document.body.__scopeId) document.body.__scopeId = ++scopeCounter;
      if (!document.body.__faqirCleanups) document.body.__faqirCleanups = [];
      // Deliberately NOT stored as `document.body.__faqirScope`: `findParentScope`
      // would then answer "yes, scoped" for every element on the page and the
      // MutationObserver would stop giving standalone `[data-ui]` islands their
      // own scope.
      strayScope = createScopeWithMagics({}, document.body, document.body);
      scopeRoots.set(strayScope, document.body);
    }
    return strayScope;
  }

  function processElement(el, scope) {
    var directives = parseDirectives(el);
    if (directives.length === 0) return;

    directives.sort(function(a, b) {
      return (PRIORITY[a.type] || 10) - (PRIORITY[b.type] || 10);
    });

    // Structural directives take over the element — and both anchor a comment
    // where the element stands, so an element that no longer stands anywhere has
    // nothing to do. A `<template l-for>` is replaced by its own anchor the first
    // time it renders, and the MutationObserver is handed that detached template
    // one microtask later. [W2-1]
    for (var i = 0; i < directives.length; i++) {
      if (directives[i].type === 'if') {
        if (el.parentNode) handleIf(el, directives[i], scope);
        return;
      }
      if (directives[i].type === 'for') {
        if (el.parentNode) handleFor(el, directives[i], scope);
        return;
      }
    }

    for (var i = 0; i < directives.length; i++) {
      applyDirective(el, directives[i], scope);
    }
  }

  // --- 3.4 l-data / Scope Initialization ---

  function initScope(root, parentScope) {
    var expr = root.getAttribute('l-data');
    var userData = {};

    if (expr) {
      if (dataRegistry.has(expr)) {
        userData = dataRegistry.get(expr)();
      } else if (expr.trim()) {
        userData = evaluate(expr, parentScope || {}, root) || {};
      }
    }

    var propData = readProps(root);
    Object.assign(userData, propData);

    var scopeId = ++scopeCounter;
    var scope = createScopeWithMagics(userData, root, root);
    scopeRoots.set(scope, root);
    root.__faqirScope = scope;
    root.__scopeId = scopeId;
    root.__faqirCleanups = [];

    // A data source spread into `l-data` can own timers, sockets or in-flight
    // requests, and until 1.0 nothing gave it a way to be told the scope had
    // gone: `apiSource()`'s `setInterval` poll and its `fetch` calls simply
    // outlived the element, which on an SPA route change means one live poller
    // per page the user ever visited. Any own `__faqirTeardown` function on the
    // scope data is run on teardown — namespaced so no ordinary data key can be
    // mistaken for one. [W3-1]
    if (typeof userData.__faqirTeardown === 'function') {
      var sourceTeardown = userData.__faqirTeardown;
      addCleanup(root, function() { sourceTeardown(); });
    }

    // Set up bidirectional bridge for $state/$variant
    setupStateBridge(root, scope);

    // Process l-source directives (inject data + controller into scope)
    processSourceDirectives(root, scope);

    var initExpr = root.getAttribute('l-init');
    if (initExpr) {
      runInit(function() { evaluateAssignment(initExpr, scope, root); });
    }

    return scope;
  }

  function readProps(el) {
    var props = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (attr.name.startsWith('data-prop-')) {
        var key = attr.name.slice(10).replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); });
        try {
          props[key] = JSON.parse(attr.value);
        } catch (e) {
          props[key] = attr.value;
        }
      }
    }
    return props;
  }

  function createScopeWithMagics(data, el, root) {
    var magics = Object.create(null);

    Object.defineProperties(magics, {
      $el: { get: function() { return el; }, enumerable: false },
      $refs: { get: function() { return getScopeRefs(root); }, enumerable: false },
      $store: { get: function() { return globalStores; }, enumerable: false },
      $state: {
        get: function() { return closestUI(el) ? closestUI(el).dataset.state : undefined; },
        set: function(v) { var ui = closestUI(el); if (ui) ui.dataset.state = v; },
        enumerable: false
      },
      $variant: {
        get: function() { return closestUI(el) ? closestUI(el).dataset.variant : undefined; },
        set: function(v) { var ui = closestUI(el); if (ui) ui.dataset.variant = v; },
        enumerable: false
      },
      $ui: { get: function() { return uiHandle(el); }, enumerable: false },
      $dispatch: {
        value: function(event, detail) {
          return el.dispatchEvent(
            new CustomEvent(event, { detail: detail, bubbles: true, composed: true })
          );
        },
        enumerable: false
      },
      $nextTick: {
        value: function(fn) { return queueMicrotask(fn || function() {}); },
        enumerable: false
      },
      $watch: {
        value: function(key, cb) {
          var dispose = watchProperty(scope, key, cb);
          // `$watch` handed its disposer back and nothing ever held one, so a
          // watcher created in `l-init` — the documented place to create one —
          // outlived every teardown and kept firing against a dead scope.
          // Registering it here makes `Faqir.destroy()` stop it; the return
          // value still works for callers that dispose by hand. [W3-1]
          addCleanup(root, dispose);
          return dispose;
        },
        enumerable: false
      },
      $id: {
        value: function(name) { return 'faqir-' + root.__scopeId + '-' + name; },
        enumerable: false
      }
    });

    // Plugins register a magic without reaching into scope internals. Resolve
    // it lazily so the callback receives the final reactive scope, not the
    // pre-proxy target that exists while this object is being assembled.
    customMagics.forEach(function(callback, name) {
      var key = '$' + name;
      if (Object.prototype.hasOwnProperty.call(magics, key)) return;
      Object.defineProperty(magics, key, {
        get: function() { return callback(el, scope); },
        enumerable: false
      });
    });

    // Use defineProperties instead of Object.assign to preserve getters/setters
    // (Object.assign invokes getters and copies the result as a static value).
    var target = Object.create(magics);
    var descriptors = Object.getOwnPropertyDescriptors(data);
    Object.defineProperties(target, descriptors);

    var scope = reactive(target);
    // A bare call `pick()` inside `with(rowScope)` gets the l-for row scope as
    // `this`, and that scope owns the loop variable and index: `this.item = x`
    // wrote the row instead of the component. Bind each own method to the
    // scope. Getters keep their receiver; functions assigned later stay
    // unbound. Written to the target, so nothing is triggered. [1.1F-05]
    for (var k in descriptors) {
      var d = descriptors[k];
      if (d.writable && typeof d.value === 'function') target[k] = d.value.bind(scope);
    }
    return scope;
  }

  function watchProperty(scope, key, cb) {
    var oldValue = scope[key];
    var dispose = effect(function() {
      var newValue = scope[key];
      if (newValue !== oldValue) {
        var prev = oldValue;
        oldValue = newValue;
        cb(newValue, prev);
      }
    });
    return dispose;
  }

  // --- Scope utilities ---

  // Created on first read, so an effect that reads a ref before it exists
  // subscribes to the same object `handleRef` later writes through.
  function getScopeRefs(root) {
    return root.__faqirRefs || (root.__faqirRefs = {});
  }

  function findScopeRoot(el) {
    var node = el;
    while (node) {
      if (node.__faqirScope) return node;
      node = node.parentElement;
    }
    return el;
  }

  // The nearest ancestor (inclusive) that OWNS a cleanup list.
  //
  // A different question from `findScopeRoot`, and the reason four disposers
  // went missing. Cleanup ownership follows the `__faqirCleanups` array —
  // stamped by `initScope`, `handleIf`, `handleFor` and `handleTeleport` —
  // rather than the scope object, because the two do not always sit on the same
  // element: `l-teleport` moves a subtree out of its scope root, so every
  // directive bound underneath it resolved to no owner at all and its disposer
  // was dropped on the floor. [W3-1]
  function findCleanupRoot(el) {
    var node = el;
    while (node) {
      if (node.__faqirCleanups) return node;
      node = node.parentNode;
    }
    return null;
  }

  /**
   * Register `cleanupFn` against the element that owns `el`'s teardown.
   *
   * `owner` is the escape hatch for the detached case. `l-if` and `l-for` insert
   * an anchor comment and then `el.remove()` their own `<template>`, so by the
   * time the list effect is registered `el` has no parent, resolves to no owner,
   * and the disposer is discarded — `Faqir.destroy()` could not stop a list that
   * went on re-rendering into the live document after teardown, contradicting
   * what `faqir-core.d.ts` promises. Callers that detach capture the owner
   * BEFORE they do and pass it here. [W3-1]
   */
  function addCleanup(el, cleanupFn, owner) {
    var root = owner || findCleanupRoot(el);
    if (root && root.__faqirCleanups) {
      root.__faqirCleanups.push(cleanupFn);
    }
  }

  // Run one node's cleanups exactly once. The list is emptied BEFORE it runs, so
  // a cleanup that tears down its own subtree re-entrantly finds nothing left to
  // do rather than disposing everything twice. One failing disposer must not
  // strand the ones behind it — teardown is the path where a half-finished job
  // is the leak.
  function runCleanups(node) {
    var list = node.__faqirCleanups;
    if (!list || list.length === 0) return;
    node.__faqirCleanups = [];
    for (var i = 0; i < list.length; i++) {
      try {
        list[i]();
      } catch (e) {
        console.error('[Faqir] a cleanup threw during teardown', node, e);
      }
    }
  }

  /**
   * Tear down `el` and everything under it.
   *
   * Walks CHILD NODES, not `querySelectorAll('*')`. `l-if` and `l-for` own their
   * subtree through an anchor COMMENT — that is the node their list effect's
   * disposer is registered on — and an element-only walk cannot see a comment,
   * so `Faqir.destroy()` left both structural directives running: the effect
   * stayed subscribed and went on re-rendering into a document nothing was
   * supposed to be driving any more. [W3-1]
   */
  function destroyScope(el) {
    if (!el) return;
    runCleanups(el);
    var child = el.firstChild;
    while (child) {
      // Read the sibling first: a cleanup is allowed to remove its own node.
      var next = child.nextSibling;
      destroyScope(child);
      child = next;
    }
  }

  // --- 3.5 l-source Directive ---

  function processSourceDirectives(root, scope) {
    for (var i = 0; i < root.attributes.length; i++) {
      var attr = root.attributes[i];
      if (!attr.name.startsWith('l-source:')) continue;

      var rest = attr.name.slice(9);
      var parts = rest.split('.');
      var sourceName = parts[0];
      var modifiers = parts.slice(1);
      var endpoint = attr.value;

      var opts = parseSourceModifiers(modifiers);
      setupSource(scope, root, sourceName, endpoint, opts);
    }
  }

  function parseSourceModifiers(modifiers) {
    var opts = { lazy: false, optimistic: false, idKey: 'id', pollInterval: 0 };

    for (var i = 0; i < modifiers.length; i++) {
      var mod = modifiers[i];
      if (mod === 'lazy') {
        opts.lazy = true;
      } else if (mod === 'optimistic') {
        opts.optimistic = true;
      } else if (mod === 'poll') {
        // Next modifier may be the interval in ms
        var next = modifiers[i + 1];
        if (next && /^\d+$/.test(next)) {
          opts.pollInterval = parseInt(next, 10);
          i++; // skip the number
        } else {
          opts.pollInterval = 30000; // default 30s
        }
      } else if (mod === 'key') {
        // Next modifier is the key name
        var next = modifiers[i + 1];
        if (next && !/^\d+$/.test(next)) {
          opts.idKey = next;
          i++; // skip the key name
        }
      }
    }

    return opts;
  }

  function setupSource(scope, root, name, endpoint, opts) {
    var pollTimer = null;
    var idKey = opts.idKey;
    var isOptimistic = opts.optimistic;

    // ── 0.3-08 request lifecycle ────────────────────────────────────────────
    // `destroyed` is latched true when the owning scope is torn down (an l-if
    // toggle or keyed l-for removal runs the cleanup registered below). Once
    // latched it (a) blocks new requests from starting and (b) gates every
    // async write-back so a fetch that resolves into a dead scope is a no-op.
    // `inflight` holds the AbortController of every live request so teardown
    // can cancel the actual network work, not just ignore its result.
    // `loadSeq`/`currentLoadAc` sequence read requests: a newer load() aborts
    // the previous one and only the LATEST call is allowed to land — so a slow
    // stale response can no longer clobber a fresh one (D2).
    var destroyed = false;
    var inflight = new Set();
    var loadSeq = 0;
    var currentLoadAc = null;
    var HAS_ABORT = typeof AbortController !== 'undefined';

    function beginRequest() {
      var ac = HAS_ABORT ? new AbortController() : null;
      if (ac) inflight.add(ac);
      return ac;
    }
    function endRequest(ac) {
      if (ac) inflight.delete(ac);
    }
    function signalOf(ac) {
      return ac ? ac.signal : undefined;
    }
    // Where a row is NOW — `row` by identity, else the row whose idKey is `id`.
    // Never an index saved before the request: an interleaved load()/remove()
    // shifts or replaces the list, and a stale index writes over a real row.
    function locate(id, row) {
      var items = scope[name];
      for (var i = 0; i < items.length; i++) {
        if (row ? items[i] === row : items[i] && items[i][idKey] === id) return i;
      }
      return -1;
    }

    // Inject reactive data properties into scope
    scope[name] = [];
    scope[name + 'Loading'] = false;
    scope[name + 'Error'] = null;

    // CRUD controller
    var ctrl = {
      load: function() {
        if (destroyed) return Promise.resolve();
        var mySeq = ++loadSeq;
        // Supersede the previous in-flight read: abort it so its network
        // request is cancelled; the seq guard below discards any late result.
        if (currentLoadAc) { try { currentLoadAc.abort(); } catch (e) {} }
        var ac = beginRequest();
        currentLoadAc = ac;
        scope[name + 'Loading'] = true;
        scope[name + 'Error'] = null;
        return fetch(endpoint, { signal: signalOf(ac) })
          .then(function(res) {
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            return res.json();
          })
          .then(function(data) {
            if (destroyed || mySeq !== loadSeq) return;
            scope[name] = Array.isArray(data) ? data : [data];
          })
          .catch(function(e) {
            if (destroyed || mySeq !== loadSeq) return;
            scope[name + 'Error'] = e.message;
          })
          .then(function() {
            endRequest(ac);
            if (currentLoadAc === ac) currentLoadAc = null;
            if (destroyed || mySeq !== loadSeq) return;
            scope[name + 'Loading'] = false;
          });
      },

      create: function(payload) {
        if (destroyed) return Promise.resolve(null);
        scope[name + 'Error'] = null;
        var temp = null;

        if (isOptimistic) {
          scope[name].push(Object.assign({}, payload, { _pending: true }));
          // Read back through the list: that is the handle `locate` compares.
          temp = scope[name][scope[name].length - 1];
        }

        var ac = beginRequest();
        return fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: signalOf(ac)
        })
        .then(function(res) {
          if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
          return res.json();
        })
        .then(function(created) {
          endRequest(ac);
          if (destroyed) return null;
          var at = temp ? locate(null, temp) : -1;
          if (at >= 0) {
            scope[name][at] = created;
          } else if (!temp || !created || created[idKey] == null || locate(created[idKey]) < 0) {
            // The temp row is gone when a load() replaced the list meanwhile;
            // that list may already hold the created row.
            scope[name].push(created);
          }
          return created;
        })
        .catch(function(e) {
          endRequest(ac);
          if (destroyed) return null;
          scope[name + 'Error'] = e.message;
          var at = temp ? locate(null, temp) : -1;
          if (at >= 0) scope[name].splice(at, 1);
          return null;
        });
      },

      update: function(id, payload) {
        if (destroyed) return Promise.resolve(null);
        scope[name + 'Error'] = null;
        var items = scope[name];
        var idx = locate(id);
        var snapshot = null;

        if (isOptimistic && idx >= 0) {
          snapshot = Object.assign({}, items[idx]);
          Object.assign(items[idx], payload);
        }

        var ac = beginRequest();
        return fetch(endpoint + '/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: signalOf(ac)
        })
        .then(function(res) {
          if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
          return res.json();
        })
        .then(function(updated) {
          endRequest(ac);
          if (destroyed) return null;
          var at = locate(id);
          if (at >= 0) scope[name][at] = updated;
          return updated;
        })
        .catch(function(e) {
          endRequest(ac);
          if (destroyed) return null;
          scope[name + 'Error'] = e.message;
          var at = snapshot ? locate(id) : -1;
          if (at >= 0) scope[name][at] = snapshot;
          return null;
        });
      },

      remove: function(id) {
        if (destroyed) return Promise.resolve();
        scope[name + 'Error'] = null;
        var items = scope[name];
        var idx = locate(id);
        var snapshot = null;

        if (isOptimistic && idx >= 0) {
          snapshot = items[idx];
          items.splice(idx, 1);
        }

        var ac = beginRequest();
        return fetch(endpoint + '/' + encodeURIComponent(id), { method: 'DELETE', signal: signalOf(ac) })
        .then(function(res) {
          if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
          endRequest(ac);
          if (destroyed) return;
          var at = isOptimistic ? -1 : locate(id);
          if (at >= 0) scope[name].splice(at, 1);
        })
        .catch(function(e) {
          endRequest(ac);
          if (destroyed) return;
          scope[name + 'Error'] = e.message;
          // `idx` is only a position hint here; skip if a reload restored it.
          if (snapshot && locate(id) < 0) {
            scope[name].splice(idx, 0, snapshot);
          }
        });
      },

      refresh: function() { return ctrl.load(); },

      startPolling: function(interval) {
        ctrl.stopPolling();
        if (destroyed) return;
        var ms = interval || opts.pollInterval || 30000;
        pollTimer = setInterval(function() { ctrl.load(); }, ms);
      },

      stopPolling: function() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    };

    // Inject controller as $<name>
    scope['$' + name] = ctrl;

    // Auto-load unless .lazy
    if (!opts.lazy) {
      ctrl.load();
    }

    // Auto-poll if .poll modifier present
    if (opts.pollInterval > 0) {
      ctrl.startPolling();
    }

    // Teardown on scope destruction: stop polling, latch `destroyed` so no new
    // work starts or writes back, and abort every in-flight request — no fetch
    // or timer outlives the scope that owns it (D3).
    addCleanup(root, function() {
      destroyed = true;
      ctrl.stopPolling();
      inflight.forEach(function(ac) { try { ac.abort(); } catch (e) {} });
      inflight.clear();
    });
  }

  // --- 3.6 Directive Dispatch ---

  function applyDirective(el, dir, scope) {
    switch (dir.type) {
      case 'bind':       return handleBind(el, dir, scope);
      case 'on':         return handleOn(el, dir, scope);
      case 'text':       return handleText(el, dir, scope);
      case 'html':       return handleHtml(el, dir, scope);
      case 'model':      return handleModel(el, dir, scope);
      case 'show':       return handleShow(el, dir, scope);
      case 'ref':        return handleRef(el, dir, scope);
      case 'init':       return handleInit(el, dir, scope);
      case 'effect':     return handleEffect(el, dir, scope);
      case 'source':     return; // Handled by initScope → processSourceDirectives
      // Uncloak as soon as the element is bound. Bootstrap's sweep still runs
      // (it catches elements no directive walk reaches), and so does the
      // MutationObserver's — but content rendered by `l-if`/`l-for` is bound
      // here, before it is ever inserted, so it never needs either. [W3-1]
      case 'cloak':      el.removeAttribute('l-cloak'); return;
      case 'teleport':   return handleTeleport(el, dir, scope);
      case 'transition': return; // Handled by l-show and l-if
      default:
        if (customDirectives.has(dir.type)) {
          var cleanupFn = customDirectives.get(dir.type)(el, dir, scope);
          if (typeof cleanupFn === 'function') addCleanup(el, cleanupFn);
          return;
        }
        holdDirective(el, dir, scope);
    }
  }

  // A directive nothing has registered YET, held with the scope it was bound
  // in. A plugin loaded after the boot — a slow `defer` script, an on-demand
  // `import()` — registered its directive against a tree that had already been
  // walked, and every element carrying it stayed inert with no error.
  // `Faqir.directive()` now applies what was held for its name, exactly once:
  // only elements the engine actually bound (so scopes, stray markup and
  // teleports keep the scope they were bound in), and an element torn down in
  // the meantime drops out through its own cleanup. An entry leaves the set
  // when it is applied, so registering a directive twice applies nothing the
  // second time.
  var heldDirectives = new Set();

  function holdDirective(el, dir, scope) {
    var entry = [el, dir, scope];
    heldDirectives.add(entry);
    addCleanup(el, function() { heldDirectives.delete(entry); });
  }

  function registerDirective(name, handler) {
    customDirectives.set(name, handler);
    heldDirectives.forEach(function(entry) {
      if (entry[1].type === name) {
        heldDirectives.delete(entry);
        applyDirective(entry[0], entry[1], entry[2]);
      }
    });
  }

  // --- 3.6 l-text ---

  function handleText(el, dir, scope) {
    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);
      el.textContent = value == null ? '' : String(value);
    });
    addCleanup(el, cl);
  }

  // --- 3.7 l-html ---

  function handleHtml(el, dir, scope) {
    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);
      el.innerHTML = value == null ? '' : String(value);
    });
    addCleanup(el, cl);
  }

  // --- 3.8 l-bind / :attr ---

  var BOOLEAN_ATTRS = new Set([
    'disabled', 'hidden', 'checked', 'readonly', 'required', 'selected',
    'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'multiple',
    'open', 'novalidate', 'formnovalidate', 'inert'
  ]);

  // Properties whose live state stops following the attribute once the user
  // has touched the control (the "dirty" flag), so an attribute-only write
  // leaves a stale control. `muted` and `indeterminate` have no attribute at all.
  var PROPS = new Set(['checked', 'selected', 'muted', 'indeterminate', 'value']);

  // Write a DOM property only when it differs. `checked`/`selected` writes
  // notify with a bubbling `faqir:model` — never a native `change`, which would
  // re-enter l-model's own listener and fire user `@change` handlers on a
  // store-driven write.
  function writeProp(el, name, value) {
    if (!(name in el) || el[name] === value) return;
    el[name] = value;
    if (name === 'checked' || name === 'selected') {
      el.dispatchEvent(new CustomEvent('faqir:model', { bubbles: true }));
    }
  }

  function handleBind(el, dir, scope) {
    var attrName = dir.arg;
    // What this binding's last run set on `class`/`style`. Both merge: a run
    // applies its own classes/declarations and removes only the ones its
    // previous run set and this one dropped, so static markup, `l-show` and
    // controller writes survive a re-run. [1.1F-04]
    var prev = {};

    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);

      if (attrName === 'class') {
        prev = applyClassBinding(el, value, prev);
      } else if (attrName === 'style') {
        prev = applyStyleBinding(el, value, prev);
      } else if (BOOLEAN_ATTRS.has(attrName)) {
        if (value) {
          el.setAttribute(attrName, '');
        } else {
          el.removeAttribute(attrName);
        }
      } else {
        if (value === null || value === undefined || value === false) {
          el.removeAttribute(attrName);
        } else {
          el.setAttribute(attrName, String(value));
        }
      }
      if (PROPS.has(attrName)) {
        writeProp(el, attrName, attrName === 'value'
          ? (value == null || value === false ? '' : String(value))
          : !!value);
      }
    });

    addCleanup(el, cl);
  }

  // A `:class` value as { class: on }. Strings and arrays turn classes on; an
  // object entry sets its own, so a falsy one removes a class markup set.
  function classMap(v, out, on) {
    if (typeof v === 'string') {
      v.split(/\s+/).forEach(function(c) { if (c) out[c] = on; });
    } else if (Array.isArray(v)) {
      v.forEach(function(x) { if (x) classMap(x, out, true); });
    } else if (v && typeof v === 'object') {
      for (var k in v) classMap(k, out, !!v[k]);
    }
    return out;
  }

  function applyClassBinding(el, value, prev) {
    var next = classMap(value, {}, true), c;
    for (c in prev) if (prev[c] && !(c in next)) el.classList.remove(c);
    for (c in next) el.classList.toggle(c, next[c]);
    return next;
  }

  // A `:style` value as { property: [value, priority] }, or null to remove it.
  // A string is parsed by a detached element's CSSOM, which handles custom
  // properties, `!important`, shorthands and `;` inside `url()`.
  var styleScratch;
  function styleMap(v, out) {
    if (typeof v === 'string') {
      var s = (styleScratch || (styleScratch = document.createElement('div'))).style;
      s.cssText = v;
      for (var i = 0; i < s.length; i++) {
        out[s[i]] = [s.getPropertyValue(s[i]), s.getPropertyPriority(s[i])];
      }
    } else if (Array.isArray(v)) {
      v.forEach(function(x) { styleMap(x, out); });
    } else if (v && typeof v === 'object') {
      for (var k in v) {
        out[/^--/.test(k) ? k : k.replace(/[A-Z]/g, '-$&').toLowerCase()] =
          v[k] == null || v[k] === false ? null : [String(v[k]), ''];
      }
    }
    return out;
  }

  function applyStyleBinding(el, value, prev) {
    var next = styleMap(value, {}), p;
    for (p in prev) if (prev[p] && !(p in next)) el.style.removeProperty(p);
    for (p in next) {
      if (next[p]) el.style.setProperty(p, next[p][0], next[p][1]);
      else el.style.removeProperty(p);
    }
    return next;
  }

  // --- 3.9 l-on / @event ---

  var KEY_MAP = {
    'enter': 'Enter', 'escape': 'Escape', 'esc': 'Escape',
    'tab': 'Tab', 'space': ' ', 'delete': 'Delete', 'backspace': 'Backspace',
    'up': 'ArrowUp', 'down': 'ArrowDown', 'left': 'ArrowLeft', 'right': 'ArrowRight',
    'arrow-up': 'ArrowUp', 'arrow-down': 'ArrowDown',
    'arrow-left': 'ArrowLeft', 'arrow-right': 'ArrowRight',
    'home': 'Home', 'end': 'End', 'page-up': 'PageUp', 'page-down': 'PageDown'
  };

  function debounce(fn, ms) {
    var timer;
    return function() {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(self, args); }, ms);
    };
  }

  function throttle(fn, ms) {
    var last = 0;
    return function() {
      var now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(this, arguments);
      }
    };
  }

  function parseTimeMod(mod) {
    var match = mod.match(/(\d+)(ms|s)?/);
    if (!match) return null;
    var value = parseInt(match[1], 10);
    return match[2] === 's' ? value * 1000 : value;
  }

  function handleOn(el, dir, scope) {
    var eventName = dir.arg;
    var modifiers = new Set(dir.modifiers);

    var target = el;
    if (modifiers.has('window')) target = window;
    else if (modifiers.has('document')) target = document;

    var wrapFn = null;
    for (var m = 0; m < dir.modifiers.length; m++) {
      var mod = dir.modifiers[m];
      if (mod.startsWith('debounce')) {
        var ms = parseTimeMod(mod) || 250;
        wrapFn = function(fn) { return debounce(fn, ms); };
      } else if (mod.startsWith('throttle')) {
        var ms = parseTimeMod(mod) || 250;
        wrapFn = function(fn) { return throttle(fn, ms); };
      }
    }

    var isKey = eventName === 'keydown' || eventName === 'keyup' || eventName === 'keypress';
    var keyTarget = null;
    if (isKey) {
      for (var m = 0; m < dir.modifiers.length; m++) {
        if (KEY_MAP[dir.modifiers[m]]) {
          keyTarget = KEY_MAP[dir.modifiers[m]];
          break;
        }
      }
    }

    var handler = function(e) {
      if (modifiers.has('prevent')) e.preventDefault();
      if (modifiers.has('stop')) e.stopPropagation();
      if (modifiers.has('self') && e.target !== el) return;

      if (keyTarget && e.key !== keyTarget) return;

      scope.$event = e;
      try {
        evaluateAssignment(dir.expression, scope, el);
      } finally {
        delete scope.$event;
      }
    };

    if (wrapFn) handler = wrapFn(handler);

    var options = {};
    if (modifiers.has('once')) options.once = true;
    if (modifiers.has('capture')) options.capture = true;
    if (modifiers.has('passive')) options.passive = true;

    target.addEventListener(eventName, handler, options);
    addCleanup(el, function() { target.removeEventListener(eventName, handler, options); });
  }

  // --- 3.10 l-ref ---

  function handleRef(el, dir, scope) {
    var name = dir.expression;
    // Written through the reactive proxy, so an effect that read `$refs.name`
    // re-runs when the ref appears or goes. [1.1F-01]
    var refs = reactive(getScopeRefs(scopeRoots.get(scope) || findScopeRoot(el)));
    refs[name] = el;

    addCleanup(el, function() {
      // `__target`: a tracked read here would subscribe whichever structural
      // effect is tearing this element down.
      if (refs.__target[name] === el) {
        refs[name] = undefined;
        delete refs.__target[name];
      }
    });
  }

  // --- 3.11 l-init ---

  function handleInit(el, dir, scope) {
    runInit(function() { evaluateAssignment(dir.expression, scope, el); });
  }

  // --- 3.12 l-effect ---

  function handleEffect(el, dir, scope) {
    runInit(function() {
      addCleanup(el, effect(function() {
        evaluateAssignment(dir.expression, scope, el);
      }));
    });
  }

  // --- 3.13 l-cloak ---
  //
  // The engine injects no stylesheet. The `[l-cloak]` rule ships in
  // `base/reset.css` (so in every bundle); the injected copy it used to append
  // at boot was redundant, and the only inline style a CSP had to allow. [1.1F-07]

  /**
   * Strip `l-cloak` from `within` and everything under it (the whole document
   * when called with nothing).
   *
   * The sweep used to run exactly once, at the end of bootstrap, against a
   * document-wide selector. Anything inserted afterwards — an `l-if` branch, an
   * `l-for` row, a fragment an application appended — kept the attribute, and
   * the `[l-cloak] { display: none !important }` rule then hid it
   * permanently: content that had bound correctly and could never be seen. The
   * MutationObserver runs this over every node it is handed. [W3-1]
   */
  function removeCloaks(within) {
    var host = within || document;
    if (host.nodeType === 1 && host.hasAttribute('l-cloak')) {
      host.removeAttribute('l-cloak');
    }
    var els = host.querySelectorAll ? host.querySelectorAll('[l-cloak]') : [];
    for (var i = 0; i < els.length; i++) {
      els[i].removeAttribute('l-cloak');
    }
  }

  // --- 3.14 l-transition helpers (Transitions 2.0 — attribute-visible) [0.4-11 · §A4] ---
  //
  // The whole lifecycle is driven through ONE attribute, `data-motion`:
  //   show:  data-motion="enter"  → "enter-active" → (cleared)
  //   hide:  data-motion="leave"  → "leave-active" → (cleared, then removed)
  // registry/base/motion-presets.css styles each stage from motion tokens, so
  // transitions are auditable straight from the DOM. There are NO per-stage CSS
  // classes anywhere — state lives in an attribute and CSS reacts.

  // Named presets shipped by motion-presets.css. Unknown names still animate
  // (the attribute is stamped) but have no styling, so we warn to catch typos.
  var MOTION_PRESETS = { fade: 1, 'slide-up': 1, 'slide-down': 1, 'slide-start': 1, 'slide-end': 1, scale: 1, blur: 1, flip: 1 };

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Largest value in a computed CSS time list ("0.2s, 150ms" | "0s" | ""), in ms.
  function maxCssTimeMs(list) {
    var max = 0;
    (list || '').split(',').forEach(function(s) {
      var n = parseFloat(s);
      if (!isNaN(n)) max = Math.max(max, s.indexOf('ms') >= 0 ? n : n * 1000);
    });
    return max;
  }

  // How long to wait before force-completing a stage: the element's real
  // transition/animation duration + delay plus a small buffer. transitionend
  // wins when a transition actually runs; the timeout still settles us when the
  // property does not change, no preset CSS is loaded, or the event is missed.
  function motionTimeoutMs(el) {
    var s = getComputedStyle(el);
    return Math.max(
      maxCssTimeMs(s.transitionDuration) + maxCssTimeMs(s.transitionDelay),
      maxCssTimeMs(s.animationDuration) + maxCssTimeMs(s.animationDelay)
    ) + 50;
  }

  // Drive one enter/leave cycle purely through `data-motion` — no per-stage
  // classes. `phase` is 'enter' | 'leave'; `done` fires once the active stage
  // ends (transitionend/animationend) or the timeout fallback fires. The
  // attribute is always cleared on completion — no residue.
  function runMotion(el, phase, done) {
    done = done || function() {};

    // Call off a cycle still in flight on this element before starting a new
    // one. A toggle that arrives before the previous cycle completed used to
    // leave the old cycle's finisher armed, and it would then fire *into* the
    // new one: clearing the new `data-motion` mid-flight (so the element jumps
    // instead of animating), and — when the stale cycle was a leave — running
    // its `done`, which sets `display: none` on an element the new enter had
    // just made visible. One cancel handle per element, cleared on completion.
    if (el.__faqirMotion) el.__faqirMotion();
    el.__faqirMotion = null;

    if (prefersReducedMotion()) {
      el.removeAttribute('data-motion');
      done();
      return;
    }

    var preset = el.getAttribute('l-transition') || 'fade';
    if (!MOTION_PRESETS[preset]) {
      console.warn('[Faqir] l-transition: unknown preset "' + preset +
        '" — expected one of: ' + Object.keys(MOTION_PRESETS).join(', '));
    }

    el.setAttribute('data-motion', phase); // from-state (no transition yet)
    el.offsetHeight;                        // force reflow so the from-state commits

    var raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : function(cb) { return setTimeout(cb, 16); };

    // Cancelled between the from-state and the rAF: the next cycle has already
    // stamped its own from-state, so this one must not stamp its active stage.
    var cancelled = false;
    el.__faqirMotion = function() { cancelled = true; };

    raf(function() {
      if (cancelled) return;
      el.setAttribute('data-motion', phase + '-active'); // to-state + transition

      var finished = false;
      var timer = null;
      function teardown() {
        clearTimeout(timer);
        el.removeEventListener('transitionend', onEnd);
        el.removeEventListener('animationend', onEnd);
      }
      function finish() {
        if (finished || cancelled) return;
        finished = true;
        teardown();
        el.__faqirMotion = null;
        el.removeAttribute('data-motion');
        done();
      }
      function onEnd(e) {
        if (e.target === el) finish(); // ignore transitions bubbling from children
      }

      el.addEventListener('transitionend', onEnd);
      el.addEventListener('animationend', onEnd);
      timer = setTimeout(finish, motionTimeoutMs(el));
      el.__faqirMotion = function() { cancelled = true; teardown(); };
    });
  }

  function runEnterTransition(el) {
    runMotion(el, 'enter');
  }

  function runLeaveTransition(el, done) {
    runMotion(el, 'leave', done);
  }

  // --- 3.15 l-model ---

  function handleModel(el, dir, scope) {
    var prop = dir.expression;
    var modifiers = new Set(dir.modifiers);

    // Every branch below binds a DOM listener, and not one of them ever removed
    // it: the effect disposer was registered, the `addEventListener` was not.
    // So `Faqir.destroy()` left five live listeners writing user input back into
    // a scope nothing was supposed to be driving any more — for the life of the
    // page, on every `l-model` the page had ever mounted. One helper, so a sixth
    // branch cannot forget. [W3-1]
    function bind(eventName, handler) {
      el.addEventListener(eventName, handler);
      addCleanup(el, function() { el.removeEventListener(eventName, handler); });
    }

    var tag = el.tagName.toLowerCase();
    var type = el.getAttribute('type');
    var isFaqirSwitch = el.hasAttribute('data-ui') && el.dataset.ui === 'switch';

    if (isFaqirSwitch) {
      var cl = effect(function() {
        var value = evaluate(prop, scope, el);
        writeProp(el, 'checked', !!value);
        el.dataset.state = value ? 'on' : 'off';
        el.setAttribute('aria-checked', value ? 'true' : 'false');
      });
      // A switch is a <button role="switch">: no `checked`, and no `change`.
      bind('click', function() {
        writeModel(prop, !evaluate(prop, scope, el), scope, el);
      });
      addCleanup(el, cl);

    } else if (tag === 'input' && type === 'checkbox') {
      var cl = effect(function() {
        var current = evaluate(prop, scope, el);
        writeProp(el, 'checked', Array.isArray(current)
          ? current.indexOf(el.value) >= 0
          : !!current);
      });
      bind('change', function() {
        var current = evaluate(prop, scope, el);
        if (Array.isArray(current)) {
          var arr = current.slice();
          var idx = arr.indexOf(el.value);
          if (el.checked && idx < 0) arr.push(el.value);
          else if (!el.checked && idx >= 0) arr.splice(idx, 1);
          writeModel(prop, arr, scope, el);
        } else {
          writeModel(prop, el.checked, scope, el);
        }
      });
      addCleanup(el, cl);

    } else if (tag === 'input' && type === 'radio') {
      var cl = effect(function() {
        writeProp(el, 'checked', evaluate(prop, scope, el) === el.value);
      });
      bind('change', function() {
        if (el.checked) {
          writeModel(prop, el.value, scope, el);
        }
      });
      addCleanup(el, cl);

    } else if (tag === 'select') {
      var cl = effect(function() {
        writeProp(el, 'value', evaluate(prop, scope, el) || '');
      });
      bind('change', function() {
        writeModel(prop, el.value, scope, el);
      });
      addCleanup(el, cl);

    } else {
      // text input, textarea, number input, etc.
      var eventName = modifiers.has('lazy') ? 'change' : 'input';

      var cl = effect(function() {
        var value = evaluate(prop, scope, el);
        if (el.value !== String(value != null ? value : '')) {
          el.value = value != null ? value : '';
        }
      });

      var inputHandler = function() {
        // Trim first: `.number.trim` must not call trim() on the parsed number.
        var value = el.value;
        if (modifiers.has('trim')) value = value.trim();
        if (modifiers.has('number')) value = parseFloat(value) || 0;
        writeModel(prop, value, scope, el);
      };

      if (modifiers.has('debounce')) {
        inputHandler = debounce(inputHandler, 300);
      }

      bind(eventName, inputHandler);
      addCleanup(el, cl);
    }
  }

  // --- 3.16 l-show ---

  function handleShow(el, dir, scope) {
    var originalDisplay = el.style.display === 'none' ? '' : el.style.display;

    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);

      if (value) {
        el.style.display = originalDisplay;
        if (el.hasAttribute('l-transition')) {
          runEnterTransition(el);
        }
      } else {
        if (el.hasAttribute('l-transition')) {
          runLeaveTransition(el, function() {
            el.style.display = 'none';
          });
        } else {
          el.style.display = 'none';
        }
      }
    });

    addCleanup(el, cl);
  }

  // --- 3.17 l-if ---

  function handleIf(el, dir, scope) {
    if (el.tagName !== 'TEMPLATE') {
      console.warn('[Faqir] l-if must be used on a <template> element');
      return;
    }

    var anchor = document.createComment('l-if');
    el.parentNode.insertBefore(anchor, el);
    el.remove();

    // The anchor owns this directive's teardown.
    //
    // `el` is detached one line above, so `addCleanup(el, …)` resolved to no
    // owner and the disposer was discarded — `Faqir.destroy()` could not stop
    // an `l-if` at all. The anchor stands exactly where the template stood, so
    // it is inside the subtree `destroyScope` walks, and it survives every
    // toggle. [W3-1]
    anchor.__faqirCleanups = [];

    // EVERY node the template renders, not only the elements. Filtering to
    // `nodeType === 1` left text and comment nodes in the document on each
    // hide, so ten toggles of a two-element template left 34 child nodes where
    // 2 were expected — and each cycle added more. [W3-1]
    var insertedNodes = [];

    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);

      if (value) {
        if (insertedNodes.length === 0) renderThenInit(function() {
          var fragment = el.content.cloneNode(true);
          var nodes = [].slice.call(fragment.childNodes);

          for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType !== 1) continue;

            // A cloned top node carrying `l-data` is a scope root in its own
            // right. `processElement` has no `case 'data'` — nothing there
            // creates a scope — so the node was stamped with the ENCLOSING
            // scope, its literal never evaluated, and `processSourceDirectives`
            // never ran: `l-source` inside an `l-if` issued zero fetches.
            // `initTree` is the one path that builds a scope. [W3-1]
            if (nodes[i].hasAttribute('l-data')) {
              initTree(nodes[i], scope);
              continue;
            }

            // Mark as initialized (mirrors handleFor) so a later
            // walkChildren pass over an ancestor doesn't re-process these
            // nodes — re-processing would re-bind handlers and evaluate
            // expressions outside the scope they were rendered with.
            nodes[i].__faqirScope = scope;
            nodes[i].__faqirCleanups = nodes[i].__faqirCleanups || [];
            processElement(nodes[i], scope);
            // A top-level structural directive replaces the node with its own
            // anchor; there is then nothing left to walk into.
            if (nodes[i].parentNode) walkChildren(nodes[i], scope);
          }

          // Re-read the fragment rather than trusting the pre-processing
          // snapshot: a top-level `l-if`/`l-for` inside this template has by now
          // swapped its own <template> for an anchor plus rendered content, so
          // `nodes` describes something that no longer exists. (Same reason
          // `handleFor.createEntry` re-captures.)
          insertedNodes = [].slice.call(fragment.childNodes);
          anchor.parentNode.insertBefore(fragment, anchor.nextSibling);

          for (var i = 0; i < insertedNodes.length; i++) {
            if (insertedNodes[i].nodeType === 1 && insertedNodes[i].hasAttribute('l-transition')) {
              runEnterTransition(insertedNodes[i]);
            }
          }
          return insertedNodes;
        });
      } else {
        for (var i = 0; i < insertedNodes.length; i++) {
          var node = insertedNodes[i];
          if (node.nodeType === 1 && node.hasAttribute('l-transition')) {
            (function(n) {
              runLeaveTransition(n, function() {
                n.remove();
              });
            })(node);
          } else {
            node.remove();
          }
          destroyScope(node);
        }
        insertedNodes = [];
      }
    });

    addCleanup(el, cl, anchor);
  }

  // --- 3.18 l-for ---

  // Reactive, parent-delegating scope for a single l-for item. The item/index
  // slots are reactive so keyed reuse updates them with one property write
  // (no re-processing); every other read/write passes through to the parent
  // scope so mutations there still trigger reactivity.
  function createForItemScope(own, parentScope) {
    var deps = Object.create(null);
    return new Proxy(own, {
      get: function(target, key) {
        if (key === '__isReactive') return true;
        if (key === '__target') return target;
        if (key === '__deps') return parentScope.__deps;
        if (key in target) {
          if (currentEffect && typeof key === 'string') {
            if (!deps[key]) deps[key] = new Set();
            deps[key].add(currentEffect);
            currentEffect._deps.add(deps[key]);
          }
          var value = target[key];
          if (value !== null && typeof value === 'object' && !value.__isReactive
              && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
            return reactive(value);
          }
          return value;
        }
        return parentScope[key];
      },
      set: function(target, key, value) {
        if (key in target) {
          var old = target[key];
          if (old !== value) {
            target[key] = value;
            if (deps[key]) {
              for (var eff of deps[key]) pendingEffects.add(eff);
              scheduleFlush();
            }
          }
          return true;
        }
        parentScope[key] = value;
        return true;
      },
      has: function(target, key) {
        return (key in target) || (key in parentScope);
      }
    });
  }

  // Longest increasing subsequence of old positions (0 = freshly created entry,
  // skipped). Returns the indices of `arr` already in order — the nodes that
  // stay put across a reorder, so only the rest move. O(n log n). [0.3-06 · §A1]
  function getSequence(arr) {
    var p = arr.slice();
    var result = [0];
    var i, j, u, v, c;
    for (i = 0; i < arr.length; i++) {
      var n = arr[i];
      if (n !== 0) {
        j = result[result.length - 1];
        if (arr[j] < n) { p[i] = j; result.push(i); continue; }
        u = 0; v = result.length - 1;
        while (u < v) { c = (u + v) >> 1; if (arr[result[c]] < n) u = c + 1; else v = c; }
        if (n < arr[result[u]]) { if (u > 0) p[i] = result[u - 1]; result[u] = i; }
      }
    }
    u = result.length; v = result[u - 1];
    while (u-- > 0) { result[u] = v; v = p[v]; }
    return result;
  }

  // True when `b` is a non-identity permutation of `a` (same items, new order).
  // Drives the dev hint for unkeyed lists that reorder. [task 0.3-06 · §A1]
  // Dev-build only — production never detects the reorder. [task 0.7-12]

  function handleFor(el, dir, scope) {
    if (el.tagName !== 'TEMPLATE') {
      console.warn('[Faqir] l-for must be used on a <template> element');
      return;
    }

    var match = dir.expression.match(
      /^\s*(?:\(?\s*(\w+)\s*(?:,\s*(\w+))?\s*\)?\s+in\s+)?(.+)\s*$/
    );

    if (!match) {
      console.warn('[Faqir] Invalid l-for expression: "' + dir.expression + '"');
      return;
    }

    var itemName = match[1] || 'item';
    var indexName = match[2] || 'index';
    var listExpr = match[3];
    var keyExpr = el.getAttribute('l-key');
    // Dev hint: a loop variable that shadows a name the scope already has. Only
    // names the author wrote; `in` reads no reactive dependency. [1.1F-05]

    var anchor = document.createComment('l-for');
    el.parentNode.insertBefore(anchor, el);
    el.remove();

    // Same as `l-if`: the template is detached above, so the anchor — which
    // stands where it stood and is reachable from `destroyScope` — is what owns
    // the list effect's disposer. Registering it against the detached template
    // dropped it, and a destroyed scope went on rendering rows. [W3-1]
    anchor.__faqirCleanups = [];

    // Reconciliation key for an item. Falls back to its position when there is
    // no l-key. Untracked so key reads never subscribe the list effect to
    // individual item properties.
    function keyFor(item, i) {
      if (!keyExpr) return i;
      var ctx = Object.create(null);
      ctx[itemName] = item;
      ctx[indexName] = i;
      var proxy = new Proxy(ctx, {
        has: function(t, k) { return (k in t) || (k in scope); },
        get: function(t, k) { return (k in t) ? t[k] : scope[k]; }
      });
      return untrack(function() { return evaluate(keyExpr, proxy, el); });
    }

    // Build one item's nodes + reactive scope from the template.
    function createEntry(item, i, key) {
      var clone = el.content.cloneNode(true);
      var nodes = [].slice.call(clone.childNodes);
      var own = Object.create(null);
      own[itemName] = item;
      own[indexName] = i;
      var childScope = createForItemScope(own, scope);
      scopeRoots.set(childScope, scopeRoots.get(scope));
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].nodeType !== 1) continue;
        // A row whose top node declares `l-data` is a scope root: build it with
        // `initTree` (which evaluates the literal and reads `l-source`) instead
        // of stamping it with the row scope and leaving both inert. [W3-1]
        if (nodes[j].hasAttribute('l-data')) {
          initTree(nodes[j], childScope);
          continue;
        }
        nodes[j].__faqirScope = childScope;
        nodes[j].__faqirCleanups = [];
        processElement(nodes[j], childScope);
        if (nodes[j].parentNode) walkChildren(nodes[j], childScope);
      }
      // Re-capture the fragment's children: a top-level structural directive
      // (l-if / nested l-for) replaces its <template> with an anchor comment
      // plus rendered content INSIDE the fragment. The pre-processing `nodes`
      // snapshot would re-insert the detached template and orphan the anchor,
      // so the entry must own what the fragment actually holds now.
      return { key: key, scope: childScope, nodes: [].slice.call(clone.childNodes) };
    }

    var currentEntries = [];

    // One reconciliation. Returns the rows it built, for `renderThenInit` to
    // start their controllers and run their held inits. [1.1F-03]
    function renderList() {
      var list = evaluate(listExpr, scope, el);
      var items = Array.isArray(list) ? list :
                  typeof list === 'number' ? Array.from({ length: list }, function(_, i) { return i + 1; }) :
                  [];

      // Dev-build hint: an unkeyed list reconciles by position, so reordering it
      // rebinds per-row DOM state to the wrong items. Once per list; keyed lists
      // never reach here. Production neither warns nor snapshots the list.

      // old key -> entries holding it, in order, consumed as matched; the
      // leftovers are stale. A list rather than one entry because keys can
      // repeat: a Map of single entries overwrote the first row of a duplicate
      // pair, which then was neither reused nor removed and leaked a row per
      // render. source[i] = reused entry's old position + 1, or 0 for a fresh
      // entry (the getSequence sentinel).
      var oldMap = new Map();
      for (var i = 0; i < currentEntries.length; i++) {
        var k = currentEntries[i].key;
        if (oldMap.has(k)) oldMap.get(k).push(currentEntries[i]);
        else oldMap.set(k, [currentEntries[i]]);
      }

      var n = items.length;
      var newEntries = new Array(n);
      var source = new Array(n);
      for (var i = 0; i < n; i++) {
        var key = keyFor(items[i], i);
        var olds = oldMap.get(key);
        var entry = olds && olds.shift();
        if (entry !== undefined) {
          // Reuse in place: one write per slot, re-renders only on change.
          entry.scope[itemName] = items[i];
          entry.scope[indexName] = i;
          source[i] = entry.__i + 1;
        } else {
          entry = createEntry(items[i], i, key);
          source[i] = 0;
        }
        newEntries[i] = entry;
      }

      // Remove stale entries first so the DOM holds only reused nodes.
      oldMap.forEach(function(olds) {
        for (var e = 0; e < olds.length; e++) {
          for (var j = 0; j < olds[e].nodes.length; j++) {
            destroyScope(olds[e].nodes[j]);
            olds[e].nodes[j].remove();
          }
        }
      });

      // Place back-to-front, inserting before `anchor` (the trailing marker).
      // Entries in the longest increasing subsequence of old positions are
      // already ordered and never move; the rest insert before their placed
      // successor — the minimum number of DOM moves.
      var seq = getSequence(source);
      var sj = seq.length - 1;
      var nextNode = anchor;
      for (var i = n - 1; i >= 0; i--) {
        var entry = newEntries[i];
        if (source[i] === 0 || sj < 0 || i !== seq[sj]) {
          for (var j = 0; j < entry.nodes.length; j++) {
            anchor.parentNode.insertBefore(entry.nodes[j], nextNode);
          }
        } else {
          sj--;
        }
        entry.__i = i;
        nextNode = entry.nodes[0];
      }

      currentEntries = newEntries;
      var fresh = [];
      for (var i = 0; i < n; i++) if (!source[i]) fresh.push.apply(fresh, newEntries[i].nodes);
      return fresh;
    }

    var cl = effect(function() { renderThenInit(renderList); });

    addCleanup(el, cl, anchor);
  }

  // --- 3.19 l-teleport ---

  function handleTeleport(el, dir, scope) {
    // Teleporting moves the element OUT of its scope root's subtree, so from
    // here on `findCleanupRoot` walking up from anything inside it lands
    // somewhere else entirely — every disposer bound below a teleport was
    // dropped, and `destroyScope` on the scope root could never have reached
    // the nodes anyway. Two moves fix both halves: the subtree owns its own
    // cleanup list from now on, and the scope that WROTE the teleport keeps a
    // handle that tears that list down. [W3-1]
    var owner = el.parentNode ? findCleanupRoot(el.parentNode) : null;
    if (!el.__faqirCleanups) el.__faqirCleanups = [];

    // The teleported subtree belongs to the scope that wrote the directive, but
    // it now sits somewhere the scope-root sweep will never look — so the
    // unscoped sweep would find it "unclaimed" and bind every directive under it
    // a SECOND time, against the document scope, where the expressions do not
    // resolve. Claiming it here is what tells that sweep to walk past. [W3-1]
    el.__faqirStray = true;

    var cl = effect(function() {
      var target = document.querySelector(dir.expression);
      if (target && el.parentNode !== target) {
        target.appendChild(el);
      }
    });
    addCleanup(el, cl);

    if (owner && owner !== el) {
      addCleanup(el, function() {
        destroyScope(el);
        el.remove();
      }, owner);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Section 4-5: Faqir Bridge ($state, $variant, $ui)
  // ═══════════════════════════════════════════════════════

  function closestUI(el) {
    if (!el) return null;
    if (el.hasAttribute && el.hasAttribute('data-ui')) return el;
    return el.closest ? el.closest('[data-ui]') : null;
  }

  function getControllerApi(uiEl) {
    if (!uiEl) return null;
    var keys = Object.keys(uiEl);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].startsWith('_faqir')) {
        return uiEl[keys[i]];
      }
    }
    return null;
  }

  /**
   * `$ui`, in both of its forms. [W2-6]
   *
   * `$ui.open()` — unchanged: the controller of the `[data-ui]` this expression
   * sits inside. That is the only thing `$ui` could ever reach, and it is why
   * opening a detail drawer from a table row — the most common admin pattern
   * there is — had no expression that could say it. The page had to invent a
   * global store and an `l-effect` handshake to carry "the user clicked row 7"
   * across two components that were both right there in the DOM.
   *
   * `$ui('#detail-drawer').open()` — the same controller API, for a component
   * named by a CSS selector. Any selector: an id is the useful case, but
   * `$ui('[data-ui="drawer"]')` resolves the first drawer on the page just as
   * well. The selector may match the `[data-ui]` element itself or anything
   * inside it; either way the nearest enclosing component's controller answers.
   *
   * Returns `null` when nothing matches or the match has no controller, so
   * `$ui('#gone')?.open()` is the safe form and a typo cannot throw.
   */
  function resolveUi(target) {
    var node = typeof target === 'string' ? document.querySelector(target) : target;
    return node ? getControllerApi(closestUI(node)) : null;
  }

  function uiHandle(el) {
    var local = getControllerApi(closestUI(el));
    // A callable, with the local controller's own methods hung off it so both
    // forms read from one name. The methods are closures over their controller's
    // state, never `this`-bound, so carrying the reference is enough.
    var handle = function(target) { return resolveUi(target); };
    if (local) for (var key in local) handle[key] = local[key];
    return handle;
  }

  function setupStateBridge(root, scope) {
    var uiEl = root.hasAttribute('data-ui') ? root : (root.closest ? root.closest('[data-ui]') : null);
    if (!uiEl) return;

    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var attr = mutations[i].attributeName;
        if (attr === 'data-state' || attr === 'data-variant') {
          triggerStateDeps(scope);
        }
      }
    });

    observer.observe(uiEl, {
      attributes: true,
      attributeFilter: ['data-state', 'data-variant']
    });

    addCleanup(root, function() { observer.disconnect(); });
  }

  function triggerStateDeps(scope) {
    var deps = scope.__deps;
    if (!deps) return;
    if (deps['$state']) {
      for (var eff of deps['$state']) {
        pendingEffects.add(eff);
      }
      scheduleFlush();
    }
    if (deps['$variant']) {
      for (var eff of deps['$variant']) {
        pendingEffects.add(eff);
      }
      scheduleFlush();
    }
  }

  // ═══════════════════════════════════════════════════════
  // Section 6: Core Utilities
  // ═══════════════════════════════════════════════════════

  // --- From dom.js ---
  var $$ = function(selector, scope) { return [].slice.call((scope || document).querySelectorAll(selector)); };

  // A part's owner is its nearest [data-ui] above it that is not a layout
  // primitive, starting from the parent since a part may carry data-ui itself.
  // Same selector as registry/core/dom.js `owns`.
  var OWNER = '[data-ui]:not([data-ui=stack],[data-ui=cluster],[data-ui=grid],[data-ui=container],[data-ui=surface],[data-ui=switcher],[data-ui=aspect-ratio])';

  function ownParts(root, part) {
    return $$("[data-part='" + part + "']", root).filter(function(el) {
      return el.parentElement.closest(OWNER) === root;
    });
  }

  // --- From events.js ---
  function onOutsideClick(el, handler) {
    function listener(e) { if (!el.contains(e.target)) handler(e); }
    document.addEventListener('pointerdown', listener);
    return function() { document.removeEventListener('pointerdown', listener); };
  }

  // --- From focus.js ---
  var FOCUSABLE = [
    'a[href]:not([tabindex="-1"])',
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function getFocusableElements(container) {
    return [].slice.call(container.querySelectorAll(FOCUSABLE)).filter(function(el) {
      return !el.closest('[hidden]') && el.offsetParent !== null;
    });
  }

  function focusFirst(container) {
    var els = getFocusableElements(container);
    if (els.length > 0) { els[0].focus(); return true; }
    return false;
  }

  function trapFocus(container) {
    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      var focusable = getFocusableElements(container);
      if (focusable.length === 0) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    container.addEventListener('keydown', onKeyDown);
    return function() { container.removeEventListener('keydown', onKeyDown); };
  }

  // Back to the opener once an overlay has closed, unless focus moved on while
  // it closed (`active` was read before the panel hid) or the opener is gone.
  function returnFocus(root, target, active) {
    if ((!active || active === document.body || root.contains(active)) &&
        target && target.isConnected && !target.closest('[hidden]')) target.focus();
  }

  // --- From motion.js (prefersReducedMotion already defined in Section 3.14) ---
  // The four events an exit can end with, in one list: bound and unbound
  // together, so neither half can drift from the other.
  var EXIT_EVENTS = ['transitionend', 'transitioncancel', 'animationend', 'animationcancel'];

  // Largest number in a comma-separated CSS time list, in ms ("0.3s, 150ms" → 300).
  function longestTimeMs(value) {
    var parts = String(value == null ? '' : value).split(',');
    var max = 0;
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i].trim();
      var n = parseFloat(raw);
      if (isNaN(n)) continue;
      if (raw.indexOf('ms') === -1) n *= 1000;
      if (n > max) max = n;
    }
    return max;
  }

  // An upper bound on how long `el`'s motion can run: the longest transition or
  // animation plus the longest delay. Deliberately an over-estimate — it sizes a
  // fallback timer, and a fallback that fires early is worse than one that fires
  // late.
  function longestMotionMs(style) {
    var transition = longestTimeMs(style.transitionDuration) + longestTimeMs(style.transitionDelay);
    var animation = longestTimeMs(style.animationDuration) + longestTimeMs(style.animationDelay);
    return transition > animation ? transition : animation;
  }

  /**
   * Run `done` once `el` has finished its exit motion — the single place every
   * "closing → closed" controller waits.
   *
   * `transitionend` BUBBLES. A panel that contains a button — every dialog,
   * drawer and sheet in the registry ships one, and the drawer manifest marks
   * the close button `required` — receives that button's own `background`
   * transitionend the instant a pointer lands on it. A one-shot listener spends
   * itself on that event and the panel's own `transform` transitionend, when it
   * arrives, finds nobody listening. The drawer therefore never finalised
   * `closing → closed` through the one control it tells you not to remove: the
   * overlay stayed up, `body` stayed at `overflow: hidden`, the page was dead.
   *
   * So four rules, all of them load-bearing:
   *   • only `el`'s OWN motion counts (`e.target === el`) — descendants bubble;
   *   • only `property`, when one is named — sibling properties on the same
   *     element finish at their own times;
   *   • `transitioncancel` / `animationcancel` count as over — an interrupted
   *     transition never sends `transitionend` at all;
   *   • a timer sized from the computed duration runs `done` even if no event
   *     ever arrives (backgrounded tab, `display` change mid-flight).
   *
   * `done` runs at most once — synchronously and immediately when there is no
   * motion to wait for. Returns a canceller for a re-entrant open. [W2-1]
   */
  function whenExitDone(el, property, done) {
    var settled = false;
    var timer = null;

    function unbind() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      for (var i = 0; i < EXIT_EVENTS.length; i++) el.removeEventListener(EXIT_EVENTS[i], onMotionEvent);
    }

    function settle() {
      if (settled) return;
      settled = true;
      unbind();
      done();
    }

    function onMotionEvent(e) {
      if (e.target !== el) return;
      if (property && e.propertyName && e.propertyName !== property) return;
      settle();
    }

    var ms = 0;
    try {
      ms = longestMotionMs(getComputedStyle(el));
    } catch (err) {
      // No computed style (a bare test DOM) — treat it as "no motion".
    }

    if (!(ms > 0)) { settle(); return function() {}; }

    for (var i = 0; i < EXIT_EVENTS.length; i++) el.addEventListener(EXIT_EVENTS[i], onMotionEvent);
    // A couple of frames of slack before the fallback takes over from the event.
    timer = setTimeout(settle, ms + 50);

    return function cancelExitWait() {
      if (settled) return;
      settled = true;
      unbind();
    };
  }

  // --- From utils.js (debounce/throttle already defined in Section 3.9) ---
  var uidCounter = 0;
  function uid(prefix) { return (prefix || 'faqir') + '-' + (++uidCounter); }
  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

  // Shared menu navigation is injected from registry/core/menu-navigation.js.
  // Keeping the module as the authored source lets standalone recipe imports
  // and the assembled browser runtime execute the exact same implementation.
  // ── shared menu navigation ── (registry/core/menu-navigation.js)
  // @ui:core menu-navigation
  // @ui:provides createMenuNavigation

  const MENU_ITEM_SELECTOR =
    '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
  const MENU_OWNER_SELECTOR = '[role="menu"], [role="menubar"]';

  /**
   * Shared keyboard and focus navigation for menus and menubars.
   *
   * The helper deliberately owns movement only. Controllers remain responsible
   * for opening/closing popups and reflecting component state.
   *
   * @param {Element} container element carrying role=menu or role=menubar
   * @param {object} [options]
   * @param {"vertical"|"horizontal"} [options.orientation="vertical"]
   * @param {boolean} [options.roving=false] maintain one tabindex=0 item
   * @param {(item: Element, event: KeyboardEvent) => void} [options.onActivate]
   * @param {(event: KeyboardEvent) => void} [options.onEscape]
   * @param {(event: KeyboardEvent) => void} [options.onTab]
   */
  function createMenuNavigation(container, options = {}) {
    const horizontal = options.orientation === "horizontal";
    const roving = options.roving === true;
    const forwardKey = horizontal ? "ArrowRight" : "ArrowDown";
    const backwardKey = horizontal ? "ArrowLeft" : "ArrowUp";

    function candidates() {
      return [...container.querySelectorAll(MENU_ITEM_SELECTOR)].filter(
        (item) => item.closest(MENU_OWNER_SELECTOR) === container,
      );
    }

    // Native disabled controls cannot receive focus. aria-disabled menuitems stay
    // in the arrow sequence per the WAI-ARIA menu pattern; activation is blocked
    // separately below.
    function items() {
      return candidates().filter((item) => !item.disabled);
    }

    function current() {
      const all = items();
      const active = document.activeElement;
      if (all.includes(active)) return active;
      return roving ? all.find((item) => item.tabIndex === 0) || null : null;
    }

    function sync(preferred) {
      if (!roving) return preferred || current();

      const all = items();
      let active = all.includes(preferred) ? preferred : null;
      if (!active && all.includes(document.activeElement)) active = document.activeElement;
      if (!active) active = all.find((item) => item.tabIndex === 0) || all[0] || null;

      for (const item of candidates()) item.tabIndex = item === active ? 0 : -1;
      return active;
    }

    function focus(index) {
      const all = items();
      if (all.length === 0) return null;

      const item = all[((index % all.length) + all.length) % all.length];
      sync(item);
      item.focus();
      return item;
    }

    function currentIndex() {
      return items().indexOf(current());
    }

    function focusFirst() {
      return focus(0);
    }

    function focusLast() {
      return focus(items().length - 1);
    }

    function focusNext() {
      const index = currentIndex();
      return focus(index < 0 ? 0 : index + 1);
    }

    function focusPrevious() {
      const index = currentIndex();
      return focus(index < 0 ? items().length - 1 : index - 1);
    }

    function eventItem(event) {
      const item = event.target.closest?.(MENU_ITEM_SELECTOR);
      if (item?.closest(MENU_OWNER_SELECTOR) === container) return item;
      return event.target === container ? current() : null;
    }

    function onKeyDown(event) {
      // Nested menu events bubble through their parent menubar. Only the nearest
      // menu/menubar owns a menuitem's key handling. Escape and Tab still belong
      // to an empty menu, including legacy markup where the container lacks a role.
      const owner = event.target.closest?.(MENU_OWNER_SELECTOR);
      if (owner ? owner !== container : event.target !== container) return;

      if (event.key === "Escape" && options.onEscape) {
        event.preventDefault();
        // Escape DISMISSES ONE THING. Without stopping it here the same keystroke
        // reached every ancestor overlay: closing a dropdown inside a dialog
        // closed the dialog too, and with it whatever the user had typed. The
        // callback opts out by returning `false` — its way of saying "this
        // Escape was not mine", so it still reaches whatever encloses us. [W3-2]
        const handled = options.onEscape(event);
        if (handled !== false) event.stopPropagation();
        return;
      }
      if (event.key === "Tab" && options.onTab) {
        options.onTab(event);
        return;
      }

      const targetItem = eventItem(event);
      if (!targetItem) return;

      if (event.key === forwardKey) {
        event.preventDefault();
        focusNext();
        return;
      }
      if (event.key === backwardKey) {
        event.preventDefault();
        focusPrevious();
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        focusFirst();
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        focusLast();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (targetItem.getAttribute("aria-disabled") !== "true") {
          if (options.onActivate) options.onActivate(targetItem, event);
          else targetItem.click();
        }
      }
    }

    function onFocusIn(event) {
      const item = eventItem(event);
      if (item) sync(item);
    }

    container.addEventListener("keydown", onKeyDown);
    if (roving) container.addEventListener("focusin", onFocusIn);
    sync();

    function destroy() {
      container.removeEventListener("keydown", onKeyDown);
      if (roving) container.removeEventListener("focusin", onFocusIn);
    }

    return {
      items,
      current,
      sync,
      focus,
      focusFirst,
      focusLast,
      focusNext,
      focusPrevious,
      destroy,
    };
  }

  // ═══════════════════════════════════════════════════════
  // Section 7: Recipe Controllers
  // ═══════════════════════════════════════════════════════

  var controllerRegistry = {};

  // Recipe controller factories are assembled here by scripts/build-core.mjs
  // from registry/recipes/<name>/<name>.js. Do NOT hand-edit the generated
  // registry/core/faqir-core.js — edit the recipe files (or this engine
  // source) and run `bun run build:core`. See CONTRIBUTING.md.
  // ── accordion ── (registry/recipes/accordion/accordion.js)
  var createAccordion = controllerRegistry["accordion"] = (function() {
// @ui:controller accordion
// @ui:provides toggle expand collapse expandAll collapseAll destroy

function createAccordion(root) {
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
    return createAccordion;
  })();

  // ── alert-dialog ── (registry/recipes/alert-dialog/alert-dialog.js)
  var createAlertDialog = controllerRegistry["alert-dialog"] = (function() {
// @ui:controller alert-dialog
// @ui:provides open close toggle destroy

/**
 * alert-dialog reuses the `dialog` controller wholesale — there is no forked or
 * duplicated controller here. An alert dialog IS a dialog whose panel carries
 * `role="alertdialog"`; the shared controller in ../dialog/dialog.js reads that
 * role and switches on the WAI-ARIA alertdialog behaviours (no overlay-dismiss,
 * focus the least-destructive action, guarded Escape, confirm/cancel events).
 * This factory only exists so the recipe is discoverable under its own
 * `data-ui="alert-dialog"` name and auto-registers from the built core.
 */
function createAlertDialog(root) {
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
    return createAlertDialog;
  })();

  // ── barcode ── (registry/recipes/barcode/barcode.js)
  var createBarcode = controllerRegistry["barcode"] = (function() {
// @ui:controller barcode
// @ui:provides render update destroy

/**
 * Code 128-B encoder and SVG renderer.
 *
 * Code set B covers printable ASCII (U+0020–U+007E), which keeps the public
 * contract predictable while supporting document identifiers, URLs, and
 * ordinary business text. The generated symbol includes a modulo-103 check
 * character and the stop pattern. The bars are drawn flush (the viewBox is the
 * symbol, one unit per module, BAR_HEIGHT units tall); the quiet zone the
 * symbology needs — ten modules each side — is CSS padding on the SVG,
 * --barcode-quiet modules wide, so layout can align the first bar.
 */

const CODE128_PATTERNS = Object.freeze([
  "212222", "222122", "222221", "121223", "121322", "131222",
  "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221",
  "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131",
  "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124",
  "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111",
  "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141",
  "411131", "211412", "211214", "211232", "2331112",
]);

const START_B = 104;
const STOP = 106;
// barcode.css divides by this to turn the padding into modules: keep them equal.
const BAR_HEIGHT = 50;

function encodeCode128B(value) {
  if (!value) throw new Error("value is empty");

  const data = [];
  let inputIndex = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 32 || codePoint > 126) {
      const printable = JSON.stringify(character);
      throw new Error(
        `unsupported character ${printable} at index ${inputIndex}; Code 128-B accepts printable ASCII only`,
      );
    }
    data.push(codePoint - 32);
    inputIndex += character.length;
  }

  let weighted = START_B;
  for (let i = 0; i < data.length; i++) weighted += data[i] * (i + 1);
  const checksum = weighted % 103;
  const codewords = [START_B, ...data, checksum, STOP];
  const pattern = codewords.map((value) => CODE128_PATTERNS[value]).join("");

  return { checksum, codewords, pattern };
}

function patternToSVG(encoded) {
  const totalWidth = [...encoded.pattern].reduce((sum, width) => sum + Number(width), 0);

  let x = 0;
  let isBar = true;
  let pathData = "";
  for (const digit of encoded.pattern) {
    const width = Number(digit);
    if (isBar) pathData += `M${x},0h${width}v${BAR_HEIGHT}h-${width}z`;
    x += width;
    isBar = !isBar;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${totalWidth} ${BAR_HEIGHT}`);
  svg.setAttribute("width", String(totalWidth));
  svg.setAttribute("height", String(BAR_HEIGHT));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("data-part", "svg");
  svg.setAttribute("data-checksum", String(encoded.checksum));
  svg.setAttribute("data-pattern", encoded.pattern);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", String(totalWidth));
  background.setAttribute("height", String(BAR_HEIGHT));
  background.setAttribute("fill", "var(--color-bg, #fff)");
  svg.appendChild(background);

  const bars = document.createElementNS("http://www.w3.org/2000/svg", "path");
  bars.setAttribute("d", pathData);
  bars.setAttribute("fill", "var(--color-fg, #000)");
  svg.appendChild(bars);

  return svg;
}

function createBarcode(root) {
  if (root._faqirBarcode) return root._faqirBarcode;

  function removeGeneratedSVG() {
    const svg = root.querySelector(":scope > [data-part='svg']");
    if (svg) svg.remove();
  }

  function render() {
    removeGeneratedSVG();
    const value = root.getAttribute("data-value") || "";

    if (!value) {
      root.dataset.state = "empty";
      return;
    }

    try {
      const svg = patternToSVG(encodeCode128B(value));
      const caption = root.querySelector(":scope > [data-part='caption']");
      if (caption) root.insertBefore(svg, caption);
      else root.appendChild(svg);
      root.dataset.state = "ready";
    } catch (error) {
      root.dataset.state = "error";
      const message = error instanceof Error ? error.message : String(error);
      root.dispatchEvent(new CustomEvent("faqir:error", { bubbles: true, detail: { message, value } }));
      console.warn(`[barcode] Failed to encode: ${message}`);
    }
  }

  function update(newValue) {
    if (newValue !== undefined) root.setAttribute("data-value", newValue);
    render();
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === "data-value")) render();
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-value"] });

  function destroy() {
    observer.disconnect();
    removeGeneratedSVG();
    if (["empty", "ready", "error"].includes(root.dataset.state)) delete root.dataset.state;
    delete root._faqirBarcode;
  }

  const api = { render, update, destroy };
  root._faqirBarcode = api;
  render();
  return api;
}
    return createBarcode;
  })();

  // ── calendar ── (registry/recipes/calendar/calendar.js)
  var createCalendar = controllerRegistry["calendar"] = (function() {
// @ui:controller calendar
// @ui:provides getValue setValue clear navigate selectDate focusDate setMin setMax setDisabledDates destroy

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function parseISO(str) {
  if (!str) return null;
  const d = new Date(str + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function createCalendar(root) {
  // Prevent double-init
  if (root._faqirCalendar) return root._faqirCalendar;

  const navPrev = root.querySelector("[data-part='nav-prev']");
  const navNext = root.querySelector("[data-part='nav-next']");
  const monthLabel = root.querySelector("[data-part='month-label']");
  const gridBody = root.querySelector("[data-part='grid-body']");

  // `grid-body` is the one part every render writes into: without it the first
  // `render()` throws on `gridBody.innerHTML`, taking the date-picker that
  // wraps it down with it. The optional parts (nav, month label) are already
  // guarded individually. [W3-2]
  if (!gridBody) {
    console.warn(
      "[Faqir] calendar needs [data-part='grid-body'] to render into. " +
        "Component left inert.",
      root
    );
    const inert = {
      getValue: () => null,
      setValue() {},
      clear() {},
      navigate() {},
      selectDate() {},
      focusDate() {},
      setMin() {},
      setMax() {},
      setDisabledDates() {},
      destroy() {},
    };
    root._faqirCalendar = inert;
    return inert;
  }

  const today = new Date();
  const mode = root.dataset.mode === "range" ? "range" : "single";

  let minDate = parseISO(root.dataset.min);
  let maxDate = parseISO(root.dataset.max);
  let disabledDates = parseDateList(root.dataset.disabledDates);

  let selectedDate = null;
  let rangeStart = null;
  let rangeEnd = null;
  if (root.dataset.value) {
    if (mode === "range") {
      const parts = root.dataset.value.split(",");
      rangeStart = parseISO(parts[0] && parts[0].trim());
      rangeEnd = parseISO(parts[1] && parts[1].trim());
    } else {
      selectedDate = parseISO(root.dataset.value);
    }
  }

  const initialView = selectedDate || rangeStart || today;
  let viewMonth = initialView.getMonth();
  let viewYear = initialView.getFullYear();
  let focusedDate = null;

  function parseDateList(str) {
    const set = new Set();
    if (str) {
      for (const token of str.split(/[\s,]+/)) {
        if (parseISO(token)) set.add(token);
      }
    }
    return set;
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatAriaLabel(date) {
    return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  function isSameDay(a, b) {
    if (!a || !b) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function isToday(date) {
    return isSameDay(date, today);
  }

  function isDisabled(date) {
    if (minDate && date.getTime() < minDate.getTime()) return true;
    if (maxDate && date.getTime() > maxDate.getTime()) return true;
    return disabledDates.has(formatDate(date));
  }

  function clampToRange(date) {
    if (minDate && date.getTime() < minDate.getTime()) return new Date(minDate);
    if (maxDate && date.getTime() > maxDate.getTime()) return new Date(maxDate);
    return date;
  }

  function buildGrid() {
    // First day of the displayed month
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDow = firstDay.getDay(); // 0=Sun

    // Last day of the displayed month
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const totalDays = lastDay.getDate();

    // Previous month trailing days
    const prevMonthLast = new Date(viewYear, viewMonth, 0);
    const prevMonthDays = prevMonthLast.getDate();

    // Update label
    if (monthLabel) monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    // A whole adjacent month out of bounds means its nav button is a dead end
    if (navPrev) navPrev.disabled = !!(minDate && prevMonthLast.getTime() < minDate.getTime());
    if (navNext) navNext.disabled = !!(maxDate && new Date(viewYear, viewMonth + 1, 1).getTime() > maxDate.getTime());

    // Clear existing
    gridBody.innerHTML = "";

    let dayCount = 1;
    let nextMonthDay = 1;
    const totalCells = Math.ceil((startDow + totalDays) / 7) * 7;
    let row = null;

    for (let i = 0; i < totalCells; i++) {
      // Start a new row every 7 cells
      if (i % 7 === 0) {
        row = document.createElement("tr");
        gridBody.appendChild(row);
      }

      const td = document.createElement("td");
      const btn = document.createElement("button");
      btn.setAttribute("data-part", "day");
      btn.type = "button";

      let date;
      let isOutside = false;

      if (i < startDow) {
        // Previous month
        const day = prevMonthDays - startDow + 1 + i;
        date = new Date(viewYear, viewMonth - 1, day);
        btn.textContent = day;
        isOutside = true;
      } else if (dayCount <= totalDays) {
        // Current month
        date = new Date(viewYear, viewMonth, dayCount);
        btn.textContent = dayCount;
        dayCount++;
      } else {
        // Next month
        date = new Date(viewYear, viewMonth + 1, nextMonthDay);
        btn.textContent = nextMonthDay;
        nextMonthDay++;
        isOutside = true;
      }

      btn.dataset.date = formatDate(date);
      btn.setAttribute("aria-label", formatAriaLabel(date));

      if (isOutside) {
        btn.dataset.outside = "true";
      }

      if (isToday(date)) {
        btn.dataset.today = "true";
      }

      if (isDisabled(date)) {
        // aria-disabled (not the native attribute) keeps the cell reachable by
        // the roving tabindex while blocking selection
        btn.setAttribute("aria-disabled", "true");
        btn.dataset.disabled = "true";
      }

      if (mode === "range") {
        if (isSameDay(date, rangeStart)) {
          btn.dataset.state = "range-start";
          btn.setAttribute("aria-selected", "true");
        } else if (isSameDay(date, rangeEnd)) {
          btn.dataset.state = "range-end";
          btn.setAttribute("aria-selected", "true");
        } else if (
          rangeStart && rangeEnd &&
          date.getTime() > rangeStart.getTime() &&
          date.getTime() < rangeEnd.getTime()
        ) {
          btn.dataset.state = "in-range";
        }
      } else if (isSameDay(date, selectedDate)) {
        btn.setAttribute("aria-selected", "true");
      }

      if (isSameDay(date, focusedDate)) {
        btn.tabIndex = 0;
      } else {
        btn.tabIndex = -1;
      }

      td.appendChild(btn);
      row.appendChild(td);
    }

    // If no focused date set, make the selected or first-of-month focusable
    if (!focusedDate) {
      const anchor = mode === "range" ? rangeStart : selectedDate;
      const defaultFocusDate = anchor &&
        anchor.getMonth() === viewMonth && anchor.getFullYear() === viewYear
        ? anchor
        : new Date(viewYear, viewMonth, 1);
      const defaultBtn = gridBody.querySelector(
        `[data-date="${formatDate(defaultFocusDate)}"]`
      );
      if (defaultBtn) defaultBtn.tabIndex = 0;
    }
  }

  function dayButton(date) {
    return gridBody.querySelector(`[data-date="${formatDate(date)}"]`);
  }

  function focusDate(date) {
    const target = clampToRange(new Date(date));
    focusedDate = target;

    if (target.getMonth() !== viewMonth || target.getFullYear() !== viewYear) {
      viewMonth = target.getMonth();
      viewYear = target.getFullYear();
      buildGrid();
    } else {
      // Update roving tabindex in the current grid
      gridBody.querySelectorAll("[data-part='day']").forEach((btn) => {
        btn.tabIndex = -1;
      });
      const btn = dayButton(target);
      if (btn) btn.tabIndex = 0;
    }

    const btn = dayButton(target);
    if (btn) btn.focus();
  }

  function moveFocus(days) {
    if (!focusedDate) return;
    const next = new Date(focusedDate);
    next.setDate(next.getDate() + days);
    focusDate(next);
  }

  /** Move focus ±N months (PageUp/Down), clamping the day to the target month's length. */
  function moveFocusMonths(months) {
    if (!focusedDate) return;
    const target = new Date(focusedDate.getFullYear(), focusedDate.getMonth() + months, 1);
    const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(focusedDate.getDate(), daysInTarget));
    focusDate(target);
  }

  function selectDate(date) {
    const chosen = new Date(date);
    if (isDisabled(chosen)) return;

    // buildGrid() replaces the focused button — restore focus before emitting,
    // so change listeners (e.g. date-picker closing the popup) keep the final
    // word on where focus lands.
    const hadFocus = root.contains(document.activeElement);
    focusedDate = chosen;

    let detail = null;

    if (mode === "range") {
      if (!rangeStart || rangeEnd || chosen.getTime() < rangeStart.getTime()) {
        // First click, restart after a complete range, or backwards pick
        rangeStart = chosen;
        rangeEnd = null;
      } else {
        rangeEnd = chosen;
        detail = {
          start: formatDate(rangeStart),
          end: formatDate(rangeEnd),
          startObj: new Date(rangeStart),
          endObj: new Date(rangeEnd),
        };
      }
    } else {
      selectedDate = chosen;
      detail = { date: formatDate(selectedDate), dateObj: new Date(selectedDate) };
    }

    buildGrid();

    if (hadFocus) {
      const btn = dayButton(chosen);
      if (btn) btn.focus();
    }

    if (detail) {
      root.dispatchEvent(
        new CustomEvent("faqir:calendar-change", { detail, bubbles: true })
      );
    }
  }

  function getValue() {
    if (mode === "range") {
      return {
        start: rangeStart ? formatDate(rangeStart) : null,
        end: rangeEnd ? formatDate(rangeEnd) : null,
      };
    }
    return selectedDate ? formatDate(selectedDate) : null;
  }

  /** Silent set — updates selection and view without emitting a change event. */
  function setValue(value) {
    if (mode === "range") {
      const parts = String(value).split(",");
      const start = parseISO(parts[0] && parts[0].trim());
      const end = parseISO(parts[1] && parts[1].trim());
      if (!start) return;
      rangeStart = start;
      rangeEnd = end && end.getTime() >= start.getTime() ? end : null;
      viewMonth = start.getMonth();
      viewYear = start.getFullYear();
      buildGrid();
      return;
    }

    const parsed = parseISO(value);
    if (!parsed) return;
    selectedDate = parsed;
    viewMonth = parsed.getMonth();
    viewYear = parsed.getFullYear();
    buildGrid();
  }

  function clear() {
    selectedDate = null;
    rangeStart = null;
    rangeEnd = null;
    buildGrid();
  }

  function navigate(month, year) {
    viewMonth = month;
    viewYear = year;
    focusedDate = new Date(viewYear, viewMonth, 1);
    buildGrid();

    const btn = dayButton(focusedDate);
    if (btn) btn.focus();
  }

  function setMin(value) {
    minDate = parseISO(value);
    buildGrid();
  }

  function setMax(value) {
    maxDate = parseISO(value);
    buildGrid();
  }

  function setDisabledDates(list) {
    disabledDates = parseDateList(Array.isArray(list) ? list.join(",") : list);
    buildGrid();
  }

  /** Show an adjacent month without moving DOM focus (nav-button clicks). */
  function shiftView(delta) {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    } else if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    focusedDate = clampToRange(new Date(viewYear, viewMonth, 1));
    buildGrid();
  }

  function onPrevClick() {
    shiftView(-1);
  }

  function onNextClick() {
    shiftView(1);
  }

  function onGridClick(e) {
    const dayBtn = e.target.closest("[data-part='day']");
    if (dayBtn && dayBtn.dataset.date && dayBtn.getAttribute("aria-disabled") !== "true") {
      selectDate(parseISO(dayBtn.dataset.date));
    }
  }

  function onKeyDown(e) {
    // Grid navigation only applies while a day cell has focus
    const dayBtn = e.target.closest ? e.target.closest("[data-part='day']") : null;
    if (!dayBtn) return;

    if (dayBtn.dataset.date && !isSameDay(focusedDate, parseISO(dayBtn.dataset.date))) {
      focusedDate = parseISO(dayBtn.dataset.date);
    }

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-7);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(7);
        break;
      case "Home":
        e.preventDefault();
        if (focusedDate) moveFocus(-focusedDate.getDay());
        break;
      case "End":
        e.preventDefault();
        if (focusedDate) moveFocus(6 - focusedDate.getDay());
        break;
      case "PageUp":
        e.preventDefault();
        if (e.shiftKey) {
          moveFocusMonths(-12);
        } else {
          moveFocusMonths(-1);
        }
        break;
      case "PageDown":
        e.preventDefault();
        if (e.shiftKey) {
          moveFocusMonths(12);
        } else {
          moveFocusMonths(1);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (focusedDate) selectDate(focusedDate);
        break;
    }
  }

  navPrev?.addEventListener("click", onPrevClick);
  navNext?.addEventListener("click", onNextClick);
  gridBody?.addEventListener("click", onGridClick);
  root.addEventListener("keydown", onKeyDown);

  buildGrid();

  function destroy() {
    navPrev?.removeEventListener("click", onPrevClick);
    navNext?.removeEventListener("click", onNextClick);
    gridBody?.removeEventListener("click", onGridClick);
    root.removeEventListener("keydown", onKeyDown);
    delete root._faqirCalendar;
  }

  const api = {
    getValue,
    setValue,
    clear,
    navigate,
    selectDate,
    focusDate,
    setMin,
    setMax,
    setDisabledDates,
    destroy,
  };
  root._faqirCalendar = api;
  return api;
}
    return createCalendar;
  })();

  // ── carousel ── (registry/recipes/carousel/carousel.js)
  var createCarousel = controllerRegistry["carousel"] = (function() {
// @ui:controller carousel
// @ui:provides next prev goTo getIndex getCount destroy

/**
 * carousel — a CSS scroll-snap strip with a deliberately tiny enhancement layer.
 *
 * CSS owns the sliding: `[data-part="viewport"]` scrolls on the inline axis with
 * `scroll-snap-type: inline mandatory`, and each `[data-part="slide"]` is a snap
 * target. That means the component is fully usable with this file absent —
 * swipe, wheel and (the viewport is `tabindex="0"`) the arrow keys all work.
 *
 * So the controller owns ONLY what CSS cannot:
 *
 *   • prev/next buttons and dots — inert markup that ships `hidden` and is
 *     un-hidden here, so a reader without JS never sees a dead control;
 *   • current-slide tracking by scroll math (no IntersectionObserver: one
 *     rAF-throttled `getBoundingClientRect` pass answers "which snap point are
 *     we on?" exactly, and works identically for programmatic and user scrolls);
 *   • the boundary contract — "stop" by default (the end button is `disabled`),
 *     "loop" when the root carries `data-loop`;
 *   • the `[data-part="status"]` live region ("Slide 2 of 3");
 *   • reduced motion — an explicit `behavior: "instant"` (which beats the CSS
 *     `scroll-behavior: smooth`) rather than an animated scroll.
 *
 * Scrolling always goes through the PHYSICAL delta `slide.left - viewport.left`
 * added to `scrollLeft`, which is correct in both LTR and RTL (where `scrollLeft`
 * runs negative). Only the "which slide is current?" comparison is
 * direction-aware, since the snap edge is `inline-start`.
 */
function createCarousel(root) {
  // Prevent double-init.
  if (root._faqirCarousel) return root._faqirCarousel;

  const viewport = root.querySelector("[data-part='viewport']");
  if (!viewport) return null;

  const loop = root.hasAttribute("data-loop");
  // A carousel nested in a slide brings its own slides, buttons and dots:
  // slides are the viewport's children, the rest go through the owner guard.
  const slides = () => [...viewport.querySelectorAll(":scope > [data-part='slide']")];
  const dots = () => ownParts(root, "dot");
  const [prevBtn] = ownParts(root, "prev");
  const [nextBtn] = ownParts(root, "next");
  const [status] = ownParts(root, "status");
  const enhanced = [...ownParts(root, "controls"), ...ownParts(root, "dots")];

  let index = 0;

  // ── environment probes (read live, so preference changes are honored) ───────
  const reducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const isRtl = () => {
    const cs = typeof getComputedStyle === "function" ? getComputedStyle(root) : null;
    return (cs && cs.direction) === "rtl";
  };

  const rectOf = (el) =>
    el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, right: 0 };

  /**
   * Per-slide geometry, measured against the viewport:
   *   `delta` — physical px to add to `scrollLeft` to bring the slide into view.
   *   `edge`  — signed distance on the snap (inline-start) edge; the slide whose
   *             |edge| is smallest is the current one.
   */
  function metrics() {
    const v = rectOf(viewport);
    const rtl = isRtl();
    return slides().map((s) => {
      const r = rectOf(s);
      return { delta: r.left - v.left, edge: rtl ? r.right - v.right : r.left - v.left };
    });
  }

  function nearestIndex() {
    let best = 0;
    let bestDistance = Infinity;
    metrics().forEach((m, i) => {
      const d = Math.abs(m.edge);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  }

  /** Apply the boundary contract: wrap when `data-loop`, otherwise clamp. */
  function resolve(i, count) {
    if (!count) return 0;
    return loop ? ((i % count) + count) % count : Math.min(Math.max(i, 0), count - 1);
  }

  // ── reflection ──────────────────────────────────────────────────────────────
  function sync() {
    const count = slides().length;
    dots().forEach((d, i) => {
      const on = i === index;
      d.dataset.state = on ? "active" : "inactive";
      if (on) d.setAttribute("aria-current", "true");
      else d.removeAttribute("aria-current");
    });
    if (prevBtn) prevBtn.disabled = !loop && index <= 0;
    if (nextBtn) nextBtn.disabled = !loop && index >= count - 1;
    if (status) status.textContent = count ? `Slide ${index + 1} of ${count}` : "";
  }

  function setIndex(i) {
    if (i === index) return;
    index = i;
    sync();
    root.dispatchEvent(
      new CustomEvent("faqir:change", {
        bubbles: true,
        detail: { index, count: slides().length },
      }),
    );
  }

  // ── navigation ──────────────────────────────────────────────────────────────
  function goTo(i) {
    const list = slides();
    if (!list.length) return;
    const target = resolve(i, list.length);
    const m = metrics()[target];
    const left = (viewport.scrollLeft || 0) + (m ? m.delta : 0);
    const behavior = reducedMotion() ? "instant" : "smooth";
    if (typeof viewport.scrollTo === "function") viewport.scrollTo({ left, behavior });
    else viewport.scrollLeft = left;
    setIndex(target);
  }

  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  // ── events ──────────────────────────────────────────────────────────────────
  function onClick(e) {
    // Matched by identity, so a nested carousel's buttons are not these. A
    // missing button is `undefined`, never equal to a `null` miss here.
    const btn = e.target.closest("[data-part]");
    const dot = dots().indexOf(btn);
    if (btn === nextBtn) next();
    else if (btn === prevBtn) prev();
    else if (dot >= 0) goTo(dot);
  }

  // One rAF-throttled measurement per scroll burst keeps tracking cheap.
  const schedule =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    schedule(() => {
      ticking = false;
      setIndex(nearestIndex());
    });
  }

  // Enhance: the JS-only controls become visible now that JS is here.
  enhanced.forEach((el) => {
    el.hidden = false;
  });

  root.addEventListener("click", onClick);
  viewport.addEventListener("scroll", onScroll);
  sync();

  function destroy() {
    root.removeEventListener("click", onClick);
    viewport.removeEventListener("scroll", onScroll);
    // Back to the no-JS baseline: the inert controls hide again.
    enhanced.forEach((el) => {
      el.hidden = true;
    });
    delete root._faqirCarousel;
  }

  const api = { goTo, next, prev, getIndex: () => index, getCount: () => slides().length, destroy };
  root._faqirCarousel = api;
  return api;
}
    return createCarousel;
  })();

  // ── combobox ── (registry/recipes/combobox/combobox.js)
  var createCombobox = controllerRegistry["combobox"] = (function() {
// @ui:controller combobox
// @ui:provides open close filter selectOption getValue setValue destroy

function createCombobox(root) {
  // Prevent double-init
  if (root._faqirCombobox) return root._faqirCombobox;

  const input = root.querySelector("[data-part='input']");
  const listbox = root.querySelector("[data-part='listbox']");
  const emptyEl = root.querySelector("[data-part='empty']");
  const options = () =>
    [...root.querySelectorAll("[data-part='option']")];

  let highlightedIndex = -1;
  let outsideClickCleanup = null;
  let selectedValue = "";

  /**
   * `aria-activedescendant` — the half of the combobox pattern that was declared
   * and never implemented.  [W3-4]
   *
   * The markup publishes `role="combobox"` and `aria-autocomplete="list"`, which
   * is the APG contract: as the user arrows through the list, the combobox must
   * name the active option so a screen reader announces it. Highlighting was
   * tracked in `data-highlighted` alone and the options carried no `id`, so
   * there was nothing to point at and nothing was ever announced — the widget
   * claimed a pattern it did not implement. The axe gate structurally cannot see
   * this: it evaluates static DOM, and the defect exists only mid-navigation.
   *
   * Ids are minted on demand so authored ids are respected and generated markup
   * needs none.
   */
  function optionId(opt) {
    if (!opt.id) opt.id = uid("faqir-option");
    return opt.id;
  }

  function setActiveDescendant(opt) {
    if (opt) input.setAttribute("aria-activedescendant", optionId(opt));
    else input.removeAttribute("aria-activedescendant");
  }

  function open() {
    root.dataset.state = "open";
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");

    outsideClickCleanup = onOutsideClick(root, close);
  }

  function close() {
    root.dataset.state = "closed";
    listbox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    clearHighlight();

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  function clearHighlight() {
    const allOptions = options();
    allOptions.forEach((opt) => {
      opt.removeAttribute("data-highlighted");
      opt.setAttribute("aria-selected", "false");
    });
    setActiveDescendant(null);
    highlightedIndex = -1;
  }

  function highlightOption(index) {
    const allOptions = visibleOptions();
    if (allOptions.length === 0) return;

    // Clamp index
    if (index < 0) index = allOptions.length - 1;
    if (index >= allOptions.length) index = 0;

    // Clear previous
    options().forEach((opt) => {
      opt.removeAttribute("data-highlighted");
      opt.setAttribute("aria-selected", "false");
    });

    allOptions[index].setAttribute("data-highlighted", "");
    allOptions[index].setAttribute("aria-selected", "true");
    allOptions[index].scrollIntoView({ block: "nearest" });
    setActiveDescendant(allOptions[index]);
    highlightedIndex = index;
  }

  function visibleOptions() {
    return options().filter((opt) => !opt.hasAttribute("data-hidden"));
  }

  function filter(query) {
    const allOptions = options();
    const lowerQuery = query.toLowerCase();
    let visibleCount = 0;

    allOptions.forEach((opt) => {
      const text = opt.textContent.toLowerCase();
      if (text.includes(lowerQuery)) {
        opt.removeAttribute("data-hidden");
        visibleCount++;
      } else {
        opt.setAttribute("data-hidden", "");
      }
    });

    // Show/hide empty state
    if (emptyEl) {
      emptyEl.hidden = visibleCount > 0;
    }

    clearHighlight();

    return visibleCount;
  }

  function selectOption(index) {
    const visible = visibleOptions();
    if (index < 0 || index >= visible.length) return;

    const opt = visible[index];
    selectedValue = opt.textContent.trim();
    input.value = selectedValue;

    // Mark as selected
    options().forEach((o) => o.setAttribute("aria-selected", "false"));
    opt.setAttribute("aria-selected", "true");

    close();
  }

  function getValue() {
    return selectedValue;
  }

  function setValue(val) {
    selectedValue = val;
    input.value = val;
  }

  // ── Event Handlers ──

  function onInput() {
    const query = input.value;
    if (root.dataset.state !== "open") {
      open();
    }
    filter(query);
  }

  function onInputFocus() {
    if (root.dataset.state !== "open") {
      open();
    }
  }

  function onInputKeyDown(e) {
    const visible = visibleOptions();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (root.dataset.state !== "open") open();
        highlightOption(highlightedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (root.dataset.state !== "open") open();
        highlightOption(highlightedIndex - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visible.length) {
          selectOption(highlightedIndex);
        }
        break;
      case "Escape":
        // Only ours while the list is open; a closed combobox lets Escape reach
        // the dialog it sits in rather than swallowing it. [W3-2]
        if (root.dataset.state === "open") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case "Home":
        if (root.dataset.state === "open" && visible.length > 0) {
          e.preventDefault();
          highlightOption(0);
        }
        break;
      case "End":
        if (root.dataset.state === "open" && visible.length > 0) {
          e.preventDefault();
          highlightOption(visible.length - 1);
        }
        break;
    }
  }

  function onListboxClick(e) {
    const opt = e.target.closest("[data-part='option']");
    if (!opt) return;

    const visible = visibleOptions();
    const index = visible.indexOf(opt);
    if (index >= 0) {
      selectOption(index);
    }
  }

  input?.addEventListener("input", onInput);
  input?.addEventListener("focus", onInputFocus);
  input?.addEventListener("keydown", onInputKeyDown);
  listbox?.addEventListener("click", onListboxClick);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close();
    input?.removeEventListener("input", onInput);
    input?.removeEventListener("focus", onInputFocus);
    input?.removeEventListener("keydown", onInputKeyDown);
    listbox?.removeEventListener("click", onListboxClick);
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirCombobox;
  }

  const api = { open, close, filter, selectOption, getValue, setValue, destroy };
  root._faqirCombobox = api;
  return api;
}
    return createCombobox;
  })();

  // ── command-palette ── (registry/recipes/command-palette/command-palette.js)
  var createCommandPalette = controllerRegistry["command-palette"] = (function() {
// @ui:controller command-palette
// @ui:provides open close filter selectItem registerCommand destroy

function createCommandPalette(root) {
  // Prevent double-init
  if (root._faqirCommandPalette) return root._faqirCommandPalette;

  const overlay = root.querySelector("[data-part='overlay']");
  const panel = root.querySelector("[data-part='panel']");
  const searchInput = root.querySelector("[data-part='search']");
  const list = root.querySelector("[data-part='list']");
  const emptyEl = root.querySelector("[data-part='empty']");
  const items = () =>
    [...root.querySelectorAll("[data-part='item']")];
  const groups = () =>
    [...root.querySelectorAll("[data-part='group']")];

  let highlightedIndex = -1;
  let focusCleanup = null;
  let previouslyFocused = null;
  const registeredCommands = [];

  function open() {
    previouslyFocused = document.activeElement;
    // A link item is a tab stop of its own; in a combobox's listbox the search
    // field is the one stop, so a link item without a tabindex gets -1.
    items().forEach((item) => {
      if (linkOf(item) && !item.hasAttribute("tabindex")) item.tabIndex = -1;
    });
    root.dataset.state = "open";
    overlay.hidden = false;
    panel.hidden = false;

    // Reset search and highlights
    searchInput.value = "";
    filter("");
    clearHighlight();

    focusCleanup = trapFocus(panel);
    searchInput.focus();
  }

  /**
   * Everything `close()` does EXCEPT moving focus.
   *
   * `destroy()` used to leave an open overlay standing with nothing listening —
   * a dead widget the user cannot dismiss. Closing it on teardown is the fix
   * (`context-menu` is the model), but teardown must not also yank focus
   * somewhere: on an SPA route change the element it would restore to is
   * usually on its way out of the document. [W3-2]
   */
  function dismiss() {
    root.dataset.state = "closed";
    overlay.hidden = true;
    panel.hidden = true;
    // A closed palette must not still name an active item: `aria-activedescendant`
    // pointing into a hidden list is a reference a reader can follow to nothing. [W3-4]
    clearHighlight();

    if (focusCleanup) {
      focusCleanup();
      focusCleanup = null;
    }
  }

  function close() {
    const active = document.activeElement;
    dismiss();
    // The opener may have left with another overlay — the downstream palette
    // was opened from inside a dialog that closed underneath it.
    returnFocus(root, previouslyFocused, active);
  }

  /**
   * `aria-activedescendant` — the declared half of the combobox pattern. [W3-4]
   *
   * The search field publishes `role="combobox"` and `aria-autocomplete="list"`,
   * which obliges it to name the active item as the user arrows through the
   * results. Highlighting lived in `data-highlighted` alone and the items had no
   * `id`, so a screen-reader user heard nothing move. The axe gate cannot see
   * this — it reads static DOM, and the defect exists only mid-navigation.
   */
  function itemId(item) {
    if (!item.id) item.id = uid("faqir-command");
    return item.id;
  }

  function setActiveDescendant(item) {
    if (!searchInput) return;
    if (item) searchInput.setAttribute("aria-activedescendant", itemId(item));
    else searchInput.removeAttribute("aria-activedescendant");
  }

  function clearHighlight() {
    items().forEach((item) => {
      item.removeAttribute("data-highlighted");
      item.setAttribute("aria-selected", "false");
    });
    setActiveDescendant(null);
    highlightedIndex = -1;
  }

  function visibleItems() {
    return items().filter((item) => !item.hasAttribute("data-hidden"));
  }

  function highlightItem(index) {
    const visible = visibleItems();
    if (visible.length === 0) return;

    // Clamp index
    if (index < 0) index = visible.length - 1;
    if (index >= visible.length) index = 0;

    // Clear previous
    items().forEach((item) => {
      item.removeAttribute("data-highlighted");
      item.setAttribute("aria-selected", "false");
    });

    visible[index].setAttribute("data-highlighted", "");
    visible[index].setAttribute("aria-selected", "true");
    visible[index].scrollIntoView({ block: "nearest" });
    setActiveDescendant(visible[index]);
    highlightedIndex = index;
  }

  function filter(query) {
    const allItems = items();
    const allGroups = groups();
    const lowerQuery = query.toLowerCase();
    let totalVisible = 0;

    // Track visible items per group
    const groupVisibility = new Map();
    allGroups.forEach((g) => groupVisibility.set(g, 0));

    allItems.forEach((item) => {
      const label = item.querySelector("[data-part='item-label']");
      const text = (label || item).textContent.toLowerCase();

      if (text.includes(lowerQuery)) {
        item.removeAttribute("data-hidden");
        totalVisible++;
        // Find parent group
        const parentGroup = item.closest("[data-part='group']");
        if (parentGroup && groupVisibility.has(parentGroup)) {
          groupVisibility.set(parentGroup, groupVisibility.get(parentGroup) + 1);
        }
      } else {
        item.setAttribute("data-hidden", "");
      }
    });

    // Hide groups with no visible items
    allGroups.forEach((group) => {
      if (groupVisibility.get(group) === 0) {
        group.setAttribute("data-hidden", "");
      } else {
        group.removeAttribute("data-hidden");
      }
    });

    // Show/hide empty state
    if (emptyEl) {
      emptyEl.hidden = totalVisible > 0;
    }

    clearHighlight();

    return totalVisible;
  }

  /** An item that is a link: an `<a href>` the palette follows when chosen. */
  function linkOf(item) {
    return item.tagName === "A" && item.hasAttribute("href") ? item : null;
  }

  // Set while the controller itself clicks a link item, so the list's click
  // listener does not take that click for a second selection.
  let following = false;

  /**
   * Choose an item: `command-select` first, then the registered command,
   * then close, then — for an `<a href>` item — follow the link.
   *
   * The event is cancelable, and `preventDefault()` cancels only the
   * navigation: a router that handles `detail.href` itself still gets a closed
   * palette. `clickEvent` is the user's click on a link item, whose own default
   * action is the navigation; from the keyboard there is none, so the item is
   * clicked here — which keeps `target`, `download` and the like working.
   */
  function choose(item, clickEvent) {
    const link = linkOf(item);

    // Fire a custom event for the application to handle
    const event = new CustomEvent("command-select", {
      bubbles: true,
      cancelable: true,
      detail: {
        item,
        label: item.querySelector("[data-part='item-label']")?.textContent || item.textContent,
        value: item.getAttribute("data-value"),
        href: link ? link.href : null,
      }
    });
    root.dispatchEvent(event);

    // Check registered commands
    const label = (item.querySelector("[data-part='item-label']") || item).textContent.trim();
    const cmd = registeredCommands.find((c) => c.label === label);
    if (cmd?.action) cmd.action();

    close();

    if (!link) return;
    if (event.defaultPrevented) {
      clickEvent?.preventDefault();
    } else if (!clickEvent) {
      following = true;
      try {
        link.click();
      } finally {
        following = false;
      }
    }
  }

  function selectItem(index) {
    const visible = visibleItems();
    if (index < 0 || index >= visible.length) return;
    choose(visible[index]);
  }

  function registerCommand(cmd) {
    registeredCommands.push(cmd);
  }

  // ── Event Handlers ──

  function onSearchInput() {
    filter(searchInput.value);
  }

  function onSearchKeyDown(e) {
    const visible = visibleItems();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        highlightItem(highlightedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        highlightItem(highlightedIndex - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visible.length) {
          selectItem(highlightedIndex);
        }
        break;
      case "Escape":
        // The palette is an overlay in its own right: dismissing it must not
        // also dismiss whatever it was opened over. [W3-2]
        if (root.dataset.state === "open") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case "Home":
        if (visible.length > 0) {
          e.preventDefault();
          highlightItem(0);
        }
        break;
      case "End":
        if (visible.length > 0) {
          e.preventDefault();
          highlightItem(visible.length - 1);
        }
        break;
    }
  }

  function onOverlayClick() {
    close();
  }

  function onItemClick(e) {
    if (following) return;
    const item = e.target.closest("[data-part='item']");
    if (!item) return;

    if (visibleItems().includes(item)) choose(item, e);
  }

  /**
   * Cmd/Ctrl+K — one owner per press.
   *
   * Every instance listens on `document`, so a page with three palettes used to
   * open three stacked focus traps. The first instance to act prevents default
   * and every later one (or one an app handler pre-empted) stands down;
   * `data-no-shortcut` opts an instance out entirely, read live, and a palette
   * whose root has left the document without `destroy()` (an SPA route change)
   * no longer claims the press from the live one. The key is
   * matched case-insensitively (Caps Lock sends "K"), falling back to the
   * physical key on a non-Latin layout; Shift is left alone because Cmd+Shift+K
   * is a browser and app chord of its own.
   */
  function onGlobalKeyDown(e) {
    if (e.defaultPrevented || !root.isConnected || root.hasAttribute("data-no-shortcut")) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat || e.isComposing) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "k" && (/^[a-z]$/.test(k) || e.code !== "KeyK")) return;
    e.preventDefault();
    if (root.dataset.state === "open") {
      close();
    } else {
      open();
    }
  }

  searchInput?.addEventListener("input", onSearchInput);
  searchInput?.addEventListener("keydown", onSearchKeyDown);
  overlay?.addEventListener("click", onOverlayClick);
  list?.addEventListener("click", onItemClick);
  document.addEventListener("keydown", onGlobalKeyDown);

  function destroy() {
    dismiss();
    searchInput?.removeEventListener("input", onSearchInput);
    searchInput?.removeEventListener("keydown", onSearchKeyDown);
    overlay?.removeEventListener("click", onOverlayClick);
    list?.removeEventListener("click", onItemClick);
    document.removeEventListener("keydown", onGlobalKeyDown);
    if (focusCleanup) focusCleanup();
    delete root._faqirCommandPalette;
  }

  const api = { open, close, filter, selectItem, registerCommand, destroy };
  root._faqirCommandPalette = api;
  return api;
}
    return createCommandPalette;
  })();

  // ── context-menu ── (registry/recipes/context-menu/context-menu.js)
  var createContextMenu = controllerRegistry["context-menu"] = (function() {
// @ui:controller context-menu
// @ui:provides open close destroy

function createContextMenu(root) {
  if (root._faqirContextMenu) return root._faqirContextMenu;

  // Matched by owner: a dropdown inside the target has a `menu` part too, and
  // it comes first in document order.
  const [target] = ownParts(root, "target");
  const [menu] = ownParts(root, "menu");

  // Same as `dropdown`: a missing part must name itself rather than throwing a
  // TypeError out of `createMenuNavigation(null)`. [W3-2]
  if (!target || !menu) {
    console.warn(
      "[Faqir] context-menu needs [data-part='target'] and [data-part='menu'] — " +
        `missing ${[!target && "target", !menu && "menu"].filter(Boolean).join(" and ")}. ` +
        "Component left inert.",
      root
    );
    const inert = { open() {}, close() {}, destroy() {} };
    root._faqirContextMenu = inert;
    return inert;
  }

  let outsideClickCleanup = null;

  function clearOutsideClick() {
    if (!outsideClickCleanup) return;
    outsideClickCleanup();
    outsideClickCleanup = null;
  }

  function close(options = {}) {
    const { restoreFocus = true } = options;

    root.dataset.state = "closed";
    menu.hidden = true;
    target.setAttribute("aria-expanded", "false");
    clearOutsideClick();

    if (restoreFocus && target.isConnected) target.focus();
  }

  const navigation = createMenuNavigation(menu, {
    onEscape() {
      close({ restoreFocus: true });
    },
    onTab() {
      close({ restoreFocus: false });
    },
  });

  function open(x = 0, y = 0) {
    clearOutsideClick();

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.hidden = false;
    root.dataset.state = "open";
    target.setAttribute("aria-expanded", "true");

    navigation.focusFirst();

    outsideClickCleanup = onOutsideClick(menu, () => {
      close({ restoreFocus: false });
    });
  }

  function onContextMenu(event) {
    event.preventDefault();
    open(event.clientX, event.clientY);
  }

  function onTargetKeyDown(event) {
    const isContextMenuKey = event.key === "ContextMenu";
    const isShiftF10 = event.key === "F10" && event.shiftKey;
    if (!isContextMenuKey && !isShiftF10) return;

    event.preventDefault();
    const rect = target.getBoundingClientRect();
    open(rect.left, rect.bottom);
  }

  function onMenuClick(event) {
    const item = event.target.closest("[data-part='item']");
    if (!item || !menu.contains(item)) return;

    if (item.disabled || item.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }

    close({ restoreFocus: true });
  }

  target?.addEventListener("contextmenu", onContextMenu);
  target?.addEventListener("keydown", onTargetKeyDown);
  menu?.addEventListener("click", onMenuClick);

  function destroy() {
    target?.removeEventListener("contextmenu", onContextMenu);
    target?.removeEventListener("keydown", onTargetKeyDown);
    menu?.removeEventListener("click", onMenuClick);
    navigation.destroy();
    clearOutsideClick();

    root.dataset.state = "closed";
    menu.hidden = true;
    target.setAttribute("aria-expanded", "false");
    delete root._faqirContextMenu;
  }

  const api = { open, close, destroy };
  root._faqirContextMenu = api;
  return api;
}
    return createContextMenu;
  })();

  // ── date-picker ── (registry/recipes/date-picker/date-picker.js)
  var createDatePicker = controllerRegistry["date-picker"] = (function() {
// @ui:controller date-picker
// @ui:provides open close getValue setValue clear navigate selectDate destroy

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function createDatePicker(root) {
  // Prevent double-init
  if (root._faqirDatePicker) return root._faqirDatePicker;

  const trigger = root.querySelector("[data-part='trigger']");
  const input = root.querySelector("[data-part='input']");
  const popup = root.querySelector("[data-part='calendar']");
  // The submitted value. The visible input shows "October 15, 2026"; a form
  // must send 2026-10-15, so a picker inside one carries a hidden input with
  // the field's `name`, and this controller keeps it holding the ISO date.
  // Optional: without it the picker works as before, the ISO date on
  // `input.dataset.value`.
  const valueInput = root.querySelector(":scope > [data-part='value']");

  // The month grid is the standalone `calendar` recipe. Canonical markup nests
  // [data-ui="calendar"] inside the popup; legacy flat markup (grid parts
  // directly inside the popup) still works — the popup itself then acts as the
  // calendar root.
  const calendarRoot = root.querySelector("[data-ui='calendar']") || popup;

  // `input` carries the value and the aria-expanded state, `popup` is what
  // opens; either one missing made every open()/close() throw. `trigger` is
  // optional — an input-only date picker opens from the field. [W3-2]
  if (!input || !popup) {
    console.warn(
      "[Faqir] date-picker needs [data-part='input'] and [data-part='calendar'] — " +
        `missing ${[!input && "input", !popup && "calendar"].filter(Boolean).join(" and ")}. ` +
        "Component left inert.",
      root
    );
    const inert = {
      open() {},
      close() {},
      getValue: () => null,
      setValue() {},
      clear() {},
      navigate() {},
      selectDate() {},
      destroy() {},
    };
    root._faqirDatePicker = inert;
    return inert;
  }
  const calendar = createCalendar(calendarRoot);

  const today = new Date();
  let outsideClickCleanup = null;

  function formatDisplay(date) {
    return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  // `dateObj` null is no date. The submitted value is announced the way typing
  // into a field would be — `input` then `change`, bubbling — so l-model,
  // faqir-validate and faqir-rules all see the new answer; not when it did not
  // change, and not on the `silent` sync at start-up.
  function syncInput(dateStr, dateObj, silent) {
    input.value = dateObj ? formatDisplay(dateObj) : "";
    input.dataset.value = dateStr;
    if (valueInput && valueInput.value !== dateStr) {
      valueInput.value = dateStr;
      if (!silent) {
        for (const type of ["input", "change"]) valueInput.dispatchEvent(new Event(type, { bubbles: true }));
      }
    }
  }

  function open() {
    root.dataset.state = "open";
    popup.hidden = false;
    input.setAttribute("aria-expanded", "true");

    // Focus the selected day, or the first of the current month
    const value = calendar.getValue();
    const target = value
      ? new Date(value + "T00:00:00")
      : new Date(today.getFullYear(), today.getMonth(), 1);
    calendar.focusDate(target);

    outsideClickCleanup = onOutsideClick(root, close);
  }

  function close() {
    root.dataset.state = "closed";
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  function selectDate(date) {
    // Delegates to the calendar; input update, close and the faqir:date-change
    // re-emit all happen in onCalendarChange.
    calendar.selectDate(date);
  }

  function getValue() {
    return calendar.getValue();
  }

  function setValue(dateStr) {
    show(dateStr);
  }

  function show(dateStr, silent) {
    const parsed = new Date(dateStr + "T00:00:00");
    if (!isNaN(parsed.getTime())) {
      calendar.setValue(dateStr);
      syncInput(dateStr, parsed, silent);
    }
  }

  // No date: the calendar, the visible input and the submitted value all empty.
  function clear() {
    calendar.clear();
    syncInput("", null);
  }

  function navigate(month, year) {
    calendar.navigate(month, year);
  }

  // Event: calendar selection committed
  function onCalendarChange(e) {
    if (!e.detail || !e.detail.date) return;
    syncInput(e.detail.date, e.detail.dateObj);
    close();
    input.focus();

    root.dispatchEvent(
      new CustomEvent("faqir:date-change", {
        detail: { date: e.detail.date, dateObj: e.detail.dateObj },
        bubbles: true,
      })
    );
  }

  // Event: trigger/input click
  function onTriggerClick() {
    if (root.dataset.state === "open") {
      close();
    } else {
      open();
    }
  }

  // Event: escape on root (bubbles up from the calendar grid too)
  function onRootKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      e.preventDefault();
      // Closing the calendar popup is the whole action — a date picker inside a
      // dialog must not take the dialog down with it. [W3-2]
      e.stopPropagation();
      close();
      input.focus();
    }
  }

  // Start-up: a value the server rendered into the hidden input is the
  // selection — the calendar shows it and the visible input reads it as a
  // person would. Silent: nothing changed.
  const initialValue = valueInput ? valueInput.value : "";
  if (initialValue) show(initialValue, true);

  // A form reset puts the visible input back to its default text but never
  // touches a hidden input, so the rendered value is restored here — after
  // the reset has run, since `reset` fires before it does.
  const form = valueInput && valueInput.form;
  let resetTimer;
  function onFormReset() {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (initialValue ? setValue(initialValue) : clear()));
  }

  trigger?.addEventListener("click", onTriggerClick);
  root.addEventListener("faqir:calendar-change", onCalendarChange);
  root.addEventListener("keydown", onRootKeyDown);
  form?.addEventListener("reset", onFormReset);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close();
    trigger?.removeEventListener("click", onTriggerClick);
    root.removeEventListener("faqir:calendar-change", onCalendarChange);
    root.removeEventListener("keydown", onRootKeyDown);
    form?.removeEventListener("reset", onFormReset);
    clearTimeout(resetTimer);
    if (outsideClickCleanup) outsideClickCleanup();
    calendar.destroy();
    delete root._faqirDatePicker;
  }

  const api = { open, close, getValue, setValue, clear, navigate, selectDate, destroy };
  root._faqirDatePicker = api;
  return api;
}
    return createDatePicker;
  })();

  // ── dialog ── (registry/recipes/dialog/dialog.js)
  var createDialog = controllerRegistry["dialog"] = (function() {
// @ui:controller dialog
// @ui:provides open close toggle destroy

/**
 * Shared modal-dialog controller.
 *
 * It drives both the `dialog` recipe and the `alert-dialog` recipe — the two are
 * one controller, distinguished only by the panel's ARIA role. When the panel
 * declares `role="alertdialog"` the controller switches to the WAI-ARIA
 * alertdialog contract:
 *   - the overlay backdrop does NOT dismiss (only an explicit choice closes it);
 *   - focus lands on the least-destructive action (cancel/close), not the panel;
 *   - Escape still closes by default, but a `data-confirm-required` root traps it
 *     so the user must pick confirm or cancel;
 *   - the footer's `[data-part="confirm"]` / `[data-part="cancel"]` actions emit
 *     cancelable `faqir:confirm` / `faqir:cancel` events (a prevented confirm
 *     keeps the dialog open for async work).
 * A plain `role="dialog"` panel behaves exactly as before.
 */
function createDialog(root) {
  // Prevent double-init
  if (root._faqirDialog) return root._faqirDialog;

  // Overlay and panel are direct children. Trigger and actions may be wrapped
  // in layout primitives, so they are matched by owner: a popover's close
  // button inside the panel belongs to the popover and must not close this.
  const [trigger] = ownParts(root, "trigger");
  const overlay = root.querySelector(":scope > [data-part='overlay']");
  const panel = root.querySelector(":scope > [data-part='panel']");
  const closeButtons = ownParts(root, "close");
  const confirmButtons = ownParts(root, "confirm");
  const cancelButtons = ownParts(root, "cancel");

  // The role is the seam between `dialog` and `alert-dialog` — read it from the
  // markup so a single controller serves both recipes.
  const isAlert = !!panel && panel.getAttribute("role") === "alertdialog";

  // `panel.focus()` on open does nothing without a tabindex: focus stayed on
  // `body`, out of reach of the trap and the root's Escape listener.
  if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");

  let focusCleanup = null;
  let previouslyFocused = null;

  /** A confirm-required alertdialog traps Escape/overlay until an action is taken. */
  function confirmRequired() {
    return isAlert && root.hasAttribute("data-confirm-required");
  }

  /** Emit a cancelable, bubbling `faqir:<type>` event; returns the event. */
  function emit(type, detail) {
    const event = new CustomEvent("faqir:" + type, {
      bubbles: true,
      cancelable: true,
      detail: detail || {},
    });
    root.dispatchEvent(event);
    return event;
  }

  /** On open, focus the least-destructive action for an alert, else the panel. */
  function focusInitial() {
    if (isAlert) {
      const target = cancelButtons[0] || closeButtons[0] || panel;
      target?.focus?.();
    } else {
      panel?.focus?.();
    }
  }

  // Cancels an in-flight "closing" wait when the dialog is re-opened mid-exit.
  let cancelExitWait = null;

  function open() {
    // A second open() (trigger plus an external trigger, say) must not stack
    // another focus trap or overwrite the focus to restore on close.
    if (root.dataset.state === "open" && focusCleanup) return;
    cancelExitWait?.();
    cancelExitWait = null;
    // Re-opened mid-exit: the trap and the focus to restore are still live.
    if (!focusCleanup) previouslyFocused = document.activeElement;
    root.dataset.state = "open";
    overlay.hidden = false;
    panel.hidden = false;
    if (!focusCleanup) focusCleanup = trapFocus(panel);
    focusInitial();
  }

  function close() {
    // Already gone, or already animating out — a second click (confirm then
    // close, say) must not start a second wait on top of the one in flight.
    if (root.dataset.state === "closed" || root.dataset.state === "closing") return;

    root.dataset.state = "closing";

    const onEnd = () => {
      cancelExitWait = null;
      const active = document.activeElement;
      root.dataset.state = "closed";
      overlay.hidden = true;
      panel.hidden = true;
      if (focusCleanup) focusCleanup();
      focusCleanup = null;
      returnFocus(root, previouslyFocused, active);
    };

    // The panel's own exit motion. A footer button's `background` transitionend
    // bubbles here the instant the pointer touches it, and used to eat the
    // one-shot listener — snapping the panel away mid-animation at best, and at
    // worst leaving it up. No property filter: the panel's exit is an
    // `animation` in some themes and a `transition` in others. See
    // `whenExitDone`. [W2-1]
    cancelExitWait = whenExitDone(panel, null, onEnd);
  }

  /**
   * Tear the overlay down NOW — no exit animation, no focus restore.
   *
   * `destroy()` unbound every listener and left the panel and its backdrop
   * exactly where they were: a full-page block whose close button, Escape key
   * and overlay click had all just stopped working, with no way out. An SPA
   * route change destroys controllers and does precisely this. The model is
   * `context-menu`, which has always closed itself on teardown. [W3-2]
   */
  function dismiss() {
    cancelExitWait?.();
    cancelExitWait = null;
    root.dataset.state = "closed";
    if (overlay) overlay.hidden = true;
    if (panel) panel.hidden = true;
    if (focusCleanup) focusCleanup();
    focusCleanup = null;
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  // Event listeners
  function onTriggerClick() {
    open();
  }
  function onOverlayClick() {
    close();
  }
  // In alert mode, dismissing without confirming is a cancel; the plain dialog
  // just closes.
  function onCloseClick() {
    if (isAlert) emit("cancel", { reason: "close" });
    close();
  }
  function onCancelClick() {
    emit("cancel", { reason: "cancel" });
    close();
  }
  function onConfirmClick() {
    const variant =
      panel?.getAttribute("data-variant") ||
      root.getAttribute("data-variant") ||
      "default";
    const event = emit("confirm", { variant });
    // A handler may keep the dialog open (e.g. to await a destructive request)
    // by calling preventDefault() on the confirm event.
    if (!event.defaultPrevented) close();
  }
  function onKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      // WAI-ARIA allows Escape to close an alertdialog, but a confirm-required
      // variant traps it so the user must make an explicit choice.
      if (confirmRequired()) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (isAlert) emit("cancel", { reason: "escape" });
      close();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  // An alertdialog must not dismiss on overlay click — only an explicit choice
  // closes it — so the overlay handler is bound for plain dialogs only.
  if (!isAlert) overlay?.addEventListener("click", onOverlayClick);
  closeButtons.forEach((btn) => btn.addEventListener("click", onCloseClick));
  confirmButtons.forEach((btn) => btn.addEventListener("click", onConfirmClick));
  cancelButtons.forEach((btn) => btn.addEventListener("click", onCancelClick));
  root.addEventListener("keydown", onKeyDown);

  // Support external triggers: any element with [data-open="{dialog-id}"]
  const externalTriggers = root.id
    ? document.querySelectorAll(`[data-open="${root.id}"]`)
    : [];
  if (externalTriggers.length) {
    externalTriggers.forEach((el) =>
      el.addEventListener("click", onTriggerClick)
    );
  }

  function destroy() {
    trigger?.removeEventListener("click", onTriggerClick);
    if (!isAlert) overlay?.removeEventListener("click", onOverlayClick);
    closeButtons.forEach((btn) =>
      btn.removeEventListener("click", onCloseClick)
    );
    confirmButtons.forEach((btn) =>
      btn.removeEventListener("click", onConfirmClick)
    );
    cancelButtons.forEach((btn) =>
      btn.removeEventListener("click", onCancelClick)
    );
    root.removeEventListener("keydown", onKeyDown);
    if (externalTriggers.length) {
      externalTriggers.forEach((el) =>
        el.removeEventListener("click", onTriggerClick)
      );
    }
    dismiss();
    delete root._faqirDialog;
  }

  const api = { open, close, toggle, destroy };
  root._faqirDialog = api;
  return api;
}
    return createDialog;
  })();

  // ── drawer ── (registry/recipes/drawer/drawer.js)
  var createDrawer = controllerRegistry["drawer"] = (function() {
// @ui:controller drawer
// @ui:provides open close toggle destroy

function createDrawer(root) {
  // Prevent double-init
  if (root._faqirDrawer) return root._faqirDrawer;

  // Overlay and panel are direct children; trigger and close buttons are
  // matched by owner, so a nested component's close leaves this one alone.
  const [trigger] = ownParts(root, "trigger");
  const overlay = root.querySelector(":scope > [data-part='overlay']");
  const panel = root.querySelector(":scope > [data-part='panel']");
  const closeButtons = ownParts(root, "close");

  // `panel.focus()` on open does nothing without a tabindex: focus stayed on
  // `body`, out of reach of the trap and the root's Escape listener.
  if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");

  let focusCleanup = null;
  let previouslyFocused = null;
  let prevBodyOverflow = null;

  // Scroll lock: an open modal drawer freezes the page behind it. The guard makes
  // lock/unlock idempotent so overlapping open/close sequences (or a double
  // open) can never leave the body stuck at `overflow: hidden`.
  function lockScroll() {
    if (prevBodyOverflow !== null) return;
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (prevBodyOverflow === null) return;
    document.body.style.overflow = prevBodyOverflow;
    prevBodyOverflow = null;
  }

  // Cancels an in-flight "closing" wait when the drawer is re-opened mid-slide.
  let cancelExitWait = null;

  function open() {
    cancelExitWait?.();
    cancelExitWait = null;
    previouslyFocused = document.activeElement;
    root.dataset.state = "open";
    overlay.hidden = false;
    panel.hidden = false;
    lockScroll();
    focusCleanup = trapFocus(panel);
    panel.focus?.();
  }

  function close() {
    // Already gone, or already sliding out — a second click must not start a
    // second wait on top of the one in flight.
    if (root.dataset.state === "closed" || root.dataset.state === "closing") return;

    root.dataset.state = "closing";

    const onEnd = () => {
      cancelExitWait = null;
      const active = document.activeElement;
      root.dataset.state = "closed";
      overlay.hidden = true;
      panel.hidden = true;
      unlockScroll();
      if (focusCleanup) focusCleanup();
      focusCleanup = null;
      returnFocus(root, previouslyFocused, active);
    };

    // The panel's OWN `transform` — not the close button's `background`, which
    // bubbles up to the panel the moment the pointer touches it and used to eat
    // the one-shot listener, stranding the drawer at "closing" with the overlay
    // still covering the page. See `whenExitDone`. [W2-1]
    cancelExitWait = whenExitDone(panel, "transform", onEnd);
  }

  /**
   * Tear the overlay down NOW — no exit animation, no focus restore.
   *
   * `destroy()` unbound every listener and left the panel and its backdrop
   * exactly where they were: a full-page block whose close button, Escape key
   * and overlay click had all just stopped working, with no way out. An SPA
   * route change destroys controllers and does precisely this. The model is
   * `context-menu`, which has always closed itself on teardown. [W3-2]
   */
  function dismiss() {
    cancelExitWait?.();
    cancelExitWait = null;
    root.dataset.state = "closed";
    if (overlay) overlay.hidden = true;
    if (panel) panel.hidden = true;
    unlockScroll();
    if (focusCleanup) focusCleanup();
    focusCleanup = null;
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  // Event listeners
  function onTriggerClick() {
    open();
  }

  function onOverlayClick() {
    close();
  }

  function onCloseClick() {
    close();
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      e.stopPropagation();
      close();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  overlay?.addEventListener("click", onOverlayClick);
  closeButtons.forEach((btn) => btn.addEventListener("click", onCloseClick));
  root.addEventListener("keydown", onKeyDown);

  // Support external triggers: any element with [data-open="{drawer-id}"]
  const externalTriggers = root.id
    ? document.querySelectorAll(`[data-open="${root.id}"]`)
    : [];
  if (externalTriggers.length) {
    externalTriggers.forEach((el) =>
      el.addEventListener("click", onTriggerClick)
    );
  }

  function destroy() {
    trigger?.removeEventListener("click", onTriggerClick);
    overlay?.removeEventListener("click", onOverlayClick);
    closeButtons.forEach((btn) =>
      btn.removeEventListener("click", onCloseClick)
    );
    root.removeEventListener("keydown", onKeyDown);
    if (externalTriggers.length) {
      externalTriggers.forEach((el) =>
        el.removeEventListener("click", onTriggerClick)
      );
    }
    dismiss();
    delete root._faqirDrawer;
  }

  const api = { open, close, toggle, destroy };
  root._faqirDrawer = api;
  return api;
}
    return createDrawer;
  })();

  // ── dropdown ── (registry/recipes/dropdown/dropdown.js)
  var createDropdown = controllerRegistry["dropdown"] = (function() {
// @ui:controller dropdown
// @ui:provides open close toggle destroy

function createDropdown(root) {
  // Prevent double-init
  if (root._faqirDropdown) return root._faqirDropdown;

  const trigger = root.querySelector("[data-part='trigger']");
  const menu = root.querySelector("[data-part='menu']");

  // Incomplete markup — a wrapper emitted without one of its parts, which is
  // what a generator interrupted mid-component produces — used to throw a
  // TypeError out of the first dereference below. The engine contains that now
  // (the component fails, the page survives), but "Cannot read properties of
  // null" is a poor way to say which part is missing. Say it, and hand back an
  // inert API so `$ui.open()` is a no-op rather than a second crash. [W3-2]
  if (!trigger || !menu) {
    console.warn(
      "[Faqir] dropdown needs [data-part='trigger'] and [data-part='menu'] — " +
        `missing ${[!trigger && "trigger", !menu && "menu"].filter(Boolean).join(" and ")}. ` +
        "Component left inert.",
      root
    );
    const inert = { open() {}, close() {}, toggle() {}, destroy() {} };
    root._faqirDropdown = inert;
    return inert;
  }

  let outsideClickCleanup = null;

  const navigation = createMenuNavigation(menu, {
    onEscape() {
      close();
    },
    onTab() {
      close({ restoreFocus: false });
    },
  });

  function open(options = {}) {
    const focus = options.focus || "first";
    root.dataset.state = "open";
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");

    if (focus === "last") navigation.focusLast();
    else navigation.focusFirst();

    // Close on outside click
    if (outsideClickCleanup) outsideClickCleanup();
    outsideClickCleanup = onOutsideClick(root, () => close({ restoreFocus: false }));
  }

  function close(options = {}) {
    const restoreFocus = options.restoreFocus !== false;
    root.dataset.state = "closed";
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }

    if (restoreFocus) trigger.focus();
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  function onTriggerClick() {
    toggle();
  }

  function onTriggerKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (root.dataset.state !== "open") open({ focus: e.key === "ArrowUp" ? "last" : "first" });
      else if (e.key === "ArrowUp") navigation.focusLast();
      else navigation.focusFirst();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  trigger?.addEventListener("keydown", onTriggerKeyDown);

  // Delegate item clicks
  function onMenuClick(e) {
    const item = e.target.closest("[data-part='item']");
    if (
      item &&
      item.closest('[role="menu"]') === menu &&
      !item.disabled &&
      item.getAttribute("aria-disabled") !== "true"
    ) close();
  }
  menu?.addEventListener("click", onMenuClick);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close({ restoreFocus: false });
    trigger?.removeEventListener("click", onTriggerClick);
    trigger?.removeEventListener("keydown", onTriggerKeyDown);
    menu?.removeEventListener("click", onMenuClick);
    navigation.destroy();
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirDropdown;
  }

  const api = { open, close, toggle, destroy };
  root._faqirDropdown = api;
  return api;
}
    return createDropdown;
  })();

  // ── file-upload ── (registry/recipes/file-upload/file-upload.js)
  var createFileUpload = controllerRegistry["file-upload"] = (function() {
// @ui:controller file-upload
// @ui:provides getFiles open remove clear destroy

/**
 * Drag-and-drop file collection with a native file-input fallback.
 *
 * The controller only validates and retains local File objects. Application
 * code owns every upload operation through the bubbling events documented in
 * the manifest.
 */
function createFileUpload(root) {
  if (root._faqirFileUpload) return root._faqirFileUpload;

  let dropzone = root.querySelector("[data-part='dropzone']");
  if (!dropzone) {
    dropzone = document.createElement("label");
    dropzone.setAttribute("data-part", "dropzone");
    root.prepend(dropzone);
  }

  let input = root.querySelector("[data-part='input']");
  if (!input) {
    input = document.createElement("input");
    input.setAttribute("data-part", "input");
    dropzone.prepend(input);
  }
  input.setAttribute("type", "file");

  let description = root.querySelector("[data-part='description']");
  if (description) {
    if (!description.id) description.id = uid("faqir-file-upload-help");
    if (!input.hasAttribute("aria-describedby")) {
      input.setAttribute("aria-describedby", description.id);
    }
  }

  if (dropzone.tagName === "LABEL" && !dropzone.contains(input)) {
    if (!input.id) input.id = uid("faqir-file-upload-input");
    dropzone.htmlFor = input.id;
  }

  let list = root.querySelector("[data-part='list']");
  if (!list) {
    list = document.createElement("ul");
    list.setAttribute("data-part", "list");
    list.setAttribute("aria-label", "Selected files");
    root.appendChild(list);
  }

  let status = root.querySelector("[data-part='status']");
  if (!status) {
    status = document.createElement("span");
    status.setAttribute("data-part", "status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.appendChild(status);
  }

  if (root.hasAttribute("data-disabled")) input.disabled = true;

  let selected = [];
  let dragging = false;
  let fileByRow = new WeakMap();

  function isDisabled() {
    return root.hasAttribute("data-disabled") || input.disabled;
  }

  function toFileList(files) {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const list = transfer.files;
    if (list instanceof FileList) return list;

    // Happy DOM currently returns File[] from DataTransfer.files. Preserve the
    // browser contract in that harness without changing the real-browser path.
    try {
      const fallback = new FileList();
      fallback.push(...files);
      return fallback;
    } catch {
      return list;
    }
  }

  function syncState() {
    root.dataset.state = dragging
      ? "dragging"
      : selected.length > 0
        ? "has-files"
        : "idle";
  }

  function syncInput() {
    try {
      input.files = toFileList(selected);
    } catch {
      // Some browsers intentionally expose FileList as read-only. The event
      // payload and controller's retained list remain authoritative.
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function render() {
    fileByRow = new WeakMap();
    list.replaceChildren();

    if (selected.length === 0) {
      const empty = document.createElement("li");
      empty.setAttribute("data-part", "empty");
      empty.textContent = "No files selected";
      list.appendChild(empty);
      syncState();
      return;
    }

    for (const file of selected) {
      const row = document.createElement("li");
      row.setAttribute("data-part", "file");
      fileByRow.set(row, file);

      const details = document.createElement("span");
      details.setAttribute("data-part", "details");

      const name = document.createElement("span");
      name.setAttribute("data-part", "name");
      name.textContent = file.name;

      const metadata = document.createElement("span");
      metadata.setAttribute("data-part", "metadata");
      metadata.textContent = `${file.type || "Unknown type"} · ${formatSize(file.size)}`;

      const remove = document.createElement("button");
      remove.setAttribute("data-part", "remove");
      remove.setAttribute("type", "button");
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "Remove";
      remove.disabled = isDisabled();

      details.append(name, metadata);
      row.append(details, remove);
      list.appendChild(row);
    }
    syncState();
  }

  function emit(type, detail) {
    root.dispatchEvent(
      new CustomEvent("faqir:" + type, { bubbles: true, detail }),
    );
  }

  function acceptTokens() {
    return input.accept
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }

  function matchesAccept(file) {
    const tokens = acceptTokens();
    if (tokens.length === 0) return true;

    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    return tokens.some((token) => {
      if (token.startsWith(".")) return name.endsWith(token);
      if (token.endsWith("/*")) {
        return type.startsWith(token.slice(0, -1));
      }
      return type === token;
    });
  }

  function maxSize() {
    const raw = root.getAttribute("data-max-size");
    if (raw == null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function rejectionReason(file) {
    if (!matchesAccept(file)) return "accept";
    const limit = maxSize();
    if (limit != null && file.size > limit) return "max-size";
    return null;
  }

  function rejectionMessage(file, reason) {
    if (reason === "max-size") return `${file.name} exceeds the maximum file size.`;
    return `${file.name} is not an accepted file type.`;
  }

  function addFiles(fileList, source) {
    if (isDisabled()) return toFileList([]);

    const accepted = [];
    const limit = maxSize();
    for (const file of Array.from(fileList || [])) {
      const reason = rejectionReason(file);
      if (reason) {
        status.textContent = rejectionMessage(file, reason);
        emit("file-reject", {
          file,
          reason,
          accept: input.accept,
          maxSize: limit,
          source,
        });
      } else {
        accepted.push(file);
      }
    }

    selected.push(...accepted);
    syncInput();
    render();

    const files = toFileList(accepted);
    emit("files", {
      files,
      allFiles: toFileList(selected),
      source,
    });
    return files;
  }

  function remove(target) {
    const index = typeof target === "number"
      ? target
      : selected.indexOf(target);
    if (index < 0 || index >= selected.length || isDisabled()) return false;

    const [file] = selected.splice(index, 1);
    syncInput();
    render();
    status.textContent = `${file.name} removed.`;
    emit("file-remove", {
      file,
      index,
      files: toFileList(selected),
    });
    return true;
  }

  function clear() {
    if (isDisabled()) return false;
    while (selected.length > 0) remove(0);
    return true;
  }

  function getFiles() {
    return toFileList(selected);
  }

  function open() {
    if (!isDisabled()) input.click();
  }

  function onDragEnter(event) {
    event.preventDefault();
    if (isDisabled()) return;
    dragging = true;
    syncState();
  }

  function onDragOver(event) {
    event.preventDefault();
    if (isDisabled()) return;
    dragging = true;
    if (event.dataTransfer) {
      try {
        event.dataTransfer.dropEffect = "copy";
      } catch {
        /* read-only in some DOM implementations */
      }
    }
    syncState();
  }

  function onDragLeave(event) {
    const next = event.relatedTarget;
    if (next && root.contains(next)) return;
    dragging = false;
    syncState();
  }

  function onDrop(event) {
    event.preventDefault();
    dragging = false;
    if (isDisabled()) {
      syncState();
      return;
    }
    addFiles(event.dataTransfer?.files, "drop");
  }

  function onChange() {
    addFiles(input.files, "input");
  }

  function onClick(event) {
    const removeButton = event.target?.closest?.("[data-part='remove']");
    if (
      !removeButton ||
      removeButton.closest("[data-ui='file-upload']") !== root
    ) return;
    const row = removeButton.closest("[data-part='file']");
    const file = row && fileByRow.get(row);
    if (file) remove(file);
  }

  dropzone.addEventListener("dragenter", onDragEnter);
  dropzone.addEventListener("dragover", onDragOver);
  dropzone.addEventListener("dragleave", onDragLeave);
  dropzone.addEventListener("drop", onDrop);
  input.addEventListener("change", onChange);
  root.addEventListener("click", onClick);

  render();

  const api = {
    getFiles,
    open,
    remove,
    clear,
    destroy() {
      dropzone.removeEventListener("dragenter", onDragEnter);
      dropzone.removeEventListener("dragover", onDragOver);
      dropzone.removeEventListener("dragleave", onDragLeave);
      dropzone.removeEventListener("drop", onDrop);
      input.removeEventListener("change", onChange);
      root.removeEventListener("click", onClick);
      dragging = false;
      syncState();
      delete root._faqirFileUpload;
    },
  };

  root._faqirFileUpload = api;
  return api;
}
    return createFileUpload;
  })();

  // ── input-otp ── (registry/recipes/input-otp/input-otp.js)
  var createInputOTP = controllerRegistry["input-otp"] = (function() {
// @ui:controller input-otp
// @ui:provides getValue setValue clear focus destroy

/**
 * input-otp — segmented one-time-code entry.
 *
 * ── Approach: ONE real input, N presentational segments ─────────────────────
 * The widget is a single, real `<input data-part="input">` stretched over a row
 * of decorative `[data-part="segment"]` boxes. The input is transparent (text,
 * caret and background) and sits on top, so every keystroke, paste, selection,
 * IME composition and — crucially — mobile SMS autofill goes through native form
 * machinery. The segments are `aria-hidden` and merely mirror the input's value.
 *
 * Why not one `<input>` per segment? Because the single-input design wins on the
 * exact axes this recipe is judged on:
 *
 *   • Paste — the browser inserts pasted text at the caret for free; we only have
 *     to strip characters that don't fit the mode. N separate inputs would each
 *     have to re-split and redistribute a paste by hand, and browsers deliver a
 *     multi-character paste inconsistently across split fields.
 *   • Screen readers — one labelled field announces as "One-time code, edit text"
 *     instead of N adjacent "1 of 6 … 2 of 6" edit boxes, which is far less
 *     confusing. WAI has no dedicated OTP pattern; an OTP field IS a text input,
 *     so we keep it a text input and give it a name + autocomplete.
 *   • Mobile autofill — iOS/Android surface the SMS code for `inputmode` +
 *     `autocomplete="one-time-code"` on a SINGLE field; across N fields only the
 *     first is offered the value and the rest are never populated.
 *
 * ── What the controller owns ────────────────────────────────────────────────
 * Runtime state only. It never fetches, never routes, never touches classes. It
 * reflects the input's value onto the segments (`data-filled`), marks the caret
 * segment (`data-active` / `data-caret`), and sets `data-state="complete"` on the
 * root when full. Typing/backspace/paste are handled explicitly so behaviour is
 * identical across browsers (and unit-testable without native text editing), while
 * a catch-all `input` listener still absorbs autofill / IME that arrives whole.
 *
 * Events (bubbling): `faqir:change` on every value change (`detail.value`), and
 * `faqir:complete` exactly once per completion — fired on the not-full → full
 * transition, re-armed only after the value drops below full again.
 *
 * When the real input also carries `l-mask="999999"`, the optional faqir-mask
 * plugin owns edit normalization and emits `faqir:mask`; this controller mirrors
 * the event's raw value into its segments. Without the plugin, the self-contained
 * keyboard/paste path below remains the byte-for-byte behavioral fallback.
 */
function createInputOTP(root) {
  // Idempotent: a second init returns the existing API.
  if (root._faqirInputOTP) return root._faqirInputOTP;

  const N = clampInt(root.getAttribute("data-length"), 6, 1, 12);
  const mode = root.getAttribute("data-mode") === "alphanumeric" ? "alphanumeric" : "numeric";

  // ── Resolve / normalize the real input ─────────────────────────────────────
  let input = root.querySelector("[data-part='input']");
  if (!input) {
    input = document.createElement("input");
    input.setAttribute("data-part", "input");
    input.setAttribute("type", "text");
    root.insertBefore(input, root.firstChild);
  }
  input.setAttribute("maxlength", String(N));
  try {
    input.maxLength = N;
  } catch {
    /* some environments make maxLength read-only on detached nodes — attribute suffices */
  }
  // Mobile-friendly defaults — authors may override in markup.
  if (!input.getAttribute("inputmode")) {
    input.setAttribute("inputmode", mode === "numeric" ? "numeric" : "text");
  }
  if (!input.getAttribute("autocomplete")) input.setAttribute("autocomplete", "one-time-code");
  if (!input.hasAttribute("aria-label") && !input.hasAttribute("aria-labelledby")) {
    input.setAttribute("aria-label", "One-time code");
  }
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("spellcheck", "false");
  if (mode === "numeric" && !input.hasAttribute("pattern")) input.setAttribute("pattern", "[0-9]*");
  if (isDisabled()) input.disabled = true;

  // ── Resolve / normalize the segment row ────────────────────────────────────
  let container = root.querySelector("[data-part='segments']");
  if (!container) {
    container = document.createElement("div");
    container.setAttribute("data-part", "segments");
    root.appendChild(container);
  }
  // Segments are decorative — the real input is the accessible control.
  container.setAttribute("aria-hidden", "true");

  let segments = [...container.querySelectorAll("[data-part='segment']")];
  if (segments.length !== N) {
    // data-length is authoritative: rebuild the row to match it exactly.
    container.textContent = "";
    segments = [];
    for (let i = 0; i < N; i++) {
      const seg = document.createElement("div");
      seg.setAttribute("data-part", "segment");
      container.appendChild(seg);
      segments.push(seg);
    }
  }

  // ── Value plumbing ──────────────────────────────────────────────────────────
  let focused = false;
  let wasComplete = false;
  let lastValue = "";

  function isDisabled() {
    return root.hasAttribute("data-disabled");
  }

  function charOk(ch) {
    return mode === "alphanumeric" ? /[a-z0-9]/i.test(ch) : /[0-9]/.test(ch);
  }

  /** Keep only mode-legal characters (no length cap — callers cap to N). */
  function filter(str) {
    let out = "";
    for (const ch of String(str == null ? "" : str)) if (charOk(ch)) out += ch;
    return out;
  }

  /** Optional faqir-mask bridge installed by the l-mask plugin. */
  function maskApi() {
    return input._faqirMask && typeof input._faqirMask.getRaw === "function"
      ? input._faqirMask
      : null;
  }

  function currentValue() {
    const mask = maskApi();
    return mask ? mask.getRaw() : input.value;
  }

  /** Paint segments + caret from the input's current value. No events. */
  function refresh() {
    const val = currentValue();
    for (let i = 0; i < N; i++) {
      const ch = val[i];
      const seg = segments[i];
      if (ch != null) {
        seg.textContent = ch;
        seg.setAttribute("data-filled", "");
      } else {
        seg.textContent = "";
        seg.removeAttribute("data-filled");
      }
    }
    if (val.length === N) root.setAttribute("data-state", "complete");
    else root.removeAttribute("data-state");
    updateActive();
  }

  /** Mark the caret segment (collapsed) or the selected span (range). */
  function updateActive() {
    for (const seg of segments) {
      seg.removeAttribute("data-active");
      seg.removeAttribute("data-caret");
    }
    if (!focused || isDisabled()) return;

    const len = input.value.length;
    let start = input.selectionStart;
    let end = input.selectionEnd;
    if (start == null) start = len;
    if (end == null) end = start;

    if (start !== end) {
      for (let i = start; i < end && i < N; i++) segments[i]?.setAttribute("data-active", "");
      return;
    }
    const idx = Math.min(start, N - 1);
    const seg = segments[idx];
    if (!seg) return;
    seg.setAttribute("data-active", "");
    // Blink a caret only in the next-to-fill empty slot — the crisp OTP look.
    if (start === len && len < N) seg.setAttribute("data-caret", "");
  }

  function emit(type, detail) {
    root.dispatchEvent(new CustomEvent("faqir:" + type, { bubbles: true, detail }));
  }

  /** Repaint, then fire change / complete based on the transition. */
  function syncAndEmit() {
    refresh();
    const val = currentValue();
    if (val !== lastValue) {
      lastValue = val;
      emit("change", { value: val });
    }
    const complete = val.length === N;
    if (complete && !wasComplete) {
      wasComplete = true;
      emit("complete", { value: val });
    } else if (!complete) {
      wasComplete = false;
    }
  }

  /** The single write seam: set value + caret, then sync/emit. */
  function commit(next, caret) {
    const mask = maskApi();
    if (mask && typeof mask.setRaw === "function") {
      mask.setRaw(next, caret == null ? next.length : caret, true);
      return;
    }
    input.value = next;
    const c = caret == null ? next.length : Math.max(0, Math.min(caret, next.length));
    try {
      input.setSelectionRange(c, c);
    } catch {
      /* selection API unavailable on this input type/env — value is still correct */
    }
    syncAndEmit();
  }

  /** Insert mode-legal text at the caret, replacing any selection, capped at N. */
  function insertText(text) {
    const clean = filter(text);
    if (!clean) return;
    const val = input.value;
    let start = input.selectionStart;
    let end = input.selectionEnd;
    if (start == null) start = val.length;
    if (end == null) end = start;
    const next = (val.slice(0, start) + clean + val.slice(end)).slice(0, N);
    commit(next, start + clean.length);
  }

  function setCaret(pos) {
    const c = Math.max(0, Math.min(pos, input.value.length));
    try {
      input.setSelectionRange(c, c);
    } catch {
      /* ignore */
    }
    updateActive();
  }

  // ── Keyboard: explicit, deterministic editing ──────────────────────────────
  function onKeyDown(e) {
    if (isDisabled()) return;
    // Copy / paste / select-all / undo — let the browser + paste handler run.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    focused = true;
    const val = input.value;
    let start = input.selectionStart;
    let end = input.selectionEnd;
    if (start == null) start = val.length;
    if (end == null) end = start;

    // faqir-mask consumes the browser's beforeinput/paste path and reports its
    // raw result through faqir:mask. Leave text edits to it; keep only explicit
    // caret navigation here. The standalone fallback below remains unchanged.
    if (maskApi() && (e.key === "Backspace" || e.key === "Delete" || e.key.length === 1)) {
      return;
    }

    switch (e.key) {
      case "Backspace":
        e.preventDefault();
        if (start !== end) commit(val.slice(0, start) + val.slice(end), start);
        else if (start > 0) commit(val.slice(0, start - 1) + val.slice(start), start - 1);
        else updateActive();
        return;
      case "Delete":
        e.preventDefault();
        if (start !== end) commit(val.slice(0, start) + val.slice(end), start);
        else commit(val.slice(0, start) + val.slice(start + 1), start);
        return;
      case "ArrowLeft":
        e.preventDefault();
        // Collapsed caret steps left; a selection collapses to its start.
        setCaret(start === end ? start - 1 : start);
        return;
      case "ArrowRight":
        e.preventDefault();
        // Collapsed caret steps right; a selection collapses to its end.
        setCaret(start === end ? end + 1 : end);
        return;
      case "Home":
        e.preventDefault();
        setCaret(0);
        return;
      case "End":
        e.preventDefault();
        setCaret(val.length);
        return;
      default:
        // A single printable character — insert it (invalid chars are dropped).
        if (e.key.length === 1) {
          e.preventDefault();
          insertText(e.key);
        }
        // Everything else (Tab, Shift, arrows with modifiers, F-keys) passes through.
    }
  }

  // ── Paste: native cursor semantics, we only sanitize ───────────────────────
  function onPaste(e) {
    if (isDisabled()) return;
    e.preventDefault();
    focused = true;
    const data = e.clipboardData || (typeof window !== "undefined" && window.clipboardData);
    const text = data && typeof data.getData === "function" ? data.getData("text") : "";
    insertText(text);
  }

  // ── Catch-all: autofill / IME / anything not intercepted above ─────────────
  function onInput() {
    if (isDisabled()) return;
    focused = true;
    const clean = filter(input.value).slice(0, N);
    if (clean !== input.value) {
      const pos = Math.min(input.selectionStart == null ? clean.length : input.selectionStart, clean.length);
      commit(clean, pos);
    } else {
      syncAndEmit();
    }
  }

  function onMask() {
    if (isDisabled()) return;
    focused = typeof document === "undefined" || document.activeElement === input;
    syncAndEmit();
  }

  function onFocus() {
    focused = true;
    // Predictable caret: land on the next-to-fill slot unless mid-editing.
    if (input.selectionStart === input.selectionEnd) setCaret(input.value.length);
    else updateActive();
  }
  function onBlur() {
    focused = false;
    updateActive();
  }
  function onClick() {
    focused = true;
    // Segments are pointer-events:none, so the click already hit the input;
    // snap the caret to the end for a consistent active segment.
    setCaret(input.value.length);
  }
  function onSelectionChange() {
    if (typeof document !== "undefined" && document.activeElement === input) updateActive();
  }

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("paste", onPaste);
  input.addEventListener("input", onInput);
  input.addEventListener("faqir:mask", onMask);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  input.addEventListener("click", onClick);
  if (typeof document !== "undefined") document.addEventListener("selectionchange", onSelectionChange);

  // ── Seed from data-value / existing input value, silently (no events) ───────
  {
    const seed = filter(input.value || root.getAttribute("data-value") || "").slice(0, N);
    input.value = seed;
    lastValue = seed;
    wasComplete = seed.length === N;
    refresh();
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  function getValue() {
    return currentValue();
  }
  /** Programmatic set — silent (does not fire change/complete). */
  function setValue(str) {
    const clean = filter(str).slice(0, N);
    const mask = maskApi();
    if (mask && typeof mask.setRaw === "function") mask.setRaw(clean, clean.length, false);
    else input.value = clean;
    lastValue = clean;
    wasComplete = clean.length === N;
    refresh();
  }
  function clear() {
    setValue("");
  }
  function focus() {
    try {
      input.focus();
    } catch {
      /* ignore */
    }
  }

  function destroy() {
    input.removeEventListener("keydown", onKeyDown);
    input.removeEventListener("paste", onPaste);
    input.removeEventListener("input", onInput);
    input.removeEventListener("faqir:mask", onMask);
    input.removeEventListener("focus", onFocus);
    input.removeEventListener("blur", onBlur);
    input.removeEventListener("click", onClick);
    if (typeof document !== "undefined") document.removeEventListener("selectionchange", onSelectionChange);
    delete root._faqirInputOTP;
  }

  const api = { getValue, setValue, clear, focus, destroy };
  root._faqirInputOTP = api;
  return api;
}

// Parse an integer attribute, clamped to [lo, hi], with a fallback.
function clampInt(raw, fallback, lo, hi) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
    return createInputOTP;
  })();

  // ── menubar ── (registry/recipes/menubar/menubar.js)
  var createMenubar = controllerRegistry["menubar"] = (function() {
// @ui:controller menubar
// @ui:provides open close destroy

function createMenubar(root) {
  if (root._faqirMenubar) return root._faqirMenubar;

  const submenus = [...root.querySelectorAll("[data-part='submenu'][role='menu']")]
    .filter((menu) => menu.closest("[data-ui='menubar']") === root);
  const submenuNavigations = new Map();

  let topNavigation;

  function ownerOf(item) {
    return item?.closest("[role='menu'], [role='menubar']");
  }

  function topItems() {
    return topNavigation?.items() ?? [];
  }

  function submenuFor(item) {
    const controls = item?.getAttribute("aria-controls");
    if (controls) {
      const controlled = submenus.find((menu) => menu.id === controls);
      if (controlled) return controlled;
    }

    const sibling = item?.nextElementSibling;
    return sibling?.matches("[data-part='submenu'][role='menu']")
      ? sibling
      : null;
  }

  function parentFor(menu) {
    return topItems().find((item) => submenuFor(item) === menu) ?? null;
  }

  function isAriaDisabled(item) {
    return item?.getAttribute("aria-disabled") === "true";
  }

  function collapseAll() {
    let previousParent = null;

    for (const menu of submenus) {
      const parent = parentFor(menu);
      if (!menu.hidden && parent) previousParent = parent;
      menu.hidden = true;
      parent?.setAttribute("aria-expanded", "false");
    }

    root.dataset.state = "closed";
    return previousParent;
  }

  function openFor(item, focus = "first") {
    const menu = submenuFor(item);
    if (!menu || isAriaDisabled(item)) return false;

    collapseAll();
    topNavigation.sync(item);
    menu.hidden = false;
    item.setAttribute("aria-expanded", "true");
    root.dataset.state = "open";

    const navigation = submenuNavigations.get(menu);
    if (focus === "last") navigation?.focusLast();
    else if (focus === "first") navigation?.focusFirst();
    else item.focus();

    return true;
  }

  function open(index = 0, focus = "first") {
    const allItems = topItems();
    const item = typeof index === "number" ? allItems[index] : index;
    return item ? openFor(item, focus) : false;
  }

  function close(restoreFocus = true) {
    const parent = collapseAll();
    if (restoreFocus && parent) {
      topNavigation.sync(parent);
      parent.focus();
    }
  }

  function activateTopItem(item) {
    if (submenuFor(item)) {
      openFor(item, "first");
      return;
    }

    item.click();
  }

  const authoredTopItems = [...root.querySelectorAll("[role='menuitem']")]
    .filter((item) => ownerOf(item) === root);
  const preferredTopItem =
    authoredTopItems.find(
      (item) => item.getAttribute("tabindex") === "0" && !isAriaDisabled(item),
    ) ??
    authoredTopItems.find((item) => !isAriaDisabled(item)) ??
    authoredTopItems[0];

  topNavigation = createMenuNavigation(root, {
    orientation: "horizontal",
    roving: true,
    onActivate: activateTopItem,
    onEscape() {
      // The menubar itself is never hidden, so it receives Escape even with
      // every submenu collapsed. Nothing to dismiss means the keystroke is not
      // ours, and swallowing it would trap the user in whatever encloses the
      // menubar. [W3-2]
      if (root.dataset.state !== "open") return false;
      close(false);
    },
    onTab() {
      close(false);
    },
  });
  topNavigation.sync(preferredTopItem);

  for (const menu of submenus) {
    const navigation = createMenuNavigation(menu, {
      onEscape() {
        const parent = parentFor(menu);
        collapseAll();
        if (parent) {
          topNavigation.sync(parent);
          parent.focus();
        }
      },
      onTab() {
        collapseAll();
      },
    });
    submenuNavigations.set(menu, navigation);
    navigation.items().forEach((item) => {
      item.tabIndex = -1;
    });
  }

  // A menubar is persistent; only its popup submenus have open/closed state.
  collapseAll();

  function moveAcrossMenubar(menu, direction) {
    const parent = parentFor(menu);
    if (!parent) return;

    collapseAll();
    topNavigation.sync(parent);
    const nextItem = direction > 0
      ? topNavigation.focusNext()
      : topNavigation.focusPrevious();

    if (nextItem && submenuFor(nextItem) && !isAriaDisabled(nextItem)) {
      openFor(nextItem, "parent");
    }
  }

  function onKeyDown(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[role='menuitem']");
    if (!item || !root.contains(item)) return;

    const owner = ownerOf(item);
    if (owner === root) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && submenuFor(item)) {
        if (isAriaDisabled(item)) return;
        event.preventDefault();
        openFor(item, event.key === "ArrowUp" ? "last" : "first");
        return;
      }

      // The shared horizontal navigation has already moved focus by the time
      // this listener runs. In open-menu mode, switch the visible submenu too.
      if (
        root.dataset.state === "open" &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        const nextItem = topNavigation.current();
        collapseAll();
        if (nextItem && submenuFor(nextItem) && !isAriaDisabled(nextItem)) {
          openFor(nextItem, "parent");
        }
      }
      return;
    }

    if (!submenus.includes(owner)) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveAcrossMenubar(owner, event.key === "ArrowRight" ? 1 : -1);
    }
  }

  function onClick(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[role='menuitem']");
    if (!item || !root.contains(item)) return;

    if (isAriaDisabled(item)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const owner = ownerOf(item);
    if (owner === root) {
      topNavigation.sync(item);
      item.focus();
      const menu = submenuFor(item);

      if (!menu) {
        collapseAll();
        return;
      }

      event.preventDefault();
      if (!menu.hidden) close(false);
      else openFor(item, "parent");
      return;
    }

    if (submenus.includes(owner)) {
      const parent = parentFor(owner);
      collapseAll();
      if (parent) {
        topNavigation.sync(parent);
        parent.focus();
      }
    }
  }

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("click", onClick, true);

  function destroy() {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("click", onClick, true);
    topNavigation.destroy();
    submenuNavigations.forEach((navigation) => navigation.destroy());
    submenuNavigations.clear();
    delete root._faqirMenubar;
  }

  const api = { open, close, destroy };
  root._faqirMenubar = api;
  return api;
}
    return createMenubar;
  })();

  // ── pagination ── (registry/recipes/pagination/pagination.js)
  var createPagination = controllerRegistry["pagination"] = (function() {
// @ui:controller pagination
// @ui:provides setPage getPage setTotal render destroy

function createPagination(root) {
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
function paginationWindow(currentPage, totalPages, options = {}) {
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
    return createPagination;
  })();

  // ── popover ── (registry/recipes/popover/popover.js)
  var createPopover = controllerRegistry["popover"] = (function() {
// @ui:controller popover
// @ui:provides open close toggle destroy

function createPopover(root) {
  // Prevent double-init
  if (root._faqirPopover) return root._faqirPopover;

  const trigger = root.querySelector("[data-part='trigger']");
  const content = root.querySelector("[data-part='content']");
  // Not a close button belonging to a dialog or popover inside the content.
  const [closeBtn] = ownParts(root, "close");

  let outsideClickCleanup = null;

  function open() {
    root.dataset.state = "open";
    content.hidden = false;
    trigger.setAttribute("aria-expanded", "true");

    // Close on outside click
    outsideClickCleanup = onOutsideClick(root, close);
  }

  function close() {
    root.dataset.state = "closed";
    content.hidden = true;
    trigger.setAttribute("aria-expanded", "false");

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  // Event: trigger click toggles
  function onTriggerClick() {
    toggle();
  }

  // Event: close button
  function onCloseClick(e) {
    e.stopPropagation();
    close();
  }

  // Event: escape closes
  function onKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      e.preventDefault();
      // Dismissing this popover consumes the keystroke — an enclosing dialog or
      // drawer must not close on the same Escape. [W3-2]
      e.stopPropagation();
      close();
      trigger.focus();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  closeBtn?.addEventListener("click", onCloseClick);
  root.addEventListener("keydown", onKeyDown);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    close();
    trigger?.removeEventListener("click", onTriggerClick);
    closeBtn?.removeEventListener("click", onCloseClick);
    root.removeEventListener("keydown", onKeyDown);
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirPopover;
  }

  const api = { open, close, toggle, destroy };
  root._faqirPopover = api;
  return api;
}
    return createPopover;
  })();

  // ── qr-code ── (registry/recipes/qr-code/qr-code.js)
  var createQRCode = controllerRegistry["qr-code"] = (function() {
// @ui:controller qr-code
// @ui:provides render update destroy

/**
 * Minimal QR Code encoder (byte mode, versions 1–40, ISO/IEC 18004).
 * Produces a boolean matrix suitable for SVG rendering: up to 2953 bytes at
 * ECL-L, 2331 at M, 1663 at Q and 1273 at H.
 */

// ── GF(256) arithmetic for Reed-Solomon ──

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  let v = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = v;
    LOG[v] = i;
    v = (v << 1) ^ (v & 128 ? 0x11d : 0);
  }
  EXP[255] = EXP[0];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255];
}

function rsGenPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const msg = new Array(data.length + ecLen).fill(0);
  data.forEach((v, i) => (msg[i] = v));
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// ── QR constants ──

const ECL_MAP = { L: 0, M: 1, Q: 2, H: 3 };

// ISO/IEC 18004 Table 9 for versions 1–40, flattened as [(version - 1) * 4 +
// ecl] (L, M, Q, H) and packed one value per character, value + 40: EC codewords
// per block, and the block count. Data codewords are what is left of the
// version's total once the EC blocks are taken out (tests/recipes/
// forecraft-qr-code.test.ts checks all 160 against the Table 7 capacities).
const EC_PER_BLOCK = "/25928>D7B:><:B8B@:>:8@D<::B@>>BF><@:B@D<FD@@>BDB>@>F@<@>@F@@D@FDDDDFBDDDBBBDBFDDBDFDDF@FDFFFDFFBDFFDDDFFDFFFDFFFDFFFDFFFDFFFDFFFDFFFDFFFDFFFDFFFDFFFDFFFDFFFDFF";
const BLOCKS = "))))))))))**)**,)*,,*,,,*,.-*,..*-00,-00,-03,023,148,188.24:.298.38;.5:=/6=A08<A09?A19?J1:AF2<CH4=EK4?JM4AJP5BKR6DNU7EPX8GS[9IU^:KXa;M[d;N]g<P`j=Scn>Ufr@WiuAYly";

// Codewords in a version: the modules left once the function patterns
// (finders, timing, alignment, format and version info) are taken out, / 8.
function totalCodewords(v) {
  let m = (16 * v + 128) * v + 64;
  if (v > 1) {
    const n = ((v / 7) | 0) + 2;
    m -= (25 * n - 10) * n - 55;
    if (v > 6) m -= 36;
  }
  return m >> 3;
}

function versionInfo(version, eclIdx) {
  const i = (version - 1) * 4 + eclIdx;
  const ec = EC_PER_BLOCK.charCodeAt(i) - 40;
  const b = BLOCKS.charCodeAt(i) - 40;
  return { dc: totalCodewords(version) - ec * b, ec, b };
}

// Alignment centres (ISO/IEC 18004 Annex E): none for v1; otherwise 6, then
// floor(v / 7) + 1 more stepped back evenly from 4v + 10 (7 modules from the far
// edge), the step rounded to an even number.
function alignmentPositions(v) {
  if (v < 2) return [];
  const n = ((v / 7) | 0) + 2;
  const step = (((v * 8 + n * 3 + 5) / (n * 4 - 4)) | 0) * 2;
  const out = [6];
  for (let i = 0, p = v * 4 + 10; i < n - 1; i++, p -= step) out.splice(1, 0, p);
  return out;
}

function selectVersion(dataLen, ecl) {
  const eclIdx = ECL_MAP[ecl] ?? 1;
  for (let v = 1; v <= 40; v++) {
    const info = versionInfo(v, eclIdx);
    // + 4-bit mode and 8-bit (v1–9) or 16-bit (v10) character count, rounded up.
    if (dataLen + (v < 10 ? 2 : 3) <= info.dc) return v;
  }
  return -1;
}

// ── Matrix operations ──

function createMatrix(size) {
  return Array.from({ length: size }, () => new Uint8Array(size));
}

function setModule(matrix, row, col, val, reserved) {
  const s = matrix.length;
  if (row >= 0 && row < s && col >= 0 && col < s) {
    matrix[row][col] = val;
    if (reserved) reserved[row][col] = 1;
  }
}

// Both patterns are concentric squares, coloured by their ring (Chebyshev
// distance from the centre): a finder is dark at rings 0, 1 and 3, light at 2 and
// at its ring-4 separator; an alignment pattern is dark at 0 and 2, light at 1.
function placeFinderPattern(matrix, reserved, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      setModule(matrix, row + r, col + c, d !== 2 && d !== 4 ? 1 : 0, reserved);
    }
  }
}

function placeAlignmentPattern(matrix, reserved, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const d = Math.max(Math.abs(r), Math.abs(c));
      setModule(matrix, row + r, col + c, d !== 1 ? 1 : 0, reserved);
    }
  }
}

function placeTimingPatterns(matrix, reserved) {
  const s = matrix.length;
  for (let i = 8; i < s - 8; i++) {
    const val = i % 2 === 0 ? 1 : 0;
    setModule(matrix, 6, i, val, reserved);
    setModule(matrix, i, 6, val, reserved);
  }
}

function reserveFormatArea(matrix, reserved) {
  const s = matrix.length;
  for (let i = 0; i < 8; i++) {
    setModule(reserved, 8, i, 1);
    setModule(reserved, 8, s - 1 - i, 1);
    setModule(reserved, i, 8, 1);
    setModule(reserved, s - 1 - i, 8, 1);
  }
  setModule(reserved, 8, 8, 1);
  setModule(matrix, s - 8, 8, 1, reserved); // dark module
}

// Versions 7+ carry an 18-bit version word (BCH 18,6) in two 6×3 blocks.
function placeVersionInfo(matrix, reserved, version) {
  if (version < 7) return;
  const s = matrix.length;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const a = s - 11 + (i % 3);
    const b = (i / 3) | 0;
    setModule(matrix, b, a, bit, reserved);
    setModule(matrix, a, b, bit, reserved);
  }
}

function placeData(matrix, reserved, bits) {
  const s = matrix.length;
  let bitIdx = 0;
  for (let col = s - 1, upward = true; col >= 1; col -= 2, upward = !upward) {
    if (col === 6) col = 5; // skip timing column
    for (let i = 0; i < s; i++) {
      const row = upward ? s - 1 - i : i;
      for (let cc = col; cc > col - 2; cc--) {
        // Past the last bit the remainder modules are 0.
        if (!reserved[row][cc]) matrix[row][cc] = bits[bitIdx++] | 0;
      }
    }
  }
}

function applyMask(matrix, reserved, maskId) {
  const s = matrix.length;
  const fns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  const fn = fns[maskId];
  for (let r = 0; r < s; r++) {
    for (let c = 0; c < s; c++) {
      if (!reserved[r][c] && fn(r, c)) {
        matrix[r][c] ^= 1;
      }
    }
  }
}

function placeFormatInfo(matrix, ecl, maskId) {
  const s = matrix.length;
  const eclBits = [1, 0, 3, 2][ECL_MAP[ecl] ?? 1];
  let data = (eclBits << 3) | maskId;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i < 15; i++) {
    const bit = (bits >> (14 - i)) & 1;
    // Around top-left finder
    if (i < 6) matrix[8][i] = bit;
    else if (i === 6) matrix[8][7] = bit;
    else if (i === 7) matrix[8][8] = bit;
    else if (i === 8) matrix[7][8] = bit;
    else matrix[14 - i][8] = bit;
    // The second copy: bits 0–6 up column 8 from the bottom, 7–14 along row 8
    // to the right edge. (s - 8, 8) between them is the always-dark module.
    if (i < 7) matrix[s - 1 - i][8] = bit;
    else matrix[8][s - 15 + i] = bit;
  }
}

// ── Penalty scoring (simplified) ──

// Rule 1: a run of five same-colour modules in a row or a column scores 3, and
// each module beyond five 1 more. Row a and column a are walked together.
function penalty(matrix) {
  const s = matrix.length;
  let score = 0;
  for (let a = 0; a < s; a++) {
    let row = 1;
    let col = 1;
    for (let b = 1; b < s; b++) {
      row = matrix[a][b] === matrix[a][b - 1] ? row + 1 : 1;
      col = matrix[b][a] === matrix[b - 1][a] ? col + 1 : 1;
      score += (row === 5 ? 3 : row > 5) + (col === 5 ? 3 : col > 5);
    }
  }
  return score;
}

// ── Encode ──

function encodeQR(text, ecl = "M") {
  const data = new TextEncoder().encode(text);
  const version = selectVersion(data.length, ecl);
  if (version < 0) {
    throw new Error(`data too long for QR version 40 at ECL ${ecl}`);
  }

  const eclIdx = ECL_MAP[ecl] ?? 1;
  const info = versionInfo(version, eclIdx);
  const size = version * 4 + 17;

  // Build data codewords
  const codewords = [];
  // Mode indicator: byte mode = 0100
  // Character count (8 bits for v1-9, 16 bits for v10+)
  const ccBits = version <= 9 ? 8 : 16;
  let bitBuf = 0;
  let bitCount = 0;

  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((val >> i) & 1);
      bitCount++;
      if (bitCount === 8) {
        codewords.push(bitBuf);
        bitBuf = 0;
        bitCount = 0;
      }
    }
  }

  pushBits(0b0100, 4); // byte mode
  pushBits(data.length, ccBits);
  data.forEach((b) => pushBits(b, 8));
  pushBits(0, 4); // terminator (up to 4 bits)

  // Pad to byte boundary
  if (bitCount > 0) pushBits(0, 8 - bitCount);

  // Pad to capacity
  while (codewords.length < info.dc) {
    codewords.push(0xec);
    if (codewords.length < info.dc) codewords.push(0x11);
  }

  // Split into blocks and compute EC
  const blocks = [];
  const ecBlocks = [];
  const dcPerBlock = Math.floor(info.dc / info.b);
  const remainder = info.dc % info.b;
  let offset = 0;

  for (let i = 0; i < info.b; i++) {
    const blockDc = dcPerBlock + (i >= info.b - remainder ? 1 : 0);
    const blockData = codewords.slice(offset, offset + blockDc);
    offset += blockDc;
    blocks.push(blockData);
    ecBlocks.push(rsEncode(blockData, info.ec));
  }

  // Interleave
  const interleaved = [];
  const maxDc = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxDc; i++) {
    for (const block of blocks) {
      if (i < block.length) interleaved.push(block[i]);
    }
  }
  for (let i = 0; i < info.ec; i++) {
    for (const ec of ecBlocks) interleaved.push(ec[i]);
  }

  // Convert to bit array
  const bits = [];
  interleaved.forEach((byte) => {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  });

  // Build matrix
  const matrix = createMatrix(size);
  const reserved = createMatrix(size);

  placeFinderPattern(matrix, reserved, 0, 0);
  placeFinderPattern(matrix, reserved, 0, size - 7);
  placeFinderPattern(matrix, reserved, size - 7, 0);

  const alignPos = alignmentPositions(version);
  for (const r of alignPos) {
    for (const c of alignPos) {
      if (reserved[r]?.[c]) continue;
      placeAlignmentPattern(matrix, reserved, r, c);
    }
  }

  placeTimingPatterns(matrix, reserved);
  reserveFormatArea(matrix, reserved);
  placeVersionInfo(matrix, reserved, version);

  // Try all masks, pick lowest penalty
  let bestMask = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const test = matrix.map((row) => new Uint8Array(row));
    placeData(test, reserved, bits);
    applyMask(test, reserved, m);
    placeFormatInfo(test, ecl, m);
    const s = penalty(test);
    if (s < bestScore) {
      bestScore = s;
      bestMask = m;
    }
  }

  placeData(matrix, reserved, bits);
  applyMask(matrix, reserved, bestMask);
  placeFormatInfo(matrix, ecl, bestMask);

  return matrix;
}

// ── SVG renderer ──

// The modules are drawn flush: the viewBox is the symbol itself, so the ink
// meets the SVG's content box. The quiet zone is CSS padding on the SVG,
// --qr-quiet modules wide (4 by default, as ISO/IEC 18004 asks), worked out
// from the module count the SVG carries as --qr-modules. Layout can align the
// ink edge, or set --qr-quiet: 0 where the page already leaves the space.
function matrixToSVG(matrix) {
  const size = matrix.length;

  let paths = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        paths += `M${c},${r}h1v1h-1z`;
      }
    }
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("data-part", "svg");
  svg.style.setProperty("--qr-modules", String(size));

  // Background
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", size);
  bg.setAttribute("height", size);
  bg.setAttribute("fill", "var(--color-bg, #fff)");
  svg.appendChild(bg);

  // QR modules
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths);
  path.setAttribute("fill", "var(--color-fg, #000)");
  svg.appendChild(path);

  return svg;
}

// ── Controller ──

function createQRCode(root) {
  if (root._faqirQR) return root._faqirQR;

  function render() {
    const value = root.getAttribute("data-value") || "";
    const ecl = root.getAttribute("data-ecl") || "M";

    // Remove old SVG
    const old = root.querySelector("[data-part='svg']");
    if (old) old.remove();

    if (!value) {
      root.dataset.state = "empty";
      return;
    }

    try {
      const matrix = encodeQR(value, ecl);
      const svg = matrixToSVG(matrix);
      // Insert before caption if present
      const caption = root.querySelector("[data-part='caption']");
      if (caption) {
        root.insertBefore(svg, caption);
      } else {
        root.appendChild(svg);
      }
      root.dataset.state = "ready";
    } catch (e) {
      // An empty box is no answer: say so in the markup, and to the page.
      root.dataset.state = "error";
      root.dispatchEvent(
        new CustomEvent("faqir:error", { bubbles: true, detail: { message: e.message, value, ecl } }),
      );
      console.warn(`[qr-code] Failed to encode: ${e.message}`);
    }
  }

  function update(newValue, newEcl) {
    if (newValue !== undefined) root.setAttribute("data-value", newValue);
    if (newEcl !== undefined) root.setAttribute("data-ecl", newEcl);
    render();
  }

  // Observe attribute changes
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === "data-value" || m.attributeName === "data-ecl") {
        render();
        break;
      }
    }
  });
  observer.observe(root, { attributes: true });

  function destroy() {
    observer.disconnect();
    const svg = root.querySelector("[data-part='svg']");
    if (svg) svg.remove();
    if (["empty", "ready", "error"].includes(root.dataset.state)) delete root.dataset.state;
    delete root._faqirQR;
  }

  // Initial render
  render();

  const api = { render, update, destroy };
  root._faqirQR = api;
  return api;
}
    return createQRCode;
  })();

  // ── select-custom ── (registry/recipes/select-custom/select-custom.js)
  var createSelectCustom = controllerRegistry["select-custom"] = (function() {
// @ui:controller select-custom
// @ui:provides open close toggle select getValue destroy

function createSelectCustom(root) {
  // Prevent double-init
  if (root._faqirSelectCustom) return root._faqirSelectCustom;

  const trigger = root.querySelector("[data-part='trigger']");
  const valueEl = root.querySelector("[data-part='value']");
  const listbox = root.querySelector("[data-part='listbox']");
  const searchInput = root.querySelector("[data-part='search']");
  const emptyEl = root.querySelector("[data-part='empty']");
  const options = () =>
    [...root.querySelectorAll("[data-part='option']")];

  let highlightedIndex = -1;
  let outsideClickCleanup = null;
  let selectedValue = "";
  const placeholderText = valueEl?.textContent || "";

  /**
   * `aria-activedescendant` — the half of the combobox pattern that was declared
   * and never implemented.  [W3-4]
   *
   * The trigger publishes `role="combobox"`, which is the APG contract: as the
   * user arrows through the listbox, the combobox must name the active option so
   * a screen reader announces it. Highlighting lived in `data-highlighted`
   * alone and the options carried no `id`, so there was nothing to point at and
   * nothing was ever announced. The axe gate structurally cannot see this — it
   * evaluates static DOM, and the defect exists only mid-navigation.
   *
   * The owner is whichever element holds the combobox role: the search field
   * when the listbox has one (that is where focus is), otherwise the trigger.
   */
  const activeOwner = () => searchInput || trigger;

  function optionId(opt) {
    if (!opt.id) opt.id = uid("faqir-option");
    return opt.id;
  }

  function setActiveDescendant(opt) {
    const owner = activeOwner();
    if (!owner) return;
    if (opt) owner.setAttribute("aria-activedescendant", optionId(opt));
    else owner.removeAttribute("aria-activedescendant");
  }

  /**
   * The hidden input that makes this a form control.  [W3-4 · 0.4-28]
   *
   * `select-custom` is sold as a replacement for `<select>`, and a `<select>`
   * submits. This one rendered a `<div>` listbox and kept its value in a
   * closure, so a form containing it POSTed without the field at all — silently,
   * because a missing field looks exactly like an empty one on the server. The
   * input is created only when the markup does not already carry one, and only
   * when the component names itself, so nothing is invented for a component with
   * no name to submit under.
   */
  function ensureValueInput() {
    let el = root.querySelector("[data-part='input']");
    if (el) return el;
    const name = root.dataset.name || root.getAttribute("name");
    if (!name) return null;
    el = document.createElement("input");
    el.type = "hidden";
    el.setAttribute("data-part", "input");
    el.name = name;
    root.appendChild(el);
    return el;
  }

  const valueInput = ensureValueInput();

  function open() {
    root.dataset.state = "open";
    listbox.hidden = false;
    trigger.setAttribute("aria-expanded", "true");

    // Reset search if present
    if (searchInput) {
      searchInput.value = "";
      filterOptions("");
      searchInput.focus();
    }

    clearHighlight();
    outsideClickCleanup = onOutsideClick(root, close);
  }

  /**
   * Everything `close()` does EXCEPT moving focus.
   *
   * `destroy()` used to leave an open overlay standing with nothing listening —
   * a dead widget the user cannot dismiss. Closing it on teardown is the fix
   * (`context-menu` is the model), but teardown must not also yank focus
   * somewhere: on an SPA route change the element it would restore to is
   * usually on its way out of the document. [W3-2]
   */
  function dismiss() {
    root.dataset.state = "closed";
    listbox.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    clearHighlight();

    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  function close() {
    dismiss();
    trigger.focus();
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  function clearHighlight() {
    options().forEach((opt) => {
      opt.removeAttribute("data-highlighted");
    });
    setActiveDescendant(null);
    highlightedIndex = -1;
  }

  function visibleOptions() {
    return options().filter((opt) => !opt.hasAttribute("data-hidden"));
  }

  function highlightOption(index) {
    const visible = visibleOptions();
    if (visible.length === 0) return;

    // Clamp index
    if (index < 0) index = visible.length - 1;
    if (index >= visible.length) index = 0;

    // Clear previous
    options().forEach((opt) => opt.removeAttribute("data-highlighted"));

    visible[index].setAttribute("data-highlighted", "");
    visible[index].scrollIntoView({ block: "nearest" });
    setActiveDescendant(visible[index]);
    highlightedIndex = index;
  }

  function filterOptions(query) {
    const allOptions = options();
    const lowerQuery = query.toLowerCase();
    let visibleCount = 0;

    allOptions.forEach((opt) => {
      const text = opt.textContent.toLowerCase();
      if (text.includes(lowerQuery)) {
        opt.removeAttribute("data-hidden");
        visibleCount++;
      } else {
        opt.setAttribute("data-hidden", "");
      }
    });

    // Show/hide empty state
    if (emptyEl) {
      emptyEl.hidden = visibleCount > 0;
    }

    clearHighlight();
    return visibleCount;
  }

  function select(value) {
    const allOptions = options();
    let targetOption = null;

    // Find option by data-value attribute
    allOptions.forEach((opt) => {
      if (opt.dataset.value === value) {
        targetOption = opt;
      }
    });

    if (!targetOption) {
      // Fallback: find by text content
      allOptions.forEach((opt) => {
        if (opt.textContent.trim() === value) {
          targetOption = opt;
        }
      });
    }

    if (!targetOption) return;

    // Deselect all
    allOptions.forEach((opt) => opt.setAttribute("aria-selected", "false"));

    // Select target
    targetOption.setAttribute("aria-selected", "true");
    selectedValue = targetOption.dataset.value || targetOption.textContent.trim();

    // Update displayed value
    if (valueEl) {
      valueEl.textContent = targetOption.textContent.trim();
      valueEl.removeAttribute("data-placeholder");
    }

    // …and the value a form actually submits. [W3-4 · 0.4-28]
    if (valueInput) valueInput.value = selectedValue;

    // Dispatch change event
    const event = new CustomEvent("select-change", {
      bubbles: true,
      detail: {
        value: selectedValue,
        label: targetOption.textContent.trim()
      }
    });
    root.dispatchEvent(event);

    close();
  }

  function getValue() {
    return selectedValue;
  }

  // ── Event Handlers ──

  function onTriggerClick() {
    toggle();
  }

  function onTriggerKeyDown(e) {
    switch (e.key) {
      case "ArrowDown":
      case "Enter":
      case " ":
        e.preventDefault();
        if (root.dataset.state !== "open") {
          open();
        }
        break;
      case "Escape":
        if (root.dataset.state === "open") {
          e.preventDefault();
          // Closing the listbox is the whole action — the form around it, and
          // everything the user has typed into it, stays. [W3-2]
          e.stopPropagation();
          close();
        }
        break;
    }
  }

  function onListboxKeyDown(e) {
    const visible = visibleOptions();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        highlightOption(highlightedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        highlightOption(highlightedIndex - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visible.length) {
          const opt = visible[highlightedIndex];
          select(opt.dataset.value || opt.textContent.trim());
        }
        break;
      case "Escape":
        e.preventDefault();
        // Reached only while the listbox is open, so this Escape is always ours.
        e.stopPropagation();
        close();
        break;
      case "Home":
        if (visible.length > 0) {
          e.preventDefault();
          highlightOption(0);
        }
        break;
      case "End":
        if (visible.length > 0) {
          e.preventDefault();
          highlightOption(visible.length - 1);
        }
        break;
    }
  }

  function onOptionClick(e) {
    const opt = e.target.closest("[data-part='option']");
    if (!opt) return;
    select(opt.dataset.value || opt.textContent.trim());
  }

  function onSearchInput() {
    if (searchInput) {
      filterOptions(searchInput.value);
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  trigger?.addEventListener("keydown", onTriggerKeyDown);
  listbox?.addEventListener("keydown", onListboxKeyDown);
  listbox?.addEventListener("click", onOptionClick);
  searchInput?.addEventListener("input", onSearchInput);

  function destroy() {
    dismiss();
    trigger?.removeEventListener("click", onTriggerClick);
    trigger?.removeEventListener("keydown", onTriggerKeyDown);
    listbox?.removeEventListener("keydown", onListboxKeyDown);
    listbox?.removeEventListener("click", onOptionClick);
    searchInput?.removeEventListener("input", onSearchInput);
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirSelectCustom;
  }

  const api = { open, close, toggle, select, getValue, destroy };
  root._faqirSelectCustom = api;
  return api;
}
    return createSelectCustom;
  })();

  // ── sheet ── (registry/recipes/sheet/sheet.js)
  var createSheet = controllerRegistry["sheet"] = (function() {
// @ui:controller sheet
// @ui:provides open close toggle destroy

function createSheet(root) {
  // Prevent double-init
  if (root._faqirSheet) return root._faqirSheet;

  // Overlay and panel are direct children; trigger and close buttons are
  // matched by owner, so a nested component's close leaves this one alone.
  const [trigger] = ownParts(root, "trigger");
  const overlay = root.querySelector(":scope > [data-part='overlay']");
  const panel = root.querySelector(":scope > [data-part='panel']");
  const closeButtons = ownParts(root, "close");

  // `panel.focus()` on open does nothing without a tabindex: focus stayed on
  // `body`, out of reach of the trap and the root's Escape listener.
  if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");

  let focusCleanup = null;
  let previouslyFocused = null;
  let prevBodyOverflow = null;

  // Scroll lock: an open modal sheet freezes the page behind it. The guard makes
  // lock/unlock idempotent so overlapping open/close sequences (or a double
  // open) can never leave the body stuck at `overflow: hidden`.
  function lockScroll() {
    if (prevBodyOverflow !== null) return;
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (prevBodyOverflow === null) return;
    document.body.style.overflow = prevBodyOverflow;
    prevBodyOverflow = null;
  }

  // Cancels an in-flight "closing" wait when the sheet is re-opened mid-slide.
  let cancelExitWait = null;

  function open() {
    cancelExitWait?.();
    cancelExitWait = null;
    previouslyFocused = document.activeElement;
    root.dataset.state = "open";
    overlay.hidden = false;
    panel.hidden = false;
    lockScroll();
    focusCleanup = trapFocus(panel);
    panel.focus?.();
  }

  function close() {
    // Already gone, or already sliding out — a second click must not start a
    // second wait on top of the one in flight.
    if (root.dataset.state === "closed" || root.dataset.state === "closing") return;

    root.dataset.state = "closing";

    const onEnd = () => {
      cancelExitWait = null;
      const active = document.activeElement;
      root.dataset.state = "closed";
      overlay.hidden = true;
      panel.hidden = true;
      unlockScroll();
      if (focusCleanup) focusCleanup();
      focusCleanup = null;
      returnFocus(root, previouslyFocused, active);
    };

    // The panel's OWN `transform` — not a close button's `background`, which
    // bubbles up to the panel the moment the pointer touches it and used to eat
    // the one-shot listener, stranding the sheet at "closing" with the overlay
    // still covering the page. See `whenExitDone`. [W2-1]
    cancelExitWait = whenExitDone(panel, "transform", onEnd);
  }

  /**
   * Tear the overlay down NOW — no exit animation, no focus restore.
   *
   * `destroy()` unbound every listener and left the panel and its backdrop
   * exactly where they were: a full-page block whose close button, Escape key
   * and overlay click had all just stopped working, with no way out. An SPA
   * route change destroys controllers and does precisely this. The model is
   * `context-menu`, which has always closed itself on teardown. [W3-2]
   */
  function dismiss() {
    cancelExitWait?.();
    cancelExitWait = null;
    root.dataset.state = "closed";
    if (overlay) overlay.hidden = true;
    if (panel) panel.hidden = true;
    unlockScroll();
    if (focusCleanup) focusCleanup();
    focusCleanup = null;
  }

  function toggle() {
    root.dataset.state === "open" ? close() : open();
  }

  // Event listeners
  function onTriggerClick() {
    open();
  }

  function onOverlayClick() {
    close();
  }

  function onCloseClick() {
    close();
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "open") {
      e.stopPropagation();
      close();
    }
  }

  trigger?.addEventListener("click", onTriggerClick);
  overlay?.addEventListener("click", onOverlayClick);
  closeButtons.forEach((btn) => btn.addEventListener("click", onCloseClick));
  root.addEventListener("keydown", onKeyDown);

  function destroy() {
    trigger?.removeEventListener("click", onTriggerClick);
    overlay?.removeEventListener("click", onOverlayClick);
    closeButtons.forEach((btn) =>
      btn.removeEventListener("click", onCloseClick)
    );
    root.removeEventListener("keydown", onKeyDown);
    dismiss();
    delete root._faqirSheet;
  }

  const api = { open, close, toggle, destroy };
  root._faqirSheet = api;
  return api;
}
    return createSheet;
  })();

  // ── sidebar ── (registry/recipes/sidebar/sidebar.js)
  var createSidebar = controllerRegistry["sidebar"] = (function() {
// @ui:controller sidebar
// @ui:provides toggle expand collapse open close isMobile getState destroy

/**
 * sidebar — a collapsible application sidebar with three modes:
 *
 *   • expanded — desktop, full-width with labels (default)
 *   • rail     — desktop, icons-only
 *   • drawer   — mobile, an off-canvas overlay panel (closed ↔ open)
 *
 * The single source of truth is `data-state` on the root; its value is one of
 * `expanded`, `rail`, `drawer` (mobile, closed) or `drawer-open` (mobile, open).
 * Agents can set the initial state declaratively — the controller reconciles it
 * with the current breakpoint on init.
 *
 * A `matchMedia` query (default `(max-width: 768px)`, overridable with
 * `data-breakpoint`) decides desktop vs mobile. `toggle()` is breakpoint-aware:
 * expanded ↔ rail on desktop, open ↔ close on mobile. The desktop preference
 * (expanded/rail) persists across a trip through the mobile breakpoint, so
 * resizing back to desktop restores what the user last chose.
 *
 * The mobile drawer is a proper modal surface: focus is trapped in the panel,
 * Escape and an overlay click close it, body scroll is locked while open, and
 * focus returns to whatever opened it. When the drawer is closed on mobile the
 * panel is `inert` + `aria-hidden`, so its links never sit in the tab order
 * off-screen. Every toggle button's `aria-expanded` tracks the live state.
 */
function createSidebar(root) {
  // Prevent double-init.
  if (root._faqirSidebar) return root._faqirSidebar;

  const overlay = root.querySelector(":scope > [data-part='overlay']");
  const panel = root.querySelector(":scope > [data-part='panel']") || root;

  // Toggle buttons: the sidebar's own `[data-part='trigger']`s, plus external
  // triggers in the app shell that point at this sidebar by id. Both call
  // toggle(). A dropdown's trigger in the footer belongs to the dropdown: it
  // used to have its aria-expanded forced and its click rail the sidebar.
  const internalTriggers = ownParts(root, "trigger");
  const externalTriggers = root.id
    ? [...document.querySelectorAll(`[data-sidebar-toggle="${root.id}"]`)]
    : [];
  const triggers = [...internalTriggers, ...externalTriggers];

  // Persistent desktop preference (expanded ↔ rail) and mobile open flag, both
  // seeded from the declared data-state so the initial render is intent-preserving.
  const declared = root.dataset.state || "expanded";
  let desktopState = declared === "rail" ? "rail" : "expanded";
  let drawerOpen = declared === "drawer-open";

  // Responsive breakpoint. `data-breakpoint` is a max-width in px (default 768).
  const bp = (() => {
    const n = parseInt(root.dataset.breakpoint || "", 10);
    return Number.isFinite(n) && n > 0 ? n : 768;
  })();
  const query = `(max-width: ${bp}px)`;
  const mql =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query)
      : null;

  function isMobile() {
    return mql ? !!mql.matches : false;
  }

  // Modal bookkeeping for the mobile drawer.
  let focusCleanup = null;
  let previouslyFocused = null;
  let prevBodyOverflow = null;

  function lockScroll() {
    if (prevBodyOverflow !== null) return;
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (prevBodyOverflow === null) return;
    document.body.style.overflow = prevBodyOverflow;
    prevBodyOverflow = null;
  }
  function releaseFocusTrap() {
    if (focusCleanup) focusCleanup();
    focusCleanup = null;
  }

  function getState() {
    return root.dataset.state || "";
  }

  /**
   * Reconcile every reflected attribute with the current model + breakpoint.
   * Pure DOM writes — never dispatches an event, so it is safe to call on init.
   */
  function render() {
    const mobile = isMobile();
    const state = mobile ? (drawerOpen ? "drawer-open" : "drawer") : desktopState;
    root.dataset.state = state;

    // Overlay only exists as a hit-target when the drawer is open.
    if (overlay) overlay.hidden = state !== "drawer-open";

    // Closed mobile drawer: keep the off-screen panel out of the tab order and
    // the a11y tree. Any other state is a live, interactive surface.
    if (panel && panel !== root) {
      if (state === "drawer") {
        panel.setAttribute("inert", "");
        panel.setAttribute("aria-hidden", "true");
      } else {
        panel.removeAttribute("inert");
        panel.removeAttribute("aria-hidden");
      }
    }

    // aria-expanded reflects "is the sidebar showing its content?": labels on
    // desktop, an open drawer on mobile.
    const expanded = mobile ? drawerOpen : desktopState === "expanded";
    for (const t of triggers) t.setAttribute("aria-expanded", String(expanded));
  }

  // ── Mobile drawer open/close ───────────────────────────────────────────────
  function open() {
    if (drawerOpen) return;
    previouslyFocused = document.activeElement;
    drawerOpen = true;
    render();
    lockScroll();
    focusCleanup = trapFocus(panel);
    if (!focusFirst(panel)) panel.focus?.();
  }

  function close() {
    if (!drawerOpen) return;
    drawerOpen = false;
    render();
    unlockScroll();
    releaseFocusTrap();
    previouslyFocused?.focus?.();
    previouslyFocused = null;
  }

  // ── Desktop expand/collapse ────────────────────────────────────────────────
  function expand() {
    desktopState = "expanded";
    render();
  }
  function collapse() {
    desktopState = "rail";
    render();
  }

  // ── Breakpoint-aware toggle ────────────────────────────────────────────────
  function toggle() {
    if (isMobile()) {
      drawerOpen ? close() : open();
    } else {
      desktopState === "expanded" ? collapse() : expand();
    }
  }

  // When the viewport crosses the breakpoint, tear down any live drawer modality
  // (a drawer left open as the window widens must not keep the scroll lock or the
  // focus trap) and re-render into the mode the new breakpoint calls for.
  function onMediaChange() {
    if (!isMobile() && drawerOpen) {
      drawerOpen = false;
      unlockScroll();
      releaseFocusTrap();
      previouslyFocused = null;
    }
    render();
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && isMobile() && drawerOpen) {
      e.stopPropagation();
      close();
    }
  }

  function onTriggerClick(e) {
    e.preventDefault();
    toggle();
  }

  function onOverlayClick() {
    close();
  }

  for (const t of triggers) t.addEventListener("click", onTriggerClick);
  overlay?.addEventListener("click", onOverlayClick);
  root.addEventListener("keydown", onKeyDown);
  if (mql) {
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", onMediaChange);
    else if (typeof mql.addListener === "function") mql.addListener(onMediaChange);
  }

  // Paint the reconciled initial state (no event).
  render();

  function destroy() {
    // A destroyed sidebar left mid-drawer is a dead overlay: the scrim still
    // covers the page, and its trigger, Escape and overlay click have all just
    // stopped working. Collapse the drawer first, without restoring focus —
    // teardown must not yank focus to an element on its way out. [W3-2]
    if (drawerOpen) {
      drawerOpen = false;
      render();
    }
    previouslyFocused = null;
    for (const t of triggers) t.removeEventListener("click", onTriggerClick);
    overlay?.removeEventListener("click", onOverlayClick);
    root.removeEventListener("keydown", onKeyDown);
    if (mql) {
      if (typeof mql.removeEventListener === "function") mql.removeEventListener("change", onMediaChange);
      else if (typeof mql.removeListener === "function") mql.removeListener(onMediaChange);
    }
    unlockScroll();
    releaseFocusTrap();
    delete root._faqirSidebar;
  }

  const api = { toggle, expand, collapse, open, close, isMobile, getState, destroy };
  root._faqirSidebar = api;
  return api;
}
    return createSidebar;
  })();

  // ── slider ── (registry/recipes/slider/slider.js)
  var createSlider = controllerRegistry["slider"] = (function() {
// @ui:controller slider
// @ui:provides setValue getValue getValues setFormatter destroy

/**
 * slider — single-thumb and range (two-thumb) slider.
 *
 * Modes are inferred from the DOM, never from a flag: two-or-more
 * `[data-part="thumb"]` elements ⇒ range mode. Each thumb is an independent
 * `role="slider"` widget with its own keyboard handling and ARIA value state.
 *
 * The controller owns only runtime state: it writes `aria-valuemin/max/now`
 * (and `aria-valuetext`, via a formatter hook), positions thumbs through the
 * `--pos` custom property, reflects the filled span through `--slider-start` /
 * `--slider-end` on the root, and toggles `data-state="dragging"` on the active
 * thumb. All value arithmetic lives in the pure, exported helpers below
 * (`valueFromPointer`, `snapToStep`, `percentOf`) so it is unit-testable without
 * a DOM.
 */
function createSlider(root) {
  // Prevent double-init.
  if (root._faqirSlider) return root._faqirSlider;

  const track = root.querySelector("[data-part='track']");
  const thumbs = [...root.querySelectorAll("[data-part='thumb']")];
  const isRange = thumbs.length >= 2;
  const last = thumbs.length - 1;

  const min = numAttr(root, "min", 0);
  const max = numAttr(root, "max", 100);
  const step = (() => {
    const s = numAttr(root, "step", 1);
    return s > 0 ? s : 1;
  })();
  // PageUp/PageDown jump: an explicit data-page-step, else ten normal steps.
  const bigStep = (() => {
    const p = numAttr(root, "pageStep", NaN);
    return Number.isFinite(p) && p > 0 ? p : step * 10;
  })();

  // aria-valuetext hook: a formatter set via setFormatter() wins; otherwise a
  // declarative `data-value-suffix` (e.g. "%") produces "<value><suffix>".
  let formatter = null;
  const suffix = root.dataset.valueSuffix || "";

  // Ensure every thumb is a proper, focusable slider even if the author omitted
  // the role/tabindex — screen-reader-correct ARIA must not depend on hand markup.
  thumbs.forEach((thumb) => {
    if (!thumb.hasAttribute("role")) thumb.setAttribute("role", "slider");
    if (!thumb.hasAttribute("tabindex")) {
      thumb.setAttribute("tabindex", isDisabled() ? "-1" : "0");
    }
  });

  // Seed values: prefer an existing aria-valuenow, then the i-th data-value
  // token, then a sensible default (first thumb → min, last → max).
  const dataVals = (root.dataset.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number);

  let values = thumbs.map((thumb, i) => {
    const now = thumb.getAttribute("aria-valuenow");
    if (now !== null && now !== "" && Number.isFinite(Number(now))) return Number(now);
    if (i < dataVals.length && Number.isFinite(dataVals[i])) return dataVals[i];
    return i === 0 ? min : max;
  });
  // Normalize in order so range clamping sees already-normalized lower neighbours.
  thumbs.forEach((_, i) => {
    values[i] = clampForThumb(i, snapToStep(values[i], min, max, step));
  });

  function isDisabled() {
    return root.hasAttribute("data-disabled");
  }

  // Clamp a candidate value to the global bounds and, in range mode, to the
  // adjacent thumbs — this is what stops the two thumbs from crossing.
  function clampForThumb(index, value) {
    let lo = min;
    let hi = max;
    if (isRange) {
      if (index > 0) lo = values[index - 1];
      if (index < last) hi = values[index + 1];
    }
    return Math.min(Math.max(value, lo), hi);
  }

  function boundsFor(index) {
    const lo = isRange && index > 0 ? values[index - 1] : min;
    const hi = isRange && index < last ? values[index + 1] : max;
    return { lo, hi };
  }

  function textFor(value, index) {
    if (typeof formatter === "function") return formatter(value, index);
    if (suffix) return `${value}${suffix}`;
    return null;
  }

  function renderThumb(index) {
    const thumb = thumbs[index];
    const value = values[index];
    const { lo, hi } = boundsFor(index);
    thumb.setAttribute("aria-valuemin", String(lo));
    thumb.setAttribute("aria-valuemax", String(hi));
    thumb.setAttribute("aria-valuenow", String(value));
    const text = textFor(value, index);
    if (text != null) thumb.setAttribute("aria-valuetext", text);
    else thumb.removeAttribute("aria-valuetext");
    thumb.style.setProperty("--pos", `${percentOf(value, min, max)}%`);
  }

  function renderRange() {
    const startPct = isRange ? percentOf(values[0], min, max) : 0;
    const endPct = percentOf(values[isRange ? last : 0], min, max);
    root.style.setProperty("--slider-start", `${startPct}%`);
    root.style.setProperty("--slider-end", `${endPct}%`);
  }

  function render() {
    thumbs.forEach((_, i) => renderThumb(i));
    renderRange();
  }

  function emitChange(index) {
    root.dispatchEvent(
      new CustomEvent("faqir:change", {
        bubbles: true,
        detail: { index, value: values[index], values: values.slice() },
      }),
    );
  }

  // The single mutation seam: snap → clamp (non-crossing) → render → notify.
  function applyValue(index, rawValue, opts) {
    if (index < 0 || index >= thumbs.length) return;
    const next = clampForThumb(index, snapToStep(rawValue, min, max, step));
    const changed = next !== values[index];
    values[index] = next;
    render();
    if (changed && !(opts && opts.silent)) emitChange(index);
  }

  function nearestThumb(value) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < values.length; i++) {
      const d = Math.abs(values[i] - value);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // ── RTL ──────────────────────────────────────────────────────────────────
  // getComputedStyle is authoritative in a browser; fall back to the dir
  // attribute for detached nodes / happy-dom where computed direction is unset.
  function isRTL() {
    if (root.closest('[dir="rtl"]')) return true;
    if (typeof getComputedStyle === "function") {
      try {
        return getComputedStyle(root).direction === "rtl";
      } catch {
        /* jsdom/happy-dom on a detached node — ignore */
      }
    }
    return false;
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (isDisabled()) return;
    const thumb = e.target.closest("[data-part='thumb']");
    if (!thumb || !root.contains(thumb)) return;
    const index = thumbs.indexOf(thumb);
    if (index < 0) return;

    const rtl = isRTL();
    const cur = values[index];
    let next;
    switch (e.key) {
      case "ArrowUp":
        next = cur + step;
        break;
      case "ArrowDown":
        next = cur - step;
        break;
      case "ArrowRight":
        next = cur + (rtl ? -step : step);
        break;
      case "ArrowLeft":
        next = cur + (rtl ? step : -step);
        break;
      case "PageUp":
        next = cur + bigStep;
        break;
      case "PageDown":
        next = cur - bigStep;
        break;
      case "Home":
        next = min; // clampForThumb pins it to the lower neighbour in range mode
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    applyValue(index, next);
  }

  // ── Pointer dragging ─────────────────────────────────────────────────────
  let drag = null; // { index }
  const docHandlers = [];

  function beginDrag(index) {
    drag = { index };
    thumbs[index].dataset.state = "dragging";
    const move = (ev) => onDragMove(ev);
    const end = () => endDrag();
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    docHandlers.push(["pointermove", move], ["pointerup", end], ["pointercancel", end]);
  }

  function onDragMove(ev) {
    if (!drag || !track) return;
    const value = valueFromPointer(ev.clientX, track.getBoundingClientRect(), {
      min,
      max,
      step,
      rtl: isRTL(),
    });
    applyValue(drag.index, value);
  }

  function endDrag() {
    if (!drag) return;
    thumbs[drag.index].removeAttribute("data-state");
    for (const [type, fn] of docHandlers) document.removeEventListener(type, fn);
    docHandlers.length = 0;
    drag = null;
  }

  function onPointerDown(e) {
    if (isDisabled()) return;
    if (typeof e.button === "number" && e.button !== 0) return; // primary button only

    const thumb = e.target.closest("[data-part='thumb']");
    if (thumb && root.contains(thumb)) {
      e.preventDefault();
      const index = thumbs.indexOf(thumb);
      thumb.focus();
      beginDrag(index);
      return;
    }

    // A press anywhere on the track jumps the nearest thumb to that point and
    // starts dragging it — the standard "click-to-set" affordance.
    if (track && (e.target === track || track.contains(e.target))) {
      e.preventDefault();
      const value = valueFromPointer(e.clientX, track.getBoundingClientRect(), {
        min,
        max,
        step,
        rtl: isRTL(),
      });
      const index = nearestThumb(value);
      applyValue(index, value);
      if (thumbs[index]) thumbs[index].focus();
      beginDrag(index);
    }
  }

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointerdown", onPointerDown);

  // Paint initial positions/ARIA without firing a spurious change event.
  render();

  // ── Public API ───────────────────────────────────────────────────────────
  function setValue(index, value) {
    applyValue(index, value);
  }
  function getValue() {
    return isRange ? values.slice() : values[0];
  }
  function getValues() {
    return values.slice();
  }
  function setFormatter(fn) {
    formatter = typeof fn === "function" ? fn : null;
    render();
  }

  function destroy() {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("pointerdown", onPointerDown);
    endDrag();
    delete root._faqirSlider;
  }

  const api = { setValue, getValue, getValues, setFormatter, destroy };
  root._faqirSlider = api;
  return api;
}

// ── Pure value math (no DOM) — unit-tested in isolation ──────────────────────

/** Decimal places implied by a step (so 0.1 + 0.2 doesn't leak float dust). */
function stepDecimals(step) {
  const str = String(step);
  const dot = str.indexOf(".");
  return dot === -1 ? 0 : str.length - dot - 1;
}

/**
 * Snap a raw value onto the nearest step from `min`, clamped to `[min, max]`.
 * @returns {number}
 */
function snapToStep(value, min, max, step) {
  const s = step > 0 ? step : 1;
  const steps = Math.round((value - min) / s);
  const snapped = Math.min(Math.max(min + steps * s, min), max);
  return Number(snapped.toFixed(stepDecimals(s)));
}

/** Value → percent along the track (0–100), clamped. */
function percentOf(value, min, max) {
  if (max === min) return 0;
  const p = ((value - min) / (max - min)) * 100;
  return Math.min(Math.max(p, 0), 100);
}

/**
 * Map a pointer x-coordinate to a slider value. Pure: no DOM access — the caller
 * supplies the track rect. Handles RTL by inverting the fraction, so the same
 * arithmetic serves both writing directions.
 *
 * @param {number} clientX pointer x in client coordinates
 * @param {{left:number, width:number}} rect track bounding rect
 * @param {{min:number, max:number, step:number, rtl?:boolean}} opts
 * @returns {number} snapped, clamped value
 */
function valueFromPointer(clientX, rect, opts) {
  const { min, max, step } = opts;
  const width = rect.width;
  if (!(width > 0)) return min;
  let fraction = (clientX - rect.left) / width;
  fraction = Math.min(Math.max(fraction, 0), 1);
  if (opts.rtl) fraction = 1 - fraction;
  return snapToStep(min + fraction * (max - min), min, max, step);
}

// Read a numeric data-* attribute (dataset key), falling back when absent/NaN.
function numAttr(el, key, fallback) {
  const raw = el.dataset[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
    return createSlider;
  })();

  // ── table ── (registry/recipes/table/table.js)
  var createTable = controllerRegistry["table"] = (function() {
// @ui:controller table
// @ui:provides sort sortBy clearSort selectRow selectAll deselectAll getSelected getSelectedData setFilter setColumnFilter clearFilters toggleGroup toggleRow toggleDetail expandAll collapseAll startEdit commitEdit cancelEdit moveRow moveColumn hideColumn showColumn toggleColumn setColumnWidth exportCsv getData getState setState refresh destroy

/**
 * Advanced data table controller.
 *
 * Everything beyond the base contract (sort / select) is opt-in through data
 * attributes on the root, so a plain table pays for nothing:
 *
 *   data-multi-sort          shift+click accumulates secondary sorts
 *   data-sort-cycle="tristate"  third header click restores original order
 *   data-selectable[="single|multi"]  row click (de)selects; default multi
 *   data-editable            inline cell editing (dblclick / Enter / F2)
 *   data-tree                tree table driven by tr[data-level] depths
 *   data-groupable           group-header rows collapse/expand their section
 *   data-reorderable         drag rows via [data-part="drag-handle"] (+ arrows)
 *   data-col-reorderable     drag column headers to rearrange columns
 *   data-resizable           column resize handles on headers
 *   data-sticky-header / data-sticky-footer   sticky thead/tfoot in a scroll root
 *   data-navigable           roving-focus grid keyboard navigation (implied by data-editable)
 *   data-responsive="stack"  stacked card layout under the container breakpoint
 *   data-persist="key"       persist sort/filter/width/visibility to localStorage
 *   data-locale / data-currency / data-negatives="red|parens|both"  Intl formatting
 *
 * Column headers (th) may carry: data-sortable, data-type, data-format,
 * data-align, data-editable, data-readonly, data-pin="start|end",
 * data-hide-below="sm|md|lg", data-key, data-min-width, data-max-width.
 * Cells (td) may carry: data-value (raw), data-sort-value, data-format,
 * data-align, data-editable, data-readonly, data-aggregate="sum|avg|min|max|count",
 * data-col (explicit column for aggregate cells with colspan).
 *
 * Runtime state the controller manages: data-selected, data-collapsed,
 * data-filtered, data-editing, data-dragging, data-drop-target/-pos,
 * data-col-hidden, data-negative, data-stripe, data-resized, aria-sort,
 * aria-expanded, aria-level plus the --table-level / --table-pin-offset /
 * --table-thead-h
 * private custom properties.
 *
 * Events (CustomEvent, bubbling): faqir:sort, faqir:selection-change,
 * faqir:filter, faqir:edit-start, faqir:cell-edit, faqir:edit-cancel,
 * faqir:row-reorder, faqir:col-reorder, faqir:col-resize, faqir:group-toggle,
 * faqir:tree-toggle, faqir:row-expand, faqir:col-visibility.
 */
function createTable(root) {
  // Prevent double-init
  if (root._faqirTable) return root._faqirTable;

  // A table nested in a detail row keeps its own parts and events: `tbody`
  // contains it, so every deep lookup and delegated handler checks `mine`.
  const mine = (el) => el.closest("[data-ui='table']") === root;
  const table = root.querySelector("[data-part='table']");
  const thead = root.querySelector("[data-part='thead']");
  const tbody = root.querySelector("[data-part='tbody']");
  const tfoot = [...root.querySelectorAll("[data-part='tfoot']")].find(mine);
  const headerCheckbox = thead?.querySelector("[data-part='checkbox']");

  // ── Options (read once from the root's opt-in attributes) ──
  const opts = {
    multiSort: root.hasAttribute("data-multi-sort"),
    sortCycle: root.getAttribute("data-sort-cycle") || "toggle",
    editable: root.hasAttribute("data-editable"),
    tree: root.hasAttribute("data-tree"),
    groupable: root.hasAttribute("data-groupable"),
    reorderable: root.hasAttribute("data-reorderable"),
    colReorderable: root.hasAttribute("data-col-reorderable"),
    resizable: root.hasAttribute("data-resizable"),
    selectable: root.getAttribute("data-selectable"), // null | "" | "single" | "multi"
    navigable: root.hasAttribute("data-navigable") || root.hasAttribute("data-editable"),
    responsive: root.getAttribute("data-responsive") || "",
    persistKey: root.getAttribute("data-persist") || "",
    locale: root.getAttribute("data-locale") || document.documentElement.lang || undefined,
    currency: root.getAttribute("data-currency") || "USD",
    negatives: root.getAttribute("data-negatives") || "",
  };
  const accounting = opts.negatives === "parens" || opts.negatives === "both";
  const isRTL = (root.closest("[dir]")?.getAttribute("dir") || "").toLowerCase() === "rtl";

  // ── Internal state ──
  let sorts = []; // [{ index, dir: "ascending"|"descending" }]
  let hasSorted = false;
  let globalFilter = "";
  const columnFilters = new Map(); // colIndex -> string | (raw, cell, row) => boolean
  let lastSelectedIndex = -1;
  let editing = null; // { cell, row, input, oldText, oldValue, colIndex, type }
  let activeCell = null; // roving-tabindex focus target
  let drag = null; // active pointer drag (rows / columns / resize)
  let suppressClickUntil = 0;
  let muted = false; // silences emit() during setState/expandAll
  let observer = null;
  let observerPaused = 0;
  let refreshQueued = false;
  const timers = new Set();
  const cleanups = [];
  const colTypeCache = new Map();
  const originalIndex = new WeakMap();
  let originSeq = 0;

  const collator = new Intl.Collator(opts.locale, { numeric: true, sensitivity: "base" });

  // ── Tiny helpers ──
  const toggleAttr = (el, name, on) => (on ? el.setAttribute(name, "") : el.removeAttribute(name));
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const on = (target, ev, fn, o) => {
    target.addEventListener(ev, fn, o);
    cleanups.push(() => target.removeEventListener(ev, fn, o));
  };

  function emit(type, detail) {
    if (muted) return;
    root.dispatchEvent(new CustomEvent("faqir:" + type, { bubbles: true, detail }));
  }
  function mutedRun(fn) {
    const was = muted;
    muted = true;
    try {
      fn();
    } finally {
      muted = was;
    }
  }

  // ── Row / cell access ──
  const rowsIn = (section, part = "tr") =>
    section ? [...section.children].filter((r) => r.getAttribute("data-part") === part) : [];
  const bodyRows = () => rowsIn(tbody);
  const groupHeaders = () => rowsIn(tbody, "group-header");
  const cellsOf = (row) =>
    [...row.children].filter((c) => {
      const p = c.getAttribute("data-part");
      return p === "td" || p === "th";
    });
  const detailOf = (row) => {
    const n = row.nextElementSibling;
    return n && n.getAttribute("data-part") === "detail-row" ? n : null;
  };
  const isRowVisible = (r) =>
    !r.hasAttribute("data-collapsed") && !r.hasAttribute("data-filtered") && !r.hasAttribute("hidden");
  const visibleBodyRows = () => bodyRows().filter(isRowVisible);

  function headerRowEl() {
    const trs = rowsIn(thead).filter((r) =>
      cellsOf(r).some((c) => c.getAttribute("data-part") === "th")
    );
    return trs[trs.length - 1] || null; // leaf row of (possibly grouped) headers
  }
  const headerCells = () => (headerRowEl() ? cellsOf(headerRowEl()) : []);
  const columnCount = () => headerCells().length;
  const filterRowEl = () => (thead ? rowsIn(thead, "filter-row")[0] || null : null);
  const sortableHeaders = () => headerCells().filter((th) => th.hasAttribute("data-sortable"));

  function headerText(i) {
    const th = headerCells()[i];
    if (!th) return "";
    const clone = th.cloneNode(true);
    for (const junk of clone.querySelectorAll("[data-part='resize-handle'],[data-part='checkbox'],input,button")) {
      junk.remove();
    }
    return (clone.textContent || "").trim();
  }

  /** Every row that has one cell per column (skips colspan rows like group headers). */
  function fullWidthRows() {
    const n = columnCount();
    const out = [];
    const fr = filterRowEl();
    if (headerRowEl()) out.push(headerRowEl());
    if (fr) out.push(fr);
    for (const r of [...bodyRows(), ...rowsIn(tfoot)]) out.push(r);
    return out.filter((r) => cellsOf(r).length === n);
  }
  function forEachColumnCell(i, fn) {
    for (const row of fullWidthRows()) {
      const cell = cellsOf(row)[i];
      if (cell) fn(cell, row);
    }
  }

  // ── Value parsing ──
  const NBSP = /[\u00a0\u202f]/g;
  /** Numeric parse tolerant of currency symbols, thousands separators, and accounting parens. */
  function parseNumeric(str) {
    if (str == null) return NaN;
    let s = String(str).replace(NBSP, " ").trim();
    if (!s) return NaN;
    let negative = false;
    const paren = s.match(/^\((.*)\)$/);
    if (paren) {
      negative = true;
      s = paren[1];
    }
    s = s.replace(/[^0-9.,-]/g, "");
    if (!s) return NaN;
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      // Rightmost separator is the decimal mark; the other groups thousands.
      s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (lastComma >= 0) {
      const parts = s.split(",");
      s = parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2
        ? s.replace(",", ".") // "0,5" → decimal comma
        : s.replace(/,/g, ""); // "1,234,567" → thousands
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, ""); // "1.234.567" → dot-grouped thousands
    }
    const n = parseFloat(s);
    return isNaN(n) ? NaN : negative ? -n : n;
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;
  /** Timestamp for ISO dates and dd/mm/yyyy (or dd.mm.yyyy) strings; NaN otherwise. */
  function parseDateValue(str) {
    const s = String(str == null ? "" : str).trim();
    if (!s) return NaN;
    if (ISO_DATE.test(s)) {
      const t = Date.parse(s.length === 10 ? s + "T00:00:00Z" : s);
      return isNaN(t) ? NaN : t;
    }
    const m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return NaN;
  }

  const cellRaw = (cell) =>
    cell.hasAttribute("data-value")
      ? cell.getAttribute("data-value")
      : (cell.textContent || "").trim();
  const sortRaw = (cell) =>
    cell.hasAttribute("data-sort-value") ? cell.getAttribute("data-sort-value") : cellRaw(cell);

  const NUMERIC_TYPES = { number: 1, currency: 1, percent: 1 };
  const isNumericType = (t) => !!NUMERIC_TYPES[t];

  /** Column type: explicit th data-type / data-format, else sniffed from cells. */
  function columnType(i) {
    if (colTypeCache.has(i)) return colTypeCache.get(i);
    let type = "";
    const th = headerCells()[i];
    type = th?.getAttribute("data-type") || th?.getAttribute("data-format") || "";
    if (!type) {
      let sawAny = false;
      let allNum = true;
      let allDate = true;
      for (const row of bodyRows().slice(0, 25)) {
        const cell = cellsOf(row)[i];
        if (!cell) continue;
        const cf = cell.getAttribute("data-format");
        if (cf) {
          type = cf;
          break;
        }
        const raw = sortRaw(cell);
        if (!raw) continue;
        sawAny = true;
        if (isNaN(parseDateValue(raw))) allDate = false;
        if (isNaN(parseNumeric(raw))) allNum = false;
        if (!allNum && !allDate) break;
      }
      if (!type) type = sawAny && allDate ? "date" : sawAny && allNum ? "number" : "text";
    }
    colTypeCache.set(i, type);
    return type;
  }

  // ── Intl formatting ──
  function formatValue(n, fmt) {
    const o =
      fmt === "currency"
        ? { style: fmt, currency: opts.currency, currencySign: accounting ? "accounting" : "standard" }
        : fmt === "percent"
          ? { style: fmt, maximumFractionDigits: 2 }
          : fmt === "number" && { maximumFractionDigits: 2 };
    try {
      if (o) return new Intl.NumberFormat(opts.locale, o).format(fmt === "percent" ? n / 100 : n);
    } catch {
      /* unknown locale/currency — fall through to raw */
    }
    return String(n);
  }

  function applyNegativeFlag(cell) {
    const fmt = cell.getAttribute("data-format");
    if (!fmt || !isNumericType(fmt)) return;
    const n = parseNumeric(cellRaw(cell));
    toggleAttr(cell, "data-negative", !isNaN(n) && n < 0);
  }

  /** Cells carrying both data-value and data-format render through Intl; text-only cells are never rewritten. */
  function formatCell(cell) {
    if (cell.hasAttribute("data-editing")) return;
    const fmt = cell.getAttribute("data-format");
    if (!fmt) return;
    if (cell.hasAttribute("data-value")) {
      const raw = cell.getAttribute("data-value");
      if (fmt === "date") {
        const t = parseDateValue(raw);
        if (!isNaN(t)) cell.textContent = new Date(t).toLocaleDateString(opts.locale);
      } else if (isNumericType(fmt)) {
        const n = parseNumeric(raw);
        if (!isNaN(n)) cell.textContent = formatValue(n, fmt);
      }
    }
    applyNegativeFlag(cell);
  }

  function applyFormats() {
    for (const row of [...bodyRows(), ...rowsIn(tfoot)]) {
      for (const cell of cellsOf(row)) formatCell(cell);
    }
  }

  // ── Tree helpers ──
  const levelOf = (r) => {
    const v = parseInt(r.getAttribute("data-level") || "0", 10);
    return isNaN(v) ? 0 : v;
  };
  /** Descendant data rows of a tree row (detail rows excluded; group headers terminate). */
  function subtreeRows(row) {
    const out = [];
    const lvl = levelOf(row);
    let n = row.nextElementSibling;
    while (n) {
      const p = n.getAttribute("data-part");
      if (p === "group-header") break;
      if (p === "tr") {
        if (levelOf(n) <= lvl) break;
        out.push(n);
      }
      n = n.nextElementSibling;
    }
    return out;
  }
  const childrenOf = (row) => subtreeRows(row).filter((r) => levelOf(r) === levelOf(row) + 1);
  function parentOf(row) {
    const lvl = levelOf(row);
    if (lvl <= 0) return null;
    let n = row.previousElementSibling;
    while (n) {
      if (n.getAttribute("data-part") === "tr" && levelOf(n) < lvl) return n;
      n = n.previousElementSibling;
    }
    return null;
  }
  function ancestorsOf(row) {
    const out = [];
    let p = parentOf(row);
    while (p) {
      out.push(p);
      p = parentOf(p);
    }
    return out;
  }
  const isTreeParent = (row) => opts.tree && childrenOf(row).length > 0;

  // ── Group helpers ──
  /** Every tbody row (data + detail) between a group header and the next one. */
  function groupMembers(gh) {
    const out = [];
    let n = gh.nextElementSibling;
    while (n && n.getAttribute("data-part") !== "group-header") {
      const p = n.getAttribute("data-part");
      if (p === "tr" || p === "detail-row") out.push(n);
      n = n.nextElementSibling;
    }
    return out;
  }

  // ── MutationObserver (auto-refresh when rows are added/removed externally) ──
  function pauseObserver(fn) {
    observerPaused++;
    try {
      fn();
    } finally {
      observer?.takeRecords();
      observerPaused--;
    }
  }
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 0);
    raf(() => {
      refreshQueued = false;
      if (root._faqirTable) refresh();
    });
  }

  // ── Sorting ──
  function compareCells(a, b, type) {
    const ra = a ? sortRaw(a) : "";
    const rb = b ? sortRaw(b) : "";
    if (ra === rb) return 0;
    if (!ra) return 1; // empties last (flipped by direction like everything else)
    if (!rb) return -1;
    if (type === "date") {
      const na = parseDateValue(ra);
      const nb = parseDateValue(rb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
    }
    const na = parseNumeric(ra);
    const nb = parseNumeric(rb);
    if (!isNaN(na) && !isNaN(nb) && type !== "text") return na - nb;
    return collator.compare(ra, rb);
  }

  function rememberOrder() {
    for (const r of bodyRows()) if (!originalIndex.has(r)) originalIndex.set(r, originSeq++);
  }

  function rowComparator() {
    if (!sorts.length) {
      return (a, b) => (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
    }
    const specs = sorts.map((s) => ({ ...s, type: columnType(s.index) }));
    return (a, b) => {
      for (const s of specs) {
        const v = compareCells(cellsOf(a)[s.index], cellsOf(b)[s.index], s.type);
        if (v) return s.dir === "ascending" ? v : -v;
      }
      return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
    };
  }

  function buildForest(rows) {
    const forest = [];
    const stack = [];
    for (const row of rows) {
      const node = { row, children: [] };
      const level = levelOf(row);
      while (stack.length && levelOf(stack[stack.length - 1].row) >= level) stack.pop();
      (stack.length ? stack[stack.length - 1].children : forest).push(node);
      stack.push(node);
    }
    return forest;
  }
  function sortForest(forest, cmp) {
    forest.sort((a, b) => cmp(a.row, b.row));
    for (const n of forest) sortForest(n.children, cmp);
  }
  function flattenForest(forest, out) {
    for (const n of forest) {
      out.push(n.row);
      flattenForest(n.children, out);
    }
    return out;
  }

  /** tbody structure as segments delimited by group headers. */
  function segments() {
    const segs = [];
    let cur = { header: null, rows: [] };
    for (const child of tbody ? [...tbody.children] : []) {
      const part = child.getAttribute("data-part");
      if (part === "group-header") {
        if (cur.header || cur.rows.length) segs.push(cur);
        cur = { header: child, rows: [] };
      } else if (part === "tr") {
        cur.rows.push(child);
      }
    }
    if (cur.header || cur.rows.length) segs.push(cur);
    return segs;
  }

  function updateSortIndicators() {
    for (const th of sortableHeaders()) {
      th.setAttribute("aria-sort", "none");
      th.removeAttribute("data-sort-order");
    }
    sorts.forEach((s, i) => {
      const th = headerCells()[s.index];
      if (th?.hasAttribute("data-sortable")) {
        th.setAttribute("aria-sort", s.dir);
        if (sorts.length > 1) th.setAttribute("data-sort-order", String(i + 1));
      }
    });
  }

  function applySorts() {
    if (!tbody || bodyRows().length === 0) return;
    if (!sorts.length && !hasSorted) return; // nothing to do yet
    hasSorted = true;
    rememberOrder();
    updateSortIndicators();

    const details = new Map();
    for (const r of bodyRows()) details.set(r, detailOf(r));
    const cmp = rowComparator();

    const order = [];
    for (const seg of segments()) {
      if (seg.header) order.push(seg.header);
      let rows;
      if (opts.tree) {
        const forest = buildForest(seg.rows);
        sortForest(forest, cmp);
        rows = flattenForest(forest, []);
      } else {
        rows = seg.rows.slice().sort(cmp);
      }
      for (const r of rows) {
        order.push(r);
        const d = details.get(r);
        if (d) order.push(d);
      }
    }
    const emptyRow = rowsIn(tbody, "empty")[0];
    pauseObserver(() => {
      for (const node of order) tbody.appendChild(node);
      if (emptyRow) tbody.appendChild(emptyRow);
    });
    refreshStripes();
  }

  function sortChanged() {
    applySorts();
    emit("sort", { sorts: sorts.map((s) => ({ column: s.index, direction: s.dir })) });
    scheduleStateSave();
  }

  /** Legacy API: sort one column with an explicit direction. */
  function sort(columnIndex, direction) {
    if (!tbody || bodyRows().length === 0) return;
    sorts = [{ index: columnIndex, dir: direction }];
    sortChanged();
  }

  /** Multi-sort API: sortBy([{ column, direction }...]). */
  function sortBy(specs) {
    if (!tbody || bodyRows().length === 0) return;
    sorts = (specs || [])
      .map((s) => ({
        index: s.column != null ? s.column : s.index,
        dir: s.direction || s.dir || "ascending",
      }))
      .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < columnCount());
    sortChanged();
  }

  function clearSort() {
    if (!sorts.length) return;
    sorts = [];
    sortChanged();
  }

  function handleSortRequest(idx, additive) {
    const existing = sorts.find((s) => s.index === idx);
    let dir = "ascending";
    if (existing) {
      if (existing.dir === "ascending") dir = "descending";
      else dir = opts.sortCycle === "tristate" ? null : "ascending";
    }
    if (additive && opts.multiSort) {
      if (dir === null) sorts = sorts.filter((s) => s.index !== idx);
      else if (existing) existing.dir = dir;
      else sorts.push({ index: idx, dir });
    } else {
      sorts = dir === null ? [] : [{ index: idx, dir }];
    }
    sortChanged();
  }

  // ── Selection ──
  function setRowSelected(row, selected) {
    toggleAttr(row, "data-selected", selected);
    const checkbox = row.querySelector("[data-part='checkbox']");
    if (checkbox) checkbox.checked = !!selected;
  }

  function selectRow(index) {
    const rows = bodyRows();
    if (index < 0 || index >= rows.length) return;
    const row = rows[index];
    setRowSelected(row, !row.hasAttribute("data-selected"));
    lastSelectedIndex = index;
    selectionChanged();
  }

  function selectAll() {
    const filtered = !!globalFilter || columnFilters.size > 0;
    for (const row of bodyRows()) {
      if (filtered && row.hasAttribute("data-filtered")) continue;
      setRowSelected(row, true);
    }
    selectionChanged();
  }

  function deselectAll() {
    for (const row of bodyRows()) setRowSelected(row, false);
    lastSelectedIndex = -1;
    selectionChanged();
  }

  function getSelected() {
    return bodyRows()
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.hasAttribute("data-selected"))
      .map(({ index }) => index);
  }

  function selectRange(fromIndex, toIndex) {
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rows = bodyRows();
    for (let i = start; i <= end; i++) {
      if (i >= 0 && i < rows.length && isRowVisible(rows[i])) setRowSelected(rows[i], true);
    }
  }

  function selectionChanged() {
    updateHeaderCheckbox();
    emit("selection-change", { selected: getSelected() });
  }

  function updateHeaderCheckbox() {
    if (!headerCheckbox) return;
    const rows = visibleBodyRows();
    const n = rows.filter((r) => r.hasAttribute("data-selected")).length;
    headerCheckbox.checked = n > 0 && n === rows.length;
    headerCheckbox.indeterminate = n > 0 && n < rows.length;
  }

  // ── Filtering ──
  function matchQuery(cell, query, type) {
    const q = String(query).trim();
    if (!q) return true;
    if (!cell) return false;
    if (isNumericType(type) || type === "date") {
      const val = type === "date" ? parseDateValue(cellRaw(cell)) : parseNumeric(cellRaw(cell));
      const parseQ = (s) => (type === "date" ? parseDateValue(s) : parseNumeric(s));
      const range = q.match(/^(.+?)\.\.(.+)$/);
      if (range) {
        const a = parseQ(range[1]);
        const b = parseQ(range[2]);
        return !isNaN(val) && !isNaN(a) && !isNaN(b) && val >= a && val <= b;
      }
      const op = q.match(/^(>=|<=|!=|=|>|<)\s*(.+)$/);
      if (op) {
        const b = parseQ(op[2]);
        if (isNaN(b) || isNaN(val)) return false;
        switch (op[1]) {
          case ">": return val > b;
          case ">=": return val >= b;
          case "<": return val < b;
          case "<=": return val <= b;
          case "=": return val === b;
          case "!=": return val !== b;
        }
      }
    }
    return (cell.textContent || "").toLowerCase().includes(q.toLowerCase());
  }

  function rowMatches(row) {
    const cells = cellsOf(row);
    if (globalFilter) {
      const hay = cells
        .map((c) => (c.textContent || "") + " " + (c.getAttribute("data-value") || ""))
        .join(" ")
        .toLowerCase();
      if (!hay.includes(globalFilter.toLowerCase())) return false;
    }
    for (const [idx, f] of columnFilters) {
      const cell = cells[idx];
      if (typeof f === "function") {
        if (!f(cell ? cellRaw(cell) : "", cell, row)) return false;
      } else if (!matchQuery(cell, f, columnType(idx))) {
        return false;
      }
    }
    return true;
  }

  function updateEmptyRow(visibleCount) {
    const emptyRow = tbody ? rowsIn(tbody, "empty")[0] : null;
    if (emptyRow) toggleAttr(emptyRow, "hidden", visibleCount > 0);
  }

  function applyFilters() {
    if (!tbody) return;
    const rows = bodyRows();
    const active = !!globalFilter || columnFilters.size > 0;
    const matched = new Set();
    if (active) {
      for (const r of rows) if (rowMatches(r)) matched.add(r);
      if (opts.tree) {
        // A matching row keeps its ancestor path visible.
        for (const r of [...matched]) for (const a of ancestorsOf(r)) matched.add(a);
      }
    }
    let visible = 0;
    for (const r of rows) {
      const show = !active || matched.has(r);
      toggleAttr(r, "data-filtered", !show);
      const d = detailOf(r);
      if (d) toggleAttr(d, "data-filtered", !show);
      if (show && isRowVisible(r)) visible++;
    }
    for (const gh of groupHeaders()) {
      const any = groupMembers(gh).some(
        (m) => m.getAttribute("data-part") === "tr" && !m.hasAttribute("data-filtered")
      );
      toggleAttr(gh, "data-filtered", active && !any);
    }
    updateEmptyRow(visible);
    refreshStripes();
    updateHeaderCheckbox();
    computeAggregates();
    setupNavigability();
    emit("filter", { query: globalFilter, visible, total: rows.length });
    scheduleStateSave();
  }

  function setFilter(query) {
    globalFilter = String(query == null ? "" : query);
    applyFilters();
  }
  function setColumnFilter(colIndex, query) {
    if (query == null || query === "") columnFilters.delete(colIndex);
    else columnFilters.set(colIndex, query);
    applyFilters();
  }
  function clearFilters() {
    globalFilter = "";
    columnFilters.clear();
    syncFilterInputs();
    applyFilters();
  }
  function syncFilterInputs() {
    const g = [...root.querySelectorAll("[data-part='filter']")].find(mine);
    if (g && g.value !== globalFilter) g.value = globalFilter;
    const fr = filterRowEl();
    if (!fr) return;
    cellsOf(fr).forEach((cell, i) => {
      const input = cell.querySelector("[data-part='filter-input']");
      if (!input) return;
      const val = columnFilters.get(i);
      input.value = typeof val === "string" ? val : "";
    });
  }

  // ── Collapse / expand (groups, tree, detail rows) ──
  function toggleGroup(ghOrIndex, force) {
    const gh = typeof ghOrIndex === "number" ? groupHeaders()[ghOrIndex] : ghOrIndex;
    if (!gh) return;
    const collapsed = gh.getAttribute("data-state") === "collapsed";
    const expand = force !== undefined ? !!force : collapsed;
    gh.setAttribute("data-state", expand ? "expanded" : "collapsed");
    gh.querySelector("[data-part='expander']")?.setAttribute("aria-expanded", String(expand));
    for (const m of groupMembers(gh)) toggleAttr(m, "data-collapsed", !expand);
    refreshStripes();
    updateHeaderCheckbox();
    setupNavigability();
    emit("group-toggle", { group: gh, expanded: expand });
  }

  function revealChildren(row) {
    for (const c of childrenOf(row)) {
      c.removeAttribute("data-collapsed");
      detailOf(c)?.removeAttribute("data-collapsed");
      if (isTreeParent(c) && c.getAttribute("aria-expanded") !== "false") revealChildren(c);
    }
  }

  function toggleRow(rowOrIndex, force) {
    const row = typeof rowOrIndex === "number" ? bodyRows()[rowOrIndex] : rowOrIndex;
    if (!row || !isTreeParent(row)) return;
    const expanded = row.getAttribute("aria-expanded") !== "false";
    const expand = force !== undefined ? !!force : !expanded;
    row.setAttribute("aria-expanded", String(expand));
    row.querySelector("[data-part='expander']")?.setAttribute("aria-expanded", String(expand));
    if (expand) {
      revealChildren(row);
    } else {
      for (const d of subtreeRows(row)) {
        d.setAttribute("data-collapsed", "");
        detailOf(d)?.setAttribute("data-collapsed", "");
      }
    }
    refreshStripes();
    updateHeaderCheckbox();
    setupNavigability();
    emit("tree-toggle", { row, expanded: expand });
  }

  /** Master/detail: show or hide a row's [data-part='detail-row'] via the hidden attribute. */
  function toggleDetail(rowOrIndex, force) {
    const row = typeof rowOrIndex === "number" ? bodyRows()[rowOrIndex] : rowOrIndex;
    const detail = row && detailOf(row);
    if (!detail) return;
    const expand = force !== undefined ? !!force : detail.hasAttribute("hidden");
    toggleAttr(detail, "hidden", !expand);
    row.querySelector("[data-part='row-toggle']")?.setAttribute("aria-expanded", String(expand));
    emit("row-expand", { row, detail, expanded: expand });
  }

  function setAllExpanded(expand) {
    mutedRun(() => {
      for (const gh of groupHeaders()) toggleGroup(gh, expand);
      if (opts.tree) for (const r of bodyRows()) if (isTreeParent(r)) toggleRow(r, expand);
    });
    refreshStripes();
  }
  const expandAll = () => setAllExpanded(true);
  const collapseAll = () => setAllExpanded(false);

  // ── Aggregates (tfoot, group headers, tree parents) ──
  function writeAggregate(cell, rows, ownIndex) {
    const fn = cell.getAttribute("data-aggregate");
    const col = cell.hasAttribute("data-col")
      ? parseInt(cell.getAttribute("data-col"), 10)
      : ownIndex != null
        ? ownIndex
        : cellsOf(cell.parentElement).indexOf(cell);
    const values = [];
    for (const r of rows) {
      const c = cellsOf(r)[col];
      if (!c) continue;
      const n = parseNumeric(cellRaw(c));
      if (!isNaN(n)) values.push(n);
    }
    let out = null;
    switch (fn) {
      case "count": out = rows.length; break;
      case "sum": out = values.reduce((a, b) => a + b, 0); break;
      case "avg": out = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; break;
      case "min": out = values.length ? Math.min(...values) : null; break;
      case "max": out = values.length ? Math.max(...values) : null; break;
      default: return;
    }
    if (out == null) {
      cell.textContent = "";
      cell.removeAttribute("data-value");
      return;
    }
    cell.setAttribute("data-value", String(out));
    const fmt =
      fn === "count"
        ? cell.getAttribute("data-format")
        : cellFormatOf(cell, col) || "number";
    cell.textContent = fmt ? formatValue(out, fmt) : String(out);
    applyNegativeFlag(cell);
  }

  function computeAggregates() {
    const visRows = bodyRows().filter((r) => !r.hasAttribute("data-filtered"));
    for (const row of rowsIn(tfoot)) {
      for (const cell of cellsOf(row)) {
        if (cell.hasAttribute("data-aggregate")) writeAggregate(cell, visRows);
      }
    }
    for (const gh of groupHeaders()) {
      const members = groupMembers(gh).filter(
        (r) => r.getAttribute("data-part") === "tr" && !r.hasAttribute("data-filtered")
      );
      for (const cell of cellsOf(gh)) {
        if (cell.hasAttribute("data-aggregate")) writeAggregate(cell, members);
      }
    }
    if (opts.tree) {
      for (const row of bodyRows()) {
        const cells = cellsOf(row);
        const aggCells = cells.filter((c) => c.hasAttribute("data-aggregate"));
        if (!aggCells.length) continue;
        const desc = subtreeRows(row).filter((r) => !r.hasAttribute("data-filtered"));
        if (!desc.length) continue; // leaf with a stray data-aggregate: leave authored value
        for (const cell of aggCells) writeAggregate(cell, desc, cells.indexOf(cell));
      }
    }
  }

  // ── Striping (JS-managed so hidden rows never break the pattern) ──
  function refreshStripes() {
    if (!(root.getAttribute("data-variant") || "").includes("striped")) return;
    let i = 0;
    for (const r of bodyRows()) {
      if (!isRowVisible(r)) {
        r.removeAttribute("data-stripe");
        continue;
      }
      r.setAttribute("data-stripe", i % 2 ? "even" : "odd");
      i++;
    }
  }

  // ── Inline editing ──
  function isCellEditable(cell) {
    if (!cell || cell.getAttribute("data-part") !== "td") return false;
    if (cell.hasAttribute("data-readonly")) return false;
    if (cell.hasAttribute("data-editable")) return true;
    if (!opts.editable) return false;
    const row = cell.parentElement;
    if (!row || row.getAttribute("data-part") !== "tr" || !tbody?.contains(row)) return false;
    if (cell.querySelector("input,button,select,a,textarea")) return false;
    const idx = cellsOf(row).indexOf(cell);
    const th = headerCells()[idx];
    if (th?.hasAttribute("data-readonly")) return false;
    const marked = headerCells().filter((h) => h.hasAttribute("data-editable"));
    return marked.length ? !!th?.hasAttribute("data-editable") : true;
  }

  function cellFormatOf(cell, colIndex) {
    return cell.getAttribute("data-format") || headerCells()[colIndex]?.getAttribute("data-format") || "";
  }

  function startEdit(a, b) {
    let cell = null;
    if (a instanceof Element) cell = a;
    else {
      const row = bodyRows()[a];
      if (row) cell = cellsOf(row)[b] || null;
    }
    if (!cell || !isCellEditable(cell)) return false;
    if (editing) {
      if (editing.cell === cell) return true;
      if (!commitEdit()) cancelEdit();
    }
    const row = cell.parentElement;
    const colIndex = cellsOf(row).indexOf(cell);
    const type = columnType(colIndex);
    const oldText = (cell.textContent || "").trim();
    const oldValue = cell.getAttribute("data-value");
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-part", "cell-input");
    if (isNumericType(type)) input.inputMode = "decimal";
    input.setAttribute("aria-label", "Edit " + (headerText(colIndex) || "cell"));
    input.value = oldValue != null ? oldValue : oldText;
    editing = { cell, row, input, oldText, oldValue, colIndex, type };
    cell.setAttribute("data-editing", "");
    cell.textContent = "";
    cell.appendChild(input);
    input.addEventListener("keydown", onEditorKeydown);
    input.addEventListener("blur", onEditorBlur);
    input.focus();
    try {
      input.select();
    } catch {
      /* select() unsupported in some environments */
    }
    emit("edit-start", { cell, row, rowIndex: bodyRows().indexOf(row), colIndex, value: input.value });
    return true;
  }

  function finishEditor(newText, newValue) {
    const { cell, oldValue } = editing;
    const numeric = isNumericType(editing.type) || isNumericType(cellFormatOf(cell, editing.colIndex));
    editing = null;
    cell.removeAttribute("data-editing");
    cell.textContent = newText;
    if (newValue != null && (oldValue != null || numeric)) cell.setAttribute("data-value", newValue);
    applyNegativeFlag(cell);
  }

  function commitEdit(focusBack) {
    if (!editing) return false;
    const { cell, row, input, oldText, oldValue, colIndex } = editing;
    const fmt = cellFormatOf(cell, colIndex);
    const numeric = isNumericType(editing.type) || isNumericType(fmt);
    const rawInput = input.value;
    let newValue = null;
    let newText = rawInput.trim();
    if (numeric && newText !== "") {
      const n = parseNumeric(rawInput);
      if (isNaN(n)) {
        input.setAttribute("data-invalid", "");
        input.focus();
        return false;
      }
      newValue = String(n);
      newText = isNumericType(fmt) ? formatValue(n, fmt) : newText;
    } else if (numeric) {
      newValue = "";
    }
    const before = oldValue != null ? oldValue : oldText;
    const after = newValue != null ? newValue : newText;
    finishEditor(newText, newValue);
    computeAggregates();
    if (String(before) !== String(after)) {
      emit("cell-edit", {
        cell,
        row,
        rowIndex: bodyRows().indexOf(row),
        colIndex,
        oldValue: before,
        value: after,
        text: newText,
      });
    }
    if (focusBack && opts.navigable) focusCell(cell);
    return true;
  }

  function cancelEdit(focusBack) {
    if (!editing) return false;
    const { cell, row, oldText, oldValue, colIndex } = editing;
    finishEditor(oldText, oldValue);
    formatCell(cell);
    emit("edit-cancel", { cell, row, rowIndex: bodyRows().indexOf(row), colIndex });
    if (focusBack && opts.navigable) focusCell(cell);
    return true;
  }

  function nextEditableCell(cell, dir) {
    const row = cell.parentElement;
    const rows = visibleBodyRows();
    let r = rows.indexOf(row);
    if (r < 0) return null;
    let c = cellsOf(row).indexOf(cell) + dir;
    while (r >= 0 && r < rows.length) {
      const cells = cellsOf(rows[r]);
      while (c >= 0 && c < cells.length) {
        if (isCellEditable(cells[c])) return cells[c];
        c += dir;
      }
      r += dir;
      if (r >= 0 && r < rows.length) c = dir > 0 ? 0 : cellsOf(rows[r]).length - 1;
    }
    return null;
  }

  function onEditorKeydown(e) {
    if (!editing) return;
    e.stopPropagation(); // keep grid navigation away from typing
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit(true);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const from = editing.cell;
      if (commitEdit()) {
        const next = nextEditableCell(from, e.shiftKey ? -1 : 1);
        if (next) startEdit(next);
      }
    } else {
      e.target.removeAttribute("data-invalid");
    }
  }
  function onEditorBlur(e) {
    if (!editing || editing.input !== e.target) return;
    if (!commitEdit()) cancelEdit();
  }

  // ── Column operations ──
  const remapIndex = (i, from, to) =>
    i === from ? to : from < to ? (i > from && i <= to ? i - 1 : i) : i >= to && i < from ? i + 1 : i;

  function moveColumn(from, to) {
    const n = columnCount();
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    pauseObserver(() => {
      for (const row of fullWidthRows()) {
        const cells = cellsOf(row);
        const cell = cells[from];
        const target = cells[to];
        if (!cell || !target) continue;
        if (from < to) target.after(cell);
        else target.before(cell);
      }
    });
    sorts = sorts.map((s) => ({ ...s, index: remapIndex(s.index, from, to) }));
    const remapped = new Map();
    for (const [i, f] of columnFilters) remapped.set(remapIndex(i, from, to), f);
    columnFilters.clear();
    for (const [i, f] of remapped) columnFilters.set(i, f);
    colTypeCache.clear();
    refreshPins();
    emit("col-reorder", { from, to });
    scheduleStateSave();
  }

  function setColumnHidden(i, hidden) {
    const th = headerCells()[i];
    if (!th) return;
    forEachColumnCell(i, (cell) => toggleAttr(cell, "data-col-hidden", hidden));
    refreshPins();
    setupNavigability();
    emit("col-visibility", { column: i, hidden: !!hidden });
    scheduleStateSave();
  }
  const hideColumn = (i) => setColumnHidden(i, true);
  const showColumn = (i) => setColumnHidden(i, false);
  function toggleColumn(i, force) {
    const th = headerCells()[i];
    if (!th) return;
    const hidden = th.hasAttribute("data-col-hidden");
    setColumnHidden(i, force !== undefined ? !force : !hidden);
  }

  function columnBounds(th) {
    const min = parseFloat(th.getAttribute("data-min-width")) || 40;
    const max = parseFloat(th.getAttribute("data-max-width")) || Infinity;
    return { min, max };
  }

  function setColumnWidth(i, width) {
    const th = headerCells()[i];
    if (!th) return;
    const { min, max } = columnBounds(th);
    const w = Math.max(min, Math.min(max, width));
    th.style.width = w + "px";
    root.setAttribute("data-resized", "");
    refreshPins();
    emit("col-resize", { column: i, width: w });
    scheduleStateSave();
  }

  // ── Pinned (sticky) columns ──
  const widthOf = (th) => th.offsetWidth || parseFloat(th.style.width) || 0;

  function refreshPins() {
    const hcs = headerCells();
    const startPins = [];
    const endPins = [];
    hcs.forEach((th, i) => {
      if (th.hasAttribute("data-col-hidden")) return;
      const p = th.getAttribute("data-pin");
      if (p === "start") startPins.push(i);
      else if (p === "end") endPins.push(i);
    });
    if (!startPins.length && !endPins.length) return;
    const setPin = (i, side, offset, isEdge) => {
      forEachColumnCell(i, (cell) => {
        cell.setAttribute("data-pin", side);
        cell.style.setProperty("--table-pin-offset", offset + "px");
        toggleAttr(cell, "data-pin-edge", isEdge);
      });
    };
    let acc = 0;
    startPins.forEach((i, k) => {
      setPin(i, "start", acc, k === startPins.length - 1);
      acc += widthOf(hcs[i]);
    });
    acc = 0;
    [...endPins].reverse().forEach((i, k) => {
      setPin(i, "end", acc, k === endPins.length - 1);
      acc += widthOf(hcs[i]);
    });
  }

  // ── Row moving (API + drag & drop) ──
  /** The DOM block a data row drags with: the row, its detail row, and (tree) its subtree. */
  function rowBlock(row) {
    const block = [row];
    const d = detailOf(row);
    if (d) block.push(d);
    if (opts.tree) {
      for (const sub of subtreeRows(row)) {
        block.push(sub);
        const sd = detailOf(sub);
        if (sd) block.push(sd);
      }
    }
    return block;
  }

  function performRowMove(row, targetRow, pos) {
    if (!row || !targetRow || row === targetRow) return false;
    const block = rowBlock(row);
    if (block.includes(targetRow)) return false;
    if (opts.tree && parentOf(targetRow) !== parentOf(row)) return false; // siblings only
    const anchor =
      pos === "after" ? rowBlock(targetRow)[rowBlock(targetRow).length - 1].nextElementSibling : targetRow;
    pauseObserver(() => {
      for (const node of block) tbody.insertBefore(node, anchor);
    });
    refreshStripes();
    computeAggregates();
    return true;
  }

  function moveRow(from, to) {
    const rows = bodyRows();
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return false;
    const moved = performRowMove(rows[from], rows[to], from < to ? "after" : "before");
    if (moved) emit("row-reorder", { from, to, row: rows[from] });
    return moved;
  }

  // ── Drag & drop (rows, columns, resize) — pointer-based ──
  function clearDropMarkers() {
    for (const el of root.querySelectorAll("[data-drop-target]")) {
      el.removeAttribute("data-drop-target");
      el.removeAttribute("data-drop-pos");
    }
  }

  function elementAt(e) {
    try {
      return document.elementFromPoint(e.clientX, e.clientY);
    } catch {
      return null; // elementFromPoint missing or throwing (headless)
    }
  }

  function resolveRowAt(e) {
    let row = elementAt(e)?.closest?.("[data-part='tr']");
    if (!row) row = e.target?.closest?.("[data-part='tr']");
    return row && tbody?.contains(row) ? row : null;
  }

  /** "before"/"after" the pointer's half of el: vertical for rows, horizontal (RTL-aware) for columns. */
  function dropPos(e, el, horizontal) {
    const rect = el.getBoundingClientRect?.();
    const size = rect && (horizontal ? rect.width : rect.height);
    if (!size) return "after";
    const before = horizontal ? e.clientX < rect.left + size / 2 !== isRTL : e.clientY < rect.top + size / 2;
    return before ? "before" : "after";
  }

  function bindDocDrag() {
    document.addEventListener("pointermove", onDocPointerMove);
    document.addEventListener("pointerup", onDocPointerUp);
    document.addEventListener("keydown", onDragKeydown, true);
  }
  function unbindDocDrag() {
    document.removeEventListener("pointermove", onDocPointerMove);
    document.removeEventListener("pointerup", onDocPointerUp);
    document.removeEventListener("keydown", onDragKeydown, true);
  }
  cleanups.push(unbindDocDrag);

  function cancelDrag() {
    if (!drag) return;
    if (drag.kind === "row") drag.row.removeAttribute("data-dragging");
    if (drag.kind === "col") drag.th.removeAttribute("data-dragging");
    clearDropMarkers();
    drag = null;
    unbindDocDrag();
  }
  function onDragKeydown(e) {
    if (e.key === "Escape") cancelDrag();
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const handle = e.target.closest("[data-part='drag-handle']");
    if (handle && opts.reorderable) {
      const row = handle.closest("[data-part='tr']");
      if (row && tbody?.contains(row)) {
        drag = { kind: "row", row, startY: e.clientY || 0, active: false };
        bindDocDrag();
        e.preventDefault();
      }
      return;
    }
    const rh = e.target.closest("[data-part='resize-handle']");
    if (rh && opts.resizable) {
      const th = rh.closest("[data-part='th']");
      const idx = headerCells().indexOf(th);
      if (idx >= 0) {
        drag = { kind: "resize", th, index: idx, startX: e.clientX || 0, startW: widthOf(th) };
        bindDocDrag();
        e.preventDefault();
      }
      return;
    }
    if (opts.colReorderable) {
      const th = e.target.closest("[data-part='th']");
      if (
        th &&
        headerRowEl()?.contains(th) &&
        !e.target.closest("input,button,select,textarea,[data-part='resize-handle']")
      ) {
        drag = { kind: "col", th, startX: e.clientX || 0, active: false };
        bindDocDrag();
        // no preventDefault: a motionless press must still become a sort click
      }
    }
  }

  function onDocPointerMove(e) {
    if (!drag) return;
    if (drag.kind === "resize") {
      const dx = ((e.clientX || 0) - drag.startX) * (isRTL ? -1 : 1);
      const { min, max } = columnBounds(drag.th);
      const w = Math.max(min, Math.min(max, drag.startW + dx));
      drag.th.style.width = w + "px";
      drag.width = w;
      root.setAttribute("data-resized", "");
      return;
    }
    if (drag.kind === "row") {
      if (!drag.active && Math.abs((e.clientY || 0) - drag.startY) > 3) {
        drag.active = true;
        drag.row.setAttribute("data-dragging", "");
      }
      if (!drag.active) return;
      clearDropMarkers();
      const target = resolveRowAt(e);
      if (!target || target === drag.row || rowBlock(drag.row).includes(target)) return;
      if (opts.tree && parentOf(target) !== parentOf(drag.row)) return; // siblings only
      target.setAttribute("data-drop-target", "");
      target.setAttribute("data-drop-pos", dropPos(e, target));
      return;
    }
    if (drag.kind === "col") {
      if (!drag.active && Math.abs((e.clientX || 0) - drag.startX) > 4) {
        drag.active = true;
        drag.th.setAttribute("data-dragging", "");
      }
      if (!drag.active) return;
      clearDropMarkers();
      let th = elementAt(e)?.closest?.("[data-part='th']");
      if (!th) th = e.target?.closest?.("[data-part='th']");
      if (!th || th === drag.th || !headerRowEl()?.contains(th)) return;
      th.setAttribute("data-drop-target", "");
      th.setAttribute("data-drop-pos", dropPos(e, th, true));
    }
  }

  function onDocPointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    unbindDocDrag();
    if (d.kind === "resize") {
      if (d.width != null) {
        refreshPins();
        emit("col-resize", { column: d.index, width: d.width });
        scheduleStateSave();
      }
      return;
    }
    if (d.kind === "row") {
      const target = root.querySelector("[data-part='tr'][data-drop-target]");
      d.row.removeAttribute("data-dragging");
      if (d.active) suppressClickUntil = Date.now() + 100;
      if (target) {
        const pos = target.getAttribute("data-drop-pos") || "after";
        const rows = bodyRows();
        const from = rows.indexOf(d.row);
        clearDropMarkers();
        if (performRowMove(d.row, target, pos)) {
          emit("row-reorder", { from, to: bodyRows().indexOf(d.row), row: d.row });
        }
      }
      clearDropMarkers();
      return;
    }
    if (d.kind === "col") {
      const target = thead?.querySelector("[data-part='th'][data-drop-target]");
      d.th.removeAttribute("data-dragging");
      if (d.active) suppressClickUntil = Date.now() + 100;
      if (target) {
        const pos = target.getAttribute("data-drop-pos") || "after";
        const hcs = headerCells();
        const from = hcs.indexOf(d.th);
        let to = hcs.indexOf(target);
        if (pos === "after" && from > to) to += 1;
        if (pos === "before" && from < to) to -= 1;
        clearDropMarkers();
        moveColumn(from, to);
      }
      clearDropMarkers();
    }
  }

  // ── CSV export / data extraction ──
  function csvColumns(includeHidden) {
    const cols = [];
    headerCells().forEach((th, i) => {
      if (!includeHidden && th.hasAttribute("data-col-hidden")) return;
      if (th.hasAttribute("data-csv-skip")) return;
      if (th.querySelector("[data-part='checkbox']")) return;
      cols.push(i);
    });
    return cols;
  }

  function exportCsv(o = {}) {
    const all = o.all === true;
    const sep = o.separator || ",";
    const cols = csvColumns(all);
    const esc = (s) => {
      s = String(s == null ? "" : s);
      return /[",;\n]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map((i) => esc(headerText(i))).join(sep)];
    for (const row of bodyRows()) {
      if (!all && row.hasAttribute("data-filtered")) continue;
      const cells = cellsOf(row);
      lines.push(
        cols
          .map((i) => {
            const c = cells[i];
            return esc(c ? cellRaw(c) : "");
          })
          .join(sep)
      );
    }
    const csv = lines.join("\n");
    if (o.filename && typeof Blob !== "undefined" && typeof URL !== "undefined" && URL.createObjectURL) {
      try {
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = o.filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        /* download unavailable (headless) — the string is still returned */
      }
    }
    return csv;
  }

  function rowData(row) {
    const cells = cellsOf(row);
    const out = {};
    headerCells().forEach((th, i) => {
      if (th.querySelector("[data-part='checkbox']")) return;
      const key = th.getAttribute("data-key") || headerText(i) || "col" + i;
      const c = cells[i];
      out[key] = c ? cellRaw(c) : "";
    });
    if (row.hasAttribute("data-row-id")) out._id = row.getAttribute("data-row-id");
    return out;
  }
  const getData = (o = {}) =>
    bodyRows()
      .filter((r) => o.all === true || !r.hasAttribute("data-filtered"))
      .map(rowData);
  const getSelectedData = () => bodyRows().filter((r) => r.hasAttribute("data-selected")).map(rowData);

  // ── State persistence ──
  function getState() {
    return {
      sorts: sorts.map((s) => ({ ...s })),
      filter: globalFilter,
      columnFilters: [...columnFilters].filter(([, v]) => typeof v === "string"),
      widths: headerCells().map((th) => th.style.width || null),
      hidden: headerCells().map((th) => th.hasAttribute("data-col-hidden")),
    };
  }

  function setState(state) {
    if (!state || typeof state !== "object") return;
    mutedRun(() => {
      if (Array.isArray(state.widths)) {
        state.widths.forEach((w, i) => {
          if (w) setColumnWidth(i, parseFloat(w));
        });
      }
      if (Array.isArray(state.hidden)) {
        state.hidden.forEach((h, i) => setColumnHidden(i, !!h));
      }
      let filterDirty = false;
      if (Array.isArray(state.columnFilters)) {
        columnFilters.clear();
        for (const [i, v] of state.columnFilters) {
          if (typeof v === "string" && v) columnFilters.set(+i, v);
        }
        filterDirty = true;
      }
      if (typeof state.filter === "string") {
        globalFilter = state.filter;
        filterDirty = true;
      }
      if (filterDirty) {
        syncFilterInputs();
        applyFilters();
      }
      if (Array.isArray(state.sorts) && state.sorts.length) {
        sorts = state.sorts
          .map((s) => ({ index: s.index != null ? s.index : s.column, dir: s.dir || s.direction || "ascending" }))
          .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < columnCount());
        applySorts();
      }
    });
  }

  let saveTimer = null;
  function scheduleStateSave() {
    if (!opts.persistKey || muted) return;
    clearTimeout(saveTimer);
    saveTimer = later(() => {
      try {
        localStorage.setItem("faqir-table:" + opts.persistKey, JSON.stringify(getState()));
      } catch {
        /* storage unavailable */
      }
    }, 150);
  }
  function restoreState() {
    if (!opts.persistKey) return;
    try {
      const raw = localStorage.getItem("faqir-table:" + opts.persistKey);
      if (raw) setState(JSON.parse(raw));
    } catch {
      /* corrupt state is discarded */
    }
  }

  // ── Structural setup (run at init and on refresh) ──
  function mirrorColumnAttrs() {
    const hcs = headerCells();
    const n = hcs.length;
    if (!n) return;
    for (const row of [...bodyRows(), ...rowsIn(tfoot)]) {
      const cells = cellsOf(row);
      if (cells.length !== n) continue;
      hcs.forEach((th, i) => {
        for (const attr of ["data-align", "data-format", "data-hide-below"]) {
          const v = th.getAttribute(attr);
          if (v && !cells[i].hasAttribute(attr)) cells[i].setAttribute(attr, v);
        }
      });
    }
  }

  function treeCellOf(row) {
    return (
      cellsOf(row).find(
        (c) => !c.querySelector("[data-part='checkbox'],[data-part='drag-handle']")
      ) || cellsOf(row)[0]
    );
  }

  function injectExpander(cell, isParent) {
    let existing = cell.querySelector("[data-part='expander']");
    if (existing) {
      // A leaf placeholder must become a real button when the row gains children (and vice versa).
      const isButton = existing.tagName === "BUTTON";
      if (isParent === isButton) return existing;
      existing.remove();
      existing = null;
    }
    const el = document.createElement(isParent ? "button" : "span");
    if (isParent) el.type = "button";
    el.setAttribute("data-part", "expander");
    if (isParent) el.setAttribute("aria-label", "Toggle");
    else {
      el.setAttribute("data-leaf", "");
      el.setAttribute("aria-hidden", "true");
    }
    cell.insertBefore(el, cell.firstChild);
    return el;
  }

  function setupTree() {
    if (!opts.tree || !tbody) return;
    table?.setAttribute("role", "treegrid");
    for (const row of bodyRows()) {
      const level = levelOf(row);
      row.setAttribute("aria-level", String(level + 1));
      const cell = treeCellOf(row);
      if (!cell) continue;
      cell.setAttribute("data-tree-cell", "");
      cell.style.setProperty("--table-level", String(level));
      const parent = isTreeParent(row);
      const expander = injectExpander(cell, parent);
      if (parent) {
        if (!row.hasAttribute("aria-expanded")) row.setAttribute("aria-expanded", "true");
        expander.setAttribute("aria-expanded", row.getAttribute("aria-expanded"));
        if (row.getAttribute("aria-expanded") === "false") {
          for (const d of subtreeRows(row)) {
            d.setAttribute("data-collapsed", "");
            detailOf(d)?.setAttribute("data-collapsed", "");
          }
        }
      } else {
        row.removeAttribute("aria-expanded");
      }
    }
  }

  function setupGroups() {
    if (!opts.groupable || !tbody) return;
    for (const gh of groupHeaders()) {
      const cell = cellsOf(gh)[0];
      if (!cell) continue;
      const expander = injectExpander(cell, true);
      if (!gh.hasAttribute("data-state")) gh.setAttribute("data-state", "expanded");
      const expanded = gh.getAttribute("data-state") !== "collapsed";
      expander.setAttribute("aria-expanded", String(expanded));
      if (!expanded) for (const m of groupMembers(gh)) m.setAttribute("data-collapsed", "");
    }
  }

  function setupDetails() {
    if (!tbody) return;
    for (const row of bodyRows()) {
      const toggle = row.querySelector("[data-part='row-toggle']");
      const detail = detailOf(row);
      if (!toggle || !detail) continue;
      if (toggle.getAttribute("aria-expanded") === "false") detail.setAttribute("hidden", "");
      else toggle.setAttribute("aria-expanded", String(!detail.hasAttribute("hidden")));
    }
  }

  function setupLabels() {
    if (opts.responsive !== "stack") return;
    const n = columnCount();
    for (const row of [...bodyRows(), ...rowsIn(tfoot)]) {
      const cells = cellsOf(row);
      if (cells.length !== n) continue;
      cells.forEach((cell, i) => {
        if (!cell.hasAttribute("data-label")) cell.setAttribute("data-label", headerText(i));
      });
    }
  }

  function injectResizeHandles() {
    if (!opts.resizable) return;
    headerCells().forEach((th) => {
      if (th.hasAttribute("data-no-resize")) return;
      if (th.querySelector("[data-part='resize-handle']")) return;
      const handle = document.createElement("span");
      handle.setAttribute("data-part", "resize-handle");
      handle.setAttribute("aria-hidden", "true");
      th.appendChild(handle);
    });
  }

  // ── Keyboard navigation (roving tabindex grid) ──
  function navMatrix() {
    const rows = [];
    const hr = headerRowEl();
    if (hr) rows.push(hr);
    for (const child of tbody ? [...tbody.children] : []) {
      const p = child.getAttribute("data-part");
      if ((p === "tr" || p === "group-header") && isRowVisible(child)) rows.push(child);
    }
    for (const r of rowsIn(tfoot)) rows.push(r);
    return rows;
  }

  // APG grid: links, buttons and fields inside a navigable grid's cells leave the
  // Tab order (Enter/F2 reaches them, Escape comes back). The table's own controls
  // stay focusable. destroy() puts the original tabindex back.
  const demoted = new WeakMap();
  const cellControls = (cell) =>
    [...cell.querySelectorAll("input,select,textarea,button,a[href],[tabindex]")].filter(
      (el) => mine(el) && !el.closest("[data-part='checkbox'],[data-part='drag-handle'],[data-part='expander'],[data-part='row-toggle']")
    );

  // Re-run after anything that can take the Tab stop away (refresh, filter,
  // collapse, column hide): only the Tab stop moves, never focus.
  function setupNavigability() {
    if (opts.navigable) {
      const rows = navMatrix();
      // A stale stop — its row removed, filtered or collapsed, or its column hidden —
      // is dropped so the first visible cell takes over.
      if (activeCell && (!rows.includes(activeCell.parentElement) || activeCell.hasAttribute("data-col-hidden"))) {
        activeCell.setAttribute("tabindex", "-1");
        activeCell = null;
      }
      let first = null;
      for (const row of rows) {
        for (const cell of cellsOf(row)) {
          if (!first && !activeCell && !cell.hasAttribute("data-col-hidden")) first = cell;
          cell.setAttribute("tabindex", cell === (activeCell || first) ? "0" : "-1");
          for (const el of cellControls(cell)) {
            if (!demoted.has(el)) demoted.set(el, el.getAttribute("tabindex"));
            el.setAttribute("tabindex", "-1");
          }
        }
      }
      if (!activeCell) activeCell = first;
    } else {
      // Sortable headers must stay keyboard-operable even without grid navigation.
      for (const th of sortableHeaders()) th.setAttribute("tabindex", "0");
    }
  }

  function focusCell(cell) {
    if (!cell) return;
    if (activeCell && activeCell !== cell) activeCell.setAttribute("tabindex", "-1");
    activeCell = cell;
    cell.setAttribute("tabindex", "0");
    cell.focus();
  }

  function moveFocus(rowDelta, colDelta, edge) {
    const cell = activeCell;
    if (!cell) return;
    const row = cell.parentElement;
    const rows = navMatrix();
    let r = rows.indexOf(row);
    if (r < 0) return;
    let cells = cellsOf(row);
    let c = cells.indexOf(cell);
    if (edge === "rowStart") c = 0;
    else if (edge === "rowEnd") c = cells.length - 1;
    else if (edge === "gridStart") {
      r = 0;
      c = 0;
    } else if (edge === "gridEnd") {
      r = rows.length - 1;
      c = cellsOf(rows[r]).length - 1;
    } else {
      r = Math.max(0, Math.min(rows.length - 1, r + rowDelta));
      cells = cellsOf(rows[r]);
      c = Math.max(0, Math.min(cells.length - 1, c + colDelta));
    }
    cells = cellsOf(rows[r]);
    let target = cells[Math.min(c, cells.length - 1)];
    // Skip hidden columns in the direction of travel.
    let guard = cells.length;
    while (target && target.hasAttribute("data-col-hidden") && guard--) {
      const i = cells.indexOf(target) + (colDelta < 0 ? -1 : 1);
      target = cells[i];
    }
    if (target) focusCell(target);
  }

  function onFocusIn(e) {
    if (!opts.navigable) return;
    const cell = e.target.closest("[data-part='td'],[data-part='th']");
    if (!cell || cell === activeCell || !root.contains(cell)) return;
    if (e.target !== cell && !demoted.has(e.target)) return; // the table's own control, not the cell
    if (activeCell) activeCell.setAttribute("tabindex", "-1");
    activeCell = cell;
    cell.setAttribute("tabindex", "0");
  }

  // ── Event handlers ──
  function onHeaderClick(e) {
    if (Date.now() < suppressClickUntil) return;
    if (e.target.closest("[data-part='resize-handle'],[data-part='checkbox'],[data-part='filter-input'],input,button,select,textarea")) {
      return;
    }
    const th = e.target.closest("[data-part='th'][data-sortable]");
    if (!th) return;
    const columnIndex = headerCells().indexOf(th);
    if (columnIndex < 0) return;
    handleSortRequest(columnIndex, e.shiftKey);
  }

  function onHeaderCheckboxChange() {
    if (headerCheckbox.checked) selectAll();
    else deselectAll();
  }

  function onRowCheckboxChange(e) {
    const checkbox = e.target.closest("[data-part='checkbox']");
    if (!checkbox || checkbox === headerCheckbox) return;
    const row = checkbox.closest("[data-part='tr']");
    if (!row || !tbody?.contains(row)) return;
    const rows = bodyRows();
    const index = rows.indexOf(row);
    if (index < 0) return;
    if (e.shiftKey && lastSelectedIndex >= 0) {
      e.preventDefault();
      selectRange(lastSelectedIndex, index);
      selectionChanged();
      return;
    }
    toggleAttr(row, "data-selected", checkbox.checked);
    lastSelectedIndex = index;
    selectionChanged();
  }

  function onRootClick(e) {
    if (Date.now() < suppressClickUntil) return;
    const expander = e.target.closest("[data-part='expander']");
    if (expander && !expander.hasAttribute("data-leaf") && root.contains(expander)) {
      const gh = expander.closest("[data-part='group-header']");
      if (gh && tbody?.contains(gh)) {
        toggleGroup(gh);
        return;
      }
      const treeRow = expander.closest("[data-part='tr']");
      if (treeRow && tbody?.contains(treeRow)) {
        toggleRow(treeRow);
        return;
      }
    }
    const rowToggle = e.target.closest("[data-part='row-toggle']");
    if (rowToggle && root.contains(rowToggle)) {
      const r = rowToggle.closest("[data-part='tr']");
      if (r && tbody?.contains(r)) toggleDetail(r);
      return;
    }
    if (opts.groupable) {
      const gh = e.target.closest("[data-part='group-header']");
      if (gh && tbody?.contains(gh) && !e.target.closest("a,button,input,select,textarea")) {
        toggleGroup(gh);
        return;
      }
    }
    if (e.target.closest("[data-part='checkbox']")) return;
    const row = e.target.closest("[data-part='tr']");
    if (!row || !tbody?.contains(row)) return;
    if (e.target.closest("a,button,input,select,textarea") || editing) return;
    const rows = bodyRows();
    const index = rows.indexOf(row);
    if (index < 0) return;
    if (e.shiftKey && lastSelectedIndex >= 0) {
      selectRange(lastSelectedIndex, index);
      selectionChanged();
      return;
    }
    if (opts.selectable != null) {
      if (opts.selectable === "single") {
        const wasSelected = row.hasAttribute("data-selected");
        for (const r of rows) setRowSelected(r, false);
        setRowSelected(row, !wasSelected);
      } else {
        setRowSelected(row, !row.hasAttribute("data-selected"));
      }
      lastSelectedIndex = index;
      selectionChanged();
    }
  }

  function onDblClick(e) {
    const cell = e.target.closest("[data-part='td']");
    if (cell && tbody?.contains(cell) && isCellEditable(cell)) startEdit(cell);
  }

  const filterTimers = new Map();
  function onFilterInput(e) {
    const t = e.target;
    if (!t || !t.matches) return;
    if (t.matches("[data-part='filter']")) {
      clearTimeout(filterTimers.get("global"));
      filterTimers.set(
        "global",
        later(() => setFilter(t.value), 120)
      );
      return;
    }
    if (t.matches("[data-part='filter-input']")) {
      const fr = filterRowEl();
      const cell = t.closest("[data-part='td'],[data-part='th']");
      if (!fr || !cell) return;
      const col = cellsOf(fr).indexOf(cell);
      if (col < 0) return;
      clearTimeout(filterTimers.get(col));
      filterTimers.set(
        col,
        later(() => setColumnFilter(col, t.value), 120)
      );
    }
  }

  function onKeydown(e) {
    if (editing) return; // the editor's own keydown handler owns these keys
    const target = e.target;

    // Drag handle: arrow keys move the row among its siblings (subtrees stay attached).
    const handle = target.closest?.("[data-part='drag-handle']");
    if (handle && opts.reorderable && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const row = handle.closest("[data-part='tr']");
      if (row && tbody?.contains(row)) {
        e.preventDefault();
        const down = e.key === "ArrowDown";
        const siblings = opts.tree
          ? bodyRows().filter((r) => parentOf(r) === parentOf(row))
          : bodyRows();
        const sibling = siblings[siblings.indexOf(row) + (down ? 1 : -1)];
        if (sibling) {
          const from = bodyRows().indexOf(row);
          if (performRowMove(row, sibling, down ? "after" : "before")) {
            emit("row-reorder", { from, to: bodyRows().indexOf(row), row });
          }
        }
      }
      return;
    }

    const cell = target.closest?.("[data-part='td'],[data-part='th']");

    // Escape in a cell's control returns to the cell.
    if (e.key === "Escape" && demoted.has(target)) {
      e.preventDefault();
      focusCell(cell);
      return;
    }

    // Never hijack typing or native control activation (buttons own Enter/Space via click).
    if (target.closest?.("input,select,textarea,button,a")) return;

    const inHeader = cell && thead?.contains(cell);

    // Sortable header keyboard activation.
    if (inHeader && (e.key === "Enter" || e.key === " ") && cell.hasAttribute("data-sortable")) {
      e.preventDefault();
      const idx = headerCells().indexOf(cell);
      if (idx >= 0) handleSortRequest(idx, e.shiftKey);
      return;
    }

    // Header column ops (navigable focus on th).
    if (inHeader && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      if (opts.colReorderable) {
        e.preventDefault();
        const idx = headerCells().indexOf(cell);
        const delta = (e.key === "ArrowRight") !== isRTL ? 1 : -1;
        moveColumn(idx, idx + delta);
        return;
      }
    }
    if (inHeader && e.ctrlKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      if (opts.resizable) {
        e.preventDefault();
        const idx = headerCells().indexOf(cell);
        const delta = (e.key === "ArrowRight") !== isRTL ? 16 : -16;
        setColumnWidth(idx, widthOf(cell) + delta);
        return;
      }
    }

    if (!opts.navigable || !cell || !root.contains(cell)) return;

    // Select-all.
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      if (opts.selectable != null || headerCheckbox) {
        e.preventDefault();
        selectAll();
      }
      return;
    }

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-1, 0);
        return;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(1, 0);
        return;
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(0, isRTL ? 1 : -1);
        return;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(0, isRTL ? -1 : 1);
        return;
      case "Home":
        e.preventDefault();
        moveFocus(0, 0, e.ctrlKey ? "gridStart" : "rowStart");
        return;
      case "End":
        e.preventDefault();
        moveFocus(0, 0, e.ctrlKey ? "gridEnd" : "rowEnd");
        return;
      case "PageUp":
        e.preventDefault();
        moveFocus(-10, 0);
        return;
      case "PageDown":
        e.preventDefault();
        moveFocus(10, 0);
        return;
      case "Enter":
      case "F2": {
        const row = cell.parentElement;
        if (row.getAttribute("data-part") === "group-header") {
          e.preventDefault();
          toggleGroup(row);
          return;
        }
        if (isTreeParent(row) && !isCellEditable(cell)) {
          e.preventDefault();
          toggleRow(row);
          return;
        }
        if (isCellEditable(cell)) {
          e.preventDefault();
          startEdit(cell);
          return;
        }
        const ctl = cellControls(cell)[0];
        if (ctl) {
          e.preventDefault();
          ctl.focus();
        }
        return;
      }
      case " ": {
        const row = cell.parentElement;
        if (row.getAttribute("data-part") === "group-header") {
          e.preventDefault();
          toggleGroup(row);
          return;
        }
        if (opts.selectable != null || row.querySelector("[data-part='checkbox']")) {
          const index = bodyRows().indexOf(row);
          if (index >= 0) {
            e.preventDefault();
            selectRow(index);
          }
        }
        return;
      }
    }
  }

  // ── Sticky + responsive measurements ──
  // The breakpoint canon (src/utils/breakpoints.ts, task 0.8-01) in px, the unit
  // clientWidth speaks. It is a literal here and not an import because the build
  // inlines every controller into one UMD closure and strips its import lines
  // (scripts/build-core.mjs) — so the equality is enforced from the outside
  // instead: tests/responsive-canon.test.ts parses this very object out of the
  // shipped controller and compares it to BREAKPOINTS, and would fail on any
  // edit that made the engine a second source of truth. `sm` was 480 in 1.x —
  // its own ladder, half a tier below the canon; the CSS ceilings it paired with
  // are now min-width floors.
  const STACK_BREAKPOINTS = { sm: 640, md: 768, lg: 1024 };
  function stackBreakpoint() {
    const v = root.getAttribute("data-stack-below") || "md";
    return STACK_BREAKPOINTS[v] || parseFloat(v) || STACK_BREAKPOINTS.md;
  }
  /** Below the breakpoint, stack mode re-renders rows as labelled cards (CSS keys off data-stacked). */
  function updateStackMode() {
    if (opts.responsive !== "stack") return;
    const width = root.clientWidth || root.getBoundingClientRect?.().width || 0;
    if (!width) return; // headless environment — leave any authored data-stacked alone
    toggleAttr(root, "data-stacked", width < stackBreakpoint());
  }

  function measureSticky() {
    const needsHeaderVar =
      root.hasAttribute("data-sticky-header") || bodyRows().some((r) => r.dataset.pin === "top");
    if (needsHeaderVar && thead && thead.offsetHeight) {
      root.style.setProperty("--table-thead-h", thead.offsetHeight + "px");
    }
    refreshPins();
    updateStackMode();
  }

  // ── Refresh (full structural rescan; safe to call after external DOM changes) ──
  function refresh() {
    colTypeCache.clear();
    rememberOrder();
    mirrorColumnAttrs();
    setupTree();
    setupGroups();
    setupDetails();
    injectResizeHandles();
    applyFormats();
    setupLabels();
    setupNavigability();
    computeAggregates();
    if (globalFilter || columnFilters.size) {
      mutedRun(applyFilters);
    } else {
      updateEmptyRow(visibleBodyRows().length);
    }
    refreshPins();
    refreshStripes();
    updateHeaderCheckbox();
  }

  // ── Lifecycle ──
  function destroy() {
    cancelDrag();
    if (editing) cancelEdit();
    for (const fn of cleanups) fn();
    cleanups.length = 0;
    observer?.disconnect();
    observer = null;
    for (const el of root.querySelectorAll("[tabindex]")) {
      if (demoted.has(el)) {
        const t = demoted.get(el);
        t == null ? el.removeAttribute("tabindex") : el.setAttribute("tabindex", t);
      }
    }
    for (const t of timers) clearTimeout(t);
    timers.clear();
    clearTimeout(saveTimer);
    delete root._faqirTable;
  }

  // ── Wire up ──
  if (thead) on(thead, "click", onHeaderClick);
  if (headerCheckbox) on(headerCheckbox, "change", onHeaderCheckboxChange);
  const onOwn = (target, ev, fn) => on(target, ev, (e) => mine(e.target) && fn(e));
  if (tbody) onOwn(tbody, "change", onRowCheckboxChange);
  onOwn(root, "click", onRootClick);
  onOwn(root, "dblclick", onDblClick);
  onOwn(root, "keydown", onKeydown);
  onOwn(root, "input", onFilterInput);
  onOwn(root, "pointerdown", onPointerDown);
  onOwn(root, "focusin", onFocusIn);
  if (typeof window !== "undefined") {
    let resizeTimer = null;
    const onWinResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = later(measureSticky, 150);
    };
    on(window, "resize", onWinResize);
  }
  if (typeof MutationObserver !== "undefined" && tbody) {
    observer = new MutationObserver(() => {
      if (!observerPaused) queueRefresh();
    });
    observer.observe(tbody, { childList: true });
  }
  if (typeof ResizeObserver !== "undefined") {
    let sizeTimer = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(sizeTimer);
      sizeTimer = later(measureSticky, 100);
    });
    ro.observe(root);
    cleanups.push(() => ro.disconnect());
  }

  refresh();
  restoreState();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(measureSticky);

  const api = {
    // legacy surface (unchanged)
    sort,
    selectRow,
    selectAll,
    deselectAll,
    getSelected,
    destroy,
    // sorting
    sortBy,
    clearSort,
    // filtering
    setFilter,
    setColumnFilter,
    clearFilters,
    // grouping / tree / detail
    toggleGroup,
    toggleRow,
    toggleDetail,
    expandAll,
    collapseAll,
    // editing
    startEdit,
    commitEdit,
    cancelEdit,
    // structure
    moveRow,
    moveColumn,
    hideColumn,
    showColumn,
    toggleColumn,
    setColumnWidth,
    // data
    exportCsv,
    getData,
    getSelectedData,
    // state
    getState,
    setState,
    refresh,
  };
  root._faqirTable = api;
  return api;
}
    return createTable;
  })();

  // ── tabs ── (registry/recipes/tabs/tabs.js)
  var createTabs = controllerRegistry["tabs"] = (function() {
// @ui:controller tabs
// @ui:provides activate destroy

function createTabs(root) {
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
    return createTabs;
  })();

  // ── tag-input ── (registry/recipes/tag-input/tag-input.js)
  var createTagInput = controllerRegistry["tag-input"] = (function() {
// @ui:controller tag-input
// @ui:provides getValue setValue addTag removeTag clear destroy

/**
 * tag-input — a multi-value text input that composes two existing recipes:
 *
 *   • CHIP (primitive) for each committed value — the tags are real
 *     `data-ui="chip"` elements, so they inherit chip.css verbatim (no
 *     duplicated styling) including the dismiss button.
 *   • COMBOBOX behaviour for the optional suggestions listbox — filter-as-you-
 *     type, Arrow/Enter selection, an empty state — mirroring the combobox
 *     recipe's listbox contract.
 *
 * Interaction contract:
 *   • Type + Enter commits the trimmed draft as a tag (unless it duplicates an
 *     existing tag and duplicates are disallowed, the default).
 *   • Backspace on an empty input removes the last tag.
 *   • The chip dismiss button (or the removeTag API) removes a specific tag.
 *   • With a suggestions listbox present, typing filters it; ArrowDown/ArrowUp
 *     highlight; Enter/click commits the highlighted/clicked suggestion.
 *
 * Value exposure:
 *   • getValue() returns the live tag array; setValue(arr) rebuilds the chips.
 *   • Every mutation dispatches `faqir:change` (detail.value = the array) and
 *     mirrors the array as JSON onto the hidden `[data-part="value"]` input,
 *     firing a native `input` event so `l-model` on that input stays in sync
 *     (parse it for the array; getValue()/the event carry the array directly).
 */
function createTagInput(root) {
  // Prevent double-init.
  if (root._faqirTagInput) return root._faqirTagInput;

  const taglist = root.querySelector("[data-part='taglist']");
  const input = root.querySelector("[data-part='input']");
  const listbox = root.querySelector("[data-part='listbox']");
  const emptyEl = root.querySelector("[data-part='empty']");
  const valueEl = root.querySelector("[data-part='value']");
  const allowDuplicates = root.hasAttribute("data-allow-duplicates");

  const options = () =>
    listbox ? [...listbox.querySelectorAll("[data-part='option']")] : [];
  const visibleOptions = () => options().filter((o) => !o.hasAttribute("data-hidden"));

  let values = [];
  let highlightedIndex = -1;
  let outsideClickCleanup = null;

  // ── Chip rendering (reuses the chip primitive markup) ────────────────────────
  function makeChip(value) {
    const chip = document.createElement("span");
    chip.dataset.ui = "chip";
    chip.dataset.part = "tag";

    const label = document.createElement("span");
    label.dataset.part = "label";
    label.textContent = value;

    const dismiss = document.createElement("button");
    dismiss.dataset.part = "dismiss";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", `Remove ${value}`);
    dismiss.textContent = "×";

    chip.append(label, dismiss);
    return chip;
  }

  function readInitialTags() {
    if (!taglist) return [];
    return [...taglist.querySelectorAll("[data-part='tag'] [data-part='label']")].map(
      (l) => l.textContent.trim(),
    );
  }

  function isDuplicate(value) {
    const needle = value.toLowerCase();
    return values.some((v) => v.toLowerCase() === needle);
  }

  // ── value sync ───────────────────────────────────────────────────────────────
  function syncValueSeam() {
    if (!valueEl) return;
    const next = JSON.stringify(values);
    if (valueEl.value !== next) {
      valueEl.value = next;
      valueEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function emit(name, detail) {
    root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  function commitMutation(extraDetail) {
    syncValueSeam();
    emit("faqir:change", { value: values.slice(), ...extraDetail });
  }

  // ── add / remove ─────────────────────────────────────────────────────────────
  function addTag(raw) {
    const value = String(raw == null ? "" : raw).trim();
    if (!value) return false;
    if (!allowDuplicates && isDuplicate(value)) return false;

    values.push(value);
    if (taglist) {
      const chip = makeChip(value);
      if (input && input.parentNode === taglist) {
        taglist.insertBefore(chip, input);
      } else {
        taglist.appendChild(chip);
      }
    }
    commitMutation({ added: value });
    return true;
  }

  function removeTag(value) {
    const index = values.findIndex((v) => v === value);
    if (index < 0) return false;
    values.splice(index, 1);
    if (taglist) {
      const chip = [...taglist.querySelectorAll("[data-part='tag']")].find(
        (c) => c.querySelector("[data-part='label']")?.textContent.trim() === value,
      );
      chip?.remove();
    }
    commitMutation({ removed: value });
    return true;
  }

  function removeLast() {
    if (!values.length) return false;
    return removeTag(values[values.length - 1]);
  }

  function clear() {
    if (!values.length) return;
    values = [];
    if (taglist) {
      taglist.querySelectorAll("[data-part='tag']").forEach((c) => c.remove());
    }
    commitMutation({ cleared: true });
  }

  function getValue() {
    return values.slice();
  }

  function setValue(next) {
    const arr = Array.isArray(next) ? next : [];
    // Rebuild chips from scratch to mirror the requested value exactly.
    if (taglist) {
      taglist.querySelectorAll("[data-part='tag']").forEach((c) => c.remove());
    }
    values = [];
    for (const v of arr) {
      const value = String(v).trim();
      if (!value) continue;
      if (!allowDuplicates && isDuplicate(value)) continue;
      values.push(value);
      if (taglist) {
        const chip = makeChip(value);
        if (input && input.parentNode === taglist) taglist.insertBefore(chip, input);
        else taglist.appendChild(chip);
      }
    }
    commitMutation({ set: true });
  }

  // ── suggestions listbox (combobox behaviour) ─────────────────────────────────
  function openList() {
    if (!listbox) return;
    root.dataset.state = "open";
    listbox.hidden = false;
    input?.setAttribute("aria-expanded", "true");
    outsideClickCleanup = onOutsideClick(root, closeList);
  }

  function closeList() {
    if (!listbox) return;
    root.dataset.state = "closed";
    listbox.hidden = true;
    input?.setAttribute("aria-expanded", "false");
    clearHighlight();
    if (outsideClickCleanup) {
      outsideClickCleanup();
      outsideClickCleanup = null;
    }
  }

  /**
   * `aria-activedescendant`, for the same reason as `combobox`: the field
   * publishes `role="combobox"` + `aria-autocomplete="list"`, so it owes the
   * reader the name of the active suggestion. [W3-4]
   */
  function optionId(opt) {
    if (!opt.id) opt.id = uid("faqir-suggestion");
    return opt.id;
  }

  function setActiveDescendant(opt) {
    if (!input) return;
    if (opt) input.setAttribute("aria-activedescendant", optionId(opt));
    else input.removeAttribute("aria-activedescendant");
  }

  function clearHighlight() {
    options().forEach((o) => o.removeAttribute("data-highlighted"));
    setActiveDescendant(null);
    highlightedIndex = -1;
  }

  function highlight(index) {
    const vis = visibleOptions();
    if (!vis.length) return;
    if (index < 0) index = vis.length - 1;
    if (index >= vis.length) index = 0;
    options().forEach((o) => o.removeAttribute("data-highlighted"));
    vis[index].setAttribute("data-highlighted", "");
    vis[index].scrollIntoView?.({ block: "nearest" });
    setActiveDescendant(vis[index]);
    highlightedIndex = index;
  }

  function filterSuggestions(query) {
    const q = query.toLowerCase();
    let count = 0;
    options().forEach((o) => {
      const text = o.textContent.toLowerCase();
      const alreadyChosen = !allowDuplicates && isDuplicate(o.textContent.trim());
      if (text.includes(q) && !alreadyChosen) {
        o.removeAttribute("data-hidden");
        count++;
      } else {
        o.setAttribute("data-hidden", "");
      }
    });
    if (emptyEl) emptyEl.hidden = count > 0;
    clearHighlight();
    return count;
  }

  // ── event handlers ───────────────────────────────────────────────────────────
  function onInput() {
    if (!listbox) return;
    if (root.dataset.state !== "open") openList();
    filterSuggestions(input.value);
  }

  function onInputKeyDown(e) {
    switch (e.key) {
      case "Enter": {
        e.preventDefault();
        const vis = visibleOptions();
        if (listbox && highlightedIndex >= 0 && highlightedIndex < vis.length) {
          if (addTag(vis[highlightedIndex].textContent.trim())) {
            input.value = "";
            filterSuggestions("");
          }
        } else if (input.value.trim()) {
          if (addTag(input.value)) {
            input.value = "";
            if (listbox) filterSuggestions("");
          }
        }
        break;
      }
      case "Backspace":
        if (input.value === "") {
          e.preventDefault();
          removeLast();
          if (listbox) filterSuggestions("");
        }
        break;
      case "ArrowDown":
        if (listbox) {
          e.preventDefault();
          if (root.dataset.state !== "open") openList();
          highlight(highlightedIndex + 1);
        }
        break;
      case "ArrowUp":
        if (listbox) {
          e.preventDefault();
          if (root.dataset.state !== "open") openList();
          highlight(highlightedIndex - 1);
        }
        break;
      case "Escape":
        if (listbox && root.dataset.state === "open") {
          e.preventDefault();
          // The suggestion list is what closes; the form around it stays. [W3-2]
          e.stopPropagation();
          closeList();
        }
        break;
    }
  }

  function onTaglistClick(e) {
    const dismiss = e.target.closest("[data-part='dismiss']");
    if (!dismiss) return;
    const chip = dismiss.closest("[data-part='tag']");
    const value = chip?.querySelector("[data-part='label']")?.textContent.trim();
    if (value != null) {
      removeTag(value);
      input?.focus();
    }
  }

  function onListboxClick(e) {
    const opt = e.target.closest("[data-part='option']");
    if (!opt || opt.hasAttribute("data-hidden")) return;
    if (addTag(opt.textContent.trim())) {
      if (input) input.value = "";
      filterSuggestions("");
      input?.focus();
    }
  }

  // ── wire up ──────────────────────────────────────────────────────────────────
  values = readInitialTags();
  syncValueSeam();

  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", onInputKeyDown);
  taglist?.addEventListener("click", onTaglistClick);
  listbox?.addEventListener("click", onListboxClick);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    closeList();
    input?.removeEventListener("input", onInput);
    input?.removeEventListener("keydown", onInputKeyDown);
    taglist?.removeEventListener("click", onTaglistClick);
    listbox?.removeEventListener("click", onListboxClick);
    if (outsideClickCleanup) outsideClickCleanup();
    delete root._faqirTagInput;
  }

  const api = { getValue, setValue, addTag, removeTag, clear, destroy };
  root._faqirTagInput = api;
  return api;
}
    return createTagInput;
  })();

  // ── toast ── (registry/recipes/toast/toast.js)
  var createToastContainer = controllerRegistry["toast"] = (function() {
// @ui:controller toast
// @ui:provides add dismiss dismissAll destroy

function createToastContainer(root) {
  // Prevent double-init
  if (root._faqirToast) return root._faqirToast;

  const toasts = new Map();

  /**
   * Add a new toast to the container.
   *
   * `message`, `icon` and `actionLabel` are TEXT. They are written with
   * `textContent`, never `innerHTML`, because the overwhelmingly common call is
   * `add({ message: err.message })` or a message built from a name the server
   * echoed back — values the caller did not author. Markup in any of them is
   * inert, exactly as it is in `l-text` (see `docs/security.md` §4).
   *
   * `iconHtml` is the explicit opt-in for markup — an inline `<svg>` glyph is
   * the reason it exists. It is assigned to `innerHTML` verbatim and is
   * therefore an `l-html`-class surface: never pass a value you did not author.
   * When both are given, `iconHtml` wins.
   *
   * @param {Object} options
   * @param {string} options.message - Toast message text (escaped)
   * @param {string} [options.tone="default"] - default|success|error|warning
   * @param {string} [options.icon] - Icon TEXT (a glyph such as "★"); escaped
   * @param {string} [options.iconHtml] - Icon markup, written unescaped. Author-supplied only.
   * @param {string} [options.actionLabel] - Action button label (escaped)
   * @param {Function} [options.onAction] - Action button callback
   * @param {number} [options.duration=5000] - Auto-dismiss delay in ms (0 to disable)
   * @returns {string} toast id
   */
  function add(options = {}) {
    const {
      message = "",
      tone = "default",
      icon = "",
      iconHtml = "",
      actionLabel = "",
      onAction = null,
      duration = 5000,
    } = options;

    const id = uid("toast");
    const el = document.createElement("div");
    el.dataset.part = "toast";
    el.dataset.variant = tone;
    el.dataset.state = "entering";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    // Build inner content as NODES, not as a concatenated string. The same
    // pattern as file-upload.js and tag-input.js, and for the same reason:
    // every value below may come from outside the page's author.
    if (icon || iconHtml) {
      const iconEl = document.createElement("span");
      iconEl.dataset.part = "icon";
      iconEl.setAttribute("aria-hidden", "true");
      // Opt-in markup wins over the escaped text form; see the doc comment.
      if (iconHtml) iconEl.innerHTML = iconHtml;
      else iconEl.textContent = icon;
      el.appendChild(iconEl);
    }

    const messageEl = document.createElement("span");
    messageEl.dataset.part = "message";
    messageEl.textContent = message;
    el.appendChild(messageEl);

    if (actionLabel) {
      const action = document.createElement("button");
      action.dataset.part = "action";
      action.textContent = actionLabel;
      el.appendChild(action);
    }

    const close = document.createElement("button");
    close.dataset.part = "close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\u2715"; // ✕ — was `&#x2715;` in the old innerHTML string
    el.appendChild(close);

    root.appendChild(el);

    // Transition from entering to visible on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (el.dataset.state === "entering") {
          el.dataset.state = "visible";
        }
      });
    });

    register(el, id, { onAction, duration });

    return id;
  }

  /**
   * Bring one toast element under the controller: wire its close and action
   * buttons, start its auto-dismiss timer, and record it so `dismiss` can find
   * it. Shared by `add()` and by the adoption of authored toasts on init.
   */
  function register(el, id, { onAction = null, duration = 0 } = {}) {
    el.dataset.toastId = id;

    const closeBtn = el.querySelector("[data-part='close']");
    const onCloseClick = () => dismiss(id);
    closeBtn?.addEventListener("click", onCloseClick);

    const actionBtn = el.querySelector("[data-part='action']");
    const onActionClick = () => {
      if (onAction) onAction();
      dismiss(id);
    };
    if (actionBtn) {
      actionBtn.addEventListener("click", onActionClick);
    }

    let timer = null;
    if (duration > 0) {
      timer = setTimeout(() => dismiss(id), duration);
    }

    toasts.set(id, {
      el,
      timer,
      closeBtn,
      onCloseClick,
      actionBtn,
      onActionClick,
    });

    return id;
  }

  /**
   * Dismiss a toast by id with exit animation.
   * @param {string} id
   */
  function dismiss(id) {
    const entry = toasts.get(id);
    // Already exiting (close clicked while the timer fires, say): one exit wait.
    if (!entry || entry.cancelExitWait) return;

    const { el, timer, closeBtn, onCloseClick, actionBtn, onActionClick } = entry;

    if (timer) clearTimeout(timer);

    // Start exit animation
    el.dataset.state = "exiting";

    const onEnd = () => {
      closeBtn?.removeEventListener("click", onCloseClick);
      if (actionBtn) actionBtn.removeEventListener("click", onActionClick);
      el.remove();
      toasts.delete(id);
    };

    // The toast's own exit motion. Its close button and action button both
    // transition `background` on hover, and those events bubble up to the toast
    // element — a one-shot listener spent itself on the first of them and the
    // toast was ripped out mid-slide, or (when no further event came) left in
    // the stack forever. See `whenExitDone`. [W2-1]
    entry.cancelExitWait = whenExitDone(el, null, onEnd);
  }

  /**
   * Dismiss all toasts.
   */
  function dismissAll() {
    const ids = [...toasts.keys()];
    ids.forEach((id) => dismiss(id));
  }

  function destroy() {
    // Clear all toasts immediately without animation
    for (const [id, entry] of toasts) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.cancelExitWait) entry.cancelExitWait();
      entry.closeBtn?.removeEventListener("click", entry.onCloseClick);
      if (entry.actionBtn) entry.actionBtn.removeEventListener("click", entry.onActionClick);
      entry.el.remove();
    }
    toasts.clear();
    delete root._faqirToast;
  }

  // Adopt the toasts already in the markup.
  //
  // `add()` used to be the only way into the registry, so a toast written by
  // hand — the reference page's own stack, the manifest template, anything an
  // agent copies out of the docs — had a close button that was wired to
  // nothing. It looked right, it was in the a11y tree, it did nothing at all
  // when clicked, and nothing anywhere said so. [W2-1]
  for (const el of root.querySelectorAll("[data-part='toast']")) {
    if (el.dataset.toastId) continue;
    register(el, uid("toast"));
  }

  const api = { add, dismiss, dismissAll, destroy };
  root._faqirToast = api;
  return api;
}
    return createToastContainer;
  })();

  // ── toggle-group ── (registry/recipes/toggle-group/toggle-group.js)
  var createToggleGroup = controllerRegistry["toggle-group"] = (function() {
// @ui:controller toggle-group
// @ui:provides getValue setValue toggle destroy

/**
 * toggle-group — a single- or multi-select group of toggle buttons built on
 * NATIVE form controls so `l-model` works with zero engine changes:
 *
 *   • single mode → `[data-part="control"]` are `<input type="radio">`; the
 *     committed value is the checked radio's `value` (a string). `l-model` on
 *     the radios two-way-binds a string through the engine's native radio path.
 *   • multi mode → the controls are `<input type="checkbox">`; the value is the
 *     array of checked `value`s. `l-model` binds an array through the engine's
 *     native checkbox-array path.
 *
 * The visible "buttons" are the `[data-part="item"]` labels; the native input
 * is visually hidden (see the CSS) but remains the accessible, focusable
 * control, so the ARIA is the real radio/checkbox semantics of the platform.
 *
 * The controller owns only what CSS and the platform cannot: **roving
 * tabindex** (Arrow/Home/End move a single tab-stop across the group, with
 * focus-follows-selection in single mode per the radiogroup convention),
 * keyboard toggling that is synthetic-event-safe (Space/Enter), single-mode
 * exclusivity when the controls are used standalone (no `l-model`), the
 * `[data-state]` styling hook, and a `faqir:change` notification.
 *
 * Every user mutation funnels through a native `change` event on the affected
 * input, so the engine's `l-model` listener and this controller stay in lockstep.
 * Store-driven `l-model` writes arrive as the engine's `faqir:model` event (and
 * a form `reset`); both re-sync state without a `faqir:change`. A `:checked`
 * binding is followed too: it writes the `checked` attribute, which a
 * MutationObserver sees (on an untouched control that attribute write flips the
 * property by itself, so no `faqir:model` follows it). A plain script write of
 * the property (`input.checked = x`) is silent and is not observed — use
 * `setValue()`. The CSS keys the pressed look on `:checked` as well, so a
 * stale `data-state` never misdraws the group.
 */
function createToggleGroup(root) {
  // Prevent double-init.
  if (root._faqirToggleGroup) return root._faqirToggleGroup;

  const mode = root.dataset.mode === "multi" ? "multi" : "single";
  const controls = () => [...root.querySelectorAll("[data-part='control']")];
  const enabled = () => controls().filter((el) => !el.disabled);

  // ── value ──────────────────────────────────────────────────────────────────
  function getValue() {
    const checked = controls()
      .filter((el) => el.checked)
      .map((el) => el.value);
    return mode === "multi" ? checked : (checked.length ? checked[0] : null);
  }

  function setValue(val) {
    const cs = controls();
    if (mode === "multi") {
      const set = new Set(Array.isArray(val) ? val : val == null ? [] : [val]);
      cs.forEach((el) => {
        el.checked = set.has(el.value);
      });
    } else {
      cs.forEach((el) => {
        el.checked = el.value === val;
      });
    }
    syncState();
  }

  // ── state reflection + roving tabindex ───────────────────────────────────────
  function checkedIndex() {
    return controls().findIndex((el) => el.checked);
  }

  function tabStopIndex() {
    // The tab-stop follows the checked control; falling back to the first
    // enabled one so the group is always reachable by Tab.
    const checked = checkedIndex();
    if (checked >= 0 && !controls()[checked].disabled) return checked;
    const first = controls().findIndex((el) => !el.disabled);
    return first >= 0 ? first : 0;
  }

  function syncState() {
    const stop = tabStopIndex();
    controls().forEach((el, i) => {
      el.tabIndex = i === stop ? 0 : -1;
      const item = el.closest("[data-part='item']") || el;
      item.dataset.state = el.checked ? "on" : "off";
    });
  }

  function emitChange() {
    root.dispatchEvent(
      new CustomEvent("faqir:change", {
        bubbles: true,
        detail: { value: getValue(), mode },
      }),
    );
  }

  // The single mutation seam: enforce single-mode exclusivity (needed when the
  // group is used without l-model), reflect state, then notify.
  function onChange(e) {
    const el = e.target.closest("[data-part='control']");
    if (!el || !root.contains(el)) return;
    if (mode === "single" && el.checked) {
      controls().forEach((o) => {
        if (o !== el) o.checked = false;
      });
    }
    syncState();
    emitChange();
  }

  // ── keyboard ─────────────────────────────────────────────────────────────────
  function moveFocus(fromIndex, delta) {
    const list = enabled();
    if (!list.length) return;
    const all = controls();
    // Map the absolute index onto the enabled subset, then step.
    let pos = list.indexOf(all[fromIndex]);
    if (pos < 0) pos = 0;
    const next = ((pos + delta) % list.length + list.length) % list.length;
    focusControl(all.indexOf(list[next]));
  }

  function focusControl(index) {
    const cs = controls();
    const el = cs[index];
    if (!el) return;
    cs.forEach((o, i) => {
      o.tabIndex = i === index ? 0 : -1;
    });
    el.focus();
    // radiogroup convention: in single mode, moving focus selects.
    if (mode === "single") select(el);
  }

  function jumpFocus(edge) {
    const list = enabled();
    if (!list.length) return;
    focusControl(controls().indexOf(edge === "first" ? list[0] : list[list.length - 1]));
  }

  // Toggle/select via a dispatched native change, so l-model and onChange run.
  function select(el) {
    if (el.disabled) return;
    if (mode === "multi") {
      el.checked = !el.checked;
    } else {
      el.checked = true;
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function onKeyDown(e) {
    const cs = controls();
    const active = cs.indexOf(document.activeElement);
    const from = active >= 0 ? active : tabStopIndex();
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveFocus(from, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveFocus(from, -1);
        break;
      case "Home":
        e.preventDefault();
        jumpFocus("first");
        break;
      case "End":
        e.preventDefault();
        jumpFocus("last");
        break;
      case " ":
      case "Enter":
        // Drive the toggle ourselves so synthetic events (tests) behave like
        // real ones and l-model always sees a change event.
        if (active >= 0) {
          e.preventDefault();
          select(cs[active]);
        }
        break;
    }
  }

  // Public toggle by value (imperative API).
  function toggle(value) {
    const el = controls().find((c) => c.value === value);
    if (el) select(el);
  }

  // A store-driven `l-model` write sets `.checked` silently and announces it
  // with `faqir:model`; follow it without re-emitting `faqir:change` (the user
  // did not act). A form reset restores defaults silently the same way.
  const form = root.closest("form");
  const onReset = () => setTimeout(syncState, 0);

  // A `:checked` binding writes the ATTRIBUTE before the property, and on a
  // control the user has not touched that attribute write flips the property
  // too — so the property write after it changes nothing and announces nothing.
  // Watch the attribute itself. syncState writes only tabindex and data-state,
  // which this filter ignores, so it cannot feed back into itself.
  const observer = new MutationObserver(syncState);
  observer.observe(root, { subtree: true, attributeFilter: ["checked"] });

  root.addEventListener("change", onChange);
  root.addEventListener("faqir:model", syncState);
  root.addEventListener("keydown", onKeyDown);
  if (form) form.addEventListener("reset", onReset);
  syncState();

  function destroy() {
    observer.disconnect();
    root.removeEventListener("change", onChange);
    root.removeEventListener("faqir:model", syncState);
    root.removeEventListener("keydown", onKeyDown);
    if (form) form.removeEventListener("reset", onReset);
    delete root._faqirToggleGroup;
  }

  const api = { getValue, setValue, toggle, destroy };
  root._faqirToggleGroup = api;
  return api;
}
    return createToggleGroup;
  })();

  // ── tooltip ── (registry/recipes/tooltip/tooltip.js)
  var createTooltip = controllerRegistry["tooltip"] = (function() {
// @ui:controller tooltip
// @ui:provides show hide destroy

function createTooltip(root) {
  // Prevent double-init
  if (root._faqirTooltip) return root._faqirTooltip;

  const trigger = root.querySelector("[data-part='trigger']");
  // Not the content of a collapsible or popover used as the trigger.
  const [content] = ownParts(root, "content");

  let showTimer = null;
  let hideTimer = null;

  function show() {
    clearTimeout(hideTimer);
    hideTimer = null;
    root.dataset.state = "visible";
    content.hidden = false;
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    root.dataset.state = "hidden";
    content.hidden = true;
  }

  function scheduleShow() {
    clearTimeout(hideTimer);
    hideTimer = null;
    showTimer = setTimeout(show, 200);
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    showTimer = null;
    hideTimer = setTimeout(hide, 100);
  }

  function onMouseEnter() {
    scheduleShow();
  }

  function onMouseLeave() {
    scheduleHide();
  }

  function onFocusIn() {
    scheduleShow();
  }

  function onFocusOut() {
    scheduleHide();
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && root.dataset.state === "visible") {
      e.stopPropagation();
      hide();
    }
  }

  trigger?.addEventListener("mouseenter", onMouseEnter);
  trigger?.addEventListener("mouseleave", onMouseLeave);
  trigger?.addEventListener("focusin", onFocusIn);
  trigger?.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeyDown);

  function destroy() {
    // Leaving a destroyed overlay open leaves a dead one: nothing is listening
    // any more, so its close button, Escape and overlay click all do nothing.
    // `context-menu` is the model — it has always closed itself here. [W3-2]
    hide();
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    trigger?.removeEventListener("mouseenter", onMouseEnter);
    trigger?.removeEventListener("mouseleave", onMouseLeave);
    trigger?.removeEventListener("focusin", onFocusIn);
    trigger?.removeEventListener("focusout", onFocusOut);
    root.removeEventListener("keydown", onKeyDown);
    delete root._faqirTooltip;
  }

  const api = { show, hide, destroy };
  root._faqirTooltip = api;
  return api;
}
    return createTooltip;
  })();

  // ── tree-view ── (registry/recipes/tree-view/tree-view.js)
  var createTreeView = controllerRegistry["tree-view"] = (function() {
// @ui:controller tree-view
// @ui:provides select expand collapse toggle refresh getSelected destroy

/**
 * Single-select WAI-ARIA tree view with roving DOM focus.
 *
 * Item queries are deliberately live. A tree root can be initialized before
 * keyed l-for templates render their nodes, and later reconciliations can move,
 * insert, or remove whole branches without recreating the controller.
 */
function createTreeView(root) {
  if (root._faqirTreeView) {
    root._faqirTreeView.refresh();
    return root._faqirTreeView;
  }

  let currentItem = null;
  let selectedItem = null;
  let typeahead = "";
  let typeaheadTimer = null;

  function belongsToTree(element) {
    return element?.closest("[data-ui='tree-view']") === root;
  }

  function items() {
    return [...root.querySelectorAll("[data-part='item']")]
      .filter(belongsToTree);
  }

  function groups() {
    return [...root.querySelectorAll("[data-part='group']")]
      .filter(belongsToTree);
  }

  function directItems(container) {
    return [...container.children]
      .filter((child) => child.matches("[data-part='item']") && belongsToTree(child));
  }

  function directGroup(item) {
    return [...item.children].find(
      (child) => child.matches("[data-part='group']") && belongsToTree(child),
    ) ?? null;
  }

  function parentItem(item) {
    const group = item.parentElement?.closest("[data-part='group']");
    if (!group || !belongsToTree(group)) return null;
    const parent = group.parentElement;
    return parent?.matches("[data-part='item']") && belongsToTree(parent)
      ? parent
      : null;
  }

  function isDisabled(item) {
    return item?.getAttribute("aria-disabled") === "true";
  }

  function isLazy(item) {
    return item?.hasAttribute("data-lazy") && item.dataset.lazy !== "false";
  }

  function isExpandable(item) {
    return Boolean(
      item &&
      (directGroup(item) || item.hasAttribute("aria-expanded") || isLazy(item)),
    );
  }

  function isVisible(item) {
    if (!item || item.hidden || !belongsToTree(item)) return false;

    let ancestor = item.parentElement;
    while (ancestor && ancestor !== root) {
      if (ancestor.hidden) return false;
      if (ancestor.matches("[data-part='group']")) {
        const parent = ancestor.parentElement;
        if (
          parent?.matches("[data-part='item']") &&
          parent.getAttribute("aria-expanded") !== "true"
        ) {
          return false;
        }
      }
      ancestor = ancestor.parentElement;
    }
    return true;
  }

  function visibleItems() {
    return items().filter((item) => isVisible(item) && !isDisabled(item));
  }

  function syncParentState(item) {
    if (item.hasAttribute("aria-expanded")) {
      item.dataset.state = item.getAttribute("aria-expanded") === "true"
        ? "expanded"
        : "collapsed";
    } else if (
      item.dataset.state === "expanded" ||
      item.dataset.state === "collapsed"
    ) {
      item.removeAttribute("data-state");
    }
  }

  function normalizeBranch(container, level) {
    const siblings = directItems(container);
    const setSize = String(siblings.length);

    siblings.forEach((item, index) => {
      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-level", String(level));
      item.setAttribute("aria-setsize", setSize);
      item.setAttribute("aria-posinset", String(index + 1));

      const group = directGroup(item);
      if (group) {
        group.setAttribute("role", "group");
        const expanded = item.hasAttribute("aria-expanded")
          ? item.getAttribute("aria-expanded") === "true"
          : !group.hidden;
        item.setAttribute("aria-expanded", String(expanded));
        group.hidden = !expanded;
        syncParentState(item);
        normalizeBranch(group, level + 1);
      } else if (isLazy(item) || item.hasAttribute("aria-expanded")) {
        if (!item.hasAttribute("aria-expanded")) {
          item.setAttribute("aria-expanded", "false");
        }
        syncParentState(item);
      } else {
        item.removeAttribute("aria-expanded");
        syncParentState(item);
      }
    });
  }

  function refresh() {
    root.setAttribute("role", "tree");
    root.setAttribute("aria-multiselectable", "false");

    const before = items();
    const authoredTabStop = before.find(
      (item) => item.tabIndex === 0 && !isDisabled(item),
    ) ?? null;

    groups().forEach((group) => group.setAttribute("role", "group"));
    normalizeBranch(root, 1);

    const allItems = items();
    const selected = allItems.filter(
      (item) => !isDisabled(item) && item.getAttribute("aria-selected") === "true",
    );
    const keepSelected = selected.includes(selectedItem)
      ? selectedItem
      : selected[0] ?? null;

    for (const item of allItems) {
      if (isDisabled(item)) {
        item.removeAttribute("aria-selected");
      } else {
        item.setAttribute("aria-selected", item === keepSelected ? "true" : "false");
      }
    }
    selectedItem = keepSelected;

    const active = document.activeElement?.closest?.("[data-part='item']");
    const candidates = [currentItem, active, selectedItem, authoredTabStop];
    currentItem = candidates.find(
      (item) => allItems.includes(item) && isVisible(item) && !isDisabled(item),
    ) ?? visibleItems()[0] ?? null;

    for (const item of allItems) {
      item.tabIndex = item === currentItem ? 0 : -1;
    }

    root.dataset.state = selectedItem ? "selected" : "idle";
    return allItems;
  }

  function resolveItem(target) {
    const allItems = items();
    if (target?.matches?.("[data-part='item']")) {
      return allItems.includes(target) ? target : null;
    }
    if (typeof target === "number") return allItems[target] ?? null;
    if (typeof target === "string") {
      return allItems.find(
        (item) => item.dataset.value === target || item.id === target,
      ) ?? null;
    }
    return null;
  }

  function itemLabel(item) {
    const label = item.querySelector("[data-part='label']");
    if (label) {
      const readable = label.cloneNode(true);
      readable.querySelectorAll("[aria-hidden='true']").forEach((node) => node.remove());
      return readable.textContent.trim();
    }
    return (item.dataset.value ?? item.id ?? "").trim();
  }

  function itemValue(item) {
    return item.dataset.value || item.id || itemLabel(item);
  }

  function emit(type, detail) {
    root.dispatchEvent(
      new CustomEvent("faqir:" + type, { bubbles: true, detail }),
    );
  }

  function focusItem(target) {
    const item = resolveItem(target);
    if (!item || isDisabled(item) || !isVisible(item)) return false;

    currentItem = item;
    for (const candidate of items()) {
      candidate.tabIndex = candidate === item ? 0 : -1;
    }
    item.focus();
    item.scrollIntoView?.({ block: "nearest" });
    return true;
  }

  function select(target) {
    refresh();
    const item = resolveItem(target);
    if (!item || isDisabled(item)) return false;

    const previousItem = selectedItem;
    for (const candidate of items()) {
      if (!isDisabled(candidate)) {
        candidate.setAttribute("aria-selected", candidate === item ? "true" : "false");
      }
    }

    selectedItem = item;
    currentItem = item;
    for (const candidate of items()) {
      candidate.tabIndex = candidate === item ? 0 : -1;
    }
    root.dataset.state = "selected";

    emit("select", {
      item,
      value: itemValue(item),
      label: itemLabel(item),
      previousItem,
      previousValue: previousItem ? itemValue(previousItem) : null,
    });
    return true;
  }

  function setExpanded(target, expanded) {
    refresh();
    const item = resolveItem(target);
    if (!item || isDisabled(item) || !isExpandable(item)) return false;

    const next = Boolean(expanded);
    const changed = item.getAttribute("aria-expanded") !== String(next);
    item.setAttribute("aria-expanded", String(next));
    const group = directGroup(item);
    if (group) group.hidden = !next;
    syncParentState(item);
    refresh();

    if (changed) {
      emit("expand", {
        item,
        value: itemValue(item),
        label: itemLabel(item),
        expanded: next,
        lazy: isLazy(item) && !group,
      });
    }
    return true;
  }

  function expand(target) {
    return setExpanded(target, true);
  }

  function collapse(target) {
    return setExpanded(target, false);
  }

  function toggle(target) {
    refresh();
    const item = resolveItem(target);
    if (!item || !isExpandable(item)) return false;
    return setExpanded(item, item.getAttribute("aria-expanded") !== "true");
  }

  function getSelected() {
    refresh();
    return selectedItem;
  }

  function move(item, delta) {
    const visible = visibleItems();
    const index = visible.indexOf(item);
    if (index === -1) return false;
    const nextIndex = Math.min(Math.max(index + delta, 0), visible.length - 1);
    return nextIndex === index ? false : focusItem(visible[nextIndex]);
  }

  function enabledParent(item) {
    let parent = parentItem(item);
    while (parent && isDisabled(parent)) parent = parentItem(parent);
    return parent;
  }

  function handleTypeahead(item, key) {
    typeahead += key.toLocaleLowerCase();
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => {
      typeahead = "";
      typeaheadTimer = null;
    }, 500);

    const query = [...typeahead].every((character) => character === typeahead[0])
      ? typeahead[0]
      : typeahead;
    const visible = visibleItems();
    if (visible.length === 0) return false;
    const start = Math.max(visible.indexOf(item), -1);

    for (let offset = 1; offset <= visible.length; offset++) {
      const candidate = visible[(start + offset) % visible.length];
      if (itemLabel(candidate).toLocaleLowerCase().startsWith(query)) {
        return focusItem(candidate);
      }
    }
    return false;
  }

  function onKeyDown(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[data-part='item']");
    if (!item || !belongsToTree(item) || isDisabled(item)) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(item, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(item, -1);
        break;
      case "Home": {
        event.preventDefault();
        const first = visibleItems()[0];
        if (first) focusItem(first);
        break;
      }
      case "End": {
        event.preventDefault();
        const visible = visibleItems();
        if (visible.length > 0) focusItem(visible[visible.length - 1]);
        break;
      }
      case "ArrowRight": {
        event.preventDefault();
        if (!isExpandable(item)) break;
        if (item.getAttribute("aria-expanded") !== "true") {
          expand(item);
          break;
        }
        const child = directGroup(item)
          ? directItems(directGroup(item)).find((candidate) => !isDisabled(candidate))
          : null;
        if (child) focusItem(child);
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (isExpandable(item) && item.getAttribute("aria-expanded") === "true") {
          collapse(item);
          break;
        }
        const parent = enabledParent(item);
        if (parent) focusItem(parent);
        break;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        select(item);
        break;
      case "*": {
        event.preventDefault();
        const container = item.parentElement;
        if (!container) break;
        for (const sibling of directItems(container)) {
          if (!isDisabled(sibling) && isExpandable(sibling)) expand(sibling);
        }
        break;
      }
      default:
        if (
          event.key.length === 1 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          if (handleTypeahead(item, event.key)) event.preventDefault();
        }
    }
  }

  function onClick(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[data-part='item']");
    if (!item || !belongsToTree(item)) return;
    if (isDisabled(item)) {
      event.preventDefault();
      return;
    }

    focusItem(item);
    const togglePart = event.target.closest("[data-part='toggle']");
    if (togglePart && togglePart.closest("[data-part='item']") === item) {
      event.preventDefault();
      toggle(item);
    } else {
      select(item);
    }
  }

  function onFocusIn(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[data-part='item']");
    if (!item || !belongsToTree(item) || isDisabled(item)) return;

    currentItem = item;
    for (const candidate of items()) {
      candidate.tabIndex = candidate === item ? 0 : -1;
    }
  }

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("click", onClick);
  root.addEventListener("focusin", onFocusIn);

  function onMutation() {
    refresh();
  }

  const observer = new MutationObserver(onMutation);
  observer.observe(root, { childList: true, subtree: true });

  function destroy() {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("click", onClick);
    root.removeEventListener("focusin", onFocusIn);
    observer.disconnect();
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    delete root._faqirTreeView;
  }

  const api = {
    select,
    expand,
    collapse,
    toggle,
    refresh,
    getSelected,
    destroy,
  };
  root._faqirTreeView = api;
  refresh();
  return api;
}
    return createTreeView;
  })();

  // ═══════════════════════════════════════════════════════
  // Section 8: Global API
  // ═══════════════════════════════════════════════════════

  var customMagics = new Map();

  function findParentScope(el) {
    var parent = el.parentElement;
    while (parent) {
      if (parent.__faqirScope) return parent.__faqirScope;
      parent = parent.parentElement;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════
  // Section 8.5: Inspection & Devtools  [task 0.7-12]
  // ═══════════════════════════════════════════════════════
  //
  // `Faqir.inspect(el)` answers "what is Faqir doing to this element?" in one
  // plain object. It ships in BOTH builds — it is the documented surface an
  // agent (or the `faqir dev` overlay) reads, not a debug-only extra. The same
  // functions hang off `window.__FAQIR_DEVTOOLS__`; see docs/devtools.md for the
  // stable shape.

  // Depth cap for scope snapshots — deeper values collapse to a marker rather
  // than walking an unbounded object graph.
  var SNAPSHOT_MAX_DEPTH = 4;

  /** One value, deep-copied into something plain, finite and printable. */
  function snapshotValue(value, stack, depth) {
    if (typeof value === 'function') {
      // Scope methods are bound [1.1F-05]; report the name the author wrote.
      var name = String(value.name || '').replace(/^bound /, '');
      return '[Function' + (name ? ' ' + name : '') + ']';
    }
    if (value === null || typeof value !== 'object') return value;
    if (value.nodeType === 1 && value.tagName) {
      return '[Element <' + value.tagName.toLowerCase() + '>]';
    }
    if (value instanceof Date) return value.toISOString();
    if (stack.indexOf(value) !== -1) return '[Circular]';
    if (depth >= SNAPSHOT_MAX_DEPTH) return '[Depth]';

    stack.push(value);
    var out;
    if (Array.isArray(value)) {
      out = [];
      for (var i = 0; i < value.length; i++) out.push(snapshotValue(value[i], stack, depth + 1));
    } else {
      out = {};
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) {
        out[keys[k]] = snapshotValue(value[keys[k]], stack, depth + 1);
      }
    }
    stack.pop();
    return out;
  }

  /**
   * Plain snapshot of a scope's DATA. Magics ($el, $refs, $store, …) are
   * non-enumerable by construction, so they never appear — a snapshot is what
   * the author put in `l-data` plus `data-prop-*`, as it stands right now.
   * Reading happens outside any effect, so it registers no dependencies.
   */
  function snapshotScope(scope) {
    if (!scope) return null;
    var out = {};
    var keys = Object.keys(scope);
    for (var i = 0; i < keys.length; i++) {
      // `__`-prefixed keys are engine plumbing (`__faqirTeardown`), not data an
      // agent inspecting the page should have to reason about.
      if (keys[i].slice(0, 2) === '__') continue;
      out[keys[i]] = snapshotValue(scope[keys[i]], [], 0);
    }
    return out;
  }

  /** Short human label for an element: `div#cart[data-ui="card"]`. */
  function describeElement(el) {
    if (!el) return null;
    var label = el.tagName ? el.tagName.toLowerCase() : String(el);
    if (el.id) label += '#' + el.id;
    var ui = el.getAttribute ? el.getAttribute('data-ui') : null;
    if (ui) label += '[data-ui="' + ui + '"]';
    var part = el.getAttribute ? el.getAttribute('data-part') : null;
    if (part) label += '[data-part="' + part + '"]';
    return label;
  }

  /** The nearest ancestor-or-self carrying a live scope, or null. */
  function ownScopeRoot(el) {
    for (var node = el; node; node = node.parentElement) {
      if (node.__faqirScope) return node;
    }
    return null;
  }

  /** The five protocol attributes as they read from `el` / its `[data-ui]`. */
  function protocolState(el, uiEl) {
    var attr = function(node, name) {
      return node && node.getAttribute ? node.getAttribute(name) : null;
    };
    return {
      ui: attr(uiEl, 'data-ui'),
      part: attr(el, 'data-part'),
      variant: attr(uiEl, 'data-variant'),
      size: attr(uiEl, 'data-size'),
      state: attr(uiEl, 'data-state')
    };
  }

  /**
   * Everything Faqir knows about one element.  [task 0.7-12 · §A6]
   *
   * @param {Element|string} target element, or a selector resolved against document
   * @returns {null|{
   *   el: Element,
   *   scopeRoot: Element|null,
   *   scopeId: number|null,
   *   scope: object|null,
   *   directives: {type,arg,expression,modifiers,raw}[],
   *   controller: {ui,el,api,methods}|null,
   *   state: {ui,part,variant,size,state}
   * }}
   */
  function inspect(target) {
    var el = target;
    if (typeof target === 'string') {
      el = typeof document !== 'undefined' ? document.querySelector(target) : null;
    }
    if (!el || el.nodeType !== 1) return null;

    var root = ownScopeRoot(el);
    var uiEl = closestUI(el);
    var api = uiEl ? getControllerApi(uiEl) : null;

    var directives = parseDirectives(el).map(function(d) {
      return {
        type: d.type,
        arg: d.arg == null ? null : d.arg,
        expression: d.expression,
        modifiers: d.modifiers ? d.modifiers.slice() : [],
        raw: d.raw
      };
    });

    return {
      el: el,
      scopeRoot: root,
      scopeId: root && root.__scopeId != null ? root.__scopeId : null,
      scope: root ? snapshotScope(root.__faqirScope) : null,
      directives: directives,
      controller: uiEl && api
        ? {
            ui: uiEl.getAttribute('data-ui'),
            el: uiEl,
            api: api,
            methods: Object.keys(api).filter(function(k) {
              return typeof api[k] === 'function';
            }).sort()
          }
        : null,
      state: protocolState(el, uiEl)
    };
  }

  /**
   * `window.__FAQIR_DEVTOOLS__` — the stable handle agents and the `faqir dev`
   * overlay read. Keys never change shape between builds; only `dev` flips.
   */
  var devtools = {
    /** Handle schema version. Bumped only on a breaking shape change. */
    version: 1,
    /** true in `faqir-core.dev.js`, false in the production engine. */
    dev: false,
    /** The Faqir global itself (assigned once the public API is built). */
    faqir: null,
    inspect: inspect,
    /**
     * Declared scope roots in document order: elements with `l-data` (or a
     * standalone `[data-ui]`) that carry a live scope. Per-item scopes made by
     * `l-for`/`l-if` are reachable with `inspect()` on any node inside them.
     */
    scopes: function(within) {
      var host = within || (typeof document !== 'undefined' ? document : null);
      if (!host) return [];
      var els = [].slice.call(host.querySelectorAll('[l-data], [data-ui]'));
      var out = [];
      for (var i = 0; i < els.length; i++) {
        if (!els[i].__faqirScope) continue;
        out.push({
          el: els[i],
          id: els[i].__scopeId != null ? els[i].__scopeId : null,
          label: describeElement(els[i]),
          scope: snapshotScope(els[i].__faqirScope)
        });
      }
      return out;
    },
    /** Every mounted component, with its protocol attributes and its parts. */
    components: function(within) {
      var host = within || (typeof document !== 'undefined' ? document : null);
      if (!host) return [];
      var els = [].slice.call(host.querySelectorAll('[data-ui]'));
      var out = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var partEls = [].slice.call(el.querySelectorAll('[data-part]'));
        var parts = [];
        for (var p = 0; p < partEls.length; p++) {
          if (partEls[p].closest('[data-ui]') !== el) continue;
          var name = partEls[p].getAttribute('data-part');
          if (parts.indexOf(name) === -1) parts.push(name);
        }
        out.push({
          el: el,
          label: describeElement(el),
          ui: el.getAttribute('data-ui'),
          variant: el.getAttribute('data-variant'),
          size: el.getAttribute('data-size'),
          state: el.getAttribute('data-state'),
          parts: parts.sort(),
          controller: !!getControllerApi(el)
        });
      }
      return out;
    },
    /** Snapshot of every `Faqir.store()` registered on the page. */
    stores: function() {
      var out = {};
      var names = Object.keys(globalStores);
      for (var i = 0; i < names.length; i++) {
        out[names[i]] = snapshotValue(globalStores[names[i]], [], 0);
      }
      return out;
    },
    /**
     * Diagnostics recorded so far, oldest first. Always an array: the
     * production engine records nothing, so it is always empty there.
     */
    warnings: function() { return devHooks ? devHooks.warnings() : []; },
    /**
     * Record one diagnostic on a plugin's behalf. The dev build prints it and
     * keeps it in `warnings()` (deduped like every other); production does
     * nothing and answers `false`. A plugin is a separate file with no reach
     * into this seam's other side, so without it a plugin can only be silent
     * or noisy in a shipped page — and "silent" is what the contract forbids.
     * [1.1B-03]
     */
    report: function(message, el) {
      return false;
    }
  };



  // ═══════════════════════════════════════════════════════
  // Section 9: Bootstrap & Auto-init
  // ═══════════════════════════════════════════════════════

  // Mount one controller, containing any failure to that component.
  //
  // Controllers are invoked in a bare loop during bootstrap. A controller that
  // throws — the usual cause is markup missing a part it queries for, which an
  // agent generating HTML produces routinely — used to abort bootstrap entirely:
  // no scopes, no directives, no Faqir global, every unrelated island on the page
  // left blank. One incomplete component must break that component and nothing
  // else, and the failure has to be visible rather than silent.
  function initController(name, el) {
    try {
      controllerRegistry[name](el);
    } catch (err) {
      console.error('[Faqir] Controller "' + name + '" failed to initialize', el, err);
    }
  }

  // Every controller inside `root` (a document or an element), `root` included.
  // Controllers are double-init guarded, so a second call is a no-op.
  function startControllers(root) {
    var own = root.getAttribute && root.getAttribute('data-ui');
    if (own && controllerRegistry[own]) initController(own, root);
    var names = Object.keys(controllerRegistry);
    for (var n = 0; n < names.length; n++) {
      var els = root.querySelectorAll('[data-ui="' + names[n] + '"]');
      for (var e = 0; e < els.length; e++) initController(names[n], els[e]);
    }
  }

  // `Faqir.initTree` — the same order bootstrap uses: a connected subtree's
  // controllers start first, so its `l-init` / first `l-effect` reach them
  // through `$ui`. A detached subtree's controllers wait for the
  // MutationObserver, as before. [1.1F-03]
  function publicInitTree(root, parentScope) {
    if (root.isConnected) startControllers(root);
    initTree(root, parentScope);
  }

  // The document's one MutationObserver, or null before the first bootstrap,
  // and the <body> it is currently watching.
  var mutationObserver = null;
  var observedBody = null;

  function bootstrap() {
    // Auto-init controllers for all [data-ui] elements
    startControllers(document);

    // Find all scope roots.
    // l-data elements always create a scope.
    // data-ui elements only create a scope when standalone (no l-data ancestor).
    var roots = document.querySelectorAll('[l-data], [data-ui]');
    var processed = new Set();

    for (var r = 0; r < roots.length; r++) {
      var rootEl = roots[r];
      if (processed.has(rootEl)) continue;

      // Already initialized — by an earlier `Faqir.start()`, or by the
      // MutationObserver. Re-running `initTree` over it would build a second
      // scope and apply every directive on top of the first: `start()` twice
      // meant every `@click` handler fired twice, every `l-effect` ran twice
      // and every `l-source` fetched twice. Markup added since the last call
      // still has no scope, so it is still picked up — which is the only reason
      // to call `start()` again. [W3-1]
      if (rootEl.__faqirScope) {
        processed.add(rootEl);
        var seen = rootEl.querySelectorAll('[l-data], [data-ui]');
        for (var sd = 0; sd < seen.length; sd++) processed.add(seen[sd]);
        continue;
      }

      // Skip if nested inside an unprocessed ancestor l-data scope
      var ancestor = rootEl.parentElement;
      var skipThis = false;
      while (ancestor) {
        if (ancestor.hasAttribute('l-data') && !processed.has(ancestor)) {
          skipThis = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      // data-ui elements without l-data only need a scope if they are standalone
      // (not inside any l-data). If inside an l-data, they inherit that scope via walkChildren.
      if (!skipThis && !rootEl.hasAttribute('l-data') && rootEl.hasAttribute('data-ui')) {
        // Check if this data-ui is inside a processed l-data scope — if so, skip
        var lDataAncestor = rootEl.parentElement;
        while (lDataAncestor) {
          if (lDataAncestor.hasAttribute('l-data') && processed.has(lDataAncestor)) {
            skipThis = true;
            break;
          }
          lDataAncestor = lDataAncestor.parentElement;
        }
      }

      if (!skipThis) {
        initTree(rootEl, null);
        // `initTree` walked the whole subtree, so every root candidate inside it
        // — nested `[l-data]` scopes AND nested `[data-ui]` components — is
        // bound already. Claiming only the `[l-data]` ones left a `[data-ui]`
        // inside a standalone `[data-ui]` looking standalone too: it became a
        // root of its own and re-bound its subtree, so a button four components
        // deep fired its `@click` four times.
        var descendants = rootEl.querySelectorAll('[l-data], [data-ui]');
        for (var d = 0; d < descendants.length; d++) processed.add(descendants[d]);
        processed.add(rootEl);
      }
    }

    // Everything the scope-root pass did not claim. [W2-1]
    walkUnscoped(document.body, getStrayScope());

    // Second controller sweep: structural directives (l-for / l-if) may have
    // rendered recipe markup synchronously during the initTree pass above —
    // after the first sweep ran and before the MutationObserver below starts.
    // Controllers are double-init guarded, so re-invoking is a no-op for
    // elements initialized by the first sweep.
    startControllers(document);

    removeCloaks();

    // MutationObserver for dynamically added elements. ONE per document: a
    // second `Faqir.start()` used to install another, and every observer then
    // initialized every added node again — the same handler running twice per
    // insertion, which is how one `Faqir.start()` too many double-fired
    // everything on the page. Re-observed only if `document.body` itself was
    // replaced, which is what a test harness swapping bodies does. [W3-1]
    if (mutationObserver && observedBody === document.body) return;
    if (mutationObserver) {
      observedBody = document.body;
      mutationObserver.observe(document.body, { childList: true, subtree: true });
      return;
    }
    observedBody = document.body;

    mutationObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j];
          if (node.nodeType !== 1) continue;

          // Content that arrives after bootstrap has already bound by the time
          // it is here; leaving `l-cloak` on it means the cloak rule hides it
          // forever. [W3-1]
          removeCloaks(node);

          // Controllers first — the node's own and every one inside it — so
          // the `l-init` / first `l-effect` that `initTree` runs below reach
          // them through `$ui`. They used to start after it. [1.1F-03]
          startControllers(node);

          // Already initialized — by `Faqir.start()` / `Faqir.initTree()` in the
          // same task that inserted it (the record is only delivered on the
          // next microtask), or by the l-for / l-if render that stamped it.
          // Re-running `initTree` would build a second scope and bind every
          // directive twice — the same guard `bootstrap` applies. [1.1A-23]
          if (node.__faqirScope) {
            // fall through to the descendant sweep below
          } else if (node.hasAttribute && node.hasAttribute('l-data')) {
            initTree(node, findParentScope(node));
          } else if (node.hasAttribute && node.hasAttribute('data-ui') && !findParentScope(node)) {
            // Standalone data-ui (no parent scope) — create its own scope
            initTree(node, null);
          }

          if (node.querySelectorAll) {
            var scopeEls = node.querySelectorAll('[l-data]');
            for (var se = 0; se < scopeEls.length; se++) {
              if (!scopeEls[se].__faqirScope) {
                initTree(scopeEls[se], findParentScope(scopeEls[se]));
              }
            }
          }

          // Directives on a node dropped in outside every scope root — the same
          // blind spot bootstrap's sweep closes, for nodes that arrive later.
          //
          // `isConnected` matters: a mutation record is delivered as a microtask,
          // by which time the node it reports may already have been consumed —
          // `l-for` and `l-if` replace their own `<template>` with an anchor, and
          // that template arrives here detached.
          if (node.isConnected !== false && !node.__faqirScope && !findParentScope(node)) {
            var strayHost = getStrayScope();
            processElement(node, strayHost);
            if (node.parentNode) walkUnscoped(node, strayHost);
          }
        }
      }
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Auto-start logic
  //
  // `data-manual` opts out. A classic script is its own `currentScript`; a
  // module (or anything a bundler emitted) has none, so there the attribute is
  // honoured on the page's module `<script>` instead.
  var currentScript = typeof document !== 'undefined' ? document.currentScript : null;
  var isManual = currentScript
    ? currentScript.hasAttribute('data-manual')
    : typeof document !== 'undefined' && !!document.querySelector('script[type="module"][data-manual]');

  // Once the document is parsed — always true for a module, a `defer` script
  // or a bundler import — booting right here ran before the importing code
  // got past its `import`, so every `Faqir.data()` / `Faqir.directive()` it
  // registered next was never seen. The boot waits one task instead: long
  // enough for the rest of the module graph and any `import().then(...)`, and
  // `DOMContentLoaded` still wins if it has not fired yet. `bootstrap` is
  // re-entry safe, so an explicit `Faqir.start()` before then costs nothing.
  //
  // Except for a classic `defer` script. It runs while `readyState` is
  // `interactive` too, but with the page's other deferred scripts still to
  // come — and a one-task timer can fire between two of them, so the engine
  // booted before the plugins and `Faqir.data()` calls loaded after it
  // (`faqir-rules`' `l-rules` stayed inert about four loads in six). A
  // parser-inserted `defer` script always runs before `DOMContentLoaded`, so
  // there the event alone is right; `load` covers a script that merely carries
  // the attribute and was injected after the event. An `async` or injected
  // script cannot tell whether the event has passed, and keeps the timer.
  var autoStarted = false;
  function autoStart() {
    if (autoStarted) return;
    autoStarted = true;
    bootstrap();
  }

  if (!isManual && typeof document !== 'undefined') {
    var readyState = document.readyState;
    if (readyState !== 'complete') document.addEventListener('DOMContentLoaded', autoStart);
    if (readyState === 'interactive' && currentScript && currentScript.defer && !currentScript.async) {
      window.addEventListener('load', autoStart);
    } else if (readyState !== 'loading') {
      setTimeout(autoStart, 0);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════

  var Faqir = {
    // @faqir:version — `scripts/build-core.mjs` rewrites this literal from the
    // root package.json at assembly time. It drifted three minor versions the
    // one time it was hand-maintained (0.1.0 in a package versioned 0.2.4), so
    // the built artifact is now the only place the number is authoritative and
    // the build fails if this marker goes missing.
    version: '1.3.0', // @faqir:version
    reactive: reactive,
    effect: effect,
    batch: batch,
    untrack: untrack,
    evaluate: evaluate,
    evaluateAssignment: evaluateAssignment,
    nextTick: function(fn) { return queueMicrotask(fn || function() {}); },
    data: function(name, factory) { dataRegistry.set(name, factory); },
    store: function(name, obj) { globalStores[name] = reactive(obj); },
    directive: registerDirective,
    magic: function(name, callback) {
      if (name === 'this') throw new Error('[Faqir] "this" is reserved: $this is the directive element');
      customMagics.set(name, callback);
    },
    plugin: function(fn) { fn(Faqir); },
    controller: function(name, factory) { controllerRegistry[name] = factory; },
    start: bootstrap,
    initTree: publicInitTree,
    // Snapshot of Faqir's view of one element — scope, directives, controller,
    // protocol attributes. [0.7-12]
    inspect: inspect,
    // A component's controller API from plain JavaScript — the function `$ui()`
    // calls, by element or selector; `null` when nothing matches or the match
    // has no controller.
    ui: resolveUi,
    // The same object installed at window.__FAQIR_DEVTOOLS__. Exposed here too
    // so code holding a specific engine instance (a bundler import, a test
    // loading one build) reaches ITS handle rather than whichever engine
    // touched the global last. [0.7-12]
    devtools: devtools,
    // Run the cleanups registered on `el` and its descendants (l-source abort +
    // poll teardown, effect disposers, …). Structural directives call this
    // automatically on l-if hide / keyed l-for removal; exposed for imperative
    // teardown of a subtree. [0.3-08]
    destroy: destroyScope
  };

  // The devtools handle is installed on every page that loads either build —
  // agents read it without knowing how Faqir was bundled. [0.7-12]
  devtools.faqir = Faqir;
  if (typeof window !== 'undefined') {
    window.__FAQIR_DEVTOOLS__ = devtools;
  }

  return Faqir;
});
