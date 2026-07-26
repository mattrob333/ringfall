// L1 core — the event bus. ARCHITECTURE.md §4.
// Synchronous, in-order, within the current fixed-step tick.
// Payloads are pooled; handlers MUST NOT retain a reference past the call.

import { EVENT_NAMES } from '../shared/events.js';

const DEV = import.meta.env?.DEV ?? true;
const MAX_REENTRY = 2;

class EventBus {
  constructor() {
    /** @type {Map<string, Array<Function>>} */
    this._handlers = new Map();
    this._depth = 0;
    this._emitCounts = new Map();
    this._trace = null;
    this._errorKeys = new Set();
    this._errorCount = 0;
  }

  /** Handler failures are contained, not thrown. Tools read this to gate on them. */
  get handlerErrors() {
    return this._errorCount;
  }

  handlerErrorKeys() {
    return [...this._errorKeys];
  }

  /** @returns {() => void} unsubscribe */
  on(name, fn) {
    if (DEV && !EVENT_NAMES.has(name)) {
      throw new Error(`[events] subscribe to undeclared event "${name}" — add it to shared/events.js`);
    }
    let list = this._handlers.get(name);
    if (!list) this._handlers.set(name, (list = []));
    list.push(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const un = this.on(name, (p) => {
      un();
      fn(p);
    });
    return un;
  }

  off(name, fn) {
    const list = this._handlers.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(name, payload) {
    if (DEV && !EVENT_NAMES.has(name)) {
      throw new Error(`[events] emit of undeclared event "${name}" — add it to shared/events.js`);
    }
    if (this._depth > MAX_REENTRY) {
      throw new Error(`[events] re-entrant emit depth ${this._depth} exceeded on "${name}"`);
    }
    if (DEV) this._emitCounts.set(name, (this._emitCounts.get(name) ?? 0) + 1);
    if (this._trace) this._trace.push({ name, payload: { ...payload } });

    const list = this._handlers.get(name);
    if (!list || list.length === 0) return;

    this._depth++;
    // Iterate a snapshot: handlers may unsubscribe during dispatch.
    const snapshot = list.length === 1 ? list : list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (err) {
        // CONTAIN, do not propagate. Rethrowing meant one bad subscriber broke
        // the EMITTER: a typo in a game-layer damage handler threw out of
        // AiAgent._fireRound and silently stopped every enemy in the level from
        // firing. A subscriber is an observer; it must not be able to abort the
        // thing it is observing.
        //
        // Reported once per (event, message) pair so a per-frame failure cannot
        // flood the console into uselessness, and counted so the tools can see
        // it. It is still a defect — it is just no longer a cascading one.
        const key = `${name}::${err?.message ?? err}`;
        if (!this._errorKeys.has(key)) {
          this._errorKeys.add(key);
          console.error(`[events] handler for "${name}" threw (further copies suppressed):`, err);
        }
        this._errorCount++;
      }
    }
    this._depth--;
  }

  /** Start recording every emit. Used by playtest.mjs and feeltest.mjs. */
  startTrace() {
    this._trace = [];
    return this._trace;
  }

  stopTrace() {
    const t = this._trace;
    this._trace = null;
    return t ?? [];
  }

  counts() {
    return Object.fromEntries(this._emitCounts);
  }

  clear() {
    this._handlers.clear();
    this._emitCounts.clear();
    this._depth = 0;
    this._trace = null;
  }
}

export const events = new EventBus();
export { EventBus };
