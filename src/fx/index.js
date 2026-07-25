// L4 fx — public entry point. OWNER: `fx`. ARCHITECTURE.md §2.2.
//
// `fx` is a PURE CONSUMER of the event bus: it subscribes, it never emits, and
// it never calls into gameplay. Imports are restricted to `three`,
// `../shared/*`, `../core/*`, `../materials/*` and `../render/index.js`
// (layer constants + the globals object only), per ARCHITECTURE.md §3 L4.
//
// Everything this system draws lives on LAYER_TRANSPARENT and is therefore
// rendered by frame graph pass 8 — after opaque and after the sky dome,
// excluded from the prepass, excluded from the shadow cascades, depth tested
// against the opaque depth buffer, depth write OFF.
//
// It contributes exactly THREE draw calls, always, regardless of how much is on
// screen: one decal instance draw, one alpha particle instance draw, one
// additive particle instance draw.
//
// ART.md §2: there are no texture files and no generated bitmaps anywhere in
// src/fx. Every particle and decal shape is an analytic mask in the fragment
// shader, the same technique src/materials/index.js uses for surfaces.
//
// ARCHITECTURE.md §7.2/§7.3: the only randomness here is `rng('fx')`. There is
// no Math.random(), no Date.now(), and no performance.now() in this directory.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { rng } from '../core/rng.js';
import { Ev } from '../shared/events.js';
import { SurfaceId, DamageType, Archetype } from '../shared/enums.js';

import {
  ADD_CAP,
  ALPHA_CAP,
  PARTICLE_CAP,
  DECAL_CAP,
  LIGHT_CAP,
  FX_DRAW_CALLS,
} from './constants.js';
import { ParticlePool } from './particles.js';
import { DecalPool } from './decals.js';
import { FxLightPool } from './lights.js';
import { EmitterPool } from './emitters.js';
import {
  surfaceImpact,
  muzzleFlash,
  tracer,
  detonation,
  shieldBroken,
  shieldRecharged,
  meleeImpact,
  bouncePuff,
  vehicleImpact,
  familyOf,
  readVec,
  normalizeInto,
} from './effects.js';

// Distance LOD. Impact particle counts scale down with range; past FX_CULL a
// small-arms impact contributes nothing at all. Explosions and shield breaks
// have their own floors and are never fully culled.
const LOD_NEAR = 45;
const LOD_FAR = 90;
const FX_CULL = 260;

/** FEEL.md §4.5 — overheat lockout is 3.4 s; the plume runs for that window. */
const OVERHEAT_VENT_TIME = 3.4;

