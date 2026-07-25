// L5 player — capsule locomotion, camera state, shields/health, fall damage.
// Owner: `playerctl`. ARCHITECTURE.md §2.2 / §3 (L5: may import L0..L4 only).
// Permitted imports: three, ../shared/*, ../core/*, ../physics/*.
// FORBIDDEN: ../render, ../world, ../ui, ../fx, ../ai, ../game, ../weapons.
//
// Everything numeric comes from ../shared/tuning.js. The four constants
// declared locally below are the ones FEEL.md needs but tuning.js does not
// carry — see DEFECTS.md row PLAYER-1.
//
// Headless: no DOM, no renderer, no wall clock. `update(dt, input)` is the
// only entry point and `dt` is always supplied by the caller.

import { Vector3 } from 'three';
import {
  GRAVITY,
  JUMP_VELOCITY,
  TERMINAL_VELOCITY,
  PLAYER,
  PLAYER_SHIELD_RATE,
  PLAYER_HEALTH_RATE,
  CAMERA,
} from '../shared/tuning.js';
import { DamageType, HitRegion, Faction } from '../shared/enums.js';
import { resolveDamage } from '../shared/damage.js';
import { Ev } from '../shared/events.js';
import { events as defaultBus } from '../core/events.js';
import { clamp, clamp01, smoothstep, lerp, moveToward3 } from '../shared/math.js';

// ---------------------------------------------------------------------------
// Derived from tuning.js — NOT new numbers.
// ---------------------------------------------------------------------------

/** Crouched capsule height. Derived so the head keeps the same clearance above
 *  the eye as when standing: 1.85 − (1.62 − 1.05) = 1.28 m. */
const CROUCH_HEIGHT = PLAYER.height - (PLAYER.eyeHeight - PLAYER.eyeHeightCrouched);

/** Critically-damped sway spring rate from the 90 ms spring in FEEL.md §2.2. */
const SWAY_OMEGA = 1 / CAMERA.swaySpring;

// ---------------------------------------------------------------------------
// NOT PRESENT IN shared/tuning.js. FEEL.md requires the behaviour but gives no
// number. Declared here rather than silently borrowing an unrelated constant.
// See DEFECTS.md row PLAYER-1 (addressed to the orchestrator).
// ---------------------------------------------------------------------------

/** Metres of ground travel per full bob cycle (= two footsteps). Set to the
 *  capsule's standing height, which is the usual stride≈height approximation. */
const BOB_STRIDE = PLAYER.height;

/** Downward bias applied while grounded so the capsule keeps surface contact
 *  across a tick. Small enough that the resting height error is < 1 µm. */
const GROUND_STICK = 0.002;

/** Downward probe used to detect touchdown on the exact tick the feet reach
 *  the surface. CharacterBody only reports `grounded` once it *penetrates*. */
const GROUND_PROBE = 0.02;

/** Degrees of weapon sway per rad/s of look rate, before the 3.2° clamp. */
const SWAY_GAIN = 26.0;

const MAX_PITCH = 89 * (Math.PI / 180);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Module scratch — the per-step path must not allocate.
// ---------------------------------------------------------------------------
const _disp = new Vector3();
const _probe = new Vector3();
const _wish = new Vector3();
const _vel2 = [0, 0, 0];
const DOWN = new Vector3(0, -1, 0);

const EMPTY_INPUT = Object.freeze({
  moveX: 0,
  moveZ: 0,
  lookYaw: 0,
  lookPitch: 0,
  jump: false,
  jumpPressed: false,
  crouch: false,
  hasLookInput: false,
});

// Pooled event payloads. ARCHITECTURE.md §4: handlers must not retain them.
const _pJump = { entityId: 0 };
const _pLanded = { entityId: 0, impactSpeed: 0, surfaceId: -1 };
const _pFoot = { entityId: 0, foot: 0, surfaceId: -1, speed: 0 };
const _pCrouch = { entityId: 0, crouched: false };
const _pHealth = { entityId: 0, health: 0, maxHealth: 0, shield: 0, maxShield: 0 };
const _pShieldBroken = { entityId: 0, overkill: 0, point: [0, 0, 0], normal: [0, 1, 0] };
const _pRecharge = { entityId: 0 };
const _pDamage = {
  targetId: 0,
  sourceId: 0,
  amount: 0,
  rawAmount: 0,
  damageType: 0,
  hitRegion: HitRegion.TORSO,
  point: [0, 0, 0],
  normal: [0, 1, 0],
  weaponId: null,
  absorbedByShield: false,
};
const _pRejected = { targetId: 0, reason: '' };
const _pKilled = {
  entityId: 0,
  killerId: 0,
  weaponId: null,
  hitRegion: HitRegion.TORSO,
  damageType: 0,
  position: [0, 0, 0],
};

