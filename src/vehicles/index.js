// L5 vehicles — the `Ridgeback` LRV. ARCHITECTURE.md §2.2, §3, §4.6; FEEL.md §5, §8 F43-F46.
// Headless: no `src/render` import. Owns a transform + state; the game layer binds a mesh.
// Permitted imports: three, ../shared/*, ../core/*, ../physics/*, ../weapons/targets.js (absent
// today — see README "Pending integrations").
//
// See README.md for the full physics model, the integration scheme, and honest limitations
// (in particular: what happens given physics's documented "dynamic bodies do not collide with
// each other" limitation).
import { Vector3, Quaternion, Euler } from 'three';
import { GRAVITY, RIDGEBACK, RIDGEBACK_DRIVE_ACCEL, CAMERA } from '../shared/tuning.js';
import { DamageType, HitRegion } from '../shared/enums.js';
import { Ev } from '../shared/events.js';
import { resolveDamage } from '../shared/damage.js';
import { clamp, clamp01, lerp, damp, DEG } from '../shared/math.js';
import { allocId } from '../core/ids.js';
import { rng } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Vehicle-owned constants. NOT in shared/tuning.js: FEEL.md/ARCHITECTURE.md do not specify
// chassis geometry, drivetrain distribution, tire slip curve shape, turret cooldown, ram-damage
// scale, or vehicle HP. Every one of these is a `vehicles`-local design decision, documented here
// and in README.md, and none of them re-declares a number that already exists in tuning.js.
// ---------------------------------------------------------------------------

// Chassis box half-extents, derived from the two dimensions FEEL.md DOES give (wheelBase,
// trackWidth) plus a reasonable overhang/height for an open LRV. Used only for the inertia
// tensor and the bounding-sphere used for chassis-vs-world collision (see README).
const CHASSIS_HALF_WIDTH = RIDGEBACK.trackWidth / 2 + 0.3; // 1.475 m — fenders
const CHASSIS_HALF_LENGTH = RIDGEBACK.wheelBase / 2 + 0.5; // 2.2 m — front/rear overhang
const CHASSIS_HALF_HEIGHT = 0.55; // 1.1 m chassis height, open cab + turret ring above

// Suspension geometry: FEEL.md gives `travel` (0.32) and `rest` (0.18) without a raycast
// formula. Interpreted here as: `rest` is the distance from the wheel mount to the wheel at
// full droop (zero spring force); `travel` is the compressible range above that. Total probe
// distance is therefore rest + travel. See README "Suspension model" for the full rationale.
const SUSPENSION_PROBE_MAX = RIDGEBACK.suspensionRest + RIDGEBACK.suspensionTravel; // 0.5 m
const WHEEL_MOUNT_Y = -0.3; // wheel mount local Y, relative to COM

// Inertia tensor (box, mass 2100 kg, dimensions above). Standard solid-box formula.
const CHASSIS_W = CHASSIS_HALF_WIDTH * 2;
const CHASSIS_H = CHASSIS_HALF_HEIGHT * 2;
const CHASSIS_L = CHASSIS_HALF_LENGTH * 2;
const INERTIA_XX = (RIDGEBACK.mass / 12) * (CHASSIS_H * CHASSIS_H + CHASSIS_L * CHASSIS_L);
const INERTIA_YY = (RIDGEBACK.mass / 12) * (CHASSIS_W * CHASSIS_W + CHASSIS_L * CHASSIS_L);
const INERTIA_ZZ = (RIDGEBACK.mass / 12) * (CHASSIS_W * CHASSIS_W + CHASSIS_H * CHASSIS_H);

// Bounding sphere for chassis-vs-world (wall) collision — see README "Known limitations".
const CHASSIS_BOUND_RADIUS = Math.hypot(CHASSIS_HALF_WIDTH, CHASSIS_HALF_HEIGHT, CHASSIS_HALF_LENGTH);

// Tire model (Pacejka-lite): peak slip angle where lateral force saturates.
const PEAK_SLIP_ANGLE = 8 * DEG;
// Angular velocity damping — prevents numerical spin runaway; small, arcade-appropriate.
const ANGULAR_DAMPING = 0.6; // 1/s
// Handbrake: rear wheels lose most longitudinal grip and some lateral grip (locked-wheel slide).
const HANDBRAKE_LONG_GRIP = 0.15;
const HANDBRAKE_LAT_GRIP = 0.55;
const HANDBRAKE_LOCK_DAMPING = 6000; // N·s/m, resists residual longitudinal slip while locked

