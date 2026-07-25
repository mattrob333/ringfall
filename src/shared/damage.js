// L0 shared — the sandbox lives here. ARCHITECTURE.md §5.3 / §5.4.
// Changing either multiplier column is a §12 amendment, not a tuning pass.

import { DamageType, HitRegion } from './enums.js';

/** [vsShield, vsHealth] per DamageType. */
export const DAMAGE_MATRIX = Object.freeze({
  [DamageType.KINETIC]: [1.0, 1.0],
  [DamageType.PLASMA]: [1.6, 0.55],
  [DamageType.EXPLOSIVE]: [1.0, 1.15],
  [DamageType.MELEE]: [1.0, 1.0],
  [DamageType.EMP]: [4.0, 0.0],
  [DamageType.FALL]: [0.0, 1.0],
  [DamageType.VEHICLE]: [1.0, 1.3],
  [DamageType.ENVIRONMENT]: [1.0, 1.0],
});

/** Non-head region multipliers. HEAD is per-weapon, see weapons/defs.js. */
export const REGION_MULT = Object.freeze({
  [HitRegion.HEAD]: 1.0, // replaced by weapon.headMult when shields are down
  [HitRegion.TORSO]: 1.0,
  [HitRegion.LIMB]: 0.85,
  [HitRegion.WEAKPOINT]: 3.0,
});

/**
 * Pure damage resolution. No side effects, no events — the caller emits.
 *
 * Head multipliers apply ONLY when shields are already down. That is what makes
 * shield-strip -> headshot a skill expression instead of a damage stat.
 *
 * @returns {{shield:number, health:number, shieldDelta:number, healthDelta:number,
 *            shieldBroke:boolean, killed:boolean, applied:number, absorbedByShield:boolean}}
 */
export function resolveDamage(state, amount, damageType, hitRegion, headMult = 1.0) {
  const [vsShield, vsHealth] = DAMAGE_MATRIX[damageType];
  let shield = state.shield;
  let health = state.health;
  const startShield = shield;
  const startHealth = health;
  const shieldsWereUp = shield > 0;

  let region = REGION_MULT[hitRegion] ?? 1.0;
  if (hitRegion === HitRegion.HEAD) region = shieldsWereUp ? 1.0 : headMult;

  // Damage is scaled by region first, then split across the two layers.
  let pool = amount * region;
  let absorbedByShield = false;

  if (shield > 0 && vsShield > 0) {
    const shieldDamage = pool * vsShield;
    if (shieldDamage < shield) {
      shield -= shieldDamage;
      pool = 0;
      absorbedByShield = true;
    } else {
      // Overkill carries into health at the health rate, in *raw* units.
      const consumed = shield / vsShield;
      shield = 0;
      pool -= consumed;
      absorbedByShield = true;
    }
  }

  if (pool > 0 && vsHealth > 0) health -= pool * vsHealth;
  else if (pool > 0 && vsHealth === 0) pool = 0; // EMP: no bleed-through

  if (health < 0) health = 0;
  if (shield < 0) shield = 0;

  return {
    shield,
    health,
    shieldDelta: shield - startShield,
    healthDelta: health - startHealth,
    shieldBroke: shieldsWereUp && shield === 0,
    killed: startHealth > 0 && health === 0,
    applied: startShield - shield + (startHealth - health),
    absorbedByShield,
  };
}

/** Radial falloff used by both grenade types. */
export function blastFalloff(distance, radius, exponent) {
  if (distance >= radius) return 0;
  return Math.pow(1 - distance / radius, exponent);
}