export class FxSystem {
  /**
   * @param {object} opts
   * @param {THREE.Scene}  opts.scene   the render scene (renderer.scene)
   * @param {object}       opts.globals the GlobalUniforms object from src/render
   * @param {THREE.Camera} opts.camera  world camera, used only for LOD/sorting
   * @param {object} [opts.clusters]    renderer.clusters — required for FX lights
   * @param {object} [opts.renderer]    RingfallRenderer; `clusters` is read off it
   */
  constructor({ scene, globals, camera, clusters, renderer } = {}) {
    if (!scene) throw new Error('[fx] FxSystem requires { scene }');
    this.scene = scene;
    this.globals = globals ?? null;
    this.camera = camera ?? null;

    const cl = clusters ?? renderer?.clusters ?? null;
    this.hasLights = !!cl;

    this.add = new ParticlePool(ADD_CAP, true, false);
    this.alpha = new ParticlePool(ALPHA_CAP, false, true);
    this.decals = new DecalPool(DECAL_CAP);
    this.lights = new FxLightPool(cl, LIGHT_CAP);
    this.emitters = new EmitterPool();

    this.scene.add(this.decals.mesh);
    this.scene.add(this.alpha.mesh);
    this.scene.add(this.add.mesh);

    this.rand = rng('fx');
    this.time = 0;

    // Payload unpacking scratch. Allocated once; every handler reuses these.
    this._p = new Float32Array(3);
    this._n = new Float32Array(3);

    // Camera position cache, updated every frame. Used for LOD and for the
    // alpha pool's back-to-front sort.
    this._camX = 0;
    this._camY = 0;
    this._camZ = 0;

    // The spawn context handed to every recipe in effects.js. Built once.
    this.ctx = {
      add: this.add,
      alpha: this.alpha,
      decals: this.decals,
      lights: this.lights,
      rand: this.rand,
      sphereOut: new Float32Array(3),
      B: 1 / 0.88,
      lod: (x, y, z) => this._lod(x, y, z),
    };
    this._refreshBloomFloor();

    // Last known world positions, so events whose payloads carry no point can
    // still be placed. One small record per entity, created once, mutated in
    // place — this is NOT a per-frame allocation.
    /** @type {Map<number, {x:number,y:number,z:number}>} */
    this._entityPos = new Map();
    /** @type {Map<number, {x:number,y:number,z:number,dx:number,dy:number,dz:number,family:number}>} */
    this._muzzle = new Map();

    this.stats = {
      particles: 0,
      additive: 0,
      alpha: 0,
      decals: 0,
      lights: 0,
      emitters: 0,
      drawCalls: FX_DRAW_CALLS,
      droppedParticles: 0,
      decalsReplaced: 0,
      eventsHandled: 0,
      skippedNoPosition: 0,
    };
  }

  /**
   * ART.md §7.2 puts the bloom threshold at 1.0 in POST-EXPOSURE linear.
   * Exposure is frozen and owned by `lighting`; reading it here is the
   * sanctioned way to know what scene-linear value lands on the knee.
   * Every brightness in effects.js is expressed as a multiple of this.
   */
  _refreshBloomFloor() {
    const e = this.globals?.u?.uExposure?.value;
    this.ctx.B = Number.isFinite(e) && e > 1e-4 ? 1 / e : 1 / 0.88;
  }

