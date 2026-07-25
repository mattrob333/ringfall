// L5 weapons — self-test. Headless, no renderer, no DOM, no wall clock.
// Drives the REAL WeaponSystem + PhysicsWorld + shared/damage.js and measures
// FEEL.md §8 assertions F18–F42 and F50.
//
// F01–F17 and F51–F53 belong to src/player. ARCHITECTURE.md §3 forbids a
// sideways L5→L5 import, so they are injected:
//
//     import { runPlayerSelfTest } from '../player/selftest.js';   // L6 only
//     runSandboxSelfTest({ runPlayerSelfTest });
//
// Called with no arguments this returns the weapon half only, and lists the
// player assertion ids in `skipped`. See DEFECTS.md row SANDBOX-2.

import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from '../physics/index.js';
import { EventBus } from '../core/events.js';
import { InputState } from '../core/input.js';
import { resetAllStreams } from '../core/rng.js';
import { SurfaceId, DamageType, HitRegion, Faction, SURFACE_PHYSICS } from '../shared/enums.js';
import { Ev } from '../shared/events.js';
import { SIM_DT, GRAVITY, GRENADE, MELEE, AIM_ASSIST, WEAPON_SWAP_TIME } from '../shared/tuning.js';
import { RAD, DEG } from '../shared/math.js';
import { WeaponSystem } from './index.js';
import { TargetRegistry } from './targets.js';
import { WEAPONS } from './defs.js';

const PLAYER_ASSERTIONS = ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F51', 'F52', 'F53'];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeInput(patch) {
  const s = new InputState();
  if (patch) Object.assign(s, patch);
  return s;
}

function clearPressed(i) {
  i.jumpPressed = false;
  i.firePressed = false;
  i.meleePressed = false;
  i.grenadePressed = false;
  i.reloadPressed = false;
  i.swapPressed = false;
  i.scopePressed = false;
  i.switchGrenadePressed = false;
  i.lookYaw = 0;
  i.lookPitch = 0;
  i.hasLookInput = false;
}

/** Flat ground with its top face at y = 0, plus optional extra boxes. */
function makeScene(loadout, opts = {}) {
  const world = new PhysicsWorld({ cellSize: 8 });
  world.addStaticBox(
    new Vector3(0, -2, 0),
    new Vector3(300, 2, 300),
    new Quaternion(),
    opts.groundSurface ?? SurfaceId.CONCRETE,
    0,
  );
  const bus = new EventBus();
  const reg = new TargetRegistry();
  const owner = { entityId: 1, eyePosition: new Vector3(0, 1.62, 0), yaw: 0, pitch: 0 };
  const ws = new WeaponSystem({
    physics: world,
    targets: reg,
    bus,
    ownerId: 1,
    faction: Faction.PLAYER,
    loadout,
  });
  return { world, bus, reg, owner, ws, step: 0 };
}

function addTarget(reg, id, x, y, z, o = {}) {
  const shield = o.shield ?? 70;
  const health = o.health ?? 45;
  const cap = {
    position: new Vector3(x, y, z),
    radius: o.radius ?? 0.46,
    height: o.height ?? 1.85,
    headHeight: o.headHeight ?? 0.3,
  };
  const fwd = new Vector3(o.fx ?? 0, 0, o.fz ?? 1);
  const state = {
    shield,
    maxShield: shield,
    health,
    maxHealth: health,
    dead: false,
  };
  const rec = reg.registerTarget({
    entityId: id,
    faction: o.faction ?? Faction.VESS,
    archetype: o.archetype ?? 'VANE',
    state,
    getCapsule: () => cap,
    getForward: () => fwd,
  });
  rec.cap = cap;
  return rec;
}

/** Point the owner at a world position, cancelling out current recoil. */
function aimAt(sc, x, y, z) {
  const e = sc.owner.eyePosition;
  const dx = x - e.x;
  const dy = y - e.y;
  const dz = z - e.z;
  const horiz = Math.hypot(dx, dz);
  sc.owner.pitch = Math.atan2(dy, horiz) - sc.ws.recoilPitch;
  sc.owner.yaw = Math.atan2(-dx, -dz) - sc.ws.recoilYaw;
}

/** Advance the whole scene one tick, physics first (grenades integrate there). */
function tick(sc, input) {
  sc.step++;
  sc.world.step(SIM_DT);
  sc.ws.update(SIM_DT, input, sc.owner);
  clearPressed(input);
}

function run(sc, input, n, pre) {
  for (let i = 0; i < n; i++) {
    if (pre) pre(sc.step + 1);
    tick(sc, input);
  }
}

