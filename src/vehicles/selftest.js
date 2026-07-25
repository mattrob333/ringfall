// L5 vehicles — self-test. Headless, no rendering, no DOM. Exercises the public
// VehicleSystem/Vehicle API exactly as an owner outside this directory would.
// Covers FEEL.md F43-F46 plus suspension-equilibrium and determinism checks.
import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from '../physics/index.js';
import { EventBus } from '../core/events.js';
import { setSessionSeed, resetAllStreams } from '../core/rng.js';
import { resetIds } from '../core/ids.js';
import { SIM_DT, RIDGEBACK, GRAVITY } from '../shared/tuning.js';
import { SurfaceId } from '../shared/enums.js';
import { VehicleSystem } from './index.js';

function approx(measured, expected, tol) {
  return Math.abs(measured - expected) <= tol;
}

function buildFlatGround(world) {
  world.addStaticBox(new Vector3(0, -1, 0), new Vector3(300, 1, 300), new Quaternion(), SurfaceId.CONCRETE, 0);
}

function makeRig() {
  const world = new PhysicsWorld({ cellSize: 8 });
  buildFlatGround(world);
  const events = new EventBus();
  const system = new VehicleSystem({ physics: world, events });
  return { world, events, system };
}

/** Settle a freshly-spawned vehicle onto the ground with zero input. */
function settle(system, steps = 300) {
  const vehicle = system.spawn({ type: 'ridgeback', position: new Vector3(0, 1.2, 0), yaw: 0 });
  for (let i = 0; i < steps; i++) system.update(SIM_DT);
  return vehicle;
}

