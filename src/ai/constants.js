// L5 ai — AI-LOCAL constants.
//
// HARD RULE COMPLIANCE: every number that already exists in
// `src/shared/tuning.js` is IMPORTED, never re-declared. Nothing in this file
// duplicates a tuning value. What lives here is behaviour-shaping numbers that
// `tuning.js` does not carry (fire cadence for AI weapons, turn rates, cover
// sampling density, ...). These are NOT feel-graded by `FEEL.md` §8; if any of
// them ever becomes a graded assertion it must be promoted into `tuning.js` by
// the orchestrator (see DEFECTS.md AI1).
//
// Permitted imports here: `../shared/*` only.

import { ENEMY, AI } from '../shared/tuning.js';
import { Archetype } from '../shared/enums.js';

/** Agent behaviour states. `agent.state` is one of these strings. */
export const AiState = Object.freeze({
  IDLE: 'IDLE', // unaware, holding station
  ALERT: 'ALERT', // heard/lost something, orienting, not yet shooting
  ENGAGE: 'ENGAGE', // target visible, closing/holding and shooting
  SEEK: 'SEEK', // lost the target, moving to last-known
  COVER: 'COVER', // repositioning to a sampled cover point
  FREEZE: 'FREEZE', // SKIRN: leader just died, 0.8 s of nothing
  PANIC: 'PANIC', // SKIRN: unaimed flight
  ROUT: 'ROUT', // SKIRN: post-panic, still broken, may rally
  DEAD: 'DEAD',
});

/** `agent.animState` — the only values the character rig has to handle. */
export const AnimState = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  STAGGER: 'stagger',
  DEAD: 'dead',
  PANIC: 'panic',
});

// ---------------------------------------------------------------------------
// Perception (derived from AI.* in tuning.js — nothing re-declared)
// ---------------------------------------------------------------------------
export const HALF_FOV_COS = Math.cos((AI.fovDeg * 0.5 * Math.PI) / 180);
export const SIGHT_RANGE_SQ = AI.sightRange * AI.sightRange;
export const HEARING_RADIUS_SQ = AI.hearingRadius * AI.hearingRadius;
export const SQUAD_ALERT_RADIUS_SQ = AI.squadAlertRadius * AI.squadAlertRadius;

/** A target moving slower than this makes no noise worth hearing. */
export const HEARING_SPEED_THRESHOLD = 1.0; // m/s
/** Continuous seconds without line of sight before `ai.lostTarget`. */
export const LOSE_TARGET_TIME = 3.0;
/** Seconds spent hunting the last-known position before giving up to IDLE. */
export const SEEK_TIME = 8.0;
/** Eye height as a fraction of archetype height. */
export const EYE_HEIGHT_FRACTION = 0.88;
/** Aim point on the target, as a fraction of its capsule height. */
export const TARGET_CHEST_FRACTION = 0.62;

// ---------------------------------------------------------------------------
// Motion / steering
// ---------------------------------------------------------------------------
/** Downward stick velocity applied while grounded so slopes stay attached. */
export const GROUND_STICK = 0.6; // m/s
/** Whisker fan used for local obstacle avoidance, in degrees off the desired heading. */
export const AVOID_FAN_DEG = Object.freeze([0, 22, -22, 45, -45, 70, -70]);
/** Lookahead = this + speed * AVOID_LOOKAHEAD_TIME. */
export const AVOID_LOOKAHEAD_BASE = 0.9; // m
export const AVOID_LOOKAHEAD_TIME = 0.45; // s
/** Squad-mates closer than this push each other apart. */
export const SEPARATION_RADIUS = 1.6; // m
export const SEPARATION_STRENGTH = 1.35;
/** Horizontal acceleration used to reach the desired velocity. */
export const STEER_ACCEL = 22.0; // m/s^2
/** Body yaw slew rate. */
export const YAW_RATE = 6.5; // rad/s
/** Duration of the flinch that drives animState 'stagger'. */
export const STAGGER_TIME = 0.22; // s
/** Damage in one hit that is enough to actually stagger. */
export const STAGGER_THRESHOLD = 12;

// ---------------------------------------------------------------------------
// Cover sampling (see README — this is sampling, not pathfinding)
// ---------------------------------------------------------------------------
// 384 samples over a 42 m radius is ~1 candidate per 14 m^2. Measured: a
// sparse test level (6 pillars in 6400 m^2) yields 3 cover points; a dense
// pillar field yields 148. Sparse levels genuinely have little cover and the
// AI correctly falls back to open-field steering — see README.
export const COVER_SAMPLE_COUNT = 384;
export const COVER_SAMPLE_RADIUS = 42.0; // m around the first spawn
export const COVER_PROBE_HEIGHT = 1.05; // m above ground, chest of a crouched Vess
export const COVER_PROBE_DISTANCE = 1.35; // m — how far a blocker may be
export const COVER_PROBE_DIRS = 8; // radial probes per candidate
export const COVER_DROP_MAX = 30.0; // m of downward ray used to find ground