/**
 * First-person capsule controller.
 *
 * Camera state is exposed as plain numbers (`eyePosition`, `yaw`, `pitch`,
 * `bobOffset`, `swayOffset`, `landingDip`, `fov`). This class owns NO
 * THREE.Camera — the game layer reads these and drives the camera itself.
 */
export class PlayerController {
  /**
   * @param {{physics:object, position?:Vector3, entityId?:number, bus?:object,
   *          faction?:number}} opts
   */
  constructor(opts) {
    const {
      physics,
      position = new Vector3(0, 0, 0),
      entityId = 1,
      bus = defaultBus,
      faction = Faction.PLAYER,
    } = opts;

    this.physics = physics;
    this.bus = bus;
    this.entityId = entityId;
    this.faction = faction;
    this.archetype = 'PLAYER';

    this.body = physics.addCharacter({
      position,
      radius: PLAYER.radius,
      height: PLAYER.height,
      stepHeight: PLAYER.stepHeight,
      maxSlopeDeg: PLAYER.maxSlopeDeg,
      entityId,
    });

    /** Authoritative velocity. CharacterBody.velocity is derived from position
     *  and is NOT used as an input — see src/physics/README.md. */
    this.velocity = new Vector3();

    this.yaw = 0;
    this.pitch = 0;
    /** Set by the game layer from WeaponSystem.getLookScale() (aim-assist turn
     *  friction, FEEL.md §4.8). Sideways L5 coupling is not allowed, so the
     *  weapon system never writes this directly. */
    this.lookScale = 1;

    this.grounded = false;
    this.crouched = false;
    this.speed = 0;

    this.eyeHeight = PLAYER.eyeHeight;
    this.eyePosition = new Vector3();
    this.bobOffset = { x: 0, y: 0 };
    this.swayOffset = { x: 0, y: 0 };
    this.landingDip = 0;
    this.fov = CAMERA.fovHorizontal;

    this.state = {
      shield: PLAYER.shield,
      maxShield: PLAYER.shield,
      health: PLAYER.health,
      maxHealth: PLAYER.health,
      dead: false,
    };

    // -- timers ---------------------------------------------------------
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._shieldDelay = 0;
    this._healthDelay = 0;
    this._recharging = false;
    this._landPenalty = 0;
    this._dipTimer = 0;
    this._crouchTarget = false;
    this._crouchT = 0;
    this._bobPhase = 0;
    this._footIndex = 0;
    this._swayVelX = 0;
    this._swayVelY = 0;
    this._firstUpdate = true;
    this._groundSurfaceId = -1;
    this._airborne = false;

    // External displacement (melee lunge pull) queued by the game layer.
    this._extraX = 0;
    this._extraY = 0;
    this._extraZ = 0;

    // Stable capsule record for weapons/targets.js. Mutated in place.
    this._capsule = {
      position: this.body.position,
      radius: PLAYER.radius,
      height: PLAYER.height,
      headHeight: 0.3,
    };
    this._forward = new Vector3(0, 0, -1);

    this._syncEye();
  }

  // -----------------------------------------------------------------------
  // Target-registry interface (weapons/targets.js shape). The game layer does
  // the registration; this class cannot import ../weapons (same layer).
  // -----------------------------------------------------------------------

  /** @returns {{position:Vector3, radius:number, height:number, headHeight:number}} stable object */
  getCapsule() {
    return this._capsule;
  }

  /** @returns {Vector3} stable object — horizontal facing. */
  getForward() {
    return this._forward;
  }

  // -----------------------------------------------------------------------

  /** Queue a world-space displacement to be applied on the next update (melee
   *  lunge pull). Consumed exactly once. */
  addDisplacement(x, y, z) {
    this._extraX += x;
    this._extraY += y;
    this._extraZ += z;
  }

  get position() {
    return this.body.position;
  }

  get alive() {
    return !this.state.dead;
  }