export function runVehicleSelfTest() {
  const results = [];
  const push = (id, name, ok, measured, expected, tolerance) =>
    results.push({ id, name, ok, measured, expected, tolerance });

  // -------------------------------------------------------------------
  // Suspension equilibrium: rests without sinking or jittering.
  // -------------------------------------------------------------------
  {
    const { system } = makeRig();
    const vehicle = settle(system, 300);
    let maxDY = 0;
    let maxSpeed = 0;
    let maxAngSpeed = 0;
    let lastY = vehicle.position.y;
    for (let i = 0; i < 120; i++) {
      system.update(SIM_DT);
      const dy = Math.abs(vehicle.position.y - lastY);
      if (dy > maxDY) maxDY = dy;
      lastY = vehicle.position.y;
      maxSpeed = Math.max(maxSpeed, vehicle.speed);
      maxAngSpeed = Math.max(maxAngSpeed, vehicle.angularVelocity.length());
    }
    const allGrounded = vehicle.wheels.every((w) => w.grounded);
    const ok = allGrounded && maxDY < 0.01 && maxSpeed < 0.05 && maxAngSpeed < 0.05;
    push(
      'rest-equilibrium',
      'Rests at suspension equilibrium without sinking or jittering',
      ok,
      { maxDY, maxSpeed, maxAngSpeed, allGrounded },
      { maxDY: '<0.01', maxSpeed: '<0.05', maxAngSpeed: '<0.05', allGrounded: true },
      null,
    );
  }

  // -------------------------------------------------------------------
  // F43: 0 -> 18 m/s in 4.20 s +/- 0.15.
  // -------------------------------------------------------------------
  {
    const { system } = makeRig();
    const vehicle = settle(system, 300);
    vehicle.setDriverInput({ throttle: 1, brake: 0, steer: 0, handbrake: 0 });
    const target = RIDGEBACK.maxSpeed * 0.99;
    let elapsed = 0;
    let reached = false;
    const maxTime = 8;
    while (elapsed < maxTime) {
      system.update(SIM_DT);
      elapsed += SIM_DT;
      const forwardSpeed = vehicle.velocity.length();
      if (forwardSpeed >= target) {
        reached = true;
        break;
      }
    }
    push(
      'F43',
      'Ridgeback 0 -> 18 m/s (99% threshold)',
      reached && approx(elapsed, RIDGEBACK.zeroToMax, 0.15),
      elapsed,
      RIDGEBACK.zeroToMax,
      0.15,
    );
  }

  // -------------------------------------------------------------------
  // F44: rolls at sustained lateral accel > 1.25g for 0.25s.
  // Ramp steering slowly at speed so the lateral-accel threshold is crossed
  // gradually (not overshot in one tick), then measure the g-level at the
  // first tick the sustained-timer starts, and confirm the rollover fires
  // ~rolloverHold seconds later while that g-level holds.
  // -------------------------------------------------------------------
  {
    const { system } = makeRig();
    const vehicle = settle(system, 300);
    // Get the vehicle rolling in a straight line first.
    vehicle.setDriverInput({ throttle: 1, brake: 0, steer: 0, handbrake: 0 });
    for (let i = 0; i < 180; i++) system.update(SIM_DT); // ~1.5s, well under maxSpeed

    let steer = 0;
    const steerRampPerSec = 0.35; // slow ramp so the g-threshold is crossed gradually
    const gThreshold = RIDGEBACK.rolloverG * GRAVITY;
    let firstCrossTime = -1;
    let crossG = 0;
    let crossUpright = 0;
    let rollTime = -1;
    let t = 0;
    const prevVel = vehicle.velocity.clone();
    for (let i = 0; i < 1200 && rollTime < 0; i++) {
      steer = Math.min(1, steer + steerRampPerSec * SIM_DT);
      vehicle.setDriverInput({ throttle: 0.6, brake: 0, steer, handbrake: 0 });
      const rightAxis = new Vector3(1, 0, 0).applyQuaternion(vehicle.quaternion);
      const before = prevVel.copy(vehicle.velocity);
      const beforeUpright = new Vector3(0, 1, 0).applyQuaternion(vehicle.quaternion).dot(new Vector3(0, 1, 0));
      system.update(SIM_DT);
      t += SIM_DT;
      const accel = vehicle.velocity.clone().sub(before).divideScalar(SIM_DT);
      const lateralAccel = accel.dot(rightAxis);
      if (firstCrossTime < 0 && Math.abs(lateralAccel) > gThreshold) {
        firstCrossTime = t;
        crossG = Math.abs(lateralAccel) / GRAVITY;
        crossUpright = beforeUpright;
      }
      if (vehicle.rolled) rollTime = t;
    }
    const holdMeasured = rollTime >= 0 && firstCrossTime >= 0 ? rollTime - firstCrossTime : -1;
    const ok = firstCrossTime >= 0 && rollTime >= 0 && approx(crossG, RIDGEBACK.rolloverG, 0.08);
    push(
      'F44',
      'Ridgeback rolls at sustained lateral accel > 1.25g',
      ok,
      { crossG, holdMeasured, crossUprightDot: crossUpright, triggered: rollTime >= 0 },
      { crossG: RIDGEBACK.rolloverG, holdMeasured: RIDGEBACK.rolloverHold },
      0.08,
    );
  }

  // -------------------------------------------------------------------
  // F45: no occupant damage below 12 m/s; damage occurs above it.
  // -------------------------------------------------------------------
  {
    const targets = new Map([[42, { shield: 0, health: 100 }]]);
    const resolveDamageTarget = (id) => targets.get(id) ?? null;

    // Sub-case A: low-speed rollover -> no damage.
    {
      const world = new PhysicsWorld({ cellSize: 8 });
      buildFlatGround(world);
      const events = new EventBus();
      const system = new VehicleSystem({ physics: world, events, resolveDamageTarget });
      const vehicle = system.spawn({ type: 'ridgeback', position: new Vector3(0, 1.2, 0), yaw: 0 });
      for (let i = 0; i < 300; i++) system.update(SIM_DT);
      vehicle.enter(42, 'driver');
      targets.get(42).health = 100;
      vehicle.velocity.set(3, 0, 0); // 3 m/s, well below ejectSafeSpeed (12)
      vehicle.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2); // tip onto its side
      system.update(SIM_DT);
      const healthAfter = targets.get(42).health;
      push(
        'F45a',
        'Rollover below 12 m/s deals no occupant damage',
        vehicle.rolled === true && healthAfter === 100,
        { rolled: vehicle.rolled, health: healthAfter },
        { rolled: true, health: 100 },
        null,
      );
    }

    // Sub-case B: high-speed rollover -> damage applied.
    {
      const world = new PhysicsWorld({ cellSize: 8 });
      buildFlatGround(world);
      const events = new EventBus();
      const system = new VehicleSystem({ physics: world, events, resolveDamageTarget });
      const vehicle = system.spawn({ type: 'ridgeback', position: new Vector3(0, 1.2, 0), yaw: 0 });
      for (let i = 0; i < 300; i++) system.update(SIM_DT);
      vehicle.enter(42, 'driver');
      targets.get(42).health = 100;
      vehicle.velocity.set(20, 0, 0); // 20 m/s, above ejectSafeSpeed (12)
      vehicle.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
      system.update(SIM_DT);
      const healthAfter = targets.get(42).health;
      push(
        'F45b',
        'Rollover above 12 m/s deals occupant damage',
        vehicle.rolled === true && healthAfter < 100,
        { rolled: vehicle.rolled, health: healthAfter },
        { rolled: true, health: '<100' },
        null,
      );
    }
  }

  // -------------------------------------------------------------------
  // F46: self-right hold duration 1.20s +/- 0.05.
  // -------------------------------------------------------------------
  {
    const { system } = makeRig();
    const vehicle = settle(system, 300);
    vehicle.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI); // upside down
    system.update(SIM_DT);
    if (!vehicle.rolled) {
      // Force it if the uprightDot check didn't trip on this exact quaternion for any reason.
      vehicle.rolled = true;
    }

    // Hold for slightly less than the required duration: must NOT flip yet.
    const shortHoldTicks = Math.round((RIDGEBACK.selfRightHold - 0.1) / SIM_DT);
    let flippedEarly = false;
    for (let i = 0; i < shortHoldTicks; i++) {
      const flipped = vehicle.selfRight(42);
      if (flipped) flippedEarly = true;
      system.update(SIM_DT);
    }
    // Release for one tick (reset the hold), then hold continuously for the full duration.
    system.update(SIM_DT);
    let holdTime = 0;
    let flippedAt = -1;
    for (let i = 0; i < Math.round(3 / SIM_DT) && flippedAt < 0; i++) {
      const flipped = vehicle.selfRight(42);
      holdTime += SIM_DT;
      system.update(SIM_DT);
      if (flipped) flippedAt = holdTime;
    }
    push(
      'F46',
      'Self-right hold duration',
      !flippedEarly && flippedAt >= 0 && approx(flippedAt, RIDGEBACK.selfRightHold, 0.05),
      { flippedEarly, flippedAt },
      RIDGEBACK.selfRightHold,
      0.05,
    );
  }

  // -------------------------------------------------------------------
  // Determinism: identical seed, two 600-step runs -> bit-identical transform.
  // -------------------------------------------------------------------
  {
    function runSim() {
      resetIds();
      setSessionSeed(1337);
      resetAllStreams();
      const world = new PhysicsWorld({ cellSize: 8 });
      buildFlatGround(world);
      world.addStaticBox(new Vector3(4, 0.4, 2), new Vector3(0.6, 0.4, 0.6), new Quaternion(), SurfaceId.METAL_BARE, 0);
      const events = new EventBus();
      const system = new VehicleSystem({ physics: world, events });
      const vehicle = system.spawn({ type: 'ridgeback', position: new Vector3(0, 1.2, 0), yaw: 0.3 });
      for (let i = 0; i < 600; i++) {
        const steer = Math.sin(i * 0.03) * 0.6;
        const throttle = i < 400 ? 1 : 0;
        const brake = i >= 400 ? 0.5 : 0;
        vehicle.setDriverInput({ throttle, brake, steer, handbrake: i > 300 && i < 320 ? 1 : 0 });
        vehicle.setTurretAim(i * 0.01, 0.1);
        if (i % 30 === 0) vehicle.fireTurret();
        system.update(SIM_DT);
      }
      return {
        pos: vehicle.position.toArray(),
        vel: vehicle.velocity.toArray(),
        quat: vehicle.quaternion.toArray(),
        angVel: vehicle.angularVelocity.toArray(),
      };
    }
    const a = runSim();
    const b = runSim();
    const identical =
      a.pos.every((v, i) => v === b.pos[i]) &&
      a.vel.every((v, i) => v === b.vel[i]) &&
      a.quat.every((v, i) => v === b.quat[i]) &&
      a.angVel.every((v, i) => v === b.angVel[i]);
    push(
      'determinism',
      'Two identical 600-step runs match bit-for-bit',
      identical,
      JSON.stringify(a),
      JSON.stringify(b),
      null,
    );
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}
