# src/weapons — API, decisions, limitations

Owner: `sandbox`. Layer **L5**. Imports: `three`, `../shared/*`, `../core/*`, `../physics/*`.
Never `../render`, `../world`, `../ui`, `../fx`, `../ai`, `../game`, `../player`.

Headless: no DOM, no renderer, no wall clock, no `Math.random` (all randomness comes from
`rng('weapons.spread')` and `rng('weapons.pellets')`).

| File | Contents |
| --- | --- |
| `defs.js` | The weapon table — `FEEL.md` §4.2 / §4.4 as data. This *is* the canonical source; `shared/tuning.js` deliberately carries no weapon stats. |
| `targets.js` | `TargetRegistry` — the seam between weapons and anything shootable. |
| `index.js` | `WeaponSystem` — inventory, firing, ballistics, aim assist, grenades, melee. |
| `selftest.js` | `runSandboxSelfTest(deps)` — measures `FEEL.md` F18–F42, F50, and (injected) F01–F17 / F51–F53. |

## Integration contract (the game layer, L6, wires this)

```js
physics.step(dt);                                   // 1. integrates grenade bodies
player.update(dt, input);                           // 2.
weapons.update(dt, input, player);                  // 3. reads eyePosition / yaw / pitch
player.lookScale = weapons.getLookScale();          // 4. aim-assist turn friction
if (weapons.consumeLunge(v)) player.addDisplacement(v.x, v.y, v.z);   // 5. melee lunge pull
camera.yaw = player.yaw + weapons.recoilYaw;        // 6. recoil is exposed, not applied
camera.pitch = player.pitch + weapons.recoilPitch;
```

`physics.step(dt)` **must** run before `weapons.update(dt, …)`: the grenade fuse, entity-stick
test and stuck-body follow-transform all read positions the physics step just wrote.

`update()` is the only per-tick entry point. Everything else — `requestSwap`, `reload`,
`toggleScope`, `melee`, `throwGrenade`, `addGrenade`, `dropAll`, `dropActive`, `pickup` — is a
public action the game layer or the input path may call directly.

### Target registry

Anything shootable registers itself. `src/ai`, `src/vehicles` and the player all go through here,
which is what lets `src/weapons` stay free of sideways L5 imports.

```js
targets.registerTarget({
  entityId, faction, archetype,
  state,          // live { shield, maxShield, health, maxHealth, dead } — written in place
  getCapsule,     // () => { position: Vector3 (feet), radius, height, headHeight? }
  getForward,     // () => Vector3
  onDamage,       // optional (res, info) => void
});
targets.unregisterTarget(entityId);
```

**`getCapsule()` and `getForward()` must return the same object every call, mutated in place.**
They are read every tick for every registered entity; returning a fresh object would allocate in
the per-step path.

`state` is written directly by the damage resolver, then the events are emitted. The owner reads
its own object back — there is no separate "apply damage" callback to implement.

### `getAimState()`

```js
{ hot, coneDeg, magnetismDeg, target, distance, angleDeg, rangeFactor, hitboxScale }
```

`hot` is the red-reticle state (`FEEL.md` §4.8: reticle turns red and thickens by 12%, see
`AIM_ASSIST.reticleThicken`). `magnetismDeg` is the bend the *current* aim would receive.

## Decisions that carry a measurement

**Bursts anchor on the scheduled time, not the tick they were noticed.** Anchoring a burst on
`_time` re-quantises every burst against the 120 Hz grid and the error compounds: a 4-burst
`Vector BR` kill measured **1.3417 s** instead of 1.3250 s. Anchoring on the scheduled
`_nextFireTime` (and advancing it by `refire` rather than from `now`) removes the drift.
`FEEL.md` F19 target is 1.32 s.

