/**
 * Faqir Data Source — Approach B: Service Layer
 *
 * A thin JS service that l-data blocks consume via spread syntax.
 * Application-level utility — NOT a Faqir recipe controller.
 *
 * Usage:
 *   <div l-data="{ ...apiSource('/api/tasks'), newTitle: '' }" l-init="load()">
 *     <template l-for="task in items">...</template>
 *   </div>
 *
 * Teardown is automatic: the object carries `__faqirTeardown`, which the engine
 * runs when the scope is destroyed (an `l-if` hiding, an `l-for` row dropping,
 * an SPA route change calling `Faqir.destroy()`). It stops polling, aborts every
 * in-flight request and latches the source closed so no late response writes
 * back into a scope that no longer exists. Call `destroy()` yourself if you hold
 * a source outside an `l-data`.
 *
 * @param {string} endpoint  - Base URL (e.g. "/api/tasks")
 * @param {object} [options]
 * @param {string} [options.idKey="id"]       - Primary key field name
 * @param {number} [options.pollInterval]     - Auto-refresh interval in ms (0 = off)
 * @param {boolean} [options.optimistic=true] - Update UI before server confirms
 */
function apiSource(endpoint, options = {}) {
  const { idKey = 'id', pollInterval = 0, optimistic = true } = options;
  let pollTimer = null;

  // Latched by destroy(). Every method checks it before starting work and again
  // before writing back, because a response can land after teardown.
  let destroyed = false;

  // One AbortController per in-flight request, so destroy() can cancel them all.
  const inflight = new Set();

  /** `fetch` with an abort handle registered for the lifetime of the request. */
  async function request(url, init) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    if (ac) inflight.add(ac);
    try {
      return await fetch(url, ac ? { ...init, signal: ac.signal } : init);
    } finally {
      if (ac) inflight.delete(ac);
    }
  }

  /** `${endpoint}/${id}` with the id encoded — ids are data, not path syntax. */
  function itemUrl(id) {
    return `${endpoint}/${encodeURIComponent(id)}`;
  }

  /**
   * Where a row is NOW. Never keep an index across an await: an interleaved
   * load() or remove() shifts or replaces `items`, and a stale index writes
   * over (or deletes) a real row.
   */
  function locate(items, id) {
    return items.findIndex(i => i && i[idKey] === id);
  }

  /** True for the exception an abort raises — never an error worth showing. */
  function aborted(e) {
    return destroyed || (e && (e.name === 'AbortError' || e.code === 20));
  }

  const source = {
    items: [],
    loading: true,
    submitting: false,
    error: null,

    // ---- Read ----

    async load() {
      if (destroyed) return;
      this.loading = true;
      this.error = null;
      try {
        const res = await request(endpoint);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (destroyed) return;
        this.items = data;
      } catch (e) {
        if (aborted(e)) return;
        this.error = e.message;
      } finally {
        if (!destroyed) this.loading = false;
      }
    },

    // ---- Create ----

    async create(payload) {
      if (destroyed) return null;
      this.submitting = true;
      this.error = null;

      let temp = null;
      if (optimistic) {
        this.items.push({ ...payload, _pending: true });
        // Read back through the list: inside an l-data scope that is the
        // reactive handle, the one an identity search later compares against.
        temp = this.items[this.items.length - 1];
      }

      try {
        const res = await request(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const created = await res.json();
        if (destroyed) return null;

        const at = temp ? this.items.indexOf(temp) : -1;
        if (at >= 0) {
          this.items[at] = created;
        } else if (!temp || !created || created[idKey] == null || locate(this.items, created[idKey]) < 0) {
          // The temp row is gone when a load() replaced the list meanwhile;
          // that list may already hold the created row.
          this.items.push(created);
        }
        return created;
      } catch (e) {
        if (aborted(e)) return null;
        this.error = e.message;
        const at = temp ? this.items.indexOf(temp) : -1;
        if (at >= 0) this.items.splice(at, 1);
        return null;
      } finally {
        if (!destroyed) this.submitting = false;
      }
    },

    // ---- Update ----

    async update(id, payload) {
      if (destroyed) return null;
      this.error = null;
      const idx = locate(this.items, id);
      let snapshot = null;

      if (optimistic && idx >= 0) {
        snapshot = { ...this.items[idx] };
        Object.assign(this.items[idx], payload);
      }

      try {
        const res = await request(itemUrl(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const updated = await res.json();
        if (destroyed) return null;

        const at = locate(this.items, id);
        if (at >= 0) this.items[at] = updated;
        return updated;
      } catch (e) {
        if (aborted(e)) return null;
        this.error = e.message;
        const at = snapshot ? locate(this.items, id) : -1;
        if (at >= 0) this.items[at] = snapshot;
        return null;
      }
    },

    // ---- Delete ----

    async remove(id) {
      if (destroyed) return;
      this.error = null;
      const idx = locate(this.items, id);
      let snapshot = null;

      if (optimistic && idx >= 0) {
        snapshot = this.items[idx];
        this.items.splice(idx, 1);
      }

      try {
        const res = await request(itemUrl(id), { method: 'DELETE' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        if (destroyed) return;

        const at = optimistic ? -1 : locate(this.items, id);
        if (at >= 0) this.items.splice(at, 1);
      } catch (e) {
        if (aborted(e)) return;
        this.error = e.message;
        // `idx` is only a position hint; skip if a reload already restored it.
        if (snapshot && locate(this.items, id) < 0) {
          this.items.splice(idx, 0, snapshot);
        }
      }
    },

    // ---- Polling ----

    startPolling(interval) {
      this.stopPolling();
      if (destroyed) return;
      const ms = interval || pollInterval;
      if (ms > 0) {
        pollTimer = setInterval(() => this.load(), ms);
      }
    },

    stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    // ---- Teardown ----

    /**
     * Stop everything this source owns and close it permanently.
     *
     * Idempotent. After it, polling is stopped, in-flight requests are aborted,
     * and no method starts new work or writes back — a response that was already
     * on the wire cannot resurrect a dead scope.
     */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      this.stopPolling();
      inflight.forEach((ac) => {
        try { ac.abort(); } catch (e) { /* already settled */ }
      });
      inflight.clear();
    },

    // ---- Refetch shorthand ----

    async refresh() {
      return this.load();
    },
  };

  // The engine's teardown hook: `initScope` runs any own `__faqirTeardown`
  // function on the scope data when that scope is destroyed, so a source spread
  // into `l-data` is torn down without the page having to remember. Bound,
  // because `destroy()` calls `this.stopPolling()`, and enumerable, because the
  // spread that installs the source copies own enumerable properties only.
  source.__faqirTeardown = source.destroy.bind(source);

  return source;
}
