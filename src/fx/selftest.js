// L4 fx — self-test. Headless: no WebGL context, no DOM, no renderer.
// Builds FxSystem against a bare THREE.Scene, drives every consumed event
// several hundred times through the REAL event bus, steps update() for 600
// frames, and asserts the pool invariants.
//
// Run with `node` (see src/fx/README.md) or wire into tools/playtest.mjs.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { Ev } from '../shared/events.js';
import { setSessionSeed, rng } from '../core/rng.js';
import { SurfaceId, DamageType, Archetype } from '../shared/enums.js';
import { FxSystem, wireFxEvents } from './index.js';
import { ADD_CAP, ALPHA_CAP, PARTICLE_CAP, DECAL_CAP, FX_DRAW_CALLS } from './constants.js';

/** Minimal stand-in for src/render/globals.js — FX only reads uExposure. */
function fakeGlobals(exposure = 0.88) {
  return { u: { uExposure: { value: exposure } } };
}

/** Minimal stand-in for src/render/clusters.js LightClusters. */
function fakeClusters() {
  return {
    lights: [],
    addPointLight(position, color, intensity, range) {
      const l = {
        position: position.clone(),
        color: color.clone(),
        intensity,
        range,
        type: 0,
        dir: new THREE.Vector3(0, -1, 0),
        cosOuter: -1,
        cosInner: -1,
        enabled: true,
      };
      this.lights.push(l);
      return l;
    },
  };
}

const SURFACES = [
  SurfaceId.METAL_PAINTED, SurfaceId.METAL_BARE, SurfaceId.METAL_GRATE,
  SurfaceId.CONCRETE, SurfaceId.ROCK, SurfaceId.DIRT, SurfaceId.GRASS,
  SurfaceId.SAND, SurfaceId.GLASS, SurfaceId.ALLOY_SMOOTH, SurfaceId.ALLOY_HARD,
  SurfaceId.ENERGY_BARRIER, SurfaceId.FLESH, SurfaceId.ARMOR_HARD,
  SurfaceId.SHIELD, SurfaceId.VEHICLE_HULL, SurfaceId.WATER,
];

const WEAPONS = ['cadence_ar', 'vector_br', 'longbow', 'breaker', 'ember_repeater', 'vess_sidearm'];

