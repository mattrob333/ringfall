// L5 weapons — the sandbox: two carried weapons, firing, ballistics, aim
// assist, grenades, melee. Owner: `sandbox`.
// ARCHITECTURE.md §2.2 / §3 — may import L0..L4 only (three, ../shared/*,
// ../core/*, ../physics/*). FORBIDDEN: ../render, ../world, ../ui, ../fx,
// ../ai, ../game, ../player.
//
// Headless by construction: nothing here touches the DOM, a renderer, a wall
// clock, or Math.random. All randomness comes from named rng() streams.
//
// Integration contract for the game layer (L6):
//   1. physics.step(dt)                      — integrates grenade bodies
//   2. player.update(dt, input)
//   3. weapons.update(dt, input, player)     — reads eyePosition/yaw/pitch
//   4. player.lookScale = weapons.getLookScale()
//   5. if (weapons.consumeLunge(v)) player.addDisplacement(v.x, v.y, v.z)
//   6. camera yaw/pitch += weapons.recoilYaw / weapons.recoilPitch

import { Vector3 } from 'three';
import {
  AIM_ASSIST,
  GRENADE,
  MELEE,
  WEAPON_SWAP_TIME,
  MAX_WEAPONS,
  GRAVITY,
} from '../shared/tuning.js';
import {
  DamageType,
  HitRegion,
  Faction,
  SurfaceId,
  STICKY_SURFACES,
} from '../shared/enums.js';
import { resolveDamage, blastFalloff } from '../shared/damage.js';
import { Ev } from '../shared/events.js';
import { events as defaultBus } from '../core/events.js';
import { rng } from '../core/rng.js';
import { allocId } from '../core/ids.js';
import { clamp, clamp01, DEG, RAD } from '../shared/math.js';
import { WEAPONS, weaponDef, FireMode, AmmoKind, Optic } from './defs.js';
import { TargetRegistry, targets as defaultTargets } from './targets.js';

export { WEAPONS, weaponDef, FireMode, AmmoKind, Optic } from './defs.js';
export { TargetRegistry, registerTarget, unregisterTarget, targets } from './targets.js';

const MAX_TRACE = 500; // metres — hitscan cutoff
const MAX_SHOTS_PER_TICK = 8; // runaway guard for the auto-fire catch-up loop
const MELEE_CONE_COS = Math.cos(60 * DEG);

// ---------------------------------------------------------------------------
// Module scratch. The per-step path must not allocate.
// ---------------------------------------------------------------------------
const _dir = new Vector3();
const _dir2 = new Vector3();
const _origin = new Vector3();
const _com = new Vector3();
const _to = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _p0 = new Vector3();
const _p1 = new Vector3();
const _hitPoint = new Vector3();
const _hitNormal = new Vector3();
const _tmp = new Vector3();
const _tmpB = new Vector3();
const _disc = [0, 0];
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);

// Pooled event payloads (ARCHITECTURE.md §4 — handlers must not retain them).
const _pFired = {
  ownerId: 0,
  weaponId: '',
  muzzle: [0, 0, 0],
  direction: [0, 0, 0],
  seed: 0,
  ammoRemaining: 0,
  isFirstOfBurst: false,
};
const _pDryfire = { ownerId: 0, weaponId: '' };
const _pReload = { ownerId: 0, weaponId: '', durationMs: 0, fromEmpty: false };
const _pReloadEnd = { ownerId: 0, weaponId: '' };
const _pSwapStart = { ownerId: 0, fromWeaponId: '', toWeaponId: '', durationMs: 0 };
const _pSwapEnd = { ownerId: 0, weaponId: '' };
const _pHeat = { ownerId: 0, weaponId: '' };
const _pCharge = { ownerId: 0, weaponId: '', chargeLevel: 0 };
const _pDropped = { ownerId: 0, weaponId: '', ammo: 0, position: [0, 0, 0], velocity: [0, 0, 0] };
const _pPicked = { ownerId: 0, weaponId: '', ammo: 0 };
const _pScope = { ownerId: 0, weaponId: '', magnification: 0 };
const _pDescoped = { ownerId: 0, weaponId: '' };
const _pImpact = {
  point: [0, 0, 0],
  normal: [0, 1, 0],
  surfaceId: -1,
  energy: 0,
  damageType: 0,
  sourceId: 0,
};
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
const _pShieldBroken = { entityId: 0, overkill: 0, point: [0, 0, 0], normal: [0, 1, 0] };
const _pHealth = { entityId: 0, health: 0, maxHealth: 0, shield: 0, maxShield: 0 };
const _pKilled = {
  entityId: 0,
  killerId: 0,
  weaponId: null,
  hitRegion: HitRegion.TORSO,
  damageType: 0,
  position: [0, 0, 0],
};
const _pThrown = { ownerId: 0, grenadeType: '', origin: [0, 0, 0], velocity: [0, 0, 0], fuseMs: 0 };
const _pBounced = { grenadeId: 0, point: [0, 0, 0], normal: [0, 1, 0], impactSpeed: 0, surfaceId: -1 };
const _pStuck = { grenadeId: 0, targetId: 0, localPoint: [0, 0, 0] };
const _pDetonated = { grenadeId: 0, grenadeType: '', point: [0, 0, 0], radius: 0, ownerId: 0 };
const _pExplosion = { point: [0, 0, 0], radius: 0, energy: 0, damageType: 0 };
const _pMeleeSwing = { ownerId: 0, durationMs: 0 };
const _pMeleeLanded = { ownerId: 0, targetId: 0, fromBehind: false, point: [0, 0, 0] };
const _pMeleeWhiff = { ownerId: 0 };

const EMPTY_INPUT = Object.freeze({});

// ---------------------------------------------------------------------------
// Geometry helpers (pure, allocation-free).
// ---------------------------------------------------------------------------

/**
 * Ray vs capsule (segment a→b, radius r). Returns the entry distance along
 * `d` (unit) or -1. Caps included.
 */