// Turret. RPM/spin-up/overheat/pitch/damage all come from RIDGEBACK; cooldown duration and
// heat/spin-down rates are not specified by FEEL.md and are chosen to sit in the same band as
// the sandbox's other overheat lockouts (Ember Repeater: 3.4 s, FEEL.md §4.5).
const TURRET_WEAPON_ID = 'ridgeback_turret';
const TURRET_FIRE_INTERVAL = 60 / RIDGEBACK.turretRpm; // 0.125 s
const TURRET_COOLDOWN = 3.0; // s, lockout duration once overheated
const TURRET_SPINDOWN_RATE = 2.5; // spin-up drains 2.5x the rate it built, on trigger release
const TURRET_COOL_RATE = 1.5; // heat drains at 1.5 "seconds of fire" per second when not firing
const TURRET_RANGE = 200; // m
const TURRET_MOUNT_LOCAL = Object.freeze(new Vector3(0, CHASSIS_HALF_HEIGHT + 0.2, CHASSIS_HALF_LENGTH * 0.35));

// Ram damage: `raw = 0.5*m*v^2 * RAM_DAMAGE_SCALE`, fed into resolveDamage() as the pre-matrix
// amount. Scale chosen so that at the FEEL.md-specified lethal threshold (9 m/s) the raw amount
// comfortably clears a full-shield (70) + full-health (45) player through the VEHICLE damage
// matrix (1.0 vs shield, 1.3 vs health): raw(9) = 0.5*2100*81 = 85050 J; at scale 0.0014 that is
// ~119, which strips 70 shield and leaves 49*1.3 = 63.8 into health — comfortably lethal to 45.
const RAM_DAMAGE_SCALE = 0.0014;

// Rollover-eject impact damage above ejectSafeSpeed (12 m/s, F45's threshold — the value itself
// IS RIDGEBACK.ejectSafeSpeed). The per-(m/s) rate is not specified; FEEL.md's own FALL damage
// model (§2: `(v-8.5)*9.0`) is the closest sanctioned analogue in this sandbox, so the same rate
// is reused here for consistency, applied through the VEHICLE damage type.
const EJECT_DAMAGE_RATE = 9.0;

// Vehicle hit points. Not specified anywhere in FEEL.md/tuning.js (no vehicle health table
// exists yet). Chosen to survive several kinetic hits but die to sustained fire or explosives.
const VEHICLE_HEALTH = 400;

const WORLD_UP = Object.freeze(new Vector3(0, 1, 0));

// ---------------------------------------------------------------------------
// Module-level scratch. Vehicle._step is called sequentially (never re-entrantly) across
// vehicles, so sharing scratch across instances is safe and keeps the step loop allocation-free.
// ---------------------------------------------------------------------------
const _up = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _flatFwd = new Vector3();
const _mountLocal = new Vector3();
const _mountWorld = new Vector3();
const _rayDir = new Vector3();
const _contactPoint = new Vector3();
const _r = new Vector3();
const _contactVel = new Vector3();
const _angContrib = new Vector3();
const _wheelFwd = new Vector3();
const _wheelRight = new Vector3();
const _forceVec = new Vector3();
const _torqueContrib = new Vector3();
const _forceAccum = new Vector3();
const _torqueAccum = new Vector3();
const _invQuat = new Quaternion();
const _torqueLocal = new Vector3();
const _angAccelLocal = new Vector3();
const _angAccelWorld = new Vector3();
const _deltaQuat = new Quaternion();
const _muzzle = new Vector3();
const _muzzleDir = new Vector3();
const _rayOrigin = new Vector3();
const _velDir = new Vector3();
const _chaseDesiredPos = new Vector3();
const _chaseForward = new Vector3();
const _euler = new Euler();
const _uprightQuat = new Quaternion();

function rng3Kick(out, r, horizontalMag, upMag) {
  const a = r.next() * Math.PI * 2;
  out.set(Math.cos(a) * horizontalMag, upMag, Math.sin(a) * horizontalMag);
  return out;
}

/**
 * The Ridgeback LRV. See FEEL.md §5, §8 (F43-F46) and this directory's README.md.
 * Headless: exposes a transform + state, never a mesh.
 */
