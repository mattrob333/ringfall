// L3 audio — internal constants shared across the synthesis graph.
// Owner: `audio`. ARCHITECTURE.md §2.2 (parallel track, listen-only).

/** Hard cap on concurrent transient voices. Engine loops are managed outside this pool. */
export const MAX_VOICES = 48;

/** Mixer buses. Must match the exact set the public API documents. */
export const BUS_NAMES = Object.freeze(['sfx', 'weapons', 'world', 'ui', 'voice']);

/**
 * Priority ladder for voice-stealing. Higher survives longer. Kept coarse and
 * legible rather than finely tuned — the goal is "a firefight never eats the
 * kill cue", not a perfectly balanced mix.
 */
export const Priority = Object.freeze({
  UI: 100,
  KILL_CONFIRM: 96,
  SHIELD_BROKEN_PLAYER: 92,
  SHIELD_BROKEN_ENEMY: 80,
  HIT_CONFIRM: 70,
  ASSASSINATION: 90,
  MELEE_LANDED: 78,
  WEAPON_PLAYER: 76,
  GRENADE_DETONATED: 88,
  GRENADE_STUCK: 84,
  SCOPE: 74,
  WEAPON_HANDLING: 60,
  VEHICLE_IMPACT: 72,
  VEHICLE_ROLLOVER: 82,
  AI_VOCALIZE: 45,
  MELEE_SWING: 40,
  GRENADE_BOUNCE: 38,
  GRENADE_TICK: 50,
  IMPACT: 30,
  FOOTSTEP: 15,
  PLAYER_LANDED: 35,
  PLAYER_JUMPED: 20,
  WEAPON_AI: 25,
});
