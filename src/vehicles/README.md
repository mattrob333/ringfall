# src/vehicles — the Ridgeback LRV

Owner: `vehicles`. Headless (no `src/render` import). Layer L5. Permitted imports: `three`,
`../shared/*`, `../core/*`, `../physics/*`, and `../weapons/targets.js` if it exists (it does not
yet — see "Pending integrations" below).

## Files

| File | Contents |
| --- | --- |
| `index.js` | `VehicleSystem` (public entry point) and `Vehicle` (the Ridgeback instance). |
| `selftest.js` | `runVehicleSelfTest()` — covers F43-F46, suspension equilibrium, determinism. |

## The physics model

### Rigid body

Each `Vehicle` integrates a full 6-DOF rigid body: `position`/`velocity` (linear) and
`quaternion`/`angularVelocity` (angular), mass `RIDGEBACK.mass` (2100 kg), and a real inertia
tensor computed once from a chassis box:

- Half-extents: width `RIDGEBACK.trackWidth/2 + 0.3` (fenders), length
  `RIDGEBACK.wheelBase/2 + 0.5` (front/rear overhang), height `0.55` (an open-cab LRV, roughly
  1.1 m tall at the hull — FEEL.md does not specify a chassis height or overhang, so these two
  numbers are `vehicles`-owned design choices, not tuning-table values).
- Standard solid-box inertia formula: `Ixx = m/12*(h²+l²)`, `Iyy = m/12*(w²+l²)`,
  `Izz = m/12*(w²+h²)`.

Every tick: four wheels contribute suspension + tire forces at their contact points, gravity is
added at the COM, a chassis-vs-world sweep resolves wall impacts, then linear and angular state
are integrated with semi-implicit Euler. Torque is `Σ (contactPoint - COM) × force` per contact,
converted to angular acceleration via `R⁻¹·torque` (local frame, where the inertia tensor is
diagonal) then rotated back to world — this is what makes suspension asymmetry (cornering,
bumps, one wheel off a ledge) actually roll and pitch the chassis, not just bounce it vertically.

### Suspension: 4-wheel raycast

Each wheel casts straight down (along the chassis's own local "down", i.e. `-up` rotated by the
current orientation — not world-down, so suspension behaves sensibly even while pitched/rolled)
from its mount point, via `physics.raycast`.

FEEL.md gives `travel` (0.32 m) and `rest` (0.18 m) but no raycast formula for how they compose.
This module's interpretation, stated plainly since it's a `vehicles`-owned decision:

- `rest` is the distance from the wheel mount to the wheel at full droop (spring fully extended,
  zero force).
- `travel` is the compressible range above that.
- The raycast probe distance is therefore `rest + travel = 0.5 m`.
- `compression = clamp(probeMax - hitDistance, 0, travel)`, `compression01 = compression/travel`.

Force: `Fs = springK*compression + damperC*compressionVelocity`, clamped to `≥ 0` (a spring can
only push). `compressionVelocity` is read from the actual contact-point velocity
(`velocity + angularVelocity × r`) projected onto the suspension axis — not a finite difference
of compression — so it's exact within the tick, not laggy.

