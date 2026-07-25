// L5 weapons — the weapon table. FEEL.md §4.2 and §4.4 as data.
// Owner: `sandbox`. This file IS the canonical weapon table (shared/tuning.js
// deliberately carries no weapon stats), so the numbers below are declared
// here rather than imported. Every value that appears in FEEL.md appears here
// unchanged; the handful FEEL.md does not specify are flagged `// UNSPECIFIED`
// and listed in DEFECTS.md row SANDBOX-1.

import { DamageType } from '../shared/enums.js';

export const Optic = Object.freeze({ NONE: 0, X2: 2, X8: 8 });

export const FireMode = Object.freeze({
  AUTO: 'auto', // hold to fire at rpm
  BURST: 'burst', // n-round burst, separate refire
  SEMI: 'semi', // one round per trigger press
  PELLET: 'pellet', // semi, multiple pellets per shot
  CHARGE: 'charge', // hold to charge, release to fire
});

export const AmmoKind = Object.freeze({
  MAGAZINE: 'magazine',
  TUBE: 'tube', // per-shell reload
  HEAT: 'heat', // no ammo, overheats
  BATTERY: 'battery', // no reload, no pickup
});

/**
 * Every field, in one place:
 *
 *  damage           per-round (or per-pellet) base damage
 *  headMult         HEAD multiplier — applies ONLY once shields are down
 *  damageType       shared/enums.js DamageType
 *  mode             FireMode
 *  refire           seconds between shots (or between bursts)
 *  burstCount       rounds per burst (BURST only)
 *  intraBurst       seconds between rounds inside a burst
 *  pellets          projectiles per trigger pull
 *  mag / reserve    ammo (MAGAZINE / TUBE)
 *  baseSpreadDeg    half-angle at zero bloom
 *  bloomPerShotDeg  spread added per shot
 *  bloomMaxDeg      spread cap (base + bloom)
 *  bloomDecayDeg    degrees/second of bloom recovery
 *  recoilDeg        vertical kick per shot (or per burst)
 *  recoilRecentre   fraction of the kick that returns automatically
 *  recoilTime       seconds for the auto-recentre to resolve
 *  optics           list of magnifications ([] = no scope)
 *  effectiveRange   metres — aim-assist magnetism is 100% inside this
 */
