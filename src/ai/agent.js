// L5 ai — a single Vess combatant. FEEL.md §6 is the spec; this file is the
// literal implementation of it.
//
// Headless by construction: this file touches `three`'s math types, the
// physics world, the event bus and the shared tables. No meshes, no renderer,
// no DOM. What it produces is TRANSFORMS AND STATE (`position`, `yaw`,
// `aimYaw`, `aimPitch`, `animState`, `speed01`, `barrierYaw`, ...) for the
// game layer to bind to a character rig.

import { Vector3 } from 'three';
import { angleDelta, clamp, clamp01, moveToward } from '../shared/math.js';
import { GRAVITY, TERMINAL_VELOCITY, PLAYER, MELEE, GRENADE, AI } from '../shared/tuning.js';
import { Archetype, DamageType, HitRegion, Faction, isHostile } from '../shared/enums.js';
import { Ev } from '../shared/events.js';
import { resolveDamage } from '../shared/damage.js';
import { rng } from '../core/rng.js';
import {
  AiState,
  AnimState,
  AIM_RATE,
  BARRIER_TRACK_RATE,
  EYE_HEIGHT_FRACTION,
  TARGET_CHEST_FRACTION,
  HALF_FOV_COS,
  HEARING_SPEED_THRESHOLD,
  LOSE_TARGET_TIME,
  SEEK_TIME,
  GROUND_STICK,
  STEER_ACCEL,
  YAW_RATE,
  STAGGER_TIME,
  STAGGER_THRESHOLD,
  MISS_GRACE,
  VOCAL_COOLDOWN,
  WARDEN_FRONT_ARC_DEG,
  archetypeAi,
  enemyTuning,
} from './constants.js';
import { avoidHeading, separation } from './steering.js';
import {
  rollBurstBias,
  rollReaction,
  hitProbability,
  angularRadius,
  applyShotDeviation,
} from './accuracy.js';
import { pickCoverPoint } from './cover.js';

// Module-scope scratch. Never retained past the call that uses it.
const _eye = new Vector3();
const _chest = new Vector3();
const _dir = new Vector3();
const _muzzle = new Vector3();
const _shotDir = new Vector3();
const _heading = new Vector3();
const _sep = new Vector3();
const _disp = new Vector3();
const _prev = new Vector3();
const _bearing = new Vector3();
const _tmp = new Vector3();

