# src/player — API, decisions, limitations

Owner: `playerctl`. Layer **L5**. Imports: `three`, `../shared/*`, `../core/*`, `../physics/*`.
Never `../render`, `../world`, `../ui`, `../fx`, `../ai`, `../game`, `../weapons`.

Headless by construction — no DOM, no renderer, no wall clock, no `Math.random`. `dt` is always
supplied by the caller.

| File | Contents |
| --- | --- |
| `index.js` | `PlayerController` — capsule locomotion, camera state, shields/health, fall damage. |
| `selftest.js` | `runPlayerSelfTest()` — measures `FEEL.md` F01–F17, F51–F53 and the player half of F50. |

## API

```js
const player = new PlayerController({ physics, position, entityId, bus, faction });
player.update(dt, input);            // input = core/input.js InputState (or a duck-typed subset)
```

**Camera state — plain numbers. This class owns no `THREE.Camera`; the game layer applies these.**

| Field | Meaning |
| --- | --- |
| `eyePosition` | `Vector3`, world space. Includes the landing dip, excludes bob and sway. |
| `yaw`, `pitch` | radians. `yaw` 0 looks down −Z; `pitch` is clamped to ±89°. |
| `bobOffset` | `{x, y}` metres — lateral / vertical view bob, scaled by speed. |
| `swayOffset` | `{x, y}` **degrees** — critically-damped look-lag, clamped to `CAMERA.swayMaxDeg`. |
| `landingDip` | metres, negative. Already folded into `eyePosition`. |
| `eyeHeight` | current eye height (interpolates 1.62 → 1.05 through a crouch). |
| `grounded`, `crouched`, `speed`, `velocity`, `state` | live locomotion / damage state. |

Other members: `applyDamage(amount, damageType, hitRegion, sourceId, weaponId, headMult, point, normal)`,
`addDisplacement(x, y, z)` (one-shot external push — this is how a melee lunge pull is applied),
`respawn(position)`, `dispose()`, `getCapsule()` / `getForward()` (the shape
`src/weapons/targets.js` registers), and `lookScale` (set it to `WeaponSystem.getLookScale()` each
tick for aim-assist turn friction — `src/player` must not import `src/weapons`).

## Decisions that carry a measurement

**Trapezoidal vertical integration, not Euler.** `dy = ½(v₀ + v₁)·dt`, exact for constant
acceleration. At 120 Hz semi-implicit Euler measures an apex of **1.0316 m** and explicit Euler
**1.0684 m** against `FEEL.md`'s 1.05 ± 0.02 — both inside tolerance but both wrong, and both
drift with the tick rate. Trapezoidal measures **1.05000 m / 0.95000 s**, dead on, with the tick
rate cancelling out of the arithmetic entirely.

**`this.body.grounded = false` on the launch tick.** `CharacterBody.move()` ground-snaps whenever
it was grounded on the *previous* tick (`src/physics/README.md`, "Ground snap"). Without clearing
the flag the snap yanks the capsule back down on the very tick it launches: measured apex
**0.001 m**, airtime **0.017 s**. This was a real bug found by the self-test, not a hypothetical.

**A 0.02 m downward ground probe after `move()`.** `CharacterBody` only reports `grounded` once
the capsule actually *penetrates*, so a fall that lands exactly on the surface plane is missed for
one tick and the measured airtime becomes 0.958 s instead of 0.950 s. The probe registers
touchdown on the exact tick the feet arrive. It only runs when `velocity.y <= 0`, so it can never
cut a jump short.

**Elliptical speed limit, not a normalise-and-scale.** The desired velocity is capped on an
ellipse with semi-axes 3.96 (strafe) and 4.40 / 3.96 (forward / back), so pure forward is
4.40 m/s, pure strafe is exactly 90% of it, and a diagonal gets no speed bonus.