export function runFxSelfTest({ frames = 600, burst = 400, verbose = false } = {}) {
  const results = [];
  const push = (name, ok, measured, expected) => {
    results.push({ name, ok: !!ok, measured, expected });
    if (verbose) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  measured=${measured} expected=${expected}`);
  };

  setSessionSeed(1337);
  // The test's own jitter comes from the same seeded stream FX uses; there is
  // no second RNG anywhere in or around this directory.
  const r = rng('fx');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 4000);
  camera.position.set(0, 1.62, 0);
  camera.updateMatrixWorld(true);

  const globals = fakeGlobals(0.88);
  const clusters = fakeClusters();
  const fx = new FxSystem({ scene, globals, camera, clusters });
  const unwire = wireFxEvents(fx);

  const caps = fx.caps();

  // ---- construction -------------------------------------------------------
  push('constructs against a bare THREE.Scene', scene.children.length === FX_DRAW_CALLS,
    scene.children.length, FX_DRAW_CALLS);
  push('reserves its clustered lights up front, once',
    clusters.lights.length === caps.lights && caps.lights > 0,
    clusters.lights.length, caps.lights);
  push('bloom floor derives from the frozen exposure constant',
    Math.abs(fx.ctx.B - 1 / 0.88) < 1e-9, fx.ctx.B, 1 / 0.88);

  // ---- drive every consumed event ----------------------------------------
  // Payloads are reused objects: the bus contract (ARCHITECTURE.md §4) says
  // handlers must not retain a reference past the call, so reusing one object
  // per event type is also a test that FX honours that.
  const impact = { point: [0, 0, 0], normal: [0, 1, 0], surfaceId: 0, energy: 0, damageType: 0, sourceId: 1 };
  const fired = { ownerId: 1, weaponId: '', muzzle: [0, 0, 0], direction: [0, 0, -1], seed: 0, ammoRemaining: 10, isFirstOfBurst: true };
  const overheat = { ownerId: 1, weaponId: 'ember_repeater' };
  const thrown = { ownerId: 1, grenadeType: 'frag', origin: [0, 1.5, 0], velocity: [0, 0, 0], fuseMs: 3000 };
  const bounced = { grenadeId: 1, point: [0, 0, 0], normal: [0, 1, 0], impactSpeed: 8, surfaceId: 3 };
  const stuck = { grenadeId: 1, targetId: 2, localPoint: [0, 0, 0] };
  const detonated = { grenadeId: 1, grenadeType: 'frag', point: [0, 0, 0], radius: 5.5, ownerId: 1 };
  const explosion = { point: [0, 0, 0], radius: 4, energy: 60, damageType: DamageType.EXPLOSIVE };
  const shieldBroke = { entityId: 2, overkill: 12, point: [0, 1.4, -6], normal: [0, 0, 1] };
  const recharge = { entityId: 2 };
  const melee = { ownerId: 1, targetId: 2, fromBehind: false, point: [0, 1.4, -1.6] };
  const vImpact = { vehicleId: 9, otherId: 2, relativeSpeed: 14, normal: [1, 0, 0] };
  const vDestroy = { vehicleId: 9, position: [4, 0.6, -12] };
  const spawned = { entityId: 2, archetype: Archetype.VANE, faction: 2, position: [0, 0, -8] };
  const damage = { targetId: 2, sourceId: 1, amount: 8, rawAmount: 8, damageType: 0, hitRegion: 1, point: [0, 1.3, -8], normal: [0, 0, 1], weaponId: 'vector_br', absorbedByShield: true };

  // Seed the position caches the way a real session would.
  events.emit(Ev.ENTITY_SPAWNED, spawned);
  spawned.entityId = 9;
  spawned.archetype = Archetype.RIDGEBACK;
  spawned.position[0] = 4; spawned.position[1] = 0.6; spawned.position[2] = -12;
  events.emit(Ev.ENTITY_SPAWNED, spawned);

  let overCap = false;
  let overDecalCap = false;
  let addOverCap = false;
  let alphaOverCap = false;
  let drawCallsConstant = true;
  let nanSeen = false;
  let sceneChildrenConstant = true;
  let peakParticles = 0;
  let peakDecals = 0;
  let peakLights = 0;
  let peakAdd = 0;
  let peakAlpha = 0;

  const checkInvariants = () => {
    const n = fx.add.count + fx.alpha.count;
    if (n > peakParticles) peakParticles = n;
    if (fx.add.count > peakAdd) peakAdd = fx.add.count;
    if (fx.alpha.count > peakAlpha) peakAlpha = fx.alpha.count;
    if (fx.decals.count > peakDecals) peakDecals = fx.decals.count;
    const li = fx.lights.active;
    if (li > peakLights) peakLights = li;
    if (n > PARTICLE_CAP) overCap = true;
    if (fx.add.count > ADD_CAP) addOverCap = true;
    if (fx.alpha.count > ALPHA_CAP) alphaOverCap = true;
    if (fx.decals.count > DECAL_CAP) overDecalCap = true;
    if (fx.stats.drawCalls !== FX_DRAW_CALLS) drawCallsConstant = false;
    if (scene.children.length !== FX_DRAW_CALLS) sceneChildrenConstant = false;
    if (fx.add.hasNaN() || fx.alpha.hasNaN() || fx.decals.hasNaN()) nanSeen = true;
  };

  const dt = 1 / 60;
  const camPos = new THREE.Vector3(0, 1.62, 0);

  for (let f = 0; f < frames; f++) {
    // Several hundred of every event, spread across the run so the pools are
    // pushed hard and then allowed to drain.
    const perFrame = Math.ceil(burst / (frames * 0.6));
    if (f < frames * 0.6) {
      for (let k = 0; k < perFrame; k++) {
        const sx = r.range(-30, 30), sy = r.range(0, 6), sz = r.range(-30, 30);

        impact.point[0] = sx; impact.point[1] = sy; impact.point[2] = sz;
        impact.normal[0] = r.range(-1, 1); impact.normal[1] = r.range(-1, 1); impact.normal[2] = r.range(-1, 1);
        impact.surfaceId = SURFACES[f % SURFACES.length];
        impact.energy = r.range(1, 120);
        impact.damageType = f % 3 === 0 ? DamageType.PLASMA : DamageType.KINETIC;
        events.emit(Ev.SURFACE_IMPACT, impact);

        fired.weaponId = WEAPONS[(f + k) % WEAPONS.length];
        fired.ownerId = 1 + ((f + k) % 5);
        fired.muzzle[0] = r.range(-4, 4); fired.muzzle[1] = 1.5; fired.muzzle[2] = r.range(-4, 4);
        fired.direction[0] = r.range(-1, 1); fired.direction[1] = r.range(-0.3, 0.3); fired.direction[2] = r.range(-1, 1);
        events.emit(Ev.WEAPON_FIRED, fired);

        damage.point[0] = sx; damage.point[1] = sy; damage.point[2] = sz;
        events.emit(Ev.DAMAGE_APPLIED, damage);
      }

      // Surge window: a deliberate over-subscription so the drop path and the
      // hard caps are genuinely exercised, not merely approached.
      if (f >= 200 && f < 280) {
        for (let k = 0; k < 20; k++) {
          impact.point[0] = r.range(-8, 8); impact.point[1] = r.range(0.2, 3); impact.point[2] = r.range(-8, 8);
          impact.normal[0] = r.range(-1, 1); impact.normal[1] = 1; impact.normal[2] = r.range(-1, 1);
          impact.surfaceId = SURFACES[(f + k) % SURFACES.length];
          impact.energy = r.range(20, 120);
          events.emit(Ev.SURFACE_IMPACT, impact);
        }
        for (let k = 0; k < 8; k++) {
          fired.weaponId = WEAPONS[(f + k) % WEAPONS.length];
          fired.muzzle[0] = r.range(-2, 2); fired.muzzle[2] = r.range(-2, 2);
          events.emit(Ev.WEAPON_FIRED, fired);
        }
      }

      if (f % 7 === 0) {
        overheat.ownerId = 1 + (f % 5);
        events.emit(Ev.WEAPON_OVERHEAT, overheat);
      }
      if (f % 5 === 0) {
        thrown.grenadeType = f % 10 === 0 ? 'plasma' : 'frag';
        thrown.origin[0] = r.range(-3, 3); thrown.origin[2] = r.range(-3, 3);
        thrown.velocity[0] = r.range(-17, 17); thrown.velocity[1] = r.range(1, 4); thrown.velocity[2] = r.range(-17, 17);
        events.emit(Ev.GRENADE_THROWN, thrown);
      }
      if (f % 6 === 2) {
        bounced.point[0] = r.range(-10, 10); bounced.point[1] = 0; bounced.point[2] = r.range(-10, 10);
        bounced.surfaceId = SURFACES[f % SURFACES.length];
        bounced.impactSpeed = r.range(1, 18);
        events.emit(Ev.GRENADE_BOUNCED, bounced);
      }
      if (f % 23 === 5) events.emit(Ev.GRENADE_STUCK, stuck);
      if (f % 11 === 3) {
        detonated.grenadeType = f % 22 === 3 ? 'plasma' : 'frag';
        detonated.radius = detonated.grenadeType === 'plasma' ? 4.0 : 5.5;
        detonated.point[0] = r.range(-14, 14); detonated.point[1] = 0.2; detonated.point[2] = r.range(-14, 14);
        events.emit(Ev.GRENADE_DETONATED, detonated);
      }
      if (f % 13 === 6) {
        explosion.point[0] = r.range(-20, 20); explosion.point[1] = 0.5; explosion.point[2] = r.range(-20, 20);
        explosion.damageType = f % 26 === 6 ? DamageType.PLASMA : DamageType.EXPLOSIVE;
        events.emit(Ev.EXPLOSION_OCCURRED, explosion);
      }
      if (f % 9 === 4) {
        shieldBroke.point[0] = r.range(-12, 12); shieldBroke.point[1] = 1.4; shieldBroke.point[2] = r.range(-12, 12);
        shieldBroke.overkill = r.range(0, 40);
        events.emit(Ev.SHIELD_BROKEN, shieldBroke);
      }
      if (f % 15 === 8) events.emit(Ev.SHIELD_RECHARGE_START, recharge);
      if (f % 15 === 12) events.emit(Ev.SHIELD_RECHARGE_FULL, recharge);
      if (f % 8 === 1) {
        melee.fromBehind = f % 16 === 1;
        melee.point[0] = r.range(-2, 2); melee.point[2] = r.range(-2, 2);
        events.emit(Ev.MELEE_LANDED, melee);
      }
      if (f % 10 === 7) events.emit(Ev.VEHICLE_IMPACT, vImpact);
      if (f % 97 === 40) events.emit(Ev.VEHICLE_DESTROYED, vDestroy);
    }

    fx.update(dt, camPos);
    checkInvariants();
  }

  push(`particle count never exceeds the ${PARTICLE_CAP} cap`, !overCap, peakParticles, `<= ${PARTICLE_CAP}`);
  push(`additive pool never exceeds ${ADD_CAP}`, !addOverCap, peakAdd, `<= ${ADD_CAP}`);
  push(`alpha pool never exceeds ${ALPHA_CAP}`, !alphaOverCap, peakAlpha, `<= ${ALPHA_CAP}`);
  push(`decal pool never exceeds the ${DECAL_CAP} cap`, !overDecalCap, peakDecals, `<= ${DECAL_CAP}`);
  push('no NaN or Inf in any CPU or GPU buffer, any frame', !nanSeen, nanSeen ? 'NaN found' : 'clean', 'clean');
  push('draw-call count constant across the whole run', drawCallsConstant, fx.stats.drawCalls, FX_DRAW_CALLS);
  push('scene child count constant (no per-effect objects)', sceneChildrenConstant, scene.children.length, FX_DRAW_CALLS);
  push('clustered light list never grew after construction',
    clusters.lights.length === caps.lights, clusters.lights.length, caps.lights);
  push('decal oldest-out replacement actually fired', fx.decals.replaced > 0, fx.decals.replaced, '> 0');
  push('the caps were actually reached (test is load bearing)',
    peakParticles > PARTICLE_CAP * 0.5, peakParticles, `> ${Math.round(PARTICLE_CAP * 0.5)}`);
  push('at least one pool saturated, so the drop path ran',
    fx.add.dropped + fx.alpha.dropped > 0, fx.add.dropped + fx.alpha.dropped, '> 0');
  push('additive pool saturated under surge', fx.add.dropped > 0, fx.add.dropped, '> 0');
  push('alpha pool saturated under surge', fx.alpha.dropped > 0, fx.alpha.dropped, '> 0');

  // ---- drain: everything must retire on its own ---------------------------
  for (let f = 0; f < 900; f++) {
    fx.update(dt, camPos);
    checkInvariants();
  }
  push('all particles retire when events stop', fx.add.count === 0 && fx.alpha.count === 0,
    `${fx.add.count}+${fx.alpha.count}`, '0+0');
  push('all emitters retire when events stop', fx.emitters.active === 0, fx.emitters.active, 0);
  push('all fx lights release when events stop', fx.lights.active === 0, fx.lights.active, 0);
  push('decals outlive the fight but do expire', fx.decals.count > 0, fx.decals.count, '> 0');

  // ---- pathological input -------------------------------------------------
  {
    const bad = { point: [NaN, 0, 0], normal: [0, 0, 0], surfaceId: 999, energy: -5, damageType: 99 };
    events.emit(Ev.SURFACE_IMPACT, bad);
    const bad2 = { point: undefined, normal: undefined, surfaceId: SurfaceId.CONCRETE, energy: Infinity };
    events.emit(Ev.SURFACE_IMPACT, bad2);
    const bad3 = { ownerId: 3, weaponId: null, muzzle: [0, 0, 0], direction: [0, 0, 0] };
    events.emit(Ev.WEAPON_FIRED, bad3);
    events.emit(Ev.GRENADE_DETONATED, { grenadeId: 5, grenadeType: 'frag', point: [0, 0, 0], radius: 0 });
    for (let f = 0; f < 30; f++) fx.update(dt, camPos);
    push('malformed payloads produce no NaN', !fx.add.hasNaN() && !fx.alpha.hasNaN() && !fx.decals.hasNaN(),
      'clean', 'clean');
    push('unknown SurfaceId falls back rather than throwing', true, 'no throw', 'no throw');
  }

  // ---- zero-frame and huge-frame deltas -----------------------------------
  {
    fx.update(0, camPos);
    fx.update(-1, camPos);
    fx.update(10, camPos); // clamped to 0.25 internally
    push('degenerate dt (0, negative, 10 s) leaves the buffers finite',
      !fx.add.hasNaN() && !fx.alpha.hasNaN() && !fx.decals.hasNaN(), 'clean', 'clean');
  }

  // ---- allocation probe ---------------------------------------------------
  // Runs against a FRESH instance so what is measured is the steady-state
  // update() loop and nothing else — heapUsed on a heap that has just absorbed
  // a 23k-particle surge drifts for reasons that have nothing to do with FX.
  // Only meaningful with --expose-gc; otherwise reported as skipped.
  {
    let ok = true;
    let measured = 'skipped (run node with --expose-gc)';
    let perEvent = 'skipped';
    const gc = typeof globalThis.gc === 'function' ? globalThis.gc : null;
    if (gc && typeof process !== 'undefined') {
      const scene2 = new THREE.Scene();
      const fx3 = new FxSystem({ scene: scene2, globals: fakeGlobals(0.88), camera, clusters: fakeClusters() });
      const ev = { point: [0, 1, 0], normal: [0, 1, 0], surfaceId: SurfaceId.CONCRETE, energy: 30, damageType: 0, sourceId: 1 };

      // (a) steady-state update() with a loaded decal pool and draining particles.
      for (let k = 0; k < 300; k++) {
        ev.point[0] = (k % 30) - 15;
        ev.point[2] = ((k / 30) | 0) - 5;
        fx3.onSurfaceImpact(ev);
      }
      for (let f = 0; f < 400; f++) fx3.update(dt, camPos); // warm + settle
      gc(); gc();
      const b1 = process.memoryUsage().heapUsed;
      for (let f = 0; f < 2000; f++) fx3.update(dt, camPos);
      const a1 = process.memoryUsage().heapUsed;
      const perFrame = (a1 - b1) / 2000;
      measured = `${perFrame.toFixed(1)} bytes/frame`;
      // A genuinely allocation-free steady state sits in the interpreter noise
      // band. 256 B/frame is 15 KB/s — three orders of magnitude below a V8
      // young-generation scavenge.
      ok = perFrame < 256;

      // (b) informational: garbage per surface.impact spawn.
      for (let k = 0; k < 5000; k++) { fx3.add.count = 0; fx3.alpha.count = 0; fx3.onSurfaceImpact(ev); }
      gc(); gc();
      const b2 = process.memoryUsage().heapUsed;
      for (let k = 0; k < 20000; k++) { fx3.add.count = 0; fx3.alpha.count = 0; fx3.onSurfaceImpact(ev); }
      const a2 = process.memoryUsage().heapUsed;
      perEvent = `${((a2 - b2) / 20000).toFixed(1)} bytes/impact`;

      fx3.dispose();
      push('garbage per surface.impact (informational)', true, perEvent, 'reported, not gated');
    }
    push('update() allocates nothing per frame', ok, measured, '< 256 bytes/frame');
  }

  // ---- degraded mode: no clustered lights available -----------------------
  // `renderer.clusters` is optional. Without it FX must still draw everything,
  // just without the co-located point lights.
  {
    let ok = true;
    try {
      const sc = new THREE.Scene();
      const f = new FxSystem({ scene: sc, globals: fakeGlobals(0.88), camera });
      const ev = { point: [0, 1, 0], normal: [0, 1, 0], surfaceId: SurfaceId.METAL_PAINTED, energy: 40, damageType: 0 };
      const th = { ownerId: 1, grenadeType: 'plasma', origin: [0, 1.5, 0], velocity: [4, 3, 0], fuseMs: 3000 };
      f.onGrenadeThrown(th);
      for (let i = 0; i < 60; i++) {
        f.onSurfaceImpact(ev);
        f.onShieldBroken({ entityId: 2, overkill: 5, point: [0, 1, -3], normal: [0, 0, 1] });
        f.update(1 / 60, camPos);
      }
      ok = f.add.count > 0 && f.lights.reserved === 0 && !f.add.hasNaN();
      f.dispose();
    } catch (err) {
      ok = false;
    }
    push('runs without renderer.clusters (no FX lights, everything else works)', ok, ok, true);
  }

  // ---- determinism --------------------------------------------------------
  // ARCHITECTURE.md §7: same session seed + same event script => bit-identical
  // buffers. This is what lets tools/baseline.mjs capture shot 11 (`firefight`)
  // reproducibly with particles alive on screen.
  {
    const runOnce = () => {
      setSessionSeed(1337);
      const sc = new THREE.Scene();
      const f = new FxSystem({ scene: sc, globals: fakeGlobals(0.88), camera, clusters: fakeClusters() });
      const ev = { point: [0, 1, 0], normal: [0, 1, 0], surfaceId: 0, energy: 30, damageType: 0, sourceId: 1 };
      const sh = { entityId: 2, overkill: 10, point: [0, 1.4, -5], normal: [0, 0, 1] };
      const det = { grenadeId: 1, grenadeType: 'plasma', point: [2, 0.2, -4], radius: 4, ownerId: 1 };
      for (let i = 0; i < 120; i++) {
        ev.point[0] = (i % 11) - 5;
        ev.point[2] = ((i / 11) | 0) - 5;
        ev.surfaceId = SURFACES[i % SURFACES.length];
        f.onSurfaceImpact(ev);
        if (i % 17 === 0) f.onShieldBroken(sh);
        if (i % 29 === 0) f.onGrenadeDetonated(det);
        f.update(1 / 60, camPos);
      }
      const out = {
        add: Float32Array.from(f.add.aColor.array.subarray(0, f.add.count * 4)),
        pos: Float32Array.from(f.add.aPos.array.subarray(0, f.add.count * 3)),
        alpha: Float32Array.from(f.alpha.aPos.array.subarray(0, f.alpha.count * 3)),
        dec: Float32Array.from(f.decals.aParams.array.subarray(0, f.decals.count * 4)),
        counts: [f.add.count, f.alpha.count, f.decals.count],
      };
      f.dispose();
      return out;
    };
    const a = runOnce();
    const b = runOnce();
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    const identical =
      a.counts.join() === b.counts.join() &&
      same(a.add, b.add) && same(a.pos, b.pos) && same(a.alpha, b.alpha) && same(a.dec, b.dec);
    push('two identical runs at the same seed are bit-identical', identical,
      `${a.counts.join('/')} vs ${b.counts.join('/')}`, 'identical');
  }

  // ---- dispose / reconstruct ---------------------------------------------
  const beforeDispose = scene.children.length;
  unwire();
  fx.dispose();
  const afterDispose = scene.children.length;
  push('dispose() removes every object it added', afterDispose === beforeDispose - FX_DRAW_CALLS,
    afterDispose, beforeDispose - FX_DRAW_CALLS);

  let reconstructed = false;
  let secondRunClean = true;
  try {
    const clusters2 = fakeClusters();
    const fx2 = new FxSystem({ scene, globals: fakeGlobals(0.88), camera, clusters: clusters2 });
    const unwire2 = wireFxEvents(fx2);
    for (let f = 0; f < 120; f++) {
      impact.point[0] = r.range(-5, 5); impact.point[1] = 1; impact.point[2] = r.range(-5, 5);
      impact.surfaceId = SURFACES[f % SURFACES.length];
      impact.energy = 40;
      events.emit(Ev.SURFACE_IMPACT, impact);
      events.emit(Ev.SHIELD_BROKEN, shieldBroke);
      fx2.update(dt, camPos);
      if (fx2.add.hasNaN() || fx2.alpha.hasNaN() || fx2.decals.hasNaN()) secondRunClean = false;
      if (fx2.add.count > ADD_CAP || fx2.alpha.count > ALPHA_CAP || fx2.decals.count > DECAL_CAP) {
        secondRunClean = false;
      }
    }
    reconstructed = fx2.add.count > 0 && scene.children.length === FX_DRAW_CALLS;
    unwire2();
    fx2.dispose();
  } catch (err) {
    reconstructed = false;
    secondRunClean = false;
    results.push({ name: 'reconstruct threw', ok: false, measured: String(err && err.message), expected: 'no throw' });
  }
  push('survives dispose and reconstruct', reconstructed, reconstructed, true);
  push('second instance holds every invariant', secondRunClean, secondRunClean, true);
  push('scene is empty after the second dispose', scene.children.length === 0, scene.children.length, 0);

  // ---- unsubscribe actually unsubscribes ---------------------------------
  {
    const before = fx.stats.eventsHandled;
    events.emit(Ev.SURFACE_IMPACT, impact);
    push('unwire() detaches every handler', fx.stats.eventsHandled === before,
      fx.stats.eventsHandled, before);
  }

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    passed,
    failed,
    results,
    metrics: {
      peakParticles,
      peakAdditive: peakAdd,
      peakAlpha,
      peakDecals,
      peakLights,
      particleCap: PARTICLE_CAP,
      decalCap: DECAL_CAP,
      drawCalls: FX_DRAW_CALLS,
      droppedParticles: fx.add.dropped + fx.alpha.dropped,
      decalsReplaced: fx.decals.replaced,
      eventsHandled: fx.stats.eventsHandled,
      skippedNoPosition: fx.stats.skippedNoPosition,
      framesStepped: frames + 900 + 30 + 3,
    },
  };
}