**Magnetism ramp.** `ramp = clamp01((angle/cone − 0.6) / 0.4)`, `bend = min(3.0°, angle) · ramp ·
rangeFactor`. Two properties fall out and both are asserted: a dead-centre shot bends by exactly
**0** (F40 — `angle = 0` gives `ramp = 0` *and* `min(3, 0) = 0`, two independent reasons), and a
cone-edge shot bends by exactly **3.0°** (F39, measured 3.00000 over a 5000-sample sweep). The
`min(3.0°, angle)` cap is what stops magnetism from ever overshooting the target into an
auto-aim snap, which `FEEL.md` §4.8 explicitly forbids.

**Hitbox inflation is measured functionally, not read back from a constant.** At 60 m the cone is
floored at 1.2°, so the zero-ramp bracket reaches 0.72° ⇒ 0.754 m of lateral reach, comfortably
past `1.15 × 0.46 = 0.529 m`. Inside that bracket the ray is *provably unbent* (the self-test
asserts `magnetismDeg === 0` at both bisection endpoints), so the only thing that can extend a hit
is the inflation. Bisecting the hit/miss boundary measures **1.15000**.

Note the hit/miss boundary is **not monotonic** in aim error over the whole cone: past 0.72° the
ramp turns on and magnetism pulls wide shots back onto the target, so there is a second hit region
near the cone edge. Any future test of this must stay inside the zero-ramp bracket.

**Melee emits `melee.landed` before the damage chain**, so a consumer sees
`melee.landed → damage.applied → entity.killed` in causal order.

**Grenade fuse and charge comparisons carry 1e-9 slack.** 360 repeated subtractions of `1/120`
leave ~1e-15 on the clock, which otherwise costs a whole extra tick (frag fuse measured 3.0083 s
instead of 3.0000 s); `_charge` accumulated over 144 ticks lands on `1.1999999999999997` as often
as `1.2000000000000002`, which silently turned a charged EMP bolt into an uncharged plasma shot.

## Limitations, stated plainly

- **Ballistics are hitscan.** Only the charged `Vess Sidearm` EMP bolt is a real projectile
  (`projectileSpeed`, stepped as a segment cast per tick). Everything else resolves instantly, so
  there is no bullet drop and no lead required at any range.
- **Target hit tests are against a vertical capsule plus a height-banded head zone.** A hit is
  `HEAD` if its `y` is within `capsule.headHeight` (default 0.30 m) of the capsule top, `TORSO`
  otherwise. **`LIMB` is never produced**, so `REGION_MULT[LIMB]` (0.85) is currently dead — real
  per-limb hitboxes are `src/characters`' geometry to define and this module's to consume.
  `WEAKPOINT` likewise: the `SKIRN` dorsal tank and `WARDEN` back plate are not modelled here,
  because the registry has no sub-collider concept yet. Both are extension points, not oversights.
- **`CULL` barrier, `WARDEN` front plates and enemy shield-shell logic are not implemented here.**
  Those are per-archetype modifiers (`FEEL.md` §6, F48) and belong to whoever owns `src/ai`; this
  module resolves through `shared/damage.js` with a per-weapon head multiplier and nothing else.
  A registry entry can intercept via `onDamage`, but the damage is already applied by then — if
  directional mitigation is wanted, the registry needs a pre-resolve hook.
- **Line of sight is not checked when selecting an aim-assist target.** The cone search is purely
  angular; a target behind a wall can turn the reticle red. The *shot* is still correct (the
  trace takes the nearest of the world raycast and the target capsules, so the wall wins), but the
  HUD would lie. Add a `physics.raycast` gate on the winning candidate if that matters.
- **Aim-assist inflation applies only to the single winning cone target**, not to every entity in
  the cone.
- **Grenade blast distance is measured to the target's centre of mass**, not to the nearest point
  on its capsule. A prone or crouched target is treated identically to a standing one, and there
  is no line-of-sight/cover test on the blast — a grenade around a corner still damages through
  the wall.
- **Plasma sticking to entities is an overlap test per tick, not a swept test.** At 19 m/s a
  grenade moves 0.158 m per tick against a ≥ 0.545 m capture radius, so it cannot tunnel a
  standing target — but a very small target (radius under ~0.08 m) could be missed.
- **Stuck grenades follow the target by a frozen world-space offset from the capsule's feet.**
  They translate with the target but do not rotate with it.