  _lod(x, y, z) {
    const dx = x - this._camX;
    const dy = y - this._camY;
    const dz = z - this._camZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > FX_CULL * FX_CULL) return 0;
    if (d2 > LOD_FAR * LOD_FAR) return 0.28;
    if (d2 > LOD_NEAR * LOD_NEAR) return 0.55;
    return 1;
  }

  // -------------------------------------------------------------------------
  // Position bookkeeping. `shield.recharge.*` and `vehicle.impact` carry no
  // world point (ARCHITECTURE.md §4.1 / §4.6); these caches are how FX places
  // them at all. See DEFECTS.md FX1.
  // -------------------------------------------------------------------------
  setEntityPosition(entityId, x, y, z) {
    if (!Number.isFinite(entityId) || entityId === 0) return;
    let r = this._entityPos.get(entityId);
    if (!r) {
      r = { x: 0, y: 0, z: 0 };
      this._entityPos.set(entityId, r);
    }
    r.x = x; r.y = y; r.z = z;
  }

  getEntityPosition(entityId) {
    return this._entityPos.get(entityId) ?? null;
  }

  forgetEntity(entityId) {
    this._entityPos.delete(entityId);
    this._muzzle.delete(entityId);
  }

  _setMuzzle(ownerId, x, y, z, dx, dy, dz, family) {
    if (!Number.isFinite(ownerId)) return;
    let r = this._muzzle.get(ownerId);
    if (!r) {
      r = { x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0, family: 0 };
      this._muzzle.set(ownerId, r);
    }
    r.x = x; r.y = y; r.z = z;
    r.dx = dx; r.dy = dy; r.dz = dz;
    r.family = family;
  }

  // -------------------------------------------------------------------------
  // Event handlers. Called synchronously from the bus, inside the sim tick.
  // Every one of them is allocation free.
  // -------------------------------------------------------------------------

  onSurfaceImpact(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.point, this._p, 0, 0, 0);
    const n = normalizeInto(readVec(p.normal, this._n, 0, 1, 0), 0, 1, 0);
    surfaceImpact(this.ctx, v[0], v[1], v[2], n[0], n[1], n[2], p.surfaceId, p.energy, p.damageType);
  }

  onWeaponFired(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.muzzle, this._p, 0, 0, 0);
    const mx = v[0], my = v[1], mz = v[2];
    const d = normalizeInto(readVec(p.direction, this._n, 0, 0, -1), 0, 0, -1);
    const dx = d[0], dy = d[1], dz = d[2];

    const family = familyOf(p.weaponId);
    this._setMuzzle(p.ownerId, mx, my, mz, dx, dy, dz, family);
    if (Number.isFinite(p.ownerId)) this.setEntityPosition(p.ownerId, mx, my, mz);

    if (this._lod(mx, my, mz) <= 0) return;
    muzzleFlash(this.ctx, mx, my, mz, dx, dy, dz, family);
    tracer(this.ctx, mx, my, mz, dx, dy, dz, family);
  }

  onWeaponOverheat(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const m = this._muzzle.get(p.ownerId);
    if (!m) {
      // `weapon.overheat` carries no position (ARCHITECTURE.md §4.2). Without a
      // prior `weapon.fired` from this owner there is nowhere to put the plume.
      this.stats.skippedNoPosition++;
      return;
    }
    this.emitters.vent(p.ownerId, m.x, m.y, m.z, m.dx, m.dy, m.dz, OVERHEAT_VENT_TIME);
  }

  onGrenadeThrown(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const o = readVec(p.origin, this._p, 0, 0, 0);
    const ox = o[0], oy = o[1], oz = o[2];
    const v = readVec(p.velocity, this._n, 0, 0, 0);
    const type = p.grenadeType === 'plasma' ? 'plasma' : 'frag';
    const fuse = Number.isFinite(p.fuseMs) ? p.fuseMs / 1000 : 3.0;
    this.emitters.throwGrenade(type, ox, oy, oz, v[0], v[1], v[2], fuse, this.lights);
  }

  onGrenadeBounced(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.point, this._p, 0, 0, 0);
    const px = v[0], py = v[1], pz = v[2];
    const n = normalizeInto(readVec(p.normal, this._n, 0, 1, 0), 0, 1, 0);
    const nx = n[0], ny = n[1], nz = n[2];
    this.emitters.bounce(px, py, pz, nx, ny, nz);
    bouncePuff(this.ctx, px, py, pz, nx, ny, nz, p.surfaceId, p.impactSpeed ?? 6);
  }

  onGrenadeStuck(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    // No world point on this payload; the tracked trail's own estimate is the
    // only position available. Retiring it stops the ribbon dead, which is the
    // correct read for a stuck plasma.
    const it = this.emitters.retireNearest(0, 0, 0, this.lights);
    if (!it) this.stats.skippedNoPosition++;
  }

  onGrenadeDetonated(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.point, this._p, 0, 0, 0);
    const px = v[0], py = v[1], pz = v[2];
    this.emitters.retireNearest(px, py, pz, this.lights);
    const plasma = p.grenadeType === 'plasma';
    detonation(this.ctx, px, py, pz, p.radius ?? (plasma ? 4.0 : 5.5), plasma ? 1 : 0);
  }

  onExplosion(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.point, this._p, 0, 0, 0);
    const plasma = p.damageType === DamageType.PLASMA;
    detonation(this.ctx, v[0], v[1], v[2], p.radius ?? 4, plasma ? 1 : 0);
  }

  onShieldBroken(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.point, this._p, 0, 0, 0);
    const px = v[0], py = v[1], pz = v[2];
    const n = normalizeInto(readVec(p.normal, this._n, 0, 1, 0), 0, 1, 0);
    this.setEntityPosition(p.entityId, px, py, pz);
    shieldBroken(this.ctx, px, py, pz, n[0], n[1], n[2], p.overkill);
  }

  onShieldRecharge(p, full) {
    if (!p) return;
    this.stats.eventsHandled++;
    const r = this._entityPos.get(p.entityId);
    if (!r) {
      this.stats.skippedNoPosition++;
      return;
    }
    shieldRecharged(this.ctx, r.x, r.y, r.z, full);
  }

  onMeleeLanded(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.point, this._p, 0, 0, 0);
    const px = v[0], py = v[1], pz = v[2];
    if (Number.isFinite(p.targetId)) this.setEntityPosition(p.targetId, px, py, pz);
    meleeImpact(this.ctx, px, py, pz, !!p.fromBehind);
  }

  onVehicleImpact(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const r = this._entityPos.get(p.vehicleId);
    if (!r) {
      // ARCHITECTURE.md §4.6: `vehicle.impact` has no point[3]. See DEFECTS.md FX1.
      this.stats.skippedNoPosition++;
      return;
    }
    const n = normalizeInto(readVec(p.normal, this._n, 0, 1, 0), 0, 1, 0);
    vehicleImpact(this.ctx, r.x, r.y, r.z, n[0], n[1], n[2], p.relativeSpeed ?? 8);
  }

  onVehicleDestroyed(p) {
    if (!p) return;
    this.stats.eventsHandled++;
    const v = readVec(p.position, this._p, 0, 0, 0);
    this.setEntityPosition(p.vehicleId, v[0], v[1], v[2]);
    detonation(this.ctx, v[0], v[1] + 0.6, v[2], 6.5, 0);
  }

  onDamageApplied(p) {
    if (!p || !p.point) return;
    // Position bookkeeping only — `surface.impact` is the FX hook for the hit
    // itself, and reacting to both would double every effect.
    const v = readVec(p.point, this._p, 0, 0, 0);
    if (Number.isFinite(p.targetId)) this.setEntityPosition(p.targetId, v[0], v[1], v[2]);
  }

  onEntitySpawned(p) {
    if (!p) return;
    const v = readVec(p.position, this._p, 0, 0, 0);
    this.setEntityPosition(p.entityId, v[0], v[1], v[2]);
  }

  onEntityKilled(p) {
    if (!p) return;
    const v = readVec(p.position, this._p, 0, 0, 0);
    this.setEntityPosition(p.entityId, v[0], v[1], v[2]);
  }

  // -------------------------------------------------------------------------

  /**
   * @param {number} dt seconds (render delta — FX is a render-rate system)
   * @param {THREE.Vector3|number[]} [cameraPosition]
   */
  update(dt, cameraPosition) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 0;
    if (dt > 0.25) dt = 0.25; // same clamp src/core/clock.js applies
    this.time += dt;

    if (cameraPosition) {
      if (typeof cameraPosition.x === 'number') {
        this._camX = cameraPosition.x;
        this._camY = cameraPosition.y;
        this._camZ = cameraPosition.z;
      } else if (cameraPosition.length >= 3) {
        this._camX = cameraPosition[0];
        this._camY = cameraPosition[1];
        this._camZ = cameraPosition[2];
      }
    } else if (this.camera) {
      const m = this.camera.matrixWorld.elements;
      this._camX = m[12];
      this._camY = m[13];
      this._camZ = m[14];
    }

    this._refreshBloomFloor();

    // Emitters spawn into the pools, so they run BEFORE the pools integrate;
    // that way a trail segment born this frame is uploaded this frame.
    this.emitters.update(dt, this.ctx, this.lights);
    this.lights.update(dt);

    this.add.update(dt, this._camX, this._camY, this._camZ);
    this.alpha.update(dt, this._camX, this._camY, this._camZ);
    this.decals.update(dt);

    const s = this.stats;
    s.additive = this.add.count;
    s.alpha = this.alpha.count;
    s.particles = this.add.count + this.alpha.count;
    s.decals = this.decals.count;
    s.lights = this.lights.active;
    s.emitters = this.emitters.active;
    s.droppedParticles = this.add.dropped + this.alpha.dropped;
    s.decalsReplaced = this.decals.replaced;
    s.drawCalls = FX_DRAW_CALLS;
  }

  /** ARCHITECTURE.md §7.4 — deterministic capture resets particles and decals. */
  reset() {
    this.add.clear();
    this.alpha.clear();
    this.decals.clear();
    this.emitters.clear(this.lights);
    this.lights.clear();
    this.time = 0;
    this._entityPos.clear();
    this._muzzle.clear();
  }

  /** Hard caps, for the self-test and for the profiler overlay. */
  caps() {
    return {
      particles: PARTICLE_CAP,
      additive: ADD_CAP,
      alpha: ALPHA_CAP,
      decals: DECAL_CAP,
      lights: this.lights.reserved,
      emitters: this.emitters.cap,
      drawCalls: FX_DRAW_CALLS,
    };
  }

  dispose() {
    this.scene.remove(this.decals.mesh);
    this.scene.remove(this.alpha.mesh);
    this.scene.remove(this.add.mesh);
    this.emitters.clear(this.lights);
    this.lights.dispose();
    this.add.dispose();
    this.alpha.dispose();
    this.decals.dispose();
    this._entityPos.clear();
    this._muzzle.clear();
  }
}

