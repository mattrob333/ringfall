// L4 fx — continuous emitters: grenade trails and the ember_repeater vent plume.
//
// `grenade.thrown` carries origin + velocity + fuse but NO grenadeId, while
// `grenade.bounced` / `.stuck` / `.detonated` all carry a grenadeId that
// `.thrown` never supplies (DEFECTS.md AUDIO2 — same gap, different consumer).
// So a trail cannot be correlated to a grenade by id. This tracker instead:
//
//   1. integrates each thrown grenade ballistically under the shared GRAVITY,
//   2. on `grenade.bounced`, SNAPS the nearest tracked trail to the reported
//      contact point and reflects its velocity with the type's restitution,
//   3. on `grenade.stuck` / `.detonated`, retires the nearest tracked trail.
//
// Nearest-point reconciliation is exact for one grenade in flight and correct
// in the overwhelming majority of two-grenade cases, because the ballistic
// estimate stays within centimetres of truth until the first bounce and is
// re-anchored at every bounce afterwards.
//
// The pool is fixed size. Allocation happens once, in the constructor.

import { EMITTER_CAP } from './constants.js';
import { GRAVITY, GRENADE } from '../shared/tuning.js';
import { fragTrail, plasmaTrail, ventPlume } from './effects.js';
import { FxColor } from './constants.js';

export const EmitterKind = Object.freeze({
  NONE: 0,
  FRAG_TRAIL: 1,
  PLASMA_TRAIL: 2,
  VENT: 3,
});

const FRAG_PUFF_INTERVAL = 0.030; // s between smoke puffs
const PLASMA_SEG_INTERVAL = 0.018; // s between ribbon segments
const BLINK_HZ = 5.0; // FEEL.md §4.6 "a single blinking indicator light"
const VENT_INTERVAL = 0.055;

export class EmitterPool {
  constructor(cap = EMITTER_CAP) {
    this.cap = cap;
    /** Fixed-size array of reused records. Never grown, never replaced. */
    this.items = new Array(cap);
    for (let i = 0; i < cap; i++) {
      this.items[i] = {
        active: false,
        kind: EmitterKind.NONE,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        dx: 0, dy: 1, dz: 0,
        life: 0,
        age: 0,
        emitTimer: 0,
        blinkT: 0,
        lightSlot: -1,
        ownerId: 0,
        strength: 1,
      };
    }
    this.dropped = 0;
    this.peak = 0;
  }