/** Our yaw convention: forward = (sin(yaw), 0, cos(yaw)), i.e. yaw = atan2(x, z). */
export function yawToForward(yaw, out) {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

function slew(current, target, rate, dt) {
  const d = angleDelta(current, target);
  const maxStep = rate * dt;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export class AiAgent {
  constructor(director, { entityId, archetype, position, squadId, faction, spawnIndex }) {
    const tuning = enemyTuning(archetype);
    const profile = archetypeAi(archetype);

    this.director = director;
    this.entityId = entityId;
    this.archetype = archetype;
    this.faction = faction ?? Faction.VESS;
    this.squadId = squadId ?? null;
    this.spawnIndex = spawnIndex; // deterministic per-agent salt — NEVER entityId
    this.tuning = tuning;
    this.profile = profile;

    this.radius = tuning.radius;
    this.height = tuning.height;
    this.eyeHeight = tuning.height * EYE_HEIGHT_FRACTION;

    this.body = director.physics.addCharacter({
      position,
      radius: tuning.radius,
      height: tuning.height,
      stepHeight: PLAYER.stepHeight,
      maxSlopeDeg: PLAYER.maxSlopeDeg,
      entityId,
    });
    /** Feet position. Aliases the CharacterBody's own vector — same object. */
    this.position = this.body.position;
    /**
     * Diagnostic for the spawn-table owner: true when the requested spawn
     * point is already inside static geometry. The capsule will depenetrate
     * (possibly downward, through a floor) — this module cannot fix a bad
     * spawn, it can only report one.
     */
    this.spawnedInGeometry = !this.body.canStand();
    this.velocity = new Vector3();
    this._vx = 0;
    this._vy = 0;
    this._vz = 0;

    this.yaw = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.barrierYaw = 0;
    this._faceYaw = 0;

    // --- two-layer health (FEEL.md §3 / §6) ------------------------------
    this.maxShield = tuning.shield;
    this.maxHealth = tuning.health;
    this.shield = tuning.shield;
    this.health = tuning.health;
    this.alive = true;
    this.shieldDelayTimer = 0;
    this.recharging = false;
    this.shieldRate = tuning.shield > 0 && tuning.shieldRechargeTime ? tuning.shield / tuning.shieldRechargeTime : 0;

    // --- CULL forward arm barrier (F48) ----------------------------------
    this.hasBarrier = archetype === Archetype.CULL;
    this.barrierMax = this.hasBarrier ? tuning.barrierHealth : 0;
    this.barrierHealth = this.barrierMax;
    this.barrierBroken = false;

    // --- behaviour --------------------------------------------------------
    this.state = AiState.IDLE;
    this.animState = AnimState.IDLE;
    this.speed01 = 0;

    this.hasTarget = false;
    this.canSee = false;
    this.targetId = 0;
    this.lastKnown = new Vector3();
    this.noSightTime = 0;
    this.seekTimer = 0;
    this.reactionTimer = 0;
    this.missGrace = 0;
    this.alerted = false;

    this.fireTimer = 0;
    this.burstIndex = 0;
    this.burstBias = 0;
    this.ammo = profile.magazine;
    this.reloadTimer = 0;
    this._firedSinceAcquire = false;

    this.staggerTimer = 0;
    this.deadTime = 0;

    // Per-agent randomised motion phase — from a named stream, salted by the
    // director's own spawn counter (NOT entityId, which is globally monotonic
    // and would make behaviour depend on how many ids other systems burned).
    const rMotion = rng('ai.motion');
    this.strafePeriod = tuning.strafePeriod ?? rMotion.range(1.4, 2.6);
    this.strafePhase = rMotion.next() * this.strafePeriod;
    this.strafeSign = rMotion.sign();
    this.rangeJitter = rMotion.range(-2.0, 2.0);

    // VANE specials
    this.dodgeCooldownTimer = 0;
    this.dodgeTimer = 0;
    this.dodgeDirX = 0;
    this.dodgeDirZ = 0;
    this.dodging = false;
    this.grenadeCooldownTimer = tuning.grenadeCooldown ? rMotion.range(1.5, 4.0) : 0;
    this.meleePhase = null;
    this.meleeTimer = 0;

    // SKIRN panic cascade
    this.panicTimer = 0;
    this.sinceLeaderDeath = -1;
    this.panicked = false;

    this.coverTarget = null;
    this.coverTimer = 0;

    this._vocalCooldowns = new Map(); // cue -> seconds remaining; never iterated for ordering
    this.lastShot = null;

    // Stable, agent-owned records handed out by getCapsule()/getForward().
    this._capsule = {
      position: new Vector3(),
      bottom: new Vector3(),
      top: new Vector3(),
      radius: this.radius,
      height: this.height,
    };
    this._forward = new Vector3();

    this.yaw = 0;
    this.aimYaw = 0;
    this.barrierYaw = 0;
    /** True once lastKnown holds a real observation rather than the default. */
    this.hasLastKnown = false;
  }

  // -----------------------------------------------------------------------
  // Geometry helpers
  // -----------------------------------------------------------------------
  eyePosition(out) {
    return out.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  centerPosition(out) {
    return out.set(this.position.x, this.position.y + this.height * TARGET_CHEST_FRACTION, this.position.z);
  }

  forward(out) {
    return yawToForward(this.yaw, out);
  }

  /**
   * Registry contract for `../weapons/targets.js`.
   * Returns a STABLE, agent-owned record updated in place — zero allocation
   * per call. Read it immediately; do not retain it across ticks.
   */
  getCapsule() {
    const c = this._capsule;
    c.position.copy(this.position);
    c.bottom.set(this.position.x, this.position.y + this.radius, this.position.z);
    c.top.set(this.position.x, this.position.y + this.height - this.radius, this.position.z);
    c.radius = this.radius;
    c.height = this.height;
    return c;
  }

  /** Unit forward, our yaw convention. Agent-owned vector, updated in place. */
  getForward() {
    return yawToForward(this.yaw, this._forward);
  }

  // -----------------------------------------------------------------------
  // Vocalization — ai.vocalize {entityId, archetype, cue}
  // -----------------------------------------------------------------------
  vocalize(cue, force = false) {
    if (!force) {
      const left = this._vocalCooldowns.get(cue) ?? 0;
      if (left > 0) return;
    }
    this._vocalCooldowns.set(cue, VOCAL_COOLDOWN);
    this.director.events.emit(Ev.AI_VOCALIZE, {
      entityId: this.entityId,
      archetype: this.archetype,
      cue,
    });
  }

  _tickVocalCooldowns(dt) {
    // Mutating values in place; the Map is never iterated for ORDER, only to
    // decrement independent scalars, so this cannot introduce order coupling.
    for (const key of this._vocalCooldowns.keys()) {
      const v = this._vocalCooldowns.get(key) - dt;
      this._vocalCooldowns.set(key, v > 0 ? v : 0);
    }
  }

  // =======================================================================
  // DAMAGE — FEEL.md §3 / §6. Uses resolveDamage() from shared/damage.js.
  // =======================================================================
  /**
   * @param {object} p {amount, damageType, hitRegion, sourceId, weaponId,
   *                    point?, normal?, sourcePosition?, headMult?}
   * @returns {object|null} the resolution, or null if rejected.
   */
  applyDamage(p) {
    const events = this.director.events;
    if (!this.alive) {
      events.emit(Ev.DAMAGE_REJECTED, { targetId: this.entityId, reason: 'dead' });
      return null;
    }
    const damageType = p.damageType ?? DamageType.KINETIC;
    const hitRegion = p.hitRegion ?? HitRegion.TORSO;
    let amount = p.amount ?? 0;
    if (amount <= 0) return null;

    // --- incoming bearing: unit vector from us TOWARD the attacker ---------
    this._incomingBearing(p, _bearing);

    // --- CULL forward arm barrier (F48) -----------------------------------
    // 0 KINETIC from the front, x0.35 PLASMA, EXPLOSIVE unaffected.
    let mitigation = 1.0;
    let barrierUsed = false;
    if (this.hasBarrier && !this.barrierBroken) {
      const halfArcCos = Math.cos((this.tuning.barrierArcDeg * 0.5 * Math.PI) / 180);
      const bfx = Math.sin(this.barrierYaw);
      const bfz = Math.cos(this.barrierYaw);
      const bl = Math.hypot(_bearing.x, _bearing.z);
      const dot = bl > 1e-6 ? (bfx * _bearing.x + bfz * _bearing.z) / bl : 1;
      if (dot >= halfArcCos) {
        if (damageType === DamageType.KINETIC) {
          mitigation = this.tuning.barrierKineticMult;
          barrierUsed = true;
        } else if (damageType === DamageType.PLASMA) {
          mitigation = this.tuning.barrierPlasmaMult;
          barrierUsed = true;
        }
      }
    }
    if (barrierUsed) {
      this.barrierHealth -= amount * (1 - mitigation);
      if (this.barrierHealth <= 0) {
        this.barrierHealth = 0;
        this.barrierBroken = true;
        this.vocalize('barrierBroken', true);
      }
    }

    // --- WARDEN front plates ----------------------------------------------
    if (
      this.archetype === Archetype.WARDEN &&
      damageType === DamageType.KINETIC &&
      hitRegion !== HitRegion.WEAKPOINT
    ) {
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const bl = Math.hypot(_bearing.x, _bearing.z);
      const dot = bl > 1e-6 ? (fx * _bearing.x + fz * _bearing.z) / bl : 1;
      if (dot >= Math.cos((WARDEN_FRONT_ARC_DEG * Math.PI) / 180)) {
        mitigation *= this.tuning.frontPlateMult;
      }
    }

    amount *= mitigation;
    if (amount <= 0) {
      // Fully blocked: still a hit, still worth reacting to.
      this._onHitReaction(0, p);
      return {
        shield: this.shield,
        health: this.health,
        shieldDelta: 0,
        healthDelta: 0,
        shieldBroke: false,
        killed: false,
        applied: 0,
        absorbedByShield: false,
        blockedByBarrier: barrierUsed,
      };
    }

    const before = { shield: this.shield, health: this.health };
    const res = resolveDamage(before, amount, damageType, hitRegion, p.headMult ?? 1.0);
    this.shield = res.shield;
    this.health = res.health;

    // Any damage resets the recharge delay (FEEL.md §3, F14 semantics).
    if (this.maxShield > 0) {
      this.shieldDelayTimer = this.tuning.shieldDelay;
      this.recharging = false;
    }

    if (res.shieldBroke) {
      events.emit(Ev.SHIELD_BROKEN, {
        entityId: this.entityId,
        overkill: Math.max(0, -res.healthDelta),
        point: p.point ?? [this.position.x, this.position.y + this.height * 0.6, this.position.z],
        normal: p.normal ?? [_bearing.x, _bearing.y, _bearing.z],
      });
      this.vocalize('shieldDown', true);
    }

    events.emit(Ev.HEALTH_CHANGED, {
      entityId: this.entityId,
      health: this.health,
      maxHealth: this.maxHealth,
      shield: this.shield,
      maxShield: this.maxShield,
    });

    this._onHitReaction(res.applied, p);

    if (res.killed) this._die(p, hitRegion, damageType);
    res.blockedByBarrier = barrierUsed;
    return res;
  }

  _incomingBearing(p, out) {
    if (p.sourcePosition) {
      const sp = p.sourcePosition;
      const x = (Array.isArray(sp) ? sp[0] : sp.x) - this.position.x;
      const y = (Array.isArray(sp) ? sp[1] : sp.y) - (this.position.y + this.height * 0.5);
      const z = (Array.isArray(sp) ? sp[2] : sp.z) - this.position.z;
      out.set(x, y, z);
      if (out.lengthSq() > 1e-9) return out.normalize();
    }
    if (p.normal) {
      const n = p.normal;
      out.set(Array.isArray(n) ? n[0] : n.x, Array.isArray(n) ? n[1] : n.y, Array.isArray(n) ? n[2] : n.z);
      if (out.lengthSq() > 1e-9) return out.normalize();
    }
    if (p.point) {
      const q = p.point;
      out.set(
        (Array.isArray(q) ? q[0] : q.x) - this.position.x,
        (Array.isArray(q) ? q[1] : q.y) - (this.position.y + this.height * 0.5),
        (Array.isArray(q) ? q[2] : q.z) - this.position.z,
      );
      if (out.lengthSq() > 1e-9) return out.normalize();
    }
    // Last resort: assume it came from whatever we currently consider a threat.
    if (this.hasTarget) {
      out.copy(this.lastKnown).sub(this.position);
      out.y = 0;
      if (out.lengthSq() > 1e-9) return out.normalize();
    }
    return yawToForward(this.yaw, out);
  }

  _onHitReaction(applied, p) {
    if (applied >= STAGGER_THRESHOLD) this.staggerTimer = STAGGER_TIME;
    this.vocalize('takingFire');
    // Being shot alerts you even if you never saw it coming.
    if (!this.alerted) {
      this.lastKnown.copy(this.position).addScaledVector(_bearing, 12);
      this.hasLastKnown = true;
      this.director.alert(this, 'damage', p.sourceId ?? 0);
    }
    // VANE dodge-roll: only while shields are down (FEEL.md §6).
    if (
      this.archetype === Archetype.VANE &&
      this.shield <= 0 &&
      this.dodgeCooldownTimer <= 0 &&
      this.alive
    ) {
      this._startDodge();
    }
  }

  _die(p, hitRegion, damageType) {
    this.alive = false;
    this.state = AiState.DEAD;
    this.animState = AnimState.DEAD;
    this.speed01 = 0;
    this._vx = this._vy = this._vz = 0;
    this.velocity.set(0, 0, 0);
    this.canSee = false;
    this.hasTarget = false;

    this.director.events.emit(Ev.ENTITY_KILLED, {
      entityId: this.entityId,
      killerId: p.sourceId ?? 0,
      weaponId: p.weaponId ?? 0,
      hitRegion,
      damageType,
      position: [this.position.x, this.position.y, this.position.z],
    });
    this.vocalize('death', true);

    // SKIRN dorsal methane tank: a WEAKPOINT kill detonates (FEEL.md §6).
    if (this.archetype === Archetype.SKIRN && hitRegion === HitRegion.WEAKPOINT) {
      this.director._queueTankDetonation(this);
    }
    this.director._onAgentKilled(this);
  }

  // =======================================================================
  // PER-TICK UPDATE
  // =======================================================================
  update(dt, ctx) {
    this._tickVocalCooldowns(dt);

    if (!this.alive) {
      this.deadTime += dt;
      this.animState = AnimState.DEAD;
      this.speed01 = 0;
      return;
    }

    if (this.staggerTimer > 0) this.staggerTimer -= dt;
    if (this.dodgeCooldownTimer > 0) this.dodgeCooldownTimer -= dt;
    if (this.grenadeCooldownTimer > 0) this.grenadeCooldownTimer -= dt;
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.ammo = this.profile.magazine;
    }

    this._perceive(dt, ctx);
    this._thinkState(dt, ctx);
    this._move(dt, ctx);
    this._aim(dt, ctx);
    this._weapons(dt, ctx);
    this._regenShield(dt);
    this._updateAnim();
  }

  // -----------------------------------------------------------------------
  // Perception: 90 m sight, 130 deg FOV, LOS via physics.raycast, 35 m hearing
  // -----------------------------------------------------------------------
  _perceive(dt, ctx) {
    const threat = ctx.threat;
    this.canSee = false;
    if (!threat || !threat.alive || !isHostile(this.faction, threat.faction)) {
      if (this.hasTarget) this._loseTarget(ctx);
      return;
    }

    this.eyePosition(_eye);
    const th = threat.height ?? PLAYER.height;
    _chest.set(
      threat.position.x,
      threat.position.y + th * TARGET_CHEST_FRACTION,
      threat.position.z,
    );
    _dir.copy(_chest).sub(_eye);
    const dist = _dir.length();

    let sees = false;
    if (dist <= AI.sightRange && dist > 1e-4) {
      _dir.divideScalar(dist);
      // Field of view is measured against the BODY yaw, horizontally.
      const fl = Math.hypot(_dir.x, _dir.z);
      const fdot = fl > 1e-6 ? (Math.sin(this.yaw) * _dir.x + Math.cos(this.yaw) * _dir.z) / fl : 1;
      const inFov = fdot >= HALF_FOV_COS || this.alerted;
      if (inFov) {
        const hit = ctx.physics.raycast(_eye, _dir, dist - 0.1, null);
        sees = !hit;
      }
    }

    const threatSpeed = threat.velocity ? Math.hypot(threat.velocity.x, threat.velocity.y, threat.velocity.z) : 0;
    const heard = dist <= AI.hearingRadius && threatSpeed > HEARING_SPEED_THRESHOLD;

    if (sees) {
      this.canSee = true;
      this.noSightTime = 0;
      this.lastKnown.copy(threat.position);
      this.hasLastKnown = true;
      this.targetId = threat.entityId;
      if (!this.hasTarget) this._acquire(ctx, 'sight');
    } else {
      if (heard) {
        this.lastKnown.copy(threat.position);
        this.hasLastKnown = true;
        this.targetId = threat.entityId;
        if (!this.hasTarget) this._acquire(ctx, 'hearing');
      }
      if (this.hasTarget) {
        this.noSightTime += dt;
        if (this.noSightTime >= LOSE_TARGET_TIME) this._loseTarget(ctx);
      }
    }
  }

  /** (Re-)acquisition. Arms the reaction latency AND the 0.5 s miss grace. */
  _acquire(ctx, cause) {
    this.hasTarget = true;
    this.noSightTime = 0;
    this.reactionTimer = rollReaction(rng('ai.reaction'), this.tuning.reaction);
    this.missGrace = MISS_GRACE;
    this._firedSinceAcquire = false;
    this.burstIndex = 0;
    this.fireTimer = 0;
    if (this.state === AiState.IDLE || this.state === AiState.ALERT || this.state === AiState.SEEK) {
      this.state = AiState.ENGAGE;
    }
    this.director.alert(this, cause, this.targetId);
    this.vocalize(cause === 'sight' ? 'spotted' : 'alerted');
  }

  /** Called by the director when a squad-mate saw something. */
  receiveSquadAlert(lastKnown, targetId) {
    if (this.hasTarget || !this.alive) return;
    this.alerted = true;
    this.lastKnown.copy(lastKnown);
    this.hasLastKnown = true;
    this.targetId = targetId;
    if (this.state === AiState.IDLE) {
      this.state = AiState.SEEK;
      this.seekTimer = SEEK_TIME;
    }
  }

  _loseTarget(ctx) {
    if (!this.hasTarget) return;
    this.hasTarget = false;
    this.canSee = false;
    this.noSightTime = 0;
    ctx.events.emit(Ev.AI_LOST_TARGET, {
      entityId: this.entityId,
      lastKnown: [this.lastKnown.x, this.lastKnown.y, this.lastKnown.z],
    });
    this.vocalize('lostTarget');
    if (this.state === AiState.ENGAGE || this.state === AiState.COVER) {
      this.state = AiState.SEEK;
      this.seekTimer = SEEK_TIME;
    }
  }

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------
  _thinkState(dt, ctx) {
    if (this.reactionTimer > 0) this.reactionTimer -= dt;

    // The panic cascade owns the SKIRN completely while it is running.
    if (this.sinceLeaderDeath >= 0) {
      this._tickPanic(dt, ctx);
      return;
    }

    switch (this.state) {
      case AiState.IDLE:
        break;
      case AiState.ALERT:
      case AiState.SEEK: {
        this.seekTimer -= dt;
        if (this.seekTimer <= 0) {
          this.state = AiState.IDLE;
          this.alerted = false;
        }
        break;
      }
      case AiState.ENGAGE:
      case AiState.COVER: {
        if (!this.hasTarget) break;
        // Take cover while reloading; come back out when the magazine is full.
        // A WARDEN never does this — it is relentless, that is its whole read.
        if (
          this.state === AiState.ENGAGE &&
          !this.profile.neverTakesCover &&
          this.reloadTimer > 0 &&
          ctx.coverPoints.length
        ) {
          const cp = pickCoverPoint(ctx.coverPoints, this.position, this.lastKnown, 18);
          if (cp) {
            this.coverTarget = cp;
            this.coverTimer = this.profile.reloadTime;
            this.state = AiState.COVER;
          }
        } else if (this.state === AiState.COVER) {
          this.coverTimer -= dt;
          if (this.coverTimer <= 0 || this.reloadTimer <= 0) {
            this.state = AiState.ENGAGE;
            this.coverTarget = null;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * SKIRN panic cascade — FEEL.md §6, F47. The signature behaviour of the game.
   *
   *   t = 0.0   leader dies -> `ai.leaderKilled` (director) -> FREEZE
   *   t = 0.8   `ai.panic.start`, PANIC, 6 s of unaimed retreat
   *   t = 6.8   `ai.panic.end`, ROUT (broken, still running, still not shooting)
   *   t = 12.0  re-rally to ENGAGE if any VANE in the squad is still alive
   */
  _tickPanic(dt, ctx) {
    this.sinceLeaderDeath += dt;
    const t = this.tuning;

    if (this.state === AiState.FREEZE && this.sinceLeaderDeath >= t.panicFreeze) {
      this.state = AiState.PANIC;
      this.panicked = true;
      ctx.events.emit(Ev.AI_PANIC_START, { entityId: this.entityId, squadId: this.squadId });
      this.vocalize('panic', true);
    } else if (
      this.state === AiState.PANIC &&
      this.sinceLeaderDeath >= t.panicFreeze + t.panicDuration
    ) {
      this.state = AiState.ROUT;
      ctx.events.emit(Ev.AI_PANIC_END, { entityId: this.entityId, squadId: this.squadId });
    } else if (this.state === AiState.ROUT && this.sinceLeaderDeath >= t.rallyTime) {
      if (this.director.squadHasLivingLeader(this.squadId)) {
        this.sinceLeaderDeath = -1;
        this.panicked = false;
        this.state = this.hasTarget ? AiState.ENGAGE : AiState.SEEK;
        this.seekTimer = SEEK_TIME;
        this.reactionTimer = rollReaction(rng('ai.reaction'), t.reaction);
        this.missGrace = MISS_GRACE;
        this.vocalize('rally', true);
      } else {
        // No leader left: stay routed. Re-check every rallyTime.
        this.sinceLeaderDeath = t.panicFreeze + t.panicDuration;
      }
    }
  }

  /** Director entry point: this agent's squad leader just died. */
  beginPanic() {
    if (!this.alive || this.archetype !== Archetype.SKIRN) return false;
    this.sinceLeaderDeath = 0;
    this.state = AiState.FREEZE;
    this.animState = AnimState.STAGGER;
    this.canSee = false;
    this._vx = 0;
    this._vz = 0;
    this.vocalize('leaderDown', true);
    return true;
  }

  // -----------------------------------------------------------------------
  // Movement
  // -----------------------------------------------------------------------
  _move(dt, ctx) {
    _prev.copy(this.position);

    let wantX = 0;
    let wantZ = 0;
    let speed = this.tuning.speed;

    // The lateral sidestep clock is LOCOMOTION, not a combat sub-state: it
    // runs continuously so the period is genuinely `ENEMY.CULL.strafePeriod`
    // (1.8 s) and does not stretch every time the agent reloads or repositions.
    if (this.state !== AiState.FREEZE) {
      this.strafePhase += dt;
      if (this.strafePhase >= this.strafePeriod) {
        this.strafePhase -= this.strafePeriod;
        this.strafeSign = -this.strafeSign;
      }
    }

    if (this.dodgeTimer > 0) {
      // VANE dodge-roll: a committed lateral burst, not steering.
      this.dodgeTimer -= dt;
      wantX = this.dodgeDirX;
      wantZ = this.dodgeDirZ;
      speed = this.tuning.dodgeSpeed;
      this.dodging = true;
    } else {
      this.dodging = false;
      const s = this.state;
      if (s === AiState.FREEZE) {
        speed = 0;
      } else if (s === AiState.PANIC || s === AiState.ROUT) {
        // Flee: straight away from the last known threat position. With no
        // observation at all, run the way the body is already facing.
        if (this.hasLastKnown) {
          wantX = this.position.x - this.lastKnown.x;
          wantZ = this.position.z - this.lastKnown.z;
        } else {
          wantX = -Math.sin(this.yaw);
          wantZ = -Math.cos(this.yaw);
        }
        speed = s === AiState.PANIC ? this.tuning.panicSpeed : this.tuning.speed * 0.75;
      } else if (s === AiState.COVER && this.coverTarget) {
        wantX = this.coverTarget.position.x - this.position.x;
        wantZ = this.coverTarget.position.z - this.position.z;
      } else if (s === AiState.ENGAGE && this.hasTarget) {
        const dx = this.lastKnown.x - this.position.x;
        const dz = this.lastKnown.z - this.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) {
          const ux = dx / d;
          const uz = dz / d;
          const preferred = this.profile.preferredRange + this.rangeJitter;
          let radial = 0;
          if (d > preferred) radial = this.profile.advance;
          else if (d < this.profile.standoffMin) radial = -1.0;
          // Lateral component (CULL sidesteps on its 1.8 s tuning period).
          const latX = -uz * this.strafeSign * this.profile.strafeBias;
          const latZ = ux * this.strafeSign * this.profile.strafeBias;
          wantX = ux * radial + latX;
          wantZ = uz * radial + latZ;
        }
      } else if (s === AiState.SEEK || s === AiState.ALERT) {
        wantX = this.lastKnown.x - this.position.x;
        wantZ = this.lastKnown.z - this.position.z;
        if (Math.hypot(wantX, wantZ) < 1.5) {
          wantX = 0;
          wantZ = 0;
        }
        speed = this.tuning.speed * 0.7;
      }
      // Melee windup roots a VANE in place so the swing reads.
      if (this.meleePhase === 'windup' || this.meleePhase === 'contact') {
        wantX = 0;
        wantZ = 0;
      }
    }

    // Squad separation.
    if (ctx.squadMembers) {
      separation(ctx.squadMembers, this, _sep);
      wantX += _sep.x;
      wantZ += _sep.z;
    }

    let desiredVx = 0;
    let desiredVz = 0;
    const wl = Math.hypot(wantX, wantZ);
    if (wl > 1e-5 && speed > 0) {
      this.eyePosition(_eye);
      avoidHeading(ctx.physics, _eye, this.radius * 0.9, wantX / wl, wantZ / wl, speed, _heading);
      desiredVx = _heading.x * speed;
      desiredVz = _heading.z * speed;
    }

    const accel = STEER_ACCEL * dt;
    this._vx = moveToward(this._vx, desiredVx, accel);
    this._vz = moveToward(this._vz, desiredVz, accel);

    if (this.body.grounded) this._vy = -GROUND_STICK;
    else {
      this._vy -= GRAVITY * dt;
      if (this._vy < -TERMINAL_VELOCITY) this._vy = -TERMINAL_VELOCITY;
    }

    _disp.set(this._vx * dt, this._vy * dt, this._vz * dt);
    this.body.move(_disp);

    // Re-derive from what actually happened so a wall bleeds momentum instead
    // of the agent grinding into it forever.
    const inv = 1 / dt;
    this.velocity.set(
      (this.position.x - _prev.x) * inv,
      (this.position.y - _prev.y) * inv,
      (this.position.z - _prev.z) * inv,
    );
    this._vx = this.velocity.x;
    this._vz = this.velocity.z;
    if (this.body.grounded && this._vy < 0) this._vy = -GROUND_STICK;

    const refSpeed = this.state === AiState.PANIC ? this.tuning.panicSpeed : this.tuning.speed;
    this.speed01 = clamp01(Math.hypot(this.velocity.x, this.velocity.z) / Math.max(refSpeed, 0.001));
  }

  _startDodge() {
    this.dodgeTimer = this.tuning.dodgeDuration;
    this.dodgeCooldownTimer = this.tuning.dodgeCooldown;
    const dx = this.lastKnown.x - this.position.x;
    const dz = this.lastKnown.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const sign = rng('ai.motion').sign();
    if (d > 1e-4) {
      this.dodgeDirX = (-dz / d) * sign;
      this.dodgeDirZ = (dx / d) * sign;
    } else {
      this.dodgeDirX = sign;
      this.dodgeDirZ = 0;
    }
    this.vocalize('dodge');
  }

  // -----------------------------------------------------------------------
  // Aiming — body yaw, aim yaw/pitch, and the CULL barrier yaw
  // -----------------------------------------------------------------------
  _aim(dt, ctx) {
    const aimRate = AIM_RATE[this.archetype] ?? 3.5;
    let faceYaw = this.yaw;
    let wantPitch = 0;
    const unaimed = this.state === AiState.PANIC || this.state === AiState.ROUT || this.state === AiState.FREEZE;

    if (unaimed) {
      // Panicking Vess do not aim. They look where they are running.
      if (Math.hypot(this.velocity.x, this.velocity.z) > 0.2) {
        faceYaw = Math.atan2(this.velocity.x, this.velocity.z);
      }
      wantPitch = 0;
    } else if (this.hasTarget) {
      this.eyePosition(_eye);
      const th = ctx.threat?.height ?? PLAYER.height;
      _chest.set(this.lastKnown.x, this.lastKnown.y + th * TARGET_CHEST_FRACTION, this.lastKnown.z);
      _dir.copy(_chest).sub(_eye);
      const horiz = Math.hypot(_dir.x, _dir.z);
      faceYaw = Math.atan2(_dir.x, _dir.z);
      wantPitch = Math.atan2(_dir.y, Math.max(horiz, 1e-4));
    } else if (Math.hypot(this.velocity.x, this.velocity.z) > 0.2) {
      faceYaw = Math.atan2(this.velocity.x, this.velocity.z);
    }

    this._faceYaw = faceYaw;
    this.yaw = slew(this.yaw, faceYaw, YAW_RATE, dt);
    this.aimYaw = slew(this.aimYaw, faceYaw, aimRate, dt);
    this.aimPitch = slew(this.aimPitch, clamp(wantPitch, -1.2, 1.2), aimRate, dt);

    // The CULL keeps the forward arm barrier toward the threat independently
    // of where its body is pointing — that is the whole point of the archetype.
    // It tracks the THREAT BEARING (recomputed from the live position, so
    // sidestepping updates it), never the movement heading: a CULL that is
    // repositioning still holds the slab toward where it last saw you.
    if (this.hasBarrier) {
      let barrierTarget = this.yaw;
      if (this.hasLastKnown && (this.hasTarget || this.alerted)) {
        barrierTarget = Math.atan2(
          this.lastKnown.x - this.position.x,
          this.lastKnown.z - this.position.z,
        );
      }
      this.barrierYaw = slew(this.barrierYaw, barrierTarget, BARRIER_TRACK_RATE, dt);
    } else {
      this.barrierYaw = this.yaw;
    }
  }

  /**
   * True when the aim has converged on the bearing it is slewing toward. This
   * gates the trigger so an agent that is still spinning does not spray — it
   * is NOT part of the accuracy model, which lives entirely in accuracy.js.
   */
  _aimSettled() {
    return Math.abs(angleDelta(this.aimYaw, this._faceYaw)) < 0.35;
  }

  // -----------------------------------------------------------------------
  // Weapons: fire cadence, the accuracy model, grenades, melee
  // -----------------------------------------------------------------------
  _weapons(dt, ctx) {
    if (this.meleePhase) {
      this._tickMelee(dt, ctx);
      return;
    }
    const engaged = this.state === AiState.ENGAGE || this.state === AiState.COVER;
    if (!engaged || !this.hasTarget) return;

    // VANE melee inside 2.4 m (FEEL.md §6).
    if (this.archetype === Archetype.VANE && this.canSee) {
      const d = Math.hypot(this.lastKnown.x - this.position.x, this.lastKnown.z - this.position.z);
      if (d <= this.tuning.meleeRange && this.reactionTimer <= 0) {
        this._startMelee(ctx);
        return;
      }
    }

    if (this.reactionTimer > 0) return;

    // The guaranteed-miss window (FEEL.md §6, AI.missGraceOnAcquire) runs from
    // the FIRST ROUND fired after (re-)acquisition, not from acquisition
    // itself. The reaction latency already covers "hasn't reacted yet"; this
    // window covers "is shooting AT you and cannot hit yet", which is the part
    // the player has to be able to see and respond to.
    if (this._firedSinceAcquire && this.missGrace > 0) this.missGrace -= dt;

    // VANE plasma grenade on a 9 s cooldown.
    if (
      this.archetype === Archetype.VANE &&
      this.canSee &&
      this.grenadeCooldownTimer <= 0 &&
      this._aimSettled()
    ) {
      const d = Math.hypot(this.lastKnown.x - this.position.x, this.lastKnown.z - this.position.z);
      if (d >= this.profile.grenadeMinRange && d <= this.profile.grenadeMaxRange) {
        this._throwGrenade(ctx);
        return;
      }
    }

    if (this.reloadTimer > 0) return;
    if (!this.canSee) return;

    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    if (!this._aimSettled()) return;

    if (this.ammo <= 0) {
      this.reloadTimer = this.profile.reloadTime;
      this.burstIndex = 0;
      return;
    }
    this._fireRound(ctx);
  }

  _fireRound(ctx) {
    const rndAcc = rng('ai.accuracy');
    const profile = this.profile;
    const isFirst = this.burstIndex === 0;
    if (isFirst) this.burstBias = rollBurstBias(rndAcc);

    this.eyePosition(_eye);
    const th = ctx.threat?.height ?? PLAYER.height;
    const tr = ctx.threat?.radius ?? PLAYER.radius;
    _chest.set(this.lastKnown.x, this.lastKnown.y + th * TARGET_CHEST_FRACTION, this.lastKnown.z);

    // Muzzle sits a little forward of the eye along the aim direction.
    const ay = this.aimYaw;
    const ap = this.aimPitch;
    const cp = Math.cos(ap);
    _muzzle.set(_eye.x + Math.sin(ay) * cp * 0.4, _eye.y + Math.sin(ap) * 0.4, _eye.z + Math.cos(ay) * cp * 0.4);

    _dir.copy(_chest).sub(_muzzle);
    const dist = _dir.length();
    if (dist < 1e-4) return;
    _dir.divideScalar(dist);

    const threatSpeed = ctx.threat?.velocity
      ? Math.hypot(ctx.threat.velocity.x, ctx.threat.velocity.z)
      : 0;
    const p = hitProbability(this.tuning.accuracy, dist, threatSpeed, this.burstIndex, this.burstBias);
    const roll = rndAcc.next(); // always consumed, so the stream is cadence-stable
    const intendHit = this.missGrace <= 0 && roll < p;
    const angRad = angularRadius(tr, dist);
    const err = applyShotDeviation(_shotDir, _dir, intendHit, angRad, rndAcc);

    this.ammo--;
    this.burstIndex++;
    this._firedSinceAcquire = true;
    if (this.burstIndex >= profile.burstCount) {
      this.burstIndex = 0;
      this.fireTimer = profile.refire;
    } else {
      this.fireTimer = profile.intraBurst;
    }

    this.lastShot = {
      intendHit,
      errRad: err,
      targetAngRad: angRad,
      distance: dist,
      hitProbability: p,
      graced: this.missGrace > 0,
    };

    ctx.events.emit(Ev.WEAPON_FIRED, {
      ownerId: this.entityId,
      weaponId: profile.weaponId,
      muzzle: [_muzzle.x, _muzzle.y, _muzzle.z],
      direction: [_shotDir.x, _shotDir.y, _shotDir.z],
      seed: rng('ai').nextUint(),
      ammoRemaining: this.ammo,
      isFirstOfBurst: isFirst,
    });
    if (isFirst) this.vocalize('charge');
  }

  _throwGrenade(ctx) {
    this.grenadeCooldownTimer = this.tuning.grenadeCooldown;
    this.eyePosition(_eye);
    const pitch = this.aimPitch + (this.profile.grenadePitchDeg * Math.PI) / 180;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const speed = this.profile.grenadeSpeed;
    ctx.events.emit(Ev.GRENADE_THROWN, {
      ownerId: this.entityId,
      grenadeType: 'plasma',
      origin: [_eye.x, _eye.y, _eye.z],
      velocity: [Math.sin(this.aimYaw) * cp * speed, sp * speed, Math.cos(this.aimYaw) * cp * speed],
      fuseMs: GRENADE.plasma.fuse * 1000,
    });
    this.vocalize('grenade', true);
  }

  _startMelee(ctx) {
    this.meleePhase = 'windup';
    this.meleeTimer = this.profile.meleeWindup;
    ctx.events.emit(Ev.MELEE_SWING, {
      ownerId: this.entityId,
      durationMs:
        (this.profile.meleeWindup + this.profile.meleeContact + this.profile.meleeRecovery) * 1000,
    });
    this.vocalize('melee', true);
  }

  _tickMelee(dt, ctx) {
    this.meleeTimer -= dt;
    if (this.meleeTimer > 0) return;
    if (this.meleePhase === 'windup') {
      this.meleePhase = 'contact';
      this.meleeTimer = this.profile.meleeContact;
      const threat = ctx.threat;
      const dx = this.lastKnown.x - this.position.x;
      const dz = this.lastKnown.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (threat && threat.alive && d <= this.tuning.meleeRange) {
        let fromBehind = false;
        if (threat.forward) {
          this.forward(_tmp);
          const fdot = _tmp.x * threat.forward.x + _tmp.z * threat.forward.z;
          fromBehind = fdot > MELEE.behindDot && d <= MELEE.behindRange;
        }
        ctx.events.emit(Ev.MELEE_LANDED, {
          ownerId: this.entityId,
          targetId: threat.entityId,
          fromBehind,
          point: [threat.position.x, threat.position.y + PLAYER.height * 0.5, threat.position.z],
        });
      } else {
        ctx.events.emit(Ev.MELEE_WHIFFED, { ownerId: this.entityId });
      }
    } else if (this.meleePhase === 'contact') {
      this.meleePhase = 'recovery';
      this.meleeTimer = this.profile.meleeRecovery;
    } else {
      this.meleePhase = null;
      this.meleeTimer = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Two-layer shield regen (VANE: 4.0 s delay, 3.0 s to full — F49)
  // -----------------------------------------------------------------------
  _regenShield(dt) {
    if (this.maxShield <= 0 || this.shield >= this.maxShield) return;
    const events = this.director.events;
    if (!this.recharging) {
      this.shieldDelayTimer -= dt;
      if (this.shieldDelayTimer <= 0) {
        this.recharging = true;
        this.shieldDelayTimer = 0;
        events.emit(Ev.SHIELD_RECHARGE_START, { entityId: this.entityId });
      }
      return;
    }
    this.shield += this.shieldRate * dt;
    if (this.shield >= this.maxShield) {
      this.shield = this.maxShield;
      this.recharging = false;
      events.emit(Ev.SHIELD_RECHARGE_FULL, { entityId: this.entityId });
      events.emit(Ev.HEALTH_CHANGED, {
        entityId: this.entityId,
        health: this.health,
        maxHealth: this.maxHealth,
        shield: this.shield,
        maxShield: this.maxShield,
      });
    }
  }

  // -----------------------------------------------------------------------
  _updateAnim() {
    if (!this.alive) {
      this.animState = AnimState.DEAD;
      return;
    }
    if (this.state === AiState.FREEZE || this.staggerTimer > 0) {
      this.animState = AnimState.STAGGER;
      return;
    }
    if (this.state === AiState.PANIC || this.state === AiState.ROUT) {
      this.animState = AnimState.PANIC;
      return;
    }
    if (this.speed01 > 0.6) this.animState = AnimState.RUN;
    else if (this.speed01 > 0.06) this.animState = AnimState.WALK;
    else this.animState = AnimState.IDLE;
  }
}