/**
 * Subscribe `fx` to every event it consumes.
 * @param {FxSystem} fx
 * @param {object} [bus] event bus; defaults to the singleton in src/core
 * @returns {() => void} unsubscribe
 */
export function wireFxEvents(fx, bus = events) {
  const unsubs = [];
  const on = (name, fn) => unsubs.push(bus.on(name, fn));

  on(Ev.SURFACE_IMPACT, (p) => fx.onSurfaceImpact(p));
  on(Ev.WEAPON_FIRED, (p) => fx.onWeaponFired(p));
  on(Ev.WEAPON_OVERHEAT, (p) => fx.onWeaponOverheat(p));

  on(Ev.GRENADE_THROWN, (p) => fx.onGrenadeThrown(p));
  on(Ev.GRENADE_BOUNCED, (p) => fx.onGrenadeBounced(p));
  on(Ev.GRENADE_STUCK, (p) => fx.onGrenadeStuck(p));
  on(Ev.GRENADE_DETONATED, (p) => fx.onGrenadeDetonated(p));

  on(Ev.EXPLOSION_OCCURRED, (p) => fx.onExplosion(p));

  on(Ev.SHIELD_BROKEN, (p) => fx.onShieldBroken(p));
  on(Ev.SHIELD_RECHARGE_START, (p) => fx.onShieldRecharge(p, false));
  on(Ev.SHIELD_RECHARGE_FULL, (p) => fx.onShieldRecharge(p, true));

  on(Ev.MELEE_LANDED, (p) => fx.onMeleeLanded(p));

  on(Ev.VEHICLE_IMPACT, (p) => fx.onVehicleImpact(p));
  on(Ev.VEHICLE_DESTROYED, (p) => fx.onVehicleDestroyed(p));

  // Position bookkeeping only — these never spawn anything on their own.
  on(Ev.DAMAGE_APPLIED, (p) => fx.onDamageApplied(p));
  on(Ev.ENTITY_SPAWNED, (p) => fx.onEntitySpawned(p));
  on(Ev.ENTITY_KILLED, (p) => fx.onEntityKilled(p));
  on(Ev.ENTITY_DESPAWNED, (p) => p && fx.forgetEntity(p.entityId));

  return () => {
    for (let i = 0; i < unsubs.length; i++) unsubs[i]();
    unsubs.length = 0;
  };
}

export { PARTICLE_CAP, DECAL_CAP, LIGHT_CAP, FX_DRAW_CALLS };
export { SurfaceId, DamageType, Archetype };