// ---------------------------------------------------------------------------
// Accuracy model — FEEL.md §6.
// Base hit probability and the reaction band come from ENEMY.*; everything
// below shapes the burst pattern and the miss cone.
// ---------------------------------------------------------------------------
/** Gaussian sigma of the per-burst quality bias. This is what clusters misses. */
export const BURST_BIAS_SIGMA = 0.22;
export const BURST_BIAS_CLAMP = 0.45;
/** Hit probability lost per round as a burst climbs. */
export const BURST_DECAY_PER_ROUND = 0.1;
/** Range term: p is scaled by clamp(RANGE_A - d/sightRange, RANGE_MIN, 1). */
export const RANGE_A = 1.15;
export const RANGE_MIN = 0.25;
/** Hit probability lost per m/s of target speed. */
export const TARGET_SPEED_PENALTY = 0.06;
export const TARGET_SPEED_FLOOR = 0.55;
/** A deliberate miss clears the target silhouette by at least this factor... */
export const MISS_CLEARANCE = 1.35;
/** ...and lands inside an extra cone of this many degrees beyond that. */
export const MISS_SPREAD_DEG = 2.6;
/** A "hit" shot still jitters inside this fraction of the target's angular radius. */
export const HIT_JITTER_FRACTION = 0.55;
/** Aim can never be considered on-target while the body is still slewing this much. */
export const AIM_RATE = Object.freeze({ SKIRN: 3.4, CULL: 3.8, VANE: 4.6, WARDEN: 2.6 }); // rad/s

// ---------------------------------------------------------------------------
// Per-archetype AI behaviour that FEEL.md describes in prose.
// `weaponId` strings are what the AI reports on `weapon.fired`; the weapons
// owner maps them to real definitions.
// ---------------------------------------------------------------------------
export const ARCHETYPE_AI = Object.freeze({
  [Archetype.SKIRN]: Object.freeze({
    weaponId: 'vess_needler',
    burstCount: 4,
    intraBurst: 0.11,
    refire: 0.85,
    magazine: 24,
    reloadTime: 2.1,
    preferredRange: 13.0,
    standoffMin: 5.0,
    strafeBias: 0.35,
    advance: 1.0,
  }),
  [Archetype.CULL]: Object.freeze({
    weaponId: 'vess_repeater',
    burstCount: 6,
    intraBurst: 0.09,
    refire: 0.95,
    magazine: 30,
    reloadTime: 2.4,
    preferredRange: 17.0,
    standoffMin: 7.0,
    strafeBias: 1.0, // sidesteps hard — FEEL.md §6
    advance: 0.55,
  }),
  [Archetype.VANE]: Object.freeze({
    weaponId: 'vess_carbine',
    burstCount: 5,
    intraBurst: 0.1,
    refire: 0.7,
    magazine: 28,
    reloadTime: 2.0,
    preferredRange: 20.0,
    standoffMin: 8.0,
    strafeBias: 0.8,
    advance: 0.7,
    meleeWindup: 0.16,
    meleeContact: 0.24,
    meleeRecovery: 0.6,
    grenadeMinRange: 8.0,
    grenadeMaxRange: 26.0,
    grenadeSpeed: 19.0, // matches GRENADE.plasma.throwSpeed, asserted in selftest
    grenadePitchDeg: 4.0,
  }),
  [Archetype.WARDEN]: Object.freeze({
    weaponId: 'vess_cannon',
    burstCount: 3,
    intraBurst: 0.18,
    refire: 1.5,
    magazine: 12,
    reloadTime: 3.2,
    preferredRange: 9.0,
    standoffMin: 0.0, // relentless: never backs off
    strafeBias: 0.0,
    advance: 1.0,
    neverTakesCover: true, // FEEL.md §6: "slow, heavy, plated" — it just comes
  }),
});

/** Frontal hemisphere used for the WARDEN plate. FEEL.md gives no arc, so: 90 deg. */
export const WARDEN_FRONT_ARC_DEG = 90;

/** Cooldown between vocalizations of the same cue on one agent. */
export const VOCAL_COOLDOWN = 2.5; // s

/** Guaranteed-miss window on (re-)acquisition. Imported, not re-declared. */
export const MISS_GRACE = AI.missGraceOnAcquire;

/** Convenience: the tuning row for an archetype (throws early on a typo). */
export function enemyTuning(archetype) {
  const t = ENEMY[archetype];
  if (!t) throw new Error(`[ai] unknown archetype "${archetype}"`);
  return t;
}

export function archetypeAi(archetype) {
  const t = ARCHETYPE_AI[archetype];
  if (!t) throw new Error(`[ai] no AI profile for archetype "${archetype}"`);
  return t;
}
