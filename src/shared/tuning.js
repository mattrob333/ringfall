// L0 shared — SINGLE SOURCE OF TRUTH for every number in FEEL.md.
// feeltest.mjs asserts against FEEL.md; this file is what it actually measures.
// If a number here disagrees with FEEL.md, FEEL.md wins and this is a defect.

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
export const MAX_SUBSTEPS = 8;

// ---------------------------------------------------------------------------
// Gravity — FEEL.md §2.1, ARCHITECTURE.md §12 A1.
// g = 8h/t^2 = 8(1.05)/0.95^2 = 9.3074...  ONE constant for everything.
// F50 asserts nothing anywhere applies a per-object gravity scalar.
// ---------------------------------------------------------------------------
export const GRAVITY = 9.3074792243767;
export const JUMP_VELOCITY = (GRAVITY * 0.95) / 2; // 4.4210...
export const JUMP_APEX = 1.05;
export const JUMP_AIRTIME = 0.95;
export const TERMINAL_VELOCITY = 42.0;

// ---------------------------------------------------------------------------
// Player locomotion — FEEL.md §2
// ---------------------------------------------------------------------------
export const PLAYER = Object.freeze({
  radius: 0.42,
  height: 1.85,
  eyeHeight: 1.62,
  eyeHeightCrouched: 1.05,
  crouchTransition: 0.18,
  mass: 88,
  stepHeight: 0.42,
  maxSlopeDeg: 48,

  speed: 4.4,
  strafeFactor: 0.9,
  backFactor: 0.9,
  crouchSpeed: 1.9,

  groundAccel: 65.0,
  groundDecel: 42.0,
  airAccel: 19.5, // 30% of ground
  airSpeedCap: 4.4,

  coyoteTime: 0.09,
  jumpBuffer: 0.12,

  landingSoftThreshold: 6.0,
  landingPenaltyDuration: 0.14,
  landingPenaltyFactor: 0.65,

  fallDamageThreshold: 8.5,
  fallDamagePerMs: 9.0,

  shield: 70,
  health: 45,
  shieldDelay: 4.0,
  shieldRechargeTime: 2.5,
  healthDelay: 8.0,
  healthRegenTime: 5.0,
});

export const PLAYER_SHIELD_RATE = PLAYER.shield / PLAYER.shieldRechargeTime; // 28/s
export const PLAYER_HEALTH_RATE = PLAYER.health / PLAYER.healthRegenTime; // 9/s

// ---------------------------------------------------------------------------
// Camera — FEEL.md §2.2
// ---------------------------------------------------------------------------
export const CAMERA = Object.freeze({
  fovHorizontal: 85,
  fovMin: 70,
  fovMax: 110,
  viewModelFovHorizontal: 65,
  sensitivity: 0.022,
  bobVertical: 0.009,
  bobLateral: 0.014,
  landingDip: 0.045,
  landingDipTime: 0.18,
  swayMaxDeg: 3.2,
  swaySpring: 0.09,
  near: 0.05,
  far: 4000,
});

// ---------------------------------------------------------------------------
// Aim assist — FEEL.md §4.8. NOT OPTIONAL.
// ---------------------------------------------------------------------------
export const AIM_ASSIST = Object.freeze({
  coneMinDeg: 1.2,
  coneMaxDeg: 5.0,
  coneRadiusScale: 1.35,
  magnetismMaxDeg: 3.0,
  magnetismRampStart: 0.6, // ramps 0->1 across the outer 40% of the cone
  magnetismRangeFactor: 1.6, // decays to 0 at 1.6x effective range
  hitboxInflation: 1.15,
  turnFriction: 0.8,
  reticleThicken: 1.12,
});

// ---------------------------------------------------------------------------
// Grenades — FEEL.md §4.6
// ---------------------------------------------------------------------------
export const GRENADE = Object.freeze({
  frag: {
    id: 'frag',
    throwSpeed: 17.0,
    throwPitchDeg: 6.0,
    fuse: 3.0,
    restitution: 0.42,
    friction: 0.55,
    sticks: false,
    blastDamage: 90,
    blastRadius: 5.5,
    falloffExp: 1.6,
    damageType: 2, // EXPLOSIVE
    radius: 0.09,
    maxCarried: 4,
  },
  plasma: {
    id: 'plasma',
    throwSpeed: 19.0,
    throwPitchDeg: 4.0,
    fuse: 3.0,
    fuseAfterStick: 2.2,
    restitution: 0.1,
    friction: 0.8,
    sticks: true,
    stickDamage: 130,
    blastDamage: 70,
    blastRadius: 4.0,
    falloffExp: 1.4,
    damageType: 1, // PLASMA
    radius: 0.085,
    maxCarried: 4,
  },
});

// ---------------------------------------------------------------------------
// Melee — FEEL.md §4.7
// ---------------------------------------------------------------------------
export const MELEE = Object.freeze({
  damage: 60,
  range: 2.1,
  lungePull: 1.1,
  windup: 0.12,
  contact: 0.2,
  recovery: 0.55,
  recoveryOnKill: 0.35,
  behindDot: 0.55,
  behindRange: 1.6,
});

// ---------------------------------------------------------------------------
// Inventory — FEEL.md §4
// ---------------------------------------------------------------------------
export const WEAPON_SWAP_TIME = 0.7;
export const MAX_WEAPONS = 2;

