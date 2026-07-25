# src/ai — behaviour model, steering, determinism

Owner: `ai` (ARCHITECTURE.md §2.2). Layer **L5**.

**Headless by construction.** Nothing in this directory imports `src/render`,
`src/characters`, `src/world`, `src/ui`, `src/fx` or `src/game`, and nothing
here builds a mesh. What this module produces is **transforms and state**
(`position`, `yaw`, `aimYaw`, `aimPitch`, `animState`, `speed01`, `barrierYaw`,
…). The game layer binds those to a character rig. `runAiSelfTest()` runs the
whole thing under plain `node` with no renderer, no DOM and no canvas.

Permitted imports, and the complete set actually used:

```
three
../shared/{tuning,enums,events,damage,math}.js
../core/{rng,ids,events}.js
../physics/index.js
```

`../weapons/targets.js` is **injected, not imported** — see *Integration
contract* below.

## Files

| File | Contents |
| --- | --- |
| `index.js` | `AiDirector` — spawn/despawn, squads, the deferred panic cascade, squad alert propagation, `damage.applied` plumbing. |
| `agent.js` | `AiAgent` — perception, state machine, movement, aiming, weapons, two-layer health. |
| `constants.js` | AI-local constants + `AiState` / `AnimState` / `ARCHETYPE_AI`. |
| `accuracy.js` | Hit probability, burst-pattern miss distribution, shot deviation. |
| `steering.js` | Whisker obstacle avoidance and squad separation. |
| `cover.js` | Raycast sampling of the level for cover points. |
| `selftest.js` | `runAiSelfTest()`. |

## Constants

Every number that exists in `src/shared/tuning.js` is **imported**, never
re-declared — `ENEMY.*`, `AI.*`, `PLAYER.*`, `MELEE.*`, `GRENADE.plasma.*`,
`GRAVITY`, `TERMINAL_VELOCITY`, `SIM_DT`. `constants.js` holds only the
behaviour-shaping numbers `tuning.js` does not carry (AI fire cadence, turn
rates, cover sampling density, avoidance lookahead). None of those is a
`FEEL.md` §8 graded assertion; if one ever becomes graded it must be promoted
into `tuning.js` by the orchestrator — filed as **DEFECTS.md AI1**.

## Perception

Per agent, per tick, in this order:

1. **Sight.** `AI.sightRange` 90 m, `AI.fovDeg` 130° measured against the
   **body yaw** in the horizontal plane, then a single `physics.raycast` from
   the agent's eye (`height × 0.88`) to the target's chest (`height × 0.62`).
   Once an agent is `alerted` the FOV gate is dropped — it has been told where
   to look, so it is allowed to turn onto a target that is behind it.
2. **Hearing.** `AI.hearingRadius` 35 m, but only for a target moving faster
   than `HEARING_SPEED_THRESHOLD` (1.0 m/s). A stationary player is silent.
   Hearing produces a `lastKnown` position and a `SEEK`, never a shot.
3. **Squad propagation.** `AiDirector.alert()` walks the squad's stable member
   array and wakes every living, un-alerted member within
   `AI.squadAlertRadius` (28 m). Propagated members get `cause: 'squad'`.

`ai.alerted` fires on acquisition (`cause`: `'sight' | 'hearing' | 'damage' |
'squad'`). After `LOSE_TARGET_TIME` (3.0 s) of unbroken no-sight, `ai.lostTarget`
fires with the last known position and the agent drops to `SEEK` for
`SEEK_TIME` (8.0 s), then `IDLE`.

An agent can receive `ai.alerted` twice — once as `'squad'`, later as `'sight'`
when it acquires for itself. That is intentional; consumers should treat the
event as edge-triggered per `cause`, not as a latch.

## State machine

```
IDLE ──sight/hearing──► ENGAGE ──lost 3.0 s──► SEEK ──8.0 s──► IDLE
  └──squad alert──► SEEK                         ▲
ENGAGE ◄──► COVER   (reload only; WARDEN never)  │
ENGAGE/anything ──leader dies──► FREEZE ─0.8s─► PANIC ─6.0s─► ROUT ─12.0s─► ENGAGE*
                                                          (* only if a VANE still lives)
```