function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax,
    bay = by - ay,
    baz = bz - az;
  const oax = ox - ax,
    oay = oy - ay,
    oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;

  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;

  if (Math.abs(A) > 1e-12) {
    const h = B * B - A * C;
    if (h >= 0) {
      const t = (-B - Math.sqrt(h)) / A;
      const y = baoa + t * bard;
      if (y > 0 && y < baba && t >= 0) return t;
    }
  }
  // caps
  let best = -1;
  for (let i = 0; i < 2; i++) {
    const cx = i === 0 ? ax : bx;
    const cy = i === 0 ? ay : by;
    const cz = i === 0 ? az : bz;
    const ocx = ox - cx,
      ocy = oy - cy,
      ocz = oz - cz;
    const b = ocx * dx + ocy * dy + ocz * dz;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const h = b * b - c;
    if (h < 0) continue;
    const t = -b - Math.sqrt(h);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** Distance from point p to segment a→b. */
function pointSegmentDistance(px, py, pz, ax, ay, az, bx, by, bz) {
  const bax = bx - ax,
    bay = by - ay,
    baz = bz - az;
  const pax = px - ax,
    pay = py - ay,
    paz = pz - az;
  const len2 = bax * bax + bay * bay + baz * baz;
  let t = len2 > 1e-12 ? (pax * bax + pay * bay + paz * baz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = pax - bax * t,
    dy = pay - bay * t,
    dz = paz - baz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Unit direction from yaw/pitch. yaw 0 = −Z, +pitch = up. */
function dirFromYawPitch(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Build an orthonormal basis (right, up) perpendicular to unit `d`. */
function perpBasis(d, right, up) {
  const ref = Math.abs(d.y) < 0.99 ? WORLD_UP : WORLD_X;
  right.crossVectors(d, ref).normalize();
  up.crossVectors(right, d).normalize();
}

// ---------------------------------------------------------------------------

function makeSlot(id) {
  const def = weaponDef(id);
  return {
    def,
    id,
    ammo: def.ammo === AmmoKind.HEAT ? 0 : def.mag,
    reserve: def.reserve,
    bloom: 0,
    heat: 0,
    overheated: false,
    overheatTimer: 0,
    lastFireTime: -1e9,
    opticIndex: -1,
  };
}

export class WeaponSystem {
  /**
   * @param {{physics:object, targets?:TargetRegistry, bus?:object, ownerId?:number,
   *          faction?:number, loadout?:string[]}} opts
   */
  constructor(opts) {
    const {
      physics,
      targets = defaultTargets,
      bus = defaultBus,
      ownerId = 1,
      faction = Faction.PLAYER,
      loadout = ['vector_br', 'cadence_ar'],
    } = opts;

    this.physics = physics;
    this.targets = targets;
    this.bus = bus;
    this.ownerId = ownerId;
    this.faction = faction;

    /** @type {Array} up to MAX_WEAPONS carried slots. */
    this.slots = loadout.slice(0, MAX_WEAPONS).map(makeSlot);
    this.activeIndex = 0;

    this.grenades = { frag: GRENADE.frag.maxCarried, plasma: GRENADE.plasma.maxCarried };
    this.grenadeType = 'frag';

    this.recoilPitch = 0; // radians, +up
    this.recoilYaw = 0;
    this._recoilRestPitch = 0;
    this._recoilRestYaw = 0;
    this._recoilLambda = 8;

    this.scoped = false;
    this.magnification = 0;

    this._time = 0;
    this._nextFireTime = -1e9;
    this._burstActive = false;
    this._burstAnchor = 0;
    this._burstFired = 0;

    this._reloadTimer = 0;
    this.reloading = false;

    this._swapTimer = 0;
    this._swapTo = -1;
    this.swapping = false;

    this._charging = false;
    this._charge = 0;
    this.chargeFull = false;

    this._melee = { active: false, t: 0, resolved: false, recovery: 0 };
    this._lunge = new Vector3();
    this._lungePending = false;

    /** @type {Array} live grenades. */
    this.liveGrenades = [];
    /** @type {Array} live projectiles (charged EMP bolts). */
    this.projectiles = [];

    this._aim = {
      hot: false,
      coneDeg: 0,
      magnetismDeg: 0,
      target: null,
      distance: 0,
      rangeFactor: 0,
      hitboxScale: 1,
      angleDeg: 0,
    };

    this._hadLookInput = false;
    this._owner = null;
    this._ownerEye = new Vector3();
    this._ownerYaw = 0;
    this._ownerPitch = 0;
    this._ownerForward = new Vector3(0, 0, -1);

    this._spreadRng = rng('weapons.spread');
    this._pelletRng = rng('weapons.pellets');

    this._offDamage = this.bus.on(Ev.DAMAGE_APPLIED, (p) => {
      // FEEL.md F42 — descope on ANY damage taken while scoped.
      if (p && p.targetId === this.ownerId && this.scoped) this._descope();
    });
  }

  dispose() {
    if (this._offDamage) this._offDamage();
    for (let i = 0; i < this.liveGrenades.length; i++) {
      this.physics.remove(this.liveGrenades[i].body);
    }
    this.liveGrenades.length = 0;
    this.projectiles.length = 0;
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  get current() {
    return this.slots[this.activeIndex] ?? null;
  }

  get currentDef() {
    const s = this.current;
    return s ? s.def : null;
  }

  /** FEEL.md §4.8 — HUD reads this for the red reticle. */
  getAimState() {
    return this._aim;
  }

  /** Look-sensitivity multiplier: 0.80 only while hot AND the player is
   *  supplying look input (FEEL.md §4.8 — no effect on a stationary crosshair). */
  getLookScale() {
    return this._aim.hot && this._hadLookInput ? AIM_ASSIST.turnFriction : 1;
  }

  /** @returns {boolean} true if a lunge displacement was written into `out`. */
  consumeLunge(out) {
    if (!this._lungePending) return false;
    out.copy(this._lunge);
    this._lungePending = false;
    return true;
  }

  // -----------------------------------------------------------------------
  // Main step
  // -----------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} input core/input.js InputState
   * @param {{entityId:number, eyePosition:Vector3, yaw:number, pitch:number}} owner
   */
  update(dt, input, owner) {
    const st = input || EMPTY_INPUT;
    this._time += dt;
    this._hadLookInput = !!st.hasLookInput;

    if (owner) {
      this._owner = owner;
      this._ownerEye.copy(owner.eyePosition);
      this._ownerYaw = owner.yaw;
      this._ownerPitch = owner.pitch;
      dirFromYawPitch(owner.yaw, owner.pitch, this._ownerForward);
    }

    // --- ordered so timers that *end* this tick unlock the action this tick,
    //     and so a grenade thrown this tick is not decremented this tick.
    this._stepGrenades(dt);
    this._stepProjectiles(dt);
    this._stepTimers(dt);
    this._stepMelee(dt);

    // Aim direction includes the weapon's own recoil offset.
    dirFromYawPitch(this._ownerYaw + this.recoilYaw, this._ownerPitch + this.recoilPitch, _dir);
    _origin.copy(this._ownerEye);
    this._updateAim(_origin, _dir);

    this._handleInput(dt, st);
  }

  // -----------------------------------------------------------------------

  _stepTimers(dt) {
    // swap
    if (this.swapping) {
      this._swapTimer -= dt;
      if (this._swapTimer <= 0) {
        this.swapping = false;
        this.activeIndex = this._swapTo;
        this._swapTo = -1;
        this._nextFireTime = this._time;
        _pSwapEnd.ownerId = this.ownerId;
        _pSwapEnd.weaponId = this.current ? this.current.id : '';
        this.bus.emit(Ev.WEAPON_SWAP_END, _pSwapEnd);
      }
    }

    // reload
    if (this.reloading) {
      this._reloadTimer -= dt;
      if (this._reloadTimer <= 0) this._finishReload();
    }

    const slot = this.current;
    if (!slot) return;
    const def = slot.def;

    // bloom decay
    if (slot.bloom > 0 && def.bloomDecayDeg > 0) {
      slot.bloom = Math.max(0, slot.bloom - def.bloomDecayDeg * dt);
    }

    // heat / vent / overheat lockout (FEEL.md §4.5)
    if (def.ammo === AmmoKind.HEAT) {
      if (slot.overheated) {
        slot.overheatTimer -= dt;
        if (slot.overheatTimer <= 0) {
          slot.overheated = false;
          slot.heat = 0;
          _pHeat.ownerId = this.ownerId;
          _pHeat.weaponId = slot.id;
          this.bus.emit(Ev.WEAPON_COOLED, _pHeat);
        }
      } else if (this._time - slot.lastFireTime >= def.ventDelay && slot.heat > 0) {
        slot.heat = Math.max(0, slot.heat - dt / def.ventTime);
      }
    }

    // recoil auto-recentre
    const k = 1 - Math.exp(-this._recoilLambda * dt);
    this.recoilPitch += (this._recoilRestPitch - this.recoilPitch) * k;
    this.recoilYaw += (this._recoilRestYaw - this.recoilYaw) * k;
    // The residual (non-recentred) part bleeds off slowly once firing stops.
    if (this._time - slot.lastFireTime > 0.35) {
      this._recoilRestPitch += (0 - this._recoilRestPitch) * k * 0.5;
      this._recoilRestYaw += (0 - this._recoilRestYaw) * k * 0.5;
    }
  }

  // -----------------------------------------------------------------------
  // Aim assist — FEEL.md §4.8. This is the highest-risk block in the file.
  // -----------------------------------------------------------------------

  _updateAim(origin, dir) {
    const a = this._aim;
    a.hot = false;
    a.coneDeg = 0;
    a.magnetismDeg = 0;
    a.target = null;
    a.distance = 0;
    a.rangeFactor = 0;
    a.hitboxScale = 1;
    a.angleDeg = 0;

    const def = this.currentDef;
    if (!def) return;
    const list = this.targets.list;
    let best = null;
    let bestAngle = Infinity;
    let bestCone = 0;
    let bestDist = 0;

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!this.targets.isValidTarget(t, this.faction, this.ownerId)) continue;
      const cap = t.getCapsule();
      _com.set(cap.position.x, cap.position.y + cap.height * 0.5, cap.position.z);
      _to.copy(_com).sub(origin);
      const d = _to.length();
      if (d < 1e-4) continue;
      _to.divideScalar(d);

      // Red-reticle cone: clamp(atan(1.35·r/d), 1.2°, 5.0°)
      const coneDeg = clamp(
        Math.atan((AIM_ASSIST.coneRadiusScale * cap.radius) / d) * RAD,
        AIM_ASSIST.coneMinDeg,
        AIM_ASSIST.coneMaxDeg,
      );
      const cosA = clamp(dir.dot(_to), -1, 1);
      const angleDeg = Math.acos(cosA) * RAD;
      if (angleDeg > coneDeg) continue;
      if (angleDeg < bestAngle) {
        bestAngle = angleDeg;
        best = t;
        bestCone = coneDeg;
        bestDist = d;
      }
    }

    if (!best) return;

    // Magnetism range: 100% inside effective range, 0 at 1.6× effective range.
    const eff = def.effectiveRange;
    const rangeFactor = clamp01(
      (eff * AIM_ASSIST.magnetismRangeFactor - bestDist) / (eff * (AIM_ASSIST.magnetismRangeFactor - 1)),
    );

    a.hot = true;
    a.target = best;
    a.coneDeg = bestCone;
    a.distance = bestDist;
    a.angleDeg = bestAngle;
    a.rangeFactor = rangeFactor;
    a.hitboxScale = AIM_ASSIST.hitboxInflation;
    a.magnetismDeg = this._magnetismFor(bestAngle, bestCone, rangeFactor);
  }

  /**
   * Bend applied to a ray whose angular error to the target is `angleDeg`.
   * Ramps 0→1 across the OUTER 40% of the cone, so a dead-centre shot bends
   * by exactly 0 (FEEL.md F40) and a cone-edge shot bends by 3.0° (F39).
   */
  _magnetismFor(angleDeg, coneDeg, rangeFactor) {
    if (coneDeg <= 0 || angleDeg <= 0 || rangeFactor <= 0) return 0;
    const t = angleDeg / coneDeg;
    const start = AIM_ASSIST.magnetismRampStart;
    const ramp = clamp01((t - start) / (1 - start));
    if (ramp <= 0) return 0;
    // Never bend past the target: the cap is min(3.0°, the error itself).
    return Math.min(AIM_ASSIST.magnetismMaxDeg, angleDeg) * ramp * rangeFactor;
  }

  /** Rotate `dirIn` toward the aim target by the magnetism bend. */
  _applyMagnetism(origin, dirIn, out) {
    const a = this._aim;
    out.copy(dirIn);
    if (!a.hot || !a.target) return out;
    const cap = a.target.getCapsule();
    _com.set(cap.position.x, cap.position.y + cap.height * 0.5, cap.position.z);
    _to.copy(_com).sub(origin);
    const d = _to.length();
    if (d < 1e-4) return out;
    _to.divideScalar(d);
    const cosA = clamp(dirIn.dot(_to), -1, 1);
    const angle = Math.acos(cosA);
    const angleDeg = angle * RAD;
    if (angleDeg > a.coneDeg) return out;
    const bendDeg = this._magnetismFor(angleDeg, a.coneDeg, a.rangeFactor);
    if (bendDeg <= 0) return out;
    const bend = bendDeg * DEG;
    const s = Math.sin(angle);
    if (s < 1e-9) return out;
    const w0 = Math.sin(angle - bend) / s;
    const w1 = Math.sin(bend) / s;
    out.set(
      dirIn.x * w0 + _to.x * w1,
      dirIn.y * w0 + _to.y * w1,
      dirIn.z * w0 + _to.z * w1,
    ).normalize();
    return out;
  }

  // -----------------------------------------------------------------------
  // Input
  // -----------------------------------------------------------------------

  _handleInput(dt, st) {
    if (st.swapPressed) this.requestSwap();
    if (st.switchGrenadePressed) this.grenadeType = this.grenadeType === 'frag' ? 'plasma' : 'frag';
    if (st.scopePressed) this.toggleScope();
    if (st.reloadPressed) this.reload();
    if (st.meleePressed) this.melee();
    if (st.grenadePressed) this.throwGrenade(this.grenadeType);

    const slot = this.current;
    if (!slot) return;
    const def = slot.def;
    const held = !!st.fire;
    const pressed = !!st.firePressed;

    if (def.mode === FireMode.CHARGE) {
      this._handleCharge(dt, held);
      return;
    }

    if (!this._canAct()) return;

    switch (def.mode) {
      case FireMode.AUTO: {
        if (!held) break;
        if (this._nextFireTime < this._time - def.refire) this._nextFireTime = this._time;
        let n = 0;
        while (this._time >= this._nextFireTime && n < MAX_SHOTS_PER_TICK) {
          if (!this._fireOnce(slot, true)) break;
          this._nextFireTime += def.refire;
          n++;
        }
        break;
      }
      case FireMode.SEMI:
      case FireMode.PELLET: {
        if (!pressed) break;
        if (this._time < this._nextFireTime) break;
        if (this._fireOnce(slot, true)) this._nextFireTime = this._time + def.refire;
        break;
      }
      case FireMode.BURST: {
        if (!this._burstActive && held && this._time >= this._nextFireTime) {
          // Anchor on the SCHEDULED burst time, not the tick we noticed it.
          // Anchoring on `_time` re-quantises every burst and the error
          // compounds: measured 1.3417 s for a 4-burst kill instead of
          // 1.3250 s (FEEL.md F19 target 1.32 s).
          const scheduled =
            this._nextFireTime > -1e8 && this._nextFireTime <= this._time
              ? this._nextFireTime
              : this._time;
          this._burstActive = true;
          this._burstAnchor = scheduled;
          this._burstFired = 0;
          this._nextFireTime = scheduled + def.refire;
        }
        if (this._burstActive) {
          while (
            this._burstFired < def.burstCount &&
            this._time >= this._burstAnchor + this._burstFired * def.intraBurst
          ) {
            const first = this._burstFired === 0;
            if (!this._fireOnce(slot, first)) {
              this._burstActive = false;
              break;
            }
            this._burstFired++;
          }
          if (this._burstFired >= def.burstCount) this._burstActive = false;
        }
        break;
      }
      default:
        break;
    }
  }

  _handleCharge(dt, held) {
    const slot = this.current;
    const def = slot.def;
    if (held && this._canAct()) {
      if (!this._charging) {
        this._charging = true;
        this._charge = 0;
        this.chargeFull = false;
        _pCharge.ownerId = this.ownerId;
        _pCharge.weaponId = slot.id;
        _pCharge.chargeLevel = 0;
        this.bus.emit(Ev.WEAPON_CHARGE_START, _pCharge);
      }
      this._charge += dt;
      // 1e-9 slack: `_charge` is an accumulation of 144 x 1/120 and lands on
      // 1.1999999999999997 as often as 1.2000000000000002.
      if (!this.chargeFull && this._charge >= def.chargeTime - 1e-9) {
        this.chargeFull = true;
        _pCharge.ownerId = this.ownerId;
        _pCharge.weaponId = slot.id;
        _pCharge.chargeLevel = 1;
        this.bus.emit(Ev.WEAPON_CHARGE_FULL, _pCharge);
      }
    } else if (this._charging) {
      const level = clamp01(this._charge / def.chargeTime);
      this._charging = false;
      _pCharge.ownerId = this.ownerId;
      _pCharge.weaponId = slot.id;
      _pCharge.chargeLevel = level;
      this.bus.emit(Ev.WEAPON_CHARGE_RELEASED, _pCharge);
      if (this.chargeFull) {
        this._fireChargedBolt(slot);
      } else if (this._time >= this._nextFireTime) {
        if (this._fireOnce(slot, true)) this._nextFireTime = this._time + def.refire;
      }
      this._charge = 0;
      this.chargeFull = false;
    }
  }

  _canAct() {
    return !this.swapping && !this.reloading && !this._melee.active;
  }

  // -----------------------------------------------------------------------
  // Firing
  // -----------------------------------------------------------------------

  /** @returns {boolean} true if a round left the barrel. */
  _fireOnce(slot, isFirstOfBurst) {
    const def = slot.def;

    if (def.ammo === AmmoKind.HEAT) {
      if (slot.overheated) {
        this._dryfire(slot);
        return false;
      }
    } else if (def.ammo === AmmoKind.BATTERY) {
      if (slot.ammo < def.batteryPerShot) {
        this._dryfire(slot);
        return false;
      }
      slot.ammo -= def.batteryPerShot;
    } else {
      if (slot.ammo <= 0) {
        this._dryfire(slot);
        return false;
      }
      slot.ammo -= 1;
    }

    slot.lastFireTime = this._time;

    dirFromYawPitch(this._ownerYaw + this.recoilYaw, this._ownerPitch + this.recoilPitch, _dir);
    _origin.copy(this._ownerEye);

    const seed = this._spreadRng.nextUint();
    _pFired.ownerId = this.ownerId;
    _pFired.weaponId = slot.id;
    _pFired.muzzle[0] = _origin.x;
    _pFired.muzzle[1] = _origin.y;
    _pFired.muzzle[2] = _origin.z;
    _pFired.direction[0] = _dir.x;
    _pFired.direction[1] = _dir.y;
    _pFired.direction[2] = _dir.z;
    _pFired.seed = seed;
    _pFired.ammoRemaining = def.ammo === AmmoKind.HEAT ? Math.round((1 - slot.heat) * 100) : slot.ammo;
    _pFired.isFirstOfBurst = !!isFirstOfBurst;
    this.bus.emit(Ev.WEAPON_FIRED, _pFired);

    const spreadDeg = this._spreadOf(slot);
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const stream = pellets > 1 ? this._pelletRng : this._spreadRng;
      this._spreadDir(_dir, spreadDeg, stream, _dir2);
      this._applyMagnetism(_origin, _dir2, _dir2);
      this._trace(_origin, _dir2, def, slot, def.damage);
    }

    // bloom + heat + recoil
    if (def.bloomPerShotDeg > 0) {
      slot.bloom = Math.min(def.bloomMaxDeg - def.baseSpreadDeg, slot.bloom + def.bloomPerShotDeg);
    }
    if (def.ammo === AmmoKind.HEAT) {
      slot.heat = clamp01(slot.heat + def.refire / def.heatToMax);
      if (slot.heat >= 1) {
        slot.overheated = true;
        slot.overheatTimer = def.overheatLockout;
        _pHeat.ownerId = this.ownerId;
        _pHeat.weaponId = slot.id;
        this.bus.emit(Ev.WEAPON_OVERHEAT, _pHeat);
      }
    }
    // Burst weapons kick once per burst, not once per round.
    if (def.mode !== FireMode.BURST || isFirstOfBurst) this._addRecoil(def, def.recoilDeg);
    return true;
  }

  _spreadOf(slot) {
    const def = slot.def;
    if (def.ammo === AmmoKind.HEAT) {
      // 0.85° -> 2.4° with heat (FEEL.md §4.4)
      return def.baseSpreadDeg + (def.spreadHotDeg - def.baseSpreadDeg) * slot.heat;
    }
    let s = def.baseSpreadDeg + slot.bloom;
    if (this.scoped) s *= 0.5;
    return Math.min(s, def.bloomMaxDeg);
  }

  _spreadDir(dirIn, spreadDeg, stream, out) {
    if (spreadDeg <= 1e-9) {
      out.copy(dirIn);
      return out;
    }
    stream.disc(_disc);
    const tanA = Math.tan(spreadDeg * DEG);
    perpBasis(dirIn, _right, _up);
    out
      .copy(dirIn)
      .addScaledVector(_right, _disc[0] * tanA)
      .addScaledVector(_up, _disc[1] * tanA)
      .normalize();
    return out;
  }

  _addRecoil(def, deg) {
    const kick = deg * DEG;
    this.recoilPitch += kick;
    this._recoilRestPitch += kick * (1 - def.recoilRecentre);
    this._recoilLambda = def.recoilTime > 0 ? 3 / def.recoilTime : 8;
  }

  _dryfire(slot) {
    _pDryfire.ownerId = this.ownerId;
    _pDryfire.weaponId = slot.id;
    this.bus.emit(Ev.WEAPON_DRYFIRE, _pDryfire);
  }

  /**
   * Hitscan trace: nearest of (static world raycast) and (registered target
   * capsules). Emits surface.impact on every hit and resolves damage through
   * shared/damage.js.
   */
  _trace(origin, dir, def, slot, damage) {
    // physics.raycast returns ONE shared record — copy before any other query.
    const wh = this.physics.raycast(origin, dir, MAX_TRACE, null);
    let bestT = MAX_TRACE;
    let worldSurface = -1;
    let hitWorld = false;
    if (wh) {
      bestT = wh.distance;
      worldSurface = wh.surfaceId;
      _hitPoint.copy(wh.point);
      _hitNormal.copy(wh.normal);
      hitWorld = true;
    }

    let hitTarget = null;
    const a = this._aim;
    const list = this.targets.list;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!this.targets.isValidTarget(t, this.faction, this.ownerId)) continue;
      const cap = t.getCapsule();
      // FEEL.md §4.8 — hitbox inflation 1.15× for shots fired in red-reticle state.
      const r = cap.radius * (a.hot && a.target === t ? AIM_ASSIST.hitboxInflation : 1);
      const ax = cap.position.x;
      const ay = cap.position.y + cap.radius;
      const az = cap.position.z;
      const by = cap.position.y + cap.height - cap.radius;
      const tt = rayCapsule(
        origin.x, origin.y, origin.z,
        dir.x, dir.y, dir.z,
        ax, ay, az,
        ax, by, az,
        r,
      );
      if (tt >= 0 && tt < bestT) {
        bestT = tt;
        hitTarget = t;
        hitWorld = false;
      }
    }

    if (hitTarget) {
      _hitPoint.copy(origin).addScaledVector(dir, bestT);
      _hitNormal.copy(origin).sub(_hitPoint).normalize();
      const cap = hitTarget.getCapsule();
      const headHeight = cap.headHeight ?? 0.3;
      const region =
        _hitPoint.y >= cap.position.y + cap.height - headHeight ? HitRegion.HEAD : HitRegion.TORSO;
      const shielded = hitTarget.state && hitTarget.state.shield > 0;
      this._emitImpact(shielded ? SurfaceId.SHIELD : SurfaceId.ARMOR_HARD, damage, def.damageType);
      this._damageTarget(hitTarget, damage, def.damageType, region, def.headMult, def.id);
      return;
    }
    if (hitWorld) {
      this._emitImpact(worldSurface, damage, def.damageType);
    }
  }

  _emitImpact(surfaceId, energy, damageType) {
    _pImpact.point[0] = _hitPoint.x;
    _pImpact.point[1] = _hitPoint.y;
    _pImpact.point[2] = _hitPoint.z;
    _pImpact.normal[0] = _hitNormal.x;
    _pImpact.normal[1] = _hitNormal.y;
    _pImpact.normal[2] = _hitNormal.z;
    _pImpact.surfaceId = surfaceId;
    _pImpact.energy = energy;
    _pImpact.damageType = damageType;
    _pImpact.sourceId = this.ownerId;
    this.bus.emit(Ev.SURFACE_IMPACT, _pImpact);
  }

  /** Resolve + write + emit. All arithmetic lives in shared/damage.js. */
  _damageTarget(t, amount, damageType, region, headMult, weaponId) {
    const s = t.state;
    if (!s || s.dead) return null;
    const preShield = s.shield;
    const res = resolveDamage(s, amount, damageType, region, headMult);
    s.shield = res.shield;
    s.health = res.health;

    _pDamage.targetId = t.entityId;
    _pDamage.sourceId = this.ownerId;
    _pDamage.amount = res.applied;
    _pDamage.rawAmount = amount;
    _pDamage.damageType = damageType;
    _pDamage.hitRegion = region;
    _pDamage.point[0] = _hitPoint.x;
    _pDamage.point[1] = _hitPoint.y;
    _pDamage.point[2] = _hitPoint.z;
    _pDamage.normal[0] = _hitNormal.x;
    _pDamage.normal[1] = _hitNormal.y;
    _pDamage.normal[2] = _hitNormal.z;
    _pDamage.weaponId = weaponId;
    _pDamage.absorbedByShield = res.absorbedByShield;
    this.bus.emit(Ev.DAMAGE_APPLIED, _pDamage);

    if (res.shieldBroke) {
      _pShieldBroken.entityId = t.entityId;
      _pShieldBroken.overkill = Math.max(0, res.applied - preShield);
      _pShieldBroken.point[0] = _hitPoint.x;
      _pShieldBroken.point[1] = _hitPoint.y;
      _pShieldBroken.point[2] = _hitPoint.z;
      _pShieldBroken.normal[0] = _hitNormal.x;
      _pShieldBroken.normal[1] = _hitNormal.y;
      _pShieldBroken.normal[2] = _hitNormal.z;
      this.bus.emit(Ev.SHIELD_BROKEN, _pShieldBroken);
    }

    _pHealth.entityId = t.entityId;
    _pHealth.health = s.health;
    _pHealth.maxHealth = s.maxHealth;
    _pHealth.shield = s.shield;
    _pHealth.maxShield = s.maxShield;
    this.bus.emit(Ev.HEALTH_CHANGED, _pHealth);

    if (res.killed) {
      s.dead = true;
      const cap = t.getCapsule();
      _pKilled.entityId = t.entityId;
      _pKilled.killerId = this.ownerId;
      _pKilled.weaponId = weaponId;
      _pKilled.hitRegion = region;
      _pKilled.damageType = damageType;
      _pKilled.position[0] = cap.position.x;
      _pKilled.position[1] = cap.position.y;
      _pKilled.position[2] = cap.position.z;
      this.bus.emit(Ev.ENTITY_KILLED, _pKilled);
    }
    if (t.onDamage) t.onDamage(res, _pDamage);
    return res;
  }

  // -----------------------------------------------------------------------
  // Charged EMP bolt (projectile, not hitscan) — FEEL.md §4.3
  // -----------------------------------------------------------------------

  _fireChargedBolt(slot) {
    const def = slot.def;
    if (slot.ammo < def.chargeBatteryCost) {
      this._dryfire(slot);
      return false;
    }
    slot.ammo -= def.chargeBatteryCost;
    slot.lastFireTime = this._time;

    dirFromYawPitch(this._ownerYaw + this.recoilYaw, this._ownerPitch + this.recoilPitch, _dir);
    this._applyMagnetism(this._ownerEye, _dir, _dir);

    _pFired.ownerId = this.ownerId;
    _pFired.weaponId = slot.id;
    _pFired.muzzle[0] = this._ownerEye.x;
    _pFired.muzzle[1] = this._ownerEye.y;
    _pFired.muzzle[2] = this._ownerEye.z;
    _pFired.direction[0] = _dir.x;
    _pFired.direction[1] = _dir.y;
    _pFired.direction[2] = _dir.z;
    _pFired.seed = 0;
    _pFired.ammoRemaining = slot.ammo;
    _pFired.isFirstOfBurst = true;
    this.bus.emit(Ev.WEAPON_FIRED, _pFired);

    this.projectiles.push({
      position: this._ownerEye.clone(),
      dir: _dir.clone(),
      speed: def.projectileSpeed,
      travelled: 0,
      damage: def.chargeDamage,
      damageType: def.chargeDamageType,
      weaponId: slot.id,
      headMult: 1,
    });
    this._addRecoil(def, def.chargeRecoilDeg);
    return true;
  }

  _stepProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = p.speed * dt;
      const wh = this.physics.raycast(p.position, p.dir, step, null);
      let bestT = step;
      let hitWorld = false;
      let surface = -1;
      if (wh) {
        bestT = wh.distance;
        surface = wh.surfaceId;
        _hitPoint.copy(wh.point);
        _hitNormal.copy(wh.normal);
        hitWorld = true;
      }
      let hitTarget = null;
      const list = this.targets.list;
      for (let j = 0; j < list.length; j++) {
        const t = list[j];
        if (!this.targets.isValidTarget(t, this.faction, this.ownerId)) continue;
        const cap = t.getCapsule();
        const ax = cap.position.x;
        const ay = cap.position.y + cap.radius;
        const az = cap.position.z;
        const by = cap.position.y + cap.height - cap.radius;
        const tt = rayCapsule(
          p.position.x, p.position.y, p.position.z,
          p.dir.x, p.dir.y, p.dir.z,
          ax, ay, az, ax, by, az,
          cap.radius,
        );
        if (tt >= 0 && tt < bestT) {
          bestT = tt;
          hitTarget = t;
          hitWorld = false;
        }
      }

      if (hitTarget) {
        _hitPoint.copy(p.position).addScaledVector(p.dir, bestT);
        _hitNormal.copy(p.position).sub(_hitPoint).normalize();
        const cap = hitTarget.getCapsule();
        const headHeight = cap.headHeight ?? 0.3;
        const region =
          _hitPoint.y >= cap.position.y + cap.height - headHeight ? HitRegion.HEAD : HitRegion.TORSO;
        const shielded = hitTarget.state && hitTarget.state.shield > 0;
        this._emitImpact(shielded ? SurfaceId.SHIELD : SurfaceId.ARMOR_HARD, p.damage, p.damageType);
        this._damageTarget(hitTarget, p.damage, p.damageType, region, p.headMult, p.weaponId);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (hitWorld) {
        this._emitImpact(surface, p.damage, p.damageType);
        this.projectiles.splice(i, 1);
        continue;
      }
      p.position.addScaledVector(p.dir, step);
      p.travelled += step;
      if (p.travelled > MAX_TRACE) this.projectiles.splice(i, 1);
    }
  }

  // -----------------------------------------------------------------------
  // Inventory: swap / reload / scope / drop / pickup
  // -----------------------------------------------------------------------

  requestSwap(index) {
    if (this.slots.length < 2) return false;
    const to = index === undefined ? (this.activeIndex + 1) % this.slots.length : index;
    return this.swapTo(to);
  }

  swapTo(index) {
    if (this.swapping || index === this.activeIndex) return false;
    if (index < 0 || index >= this.slots.length) return false;
    this._cancelReload();
    this._burstActive = false;
    this._charging = false;
    this._charge = 0;
    this.chargeFull = false;
    if (this.scoped) this._exitScope();
    this.swapping = true;
    this._swapTimer = WEAPON_SWAP_TIME;
    this._swapTo = index;
    _pSwapStart.ownerId = this.ownerId;
    _pSwapStart.fromWeaponId = this.current ? this.current.id : '';
    _pSwapStart.toWeaponId = this.slots[index].id;
    _pSwapStart.durationMs = WEAPON_SWAP_TIME * 1000;
    this.bus.emit(Ev.WEAPON_SWAP_START, _pSwapStart);
    return true;
  }

  reload() {
    const slot = this.current;
    if (!slot || this.reloading || this.swapping) return false;
    const def = slot.def;
    if (def.ammo === AmmoKind.HEAT || def.ammo === AmmoKind.BATTERY) return false;
    if (slot.ammo >= def.mag || slot.reserve <= 0) return false;
    const fromEmpty = slot.ammo === 0;
    this.reloading = true;
    this._burstActive = false;
    this._reloadTimer = fromEmpty ? def.reloadEmptyTime : def.reloadTime;
    if (this.scoped) this._exitScope();
    _pReload.ownerId = this.ownerId;
    _pReload.weaponId = slot.id;
    _pReload.durationMs = this._reloadTimer * 1000;
    _pReload.fromEmpty = fromEmpty;
    this.bus.emit(Ev.WEAPON_RELOAD_START, _pReload);
    return true;
  }

  _finishReload() {
    const slot = this.current;
    this.reloading = false;
    this._reloadTimer = 0;
    if (!slot) return;
    const def = slot.def;
    if (def.ammo === AmmoKind.TUBE) {
      // one shell per cycle; re-arm if there is room and reserve left
      const room = def.mag - slot.ammo;
      if (room > 0 && slot.reserve > 0) {
        slot.ammo += 1;
        slot.reserve -= 1;
      }
      _pReloadEnd.ownerId = this.ownerId;
      _pReloadEnd.weaponId = slot.id;
      this.bus.emit(Ev.WEAPON_RELOAD_END, _pReloadEnd);
      if (slot.ammo < def.mag && slot.reserve > 0) this.reload();
      return;
    }
    const want = Math.min(def.mag - slot.ammo, slot.reserve);
    slot.ammo += want;
    slot.reserve -= want;
    slot.bloom = 0;
    _pReloadEnd.ownerId = this.ownerId;
    _pReloadEnd.weaponId = slot.id;
    this.bus.emit(Ev.WEAPON_RELOAD_END, _pReloadEnd);
  }

  _cancelReload() {
    if (!this.reloading) return;
    this.reloading = false;
    this._reloadTimer = 0;
  }

  toggleScope() {
    const slot = this.current;
    if (!slot || slot.def.optics.length === 0) return false;
    const optics = slot.def.optics;
    if (!this.scoped) {
      this.scoped = true;
      slot.opticIndex = 0;
      this.magnification = optics[0];
      _pScope.ownerId = this.ownerId;
      _pScope.weaponId = slot.id;
      _pScope.magnification = this.magnification;
      this.bus.emit(Ev.SCOPE_ENTER, _pScope);
      return true;
    }
    if (slot.opticIndex + 1 < optics.length) {
      slot.opticIndex += 1;
      this.magnification = optics[slot.opticIndex];
      _pScope.ownerId = this.ownerId;
      _pScope.weaponId = slot.id;
      _pScope.magnification = this.magnification;
      this.bus.emit(Ev.SCOPE_ENTER, _pScope);
      return true;
    }
    this._exitScope();
    return true;
  }

  _exitScope() {
    const slot = this.current;
    this.scoped = false;
    if (slot) slot.opticIndex = -1;
    _pScope.ownerId = this.ownerId;
    _pScope.weaponId = slot ? slot.id : '';
    _pScope.magnification = this.magnification;
    this.magnification = 0;
    this.bus.emit(Ev.SCOPE_EXIT, _pScope);
  }

  _descope() {
    const slot = this.current;
    this._exitScope();
    _pDescoped.ownerId = this.ownerId;
    _pDescoped.weaponId = slot ? slot.id : '';
    this.bus.emit(Ev.SCOPE_DESCOPED, _pDescoped);
  }

  /** Drop both carried weapons with their remaining ammo (death). */
  dropAll(position, velocity) {
    const out = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      _pDropped.ownerId = this.ownerId;
      _pDropped.weaponId = s.id;
      _pDropped.ammo = s.ammo;
      _pDropped.position[0] = position ? position.x : 0;
      _pDropped.position[1] = position ? position.y : 0;
      _pDropped.position[2] = position ? position.z : 0;
      _pDropped.velocity[0] = velocity ? velocity.x : 0;
      _pDropped.velocity[1] = velocity ? velocity.y : 0;
      _pDropped.velocity[2] = velocity ? velocity.z : 0;
      this.bus.emit(Ev.WEAPON_DROPPED, _pDropped);
      out.push({ id: s.id, ammo: s.ammo, reserve: s.reserve });
    }
    this.slots.length = 0;
    this.activeIndex = 0;
    this.swapping = false;
    this._burstActive = false;
    return out;
  }

  /** Drop only the active weapon (to make room for a pickup). */
  dropActive(position) {
    const s = this.current;
    if (!s) return null;
    _pDropped.ownerId = this.ownerId;
    _pDropped.weaponId = s.id;
    _pDropped.ammo = s.ammo;
    _pDropped.position[0] = position ? position.x : 0;
    _pDropped.position[1] = position ? position.y : 0;
    _pDropped.position[2] = position ? position.z : 0;
    _pDropped.velocity[0] = 0;
    _pDropped.velocity[1] = 0;
    _pDropped.velocity[2] = 0;
    this.bus.emit(Ev.WEAPON_DROPPED, _pDropped);
    const rec = { id: s.id, ammo: s.ammo, reserve: s.reserve };
    this.slots.splice(this.activeIndex, 1);
    if (this.activeIndex >= this.slots.length) this.activeIndex = Math.max(0, this.slots.length - 1);
    return rec;
  }

  /**
   * Pick a weapon up. Fills an empty slot if there is one, otherwise replaces
   * the active weapon (which is dropped with its own remaining ammo).
   */
  pickup(weaponId, ammo, reserve, position) {
    const def = weaponDef(weaponId);
    if (this.slots.length >= MAX_WEAPONS) this.dropActive(position);
    const slot = makeSlot(weaponId);
    if (ammo !== undefined && ammo !== null) slot.ammo = clamp(ammo, 0, def.mag || ammo);
    if (reserve !== undefined && reserve !== null) slot.reserve = reserve;
    this.slots.push(slot);
    this.activeIndex = this.slots.length - 1;
    this.swapping = false;
    this._nextFireTime = this._time;
    _pPicked.ownerId = this.ownerId;
    _pPicked.weaponId = weaponId;
    _pPicked.ammo = slot.ammo;
    this.bus.emit(Ev.WEAPON_PICKEDUP, _pPicked);
    return slot;
  }

  // -----------------------------------------------------------------------
  // Grenades — FEEL.md §4.6
  // -----------------------------------------------------------------------

  addGrenade(type, n = 1) {
    const g = GRENADE[type];
    if (!g) return 0;
    const before = this.grenades[type];
    this.grenades[type] = Math.min(g.maxCarried, before + n);
    return this.grenades[type] - before;
  }

  /**
   * @param {'frag'|'plasma'} type
   * @param {Vector3} [origin] defaults to the owner's eye
   * @param {number} [yaw] defaults to the owner's yaw
   * @param {number} [pitch] defaults to the owner's pitch
   */
  throwGrenade(type, origin, yaw, pitch) {
    const g = GRENADE[type];
    if (!g) return null;
    if (this.grenades[type] <= 0) return null;
    this.grenades[type] -= 1;

    const oy = yaw === undefined ? this._ownerYaw : yaw;
    const op = pitch === undefined ? this._ownerPitch : pitch;
    dirFromYawPitch(oy, op + g.throwPitchDeg * DEG, _dir);
    _origin.copy(origin || this._ownerEye).addScaledVector(_dir, 0.3);

    const rec = {
      id: allocId(),
      type,
      def: g,
      fuse: g.fuse,
      stuck: false,
      stuckTarget: null,
      body: null,
      ownerId: this.ownerId,
    };
    const self = this;
    rec.body = this.physics.addBody({
      position: _origin,
      velocity: _tmp.copy(_dir).multiplyScalar(g.throwSpeed),
      radius: g.radius,
      restitution: g.restitution,
      friction: g.friction,
      sleepThreshold: 0.05,
      entityId: rec.id,
      onCollide(point, normal, impactSpeed, surfaceId) {
        _pBounced.grenadeId = rec.id;
        _pBounced.point[0] = point.x;
        _pBounced.point[1] = point.y;
        _pBounced.point[2] = point.z;
        _pBounced.normal[0] = normal.x;
        _pBounced.normal[1] = normal.y;
        _pBounced.normal[2] = normal.z;
        _pBounced.impactSpeed = impactSpeed;
        _pBounced.surfaceId = surfaceId;
        self.bus.emit(Ev.GRENADE_BOUNCED, _pBounced);
        if (g.sticks && !rec.stuck && STICKY_SURFACES.indexOf(surfaceId) >= 0) {
          self._stickGrenade(rec, 0, point);
        }
      },
    });
    this.liveGrenades.push(rec);

    _pThrown.ownerId = this.ownerId;
    _pThrown.grenadeType = type;
    _pThrown.origin[0] = _origin.x;
    _pThrown.origin[1] = _origin.y;
    _pThrown.origin[2] = _origin.z;
    _pThrown.velocity[0] = _dir.x * g.throwSpeed;
    _pThrown.velocity[1] = _dir.y * g.throwSpeed;
    _pThrown.velocity[2] = _dir.z * g.throwSpeed;
    _pThrown.fuseMs = g.fuse * 1000;
    this.bus.emit(Ev.GRENADE_THROWN, _pThrown);
    return rec;
  }

  _stickGrenade(rec, targetId, point) {
    rec.stuck = true;
    rec.body.stuckTo = { entityId: targetId, localPoint: new Vector3() };
    rec.body.velocity.set(0, 0, 0);
    rec.fuse = Math.min(rec.fuse, rec.def.fuseAfterStick ?? rec.fuse);
    _pStuck.grenadeId = rec.id;
    _pStuck.targetId = targetId;
    _pStuck.localPoint[0] = point ? point.x : 0;
    _pStuck.localPoint[1] = point ? point.y : 0;
    _pStuck.localPoint[2] = point ? point.z : 0;
    this.bus.emit(Ev.GRENADE_STUCK, _pStuck);
  }

  _stepGrenades(dt) {
    for (let i = this.liveGrenades.length - 1; i >= 0; i--) {
      const rec = this.liveGrenades[i];

      // Plasma sticking to entities: physics knows nothing about characters,
      // so the weapons system owns this test AND the follow-transform.
      if (rec.def.sticks && !rec.stuck) {
        const list = this.targets.list;
        for (let j = 0; j < list.length; j++) {
          const t = list[j];
          if (t.state && t.state.dead) continue;
          const cap = t.getCapsule();
          const d = pointSegmentDistance(
            rec.body.position.x, rec.body.position.y, rec.body.position.z,
            cap.position.x, cap.position.y + cap.radius, cap.position.z,
            cap.position.x, cap.position.y + cap.height - cap.radius, cap.position.z,
          );
          if (d <= cap.radius + rec.def.radius) {
            rec.stuckTarget = t;
            rec.stuckOffset = rec.stuckOffset || new Vector3();
            rec.stuckOffset.copy(rec.body.position).sub(cap.position);
            this._stickGrenade(rec, t.entityId, rec.body.position);
            break;
          }
        }
      } else if (rec.stuck && rec.stuckTarget) {
        const cap = rec.stuckTarget.getCapsule();
        rec.body.position.copy(cap.position).add(rec.stuckOffset);
      }

      rec.fuse -= dt;
      if (rec.fuse <= 0) {
        this._detonate(rec);
        this.liveGrenades.splice(i, 1);
      }
    }
  }

  _detonate(rec) {
    const g = rec.def;
    const p = rec.body.position;
    _hitPoint.copy(p);
    _hitNormal.set(0, 1, 0);

    _pDetonated.grenadeId = rec.id;
    _pDetonated.grenadeType = rec.type;
    _pDetonated.point[0] = p.x;
    _pDetonated.point[1] = p.y;
    _pDetonated.point[2] = p.z;
    _pDetonated.radius = g.blastRadius;
    _pDetonated.ownerId = rec.ownerId;
    this.bus.emit(Ev.GRENADE_DETONATED, _pDetonated);

    _pExplosion.point[0] = p.x;
    _pExplosion.point[1] = p.y;
    _pExplosion.point[2] = p.z;
    _pExplosion.radius = g.blastRadius;
    _pExplosion.energy = g.blastDamage;
    _pExplosion.damageType = g.damageType;
    this.bus.emit(Ev.EXPLOSION_OCCURRED, _pExplosion);

    // Direct stick damage first (FEEL.md §4.6 — 130 PLASMA, unconditional
    // kill on a player).
    if (rec.stuckTarget && g.stickDamage) {
      this._damageTarget(
        rec.stuckTarget,
        g.stickDamage,
        g.damageType,
        HitRegion.TORSO,
        1,
        rec.type,
      );
    }

    // Radial blast. Self-damage is 100% — the owner is damaged exactly like
    // anyone else, which is why it is not special-cased here.
    const list = this.targets.list;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.state || t.state.dead) continue;
      const cap = t.getCapsule();
      _com.set(cap.position.x, cap.position.y + cap.height * 0.5, cap.position.z);
      const d = _com.distanceTo(p);
      const f = blastFalloff(d, g.blastRadius, g.falloffExp);
      if (f <= 0) continue;
      _hitPoint.copy(_com);
      _hitNormal.copy(_com).sub(p).normalize();
      this._damageTarget(t, g.blastDamage * f, g.damageType, HitRegion.TORSO, 1, rec.type);
    }

    this.physics.remove(rec.body);
  }

  // -----------------------------------------------------------------------
  // Melee — FEEL.md §4.7
  // -----------------------------------------------------------------------

  melee() {
    if (this._melee.active) return false;
    this._cancelReload(); // melee cancels reload; it does NOT cancel a swap
    this._burstActive = false;
    this._melee.active = true;
    this._melee.t = 0;
    this._melee.resolved = false;
    this._melee.recovery = MELEE.recovery;
    _pMeleeSwing.ownerId = this.ownerId;
    _pMeleeSwing.durationMs = (MELEE.contact + MELEE.recovery) * 1000;
    this.bus.emit(Ev.MELEE_SWING, _pMeleeSwing);
    return true;
  }

  _stepMelee(dt) {
    const m = this._melee;
    if (!m.active) return;
    m.t += dt;
    if (!m.resolved && m.t >= MELEE.contact) {
      m.resolved = true;
      const killed = this._resolveMelee();
      m.recovery = killed ? MELEE.recoveryOnKill : MELEE.recovery;
    }
    if (m.resolved && m.t >= MELEE.contact + m.recovery) m.active = false;
  }

  /** @returns {boolean} true if the swing killed. */
  _resolveMelee() {
    const ox = this._ownerEye.x;
    const oz = this._ownerEye.z;
    const fx = this._ownerForward.x;
    const fz = this._ownerForward.z;
    const fLen = Math.hypot(fx, fz) || 1;
    const fnx = fx / fLen;
    const fnz = fz / fLen;

    let best = null;
    let bestDist = Infinity;
    const list = this.targets.list;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!this.targets.isValidTarget(t, this.faction, this.ownerId)) continue;
      const cap = t.getCapsule();
      const dx = cap.position.x - ox;
      const dz = cap.position.z - oz;
      const d = Math.hypot(dx, dz);
      if (d > MELEE.range || d < 1e-6) continue;
      if ((dx / d) * fnx + (dz / d) * fnz < MELEE_CONE_COS) continue;
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }

    if (!best) {
      _pMeleeWhiff.ownerId = this.ownerId;
      this.bus.emit(Ev.MELEE_WHIFFED, _pMeleeWhiff);
      return false;
    }

    const cap = best.getCapsule();
    // Lunge assist: up to 1.1 m of forward pull toward the target.
    const pull = Math.min(MELEE.lungePull, Math.max(0, bestDist - cap.radius * 1.2));
    if (pull > 0) {
      this._lunge.set(fnx * pull, 0, fnz * pull);
      this._lungePending = true;
    }

    // From behind: dot(attackerForward, targetForward) > 0.55 AND range ≤ 1.6 m.
    const tf = best.getForward();
    const tLen = Math.hypot(tf.x, tf.z) || 1;
    const dot = fnx * (tf.x / tLen) + fnz * (tf.z / tLen);
    const fromBehind = dot > MELEE.behindDot && bestDist <= MELEE.behindRange;

    _hitPoint.set(cap.position.x, cap.position.y + cap.height * 0.5, cap.position.z);
    _hitNormal.set(-fnx, 0, -fnz);

    // melee.landed is emitted BEFORE the damage chain so a consumer sees
    // landed -> damage.applied -> entity.killed in causal order.
    _pMeleeLanded.ownerId = this.ownerId;
    _pMeleeLanded.targetId = best.entityId;
    _pMeleeLanded.fromBehind = fromBehind;
    _pMeleeLanded.point[0] = _hitPoint.x;
    _pMeleeLanded.point[1] = _hitPoint.y;
    _pMeleeLanded.point[2] = _hitPoint.z;
    this.bus.emit(Ev.MELEE_LANDED, _pMeleeLanded);

    let killed = false;
    if (fromBehind) {
      // Assassination — unconditional. Routed through resolveDamage with a
      // lethal amount so the shield/health bookkeeping and the event chain
      // stay identical to every other kill.
      const s = best.state;
      const lethal = s.shield + s.maxHealth + 1;
      const res = this._damageTarget(best, lethal, DamageType.MELEE, HitRegion.TORSO, 1, 'melee');
      killed = !!(res && res.killed);
    } else {
      const res = this._damageTarget(
        best,
        MELEE.damage,
        DamageType.MELEE,
        HitRegion.TORSO,
        1,
        'melee',
      );
      killed = !!(res && res.killed);
    }
    return killed;
  }
}

export { rayCapsule, pointSegmentDistance, dirFromYawPitch, GRAVITY };
export default WeaponSystem;
