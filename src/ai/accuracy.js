// L5 ai — the accuracy model. FEEL.md §6:
//
//   "per-archetype base hit probability with a burst-pattern miss distribution,
//    a 0.35-1.10 s reaction latency band, and guaranteed misses on the first
//    0.5 s of re-acquisition so the player always gets a moment to react to
//    being spotted. AI never uses player aim assist."
//
// The decision is baked into the FIRED DIRECTION, not into a damage flag: a
// "miss" is a ray that geometrically clears the target silhouette, so whoever
// traces the ray (the weapons owner) needs no cooperation from us and cannot
// accidentally re-roll it. There is no magnetism, no hitbox inflation and no
// turn friction anywhere in this file — those are player-only (FEEL.md §4.8).

import { Vector3 } from 'three';
import { clamp, clamp01 } from '../shared/math.js';
import { AI } from '../shared/tuning.js';
import {
  BURST_BIAS_SIGMA,
  BURST_BIAS_CLAMP,
  BURST_DECAY_PER_ROUND,
  RANGE_A,
  RANGE_MIN,
  TARGET_SPEED_PENALTY,
  TARGET_SPEED_FLOOR,
  MISS_CLEARANCE,
  MISS_SPREAD_DEG,
  HIT_JITTER_FRACTION,
} from './constants.js';

const _u = new Vector3();
const _v = new Vector3();

/** Draw the per-burst quality bias. One roll per burst — this is what clusters misses. */
export function rollBurstBias(rndAccuracy) {
  return clamp(rndAccuracy.gaussian() * BURST_BIAS_SIGMA, -BURST_BIAS_CLAMP, BURST_BIAS_CLAMP);
}

/** Draw a reaction latency inside the archetype's band (FEEL.md §6: 0.35-1.10 s overall). */
export function rollReaction(rndReaction, band) {
  return rndReaction.range(band[0], band[1]);
}

/**
 * Effective per-round hit probability.
 * @param {number} base          ENEMY[archetype].accuracy
 * @param {number} distance      metres to the target
 * @param {number} targetSpeed   m/s
 * @param {number} roundIndex    0-based index within the current burst
 * @param {number} burstBias     from rollBurstBias()
 */
export function hitProbability(base, distance, targetSpeed, roundIndex, burstBias) {
  const rangeFactor = clamp(RANGE_A - distance / AI.sightRange, RANGE_MIN, 1.0);
  const moveFactor = clamp(1 - targetSpeed * TARGET_SPEED_PENALTY, TARGET_SPEED_FLOOR, 1.0);
  let p = base * rangeFactor * moveFactor + burstBias;
  p *= 1 - BURST_DECAY_PER_ROUND * roundIndex;
  return clamp01(p);
}

/** Half-angle, in radians, subtended by a target of `radius` at `distance`. */
export function angularRadius(radius, distance) {
  return Math.atan2(radius, Math.max(distance, 0.001));
}

/**
 * Build the actual fired direction.
 *
 * @param {Vector3} out            written with a unit direction
 * @param {Vector3} trueDir        unit direction muzzle -> target aim point
 * @param {boolean} intendHit
 * @param {number}  targetAngRad   angularRadius() of the target
 * @param {object}  rndAccuracy    rng('ai.accuracy')
 * @returns {number} the angular error applied, in radians
 */
export function applyShotDeviation(out, trueDir, intendHit, targetAngRad, rndAccuracy) {
  // Build an orthonormal basis around trueDir. Pick the world axis least
  // aligned with it so the cross product is well conditioned.
  const ax = Math.abs(trueDir.x);
  const ay = Math.abs(trueDir.y);
  const az = Math.abs(trueDir.z);
  if (ax <= ay && ax <= az) _u.set(1, 0, 0);
  else if (ay <= az) _u.set(0, 1, 0);
  else _u.set(0, 0, 1);
  _v.copy(_u).cross(trueDir).normalize(); // right
  _u.copy(trueDir).cross(_v).normalize(); // up

  let err;
  if (intendHit) {
    err = targetAngRad * HIT_JITTER_FRACTION * Math.sqrt(rndAccuracy.next());
  } else {
    // Clear the silhouette by a definite margin, then spread beyond it.
    err =
      targetAngRad * MISS_CLEARANCE +
      ((MISS_SPREAD_DEG * Math.PI) / 180) * rndAccuracy.next();
  }
  const roll = rndAccuracy.next() * Math.PI * 2;
  const sx = Math.cos(roll) * Math.sin(err);
  const sy = Math.sin(roll) * Math.sin(err);
  const c = Math.cos(err);

  out.set(
    trueDir.x * c + _v.x * sx + _u.x * sy,
    trueDir.y * c + _v.y * sx + _u.y * sy,
    trueDir.z * c + _v.z * sx + _u.z * sy,
  );
  out.normalize();
  return err;
}