  /**
   * One fixed simulation step.
   * @param {number} dt seconds (always 1/120 in the shipped sim)
   * @param {object} input core/input.js InputState (or any duck-typed subset)
   */
  update(dt, input) {
    const st = input || EMPTY_INPUT;

    // ---- look ---------------------------------------------------------
    const ls = this.lookScale;
    this.yaw += (st.lookYaw || 0) * ls;
    if (this.yaw > Math.PI) this.yaw -= TAU;
    else if (this.yaw < -Math.PI) this.yaw += TAU;
    this.pitch = clamp(this.pitch + (st.lookPitch || 0) * ls, -MAX_PITCH, MAX_PITCH);

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // forward = (-sinY, 0, -cosY); right = (cosY, 0, -sinY)
    this._forward.set(-sinY, 0, -cosY);

    // ---- crouch -------------------------------------------------------
    this._updateCrouch(dt, st);
    const crouchE = smoothstep(this._crouchT);

    // ---- desired horizontal velocity ----------------------------------
    let mx = clamp(st.moveX || 0, -1, 1);
    let mz = clamp(st.moveZ || 0, -1, 1);
    let inLen = Math.hypot(mx, mz);
    if (inLen > 1) {
      mx /= inLen;
      mz /= inLen;
      inLen = 1;
    }

    const baseSpeed = lerp(PLAYER.speed, PLAYER.crouchSpeed, crouchE);
    let wishSpeed = 0;
    _wish.set(0, 0, 0);
    if (inLen > 1e-6) {
      const nx = mx / inLen;
      const nz = mz / inLen;
      // Elliptical speed limit: full speed forward, 90% strafe/back, and no
      // diagonal speed bonus (FEEL.md §2).
      const sx = baseSpeed * PLAYER.strafeFactor;
      const sz = nz >= 0 ? baseSpeed : baseSpeed * PLAYER.backFactor;
      const ex = nx / sx;
      const ez = nz / sz;
      wishSpeed = inLen / Math.sqrt(ex * ex + ez * ez);
      if (this._landPenalty > 0) wishSpeed *= PLAYER.landingPenaltyFactor;
      // world-space direction
      _wish.set(nx * cosY + nz * -sinY, 0, nx * -sinY + nz * -cosY);
    }

    // ---- jump ---------------------------------------------------------
    if (st.jumpPressed) this._jumpBuffer = PLAYER.jumpBuffer;
    let jumped = false;
    if (
      this._jumpBuffer > 0 &&
      !this.state.dead &&
      (this.grounded || this._coyote > 0) &&
      this._crouchT < 0.5
    ) {
      this.velocity.y = JUMP_VELOCITY;
      this._jumpBuffer = 0;
      this._coyote = 0;
      this.grounded = false;
      // CharacterBody.move() ground-snaps whenever it *was* grounded last
      // tick (src/physics/README.md "Ground snap"). Without clearing the flag
      // the snap yanks the capsule straight back onto the floor on the launch
      // tick and the jump never leaves the ground — measured apex 0.001 m,
      // airtime 0.017 s before this line existed.
      this.body.grounded = false;
      jumped = true;
      _pJump.entityId = this.entityId;
      this.bus.emit(Ev.PLAYER_JUMPED, _pJump);
    }

    // ---- horizontal acceleration --------------------------------------
    const tx = _wish.x * wishSpeed;
    const tz = _wish.z * wishSpeed;
    if (this.grounded && !jumped) {
      const accel = wishSpeed > 0 ? PLAYER.groundAccel : PLAYER.groundDecel;
      moveToward3(_vel2, this.velocity.x, 0, this.velocity.z, tx, 0, tz, accel * dt);
      this.velocity.x = _vel2[0];
      this.velocity.z = _vel2[2];
    } else if (wishSpeed > 0) {
      moveToward3(_vel2, this.velocity.x, 0, this.velocity.z, tx, 0, tz, PLAYER.airAccel * dt);
      this.velocity.x = _vel2[0];
      this.velocity.z = _vel2[2];
    }
    if (!this.grounded || jumped) {
      // Air control redirects, it never adds speed (FEEL.md F10).
      const hs = Math.hypot(this.velocity.x, this.velocity.z);
      if (hs > PLAYER.airSpeedCap) {
        const k = PLAYER.airSpeedCap / hs;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
    }

    // ---- vertical integration -----------------------------------------
    // Trapezoidal (exact for constant acceleration): dy = ½(v₀+v₁)·dt.
    // This is what makes apex land on 1.0500 m and airtime on 0.9500 s at
    // 120 Hz instead of drifting ±1.8% the way plain Euler does.
    let dy;
    if (this.grounded && !jumped && this.velocity.y <= 0) {
      this.velocity.y = 0;
      dy = -GROUND_STICK;
    } else {
      let vyNext = this.velocity.y - GRAVITY * dt;
      if (vyNext < -TERMINAL_VELOCITY) vyNext = -TERMINAL_VELOCITY;
      dy = 0.5 * (this.velocity.y + vyNext) * dt;
      this.velocity.y = vyNext;
    }

    // ---- move ----------------------------------------------------------
    const wasAirborne = this._airborne;
    _disp.set(
      this.velocity.x * dt + this._extraX,
      dy + this._extraY,
      this.velocity.z * dt + this._extraZ,
    );
    this._extraX = 0;
    this._extraY = 0;
    this._extraZ = 0;
    this.body.move(_disp);

    let grounded = this.body.grounded;
    let surfaceId = this.body.groundSurfaceId;

    // CharacterBody only reports `grounded` once the capsule actually
    // penetrates. Probe for a surface within GROUND_PROBE so touchdown is
    // registered on the exact tick the feet reach it (FEEL.md F08).
    if (!grounded && this.velocity.y <= 0) {
      _probe.set(this.body.position.x, this.body.position.y + PLAYER.radius, this.body.position.z);
      const hit = this.physics.sphereCast(_probe, DOWN, PLAYER.radius, GROUND_PROBE, null);
      if (hit && hit.normal.y >= Math.cos(PLAYER.maxSlopeDeg * (Math.PI / 180))) {
        grounded = true;
        surfaceId = hit.surfaceId;
        this.body.position.y -= hit.distance;
      }
    }

    this.grounded = grounded;
    this._airborne = !grounded;
    if (grounded) this._groundSurfaceId = surfaceId;

    // ---- landing -------------------------------------------------------
    if (grounded && wasAirborne && !this._firstUpdate) {
      const impact = Math.max(0, -this.velocity.y);
      this.velocity.y = 0;
      _pLanded.entityId = this.entityId;
      _pLanded.impactSpeed = impact;
      _pLanded.surfaceId = surfaceId;
      this.bus.emit(Ev.PLAYER_LANDED, _pLanded);
      if (impact > PLAYER.landingSoftThreshold) {
        this._landPenalty = PLAYER.landingPenaltyDuration;
        this._dipTimer = CAMERA.landingDipTime;
      }
      if (impact > PLAYER.fallDamageThreshold) {
        const dmg = (impact - PLAYER.fallDamageThreshold) * PLAYER.fallDamagePerMs;
        this.applyDamage(dmg, DamageType.FALL, HitRegion.TORSO, 0, null, 1);
      }
    } else if (grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }
    this._firstUpdate = false;

    // ---- timers --------------------------------------------------------
    if (grounded) this._coyote = PLAYER.coyoteTime;
    else if (this._coyote > 0) this._coyote -= dt;
    if (this._jumpBuffer > 0) this._jumpBuffer -= dt;
    if (this._landPenalty > 0) this._landPenalty -= dt;

    // ---- camera + footsteps --------------------------------------------
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this._updateCamera(dt, st, crouchE, sinY, cosY);

    // ---- shields / health ----------------------------------------------
    this._regen(dt);
  }

  // -----------------------------------------------------------------------

  _updateCrouch(dt, st) {
    const want = !!st.crouch;
    if (want !== this._crouchTarget) {
      if (want) {
        this._crouchTarget = true;
        this.crouched = true;
        _pCrouch.entityId = this.entityId;
        _pCrouch.crouched = true;
        this.bus.emit(Ev.PLAYER_CROUCH_CHANGED, _pCrouch);
      } else if (this.body.canStand(PLAYER.radius, PLAYER.height)) {
        this._crouchTarget = false;
        this.crouched = false;
        _pCrouch.entityId = this.entityId;
        _pCrouch.crouched = false;
        this.bus.emit(Ev.PLAYER_CROUCH_CHANGED, _pCrouch);
      }
    }
    const rate = dt / PLAYER.crouchTransition;
    this._crouchT = clamp01(this._crouchT + (this._crouchTarget ? rate : -rate));
    const e = smoothstep(this._crouchT);
    const h = lerp(PLAYER.height, CROUCH_HEIGHT, e);
    this.body.setRadiusHeight(PLAYER.radius, h);
    this._capsule.height = h;
    this._capsule.radius = PLAYER.radius;
    this.eyeHeight = lerp(PLAYER.eyeHeight, PLAYER.eyeHeightCrouched, e);
  }

  _updateCamera(dt, st, crouchE, sinY, cosY) {
    // --- view bob (FEEL.md §2.2) ---
    const frac = clamp01(this.speed / PLAYER.speed);
    if (this.grounded && this.speed > 0.05) {
      const prev = this._bobPhase;
      this._bobPhase += (TAU * this.speed) / BOB_STRIDE * dt;
      // one footstep per half cycle
      if (Math.floor(this._bobPhase / Math.PI) !== Math.floor(prev / Math.PI)) {
        this._footIndex ^= 1;
        _pFoot.entityId = this.entityId;
        _pFoot.foot = this._footIndex;
        _pFoot.surfaceId = this._groundSurfaceId;
        _pFoot.speed = this.speed;
        this.bus.emit(Ev.PLAYER_FOOTSTEP, _pFoot);
      }
      if (this._bobPhase > TAU * 1024) this._bobPhase -= TAU * 1024;
    }
    this.bobOffset.x = Math.sin(this._bobPhase) * CAMERA.bobLateral * frac;
    this.bobOffset.y = Math.sin(this._bobPhase * 2) * CAMERA.bobVertical * frac;

    // --- landing dip ---
    if (this._dipTimer > 0) {
      this._dipTimer -= dt;
      if (this._dipTimer < 0) this._dipTimer = 0;
      const t = this._dipTimer / CAMERA.landingDipTime; // 1 -> 0
      // ease-out: strongest immediately after contact
      this.landingDip = -CAMERA.landingDip * (t * t);
    } else {
      this.landingDip = 0;
    }

    // --- weapon sway: critically damped spring lagging the look input ---
    const rate = dt > 0 ? 1 / dt : 0;
    const tgtX = clamp(
      -(st.lookYaw || 0) * rate * SWAY_GAIN,
      -CAMERA.swayMaxDeg,
      CAMERA.swayMaxDeg,
    );
    const tgtY = clamp(
      -(st.lookPitch || 0) * rate * SWAY_GAIN,
      -CAMERA.swayMaxDeg,
      CAMERA.swayMaxDeg,
    );
    const w = SWAY_OMEGA;
    this._swayVelX += (-2 * w * this._swayVelX - w * w * (this.swayOffset.x - tgtX)) * dt;
    this._swayVelY += (-2 * w * this._swayVelY - w * w * (this.swayOffset.y - tgtY)) * dt;
    this.swayOffset.x = clamp(
      this.swayOffset.x + this._swayVelX * dt,
      -CAMERA.swayMaxDeg,
      CAMERA.swayMaxDeg,
    );
    this.swayOffset.y = clamp(
      this.swayOffset.y + this._swayVelY * dt,
      -CAMERA.swayMaxDeg,
      CAMERA.swayMaxDeg,
    );

    this._syncEye();
  }

  _syncEye() {
    const p = this.body.position;
    this.eyePosition.set(p.x, p.y + this.eyeHeight + this.landingDip, p.z);
  }

  // -----------------------------------------------------------------------
  // Shields / health — FEEL.md §3, assertions F12–F17.
  // -----------------------------------------------------------------------

  _regen(dt) {
    if (this.state.dead) return;
    const s = this.state;

    if (this._shieldDelay > 0) {
      this._shieldDelay -= dt;
    } else if (s.shield < s.maxShield) {
      if (!this._recharging) {
        this._recharging = true;
        _pRecharge.entityId = this.entityId;
        this.bus.emit(Ev.SHIELD_RECHARGE_START, _pRecharge);
      }
      s.shield = Math.min(s.maxShield, s.shield + PLAYER_SHIELD_RATE * dt);
      this._emitHealth();
      if (s.shield >= s.maxShield) {
        s.shield = s.maxShield;
        this._recharging = false;
        // FEEL.md F16: the 8 s health-regen delay is measured from the moment
        // shields reach full, not from the moment damage stopped.
        this._healthDelay = PLAYER.healthDelay;
        _pRecharge.entityId = this.entityId;
        this.bus.emit(Ev.SHIELD_RECHARGE_FULL, _pRecharge);
      }
    }

    // FEEL.md F15: health never regenerates while shields are below full.
    if (s.shield >= s.maxShield && s.health < s.maxHealth) {
      if (this._healthDelay > 0) {
        this._healthDelay -= dt;
      } else {
        s.health = Math.min(s.maxHealth, s.health + PLAYER_HEALTH_RATE * dt);
        this._emitHealth();
      }
    }
  }

  _emitHealth() {
    _pHealth.entityId = this.entityId;
    _pHealth.health = this.state.health;
    _pHealth.maxHealth = this.state.maxHealth;
    _pHealth.shield = this.state.shield;
    _pHealth.maxShield = this.state.maxShield;
    this.bus.emit(Ev.HEALTH_CHANGED, _pHealth);
  }

  /**
   * Apply damage to the player. Resolution goes through shared/damage.js — no
   * local damage arithmetic exists in this file.
   *
   * @returns {null|object} the resolveDamage() result, or null if rejected.
   */
  applyDamage(amount, damageType, hitRegion = HitRegion.TORSO, sourceId = 0, weaponId = null, headMult = 1, point = null, normal = null) {
    if (this.state.dead) {
      _pRejected.targetId = this.entityId;
      _pRejected.reason = 'dead';
      this.bus.emit(Ev.DAMAGE_REJECTED, _pRejected);
      return null;
    }
    const s = this.state;
    const res = resolveDamage(s, amount, damageType, hitRegion, headMult);
    const preShield = s.shield;
    s.shield = res.shield;
    s.health = res.health;

    // Any damage restarts both recharge clocks (FEEL.md F14).
    this._shieldDelay = PLAYER.shieldDelay;
    this._healthDelay = PLAYER.healthDelay;
    this._recharging = false;

    const px = point ? point[0] : this.eyePosition.x;
    const py = point ? point[1] : this.eyePosition.y;
    const pz = point ? point[2] : this.eyePosition.z;

    _pDamage.targetId = this.entityId;
    _pDamage.sourceId = sourceId;
    _pDamage.amount = res.applied;
    _pDamage.rawAmount = amount;
    _pDamage.damageType = damageType;
    _pDamage.hitRegion = hitRegion;
    _pDamage.point[0] = px;
    _pDamage.point[1] = py;
    _pDamage.point[2] = pz;
    _pDamage.normal[0] = normal ? normal[0] : 0;
    _pDamage.normal[1] = normal ? normal[1] : 1;
    _pDamage.normal[2] = normal ? normal[2] : 0;
    _pDamage.weaponId = weaponId;
    _pDamage.absorbedByShield = res.absorbedByShield;
    this.bus.emit(Ev.DAMAGE_APPLIED, _pDamage);

    if (res.shieldBroke) {
      _pShieldBroken.entityId = this.entityId;
      _pShieldBroken.overkill = Math.max(0, res.applied - preShield);
      _pShieldBroken.point[0] = px;
      _pShieldBroken.point[1] = py;
      _pShieldBroken.point[2] = pz;
      _pShieldBroken.normal[0] = normal ? normal[0] : 0;
      _pShieldBroken.normal[1] = normal ? normal[1] : 1;
      _pShieldBroken.normal[2] = normal ? normal[2] : 0;
      this.bus.emit(Ev.SHIELD_BROKEN, _pShieldBroken);
    }

    this._emitHealth();

    if (res.killed) {
      s.dead = true;
      const p = this.body.position;
      _pKilled.entityId = this.entityId;
      _pKilled.killerId = sourceId;
      _pKilled.weaponId = weaponId;
      _pKilled.hitRegion = hitRegion;
      _pKilled.damageType = damageType;
      _pKilled.position[0] = p.x;
      _pKilled.position[1] = p.y;
      _pKilled.position[2] = p.z;
      this.bus.emit(Ev.ENTITY_KILLED, _pKilled);
    }
    return res;
  }

  /** Full reset to spawn state. */
  respawn(position) {
    if (position) this.body.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.state.shield = this.state.maxShield;
    this.state.health = this.state.maxHealth;
    this.state.dead = false;
    this._shieldDelay = 0;
    this._healthDelay = 0;
    this._recharging = false;
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._landPenalty = 0;
    this._dipTimer = 0;
    this._firstUpdate = true;
    this._airborne = false;
    this.grounded = false;
    this._syncEye();
  }

  dispose() {
    this.physics.remove(this.body);
  }
}

export { CROUCH_HEIGHT, BOB_STRIDE, GROUND_PROBE, GROUND_STICK };
export default PlayerController;
