// L3 audio — voice pool with a hard cap and priority-based stealing.
// Owner: `audio`. ARCHITECTURE.md §2.2 / §3 (audio does not import render or physics).
//
// A firefight must never blow up the graph. Every synthesized sound is issued a
// Voice from a VoicePool with a fixed capacity (constants.js MAX_VOICES). When
// the pool is full, a new request steals the lowest-priority active voice IF
// the new sound outranks it; otherwise the new sound is dropped silently.

import { MAX_VOICES } from './constants.js';

let nextVoiceSeq = 1;

export class Voice {
  /**
   * @param {VoicePool} pool
   * @param {{priority?:number, bus?:string}} opts
   */
  constructor(pool, opts = {}) {
    this.pool = pool;
    this.priority = opts.priority ?? 0;
    this.bus = opts.bus ?? 'sfx';
    this.nodes = [];
    this.stopped = false;
    this._disconnected = false;
    this.startTime = pool.ctx.currentTime;
    this.seq = nextVoiceSeq++;
    this._pending = 0;
  }

  /** Register a node so panic()/stealing can fade+stop it and it gets disconnected. */
  track(node) {
    this.nodes.push(node);
    return node;
  }

  /**
   * Composite sounds (e.g. a gunshot = noise layer + tonal layer) share ONE
   * pool slot. Each layer calls expectEnd() before scheduling its stop, and
   * signalEnd() in its onended. The voice only disconnects its nodes once
   * every layer has ended, so a short layer can't cut a longer one off early.
   */
  expectEnd() {
    this._pending++;
  }

  signalEnd() {
    this._pending = Math.max(0, this._pending - 1);
    if (this._pending === 0) this._finalize();
  }

  /** Back-compat alias for single-layer voices that never called expectEnd(). */
  finish() {
    this._finalize();
  }

  /**
   * Forced stop — stealing or panic(). Frees this voice's pool slot
   * IMMEDIATELY (synchronously), independent of when its audio actually
   * finishes fading — a steal must free capacity for the sound that won the
   * steal in the very same acquire() call, or the pool would briefly exceed
   * its cap. The nodes themselves fade out and disconnect afterward.
   */
  stopNow(fadeSec = 0.02) {
    if (this.stopped) return;
    this.stopped = true;
    this.pool.release(this);

    const t = this.pool.ctx.currentTime;
    for (const n of this.nodes) {
      try {
        if (n.gain && typeof n.gain.cancelScheduledValues === 'function') {
          const cur = Math.max(n.gain.value, 0.0001);
          n.gain.cancelScheduledValues(t);
          n.gain.setValueAtTime(cur, t);
          n.gain.exponentialRampToValueAtTime(0.0001, t + fadeSec);
        }
      } catch {
        /* node may already be disconnected */
      }
    }
    let hasSource = false;
    for (const n of this.nodes) {
      try {
        if (typeof n.stop === 'function') {
          n.stop(t + fadeSec + 0.01);
          hasSource = true;
        }
      } catch {
        /* already stopped */
      }
    }
    // No source node means nothing will fire onended -> signalEnd() for us;
    // disconnect right away instead of leaking the nodes.
    if (!hasSource) this._finalize();
  }

  _finalize() {
    if (this._disconnected) return;
    this._disconnected = true;
    this.pool.release(this); // idempotent; covers the natural-end path
    for (const n of this.nodes) {
      try {
        n.disconnect && n.disconnect();
      } catch {
        /* fine */
      }
    }
    this.nodes.length = 0;
  }
}

export class VoicePool {
  constructor(ctx, cap = MAX_VOICES) {
    this.ctx = ctx;
    this.cap = cap;
    this.active = new Set();
  }

  /**
   * @param {{priority?:number, bus?:string}} opts
   * @returns {Voice|null} null if the pool is full and this priority loses.
   */
  acquire(opts) {
    if (this.active.size >= this.cap) {
      let victim = null;
      for (const v of this.active) {
        if (
          !victim ||
          v.priority < victim.priority ||
          (v.priority === victim.priority && v.startTime < victim.startTime)
        ) {
          victim = v;
        }
      }
      const incoming = opts.priority ?? 0;
      if (!victim || victim.priority > incoming) return null;
      victim.stopNow(0.015);
    }
    const voice = new Voice(this, opts);
    this.active.add(voice);
    return voice;
  }

  release(voice) {
    this.active.delete(voice);
  }

  get count() {
    return this.active.size;
  }

  /** Hard-stop everything. Used by AudioEngine.panic(). */
  panic() {
    for (const v of Array.from(this.active)) v.stopNow(0.005);
  }
}
