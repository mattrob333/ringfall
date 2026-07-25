// L5 player — self-test. Headless. Drives synthetic input into the real
// PlayerController + PhysicsWorld and measures FEEL.md §8 assertions
// F01–F17 and F51–F53 (plus the player half of F50).
//
// Why this lives here and not in src/weapons/selftest.js: ARCHITECTURE.md §3
// forbids sideways L5→L5 imports, so `src/weapons` may not `import
// '../player/index.js'`. `runSandboxSelfTest()` takes this runner as an
// injected dependency instead — see DEFECTS.md row SANDBOX-2.

import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from '../physics/index.js';
import { EventBus } from '../core/events.js';
import { InputState } from '../core/input.js';
import { SurfaceId, DamageType, HitRegion } from '../shared/enums.js';
import { Ev } from '../shared/events.js';
import { SIM_DT, PLAYER, GRAVITY, JUMP_VELOCITY } from '../shared/tuning.js';
import { PlayerController } from './index.js';

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

/** Ground plane with its top face at y = 0, optionally cut off at `edgeX`. */
function makeWorld(edgeX) {
  const w = new PhysicsWorld({ cellSize: 8 });
  if (edgeX === undefined) {
    w.addStaticBox(
      new Vector3(0, -2, 0),
      new Vector3(200, 2, 200),
      new Quaternion(),
      SurfaceId.CONCRETE,
      0,
    );
  } else {
    // slab spanning x ∈ [edgeX-100, edgeX]
    w.addStaticBox(
      new Vector3(edgeX - 50, -2, 0),
      new Vector3(50, 2, 50),
      new Quaternion(),
      SurfaceId.CONCRETE,
      0,
    );
  }
  return w;
}

function makePlayer(world, bus, pos) {
  return new PlayerController({
    physics: world,
    position: pos || new Vector3(0, 0, 0),
    entityId: 1,
    bus,
  });
}

function settle(p, input, n = 40) {
  for (let i = 0; i < n; i++) {
    p.update(SIM_DT, input);
    clearPressed(input);
  }
}

// ---------------------------------------------------------------------------