**Crouched capsule height is derived, not invented**: `1.85 − (1.62 − 1.05) = 1.28 m`, i.e. the
head keeps the same clearance above the eye as when standing. Standing up is gated on
`CharacterBody.canStand(radius, height)`.

## Limitations, stated plainly

- **Look input is applied unfiltered and unclamped per tick.** `FEEL.md` §2.2 forbids acceleration
  and smoothing, so there is none — but that also means a single enormous `lookYaw` from a
  hitched frame rotates the player by that whole amount. The fixed 120 Hz step bounds this in
  practice; it is not separately guarded.
- **Sway and bob are exposed, not applied.** `bobOffset` is in metres and `swayOffset` in degrees;
  the game layer decides how much of each goes to the camera versus the view model. `FEEL.md`
  §2.2 wants camera translation under 1 cm while the lateral bob is 1.4 cm, so the two cannot both
  go to the camera — that split is deliberately not decided here.
- **No air friction.** With no movement input in the air, horizontal velocity is held exactly.
  That is what makes air control "redirect, never add"; it also means there is no drag on a long
  fall.
- **The landing-recovery penalty scales the *desired* speed, not the current velocity.** A player
  who lands hard at full speed decelerates into the −35% cap at the normal 42 m/s² rather than
  being clamped instantly.
- **`addDisplacement()` bypasses velocity.** A melee lunge pull moves the capsule through
  `CharacterBody.move()` (so it still collides) but leaves `velocity` untouched, so it does not
  feed into the air-speed cap or the footstep cadence.
- **One `physics.sphereCast` per airborne tick** for the ground probe. Negligible, but it is a
  world query in the per-step path and it is the only one this module makes.
- **Fall-damage impact speed is read after the tick's gravity update**, so it is quantised to
  `GRAVITY × dt` = 0.0776 m/s. The measured threshold is 8.493 m/s against `FEEL.md`'s 8.5 ± 0.2.

## Measured self-test results

`runPlayerSelfTest()`, Node 24, `three` 0.185.1, 120 Hz. **All 20 assertions pass.**

| ID | Measured | Target | Tolerance |
| --- | --- | --- | --- |
| F01 | 75.000 ms | 67.7 ms | ≤ 80 ms |
| F02 | 4.40000 m/s | 4.40 | ±0.02 |
| F03 | 0.90000 | 0.90 | ±0.01 |
| F04 | 0.90000 | 0.90 | ±0.01 |
| F05 | 1.90000 m/s | 1.90 | ±0.02 |
| F06 | 125.000 ms | 122 ms | ≤ 140 ms |
| F07 | 1.05000 m | 1.05 | ±0.02 |
| F08 | 0.95000 s | 0.950 | ±0.020 |
| F09 | 0.30000 | 0.30 | ±0.02 |
| F10 | 4.33038 m/s peak airborne | ≤ 4.40 | hard |
| F11 | 4.40000 m/s with `sprint` forced true; no `sprint` field on `InputState` | — | hard |
| F12 | 4.01667 s | 4.00 | ±0.05 |
| F13 | 2.49167 s | 2.50 | ±0.05 |
| F14 | 4.01667 s after the interrupting hit | 4.00 | hard |
| F15 | health flat at 0 through the whole shield recharge | — | hard |
| F16 | 8.00000 s | 8.00 | ±0.10 |
| F17 | 4.99167 s | 5.00 | ±0.10 |
| F51 | 8.49307 m/s | 8.5 | ±0.2 |
| F52 | 91.667 ms | 90 ms | ±10 ms |
| F53 | 116.667 ms | 120 ms | ±10 ms |

Player gravity measured directly from the free-flight velocity delta: **9.307479224376696**,
bit-identical to the grenade's (see `src/weapons/README.md`) and within 4 × 10⁻¹⁵ of the
`GRAVITY` constant. `8h/t²` from the measured arc agrees.

To reproduce: write a throwaway script that imports `runPlayerSelfTest` from `./selftest.js`, call
it, inspect `results` — and delete the script (`tools/` is the orchestrator's).
