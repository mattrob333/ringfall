// L5 ai — cover point sampling.
//
// THIS IS NOT PATHFINDING AND IT IS NOT A NAVMESH. There is no navmesh in this
// project. What this file does is: fire a deterministic fan of raycasts into
// the level once, at the time the first agent spawns, and keep the handful of
// world positions that (a) have ground under them and (b) have a solid surface
// within arm's reach in some horizontal direction. Agents then treat those
// points as "places worth standing" and reach them with local steering, which
// can and will fail on concave geometry. See README.md "Honest limits".

import { Vector3 } from 'three';
import { rng } from '../core/rng.js';
import {
  COVER_SAMPLE_COUNT,
  COVER_SAMPLE_RADIUS,
  COVER_PROBE_HEIGHT,
  COVER_PROBE_DISTANCE,
  COVER_PROBE_DIRS,
  COVER_DROP_MAX,
} from './constants.js';

const _from = new Vector3();
const _dir = new Vector3();
const DOWN = new Vector3(0, -1, 0);

/**
 * A cover point: a world position plus the averaged outward direction of the
 * blockers around it. `blockDir` points AWAY from the nearest cover surface,
 * i.e. the direction you are protected FROM is `-blockDir`.
 */
function makePoint() {
  return { position: new Vector3(), blockDir: new Vector3(), blockers: 0 };
}

/**
 * Sample the static world for cover points around `origin`.
 * Deterministic: fixed sample count, fixed probe count, a single named RNG
 * stream consumed in a fixed order, and a stable output array ordered by the
 * sample index (never by distance to anything that varies at runtime).
 *
 * @param {object} physics PhysicsWorld
 * @param {Vector3} origin
 * @returns {Array<{position:Vector3, blockDir:Vector3, blockers:number}>}
 */
export function sampleCoverPoints(physics, origin) {
  const r = rng('ai.cover');
  const out = [];

  for (let i = 0; i < COVER_SAMPLE_COUNT; i++) {
    // Deterministic golden-angle spiral, jittered by the seeded stream so two
    // levels with the same layout do not produce a visibly gridded pattern.
    const t = (i + 0.5) / COVER_SAMPLE_COUNT;
    const radius = Math.sqrt(t) * COVER_SAMPLE_RADIUS;
    const angle = i * 2.399963229728653 + r.next() * 0.35;
    const x = origin.x + Math.cos(angle) * radius;
    const z = origin.z + Math.sin(angle) * radius;

    // Find ground by dropping a ray from well above the origin.
    _from.set(x, origin.y + COVER_DROP_MAX * 0.5, z);
    const groundHit = physics.raycast(_from, DOWN, COVER_DROP_MAX, null);
    if (!groundHit) continue;
    const groundY = groundHit.point.y; // copy immediately — shared record

    // Probe horizontally for a blocker at chest height.
    _from.set(x, groundY + COVER_PROBE_HEIGHT, z);
    let bx = 0;
    let bz = 0;
    let blockers = 0;
    for (let k = 0; k < COVER_PROBE_DIRS; k++) {
      const a = (k / COVER_PROBE_DIRS) * Math.PI * 2;
      _dir.set(Math.cos(a), 0, Math.sin(a));
      const hit = physics.raycast(_from, _dir, COVER_PROBE_DISTANCE, null);
      if (!hit) continue;
      blockers++;
      // The blocker is in direction (cos a, sin a); protection comes from
      // there, so the "exposed" direction is the opposite.
      bx -= Math.cos(a);
      bz -= Math.sin(a);
    }
    // 0 blockers = open ground, 8 blockers = stuck in a hole. Both useless.
    if (blockers === 0 || blockers >= COVER_PROBE_DIRS) continue;

    const p = makePoint();
    p.position.set(x, groundY, z);
    const len = Math.hypot(bx, bz);
    if (len > 1e-6) p.blockDir.set(bx / len, 0, bz / len);
    else p.blockDir.set(0, 0, 1);
    p.blockers = blockers;
    out.push(p);
  }
  return out;
}

/**
 * Pick the cover point that best breaks line of sight from `threat` while
 * staying near `from`. Returns null when no sampled point qualifies.
 * Iteration is over a plain array in index order — ties resolve to the lower
 * index, deterministically.
 */
export function pickCoverPoint(points, from, threat, maxTravel) {
  let best = null;
  let bestScore = -Infinity;
  const maxTravelSq = maxTravel * maxTravel;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const dx = p.position.x - from.x;
    const dz = p.position.z - from.z;
    const travelSq = dx * dx + dz * dz;
    if (travelSq > maxTravelSq) continue;

    // Facing term: we want the cover's protected side toward the threat, i.e.
    // blockDir (the exposed side) pointing away from the threat.
    const tx = threat.x - p.position.x;
    const tz = threat.z - p.position.z;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-6) continue;
    const facing = -(p.blockDir.x * (tx / tl) + p.blockDir.z * (tz / tl));

    const score = facing * 2.0 - Math.sqrt(travelSq) * 0.05 + p.blockers * 0.08;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
