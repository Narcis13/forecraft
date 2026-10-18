// @ui:core store
// @ui:provides createStore

/**
 * Create a tiny observable store.
 * @template T
 * @param {T} initial - initial state
 * @returns {{ get(): T, set(value: T): void, subscribe(fn: (value: T) => void): Function }}
 */
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  return {
    get() {
      return state;
    },
    set(value) {
      state = value;
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
