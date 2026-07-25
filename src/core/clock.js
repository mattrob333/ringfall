// L1 core — the ONLY place under src/ allowed to read wall-clock time.
// ARCHITECTURE.md §7.1-§7.2. Fixed 120 Hz sim, render interpolates.

import { SIM_DT, MAX_SUBSTEPS } from '../shared/tuning.js';

export class Clock {
  constructor() {
    this.simTime = 0; // seconds of simulated time since boot
    this.frame = 0; // render frames presented
    this.simStep = 0; // fixed steps executed
    this.alpha = 0; // interpolation factor for render
    this.frameDt = 0; // last real frame delta (render only)
    this.simOverrun = 0; // dropped steps, reported by profile.mjs

    this._accum = 0;
    this._last = 0;
    this._started = false;
    this._deterministic = false;
    this._detFrameDt = 1 / 60;
  }

  /**
   * Deterministic mode: the clock ignores wall time entirely and advances by a
   * fixed frame delta each tick. Required for baseline capture and feeltest.
   */
  setDeterministic(on, frameDt = 1 / 60) {
    this._deterministic = on;
    this._detFrameDt = frameDt;
  }

  get deterministic() {
    return this._deterministic;
  }

  /** Wall-clock read. The single permitted call site in the codebase. */
  _now() {
    return typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
  }

  /**
   * Advance one render frame. Calls `stepFn(SIM_DT)` zero or more times.
   * @param {(dt:number)=>void} stepFn
   */
  tick(stepFn) {
    let dt;
    if (this._deterministic) {
      dt = this._detFrameDt;
    } else {
      const now = this._now();
      if (!this._started) {
        this._started = true;
        this._last = now;
        dt = 0;
      } else {
        dt = now - this._last;
        this._last = now;
      }
      // A tab that was backgrounded must not fire 900 sim steps on return.
      if (dt > 0.25) dt = 0.25;
    }

    this.frameDt = dt;
    this._accum += dt;

    let steps = 0;
    while (this._accum >= SIM_DT) {
      if (steps >= MAX_SUBSTEPS) {
        const dropped = Math.floor(this._accum / SIM_DT);
        this.simOverrun += dropped;
        this._accum = 0;
        break;
      }
      stepFn(SIM_DT);
      this.simTime += SIM_DT;
      this.simStep++;
      this._accum -= SIM_DT;
      steps++;
    }

    this.alpha = this._accum / SIM_DT;
    this.frame++;
    return steps;
  }

  /** Run exactly N fixed steps with no render frame. Used by feeltest. */
  runSteps(n, stepFn) {
    for (let i = 0; i < n; i++) {
      stepFn(SIM_DT);
      this.simTime += SIM_DT;
      this.simStep++;
    }
  }

  /** Run for `seconds` of simulated time. Returns steps executed. */
  runFor(seconds, stepFn) {
    const n = Math.round(seconds / SIM_DT);
    this.runSteps(n, stepFn);
    return n;
  }

  reset() {
    this.simTime = 0;
    this.frame = 0;
    this.simStep = 0;
    this.alpha = 0;
    this.frameDt = 0;
    this.simOverrun = 0;
    this._accum = 0;
    this._started = false;
  }
}

export const clock = new Clock();
