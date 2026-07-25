// L4 fx — short-lived point lights, allocated ONCE from renderer.clusters.
//
// ART.md §4: "Emissive contributes to bloom and to nothing else — emissives do
// not light the scene. Where an emissive strip must light its surroundings, a
// co-located low-intensity point light is authored explicitly." A muzzle flash,
// a detonation and a shield break all need to light their surroundings, so each
// gets a real clustered point light here in addition to its emissive particles.
//
// src/render/clusters.js has add* but no remove, and clear() drops everything.
// So this pool reserves LIGHT_CAP lights at construction and only ever toggles
// `enabled` / `intensity`. It never grows the cluster light list at runtime,
// which means it can never contribute to MAX_LIGHTS overflow mid-firefight.

import * as THREE from 'three';
import { LIGHT_CAP } from './constants.js';

const _pos = new THREE.Vector3();
const _col = new THREE.Color();

export class FxLightPool {
  /**
   * @param {{addPointLight:Function, lights:Array}|null} clusters renderer.clusters
   */
  constructor(clusters, cap = LIGHT_CAP) {
    this.clusters = clusters ?? null;
    this.cap = cap;
    /** @type {Array<object|null>} */
    this.lights = [];
    /** age/life/peak per slot, flat, no per-light objects */
    this.state = new Float32Array(cap * 4); // age, life, peak, active
    this.available = 0;
    this.starved = 0; // acquisitions refused because every slot was busy

    if (this.clusters && typeof this.clusters.addPointLight === 'function') {
      for (let i = 0; i < cap; i++) {
        _pos.set(0, -1000, 0);
        _col.setRGB(1, 1, 1);
        const l = this.clusters.addPointLight(_pos, _col, 0, 1);
        if (!l) break;
        l.enabled = false;
        this.lights.push(l);
      }
      this.available = this.lights.length;
    }
  }

  get reserved() {
    return this.lights.length;
  }

  /** Number of slots currently burning. */
  get active() {
    let n = 0;
    for (let i = 0; i < this.lights.length; i++) if (this.state[i * 4 + 3] > 0) n++;
    return n;
  }

  /**
   * Fire a light. Steals the shortest-remaining slot when saturated so a
   * detonation is never dropped in favour of a muzzle flash.
   */
  flash(x, y, z, r, g, b, peakIntensity, range, life) {
    const n = this.lights.length;
    if (n === 0) return -1;
    let slot = -1;
    let worstRemaining = Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (this.state[o + 3] <= 0) {
        slot = i;
        break;
      }
      const remaining = this.state[o + 1] - this.state[o];
      if (remaining < worstRemaining) {
        worstRemaining = remaining;
        slot = i;
      }
    }
    if (slot < 0) {
      this.starved++;
      return -1;
    }
    if (this.state[slot * 4 + 3] > 0) this.starved++;

    const l = this.lights[slot];
    l.position.set(x, y, z);
    l.color.setRGB(r, g, b);
    l.range = range;
    l.intensity = peakIntensity;
    l.enabled = true;

    const o = slot * 4;
    this.state[o] = 0;
    this.state[o + 1] = life > 1e-4 ? life : 1e-4;
    this.state[o + 2] = peakIntensity;
    this.state[o + 3] = 1;
    return slot;
  }

  /** Move a still-burning slot (grenade in flight). No-op on a dead slot. */
  move(slot, x, y, z) {
    if (slot < 0 || slot >= this.lights.length) return;
    if (this.state[slot * 4 + 3] <= 0) return;
    this.lights[slot].position.set(x, y, z);
  }

  /** Keep a slot alive for another `life` seconds without re-acquiring it. */
  sustain(slot, life, intensity) {
    if (slot < 0 || slot >= this.lights.length) return;
    const o = slot * 4;
    if (this.state[o + 3] <= 0) return;
    this.state[o] = 0;
    this.state[o + 1] = life;
    this.state[o + 2] = intensity;
    this.lights[slot].intensity = intensity;
  }

  release(slot) {
    if (slot < 0 || slot >= this.lights.length) return;
    const o = slot * 4;
    this.state[o + 3] = 0;
    this.lights[slot].enabled = false;
    this.lights[slot].intensity = 0;
  }

  update(dt) {
    const n = this.lights.length;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (this.state[o + 3] <= 0) continue;
      const age = this.state[o] + dt;
      const life = this.state[o + 1];
      if (age >= life) {
        this.release(i);
        continue;
      }
      this.state[o] = age;
      // Quadratic falloff: a flash reads as a snap, not as a dimmer.
      const u = 1 - age / life;
      this.lights[i].intensity = this.state[o + 2] * u * u;
    }
  }

  clear() {
    for (let i = 0; i < this.lights.length; i++) this.release(i);
  }

  dispose() {
    this.clear();
    // src/render/clusters.js has no remove API. Parked far below the level and
    // disabled, a reserved light costs one texel of the light texture and is
    // skipped by build() on the `!l.enabled` test.
    for (const l of this.lights) {
      l.position.set(0, -100000, 0);
      l.range = 0;
    }
    this.lights.length = 0;
  }
}