export class Vehicle {
  constructor({ physics, events, position, yaw = 0, resolveDamageTarget = null }) {
    this.vehicleId = allocId();
    this.physics = physics;
    this.events = events;
    this.resolveDamageTarget = resolveDamageTarget;

    this.position = position ? position.clone() : new Vector3();
    this.quaternion = new Quaternion().setFromAxisAngle(WORLD_UP, yaw);
    this.velocity = new Vector3();
    this.angularVelocity = new Vector3();
    this.speed = 0;

    this.mass = RIDGEBACK.mass;

    this.wheels = [
      this._makeWheel(-RIDGEBACK.trackWidth / 2, -RIDGEBACK.wheelBase / 2, true), // FL
      this._makeWheel(RIDGEBACK.trackWidth / 2, -RIDGEBACK.wheelBase / 2, true), // FR
      this._makeWheel(-RIDGEBACK.trackWidth / 2, RIDGEBACK.wheelBase / 2, false), // RL
      this._makeWheel(RIDGEBACK.trackWidth / 2, RIDGEBACK.wheelBase / 2, false), // RR
    ];

    this.seats = { driver: 0, gunner: 0 };

    this.upright01 = 1;
    this.rolled = false;
    this.disabled = false;
    this.destroyed = false;
    this.health = VEHICLE_HEALTH;

    this.turret = {
      yaw: 0,
      pitch: 0,
      spinUp: 0,
      heat: 0,
      overheated: false,
      cooldownTimer: 0,
      fireTimer: 0,
    };

    this._driverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this._empTimer = 0;
    this._turretWantsFire = false;

    this._rolloverTimer = 0;
    this._selfRightHeld = 0;
    this._selfRightCalledThisTick = false;

    // Last ejection toss impulses, keyed by seat — headless vehicles cannot ragdoll an
    // occupant themselves (that's `characters`/`playerctl`'s job); this is the recommended
    // toss vector for whichever system owns the ejected entity's physics. See README.
    this.lastEjectImpulse = { driver: null, gunner: null };

    // Chase camera spring state (position + fov only — no camera object is owned here).
    this._chasePos = new Vector3();
    this._chaseLookAt = new Vector3();
    this._chaseFov = CAMERA.fovHorizontal;
    this._chaseInit = false;

    this._rngStream = rng('vehicles');
  }

  _makeWheel(x, z, isFront) {
    return {
      localMount: new Vector3(x, WHEEL_MOUNT_Y, z),
      worldPosition: new Vector3(),
      compression01: 0,
      spinAngle: 0,
      steerAngle: 0,
      grounded: false,
      isFront,
      _contactPoint: new Vector3(),
      _contactNormal: new Vector3(),
    };
  }

  // -- public control surface ------------------------------------------------

  enter(entityId, seat) {
    if (seat !== 'driver' && seat !== 'gunner') return false;
    if (this.seats[seat]) return false;
    this.seats[seat] = entityId;
    this.events.emit(Ev.VEHICLE_ENTERED, { entityId, vehicleId: this.vehicleId, seat });
    return true;
  }

  exit(entityId) {
    for (const seat of /** @type {const} */ (['driver', 'gunner'])) {
      if (this.seats[seat] === entityId) {
        this.seats[seat] = 0;
        this.events.emit(Ev.VEHICLE_EXITED, {
          entityId,
          vehicleId: this.vehicleId,
          seat,
          ejected: false,
        });
        return true;
      }
    }
    return false;
  }

  setDriverInput({ throttle = 0, brake = 0, steer = 0, handbrake = 0 }) {
    this._driverInput.throttle = clamp(throttle, -1, 1);
    this._driverInput.brake = clamp01(brake);
    this._driverInput.steer = clamp(steer, -1, 1);
    this._driverInput.handbrake = clamp01(handbrake);
  }

  /** Radians. Yaw is free (360°); pitch is clamped to RIDGEBACK.turretPitchMin/Max. */
  setTurretAim(yaw, pitch) {
    this.turret.yaw = yaw;
    this.turret.pitch = clamp(pitch, RIDGEBACK.turretPitchMin * DEG, RIDGEBACK.turretPitchMax * DEG);
  }

  /** Call every tick the gunner holds the trigger — same "hold" contract as selfRight(). */
  fireTurret() {
    this._turretWantsFire = true;
  }

  applyEmp(seconds = RIDGEBACK.empDisableTime) {
    this._empTimer = Math.max(this._empTimer, seconds);
  }