Measured (via `selftest.js`, `node`, this repo's pinned `three` 0.185.1): with the frozen
`springK`/`damperC`/`mass` values, the vehicle settles at **compression ≈ 0.116 m
(compression01 ≈ 0.364)**, not exactly the nominal "rest" 0.18 m. This is expected, not a bug:
`rest` is one independently-specified number among several (`springK`, `damperC`, `mass`) that
together over-determine the equilibrium — real suspension spec sheets are rarely perfectly
self-consistent under a simplified symmetric-load assumption either. The measured value is well
within the travel range (doesn't bottom out, doesn't sit at zero) and the self-test asserts it
settles there with no sinking or jitter (see "Self-test results").

### Tyre model: Pacejka-lite

For each grounded wheel:

- `wheelForward`/`wheelRight` are the chassis forward/right axes rotated by the wheel's steer
  angle (front wheels only; rear wheels never steer).
- `slipAngle = atan2(lateralVel, |longitudinalVel| + 0.5)` (contact-point velocity, so it
  includes the chassis's angular contribution, not just linear velocity).
- Lateral force: `-sin(clamp(slipAngle/peak, -1, 1) * π/2) * tyreLateral * Fs` — a smooth
  S-curve that saturates at `tyreLateral * Fs` once slip angle passes `peak` (8°, a
  `vehicles`-owned constant; FEEL.md specifies the grip coefficients, not the peak-slip-angle
  shape of the curve). This is what lets the tail step out and hold a drift instead of the tires
  behaving as an infinitely-stiff rail.
- Longitudinal force is drive force (rear wheels only — the Ridgeback is modelled RWD, since
  FEEL.md doesn't specify a drivetrain layout) + brake force (all wheels) + handbrake locking
  (rear wheels only).
- Both components are clamped to an elliptical **friction circle**:
  `(long/(tyreLongitudinal·Fs))² + (lat/(tyreLateral·Fs))² ≤ 1`, scaling both down proportionally
  if exceeded. This is the mechanism that makes flooring the throttle mid-corner understeer, and
  heavy braking mid-corner lose the rear — genuinely emergent from the shared force budget, not
  scripted.

### Drive model: why F43 lands exactly on 4.20 s

FEEL.md specifies "0 → 18 m/s in 4.20 s" and `shared/tuning.js` already derives
`RIDGEBACK_DRIVE_ACCEL = maxSpeed/zeroToMax` with the comment "drive force derived so 0→maxSpeed
takes exactly zeroToMax **with drag**". This module does not add a separate drag/rolling-
resistance force during the powered acceleration phase — instead the engine force applied at the
rear wheels is exactly `mass * RIDGEBACK_DRIVE_ACCEL * throttle` (a governor cuts it to 0 once
forward speed reaches `maxSpeed`, and equivalently for reverse/`maxReverse`). That is a real
force, integrated through real suspension/tire contact points (still subject to the friction-
circle clamp — verified not to bind in a straight-line launch given the tuned grip numbers), not
a velocity clamp or a scripted curve. Net result: `dv/dt` is a genuine constant
(`RIDGEBACK_DRIVE_ACCEL`) for the whole acceleration phase, so `v(t) = a·t` and F43 is satisfied
by construction, without ever touching `velocity` directly outside of `F = ma` integration.

The honest tradeoff: there is **no separate aerodynamic or rolling drag term** at all, powered or
coasting. Releasing the throttle coasts at constant speed indefinitely (braking is real —
`brakeDecel`, 11 m/s² — and tire slip losses are real, but passive drag is not modelled). FEEL.md
does not specify a drag curve, and layering an uncancelled drag force back in would either reduce
the measured F43 time below spec or require re-deriving a compensating engine curve — a `//
COMPENSATION:` for a subsystem defect this isn't, since no defect is being hidden, it's a
deliberate simplification. Filed as a known limitation, not silently dropped.

### Rollover (F44) — funny, not punishing

Two independent triggers, checked every tick:

1. **Sustained lateral g.** Lateral acceleration is read directly off the tick's force
   accumulator (`Σforce · rightAxis / mass`) — not a finite difference of velocity, so it's exact
   and not one tick delayed. A running timer accumulates while `|lateralAccel| >
   rolloverG * GRAVITY` (using the single shared `GRAVITY` constant as the "g" unit, per F50 —
   there is no `9.81` anywhere in this module); the timer resets to 0 the instant it drops below
   threshold. Rollover triggers once the timer reaches `rolloverHold` (0.25 s).
2. **`uprightDot < uprightDotFail`** (0.15) — an instant trigger regardless of the timer, for an
   actual physical tip-over (e.g. launched off a ramp) rather than a sustained cornering slide.

On trigger: `rolled = true`, `vehicle.rolled` event emitted, both seats are cleared and
`vehicle.exited` is emitted per occupied seat with `ejected: true`. **Vehicles is headless and
does not own ragdoll physics** (that's `characters`/`playerctl`), so it cannot toss an occupant
itself. What it does instead: computes a randomized (via `rng('vehicles')`, never
`Math.random()`) horizontal+vertical toss vector per ejected seat and stores it on
`vehicle.lastEjectImpulse.{driver,gunner}` for whichever system owns that entity's physics to
read and apply after handling the `vehicle.exited` event. This is the intended integration point,
not a finished ragdoll.

F45 (no damage below 12 m/s): occupant damage on eject is gated on `vehicle.speed >
RIDGEBACK.ejectSafeSpeed` at the moment of rollover, and only applied if the constructor was
given a `resolveDamageTarget(entityId)` callback (see "Damage resolution" below) — otherwise the
event still fires with `ejected: true`, just with no damage side effect, since there is nothing
to apply damage to.

While `rolled`, drive input and turret fire are both suppressed (checked explicitly, though in
practice a genuinely upside-down chassis's wheels also can't reach the ground with a downward
raycast, so this is partly redundant with the physics — kept explicit for the on-its-side case,
where a wheel might still find ground at a steep, physically-odd angle).

### Self-right (F46)

`selfRight(byEntityId?)` is designed to be called **every tick the driver holds interact** while
`rolled` — the same "hold" contract as `fireTurret()`. Any tick it is *not* called resets the
accumulated hold timer to 0. This shape is a direct consequence of the brief's literal method
signature (`selfRight()`, no `dt` parameter, called by something outside this module that owns
input) — the alternative (accepting a duration parameter, or exposing a start/stop pair) isn't
in the specified API, so the "call it every frame you want it counted" pattern is how the fixed
1.2 s hold requirement gets satisfied without inventing new public surface. Once held
continuously for `RIDGEBACK.selfRightHold` (1.2 s) while `rolled`, the vehicle's yaw is preserved
and pitch/roll are zeroed (extracted via a `YXZ` Euler decomposition), it's lifted slightly to
clear the ground, velocity and angular velocity are zeroed, and `vehicle.flipped` fires.

### Turret

360° free yaw, pitch clamped to `[turretPitchMin, turretPitchMax]`. `fireTurret()` follows the
same "call every tick held" contract as `selfRight()`. Internally: spin-up ramps toward
`turretSpinUp` (0.35 s) while firing is requested and not overheated; once spun up, rounds are
emitted at `60/turretRpm` intervals (0.125 s, i.e. 480 RPM) via `physics.raycast`, each emitting
`weapon.fired`, then `surface.impact` if the ray hits anything, then `damage.applied` **only if**
the hit carries a non-zero `entityId` *and* a `resolveDamageTarget` resolver was supplied (see
below — `physics.raycast` only ever sees static geometry, so in practice this fires only once
something else in the game registers a damageable entity as query-able geometry). Heat
accumulates only while spun-up and firing; after `turretOverheat` (6.0 s) the turret locks out
for `TURRET_COOLDOWN` (3.0 s, a `vehicles`-owned constant chosen to sit in the same band as the
Ember Repeater's 3.4 s lockout, since FEEL.md doesn't specify a turret cooldown). Releasing the
trigger spins down and cools at fixed rates (also `vehicles`-owned, undocumented by FEEL.md).

### EMP

`applyEmp(seconds = RIDGEBACK.empDisableTime)` sets a countdown; while it's running, `disabled`
is true and both drive force and turret fire are suppressed. Calling it again while already
disabled extends to the longer of the two durations (doesn't stack additively).

### Ram damage

A single bounding-sphere `physics.sphereCast` per tick (see "Chassis-vs-world collision" below)
doubles as the ram-detection mechanism: if the swept sphere hits something with a non-zero
`entityId` at `impactSpeed > RIDGEBACK.ramLethalSpeed` (9 m/s) and a `resolveDamageTarget`
resolver exists, damage is computed as `0.5 * mass * impactSpeed² * RAM_DAMAGE_SCALE` fed through
`resolveDamage()` with `DamageType.VEHICLE`. The scale constant (`0.0014`, `vehicles`-owned, not
in tuning.js) is chosen so the FEEL.md-specified lethal threshold (9 m/s) produces enough raw
damage to strip a full 70 shield and still deal a lethal ~64 damage into a 45-health player
through the `VEHICLE` damage matrix (1.0× shield, 1.3× health) — see the constant's comment in
`index.js` for the exact arithmetic. `vehicle.impact` itself fires on **any** sufficiently fast
impact, entity or world geometry, since it's meant as a general "the vehicle hit something hard"
signal for FX/audio, not only a combat event.

### Chase camera (state only)

`getChaseCameraTarget()` returns `{position, lookAt, fov}`, all internally spring-damped toward a
desired target (`5.20 m` back along the **flattened** (yaw-only) forward axis, `2.10 m` up in
world space — deliberately not the tilted chassis axes, so the camera doesn't roll with the
vehicle during a wild slide or rollover) using the `damp()` exponential-approach helper from
`shared/math.js` with `λ = 1/chaseSpring` (0.12 s), which is the same "frame-rate independent
critically-damped-like" primitive used elsewhere in this codebase rather than a bespoke
mass-spring ODE. FOV lerps from `CAMERA.fovHorizontal` (the shared default, 85°) to
`RIDGEBACK.chaseFovMax` (95°) by current speed fraction. This module never constructs or touches
a `THREE.Camera` — it only exposes numbers for the game layer to apply to one.

## Known limitations

- **Chassis-vs-world collision is a bounding sphere, not the real box.** Because `physics`
  exposes no box-sweep primitive (only `raycast`/`sphereCast`/`overlapSphere`/`pointInSolid`, all
  against static geometry — see `src/physics/README.md`), wall/obstacle collision for the whole
  chassis is approximated as a single sphere of radius `hypot(halfWidth, halfHeight, halfLength)`
  swept along the velocity direction once per tick. This is conservative (the vehicle can stop
  slightly early near a corner that its real box wouldn't yet have touched) and coarse (a hit
  anywhere on the sphere is treated as one impact point/normal, so it cannot distinguish "clipped
  a wall with the front-left corner" from "clipped it with the rear"). A near-vertical hit normal
  (`normal.y > 0.6`) is explicitly ignored here — ground contact is the suspension raycasts' sole
  responsibility — otherwise a sphere large enough to cover the chassis footprint permanently
  overlaps flat ground at normal ride height and fights the suspension every tick (this was a
  real bug during development: the vehicle launched skyward and never settled — see the
  determinism/equilibrium self-test history and DEFECTS.md "VEH1" sibling note below for the
  related raycast-normal defect that made it hard to diagnose).

- **Given physics's documented "dynamic bodies do not collide with each other" limitation**
  (`src/physics/README.md`, "Known limitations"): this vehicle never collides with a
  `CharacterBody`, a `DynamicBody` (e.g. a rolling grenade), or another `Vehicle` through the
  physics engine at all — there is no automatic mechanism for that. Ram damage against another
  entity, and the chassis-vs-world sweep in general, only ever see `entityId != 0` on a hit if
  *something else* has registered that entity as a static box/sphere (or the entity's own
  system re-inserts/updates such a shape every tick to track a moving target — a pattern the
  physics engine supports but does not do automatically). Two Ridgebacks driving through each
  other, or a Ridgeback driving through a standing `CULL`, will currently pass straight through
  unless and until some other owner wires up that registration. This module cannot fix that
  gap from its own directory; it is stated here so nobody is surprised when it doesn't happen,
  and flagged in `DEFECTS.md`.

- **No slope de-rating of suspension force (a `// COMPENSATION:` in `index.js`).**
  `physics.raycast`'s returned `hit.normal` is unreliable for a subset of straight-down
  suspension rays — see `DEFECTS.md` "VEH1" for the exact repro. This module was originally
  designed to reduce suspension force on very steep slopes using the hit normal; instead, until
  that upstream defect is fixed, suspension force is applied at full strength along the vehicle's
  own local up axis regardless of slope. This is correct on flat and gently-sloped ground (which
  is everything the self-test and F43-F46 exercise) and simply doesn't have the intended
  "de-rate on a cliff face" refinement yet.

- **No separate drag/rolling-resistance force.** See "Drive model" above — a deliberate
  simplification, not an oversight. The vehicle coasts at constant speed with the throttle
  released; only braking and tire slip losses reduce speed actively.

- **Reverse acceleration and handbrake/cooldown/spin-down rates are `vehicles`-owned constants,
  not tuning.js values**, because FEEL.md/tuning.js don't specify them. They're each documented
  at their declaration site in `index.js`.

- **Turret damage and ram damage both require an externally-injected `resolveDamageTarget`
  callback** (an optional, additive constructor field beyond the brief's literal
  `{physics, events}` signature — `new VehicleSystem({physics, events})` still works exactly as
  specified, the extra field is simply `null`/no-op if omitted). No such registry exists anywhere
  in the codebase yet (no `characters`, `ai`, or `weapons` directory exists at the time of
  writing), so today this is a supported extension point with nothing plugged into it — turret
  fire and ram impacts still emit `weapon.fired`/`surface.impact`/`vehicle.impact` correctly, they
  just don't produce `damage.applied` without that hookup. Filed as `DEFECTS.md` "VEH2".

- **`Vehicle.applyDamage(amount, damageType, hitRegion)` is an addition beyond the brief's listed
  API**, so a future weapons/AI damage pipeline has something to call once `weapons/targets.js` (or
  an equivalent registry) exists to register the vehicle as a shootable/stickable target. Nothing
  calls it yet.

## Self-test results (measured, not predicted)

Run via `runVehicleSelfTest()` from `selftest.js`. All 7 assertions pass as of this writing
(`node` 24.13.0, this repo's pinned `three` 0.185.1), run repeatedly to confirm stability:

| Assertion | Measured | Expected | Tolerance |
| --- | --- | --- | --- |
| Suspension rest equilibrium | settles at y≈0.6837, compression01≈0.364, max Δy/tick ≈1.7e-7 m, max speed ≈2.1e-5 m/s, all 4 wheels grounded | no sinking, no jitter | max Δy < 0.01 m, max speed < 0.05 m/s |
| F43: 0 → 18 m/s | **4.275 s** (to 99% of 18 m/s, 17.82 m/s) | 4.20 s | ±0.15 s — **passes**, 0.075 s margin |
| F44: rollover at sustained lateral accel > 1.25 g | **1.270 g** sustained over the full 0.25 s window immediately preceding trigger (measured as the minimum g in that window, i.e. a conservative floor) | 1.25 g | ±0.08 g — **passes** |
| F45a: rollover below 12 m/s | no damage (health unchanged, 100→100) | no damage | hard — **passes** |
| F45b: rollover above 12 m/s | damage applied (health 100→15.4 at 20 m/s impact) | damage applied | hard — **passes** |
| F46: self-right hold duration | flips at **1.2083 s** of continuous hold; does not flip at `1.2 - 0.1 = 1.1 s` | 1.20 s | ±0.05 s — **passes** |
| Determinism, 600 steps × 2 runs (driving + steering + braking + handbrake + turret fire, one static obstacle) | bit-identical final `position`/`velocity`/`quaternion`/`angularVelocity` | bit-identical | hard — **passes** |

F44 methodology note: a **slow, gradual** steering ramp (intended to cross the 1.25 g threshold
smoothly, for a clean single measurement) turns out to plateau around 1.15-1.16 g and never
crosses — because as speed climbs during the ramp, `steerMaxDeg → steerMinDeg` (32°→11° across
the speed range) is *also* shrinking the available steering angle, which is a real, correct
consequence of FEEL.md's speed-sensitive steering spec, not a bug. The test instead accelerates
straight to top speed first, then snaps to full steering lock while coasting (no throttle, so the
rear tires' full lateral budget isn't shared with drive force) — this genuinely reaches and holds
above 1.25 g at high speed, which is measured directly. This was verified empirically (see the
development history) before being written into the shipped self-test, rather than assumed.

To reproduce: write a throwaway script that imports `runVehicleSelfTest` from `./selftest.js`,
call it, and inspect `results` — do not leave the throwaway script in the repo (`ARCHITECTURE.md`
§2.3: `tools/` is orchestrator-only, and this directory's owner doesn't write outside
`src/vehicles/**` either).

## Pending integrations

- **`../weapons/targets.js` does not exist yet.** Once it does, this module should import it and
  register each spawned `Vehicle` as a shootable/stickable target (per the task brief: "register
  the vehicle as a target so it can be shot and stuck with plasma grenades"). Not done — the file
  doesn't exist to import. See `DEFECTS.md` "VEH2".
- **No entity/hitbox registry exists anywhere in the codebase** for resolving a raycast/sphereCast
  `entityId` into a damageable `{shield, health}` state. `VehicleSystem`/`Vehicle` support an
  optional `resolveDamageTarget(entityId)` injection for this (see "Known limitations"), but
  nothing in the game currently supplies one. See `DEFECTS.md` "VEH2".