- **Weapon pickup does not model world pickup entities.** `dropAll` / `dropActive` emit
  `weapon.dropped` with the remaining ammo and position; spawning the pickable object and calling
  `pickup(id, ammo, reserve)` is the game layer's job.
- **The `Breaker` reloads one shell per cycle and re-arms itself** until full or out of reserve;
  the reload cannot currently be interrupted by firing, only by melee or a swap.
- **`update()` allocates nothing**, but `throwGrenade` and the charged bolt do (one grenade record
  + one `DynamicBody`, one projectile record). Those are per-action, not per-tick.

## Measured self-test results

`runSandboxSelfTest({ runPlayerSelfTest })`, Node 24, `three` 0.185.1, 120 Hz.
**44 of 46 pass.** Two runs in-process produce byte-identical results.

| ID | Measured | Target | Tol | |
| --- | --- | --- | --- | --- |
| F18 | 4 bursts (body-only needs 15 rounds ⇒ burst 5) | 4 | exact | pass |
| F19 | 1.32500 s | 1.32 | ±0.04 | pass |
| F20 | round 9 | 9 | exact | pass |
| F21 | 2.30000 s (23 rounds × 0.100) | 2.30 | ±0.08 | pass |
| F22 | 8 rounds | 8 | exact | pass |
| F23 | **2.80000 s** (21 rounds × 0.1333) | 2.93 | ±0.10 | **FAIL — `CONTRADICTION.md` §C1** |
| F24 | strip 1.0667 (plasma) < 1.4000 (kinetic); finish 0.9000 (kinetic) < 1.7333 (plasma) | — | hard | pass |
| F25 | 1 bolt, `EMP`, shield 70→0, health 45→45 | — | hard | pass |
| F26 | 2.19167 s | 2.17 | ±0.12 | pass |
| F27 | 2 hits | 2 | exact | pass |
| F28 | 1 hit, `fromBehind = true` | 1 | hard | pass |
| F29 | 2.10000 m | 2.10 | ±0.05 | pass |
| F30 | 0.70000 s | 0.70 | ±0.02 | pass |
| F31 | 3.00000 s | 3.00 | ±0.02 | pass |
| F32 | 0.42000 (combined bounce 0.17640 ÷ surface 0.42) | 0.42 | ±0.03 | pass, see `DEFECTS.md` SANDBOX3 |
| F33 | not killed — shield 0, health 22.000 | alive | hard | pass |
| F34 | **2.23199 m** | 2.70 | ±0.10 | **FAIL — `CONTRADICTION.md` §C2** |
| F35 | stuck, killed | — | hard | pass |
| F36 | 0.16225 m | 0.170 | ±0.02 | pass |
| F37 | 4 / 4, capped at 4 after a +5 top-up, 4 throwable | 4/4 | exact | pass |
| F38 | 5.00000° | 5.0 | ±0.2 | pass |
| F39 | 3.00000° (peak at 5.000° aim error) | 3.0 | ±0.15 | pass |
| F40 | 0 exactly | 0 | hard | pass |
| F41 | 1.15000 | 1.15 | ±0.01 | pass |
| F42 | scoped → damage → descoped, `scope.descoped` emitted | — | hard | pass |
| F50 | grenade 9.307479224376696 ≡ player 9.307479224376696, `GRAVITY` 9.3074792243767 | exact | exact | pass |

F50 covers the player controller and `DynamicBody` grenades only — vehicles and ragdolls are
outside both owned directories. Neither module applies a per-object gravity scalar; both read the
single `GRAVITY` constant from `shared/tuning.js`.

The two failures are `FEEL.md` arithmetic errors, not implementation defects; both carry a full
derivation, options and a recommendation in `CONTRADICTION.md`, and neither tolerance was
loosened.

To reproduce: write a throwaway script that imports `runSandboxSelfTest` from `./selftest.js` and
`runPlayerSelfTest` from `../player/selftest.js`, call
`runSandboxSelfTest({ runPlayerSelfTest })`, inspect `results` — and delete the script.