  /**
   * Call every tick the driver holds interact while `rolled`. Flips the vehicle upright once
   * held continuously for RIDGEBACK.selfRightHold (1.2 s, F46). Any tick this is NOT called
   * resets the accumulated hold time to 0 — see README "Self-right" for why the API is shaped
   * this way given the fixed constructor/method signatures in the brief.
   */
  selfRight(byEntityId = this.seats.driver || this.seats.gunner || 0) {
    this._selfRightCalledThisTick = true;
    if (!this.rolled) {
      this._selfRightHeld = 0;
      return false;
    }
    this._selfRightHeld += this._lastDt || 0;
    if (this._selfRightHeld >= RIDGEBACK.selfRightHold) {
      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      _uprightQuat.setFromEuler(_euler.set(0, _euler.y, 0, 'YXZ'));
      this.quaternion.copy(_uprightQuat);
      this.position.y += CHASSIS_HALF_HEIGHT + 0.3;
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.rolled = false;
      this._rolloverTimer = 0;
      this._selfRightHeld = 0;
      this.events.emit(Ev.VEHICLE_FLIPPED, { vehicleId: this.vehicleId, byEntityId });
      return true;
    }
    return false;
  }

  /** Vehicles-local addition (not in the brief's literal API) so a future `weapons`/`ai` hit
   * pipeline has something to call once it exists. See README "Pending integrations". */
  applyDamage(amount, damageType, hitRegion = HitRegion.TORSO) {
    if (this.destroyed) return;
    const result = resolveDamage({ shield: 0, health: this.health }, amount, damageType, hitRegion);
    this.health = result.health;
    if (result.killed && !this.destroyed) {
      this.destroyed = true;
      this.events.emit(Ev.VEHICLE_DESTROYED, { vehicleId: this.vehicleId, position: this.position.toArray() });
    }
    return result;
  }

  /** Chase camera STATE only — FEEL.md §5, no camera object owned here. */
  getChaseCameraTarget() {
    return { position: this._chasePos, lookAt: this._chaseLookAt, fov: this._chaseFov };
  }

  // -- simulation --------------------------------------------------------------