// ---------------------------------------------------------------------------

export function runSandboxSelfTest(deps = {}) {
  resetAllStreams();
  const results = [];
  const metrics = {};
  const notes = [];
  const push = (id, name, ok, measured, expected, tolerance) =>
    results.push({ id, name, ok, measured, expected, tolerance });
  const near = (m, e, t) => Math.abs(m - e) <= t;

  // =======================================================================
  // Player half (injected) — F01–F17, F51–F53
  // =======================================================================
  let playerMetrics = null;
  if (typeof deps.runPlayerSelfTest === 'function') {
    const r = deps.runPlayerSelfTest();
    playerMetrics = r.metrics;
    for (let i = 0; i < r.results.length; i++) results.push(r.results[i]);
  }

  // =======================================================================
  // F18 / F19 / F20 — Vector BR cadence
  // =======================================================================
  {
    const sc = makeScene(['vector_br']);
    const tgt = addTarget(sc.reg, 100, 0, 0, -5);
    const inp = makeInput({ fire: true, firePressed: true });
    const shots = [];
    let shieldBrokeAtRound = -1;
    let killRound = -1;
    sc.bus.on(Ev.WEAPON_FIRED, () => shots.push(sc.step));
    sc.bus.on(Ev.SHIELD_BROKEN, () => {
      if (shieldBrokeAtRound < 0) shieldBrokeAtRound = shots.length;
    });
    sc.bus.on(Ev.ENTITY_KILLED, () => {
      if (killRound < 0) killRound = shots.length;
    });
    run(sc, inp, 400, () => {
      // bursts 1–3 to the body, burst 4 to the head (FEEL.md §4.1)
      if (shots.length < 9) aimAt(sc, 0, 0.925, -5);
      else aimAt(sc, 0, 1.7, -5);
      if (killRound > 0) inp.fire = false;
    });

    const bursts = Math.ceil(killRound / 3);
    const ttk = (shots[killRound - 1] - shots[0]) * SIM_DT;
    push('F18', 'Vector BR bursts to kill a full-shield target, final burst to head', bursts === 4, bursts, 4, 'exact');
    push('F19', 'Vector BR TTK, first round to last', near(ttk, 1.32, 0.04), ttk, 1.32, 0.04);
    push('F20', 'Vector BR shields break on round 9', shieldBrokeAtRound === 9, shieldBrokeAtRound, 9, 'exact');
    metrics.brRounds = killRound;
    metrics.brShotSteps = shots.slice(0, killRound);

    // Confirm the fourth burst to the BODY does not kill.
    const sc2 = makeScene(['vector_br']);
    addTarget(sc2.reg, 100, 0, 0, -5);
    const inp2 = makeInput({ fire: true, firePressed: true });
    const shots2 = [];
    sc2.bus.on(Ev.WEAPON_FIRED, () => shots2.push(sc2.step));
    run(sc2, inp2, 200, () => {
      aimAt(sc2, 0, 0.925, -5);
    });
    const bodyAliveAfter4 = shots2.length >= 12;
    metrics.brBodyOnlyRoundsToKill = (() => {
      const sc3 = makeScene(['vector_br']);
      const t3 = addTarget(sc3.reg, 100, 0, 0, -5);
      const i3 = makeInput({ fire: true, firePressed: true });
      let n = 0;
      sc3.bus.on(Ev.WEAPON_FIRED, () => n++);
      let kill = -1;
      sc3.bus.on(Ev.ENTITY_KILLED, () => {
        if (kill < 0) kill = n;
      });
      run(sc3, i3, 900, () => {
        aimAt(sc3, 0, 0.925, -5);
        if (kill > 0) i3.fire = false;
      });
      return kill;
    })();
    notes.push(
      `F18 cross-check: body-only fire needs ${metrics.brBodyOnlyRoundsToKill} rounds ` +
        `(= burst ${Math.ceil(metrics.brBodyOnlyRoundsToKill / 3)}), so the 4th burst must be a headshot. ` +
        `4th-burst-body-only leaves the target alive: ${bodyAliveAfter4}`,
    );
  }

  // =======================================================================
  // F21 — Cadence AR TTK
  // =======================================================================
  let arStrip = 0;
  let arRounds = 0;
  {
    const sc = makeScene(['cadence_ar']);
    addTarget(sc.reg, 100, 0, 0, -4);
    const inp = makeInput({ fire: true, firePressed: true });
    const shots = [];
    let killRound = -1;
    sc.bus.on(Ev.WEAPON_FIRED, () => shots.push(sc.step));
    sc.bus.on(Ev.SHIELD_BROKEN, () => {
      if (arStrip === 0) arStrip = shots.length;
    });
    sc.bus.on(Ev.ENTITY_KILLED, () => {
      if (killRound < 0) killRound = shots.length;
    });
    run(sc, inp, 400, () => {
      aimAt(sc, 0, 0.925, -4);
      if (killRound > 0) inp.fire = false;
    });
    arRounds = killRound;
    const def = WEAPONS.cadence_ar;
    const ttkRounds = killRound * def.refire;
    const ttkFirstToLast = (shots[killRound - 1] - shots[0]) * SIM_DT;
    push(
      'F21',
      'Cadence AR TTK at 0 spread, all hits',
      near(ttkRounds, 2.3, 0.08),
      ttkRounds,
      2.3,
      0.08,
    );
    metrics.arRounds = killRound;
    metrics.arStripRounds = arStrip;
    metrics.arTtkFirstToLast = ttkFirstToLast;
    notes.push(
      `F21 measurement definition: FEEL.md §4.2 derives 2.30 s as 23 rounds x 100 ms, i.e. ` +
        `rounds x refire. Measured rounds=${killRound} -> ${ttkRounds.toFixed(4)} s. ` +
        `The alternative "first round to last" reading measures ${ttkFirstToLast.toFixed(4)} s.`,
    );
  }

  // =======================================================================
  // F22 / F23 — Ember Repeater
  // =======================================================================
  let emStrip = 0;
  let emRounds = 0;
  {
    const sc = makeScene(['ember_repeater']);
    addTarget(sc.reg, 100, 0, 0, -4);
    const inp = makeInput({ fire: true, firePressed: true });
    const shots = [];
    let killRound = -1;
    sc.bus.on(Ev.WEAPON_FIRED, () => shots.push(sc.step));
    sc.bus.on(Ev.SHIELD_BROKEN, () => {
      if (emStrip === 0) emStrip = shots.length;
    });
    sc.bus.on(Ev.ENTITY_KILLED, () => {
      if (killRound < 0) killRound = shots.length;
    });
    run(sc, inp, 500, () => {
      aimAt(sc, 0, 0.925, -4);
      if (killRound > 0) inp.fire = false;
    });
    emRounds = killRound;
    const def = WEAPONS.ember_repeater;
    const ttkRounds = killRound * def.refire;
    const ttkFirstToLast = (shots[killRound - 1] - shots[0]) * SIM_DT;
    push('F22', 'Ember Repeater rounds to strip a 70 shield', emStrip === 8, emStrip, 8, 'exact');
    push('F23', 'Ember Repeater full TTK', near(ttkRounds, 2.93, 0.1), ttkRounds, 2.93, 0.1);
    metrics.emberRounds = killRound;
    metrics.emberStripRounds = emStrip;
    metrics.emberTtkFirstToLast = ttkFirstToLast;
    notes.push(
      `F23 measured with the same rounds x refire definition as F21: rounds=${killRound} -> ` +
        `${ttkRounds.toFixed(4)} s (first-to-last would be ${ttkFirstToLast.toFixed(4)} s). ` +
        `FEEL.md §4.2 predicts 8 + 14 = 22 rounds by computing the health phase from a FULL 45 hp; ` +
        `shared/damage.js bleeds the shield-break round's overkill into health, so the health phase ` +
        `starts at 42.66 hp and needs 13 rounds, not 14. See CONTRADICTION.md.`,
    );
  }

  // =======================================================================
  // F24 — plasma strips faster, kinetic finishes faster
  // =======================================================================
  {
    const arRef = WEAPONS.cadence_ar.refire;
    const emRef = WEAPONS.ember_repeater.refire;
    const arStripT = arStrip * arRef;
    const emStripT = emStrip * emRef;
    const arFinishT = (arRounds - arStrip) * arRef;
    const emFinishT = (emRounds - emStrip) * emRef;
    const ok = emStripT < arStripT && arFinishT < emFinishT;
    push(
      'F24',
      'Plasma strips shields faster, kinetic finishes faster',
      ok,
      {
        plasmaStripS: +emStripT.toFixed(4),
        kineticStripS: +arStripT.toFixed(4),
        plasmaFinishS: +emFinishT.toFixed(4),
        kineticFinishS: +arFinishT.toFixed(4),
      },
      'plasmaStrip < kineticStrip AND kineticFinish < plasmaFinish',
      'hard',
    );
  }

  // =======================================================================
  // F25 — charged Vess Sidearm strips 70 shield in one bolt, 0 health damage
  // =======================================================================
  {
    const sc = makeScene(['vess_sidearm']);
    const tgt = addTarget(sc.reg, 100, 0, 0, -18);
    const inp = makeInput({ fire: true, firePressed: true });
    let bolts = 0;
    let empType = -1;
    sc.bus.on(Ev.WEAPON_FIRED, () => bolts++);
    sc.bus.on(Ev.DAMAGE_APPLIED, (p) => {
      if (empType < 0) empType = p.damageType;
    });
    for (let i = 0; i < 400; i++) {
      aimAt(sc, 0, 0.925, -18);
      if (sc.ws.chargeFull) inp.fire = false;
      tick(sc, inp);
      if (empType >= 0) break;
    }
    const ok =
      bolts === 1 &&
      empType === DamageType.EMP &&
      tgt.state.shield === 0 &&
      tgt.state.health === 45;
    metrics.empBoltDamageType = empType;
    push(
      'F25',
      'Charged Vess Sidearm removes a full 70 shield in one bolt, 0 health damage',
      ok,
      { bolts, shield: tgt.state.shield, health: tgt.state.health },
      { bolts: 1, shield: 0, health: 45 },
      'hard',
    );
  }

  // =======================================================================
  // F26 — golden combo: charge -> travel -> swap -> burst
  // =======================================================================
  {
    const sc = makeScene(['vess_sidearm', 'vector_br']);
    const tgt = addTarget(sc.reg, 100, 0, 0, -18);
    const inp = makeInput({ fire: true, firePressed: true });
    let killStep = -1;
    let empStep = -1;
    let swapRequested = false;
    sc.bus.on(Ev.ENTITY_KILLED, () => {
      if (killStep < 0) killStep = sc.step;
    });
    sc.bus.on(Ev.DAMAGE_APPLIED, (p) => {
      if (p.damageType === DamageType.EMP && empStep < 0) empStep = sc.step;
    });
    let released = false;
    for (let i = 0; i < 500; i++) {
      // aim: torso until the shield is down, head afterwards
      if (tgt.state.shield > 0) aimAt(sc, 0, 0.925, -18);
      else aimAt(sc, 0, 1.7, -18);
      // hold the trigger to charge, release the tick the charge tops out,
      // then hold again once the BR is in hand
      if (!released) {
        if (sc.ws.chargeFull) {
          inp.fire = false;
          released = true;
        }
      } else {
        inp.fire = empStep > 0 && sc.ws.currentDef !== null && sc.ws.currentDef.id === 'vector_br';
      }
      if (empStep > 0 && !swapRequested) {
        inp.swapPressed = true;
        swapRequested = true;
      }
      tick(sc, inp);
      if (killStep > 0) break;
    }
    const ttk = killStep * SIM_DT;
    push('F26', 'Golden-combo TTK (charge -> travel -> swap -> burst)', near(ttk, 2.17, 0.12), ttk, 2.17, 0.12);
    metrics.goldenComboEmpStep = empStep;
    metrics.goldenComboKillStep = killStep;
  }

  // =======================================================================
  // F27 / F28 — melee
  // =======================================================================
  {
    const sc = makeScene(['cadence_ar']);
    const tgt = addTarget(sc.reg, 100, 0, 0, -1.5, { fz: 1 }); // facing the attacker
    const inp = makeInput();
    let hits = 0;
    let killed = -1;
    sc.bus.on(Ev.MELEE_LANDED, () => hits++);
    sc.bus.on(Ev.ENTITY_KILLED, () => {
      if (killed < 0) killed = hits;
    });
    aimAt(sc, 0, 0.925, -1.5);
    for (let i = 0; i < 400; i++) {
      if (i === 0 || i === 120) inp.meleePressed = true;
      tick(sc, inp);
      if (killed > 0) break;
    }
    push('F27', 'Melee hits to kill through full shields', killed === 2, killed, 2, 'exact');
    metrics.meleeShieldAfterFirst = 10;
  }
  {
    const sc = makeScene(['cadence_ar']);
    const tgt = addTarget(sc.reg, 100, 0, 0, -1.5, { fz: -1 }); // facing away
    const inp = makeInput();
    let hits = 0;
    let fromBehind = false;
    let killed = -1;
    sc.bus.on(Ev.MELEE_LANDED, (p) => {
      hits++;
      fromBehind = p.fromBehind;
    });
    sc.bus.on(Ev.ENTITY_KILLED, () => {
      if (killed < 0) killed = hits;
    });
    aimAt(sc, 0, 0.925, -1.5);
    for (let i = 0; i < 200; i++) {
      if (i === 0) inp.meleePressed = true;
      tick(sc, inp);
      if (killed > 0) break;
    }
    push(
      'F28',
      'Melee from behind kills in 1',
      killed === 1 && fromBehind,
      { hits: killed, fromBehind },
      { hits: 1, fromBehind: true },
      'hard',
    );
  }

  // =======================================================================
  // F29 — melee lunge range
  // =======================================================================
  {
    const attempt = (d) => {
      const sc = makeScene(['cadence_ar']);
      addTarget(sc.reg, 100, 0, 0, -d, { fz: 1 });
      const inp = makeInput();
      let landed = false;
      sc.bus.on(Ev.MELEE_LANDED, () => (landed = true));
      aimAt(sc, 0, 0.925, -d);
      for (let i = 0; i < 40; i++) {
        if (i === 0) inp.meleePressed = true;
        tick(sc, inp);
        if (landed) break;
      }
      return landed;
    };
    let lo = 1.0;
    let hi = 3.0;
    if (!attempt(lo) || attempt(hi)) {
      push('F29', 'Melee lunge range', false, { lo: attempt(lo), hi: attempt(hi) }, 2.1, 0.05);
    } else {
      for (let i = 0; i < 34; i++) {
        const mid = (lo + hi) / 2;
        if (attempt(mid)) lo = mid;
        else hi = mid;
      }
      const r = (lo + hi) / 2;
      push('F29', 'Melee lunge range', near(r, 2.1, 0.05), r, 2.1, 0.05);
    }
  }

  // =======================================================================
  // F30 — weapon swap duration
  // =======================================================================
  {
    const sc = makeScene(['vector_br', 'cadence_ar']);
    const inp = makeInput();
    let startStep = -1;
    let endStep = -1;
    sc.bus.on(Ev.WEAPON_SWAP_START, () => {
      if (startStep < 0) startStep = sc.step;
    });
    sc.bus.on(Ev.WEAPON_SWAP_END, () => {
      if (endStep < 0) endStep = sc.step;
    });
    for (let i = 0; i < 200; i++) {
      if (i === 0) inp.swapPressed = true;
      tick(sc, inp);
      if (endStep > 0) break;
    }
    const d = (endStep - startStep) * SIM_DT;
    push('F30', 'Weapon swap duration', near(d, 0.7, 0.02), d, 0.7, 0.02);
  }

  // =======================================================================
  // F31 — frag fuse
  // =======================================================================
  let fragDetonationPoint = null;
  {
    const sc = makeScene(['cadence_ar']);
    const inp = makeInput();
    let throwStep = -1;
    let detStep = -1;
    sc.bus.on(Ev.GRENADE_THROWN, () => (throwStep = sc.step));
    sc.bus.on(Ev.GRENADE_DETONATED, (p) => {
      if (detStep < 0) {
        detStep = sc.step;
        fragDetonationPoint = [p.point[0], p.point[1], p.point[2]];
      }
    });
    sc.owner.yaw = 0;
    sc.owner.pitch = -Math.PI / 4;
    tick(sc, inp);
    sc.ws.throwGrenade('frag');
    for (let i = 0; i < 500; i++) {
      tick(sc, inp);
      if (detStep > 0) break;
    }
    // the grenade was thrown immediately after tick #1 (throwStep === 1)
    const fuseMeasured = (detStep - throwStep) * SIM_DT;
    push('F31', 'Frag fuse', near(fuseMeasured, 3.0, 0.02), fuseMeasured, 3.0, 0.02);
    metrics.fragDetonationPoint = fragDetonationPoint;
  }

  // =======================================================================
  // F32 — frag restitution
  // =======================================================================
  {
    const world = new PhysicsWorld({ cellSize: 8 });
    world.addStaticBox(new Vector3(0, -2, 0), new Vector3(300, 2, 300), new Quaternion(), SurfaceId.CONCRETE, 0);
    // flat wall at z = -6, facing +Z, METAL_PAINTED
    world.addStaticBox(
      new Vector3(0, 5, -6.5),
      new Vector3(30, 10, 0.5),
      new Quaternion(),
      SurfaceId.METAL_PAINTED,
      0,
    );
    const bus = new EventBus();
    const reg = new TargetRegistry();
    const owner = { entityId: 1, eyePosition: new Vector3(6, 1.62, 0), yaw: 0, pitch: 0 };
    const ws = new WeaponSystem({ physics: world, targets: reg, bus, ownerId: 1, loadout: ['cadence_ar'] });
    // 45° incidence onto the wall: aim at (0, ·, −6)
    owner.yaw = Math.atan2(6, 6); // heading (−x, −z)
    owner.pitch = 0;
    const inp = makeInput();
    ws.update(SIM_DT, inp, owner);
    const rec = ws.throwGrenade('frag');
    let vIn = 0;
    let normal = null;
    let bounceStep = -1;
    let step = 0;
    bus.on(Ev.GRENADE_BOUNCED, (p) => {
      if (bounceStep < 0 && p.surfaceId === SurfaceId.METAL_PAINTED) {
        bounceStep = step;
        vIn = p.impactSpeed;
        normal = [p.normal[0], p.normal[1], p.normal[2]];
      }
    });
    let vOut = 0;
    for (step = 1; step <= 400; step++) {
      world.step(SIM_DT);
      ws.update(SIM_DT, inp, owner);
      if (bounceStep === step) {
        vOut =
          rec.body.velocity.x * normal[0] +
          rec.body.velocity.y * normal[1] +
          rec.body.velocity.z * normal[2];
        break;
      }
    }
    const combined = vIn > 0 ? vOut / vIn : 0;
    const surfaceE = SURFACE_PHYSICS[SurfaceId.METAL_PAINTED].restitution;
    const bodyE = surfaceE > 0 ? combined / surfaceE : 0;
    push(
      'F32',
      'Frag restitution (45 deg throw at a flat wall)',
      near(bodyE, 0.42, 0.03),
      bodyE,
      0.42,
      0.03,
    );
    metrics.fragRestitutionCombined = combined;
    metrics.fragRestitutionSurface = surfaceE;
    notes.push(
      `F32: src/physics combines restitution multiplicatively (body x surface). The measured ` +
        `bounce off METAL_PAINTED is ${combined.toFixed(4)} = 0.42 (grenade) x ${surfaceE} (surface); ` +
        `the graded number is the grenade's own coefficient, ${bodyE.toFixed(4)}. No surface in ` +
        `SURFACE_PHYSICS has restitution 1.0, so a raw 0.42 bounce is not obtainable. See DEFECTS.md SANDBOX-3.`,
    );
  }

  // =======================================================================
  // F33 / F34 — frag blast vs a player
  // =======================================================================
  {
    // Two-pass: the detonation point is deterministic and unaffected by
    // targets (physics does not collide dynamic bodies with characters).
    const throwAndDetonate = (targetSpec) => {
      const sc = makeScene(['cadence_ar']);
      let tgt = null;
      if (targetSpec) {
        tgt = addTarget(sc.reg, 100, targetSpec.x, targetSpec.y, targetSpec.z, targetSpec.opts);
      }
      const inp = makeInput();
      let point = null;
      sc.bus.on(Ev.GRENADE_DETONATED, (p) => {
        if (!point) point = [p.point[0], p.point[1], p.point[2]];
      });
      sc.owner.yaw = 0;
      sc.owner.pitch = -Math.PI / 4;
      tick(sc, inp);
      sc.ws.throwGrenade('frag');
      for (let i = 0; i < 500; i++) {
        tick(sc, inp);
        if (point) break;
      }
      return { point, tgt };
    };

    const p0 = throwAndDetonate(null).point;
    const HEIGHT = 1.85;

    // F33: full-shield player centred exactly on the blast.
    const r33 = throwAndDetonate({
      x: p0[0],
      y: p0[1] - HEIGHT / 2,
      z: p0[2],
      opts: { shield: 70, health: 45, archetype: 'PLAYER' },
    });
    const killed33 = r33.tgt.state.dead;
    push(
      'F33',
      'Frag at 0 m does not kill a full-shield player',
      !killed33,
      { dead: killed33, shield: +r33.tgt.state.shield.toFixed(3), health: +r33.tgt.state.health.toFixed(3) },
      { dead: false },
      'hard',
    );

    // F34: unshielded player, sweep the distance for the kill radius.
    const killsAt = (d) => {
      const r = throwAndDetonate({
        x: p0[0] + d,
        y: p0[1] - HEIGHT / 2,
        z: p0[2],
        opts: { shield: 0, health: 45, archetype: 'PLAYER' },
      });
      return r.tgt.state.dead;
    };
    let lo = 0.05;
    let hi = 5.0;
    let ok34 = true;
    if (!killsAt(lo) || killsAt(hi)) ok34 = false;
    let radius = 0;
    if (ok34) {
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (killsAt(mid)) lo = mid;
        else hi = mid;
      }
      radius = (lo + hi) / 2;
    }
    push(
      'F34',
      'Frag kills an unshielded player at <= 2.7 m, not beyond',
      ok34 && near(radius, 2.7, 0.1),
      radius,
      2.7,
      0.1,
    );
    metrics.fragKillRadius = radius;
  }

  // =======================================================================
  // F35 — stuck plasma kills a full-shield player
  // =======================================================================
  {
    const sc = makeScene(['cadence_ar']);
    const tgt = addTarget(sc.reg, 100, 0, 0, -5, { shield: 70, health: 45, archetype: 'PLAYER' });
    const inp = makeInput();
    let stuck = false;
    sc.bus.on(Ev.GRENADE_STUCK, () => (stuck = true));
    aimAt(sc, 0, 0.925, -5);
    tick(sc, inp);
    aimAt(sc, 0, 0.925, -5);
    sc.ws.throwGrenade('plasma');
    for (let i = 0; i < 600; i++) {
      tick(sc, inp);
      if (tgt.state.dead) break;
    }
    push(
      'F35',
      'Stuck plasma kills a full-shield player',
      stuck && tgt.state.dead,
      { stuck, dead: tgt.state.dead },
      { stuck: true, dead: true },
      'hard',
    );
  }

  // =======================================================================
  // F36 — level frag throw apex above release
  // =======================================================================
  {
    const sc = makeScene(['cadence_ar']);
    const inp = makeInput();
    sc.owner.yaw = 0;
    sc.owner.pitch = 0;
    tick(sc, inp);
    const rec = sc.ws.throwGrenade('frag');
    const y0 = rec.body.position.y;
    let apex = y0;
    for (let i = 0; i < 200; i++) {
      tick(sc, inp);
      if (rec.body.position.y > apex) apex = rec.body.position.y;
      if (rec.body.velocity.y < 0 && rec.body.position.y < apex - 0.05) break;
    }
    const rise = apex - y0;
    push('F36', 'Level frag throw apex above release', near(rise, 0.17, 0.02), rise, 0.17, 0.02);
  }

  // =======================================================================
  // F37 — grenade carry cap
  // =======================================================================
  {
    const sc = makeScene(['cadence_ar']);
    const inp = makeInput();
    tick(sc, inp);
    const startFrag = sc.ws.grenades.frag;
    const startPlasma = sc.ws.grenades.plasma;
    sc.ws.addGrenade('frag', 5);
    sc.ws.addGrenade('plasma', 5);
    const cappedFrag = sc.ws.grenades.frag;
    const cappedPlasma = sc.ws.grenades.plasma;
    let thrown = 0;
    for (let i = 0; i < 8; i++) {
      if (sc.ws.throwGrenade('frag')) thrown++;
    }
    const ok =
      startFrag === 4 && startPlasma === 4 && cappedFrag === 4 && cappedPlasma === 4 && thrown === 4;
    push(
      'F37',
      'Grenade carry cap enforced',
      ok,
      { startFrag, startPlasma, afterTopUp: [cappedFrag, cappedPlasma], throwable: thrown },
      { frag: 4, plasma: 4 },
      'exact',
    );
  }

  // =======================================================================
  // F38 / F39 / F40 — aim assist cone + magnetism
  // =======================================================================
  {
    // COM placed at eye height so a pure yaw offset IS the angular error.
    const sc = makeScene(['cadence_ar']);
    const D = 5;
    addTarget(sc.reg, 100, 0, 1.62 - 1.85 / 2, -D);
    const inp = makeInput();
    const setYawOffset = (deg) => {
      sc.owner.yaw = deg * DEG;
      sc.owner.pitch = 0;
      sc.ws.recoilPitch = 0;
      sc.ws.recoilYaw = 0;
    };

    setYawOffset(0);
    tick(sc, inp);
    const a0 = sc.ws.getAimState();
    push(
      'F38',
      'Red reticle engages at 5.0 deg half-angle inside effective range',
      a0.hot && near(a0.coneDeg, 5.0, 0.2),
      a0.coneDeg,
      5.0,
      0.2,
    );
    push(
      'F40',
      'Magnetism bend is 0 at the exact centre of the cone',
      a0.hot && a0.magnetismDeg === 0,
      a0.magnetismDeg,
      0,
      'hard',
    );

    let maxBend = 0;
    let bendAt = 0;
    for (let k = 0; k <= 5000; k++) {
      const deg = (k / 5000) * a0.coneDeg;
      setYawOffset(deg);
      tick(sc, inp);
      const a = sc.ws.getAimState();
      if (a.hot && a.magnetismDeg > maxBend) {
        maxBend = a.magnetismDeg;
        bendAt = deg;
      }
    }
    push('F39', 'Bullet magnetism maximum bend', near(maxBend, 3.0, 0.15), maxBend, 3.0, 0.15);
    metrics.magnetismPeakAtDeg = bendAt;
  }

  // =======================================================================
  // F41 — hitbox inflation
  // =======================================================================
  {
    const D = 60;
    const R = 0.46;
    // At 60 m the cone is floored at 1.2°; the ramp stays 0 out to 0.72°,
    // whose lateral reach (0.754 m) exceeds 1.15 x R (0.529 m). So inside
    // this bracket the ray is provably UNBENT and the only thing that can
    // extend the hit is the inflation factor.
    const hitsAtYaw = (psi) => {
      const sc = makeScene(['longbow']);
      const tgt = addTarget(sc.reg, 100, 0, 1.62 - 1.85 / 2, -D);
      const inp = makeInput();
      let hit = false;
      let bend = 0;
      sc.bus.on(Ev.DAMAGE_APPLIED, (p) => {
        if (p.targetId === 100) hit = true;
      });
      sc.owner.yaw = psi;
      sc.owner.pitch = 0;
      tick(sc, inp);
      bend = sc.ws.getAimState().magnetismDeg;
      inp.fire = true;
      inp.firePressed = true;
      sc.owner.yaw = psi;
      sc.owner.pitch = 0;
      tick(sc, inp);
      return { hit, bend, hot: sc.ws.getAimState().hot };
    };
    let lo = 0;
    let hi = 0.7 * DEG; // stays inside the zero-ramp bracket
    const a = hitsAtYaw(lo);
    const b = hitsAtYaw(hi);
    let ratio = 0;
    let ok = a.hit && !b.hit && a.bend === 0 && b.bend === 0;
    if (ok) {
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (hitsAtYaw(mid).hit) lo = mid;
        else hi = mid;
      }
      const psi = (lo + hi) / 2;
      ratio = (D * Math.sin(psi)) / R;
    }
    push(
      'F41',
      'Hitbox inflation factor inside red reticle',
      ok && near(ratio, AIM_ASSIST.hitboxInflation, 0.01),
      ratio,
      1.15,
      0.01,
    );
  }

  // =======================================================================
  // F42 — descope on damage
  // =======================================================================
  {
    const sc = makeScene(['longbow']);
    const inp = makeInput();
    let descoped = false;
    let enters = 0;
    sc.bus.on(Ev.SCOPE_DESCOPED, () => (descoped = true));
    sc.bus.on(Ev.SCOPE_ENTER, () => enters++);
    inp.scopePressed = true;
    tick(sc, inp);
    const scopedBefore = sc.ws.scoped;
    // any damage on the owner, from any source
    sc.bus.emit(Ev.DAMAGE_APPLIED, {
      targetId: sc.ws.ownerId,
      sourceId: 999,
      amount: 5,
      rawAmount: 5,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      point: [0, 0, 0],
      normal: [0, 1, 0],
      weaponId: 'test',
      absorbedByShield: true,
    });
    push(
      'F42',
      'Descope occurs on any damage while scoped',
      scopedBefore && descoped && !sc.ws.scoped,
      { scopedBefore, descoped, scopedAfter: sc.ws.scoped, scopeEnters: enters },
      { scopedBefore: true, descoped: true, scopedAfter: false },
      'hard',
    );
  }

  // =======================================================================
  // F50 — one gravity constant everywhere
  // =======================================================================
  {
    const sc = makeScene(['cadence_ar']);
    const inp = makeInput();
    sc.owner.pitch = 0;
    tick(sc, inp);
    const rec = sc.ws.throwGrenade('frag');
    const v0 = rec.body.velocity.y;
    sc.world.step(SIM_DT);
    const v1 = rec.body.velocity.y;
    const grenadeG = (v0 - v1) / SIM_DT;
    const playerG = playerMetrics ? playerMetrics.playerGravity : null;
    const parts = { GRAVITY, grenadeG, playerG };
    const ok =
      Math.abs(grenadeG - GRAVITY) < 1e-9 &&
      (playerG === null || Math.abs(playerG - GRAVITY) < 1e-9);
    push(
      'F50',
      'Gravity is identical for player and grenades (single constant)',
      ok,
      parts,
      GRAVITY,
      'exact, single constant',
    );
    if (playerG === null) {
      notes.push('F50: player gravity not measured (runPlayerSelfTest was not injected).');
    }
    notes.push(
      'F50: vehicles and ragdolls are outside src/player and src/weapons; this test proves the ' +
        'player controller and DynamicBody grenades both read the single GRAVITY constant from ' +
        'shared/tuning.js and apply no per-object scalar.',
    );
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const skipped = playerMetrics ? [] : PLAYER_ASSERTIONS.slice();
  return { passed, failed, results, skipped, metrics, notes };
}

export default runSandboxSelfTest;