  get active() {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.items[i].active) n++;
    return n;
  }

  _acquire() {
    for (let i = 0; i < this.cap; i++) {
      if (!this.items[i].active) return this.items[i];
    }
    this.dropped++;
    return null;
  }

  /** @param {'frag'|'plasma'} type */
  throwGrenade(type, ox, oy, oz, vx, vy, vz, fuseSeconds, lights) {
    const it = this._acquire();
    if (!it) return null;
    const plasma = type === 'plasma';
    it.active = true;
    it.kind = plasma ? EmitterKind.PLASMA_TRAIL : EmitterKind.FRAG_TRAIL;
    it.x = ox; it.y = oy; it.z = oz;
    it.vx = vx; it.vy = vy; it.vz = vz;
    it.life = (Number.isFinite(fuseSeconds) && fuseSeconds > 0 ? fuseSeconds : 3.0) + 0.15;
    it.age = 0;
    it.emitTimer = 0;
    it.blinkT = 0;
    it.ownerId = 0;
    it.strength = 1;
    it.lightSlot = -1;
    if (plasma && lights) {
      const c = FxColor.plasmaBody;
      // A plasma grenade in flight carries its own light so the cyan ribbon
      // reads against dark ground rather than only against the sky.
      // Short life, re-sustained every frame while the trail lives, so the
      // light holds a constant intensity instead of decaying across the throw.
      it.lightSlot = lights.flash(ox, oy, oz, c[0], c[1], c[2], 6, 5.5, 0.3);
    }
    const n = this.active;
    if (n > this.peak) this.peak = n;
    return it;
  }

  vent(ownerId, x, y, z, dx, dy, dz, duration) {
    // One vent per owner: a second overheat on the same weapon restarts it.
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (it.active && it.kind === EmitterKind.VENT && it.ownerId === ownerId) {
        it.age = 0;
        it.life = duration;
        it.x = x; it.y = y; it.z = z;
        it.dx = dx; it.dy = dy; it.dz = dz;
        return it;
      }
    }
    const it = this._acquire();
    if (!it) return null;
    it.active = true;
    it.kind = EmitterKind.VENT;
    it.x = x; it.y = y; it.z = z;
    it.vx = 0; it.vy = 0; it.vz = 0;
    it.dx = dx; it.dy = dy; it.dz = dz;
    it.life = duration;
    it.age = 0;
    it.emitTimer = 0;
    it.ownerId = ownerId;
    it.strength = 1;
    it.lightSlot = -1;
    const n = this.active;
    if (n > this.peak) this.peak = n;
    return it;
  }

  /** Re-anchor the nearest tracked trail to a reported contact point. */
  bounce(px, py, pz, nx, ny, nz) {
    const it = this._nearestTrail(px, py, pz);
    if (!it) return null;
    const plasma = it.kind === EmitterKind.PLASMA_TRAIL;
    const e = plasma ? GRENADE.plasma.restitution : GRENADE.frag.restitution;
    const f = plasma ? GRENADE.plasma.friction : GRENADE.frag.friction;
    it.x = px; it.y = py; it.z = pz;
    const vn = it.vx * nx + it.vy * ny + it.vz * nz;
    // Reflect the normal component, damp the tangential component by friction.
    let tx = it.vx - vn * nx;
    let ty = it.vy - vn * ny;
    let tz = it.vz - vn * nz;
    const keep = 1 - f * 0.35;
    it.vx = tx * keep - vn * nx * e;
    it.vy = ty * keep - vn * ny * e;
    it.vz = tz * keep - vn * nz * e;
    return it;
  }

  /** Retire the nearest tracked trail (stick or detonation). */
  retireNearest(px, py, pz, lights) {
    const it = this._nearestTrail(px, py, pz);
    if (!it) return null;
    if (it.lightSlot >= 0 && lights) lights.release(it.lightSlot);
    it.active = false;
    it.kind = EmitterKind.NONE;
    it.lightSlot = -1;
    return it;
  }

  /**
   * @param {number} maxDist reconciliation gate. Past this the reported point
   * is assumed to belong to a grenade we never saw thrown (an AI throw that
   * happened off-screen, or a `.thrown` that overflowed the pool), and no trail
   * is touched — better to miss a bounce puff than to teleport a live trail.
   */
  _nearestTrail(px, py, pz, maxDist = 12) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      if (it.kind !== EmitterKind.FRAG_TRAIL && it.kind !== EmitterKind.PLASMA_TRAIL) continue;
      const dx = it.x - px;
      const dy = it.y - py;
      const dz = it.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = it;
      }
    }
    return best;
  }

  /** @param {object} ctx the FX spawn context from src/fx/index.js */
  update(dt, ctx, lights) {
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (!it.active) continue;

      it.age += dt;
      if (it.age >= it.life) {
        if (it.lightSlot >= 0 && lights) lights.release(it.lightSlot);
        it.lightSlot = -1;
        it.active = false;
        it.kind = EmitterKind.NONE;
        continue;
      }

      if (it.kind === EmitterKind.VENT) {
        it.emitTimer -= dt;
        if (it.emitTimer <= 0) {
          it.emitTimer += VENT_INTERVAL;
          // Plume tapers off across the 3.4 s lockout (FEEL.md §4.5).
          const s = 1 - it.age / it.life;
          ventPlume(ctx, it.x, it.y, it.z, it.dx, it.dy, it.dz, 0.35 + s * 0.65);
        }
        continue;
      }

      // Ballistic integration under the ONE shared gravity constant. There is
      // no per-object gravity scalar here (FEEL.md F50).
      it.vy -= GRAVITY * dt;
      const px = it.x, py = it.y, pz = it.z;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;

      if (it.lightSlot >= 0 && lights) {
        lights.move(it.lightSlot, it.x, it.y, it.z);
        lights.sustain(it.lightSlot, 0.3, 6);
      }

      if (it.kind === EmitterKind.FRAG_TRAIL) {
        it.blinkT += dt;
        it.emitTimer -= dt;
        if (it.emitTimer <= 0) {
          it.emitTimer += FRAG_PUFF_INTERVAL;
          const blinkOn = (it.blinkT * BLINK_HZ) % 1 < 0.42;
          fragTrail(ctx, it.x, it.y, it.z, blinkOn);
        }
      } else {
        it.emitTimer -= dt;
        if (it.emitTimer <= 0) {
          it.emitTimer += PLASMA_SEG_INTERVAL;
          // Place the segment mid-step so consecutive segments abut instead of
          // leaving gaps at high speed — this is what makes it a ribbon.
          plasmaTrail(
            ctx,
            (px + it.x) * 0.5, (py + it.y) * 0.5, (pz + it.z) * 0.5,
            it.vx, it.vy, it.vz,
          );
        }
      }
    }
  }

  clear(lights) {
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (it.lightSlot >= 0 && lights) lights.release(it.lightSlot);
      it.active = false;
      it.kind = EmitterKind.NONE;
      it.lightSlot = -1;
    }
  }
}