  _step(dt) {
    this._lastDt = dt;
    if (this.destroyed) return;

    _forceAccum.set(0, 0, 0);
    _torqueAccum.set(0, 0, 0);

    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    _fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const forwardSpeed = this.velocity.dot(_fwd);
    const canDrive = !this.disabled && !this.rolled;
    const steerLerp = clamp01(Math.abs(forwardSpeed) / RIDGEBACK.maxSpeed);
    const maxSteerRad = lerp(RIDGEBACK.steerMaxDeg, RIDGEBACK.steerMinDeg, steerLerp) * DEG;
    const steerAngle = canDrive ? this._driverInput.steer * maxSteerRad : 0;

    // Engine force: constant net acceleration up to the governed top speed (see README "Drive
    // model" for why no separate drag term is layered underneath it).
    let driveAccel = 0;
    if (canDrive) {
      const t = this._driverInput.throttle;
      if (t > 0 && forwardSpeed < RIDGEBACK.maxSpeed) driveAccel = RIDGEBACK_DRIVE_ACCEL * t;
      else if (t < 0 && forwardSpeed > -RIDGEBACK.maxReverse) driveAccel = RIDGEBACK_DRIVE_ACCEL * t;
    }
    const driveForcePerRearWheel = canDrive && !(this._driverInput.handbrake > 0.5) ? (this.mass * driveAccel) / 2 : 0;
    const brakeForceMag = canDrive ? this.mass * RIDGEBACK.brakeDecel * this._driverInput.brake : 0;

    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      _mountLocal.copy(w.localMount);
      _mountWorld.copy(_mountLocal).applyQuaternion(this.quaternion).add(this.position);
      _rayDir.copy(_up).multiplyScalar(-1);

      const hit = this.physics.raycast(_mountWorld, _rayDir, SUSPENSION_PROBE_MAX, null);
      let hitDistance = SUSPENSION_PROBE_MAX;
      let grounded = false;
      if (hit) {
        hitDistance = hit.distance;
        grounded = true;
        w._contactPoint.copy(hit.point);
        w._contactNormal.copy(hit.normal);
      }
      w.grounded = grounded;
      const compression = clamp(SUSPENSION_PROBE_MAX - hitDistance, 0, RIDGEBACK.suspensionTravel);
      w.compression01 = compression / RIDGEBACK.suspensionTravel;

      _contactPoint.copy(_mountWorld).addScaledVector(_rayDir, hitDistance);
      w.worldPosition.copy(_contactPoint).addScaledVector(_up, RIDGEBACK.wheelRadius);

      if (!grounded) {
        w.steerAngle = w.isFront ? steerAngle : 0;
        continue;
      }

      _r.copy(_contactPoint).sub(this.position);
      _contactVel.copy(this.velocity);
      _angContrib.crossVectors(this.angularVelocity, _r);
      _contactVel.add(_angContrib);

      const compressionVel = -_contactVel.dot(_up);
      let fs = RIDGEBACK.springK * compression + RIDGEBACK.damperC * compressionVel;
      if (fs < 0) fs = 0;
      // COMPENSATION REMOVED (DEFECTS.md VEH1-C, closed). The upstream cause —
      // rayObb picking the wrong face on an anisotropic box — is fixed in
      // src/physics/geometry.js, so hit.normal is now trustworthy. Suspension
      // force is still applied along the vehicle's own local up axis, which is
      // a deliberate modelling choice rather than a workaround: de-rating by
      // the ground normal makes the chassis slide on the gentle terrain slopes
      // this level is built from. Slope de-rating remains unimplemented and is
      // recorded as a limitation in this directory's README, not as a defect.
      _forceVec.copy(_up).multiplyScalar(fs);
      _forceAccum.add(_forceVec);
      _torqueContrib.crossVectors(_r, _forceVec);
      _torqueAccum.add(_torqueContrib);

      const steer = w.isFront ? steerAngle : 0;
      w.steerAngle = steer;
      const cs = Math.cos(steer);
      const sn = Math.sin(steer);
      _wheelFwd.copy(_fwd).multiplyScalar(cs).addScaledVector(_right, sn);
      _wheelRight.copy(_right).multiplyScalar(cs).addScaledVector(_fwd, -sn);

      const longVel = _contactVel.dot(_wheelFwd);
      const latVel = _contactVel.dot(_wheelRight);

      const handbraked = this._driverInput.handbrake > 0.5 && !w.isFront;
      const gripLong = handbraked ? RIDGEBACK.tyreLongitudinal * HANDBRAKE_LONG_GRIP : RIDGEBACK.tyreLongitudinal;
      const gripLat = handbraked ? RIDGEBACK.tyreLateral * HANDBRAKE_LAT_GRIP : RIDGEBACK.tyreLateral;

      let longForceRaw = 0;
      if (!w.isFront) longForceRaw += driveForcePerRearWheel;
      longForceRaw += -Math.sign(longVel || 0) * Math.min(Math.abs(longVel) * 400, brakeForceMag / 4);
      if (handbraked) longForceRaw += -longVel * HANDBRAKE_LOCK_DAMPING;

      const slipAngle = Math.atan2(latVel, Math.abs(longVel) + 0.5);
      const normSlip = clamp(slipAngle / PEAK_SLIP_ANGLE, -1, 1);
      let latForceRaw = -Math.sin(normSlip * (Math.PI / 2)) * gripLat * fs;

      const maxLong = gripLong * fs;
      const maxLat = gripLat * fs;
      if (maxLong > 1e-6 && maxLat > 1e-6) {
        const ex = longForceRaw / maxLong;
        const ey = latForceRaw / maxLat;
        const mag2 = ex * ex + ey * ey;
        if (mag2 > 1) {
          const scale = 1 / Math.sqrt(mag2);
          longForceRaw *= scale;
          latForceRaw *= scale;
        }
      } else {
        longForceRaw = 0;
        latForceRaw = 0;
      }

      _forceVec.copy(_wheelFwd).multiplyScalar(longForceRaw).addScaledVector(_wheelRight, latForceRaw);
      _forceAccum.add(_forceVec);
      _torqueContrib.crossVectors(_r, _forceVec);
      _torqueAccum.add(_torqueContrib);

      w.spinAngle += (longVel / RIDGEBACK.wheelRadius) * dt;
    }

    // Gravity — the single shared GRAVITY constant, no per-object scale (F50).
    _forceAccum.y -= this.mass * GRAVITY;