export function runPlayerSelfTest() {
  const results = [];
  const metrics = {};
  const push = (id, name, ok, measured, expected, tolerance) =>
    results.push({ id, name, ok, measured, expected, tolerance });
  const near = (m, e, t) => Math.abs(m - e) <= t;

  // ---- F01 / F02 -------------------------------------------------------
  {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    const idle = makeInput();
    settle(p, idle, 40);
    const fwd = makeInput({ moveZ: 1 });
    let steps = 0;
    const goal = PLAYER.speed * 0.99;
    while (steps < 200) {
      p.update(SIM_DT, fwd);
      clearPressed(fwd);
      steps++;
      if (Math.hypot(p.velocity.x, p.velocity.z) >= goal) break;
    }
    const ms = steps * SIM_DT * 1000;
    push('F01', 'Standstill -> 99% of forward speed', ms <= 80, ms, 67.7, '<= 80 ms');

    for (let i = 0; i < 200; i++) {
      p.update(SIM_DT, fwd);
      clearPressed(fwd);
    }
    const v = Math.hypot(p.velocity.x, p.velocity.z);
    push('F02', 'Steady-state forward speed', near(v, 4.4, 0.02), v, 4.4, 0.02);
    metrics.forwardSpeed = v;
  }

  // ---- F03 / F04 / F05 -------------------------------------------------
  const steady = (patch, n = 300) => {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    const idle = makeInput();
    settle(p, idle, 40);
    const inp = makeInput(patch);
    for (let i = 0; i < n; i++) {
      p.update(SIM_DT, inp);
      clearPressed(inp);
    }
    return Math.hypot(p.velocity.x, p.velocity.z);
  };
  {
    const strafe = steady({ moveX: 1 });
    const ratio = strafe / metrics.forwardSpeed;
    push('F03', 'Strafe speed / forward speed', near(ratio, 0.9, 0.01), ratio, 0.9, 0.01);
  }
  {
    const back = steady({ moveZ: -1 });
    const ratio = back / metrics.forwardSpeed;
    push('F04', 'Backpedal speed / forward speed', near(ratio, 0.9, 0.01), ratio, 0.9, 0.01);
  }
  {
    const cr = steady({ moveZ: 1, crouch: true }, 400);
    push('F05', 'Crouch speed', near(cr, 1.9, 0.02), cr, 1.9, 0.02);
  }

  // ---- F06 strafe reversal ---------------------------------------------
  {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    const idle = makeInput();
    settle(p, idle, 40);
    const right = makeInput({ moveX: 1 });
    for (let i = 0; i < 300; i++) {
      p.update(SIM_DT, right);
      clearPressed(right);
    }
    const v0 = p.velocity.x;
    const left = makeInput({ moveX: -1 });
    let steps = 0;
    while (steps < 200) {
      p.update(SIM_DT, left);
      clearPressed(left);
      steps++;
      if (p.velocity.x <= -v0 + 1e-9) break;
    }
    const ms = steps * SIM_DT * 1000;
    push('F06', 'Full-speed strafe reversal (+v -> -v)', ms <= 140, ms, 122, '<= 140 ms');
  }

  // ---- F07 / F08 / F50(player) -----------------------------------------
  {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    const idle = makeInput();
    settle(p, idle, 60);
    const y0 = p.body.position.y;
    const jump = makeInput({ jump: true, jumpPressed: true });
    p.update(SIM_DT, jump);
    clearPressed(jump);
    jump.jump = false;
    let apex = p.body.position.y;
    let steps = 1;
    let airSteps = -1;
    let gMeasured = 0;
    while (steps < 400) {
      const vBefore = p.velocity.y;
      p.update(SIM_DT, jump);
      clearPressed(jump);
      if (steps === 20) gMeasured = (vBefore - p.velocity.y) / SIM_DT;
      steps++;
      if (p.body.position.y > apex) apex = p.body.position.y;
      if (p.grounded) {
        airSteps = steps;
        break;
      }
    }
    const h = apex - y0;
    const t = airSteps * SIM_DT;
    push('F07', 'Jump apex above launch plane', near(h, 1.05, 0.02), h, 1.05, 0.02);
    push('F08', 'Jump total airtime, flat ground', near(t, 0.95, 0.02), t, 0.95, 0.02);
    metrics.apex = h;
    metrics.airtime = t;
    // Direct measurement: the per-tick vertical velocity delta in free flight.
    metrics.playerGravity = gMeasured;
    // Independent cross-check from the arc itself (FEEL.md §2.1 g = 8h/t²).
    metrics.playerGravityFromArc = (8 * h) / (t * t);
  }

  // ---- F09 air accel / ground accel -------------------------------------
  {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    const idle = makeInput();
    settle(p, idle, 60);
    const fwd = makeInput({ moveZ: 1 });
    p.update(SIM_DT, fwd);
    clearPressed(fwd);
    const groundAccel = Math.hypot(p.velocity.x, p.velocity.z) / SIM_DT;

    const bus2 = new EventBus();
    const world2 = makeWorld();
    const p2 = makePlayer(world2, bus2);
    settle(p2, makeInput(), 60);
    const jump = makeInput({ jump: true, jumpPressed: true });
    p2.update(SIM_DT, jump);
    clearPressed(jump);
    jump.jump = false;
    for (let i = 0; i < 10; i++) {
      p2.update(SIM_DT, jump);
      clearPressed(jump);
    }
    p2.velocity.x = 0;
    p2.velocity.z = 0;
    const air = makeInput({ moveZ: 1 });
    p2.update(SIM_DT, air);
    clearPressed(air);
    const airAccel = Math.hypot(p2.velocity.x, p2.velocity.z) / SIM_DT;
    const ratio = airAccel / groundAccel;
    push('F09', 'Air acceleration / ground acceleration', near(ratio, 0.3, 0.02), ratio, 0.3, 0.02);
    metrics.groundAccel = groundAccel;
    metrics.airAccel = airAccel;
  }

  // ---- F10 air speed never exceeds ground speed -------------------------
  {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    settle(p, makeInput(), 60);
    const inp = makeInput({ moveZ: 1 });
    for (let i = 0; i < 300; i++) {
      p.update(SIM_DT, inp);
      clearPressed(inp);
    }
    let maxAir = 0;
    for (let rep = 0; rep < 6; rep++) {
      inp.jump = true;
      inp.jumpPressed = true;
      p.update(SIM_DT, inp);
      clearPressed(inp);
      inp.jump = false;
      for (let i = 0; i < 130; i++) {
        // thrash the stick mid-air: this is the classic air-strafe exploit
        inp.moveX = Math.sin(i * 0.7) > 0 ? 1 : -1;
        inp.moveZ = Math.cos(i * 0.5) > 0 ? 1 : -1;
        p.update(SIM_DT, inp);
        clearPressed(inp);
        if (!p.grounded) maxAir = Math.max(maxAir, Math.hypot(p.velocity.x, p.velocity.z));
        if (p.grounded && i > 5) break;
      }
      inp.moveX = 0;
      inp.moveZ = 1;
    }
    push(
      'F10',
      'Air speed never exceeds ground speed',
      maxAir <= PLAYER.speed + 1e-9,
      maxAir,
      '<= 4.40 m/s',
      'hard',
    );
  }

  // ---- F11 sprint does nothing -----------------------------------------
  {
    const hasSprintField = 'sprint' in new InputState();
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    settle(p, makeInput(), 40);
    const inp = makeInput({ moveZ: 1 });
    inp.sprint = true; // a bind that does not exist
    inp.shift = true;
    for (let i = 0; i < 300; i++) {
      p.update(SIM_DT, inp);
      clearPressed(inp);
    }
    const v = Math.hypot(p.velocity.x, p.velocity.z);
    const ok = !hasSprintField && near(v, 4.4, 0.02);
    push('F11', 'Sprint input does nothing (no bind exists)', ok, v, 4.4, 'hard');
  }

  // ---- F12 / F13 / F14 / F15 / F16 / F17 --------------------------------
  {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    const idle = makeInput();
    settle(p, idle, 20);

    let step = 0;
    let rechargeStart = -1;
    let rechargeFull = -1;
    let firstHealthUp = -1;
    let healthFull = -1;
    let healthDuringShieldRecharge = null;
    bus.on(Ev.SHIELD_RECHARGE_START, () => {
      if (rechargeStart < 0) rechargeStart = step;
    });
    bus.on(Ev.SHIELD_RECHARGE_FULL, () => {
      if (rechargeFull < 0) rechargeFull = step;
    });

    p.applyDamage(70, DamageType.KINETIC, HitRegion.TORSO, 0, 'test', 1);
    const shieldAfter = p.state.shield;
    const healthAfter = p.state.health;
    p.state.health = 0; // exercise the full 0 -> 45 regen ramp for F17

    let prevHealth = p.state.health;
    for (step = 1; step <= 3000; step++) {
      p.update(SIM_DT, idle);
      clearPressed(idle);
      if (rechargeStart > 0 && rechargeFull < 0 && healthDuringShieldRecharge === null) {
        if (step === rechargeStart + 100) healthDuringShieldRecharge = p.state.health;
      }
      if (p.state.health > prevHealth) {
        if (firstHealthUp < 0) firstHealthUp = step;
        if (p.state.health >= p.state.maxHealth && healthFull < 0) healthFull = step;
      }
      prevHealth = p.state.health;
    }

    const t12 = rechargeStart * SIM_DT;
    push('F12', 'Shield recharge start after last damage', near(t12, 4.0, 0.05), t12, 4.0, 0.05);
    const t13 = (rechargeFull - rechargeStart) * SIM_DT;
    push('F13', 'Shield 0 -> 70 duration', near(t13, 2.5, 0.05), t13, 2.5, 0.05);
    push(
      'F15',
      'Health regen does not start until shields full',
      healthDuringShieldRecharge === 0 && firstHealthUp > rechargeFull,
      { healthMidRecharge: healthDuringShieldRecharge, firstHealthUpStep: firstHealthUp, shieldFullStep: rechargeFull },
      'health flat until shields full',
      'hard',
    );
    const t16 = (firstHealthUp - rechargeFull) * SIM_DT;
    push('F16', 'Health regen start after shields full', near(t16, 8.0, 0.1), t16, 8.0, 0.1);
    const t17 = (healthFull - firstHealthUp) * SIM_DT;
    push('F17', 'Health 0 -> 45 duration', near(t17, 5.0, 0.1), t17, 5.0, 0.1);
    metrics.shieldAfter70 = shieldAfter;
    metrics.healthAfter70 = healthAfter;
  }

  // ---- F14 damage during recharge resets the delay -----------------------
  {
    const bus = new EventBus();
    const world = makeWorld();
    const p = makePlayer(world, bus);
    const idle = makeInput();
    settle(p, idle, 20);
    let step = 0;
    let firstStart = -1;
    let secondStart = -1;
    bus.on(Ev.SHIELD_RECHARGE_START, () => {
      if (firstStart < 0) firstStart = step;
      else if (secondStart < 0) secondStart = step;
    });
    p.applyDamage(20, DamageType.KINETIC, HitRegion.TORSO, 0, 'test', 1);
    let interruptStep = 0;
    for (step = 1; step <= 2400; step++) {
      p.update(SIM_DT, idle);
      clearPressed(idle);
      // interrupt 0.5 s into the recharge
      if (firstStart > 0 && interruptStep === 0 && step === firstStart + 60) {
        interruptStep = step;
        p.applyDamage(10, DamageType.KINETIC, HitRegion.TORSO, 0, 'test', 1);
      }
    }
    const delay = (secondStart - interruptStep) * SIM_DT;
    push(
      'F14',
      'Damage during recharge resets delay to 4.00 s',
      secondStart > 0 && near(delay, 4.0, 0.05),
      delay,
      4.0,
      'hard (4.00 s +/- 0.05)',
    );
  }

  // ---- F51 fall damage threshold ----------------------------------------
  {
    let minDamagingImpact = Infinity;
    let maxHarmlessImpact = 0;
    for (let h = 3.6; h <= 4.2001; h += 0.005) {
      const bus = new EventBus();
      const world = makeWorld();
      const p = makePlayer(world, bus, new Vector3(0, h, 0));
      const idle = makeInput();
      let impact = 0;
      bus.on(Ev.PLAYER_LANDED, (e) => {
        if (impact === 0) impact = e.impactSpeed;
      });
      for (let i = 0; i < 240; i++) {
        p.update(SIM_DT, idle);
        clearPressed(idle);
        if (p.grounded && impact > 0) break;
      }
      const damaged = p.state.health < p.state.maxHealth;
      if (damaged) minDamagingImpact = Math.min(minDamagingImpact, impact);
      else maxHarmlessImpact = Math.max(maxHarmlessImpact, impact);
    }
    const threshold = (minDamagingImpact + maxHarmlessImpact) / 2;
    push(
      'F51',
      'Fall damage threshold',
      near(threshold, 8.5, 0.2),
      threshold,
      8.5,
      0.2,
    );
    metrics.fallDamageBracket = [maxHarmlessImpact, minDamagingImpact];
  }

  // ---- F52 coyote time ---------------------------------------------------
  {
    const EDGE = 0;
    const runToEdge = (jumpAtStep) => {
      const bus = new EventBus();
      const world = makeWorld(EDGE);
      const p = makePlayer(world, bus, new Vector3(-3, 0, 0));
      p.yaw = -Math.PI / 2; // forward = +X
      const idle = makeInput();
      settle(p, idle, 40);
      p.yaw = -Math.PI / 2;
      const inp = makeInput({ moveZ: 1 });
      let jumped = -1;
      bus.on(Ev.PLAYER_JUMPED, () => {
        if (jumped < 0) jumped = step;
      });
      let lastGrounded = -1;
      let step = 0;
      for (step = 1; step <= 400; step++) {
        if (step === jumpAtStep) {
          inp.jump = true;
          inp.jumpPressed = true;
        }
        p.update(SIM_DT, inp);
        clearPressed(inp);
        inp.jump = false;
        if (p.grounded) lastGrounded = step;
        else if (lastGrounded > 0 && step > lastGrounded + 40) break;
      }
      return { lastGrounded, jumped };
    };
    const base = runToEdge(-1);
    let maxK = 0;
    for (let k = 1; k <= 24; k++) {
      const r = runToEdge(base.lastGrounded + k);
      if (r.jumped > 0 && r.lastGrounded === base.lastGrounded) maxK = k;
      else break;
    }
    const ms = maxK * SIM_DT * 1000;
    push('F52', 'Coyote time window', near(ms, 90, 10), ms, 90, 10);
  }

  // ---- F53 jump buffer ----------------------------------------------------
  {
    const run = (pressStep) => {
      const bus = new EventBus();
      const world = makeWorld();
      const p = makePlayer(world, bus, new Vector3(0, 0, 0));
      const idle = makeInput();
      settle(p, idle, 40);
      const inp = makeInput();
      const jumpSteps = [];
      let step = 0;
      let landingStep = -1;
      bus.on(Ev.PLAYER_JUMPED, () => jumpSteps.push(step));
      bus.on(Ev.PLAYER_LANDED, () => {
        if (landingStep < 0) landingStep = step;
      });
      inp.jump = true;
      inp.jumpPressed = true;
      step = 1;
      p.update(SIM_DT, inp);
      clearPressed(inp);
      inp.jump = false;
      for (step = 2; step <= 400; step++) {
        if (step === pressStep) {
          inp.jump = true;
          inp.jumpPressed = true;
        }
        p.update(SIM_DT, inp);
        clearPressed(inp);
        inp.jump = false;
        if (jumpSteps.length >= 2) break;
        if (landingStep > 0 && step > landingStep + 5) break;
      }
      return { jumpSteps, pressStep, landingStep };
    };
    const base = run(-1);
    let best = 0;
    let bestWindow = 0;
    for (let k = 1; k <= 22; k++) {
      const r = run(base.landingStep - k);
      if (r.jumpSteps.length >= 2) {
        best = k;
        bestWindow = (r.jumpSteps[1] - r.pressStep) * SIM_DT * 1000;
      } else break;
    }
    push('F53', 'Jump buffer window', near(bestWindow, 120, 10), bestWindow, 120, 10);
    metrics.jumpBufferMaxLead = best;
  }

  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results, metrics };
}

export default runPlayerSelfTest;