`agent.state` is one of `IDLE ALERT ENGAGE SEEK COVER FREEZE PANIC ROUT DEAD`.
`agent.animState` is one of `idle walk run stagger dead panic`, which is the
complete set the rig has to handle.

### The SKIRN panic cascade — FEEL.md §6 / F47

This is the signature behaviour, so the timeline is explicit and every edge is
an event:

| t (s from `ai.leaderKilled`) | What happens |
| --- | --- |
| 0.0 | Leader VANE dies → `entity.killed`, then (deferred to the next `update()`) `ai.leaderKilled {squadId, leaderId}`. Every SKIRN in the squad enters `FREEZE`, `animState = 'stagger'`, velocity zeroed, `ai.vocalize {cue:'leaderDown'}`. |
| 0.8 (`ENEMY.SKIRN.panicFreeze`) | `ai.panic.start {entityId, squadId}`, state `PANIC`, `animState = 'panic'`, `ai.vocalize {cue:'panic'}`. Flees directly away from `lastKnown` at `ENEMY.SKIRN.panicSpeed` (4.6 m/s). **Does not aim and does not fire** — `aimYaw` follows the run direction, `aimPitch` goes to 0. |
| 6.8 (`+ panicDuration`) | `ai.panic.end`, state `ROUT`. Still broken, still not shooting, retreating at 0.75× walk. |
| 12.0 (`ENEMY.SKIRN.rallyTime`) | If any VANE in the squad is still alive → `ENGAGE`, fresh reaction latency, fresh 0.5 s miss grace, `ai.vocalize {cue:'rally'}`. Otherwise it stays routed and re-checks every `rallyTime`. |

A SKIRN that never perceived anything still runs — the director seeds its
`lastKnown` with the position where the leader fell.

The cascade is **deferred to the top of the next `update()`** rather than run
inside the damage handler. `ARCHITECTURE.md` §4 caps handler re-entrancy at 2
levels; emitting `ai.leaderKilled` → `ai.panic.start` from inside a
`damage.applied` handler would nest 3 deep and throw. Deferring also makes the
ordering independent of who called `applyDamage`.

### Per-archetype