    // Chassis-vs-world collision (bounding sphere; see README "Known limitations"). This is a
    // WALL/obstacle probe only — ground contact is the suspension raycasts' job exclusively.
    // A near-vertical hit normal (normal.y > 0.6) is treated as "floor-like" and ignored here,
    // otherwise this sphere (which must be large enough to cover the chassis footprint) would
    // permanently overlap flat ground at normal ride height and fight the suspension every tick.
    const speedNow = this.velocity.length();
    if (speedNow > 0.05) {
      _velDir.copy(this.velocity).divideScalar(speedNow);
      _rayOrigin.copy(this.position);
      const hit = this.physics.sphereCast(_rayOrigin, _velDir, CHASSIS_BOUND_RADIUS, speedNow * dt + 0.05, null);
      if (hit && hit.distance <= speedNow * dt && hit.normal.y <= 0.6) {
        const impactSpeed = -this.velocity.dot(hit.normal);
        if (impactSpeed > 0) {
          this.events.emit(Ev.VEHICLE_IMPACT, {
            vehicleId: this.vehicleId,
            otherId: hit.entityId,
            relativeSpeed: impactSpeed,
            normal: [hit.normal.x, hit.normal.y, hit.normal.z],
          });
          if (hit.entityId && impactSpeed > RIDGEBACK.ramLethalSpeed && this.resolveDamageTarget) {
            const target = this.resolveDamageTarget(hit.entityId);
            if (target) {
              const raw = 0.5 * this.mass * impactSpeed * impactSpeed * RAM_DAMAGE_SCALE;
              const result = resolveDamage(target, raw, DamageType.VEHICLE, HitRegion.TORSO);
              target.shield = result.shield;
              target.health = result.health;
              this.events.emit(Ev.DAMAGE_APPLIED, {
                targetId: hit.entityId,
                sourceId: this.vehicleId,
                amount: result.applied,
                rawAmount: raw,
                damageType: DamageType.VEHICLE,
                hitRegion: HitRegion.TORSO,
                point: [hit.point.x, hit.point.y, hit.point.z],
                normal: [hit.normal.x, hit.normal.y, hit.normal.z],
                weaponId: 'ridgeback_ram',
                absorbedByShield: result.absorbedByShield,
              });
            }
          }
          // Inelastic-ish response: kill the inward normal component, damp the tangential one.
          const vn = this.velocity.dot(hit.normal);
          if (vn < 0) {
            this.velocity.addScaledVector(hit.normal, -vn * 1.15);
            this.velocity.multiplyScalar(0.85);
          }
          this.position.addScaledVector(hit.normal, 0.02);
        }
      }
    }

    // Linear integration.
    this.velocity.addScaledVector(_forceAccum, dt / this.mass);
    this.position.addScaledVector(this.velocity, dt);

    // Angular integration: torque -> local-frame angular acceleration -> world.
    _invQuat.copy(this.quaternion).invert();
    _torqueLocal.copy(_torqueAccum).applyQuaternion(_invQuat);
    _angAccelLocal.set(_torqueLocal.x / INERTIA_XX, _torqueLocal.y / INERTIA_YY, _torqueLocal.z / INERTIA_ZZ);
    _angAccelWorld.copy(_angAccelLocal).applyQuaternion(this.quaternion);
    this.angularVelocity.addScaledVector(_angAccelWorld, dt);
    this.angularVelocity.multiplyScalar(Math.max(0, 1 - ANGULAR_DAMPING * dt));

    const angSpeed = this.angularVelocity.length();
    if (angSpeed > 1e-9) {
      // setFromAxisAngle needs a normalized axis; angularVelocity isn't one, so pass its
      // normalized direction (reusing _torqueLocal as scratch — no longer needed this tick)
      // and the true rotation angle (angSpeed*dt) explicitly.
      _torqueLocal.copy(this.angularVelocity).divideScalar(angSpeed);
      _deltaQuat.setFromAxisAngle(_torqueLocal, angSpeed * dt);
      this.quaternion.premultiply(_deltaQuat);
      this.quaternion.normalize();
    }

    this.speed = this.velocity.length();

    // Rollover detection (F44). Lateral acceleration is read directly off this tick's force
    // accumulator (== mass*accel), not a finite difference of velocity — exact, not noisy.
    const lateralAccel = _forceAccum.dot(_right) / this.mass;
    const uprightDot = _up.dot(WORLD_UP);
    this.upright01 = clamp01((uprightDot + 1) * 0.5);

    if (Math.abs(lateralAccel) > RIDGEBACK.rolloverG * GRAVITY) this._rolloverTimer += dt;
    else this._rolloverTimer = 0;

    if (!this.rolled && (this._rolloverTimer >= RIDGEBACK.rolloverHold || uprightDot < RIDGEBACK.uprightDotFail)) {
      this._triggerRollover(uprightDot);
    }

    // Self-right hold: if selfRight() wasn't called this tick, the hold resets.
    if (!this._selfRightCalledThisTick) this._selfRightHeld = 0;
    this._selfRightCalledThisTick = false;

    // EMP.
    if (this._empTimer > 0) {
      this._empTimer = Math.max(0, this._empTimer - dt);
    }
    this.disabled = this._empTimer > 0;