// ---------------------------------------------------------------------------
// Vehicle — FEEL.md §5
// ---------------------------------------------------------------------------
export const RIDGEBACK = Object.freeze({
  mass: 2100,
  springK: 42000,
  damperC: 4200,
  suspensionTravel: 0.32,
  suspensionRest: 0.18,
  tyreLateral: 1.55,
  tyreLongitudinal: 1.2,
  maxSpeed: 18.0,
  maxReverse: 6.0,
  zeroToMax: 4.2,
  brakeDecel: 11.0,
  steerMaxDeg: 32,
  steerMinDeg: 11,
  rolloverG: 1.25,
  rolloverHold: 0.25,
  uprightDotFail: 0.15,
  ejectSafeSpeed: 12.0,
  selfRightHold: 1.2,
  chaseBack: 5.2,
  chaseUp: 2.1,
  chaseSpring: 0.12,
  chaseFovMax: 95,
  turretDamage: 14,
  turretRpm: 480,
  turretSpinUp: 0.35,
  turretOverheat: 6.0,
  turretYawFree: true,
  turretPitchMin: -25,
  turretPitchMax: 70,
  empDisableTime: 4.0,
  ramLethalSpeed: 9.0,
  wheelRadius: 0.52,
  wheelBase: 3.4,
  trackWidth: 2.35,
});

// Drive force derived so 0 -> maxSpeed takes exactly zeroToMax with drag.
export const RIDGEBACK_DRIVE_ACCEL = RIDGEBACK.maxSpeed / RIDGEBACK.zeroToMax; // 4.2857 m/s^2

// ---------------------------------------------------------------------------
// Enemies — FEEL.md §6
// ---------------------------------------------------------------------------
export const ENEMY = Object.freeze({
  SKIRN: {
    shield: 0,
    health: 30,
    height: 1.42,
    shoulderWidth: 0.52,
    radius: 0.36,
    speed: 3.4,
    panicSpeed: 4.6,
    panicFreeze: 0.8,
    panicDuration: 6.0,
    rallyTime: 12.0,
    weakpointBlast: 45,
    weakpointRadius: 2.2,
    reaction: [0.5, 1.1],
    accuracy: 0.42,
  },
  CULL: {
    shield: 0,
    health: 55,
    height: 1.78,
    shoulderWidth: 0.61,
    radius: 0.4,
    speed: 4.0,
    barrierHealth: 90,
    barrierKineticMult: 0.0,
    barrierPlasmaMult: 0.35,
    barrierArcDeg: 62,
    strafePeriod: 1.8,
    reaction: [0.4, 0.9],
    accuracy: 0.55,
  },
  VANE: {
    shield: 90,
    health: 60,
    height: 2.34,
    shoulderWidth: 0.78,
    radius: 0.46,
    speed: 4.6,
    shieldDelay: 4.0,
    shieldRechargeTime: 3.0,
    dodgeCooldown: 2.6,
    dodgeSpeed: 9.5,
    dodgeDuration: 0.42,
    grenadeCooldown: 9.0,
    meleeRange: 2.4,
    reaction: [0.35, 0.8],
    accuracy: 0.68,
  },
  WARDEN: {
    shield: 0,
    health: 220,
    height: 2.85,
    shoulderWidth: 1.42,
    radius: 0.72,
    speed: 2.2,
    frontPlateMult: 0.35,
    backWeakpoint: true,
    reaction: [0.6, 1.1],
    accuracy: 0.5,
  },
});

/**
 * Enemy weapon output.
 *
 * SPEC GAP, filled here. FEEL.md §6 specifies enemy health, shields, accuracy
 * and reaction latency but never says how much damage they deal, and the AI's
 * weapon profiles in src/ai/constants.js carry cadence but no damage. The
 * result was that enemies shot at the player forever and the player was
 * invulnerable.
 *
 * Derived against FEEL.md §3 (player 70 shield + 45 health = 115 EHP):
 *   vess_carbine  5-round burst, 0.1 intra, 0.7 refire  -> ~4.5 rounds/s
 *   at a realistic ~50% hit rate that is ~2.3 hits/s from one enemy.
 *   PLASMA is x1.60 vs shields and x0.55 vs health, so at 4 damage:
 *     shields  70 / (4 x 1.60) = 11 hits ~ 4.8 s
 *     health   45 / (4 x 0.55) = 21 hits ~ 9.1 s
 *   ~14 s of uninterrupted fire from a SINGLE enemy to kill, well under 5 s
 *   from a squad of three. Threatening in the open, survivable behind cover,
 *   and it leaves the 4.0 s shield-recharge delay meaningful.
 *
 * All Vess small arms are PLASMA so the shield/health asymmetry that defines
 * the sandbox applies to incoming fire too.
 */
export const ENEMY_WEAPONS = Object.freeze({
  vess_carbine: { damage: 2.6, damageType: 1 },
  vess_needler: { damage: 2.0, damageType: 1 },
  vess_repeater: { damage: 3.4, damageType: 1 },
  vess_lance: { damage: 6.0, damageType: 1 },
  default: { damage: 2.6, damageType: 1 },
});

/**
 * Respawn protection. Measured: at the first pass of ENEMY_WEAPONS the player
 * respawned into six already-engaged enemies with line of sight on the spawn
 * and lost a full 70 shield in about 1.5 s, repeatedly. That is spawn-camping
 * by level layout, not difficulty. Damage was reduced ~35% AND this grace added
 * — the grace alone would only have delayed the problem.
 */
export const RESPAWN_GRACE = 2.5;

export const AI = Object.freeze({
  missGraceOnAcquire: 0.5, // guaranteed misses for the first 0.5s of re-acquisition
  sightRange: 90,
  fovDeg: 130,
  hearingRadius: 35,
  squadAlertRadius: 28,
});
