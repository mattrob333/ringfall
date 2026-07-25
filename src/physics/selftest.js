// L3 physics — self-test. Headless, no rendering, no DOM. Exercises the
// public PhysicsWorld API exactly as an owner outside this directory would.
// Run via `node` (see the temporary harness used during development) or
// wired into tools/feeltest.mjs by the orchestrator.
import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from './index.js';
import { GRAVITY, SIM_DT } from '../shared/tuning.js';
import { SurfaceId } from '../shared/enums.js';

function approx(measured, expected, tol) {
  return Math.abs(measured - expected) <= tol;
}

export function runPhysicsSelfTest() {
  const results = [];
  const push = (name, ok, measured, expected) => results.push({ name, ok, measured, expected });

  // -------------------------------------------------------------------
  // 1. Capsule cannot pass through a wall at 100 m/s.
  // -------------------------------------------------------------------
  {
    const world = new PhysicsWorld({ cellSize: 8 });
    // A thin wall (0.3m) at x=5, spanning a generous y/z extent.
    world.addStaticBox(new Vector3(5, 1, 0), new Vector3(0.15, 2, 5), new Quaternion(), SurfaceId.CONCRETE, 0);
    const ch = world.addCharacter({
      position: new Vector3(0, 0, 0),
      radius: 0.4,
      height: 1.8,
      stepHeight: 0.42,
      maxSlopeDeg: 48,
      entityId: 1,
    });
    // Single move() call covering what 100 m/s for 1/120s would be — but to
    // really stress it, throw the WHOLE crossing distance at one move() call.
    const disp = new Vector3(100 * SIM_DT, 0, 0); // one physics tick at 100 m/s
    for (let i = 0; i < 40; i++) ch.move(disp); // walk the capsule toward and through the wall region
    const wallFaceX = 5 - 0.15; // near face of the box
    const tunneled = ch.position.x > wallFaceX + ch.radius + 0.01;
    push('capsule cannot tunnel a 0.3m wall at 100 m/s', !tunneled, ch.position.x, wallFaceX + ch.radius);
  }

  // -------------------------------------------------------------------
  // 2. Step-up: 0.4m ledge succeeds, 0.5m ledge fails.
  // -------------------------------------------------------------------
  {
    for (const [ledgeHeight, shouldSucceed] of [
      [0.4, true],
      [0.5, false],
    ]) {
      const world = new PhysicsWorld({ cellSize: 8 });
      // Ground plane.
      world.addStaticBox(new Vector3(0, -0.5, 0), new Vector3(20, 0.5, 20), new Quaternion(), SurfaceId.CONCRETE, 0);
      // Ledge starting at x=2, top at ledgeHeight.
      world.addStaticBox(
        new Vector3(6, ledgeHeight / 2, 0),
        new Vector3(4, ledgeHeight / 2, 4),
        new Quaternion(),
        SurfaceId.CONCRETE,
        0,
      );
      const ch = world.addCharacter({
        position: new Vector3(1, 0, 0),
        radius: 0.42,
        height: 1.85,
        stepHeight: 0.42,
        maxSlopeDeg: 48,
        entityId: 1,
      });
      const disp = new Vector3(0.5, -0.02, 0); // forward + small gravity nudge each tick
      // Track whether the capsule EVER stood on top of the ledge — walking
      // 30 ticks * 0.5 m/tick covers 15 m, more than the 8 m platform, so
      // checking only the final position would catch it after it walked
      // off the far edge again. What we're testing is whether it got up.
      let everOnTop = false;
      for (let i = 0; i < 20; i++) {
        ch.move(disp);
        if (ch.position.x > 3 && ch.position.y > ledgeHeight - 0.05 && ch.grounded) everOnTop = true;
      }
      push(
        `step-up over ${ledgeHeight}m ledge ${shouldSucceed ? 'succeeds' : 'fails'}`,
        everOnTop === shouldSucceed,
        everOnTop,
        shouldSucceed,
      );
    }
  }

  // -------------------------------------------------------------------
  // 3. Slope: 45deg walkable, 55deg not (maxSlopeDeg = 48, per FEEL.md).
  // -------------------------------------------------------------------
  {
    for (const [slopeDeg, shouldBeWalkable] of [
      [45, true],
      [55, false],
    ]) {
      const world = new PhysicsWorld({ cellSize: 8 });
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -slopeDeg * (Math.PI / 180));
      // A big tilted slab whose top face makes `slopeDeg` with the horizontal,
      // centred so the character starts standing near its middle.
      world.addStaticBox(new Vector3(0, -1, 0), new Vector3(6, 0.3, 6), q, SurfaceId.ROCK, 0);
      const ch = world.addCharacter({
        position: new Vector3(0, 2, 0),
        radius: 0.42,
        height: 1.85,
        stepHeight: 0.42,
        maxSlopeDeg: 48,
        entityId: 1,
      });
      // Let gravity settle the character onto the slope.
      for (let i = 0; i < 240; i++) {
        ch.velocity.y -= GRAVITY * SIM_DT; // owner-side gravity integration, as the contract expects
        const dy = ch.grounded ? Math.max(ch.velocity.y, -5) * SIM_DT : ch.velocity.y * SIM_DT;
        ch.move(new Vector3(0, dy, 0));
        if (ch.grounded) ch.velocity.y = 0;
      }
      push(`slope ${slopeDeg}deg is ${shouldBeWalkable ? 'walkable' : 'a wall'}`, ch.grounded === shouldBeWalkable, ch.grounded, shouldBeWalkable);
    }
  }

  // -------------------------------------------------------------------
  // 4. Restitution: ball dropped on METAL_PAINTED returns to 0.42^2 = 17.6%.
  // -------------------------------------------------------------------
  {
    const world = new PhysicsWorld({ cellSize: 8 });
    world.addStaticBox(new Vector3(0, -1, 0), new Vector3(10, 1, 10), new Quaternion(), SurfaceId.METAL_PAINTED, 0);
    const dropHeight = 5.0;
    const body = world.addBody({
      position: new Vector3(0, dropHeight, 0),
      velocity: new Vector3(0, 0, 0),
      radius: 0.1,
      restitution: 1.0, // combined with SURFACE_PHYSICS[METAL_PAINTED].restitution (0.42) -> 0.42
      friction: 0.0,
      sleepThreshold: 0.001,
    });
    let peakAfterBounce = 0;
    let bounced = false;
    let maxSteps = Math.round(6 / SIM_DT);
    for (let i = 0; i < maxSteps; i++) {
      const before = body.velocity.y;
      world.step(SIM_DT);
      if (!bounced && before < 0 && body.velocity.y > 0) bounced = true;
      if (bounced) peakAfterBounce = Math.max(peakAfterBounce, body.position.y);
      if (bounced && body.velocity.y <= 0 && peakAfterBounce > 0) break;
    }
    // The sphere's CENTRE rests at y = radius (contact with the y=0 floor),
    // not y = 0 — so the fall distance is (dropHeight - radius), and the
    // rise after the bounce should be (dropHeight - radius) * e^2, measured
    // from that same contact height.
    const fallDistance = dropHeight - body.radius;
    const gained = peakAfterBounce - body.radius;
    const expected = fallDistance * 0.42 * 0.42;
    push('restitution: bounce height / drop height = 0.42^2', approx(gained, expected, expected * 0.03 + 0.01), gained, expected);
  }

  // -------------------------------------------------------------------
  // 5. Raycast against a rotated OBB hits at the analytically correct point.
  // -------------------------------------------------------------------
  {
    const world = new PhysicsWorld({ cellSize: 8 });
    const center = new Vector3(10, 0, 0);
    const half = new Vector3(1, 1, 1);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4); // 45 deg yaw
    world.addStaticBox(center, half, q, SurfaceId.METAL_BARE, 0);
    const origin = new Vector3(0, 0, 0);
    const dir = new Vector3(1, 0, 0);
    const hit = world.raycast(origin, dir, 100, null);
    // Analytic: a unit cube rotated 45deg about Y has, along +X through its
    // centre height/depth, a corner facing the ray at distance center.x -
    // half.x*sqrt(2) (the rotated cube's axis-aligned footprint half-width
    // along X is he.x*(|cos45|+|sin45|) = he.x*sqrt(2)).
    const expectedX = center.x - half.x * Math.SQRT2;
    push('raycast vs rotated OBB hits analytic point', !!hit && approx(hit.point.x, expectedX, 1e-6), hit ? hit.point.x : null, expectedX);
  }

  // -------------------------------------------------------------------
  // 6. Determinism: same 600-step sim run twice -> bit-identical final state.
  // -------------------------------------------------------------------
  {
    function runSim() {
      const world = new PhysicsWorld({ cellSize: 8 });
      world.addStaticBox(new Vector3(0, -1, 0), new Vector3(50, 1, 50), new Quaternion(), SurfaceId.CONCRETE, 0);
      world.addStaticBox(new Vector3(3, 0.5, 0), new Vector3(0.5, 0.5, 0.5), new Quaternion(), SurfaceId.METAL_BARE, 0);
      const ch = world.addCharacter({
        position: new Vector3(0, 0, 0),
        radius: 0.42,
        height: 1.85,
        stepHeight: 0.42,
        maxSlopeDeg: 48,
        entityId: 1,
      });
      const grenade = world.addBody({
        position: new Vector3(-2, 3, 0),
        velocity: new Vector3(4, 2, 1),
        radius: 0.09,
        restitution: 0.42,
        friction: 0.55,
        sleepThreshold: 0.05,
      });
      for (let i = 0; i < 600; i++) {
        world.step(SIM_DT);
        ch.velocity.y -= GRAVITY * SIM_DT;
        const dy = ch.velocity.y * SIM_DT;
        ch.move(new Vector3(Math.sin(i * 0.05) * 0.02, ch.grounded ? Math.max(dy, -0.05) : dy, Math.cos(i * 0.03) * 0.015));
        if (ch.grounded) ch.velocity.y = 0;
      }
      return {
        chPos: ch.position.toArray(),
        bodyPos: grenade.position.toArray(),
        bodyVel: grenade.velocity.toArray(),
      };
    }
    const a = runSim();
    const b = runSim();
    const identical =
      a.chPos.every((v, i) => v === b.chPos[i]) &&
      a.bodyPos.every((v, i) => v === b.bodyPos[i]) &&
      a.bodyVel.every((v, i) => v === b.bodyVel[i]);
    push('determinism: two identical 600-step runs match bit-for-bit', identical, JSON.stringify(a), JSON.stringify(b));
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}