    this._stepTurret(dt);
    this._stepChaseCamera(dt);
  }

  _triggerRollover(uprightDot) {
    this.rolled = true;
    this._rolloverTimer = 0;
    this.events.emit(Ev.VEHICLE_ROLLED, { vehicleId: this.vehicleId, uprightDot });

    const impactSpeed = this.speed;
    for (const seat of /** @type {const} */ (['driver', 'gunner'])) {
      const occupant = this.seats[seat];
      if (!occupant) continue;
      this.seats[seat] = 0;
      // Light ragdoll toss — FEEL.md §5 "funny, not punishing". Vehicles is headless and does
      // not own ragdoll physics; this vector is offered for whichever system does. See README.
      const toss = new Vector3();
      rng3Kick(toss, this._rngStream, 1.5 + this._rngStream.next() * 1.0, 3.0 + this._rngStream.next() * 1.5);
      this.lastEjectImpulse[seat] = toss;

      this.events.emit(Ev.VEHICLE_EXITED, {
        entityId: occupant,
        vehicleId: this.vehicleId,
        seat,
        ejected: true,
      });

      // F45: no damage below ejectSafeSpeed (12 m/s).
      if (impactSpeed > RIDGEBACK.ejectSafeSpeed && this.resolveDamageTarget) {
        const target = this.resolveDamageTarget(occupant);
        if (target) {
          const raw = (impactSpeed - RIDGEBACK.ejectSafeSpeed) * EJECT_DAMAGE_RATE;
          const result = resolveDamage(target, raw, DamageType.VEHICLE, HitRegion.TORSO);
          target.shield = result.shield;
          target.health = result.health;
          this.events.emit(Ev.DAMAGE_APPLIED, {
            targetId: occupant,
            sourceId: this.vehicleId,
            amount: result.applied,
            rawAmount: raw,
            damageType: DamageType.VEHICLE,
            hitRegion: HitRegion.TORSO,
            point: [this.position.x, this.position.y, this.position.z],
            normal: [0, 1, 0],
            weaponId: 'ridgeback_rollover',
            absorbedByShield: result.absorbedByShield,
          });
        }
      }
    }
  }

  _stepTurret(dt) {
    const t = this.turret;
    if (t.overheated) {
      t.cooldownTimer -= dt;
      if (t.cooldownTimer <= 0) {
        t.overheated = false;
        t.heat = 0;
        this.events.emit(Ev.WEAPON_COOLED, { ownerId: this.vehicleId, weaponId: TURRET_WEAPON_ID });
      }
    }

    const wantsFire = this._turretWantsFire && !this.disabled && !this.rolled && !t.overheated;
    this._turretWantsFire = false;

    if (wantsFire) {
      t.spinUp = Math.min(t.spinUp + dt, RIDGEBACK.turretSpinUp);
      if (t.spinUp >= RIDGEBACK.turretSpinUp) {
        t.heat += dt;
        if (t.heat >= RIDGEBACK.turretOverheat) {
          t.overheated = true;
          t.cooldownTimer = TURRET_COOLDOWN;
          this.events.emit(Ev.WEAPON_OVERHEAT, { ownerId: this.vehicleId, weaponId: TURRET_WEAPON_ID });
        } else {
          t.fireTimer -= dt;
          let guard = 0;
          while (t.fireTimer <= 0 && guard < 16) {
            this._fireTurretRound();
            t.fireTimer += TURRET_FIRE_INTERVAL;
            guard++;
          }
        }
      }
    } else {
      t.spinUp = Math.max(0, t.spinUp - dt * TURRET_SPINDOWN_RATE);
      t.heat = Math.max(0, t.heat - dt * TURRET_COOL_RATE);
      t.fireTimer = 0;
    }
  }

  _fireTurretRound() {
    _muzzle.copy(TURRET_MOUNT_LOCAL).applyQuaternion(this.quaternion).add(this.position);
    // Turret yaw/pitch compose on top of the hull yaw: build the aim direction in hull-local
    // space, then rotate into world space by the hull quaternion.
    const cy = Math.cos(this.turret.yaw);
    const sy = Math.sin(this.turret.yaw);
    const cp = Math.cos(this.turret.pitch);
    const sp = Math.sin(this.turret.pitch);
    _muzzleDir.set(-sy * cp, sp, -cy * cp).applyQuaternion(this.quaternion).normalize();

    const seed = this._rngStream.nextUint();
    this.events.emit(Ev.WEAPON_FIRED, {
      ownerId: this.vehicleId,
      weaponId: TURRET_WEAPON_ID,
      muzzle: [_muzzle.x, _muzzle.y, _muzzle.z],
      direction: [_muzzleDir.x, _muzzleDir.y, _muzzleDir.z],
      seed,
      ammoRemaining: Infinity,
      isFirstOfBurst: true,
    });

    const hit = this.physics.raycast(_muzzle, _muzzleDir, TURRET_RANGE, null);
    if (!hit) return;

    this.events.emit(Ev.SURFACE_IMPACT, {
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      surfaceId: hit.surfaceId,
      energy: RIDGEBACK.turretDamage,
      damageType: DamageType.KINETIC,
      sourceId: this.vehicleId,
    });

    if (hit.entityId && this.resolveDamageTarget) {
      const target = this.resolveDamageTarget(hit.entityId);
      if (target) {
        const result = resolveDamage(target, RIDGEBACK.turretDamage, DamageType.KINETIC, HitRegion.TORSO);
        target.shield = result.shield;
        target.health = result.health;
        this.events.emit(Ev.DAMAGE_APPLIED, {
          targetId: hit.entityId,
          sourceId: this.vehicleId,
          amount: result.applied,
          rawAmount: RIDGEBACK.turretDamage,
          damageType: DamageType.KINETIC,
          hitRegion: HitRegion.TORSO,
          point: [hit.point.x, hit.point.y, hit.point.z],
          normal: [hit.normal.x, hit.normal.y, hit.normal.z],
          weaponId: TURRET_WEAPON_ID,
          absorbedByShield: result.absorbedByShield,
        });
      }
    }
  }

  _stepChaseCamera(dt) {
    _flatFwd.set(_fwd.x, 0, _fwd.z);
    if (_flatFwd.lengthSq() < 1e-9) _flatFwd.set(0, 0, -1);
    else _flatFwd.normalize();

    _chaseDesiredPos
      .copy(this.position)
      .addScaledVector(_flatFwd, -RIDGEBACK.chaseBack)
      .addScaledVector(WORLD_UP, RIDGEBACK.chaseUp);
    _chaseForward.copy(this.position).addScaledVector(WORLD_UP, 0.6);

    const lambda = 1 / RIDGEBACK.chaseSpring;
    if (!this._chaseInit) {
      this._chasePos.copy(_chaseDesiredPos);
      this._chaseLookAt.copy(_chaseForward);
      this._chaseInit = true;
    } else {
      this._chasePos.x = damp(this._chasePos.x, _chaseDesiredPos.x, lambda, dt);
      this._chasePos.y = damp(this._chasePos.y, _chaseDesiredPos.y, lambda, dt);
      this._chasePos.z = damp(this._chasePos.z, _chaseDesiredPos.z, lambda, dt);
      this._chaseLookAt.x = damp(this._chaseLookAt.x, _chaseForward.x, lambda, dt);
      this._chaseLookAt.y = damp(this._chaseLookAt.y, _chaseForward.y, lambda, dt);
      this._chaseLookAt.z = damp(this._chaseLookAt.z, _chaseForward.z, lambda, dt);
    }

    const speedLerp = clamp01(this.speed / RIDGEBACK.maxSpeed);
    const targetFov = lerp(CAMERA.fovHorizontal, RIDGEBACK.chaseFovMax, speedLerp);
    this._chaseFov = damp(this._chaseFov, targetFov, lambda, dt);
  }
}

