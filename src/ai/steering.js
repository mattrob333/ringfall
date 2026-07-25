// L5 ai — local steering.
//
// There is NO NAVMESH and NO PATHFINDING in this module. Movement is:
//   desired heading  ->  whisker sphere-casts for obstacle avoidance
//                    ->  squad separation
//                    ->  CharacterBody.move() for collide-and-slide + ground
// That is all. A concave obstacle (a U-shaped wall, a dead-end corridor) will
// trap an agent against the inside of it; the whisker fan only knows what is
// within its lookahead. This is stated again, at length, in README.md.

import { Vector3 } from 'three';
import { DEG } from '../shared/math.js';
import {
  AVOID_FAN_DEG,
  AVOID_LOOKAHEAD_BASE,
  AVOID_LOOKAHEAD_TIME,
  SEPARATION_RADIUS,
  SEPARATION_STRENGTH,
} from './constants.js';

const _probe = new Vector3();
const _origin = new Vector3();

/**
 * Deflect a desired horizontal heading around static geometry.
 *
 * @param {object} physics PhysicsWorld
 * @param {Vector3} eye     cast origin (chest height)
 * @param {number} radius   sphere-cast radius
 * @param {number} dirX     desired heading (unit, horizontal)
 * @param {number} dirZ
 * @param {number} speed    current speed, widens the lookahead
 * @param {Vector3} out     receives the adjusted heading (y = 0, unit)
 * @returns {boolean} true if the heading had to be deflected
 */
export function avoidHeading(physics, eye, radius, dirX, dirZ, speed, out) {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) {
    out.set(0, 0, 0);
    return false;
  }
  const nx = dirX / len;
  const nz = dirZ / len;
  const lookahead = AVOID_LOOKAHEAD_BASE + speed * AVOID_LOOKAHEAD_TIME;
  const baseAngle = Math.atan2(nx, nz);
  _origin.copy(eye);

  let bestAngle = baseAngle;
  let bestScore = -Infinity;

  for (let i = 0; i < AVOID_FAN_DEG.length; i++) {
    const off = AVOID_FAN_DEG[i];
    const a = baseAngle + off * DEG;
    _probe.set(Math.sin(a), 0, Math.cos(a));
    const hit = physics.sphereCast(_origin, _probe, radius, lookahead, null);
    const clearance = hit ? hit.distance : lookahead;
    if (off === 0 && !hit) {
      // Straight ahead is clear — the overwhelmingly common case, one cast.
      out.set(nx, 0, nz);
      return false;
    }
    // Penalise turning away from the desired heading.
    const score = clearance - Math.abs(off) * 0.014 * lookahead;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = a;
    }
  }
  out.set(Math.sin(bestAngle), 0, Math.cos(bestAngle));
  return true;
}

/**
 * Accumulate a push-apart vector from squad-mates. Iterates a plain array in
 * index order — no Set/Map, no distance sort, fully order-stable.
 *
 * @param {Array} members  stable array of agents
 * @param {object} self
 * @param {Vector3} out    accumulated separation (y = 0), NOT normalised
 */
export function separation(members, self, out) {
  out.set(0, 0, 0);
  for (let i = 0; i < members.length; i++) {
    const other = members[i];
    if (other === self || !other.alive) continue;
    const dx = self.position.x - other.position.x;
    const dz = self.position.z - other.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= SEPARATION_RADIUS * SEPARATION_RADIUS || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    const w = (1 - d / SEPARATION_RADIUS) * SEPARATION_STRENGTH;
    out.x += (dx / d) * w;
    out.z += (dz / d) * w;
  }
  return out;
}
