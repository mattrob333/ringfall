// L5 weapons — the target registry.
//
// `src/weapons` may not import `src/ai`, `src/vehicles` or `src/player` (all
// L5 siblings), but aim assist, ballistics, grenades and melee all need to
// know what is shootable. This module is the seam: every shootable entity
// registers a small, stable record here and the weapon system queries it.
//
// Contract for registrants:
//   - `getCapsule()` and `getForward()` MUST return the SAME object every
//     call, mutated in place. The weapon system reads them every tick and
//     never retains a copy — returning a fresh object per call would allocate
//     in the per-step path.
//   - `state` is the live `{shield, maxShield, health, maxHealth, dead}`
//     object. The weapon system writes resolved damage straight into it and
//     emits the events; the owner reads it back.
//
// Iteration is over a plain array in insertion order (ARCHITECTURE.md §7.6).

import { isHostile } from '../shared/enums.js';

/**
 * @typedef {object} TargetCapsule
 * @property {import('three').Vector3} position feet (capsule base), world space
 * @property {number} radius
 * @property {number} height
 * @property {number} [headHeight] height of the HEAD zone measured down from
 *   the capsule top. Defaults to 0.30 m.
 */

/**
 * @typedef {object} TargetRecord
 * @property {number} entityId
 * @property {number} faction shared/enums.js Faction
 * @property {() => TargetCapsule} getCapsule
 * @property {() => import('three').Vector3} getForward
 * @property {string} archetype
 * @property {{shield:number,maxShield:number,health:number,maxHealth:number,dead:boolean}} state
 * @property {(res:object, info:object) => void} [onDamage] optional hook
 */

export class TargetRegistry {
  constructor() {
    /** @type {TargetRecord[]} stable array — never a Set/Map (determinism). */
    this.list = [];
    this._byId = new Map(); // lookup only, never iterated
  }

  /**
   * @param {TargetRecord} rec
   * @returns {TargetRecord}
   */
  registerTarget(rec) {
    if (!rec || !rec.entityId) throw new Error('[targets] registerTarget needs an entityId');
    if (typeof rec.getCapsule !== 'function') {
      throw new Error(`[targets] entity ${rec.entityId} has no getCapsule()`);
    }
    if (this._byId.has(rec.entityId)) this.unregisterTarget(rec.entityId);
    const t = {
      entityId: rec.entityId,
      faction: rec.faction,
      getCapsule: rec.getCapsule,
      getForward: rec.getForward ?? (() => ZERO_FORWARD),
      archetype: rec.archetype ?? 'UNKNOWN',
      state: rec.state,
      onDamage: rec.onDamage ?? null,
    };
    this.list.push(t);
    this._byId.set(t.entityId, t);
    return t;
  }

  unregisterTarget(entityId) {
    const t = this._byId.get(entityId);
    if (!t) return false;
    const i = this.list.indexOf(t);
    if (i >= 0) this.list.splice(i, 1);
    this._byId.delete(entityId);
    return true;
  }

  get(entityId) {
    return this._byId.get(entityId) ?? null;
  }

  get count() {
    return this.list.length;
  }

  clear() {
    this.list.length = 0;
    this._byId.clear();
  }

  /**
   * Is `t` a legal victim for `faction`? Dead entities and friendlies are not.
   * `selfId` is excluded so a shooter never magnetises onto itself.
   */
  isValidTarget(t, faction, selfId) {
    if (!t || t.entityId === selfId) return false;
    if (t.state && t.state.dead) return false;
    return isHostile(faction, t.faction);
  }

  /**
   * Centre of mass of a target, written into `out`. Half capsule height.
   * @returns {import('three').Vector3} out
   */
  centreOfMass(t, out) {
    const c = t.getCapsule();
    return out.set(c.position.x, c.position.y + c.height * 0.5, c.position.z);
  }
}

const ZERO_FORWARD = { x: 0, y: 0, z: -1 };

/** Process-wide registry, matching the `events` singleton pattern in core. */
export const targets = new TargetRegistry();

/** Convenience wrappers so callers can use the free-function form in the brief. */
export function registerTarget(rec) {
  return targets.registerTarget(rec);
}

export function unregisterTarget(entityId) {
  return targets.unregisterTarget(entityId);
}

export default targets;