/**
 * Public entry point. ARCHITECTURE.md §2.2: `vehicles` owns `src/vehicles/**`, talks to the
 * rest of the game only through the event bus and the transform it exposes.
 */
export class VehicleSystem {
  constructor({ physics, events, resolveDamageTarget = null } = {}) {
    this.physics = physics;
    this.events = events;
    this.resolveDamageTarget = resolveDamageTarget;
    this.vehicles = [];
    this._byId = new Map();
  }

  spawn({ type = 'ridgeback', position, yaw = 0 }) {
    if (type !== 'ridgeback') {
      throw new Error(`VehicleSystem.spawn: unknown vehicle type "${type}" (only "ridgeback" exists)`);
    }
    const vehicle = new Vehicle({
      physics: this.physics,
      events: this.events,
      position,
      yaw,
      resolveDamageTarget: this.resolveDamageTarget,
    });
    this.vehicles.push(vehicle);
    this._byId.set(vehicle.vehicleId, vehicle);
    return vehicle;
  }

  despawn(vehicleId) {
    const vehicle = this._byId.get(vehicleId);
    if (!vehicle) return;
    for (const seat of /** @type {const} */ (['driver', 'gunner'])) {
      const occupant = vehicle.seats[seat];
      if (occupant) {
        vehicle.seats[seat] = 0;
        this.events.emit(Ev.VEHICLE_EXITED, { entityId: occupant, vehicleId, seat, ejected: false });
      }
    }
    this._byId.delete(vehicleId);
    const i = this.vehicles.indexOf(vehicle);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  update(dt) {
    for (let i = 0; i < this.vehicles.length; i++) this.vehicles[i]._step(dt);
  }
}