- **SKIRN** — closes to ~13 m, light strafe, 4-round bursts. Owns the cascade
  above. A `WEAKPOINT` kill detonates the dorsal methane tank:
  `explosion.occurred` at 45 `EXPLOSIVE` over 2.2 m, applied to our own agents
  with linear falloff (anything else in radius is its own owner's problem).
- **CULL** — `strafeBias` 1.0 and a **continuous** lateral sidestep clock on
  `ENEMY.CULL.strafePeriod` (1.8 s). The clock is locomotion, not a combat
  sub-state: it keeps running through reloads and repositioning so the period
  is genuinely 1.8 s. `barrierYaw` tracks the **threat bearing**, recomputed
  from the live position every tick, at `BARRIER_TRACK_RATE` (6.0 rad/s) —
  never the movement heading.
- **VANE** — strafes at ~20 m; dodge-rolls (`dodgeCooldown` 2.6 s,
  `dodgeSpeed` 9.5 m/s, `dodgeDuration` 0.42 s) **only when hit while shields
  are down**; throws a plasma grenade on `grenadeCooldown` 9.0 s between 8 and
  26 m (`grenade.thrown`, 19.0 m/s at +4° — the module never simulates the
  grenade, the weapons owner does); melees inside `meleeRange` 2.4 m via
  `melee.swing` → `melee.landed` / `melee.whiffed`.
- **WARDEN** — `speed` 2.2 m/s, `strafeBias` 0, `standoffMin` 0,
  `neverTakesCover`. It closes to 9 m and plants. Front plates take
  ×`frontPlateMult` (0.35) `KINETIC` across the frontal hemisphere; the back
  is reached through `HitRegion.WEAKPOINT` (×3 via `REGION_MULT`).

## Two-layer health

`AiAgent.applyDamage()` is the single path. Order:

1. Resolve the **incoming bearing** — a unit vector from the agent toward the
   attacker — from, in priority order, `sourcePosition`, `normal`, `point`,
   then the current `lastKnown`, then the agent's own forward.
2. **CULL barrier** (F48): if unbroken and the bearing is inside
   `barrierArcDeg` (62°) of `barrierYaw`, multiply by `barrierKineticMult`
   (0.0) for `KINETIC` or `barrierPlasmaMult` (0.35) for `PLASMA`.
   `EXPLOSIVE` is untouched. The absorbed amount (`amount × (1 - mult)`) is
   subtracted from `barrierHealth`; at ≤ 0 the barrier breaks permanently.
3. **WARDEN plates**: `KINETIC`, non-`WEAKPOINT`, frontal hemisphere → ×0.35.
4. `resolveDamage()` **from `src/shared/damage.js`** — the two-layer split, the
   damage matrix and the shields-down head multiplier are *not* reimplemented
   here.
5. Emit `shield.broken` (with overkill), `health.changed`, and `entity.killed`.

Shield recharge (VANE only, F49): any damage resets `shieldDelayTimer` to
`ENEMY.VANE.shieldDelay` (4.0 s) and cancels an in-progress recharge. When the
delay expires → `shield.recharge.start`; the shield then fills at
`shield / shieldRechargeTime` = 90/3.0 = 30 /s → `shield.recharge.full`.

`applyDamage()` deliberately does **not** emit `damage.applied` — that event
belongs to `weapons`/`vehicles`/`game` per ARCHITECTURE.md §4.1, and emitting
it here would double-fire when the event path is used. The director subscribes
to `damage.applied` and uses `rawAmount ?? amount` as the pre-mitigation input.

## Accuracy model — FEEL.md §6

The decision is baked into the **fired direction**, not into a flag. A "miss"
is a ray that geometrically clears the target silhouette, so the weapons owner
just traces it and cannot accidentally re-roll the outcome.

```
rangeFactor = clamp(1.15 - d/AI.sightRange, 0.25, 1.0)
moveFactor  = clamp(1 - targetSpeed*0.06, 0.55, 1.0)
p           = clamp01(accuracy*rangeFactor*moveFactor + burstBias) * (1 - 0.10*roundIndex)
```

`burstBias` is drawn **once per burst** from `gaussian() * 0.22` clamped to
±0.45. That is the "burst-pattern miss distribution": a burst is good or bad as
a unit, so misses arrive in readable clusters instead of as uncorrelated
per-round coin flips.

Reaction latency is `rng('ai.reaction').range(...ENEMY[a].reaction)` — the
per-archetype bands span 0.35–1.10 s overall, exactly the FEEL.md figure.

**Guaranteed misses.** `AI.missGraceOnAcquire` (0.5 s) runs from the **first
round actually fired** after (re-)acquisition, not from acquisition itself. The
reaction latency already covers "hasn't noticed you yet"; this window covers
"is shooting at you and cannot hit yet", which is the part the player must be
able to see and respond to. Every shot inside it is forced to a miss.

Miss geometry: `err = targetAngularRadius × 1.35 + U(0, 2.6°)`, so a forced
miss clears the silhouette by at least 35 %. A hit jitters inside
`0.55 × targetAngularRadius`. The RNG roll is consumed on every shot whether
or not the grace suppresses it, so stream consumption is cadence-stable.

**No aim assist.** There is no magnetism, no hitbox inflation and no turn
friction anywhere in `src/ai` — those are player-only (FEEL.md §4.8).

## Movement, steering, and its honest limits

**There is no navmesh and there is no pathfinding. None.** Movement is:

1. A desired heading from the state machine (close to `preferredRange`, back
   off inside `standoffMin`, plus a lateral strafe term).
2. **Whisker avoidance** (`steering.js`): a `physics.sphereCast` straight ahead
   over `0.9 + speed × 0.45` m. If it is clear — the overwhelmingly common
   case — that is the only cast and the heading is used unchanged. If it is
   blocked, a 7-ray fan at 0, ±22°, ±45°, ±70° is cast and the best clearance
   wins, penalised for turning away from the desired heading.
3. **Squad separation** over the squad's stable member array within 1.6 m.
4. `CharacterBody.move()` for collide-and-slide, step-up and ground following.
   Gravity is the single `GRAVITY` constant; there is no per-agent scalar.

After the move, horizontal velocity is re-derived from the **achieved**
displacement, so grinding into a wall bleeds momentum instead of accumulating
it.

### What this cannot do — stated plainly

- **Concave geometry traps agents.** A U-shaped wall, a dead-end corridor, or
  a doorway that requires moving *away* from the target first will hold an
  agent against the obstruction indefinitely. The whisker fan only sees
  `0.9 + speed × 0.45` m ahead; it has no map and no memory of where it has
  been. This is the single largest limitation of the module.
- **Cover points are sampled, not planned.** `cover.js` fires a deterministic
  golden-angle spiral of `COVER_SAMPLE_COUNT` (384) candidates within 42 m of
  the **first agent's spawn position**, once, at first spawn. Each candidate
  costs one downward ray to find ground plus 8 horizontal rays at 1.05 m to
  look for a blocker within 1.35 m. A candidate is kept only if 1–7 of the 8
  probes hit (0 = open ground, 8 = stuck in a hole). Measured yield: **3**
  points on a sparse test level (6 pillars in 6400 m²), **132** on a dense
  pillar field, costing 1.2–6.1 ms one-time. Agents reach a chosen point with
  the same local steering, so **choosing a cover point is not the same as
  being able to get there.**
- **Sampling is anchored to one spawn point.** A level larger than ~42 m from
  the first spawn has no cover data outside that disc.
- **Agents never patrol or investigate on a timer.** An agent that never
  perceives anything stands where it was spawned, forever. Verified: in a
  dense pillar field that blocks all sight lines, five agents stayed `IDLE`
  for 30 s of simulation. That is correct for a stationed garrison and wrong
  for a level that expects wandering enemies; wandering is not implemented.
- **No agent-vs-agent collision.** `src/physics` collides characters against
  static geometry only (its README says so explicitly). Squad separation is a
  steering force, not a constraint — agents can and will overlap when pinned.
- **A bad spawn cannot be fixed here.** An agent spawned inside static
  geometry will be depenetrated by the capsule solver, possibly downward
  through a floor. `agent.spawnedInGeometry` reports this at spawn time so the
  spawn-table owner can catch it; this module does not relocate it.
- **The CULL barrier is beatable at knife range, on purpose.** A target
  moving tangentially at speed `v` has a bearing rate of `v/d` rad/s, so a
  player at the 4.40 m/s of FEEL.md §2 out-turns `BARRIER_TRACK_RATE`
  (6.0 rad/s) once `d < 0.73 m`. Measured: **0.000°** of lag against a 4.40 m/s
  orbit at 12 m, **72.4°** at 0.64 m. This is the flank that FEEL.md §6 names
  as the answer to a CULL, not a tracking defect. Do not "fix" it.

## Determinism argument

Required by ARCHITECTURE.md §7 and asserted by the self-test.

1. **No wall clock, no `Math.random`.** Grep-verified: `Math.random`,
   `Date.now` and `performance.now` appear nowhere under `src/ai/`. Every
   method takes `dt`.
2. **Named RNG streams only** — `rng('ai')`, `rng('ai.accuracy')`,
   `rng('ai.reaction')`, `rng('ai.motion')`, `rng('ai.cover')`. Adding a
   vocalization cannot shift a bullet.
3. **No dependence on entity ids.** Per-agent randomisation is salted by the
   director's own `spawnIndex` counter, never by `entityId` — `allocId()` is
   globally monotonic across every subsystem, so keying behaviour off it would
   make the AI depend on how many ids `weapons` or `fx` happened to burn first.
4. **Stable arrays everywhere in the step loop.** `agents`, `squads` and
   `squad.members` are plain arrays in spawn order; removal uses `splice`,
   which preserves order. The three `Map`s (`_agentIndex`, `_squadIndex`,
   `_vocalCooldowns`) are used for O(1) lookup, and the only one ever iterated
   (`_vocalCooldowns`) decrements independent scalars with no order coupling.
5. **Bounded, fixed-count loops.** The avoidance fan is a fixed 7 entries, the
   cover sampler a fixed 384 × (1 + 8) rays, the panic cascade a single pass.
   No convergence-based early exit whose iteration count could vary.
6. **Shared hit records are copied immediately.** `physics.raycast` and
   `physics.sphereCast` return one shared record per world; every call site
   here consumes it before issuing another query.
7. **Verified, not asserted.** The self-test runs an identical 5-agent,
   600-step scenario (including a scripted leader kill at step 300 so the
   panic cascade is inside the window) twice from a fresh `PhysicsWorld` and
   requires 55 float64 fields to be **exactly** `===` equal. Additionally,
   four larger scenarios were hashed across **three separate `node`
   invocations** and produced byte-identical hashes each time.

Callers wanting reproducibility must call `setSessionSeed(n)` (and `resetIds()`
if entity ids are part of the comparison) before building the world.

## Integration contract

**Constructing:**

```js
const director = new AiDirector({ physics, events });          // targets optional
director.attachTargetRegistry(targets);                        // later, if needed
const vane = director.spawn({ archetype: 'VANE', position, squadId: 's1', faction: Faction.VESS });
director.update(dt, { entityId, position, velocity, forward, faction, alive });
```

`playerState.position` is treated as **feet**, matching `CharacterBody`.
`height` and `radius` are optional and default to `PLAYER.height` / `PLAYER.radius`.
Passing `null`, or `alive: false`, makes every agent lose its target.

**`../weapons/targets.js` is injected, not imported.** That file did not exist
when this module was written, and a static import of a missing module makes
`src/ai` fail to load. `AiDirector` therefore takes an optional `targets`
dependency and registers each agent as
`{entityId, faction, getCapsule(), getForward(), archetype, state}` — the
contract given in the brief. `getCapsule()` returns a stable agent-owned record
`{position, bottom, top, radius, height}` updated in place (zero allocation;
read it immediately, do not retain it). `getForward()` likewise returns an
agent-owned unit vector. `state` is the `AiAgent` itself. If the weapons owner
lands `targets.js` with a different shape, only `AiDirector._register()` changes.

**Yaw convention:** `forward = (sin(yaw), 0, cos(yaw))`, i.e.
`yaw = atan2(x, z)`. `three` objects face **−Z**, so a rig binder wants
`mesh.rotation.y = agent.yaw + Math.PI`. `aimPitch` is positive looking up.

**Events emitted** (all frozen names from `src/shared/events.js`):
`entity.spawned`, `entity.despawned`, `entity.killed`, `damage.rejected`,
`shield.broken`, `shield.recharge.start`, `shield.recharge.full`,
`health.changed`, `explosion.occurred`, `weapon.fired`, `grenade.thrown`,
`melee.swing`, `melee.landed`, `melee.whiffed`, `ai.alerted`, `ai.lostTarget`,
`ai.leaderKilled`, `ai.panic.start`, `ai.panic.end`, `ai.vocalize`.

**Events consumed:** `damage.applied` only.

**`ai.vocalize` cues:** `spotted`, `alerted`, `takingFire`, `shieldDown`,
`leaderDown`, `panic`, `rally`, `charge`, `grenade`, `melee`, `dodge`,
`lostTarget`, `barrierBroken`, `death`. Each is rate-limited to one per
`VOCAL_COOLDOWN` (2.5 s) per agent per cue, except the narrative ones
(`leaderDown`, `panic`, `rally`, `death`, `grenade`, `melee`, `shieldDown`,
`barrierBroken`) which are forced.

`weapon.fired` carries `weaponId` as a **string** (`'vess_needler'`,
`'vess_repeater'`, `'vess_carbine'`, `'vess_cannon'`) for the weapons owner to
map, and a `direction` that already has the accuracy model applied — trace it
as-is.

## Self-test results (measured, not predicted)

`node` 24.13.0, `three` 0.185.1, `runAiSelfTest()`. **26 / 26 pass, 0 fail**,
~0.30 s.

| Assertion | Measured | Expected |
| --- | --- | --- |
| F47 `ai.leaderKilled` emitted on leader death | fires | fires |
| F47 every SKIRN emits `ai.panic.start` | 3 / 3 | 3 |
| **F47 SKIRN panic delay after `ai.leaderKilled`** | **0.8000, 0.8000, 0.8000 s** | 0.80 ± 0.10 |
| F47 `FREEZE` state observable before panic | true | true |
| F47 SKIRN actually flee after the freeze | all > 1 m displaced | true |
| F47 `ai.panic.end` timing | 6.7917 s | 6.80 ± 0.12 |
| **F48 CULL front barrier, KINETIC** | **0 health, barrier 90 → 60** | 0 |
| **F48 CULL front barrier, PLASMA** | **5.775 health** (30 × 0.35 × 0.55) | > 0 |
| F48 barrier does not protect from behind | 30 | 30 |
| F48 barrier breaks after 90 absorbed | broken, health still 55 | broken |
| F48 broken barrier no longer blocks KINETIC | 20 | 20 |
| CULL sidestep period | 10 reversals / 18 s | 10.0 ± 1 |
| CULL barrier lag vs a 4.40 m/s orbit at 12 m | 0.000° | ≤ 31° |
| WARDEN front plate | 14 (40 × 0.35) | 14 |
| WARDEN back weakpoint | 120 (40 × 3) | 120 |
| F49 90 KINETIC strips shield, no health bleed | shield 0, health 60 | shield 0, health 60 |
| **F49 shield recharge delay** | **4.0083 s** | 4.00 ± 0.10 |
| **F49 shield 0 → 90 duration** | **3.0000 s** | 3.00 ± 0.10 |
| F49 shield returns to full | 90 | 90 |
| F49 damage during recharge resets the delay | 4.0083 s | 4.00 ± 0.10 |
| Miss grace: AI engaged and fired | 30 shots, first at t = 0.542 s | > 10 |
| **Miss grace: geometric hits in the first 0.5 s** | **0 / 6 shots** (min error 0.03648 rad vs 0.02515 rad target radius) | 0 |
| Miss grace: hits resume after the window | 9 / 24 shots | > 0 |
| **Determinism, 600 steps × 2 runs** | **55 float64 fields exactly `===`** | exact |
| Determinism, state/animState strings | identical | identical |

The 4.0083 s and 3.0000 s figures are the honest tick-quantised values at
`SIM_DT = 1/120`: the delay expires on the first tick where the countdown
crosses zero (481 ticks = 4.0083 s) and the shield then fills over 360 ticks
(3.0000 s). No tolerance was loosened.

### Robustness beyond the self-test

Run as throwaway harnesses during development, not committed:

- **Miss grace, 160 runs** (4 archetypes × 40 seeds): **0** runs with a
  geometric hit inside the grace window, **0** runs with no hit after it.
  Minimum ratio of shot error to target angular radius inside the window was
  **1.3535×** (must exceed 1.0). Window length 3–6 shots.
- **F47, 120 panic measurements** over 40 seeds: worst |Δ − 0.80 s| =
  **0.000000 s**.
- **Cross-process determinism:** four multi-agent scenarios hashed identically
  across **3 separate `node` invocations**.
- **Performance**, 5 agents × 3600 ticks, Node 24.13.0: **20 µs/tick** idle
  (≈4 µs/agent), **89–166 µs/tick** in full combat (≈18–33 µs/agent). At
  120 Hz that is ~2 % of one core for a 5-agent firefight. Cost is dominated
  by the per-agent LOS raycast and, when blocked, the 7-ray avoidance fan.
  Extrapolating linearly, 20 agents would cost ~0.7 ms per 60 Hz frame
  (2 sim steps) — measured only at 5, so treat 20 as an estimate.
- **No NaN** in position, yaw, aim, `speed01`, health or shield across 3600
  ticks in four scenarios.

## Open items filed against other owners

See `DEFECTS.md` rows **AI1** (AI-local constants that may belong in
`tuning.js`), **AI2** (`damage.applied` has no attacker world position, which
directional mitigation needs), **AI3** (no frozen event for the CULL barrier
breaking, so `fx` cannot play the ricochet/shatter).