export const WEAPONS = Object.freeze({
  // -----------------------------------------------------------------------
  cadence_ar: Object.freeze({
    id: 'cadence_ar',
    name: 'Cadence AR',
    family: 'CDF',
    damage: 5.0,
    headMult: 1.25,
    damageType: DamageType.KINETIC,
    mode: FireMode.AUTO,
    rpm: 600,
    refire: 60 / 600, // 0.100 s
    pellets: 1,
    ammo: AmmoKind.MAGAZINE,
    mag: 32,
    reserve: 224,
    reloadTime: 2.1, // UNSPECIFIED in FEEL.md
    reloadEmptyTime: 2.6, // UNSPECIFIED in FEEL.md
    baseSpreadDeg: 0.6,
    bloomPerShotDeg: 0.3,
    bloomMaxDeg: 3.0,
    bloomDecayDeg: 6.0,
    recoilDeg: 0.45,
    recoilRecentre: 0.55,
    recoilTime: 0.25, // UNSPECIFIED in FEEL.md
    optics: Object.freeze([]),
    effectiveRange: 45, // UNSPECIFIED in FEEL.md
  }),

  // -----------------------------------------------------------------------
  vector_br: Object.freeze({
    id: 'vector_br',
    name: 'Vector BR',
    family: 'CDF',
    damage: 8.0,
    headMult: 2.5,
    damageType: DamageType.KINETIC,
    mode: FireMode.BURST,
    burstCount: 3,
    refire: 0.4, // burst-to-burst
    intraBurst: 0.06,
    pellets: 1,
    ammo: AmmoKind.MAGAZINE,
    mag: 36,
    reserve: 108,
    reloadTime: 2.2, // UNSPECIFIED in FEEL.md
    reloadEmptyTime: 2.7, // UNSPECIFIED in FEEL.md
    baseSpreadDeg: 0.35,
    bloomPerShotDeg: 0,
    bloomMaxDeg: 0.35,
    bloomDecayDeg: 0,
    recoilDeg: 1.1, // per burst
    recoilRecentre: 0.85,
    recoilTime: 0.3, // UNSPECIFIED in FEEL.md
    optics: Object.freeze([Optic.X2]),
    effectiveRange: 70, // UNSPECIFIED in FEEL.md
  }),

  // -----------------------------------------------------------------------
  longbow: Object.freeze({
    id: 'longbow',
    name: 'Longbow',
    family: 'CDF',
    damage: 80,
    headMult: 3.0,
    damageType: DamageType.KINETIC,
    mode: FireMode.SEMI,
    rpm: 40,
    refire: 1.5,
    pellets: 1,
    ammo: AmmoKind.MAGAZINE,
    mag: 4,
    reserve: 16,
    reloadTime: 2.6, // UNSPECIFIED in FEEL.md
    reloadEmptyTime: 3.2, // UNSPECIFIED in FEEL.md
    baseSpreadDeg: 0.0,
    bloomPerShotDeg: 0,
    bloomMaxDeg: 0,
    bloomDecayDeg: 0,
    recoilDeg: 3.2,
    recoilRecentre: 1.0,
    recoilTime: 0.4,
    optics: Object.freeze([Optic.X2, Optic.X8]),
    effectiveRange: 140, // UNSPECIFIED in FEEL.md
  }),

  // -----------------------------------------------------------------------
  breaker: Object.freeze({
    id: 'breaker',
    name: 'Breaker',
    family: 'CDF',
    damage: 11,
    headMult: 1.0,
    damageType: DamageType.KINETIC,
    mode: FireMode.PELLET,
    rpm: 70,
    refire: 0.85,
    pellets: 12,
    ammo: AmmoKind.TUBE,
    mag: 6,
    reserve: 24,
    reloadTime: 0.55, // per shell — UNSPECIFIED in FEEL.md
    reloadEmptyTime: 0.55,
    baseSpreadDeg: 4.5, // cone half-angle, fixed pattern per shot
    bloomPerShotDeg: 0,
    bloomMaxDeg: 4.5,
    bloomDecayDeg: 0,
    recoilDeg: 2.6,
    recoilRecentre: 0.9,
    recoilTime: 0.35, // UNSPECIFIED in FEEL.md
    optics: Object.freeze([]),
    effectiveRange: 12, // UNSPECIFIED in FEEL.md
  }),

  // -----------------------------------------------------------------------
  ember_repeater: Object.freeze({
    id: 'ember_repeater',
    name: 'Ember Repeater',
    family: 'Vess',
    damage: 6.0,
    headMult: 1.0, // no head bonus
    damageType: DamageType.PLASMA,
    mode: FireMode.AUTO,
    rpm: 450,
    refire: 60 / 450, // 0.13333 s
    pellets: 1,
    ammo: AmmoKind.HEAT,
    mag: 0,
    reserve: 0,
    reloadTime: 0,
    reloadEmptyTime: 0,
    baseSpreadDeg: 0.85, // -> 2.4 at heat 1
    spreadHotDeg: 2.4,
    bloomPerShotDeg: 0,
    bloomMaxDeg: 2.4,
    bloomDecayDeg: 0,
    recoilDeg: 0.3,
    recoilRecentre: 0.75, // UNSPECIFIED in FEEL.md
    recoilTime: 0.25, // UNSPECIFIED in FEEL.md
    optics: Object.freeze([]),
    effectiveRange: 32, // UNSPECIFIED in FEEL.md
    // FEEL.md §4.5
    heatToMax: 3.2, // s of continuous fire, 0 -> 1
    ventDelay: 0.55, // s after trigger release
    ventTime: 2.6, // s to empty
    overheatLockout: 3.4, // s
  }),

  // -----------------------------------------------------------------------
  vess_sidearm: Object.freeze({
    id: 'vess_sidearm',
    name: 'Vess Sidearm',
    family: 'Vess',
    damage: 8.0,
    headMult: 1.0,
    damageType: DamageType.PLASMA,
    mode: FireMode.CHARGE,
    rpm: 300,
    refire: 60 / 300, // 0.2 s
    pellets: 1,
    ammo: AmmoKind.BATTERY,
    mag: 100, // battery
    reserve: 0,
    reloadTime: 0,
    reloadEmptyTime: 0,
    batteryPerShot: 4, // UNSPECIFIED in FEEL.md
    baseSpreadDeg: 0.5,
    bloomPerShotDeg: 0,
    bloomMaxDeg: 0.5,
    bloomDecayDeg: 0,
    recoilDeg: 0.6,
    recoilRecentre: 0.8, // UNSPECIFIED in FEEL.md
    recoilTime: 0.2, // UNSPECIFIED in FEEL.md
    optics: Object.freeze([]),
    effectiveRange: 28, // UNSPECIFIED in FEEL.md
    // FEEL.md §4.2 / §4.3 — the charged EMP bolt.
    chargeTime: 1.2,
    chargeDamage: 25,
    chargeDamageType: DamageType.EMP,
    chargeBatteryCost: 12,
    chargeSpreadDeg: 0.0,
    chargeRecoilDeg: 1.4, // UNSPECIFIED in FEEL.md
    // The charged bolt is a projectile, not hitscan. FEEL.md §4.3 budgets
    // 0.15 s of travel in the golden-combo arithmetic but names neither a
    // speed nor a range; 120 m/s crosses a typical 18 m engagement in
    // exactly that. UNSPECIFIED in FEEL.md — see DEFECTS.md SANDBOX-1.
    projectileSpeed: 120,
  }),
});

export const WEAPON_IDS = Object.freeze(Object.keys(WEAPONS));

/** @returns {object} the frozen definition, or throws on an unknown id. */
export function weaponDef(id) {
  const d = WEAPONS[id];
  if (!d) throw new Error(`[weapons] unknown weapon id "${id}"`);
  return d;
}

/** Rounds a full magazine holds (or battery units / 0 for heat weapons). */
export function magazineSize(def) {
  return def.ammo === AmmoKind.HEAT ? 0 : def.mag;
}

export default WEAPONS;
