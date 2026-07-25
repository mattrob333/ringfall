// L5 ai — self-test. Headless: no renderer, no meshes, no DOM. Builds a
// minimal box world with the real `PhysicsWorld` and drives the real
// `AiDirector` exactly as the game layer would.
//
// Covers: F47 (SKIRN panic within 0.8 s of leader death), F48 (CULL barrier
// takes 0 KINETIC from the front and > 0 PLASMA), F49 (VANE shield 4.0 s delay
// / 3.0 s recharge), the 0.5 s acquisition miss grace, and determinism.

import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from '../physics/index.js';
import { EventBus } from '../core/events.js';
import { setSessionSeed } from '../core/rng.js';
import { resetIds } from '../core/ids.js';
import { SurfaceId, DamageType, HitRegion, Faction, Archetype } from '../shared/enums.js';
import { Ev } from '../shared/events.js';
import { SIM_DT, ENEMY, PLAYER, AI } from '../shared/tuning.js';
import { AiDirector } from './index.js';
import { AiState } from './constants.js';

const IDENTITY = new Quaternion();

function makeWorld() {
  const world = new PhysicsWorld({ cellSize: 8 });
  // Ground slab.
  world.addStaticBox(new Vector3(0, -0.5, 0), new Vector3(80, 0.5, 80), IDENTITY, SurfaceId.CONCRETE, 0);
  // A handful of boxes so cover sampling has something to find and the
  // steering whiskers have something to deflect around.
  const pillars = [
    [12, 6],
    [-9, 14],
    [4, -11],
    [-14, -6],
    [20, 18],
    [-22, 9],
  ];
  for (let i = 0; i < pillars.length; i++) {
    world.addStaticBox(
      new Vector3(pillars[i][0], 1.5, pillars[i][1]),
      new Vector3(1.2, 1.5, 1.2),
      IDENTITY,
      SurfaceId.METAL_BARE,
      0,
    );
  }
  return world;
}

function makePlayer(x, y, z) {
  return {
    entityId: 999999,
    position: new Vector3(x, y, z),
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    faction: Faction.PLAYER,
    alive: true,
  };
}

function fresh(seed) {
  setSessionSeed(seed);
  resetIds();
  const world = makeWorld();
  const events = new EventBus();
  const director = new AiDirector({ physics: world, events });
  return { world, events, director };
}

function chestOf(player) {
  return new Vector3(
    player.position.x,
    player.position.y + PLAYER.height * 0.62, // TARGET_CHEST_FRACTION
    player.position.z,
  );
}

// ===========================================================================

export function runAiSelfTest() {
  const results = [];
  const push = (name, ok, measured, expected, note) =>
    results.push({ name, ok: !!ok, measured, expected, note: note ?? '' });

  // -----------------------------------------------------------------------
  // 1. F47 — SKIRN panic triggers within 0.8 s of `ai.leaderKilled`.
  // -----------------------------------------------------------------------
  {
    const { events, director } = fresh(1337);
    const leader = director.spawn({
      archetype: Archetype.VANE,
      position: new Vector3(0, 0, 0),
      squadId: 's1',
      faction: Faction.VESS,
    });
    const skirns = [
      director.spawn({ archetype: Archetype.SKIRN, position: new Vector3(2.5, 0, 0), squadId: 's1', faction: Faction.VESS }),
      director.spawn({ archetype: Archetype.SKIRN, position: new Vector3(-2.5, 0, 0), squadId: 's1', faction: Faction.VESS }),
      director.spawn({ archetype: Archetype.SKIRN, position: new Vector3(0, 0, -3.0), squadId: 's1', faction: Faction.VESS }),
    ];
    const player = makePlayer(0, 0, 26);

    let t = 0;
    let leaderKilledT = null;
    const panicT = new Map();
    let panicEndT = null;
    events.on(Ev.AI_LEADER_KILLED, () => {
      if (leaderKilledT === null) leaderKilledT = t;
    });
    events.on(Ev.AI_PANIC_START, (p) => {
      if (!panicT.has(p.entityId)) panicT.set(p.entityId, t);
    });
    events.on(Ev.AI_PANIC_END, () => {
      if (panicEndT === null) panicEndT = t;
    });

    for (let i = 0; i < 90; i++) {
      t += SIM_DT;
      director.update(SIM_DT, player);
    }
    const posBefore = skirns.map((s) => s.position.clone());

    // Kill the leader outright: 90 shield + 60 health.
    director.applyDamage(leader.entityId, {
      amount: 400,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      sourceId: player.entityId,
      sourcePosition: player.position,
    });

    // Freeze must be observable: nothing moves during it.
    let frozenAll = true;
    let sawFreezeState = false;
    for (let i = 0; i < 12 * 120; i++) {
      t += SIM_DT;
      director.update(SIM_DT, player);
      if (i < Math.round(ENEMY.SKIRN.panicFreeze / SIM_DT) - 2) {
        for (let k = 0; k < skirns.length; k++) {
          if (skirns[k].state === AiState.FREEZE) sawFreezeState = true;
        }
      }
    }
    for (let k = 0; k < skirns.length; k++) {
      const moved = skirns[k].position.distanceTo(posBefore[k]);
      if (moved < 1.0) frozenAll = false; // they must actually have fled
    }

    const deltas = skirns.map((s) => (panicT.has(s.entityId) ? panicT.get(s.entityId) - leaderKilledT : NaN));
    const worst = deltas.reduce((a, b) => (Math.abs(b - ENEMY.SKIRN.panicFreeze) > Math.abs(a - ENEMY.SKIRN.panicFreeze) ? b : a), deltas[0]);

    push(
      'F47 leaderKilled emitted on VANE leader death',
      leaderKilledT !== null,
      leaderKilledT,
      'not null',
    );
    push(
      'F47 every SKIRN in the squad emits ai.panic.start',
      panicT.size === skirns.length,
      panicT.size,
      skirns.length,
    );
    push(
      'F47 SKIRN panic delay after ai.leaderKilled',
      deltas.every((d) => Math.abs(d - 0.8) <= 0.1),
      worst,
      '0.80 s +/- 0.10',
      `all: [${deltas.map((d) => d.toFixed(4)).join(', ')}]`,
    );
    push('F47 freeze state is observable before panic', sawFreezeState, sawFreezeState, true);
    push('F47 SKIRN actually flee after the freeze', frozenAll, frozenAll, true);
    push(
      'F47 ai.panic.end fires after panicFreeze + panicDuration',
      panicEndT !== null && Math.abs(panicEndT - leaderKilledT - (ENEMY.SKIRN.panicFreeze + ENEMY.SKIRN.panicDuration)) <= 0.12,
      panicEndT === null ? null : panicEndT - leaderKilledT,
      `${(ENEMY.SKIRN.panicFreeze + ENEMY.SKIRN.panicDuration).toFixed(2)} s +/- 0.12`,
    );
  }

  // -----------------------------------------------------------------------
  // 2. F48 — CULL front barrier: 0 KINETIC, > 0 PLASMA.
  // -----------------------------------------------------------------------
  {
    const { director } = fresh(2024);
    const cull = director.spawn({
      archetype: Archetype.CULL,
      position: new Vector3(0, 0, 0),
      squadId: 'c1',
      faction: Faction.VESS,
    });
    const player = makePlayer(0, 0, 20);
    for (let i = 0; i < 120; i++) director.update(SIM_DT, player);

    const healthBefore = cull.health;
    const kin = director.applyDamage(cull.entityId, {
      amount: 30,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      sourceId: player.entityId,
      sourcePosition: player.position,
    });
    const afterKinetic = cull.health;
    const barrierAfterKinetic = cull.barrierHealth;

    const pla = director.applyDamage(cull.entityId, {
      amount: 30,
      damageType: DamageType.PLASMA,
      hitRegion: HitRegion.TORSO,
      sourceId: player.entityId,
      sourcePosition: player.position,
    });
    const afterPlasma = cull.health;

    push(
      'F48 CULL front barrier takes 0 KINETIC (health unchanged)',
      healthBefore - afterKinetic === 0 && kin.applied === 0,
      healthBefore - afterKinetic,
      0,
      `barrierHealth ${ENEMY.CULL.barrierHealth} -> ${barrierAfterKinetic}`,
    );
    push(
      'F48 CULL front barrier takes > 0 PLASMA',
      afterKinetic - afterPlasma > 0,
      +(afterKinetic - afterPlasma).toFixed(6),
      '> 0',
      `expected 30 x ${ENEMY.CULL.barrierPlasmaMult} x 0.55 = ${(30 * ENEMY.CULL.barrierPlasmaMult * 0.55).toFixed(4)}`,
    );

    // The arc has to matter: from behind, KINETIC is unmitigated.
    const { director: d2 } = fresh(2025);
    const cull2 = d2.spawn({ archetype: Archetype.CULL, position: new Vector3(0, 0, 0), squadId: 'c1', faction: Faction.VESS });
    const player2 = makePlayer(0, 0, 20);
    for (let i = 0; i < 120; i++) d2.update(SIM_DT, player2);
    const h0 = cull2.health;
    d2.applyDamage(cull2.entityId, {
      amount: 30,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      sourceId: 1,
      sourcePosition: new Vector3(cull2.position.x, cull2.position.y, cull2.position.z - 20),
    });
    push(
      'F48 CULL barrier does NOT protect from behind',
      Math.abs(h0 - cull2.health - 30) < 1e-9,
      +(h0 - cull2.health).toFixed(6),
      30,
    );

    // Barrier breaks after exactly barrierHealth absorbed damage.
    const { director: d3 } = fresh(2026);
    const cull3 = d3.spawn({ archetype: Archetype.CULL, position: new Vector3(0, 0, 0), squadId: 'c1', faction: Faction.VESS });
    const player3 = makePlayer(0, 0, 20);
    for (let i = 0; i < 120; i++) d3.update(SIM_DT, player3);
    d3.applyDamage(cull3.entityId, {
      amount: ENEMY.CULL.barrierHealth,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      sourceId: 1,
      sourcePosition: player3.position,
    });
    const brokeAt90 = cull3.barrierBroken && cull3.health === ENEMY.CULL.health;
    const hBefore = cull3.health;
    d3.applyDamage(cull3.entityId, {
      amount: 20,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      sourceId: 1,
      sourcePosition: player3.position,
    });
    push(
      'F48 CULL barrier breaks after 90 absorbed damage',
      brokeAt90,
      `broken=${cull3.barrierBroken} health=${hBefore}`,
      `broken=true health=${ENEMY.CULL.health}`,
    );
    push(
      'F48 broken CULL barrier no longer blocks KINETIC',
      Math.abs(hBefore - cull3.health - 20) < 1e-9,
      +(hBefore - cull3.health).toFixed(6),
      20,
    );
  }

  // -----------------------------------------------------------------------
  // 2b. CULL lateral sidestep period and barrier facing (FEEL.md §6).
  // -----------------------------------------------------------------------
  {
    const { director } = fresh(2027);
    const cull = director.spawn({
      archetype: Archetype.CULL,
      position: new Vector3(0, 0, 0),
      squadId: 'c2',
      faction: Faction.VESS,
    });
    const player = makePlayer(0, 0, 17);
    let flips = 0;
    let lastSign = 0;
    let worstBarrierErrDeg = 0;
    const measureSeconds = 18;
    for (let i = 0; i < measureSeconds * 120; i++) {
      director.update(SIM_DT, player);
      if (lastSign !== 0 && cull.strafeSign !== lastSign) flips++;
      lastSign = cull.strafeSign;
      if (i > 120) {
        const bearing = Math.atan2(player.position.x - cull.position.x, player.position.z - cull.position.z);
        let d = ((cull.barrierYaw - bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const deg = Math.abs(d) * (180 / Math.PI);
        if (deg > worstBarrierErrDeg) worstBarrierErrDeg = deg;
      }
    }
    const expectedFlips = measureSeconds / ENEMY.CULL.strafePeriod;
    push(
      'CULL sidesteps laterally on the ~1.8 s tuning period',
      Math.abs(flips - expectedFlips) <= 1,
      `${flips} direction changes in ${measureSeconds} s`,
      `${expectedFlips.toFixed(1)} +/- 1`,
    );
    push(
      'CULL keeps its arm barrier inside the 62 deg frontal arc of the threat',
      worstBarrierErrDeg <= ENEMY.CULL.barrierArcDeg / 2,
      `worst ${worstBarrierErrDeg.toFixed(3)} deg off-bearing`,
      `<= ${ENEMY.CULL.barrierArcDeg / 2} deg`,
    );
  }

  // -----------------------------------------------------------------------
  // 2c. WARDEN front plates vs back weakpoint (FEEL.md §6).
  // -----------------------------------------------------------------------
  {
    const { director } = fresh(2028);
    const w = director.spawn({ archetype: Archetype.WARDEN, position: new Vector3(0, 0, 0), squadId: 'w1', faction: Faction.VESS });
    const player = makePlayer(0, 0, 22);
    for (let i = 0; i < 120; i++) director.update(SIM_DT, player);
    const h0 = w.health;
    director.applyDamage(w.entityId, {
      amount: 40,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      sourceId: 1,
      sourcePosition: player.position,
    });
    const frontApplied = h0 - w.health;
    const h1 = w.health;
    director.applyDamage(w.entityId, {
      amount: 40,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.WEAKPOINT,
      sourceId: 1,
      sourcePosition: new Vector3(w.position.x, w.position.y, w.position.z - 22),
    });
    const backApplied = h1 - w.health;
    push(
      'WARDEN front plates take x0.35 KINETIC',
      Math.abs(frontApplied - 40 * ENEMY.WARDEN.frontPlateMult) < 1e-9,
      +frontApplied.toFixed(6),
      40 * ENEMY.WARDEN.frontPlateMult,
    );
    push(
      'WARDEN back plate is a WEAKPOINT (x3, unplated)',
      Math.abs(backApplied - 120) < 1e-9,
      +backApplied.toFixed(6),
      120,
    );
  }

  // -----------------------------------------------------------------------
  // 3. F49 — VANE shield: 4.0 s delay, 3.0 s to full.
  // -----------------------------------------------------------------------
  {
    const { events, director } = fresh(4949);
    const vane = director.spawn({
      archetype: Archetype.VANE,
      position: new Vector3(0, 0, 0),
      squadId: 'v1',
      faction: Faction.VESS,
    });
    let t = 0;
    let startT = null;
    let fullT = null;
    let brokeT = null;
    events.on(Ev.SHIELD_RECHARGE_START, () => {
      if (startT === null) startT = t;
    });
    events.on(Ev.SHIELD_RECHARGE_FULL, () => {
      if (fullT === null) fullT = t;
    });
    events.on(Ev.SHIELD_BROKEN, () => {
      if (brokeT === null) brokeT = t;
    });

    // No threat at all — this test is about the shield clock only.
    for (let i = 0; i < 30; i++) {
      t += SIM_DT;
      director.update(SIM_DT, null);
    }
    const damageT = t;
    director.applyDamage(vane.entityId, {
      amount: ENEMY.VANE.shield,
      damageType: DamageType.KINETIC,
      hitRegion: HitRegion.TORSO,
      sourceId: 1,
      sourcePosition: new Vector3(0, 0, 20),
    });
    const shieldAfter = vane.shield;
    const healthAfter = vane.health;

    for (let i = 0; i < 12 * 120; i++) {
      t += SIM_DT;
      director.update(SIM_DT, null);
    }

    push(
      'F49 90 KINETIC strips the VANE shield with no health bleed',
      shieldAfter === 0 && healthAfter === ENEMY.VANE.health,
      `shield=${shieldAfter} health=${healthAfter}`,
      `shield=0 health=${ENEMY.VANE.health}`,
    );
    push('F49 shield.broken emitted', brokeT !== null, brokeT, 'not null');
    push(
      'F49 shield recharge delay after last damage',
      startT !== null && Math.abs(startT - damageT - ENEMY.VANE.shieldDelay) <= 0.1,
      startT === null ? null : +(startT - damageT).toFixed(4),
      `${ENEMY.VANE.shieldDelay.toFixed(2)} s +/- 0.10`,
    );
    push(
      'F49 shield 0 -> 90 recharge duration',
      fullT !== null && startT !== null && Math.abs(fullT - startT - ENEMY.VANE.shieldRechargeTime) <= 0.1,
      fullT === null || startT === null ? null : +(fullT - startT).toFixed(4),
      `${ENEMY.VANE.shieldRechargeTime.toFixed(2)} s +/- 0.10`,
    );
    push(
      'F49 shield returns to full',
      Math.abs(vane.shield - ENEMY.VANE.shield) < 1e-9,
      vane.shield,
      ENEMY.VANE.shield,
    );

    // Damage during the recharge resets the delay to the full 4.0 s (F14 shape).
    {
      const { events: e2, director: d2 } = fresh(4950);
      const v2 = d2.spawn({ archetype: Archetype.VANE, position: new Vector3(0, 0, 0), squadId: 'v2', faction: Faction.VESS });
      let t2 = 0;
      const starts = [];
      e2.on(Ev.SHIELD_RECHARGE_START, () => starts.push(t2));
      d2.applyDamage(v2.entityId, { amount: 40, damageType: DamageType.KINETIC, hitRegion: HitRegion.TORSO, sourceId: 1 });
      const firstDamageT = t2;
      let secondDamageT = null;
      for (let i = 0; i < 12 * 120; i++) {
        t2 += SIM_DT;
        d2.update(SIM_DT, null);
        if (secondDamageT === null && t2 - firstDamageT >= 4.5) {
          secondDamageT = t2;
          d2.applyDamage(v2.entityId, { amount: 10, damageType: DamageType.KINETIC, hitRegion: HitRegion.TORSO, sourceId: 1 });
        }
      }
      const secondStart = starts.length >= 2 ? starts[1] - secondDamageT : null;
      push(
        'F49 damage during recharge resets the delay to 4.0 s',
        secondStart !== null && Math.abs(secondStart - ENEMY.VANE.shieldDelay) <= 0.1,
        secondStart === null ? null : +secondStart.toFixed(4),
        `${ENEMY.VANE.shieldDelay.toFixed(2)} s +/- 0.10`,
        `recharge starts observed: ${starts.length}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // 4. Acquisition miss grace — AI.missGraceOnAcquire (0.5 s).
  //    Measured GEOMETRICALLY: a shot counts as a hit only if the fired
  //    direction falls inside the target's angular radius. No flags trusted.
  // -----------------------------------------------------------------------
  {
    const { events, director } = fresh(555);
    const cull = director.spawn({
      archetype: Archetype.CULL,
      position: new Vector3(0, 0, 0),
      squadId: 'g1',
      faction: Faction.VESS,
    });
    const player = makePlayer(0, 0, 18);
    const chest = chestOf(player);

    let t = 0;
    const shots = [];
    events.on(Ev.WEAPON_FIRED, (p) => {
      const mx = p.muzzle[0];
      const my = p.muzzle[1];
      const mz = p.muzzle[2];
      const tx = chest.x - mx;
      const ty = chest.y - my;
      const tz = chest.z - mz;
      const tl = Math.hypot(tx, ty, tz);
      const dot = (p.direction[0] * tx + p.direction[1] * ty + p.direction[2] * tz) / tl;
      const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
      const angRad = Math.atan2(PLAYER.radius, tl);
      shots.push({ t, angle, angRad, hit: angle <= angRad, ownerId: p.ownerId });
    });

    for (let i = 0; i < 10 * 120; i++) {
      t += SIM_DT;
      director.update(SIM_DT, player);
    }

    const firstT = shots.length ? shots[0].t : null;
    const inGrace = shots.filter((s) => s.t < firstT + AI.missGraceOnAcquire);
    const afterGrace = shots.filter((s) => s.t >= firstT + AI.missGraceOnAcquire);
    const graceHits = inGrace.filter((s) => s.hit).length;
    const laterHits = afterGrace.filter((s) => s.hit).length;

    push(
      'miss grace: the AI actually engaged and fired',
      shots.length > 10,
      shots.length,
      '> 10 shots',
      `cull id ${cull.entityId}, first shot at t=${firstT === null ? 'n/a' : firstT.toFixed(3)} s`,
    );
    push(
      `miss grace: 0 geometric hits in the first ${AI.missGraceOnAcquire} s of firing`,
      inGrace.length > 0 && graceHits === 0,
      `${graceHits} hits / ${inGrace.length} shots`,
      '0 hits',
      `min angular error in grace = ${inGrace.length ? Math.min(...inGrace.map((s) => s.angle)).toFixed(5) : 'n/a'} rad, target angular radius = ${inGrace.length ? inGrace[0].angRad.toFixed(5) : 'n/a'} rad`,
    );
    push(
      'miss grace: hits resume after the grace window',
      laterHits > 0,
      `${laterHits} hits / ${afterGrace.length} shots`,
      '> 0 hits',
    );
  }

  // -----------------------------------------------------------------------
  // 5. Determinism — same seed, two runs, identical positions after 600 steps.
  // -----------------------------------------------------------------------
  {
    const run = () => {
      const { director } = fresh(7331);
      const squad = 'd1';
      director.spawn({ archetype: Archetype.VANE, position: new Vector3(0, 0, 0), squadId: squad, faction: Faction.VESS });
      director.spawn({ archetype: Archetype.SKIRN, position: new Vector3(3, 0, 1), squadId: squad, faction: Faction.VESS });
      director.spawn({ archetype: Archetype.SKIRN, position: new Vector3(-3, 0, 1), squadId: squad, faction: Faction.VESS });
      director.spawn({ archetype: Archetype.CULL, position: new Vector3(0, 0, -4), squadId: squad, faction: Faction.VESS });
      director.spawn({ archetype: Archetype.WARDEN, position: new Vector3(6, 0, -6), squadId: squad, faction: Faction.VESS });
      const player = makePlayer(0, 0, 30);
      const snapshot = [];
      for (let i = 0; i < 600; i++) {
        // Deterministic scripted player: a circle, plus a scripted kill at
        // step 300 so the panic cascade is inside the determinism window.
        const a = i * 0.01;
        player.position.set(Math.sin(a) * 24, 0, Math.cos(a) * 24 + 6);
        player.velocity.set(Math.cos(a) * 0.24, 0, -Math.sin(a) * 0.24);
        director.update(SIM_DT, player);
        if (i === 300) {
          const leader = director.agents[0];
          director.applyDamage(leader.entityId, {
            amount: 400,
            damageType: DamageType.KINETIC,
            hitRegion: HitRegion.TORSO,
            sourceId: player.entityId,
            sourcePosition: player.position,
          });
        }
      }
      for (let i = 0; i < director.agents.length; i++) {
        const g = director.agents[i];
        snapshot.push(
          g.entityId,
          g.position.x,
          g.position.y,
          g.position.z,
          g.yaw,
          g.aimYaw,
          g.aimPitch,
          g.shield,
          g.health,
          g.barrierHealth,
          g.speed01,
        );
      }
      return { snapshot, states: director.agents.map((g) => `${g.state}/${g.animState}`) };
    };

    const a = run();
    const b = run();
    let firstMismatch = -1;
    for (let i = 0; i < a.snapshot.length; i++) {
      if (a.snapshot[i] !== b.snapshot[i]) {
        firstMismatch = i;
        break;
      }
    }
    const statesEqual = a.states.join('|') === b.states.join('|');
    push(
      'determinism: 600 steps x 2 runs, bit-identical agent transforms',
      firstMismatch === -1 && a.snapshot.length === b.snapshot.length,
      firstMismatch === -1
        ? `${a.snapshot.length} float64 fields identical`
        : `first mismatch at field ${firstMismatch}: ${a.snapshot[firstMismatch]} vs ${b.snapshot[firstMismatch]}`,
      'exact ===',
    );
    push('determinism: identical state/animState strings', statesEqual, a.states.join(' '), b.states.join(' '));
  }

  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results };
}
