# RINGFALL — ARCHITECTURE

**Version 1.0 — binding contract. Phase 0 artifact.**

This document is normative. Code that violates it is a defect, not a variation. Changes to
this document require a numbered entry in §12 (Amendment Log) with the reason and the
measurement that motivated it.

---

## 0. Ground rules (restated here because every agent reads this file first)

1. **No compensating hacks.** If a subsystem is wrong, fix the subsystem. Any constant that
   exists to hide a known upstream defect must carry a `// COMPENSATION:` comment naming the
   upstream defect, and must have a matching open entry in `DEFECTS.md`. Compensations are
   counted as open defects in every round's ledger.
2. **Every critique carries a measurement.** Unmeasured complaints are discarded without
   action and without argument.
3. **No global fix for a local complaint.** Exposure, tonemap curve, global albedo scale, and
   global bloom intensity are **frozen constants** owned by one agent (§2). No other agent may
   touch them. A single object reading wrong is fixed on that object.
4. **Coupled systems get one owner, working alone, sequentially.** See §2.
5. **Parallel only for decoupled work.** See §2.
6. **Bounded loops only.** Every improvement loop declares max rounds and a minimum-improvement
   threshold before it starts. Three consecutive sub-threshold rounds = stop and document.
7. **Contradiction is allowed with evidence.** A subagent that believes its brief is wrong files
   `CONTRADICTION.md` containing the measurement, the predicted outcome under the brief, and the
   predicted outcome under its proposal. It does not silently deviate.
8. **Commit after every green gate.** The repo must boot at every commit on `main`.

---

## 1. Runtime and dependency policy

| Concern | Policy |
| --- | --- |
| Runtime dependencies | `three` **only**. Nothing else ships in the bundle. |
| Build tooling | `vite` (dev server + build). |
| Test tooling | `playwright` (headless Chromium, WebGL2 via ANGLE/SwiftShader-off — real GPU required for `profile.mjs`). |
| Binary assets | **Forbidden.** No `.png`, `.jpg`, `.hdr`, `.exr`, `.glb`, `.gltf`, `.fbx`, `.obj`, `.wav`, `.mp3`, `.ogg`, `.ttf`, `.woff*` anywhere in `src/`, `public/`, or the bundle. |
| Enforcement | `tools/assetguard.mjs` walks `src/` and `public/` and exits non-zero on any file whose extension is not in `{.js, .glsl, .json, .html, .css, .md}`. It also greps the built bundle for `data:image/`, `data:audio/`, and `data:font/` and fails on any hit. Runs in the gate. |
| Fonts | Procedural. HUD glyphs are drawn as vector paths / SDF generated at boot into a canvas atlas. No webfonts, no system font names in the shipped HUD (system fonts are permitted only in the dev-overlay). |
| Audio | 100% synthesized at runtime from WebAudio primitives + procedurally generated `AudioBuffer` noise/impulse tables. No sample files, no base64 audio. |
| Textures | 100% generated at boot into `DataTexture` / `CanvasTexture` / render-to-texture. Generation is seeded and deterministic. |

**Version pins** (exact, no caret drift in CI):

```
three      0.185.1
vite       8.1.5
playwright 1.62.0
node       >=22.12
```

---

## 2. Ownership map

**One owner per directory. No cross-writes. Ever.** If you need a change in a directory you do
not own, you emit an event, or you file a request in `DEFECTS.md` addressed to that owner.

### 2.1 Sequential track — single owner at a time, never parallel

These subsystems are mutually coupled through the light transport and the tonemap. Running them
in parallel produced a measured regression in prior work (defects 60 → 47 → 66 across three
six-agent rounds). They run **one agent, one at a time, in this order**:

| Order | Owner name | Directories owned (exclusive write) | Scope |
| --- | --- | --- | --- |
| S1 | `lighting` | `src/render/**` | Sky model, atmospheric scattering & fog, sun/moon, **exposure**, **tonemap**, indirect (sky-SH + ground bounce), GTAO, shadow cascades, TAA, **bloom pyramid**, composite/grade. This is ONE system with ONE owner. |
| S2 | `materials` | `src/materials/**` | Procedural texture generation, the three material families (CDF / Vess / Wrought), the shared BRDF, surface-ID binding. |
| S3 | `worldart` | `src/world/**` | Level geometry, megastructure/skybox geometry, props, decals-as-geometry, environment set dressing. |
| S4 | `charart` | `src/characters/**` | Character mesh generation, silhouettes, armor motifs, shield shell visuals. |

`lighting` owns the values in `src/render/exposure.js` and `src/render/tonemap.js`. **No other
agent, at any time, in any round, for any reason, may edit those two files.** A local brightness
complaint against a specific object is fixed in `src/materials` or in that object's construction,
not here.

### 2.2 Parallel track — genuinely decoupled, may fan out

| Owner name | Directories owned (exclusive write) | Talks to others via |
| --- | --- | --- |
| `physics` | `src/physics/**` | events + read-only queries |
| `playerctl` | `src/player/**` | events |
| `sandbox` | `src/weapons/**` | events |
| `ai` | `src/ai/**` | events |
| `vehicles` | `src/vehicles/**` | events |
| `audio` | `src/audio/**` | events (listen-only; audio emits nothing) |
| `ui` | `src/ui/**` | events (listen-only; except input-intent events) |
| `fx` | `src/fx/**` | events (listen-only) |

`audio`, `ui`, and `fx` are **pure consumers of the event bus**. They never call into gameplay.
This is what makes them safe to parallelize: they cannot regress gameplay, only themselves.

### 2.3 Shared, orchestrator-only

| Directory | Owner |
| --- | --- |
| `src/shared/**` | Orchestrator only. Anyone may read; nobody but the orchestrator may write. Changing a shared type is a contract change and goes through §12. |
| `src/core/**` | Orchestrator only. |
| `src/game/**` | Orchestrator only. Wiring, spawn tables, mode logic. |
| `tools/**` | Orchestrator only. Tools may not be modified to make a failing gate pass. |
| `docs/**`, `*.md` | Orchestrator only, except `DEFECTS.md` and `CONTRADICTION.md`, which are append-only for all agents. |

---

## 3. Module layering (the import lattice)

A module may import from **strictly lower layers** and from its own directory. Nothing else.
Sideways coupling between same-layer subsystems goes through the event bus. Upward imports are
a hard error checked by `tools/layercheck.mjs` in the gate.

```
L0  src/shared      pure data: enums, constants, damage matrices, pure math.
                    imports: three (types/math only)

L1  src/core        event bus, fixed-step scheduler, seeded RNG, config registry,
                    object pools, debug console, input capture.
                    imports: L0

L2  src/render      renderer, frame graph, all passes, sky, exposure, tonemap,
                    bloom, TAA, GTAO, shadows, the shared shader-chunk library,
                    and the global uniform block (UBO) that materials read.
                    imports: L0, L1

L3  src/materials   material families + procedural texture generation.
    src/physics     broadphase, capsule/box/sphere sweep, raycast, rigid bodies.
    src/audio       synthesis graph, mixer, buses, DSP.
                    imports: L0, L1, L2 (materials only; physics & audio do not import L2)

L4  src/world       level construction, megastructure, props.
    src/characters  character mesh generation.
    src/fx          particles, decals, tracers, impacts, shield flare.
    src/ui          HUD, reticle, menus, damage indicators.
                    imports: L0..L3

L5  src/player      capsule controller, camera, view model handling.
    src/weapons     weapon definitions, firing, ballistics, aim assist, grenades, melee.
    src/ai          perception, behavior, squads, navigation.
    src/vehicles    suspension, drivetrain, seats, chase camera.
                    imports: L0..L4

L6  src/game        spawn tables, encounter scripting, game modes, subsystem wiring.
                    imports: L0..L5

    src/main.js     entry. imports: L6 and L1 only.
```

**Rationale for `src/render` at L2:** materials must read exposure, sky SH, and fog uniforms to
be consistent with the light transport. Putting render below materials makes that a normal
import instead of a back-channel. It also means `lighting` (S1) can be fully validated before
`materials` (S2) exists, which is the whole point of the sequential ordering.

**`src/physics` and `src/audio` do not import `src/render`.** They are headless-testable. This is
required by `feeltest.mjs`, which runs the simulation with rendering disabled.

---

## 4. Event vocabulary

The bus is `src/core/events.js`. Names are frozen strings declared in `src/shared/events.js`.
Emitting an undeclared event name throws in dev builds.

Delivery is **synchronous, in-order, within the current fixed-step tick**. Handlers may not emit
re-entrantly more than 2 levels deep (guard throws). Payloads are pooled plain objects; handlers
must not retain a reference past the call.

### 4.1 Combat

| Event | Payload | Emitter | Typical consumers |
| --- | --- | --- | --- |
| `damage.applied` | `{targetId, sourceId, amount, rawAmount, damageType, hitRegion, point[3], normal[3], weaponId, absorbedByShield}` | `weapons`, `vehicles`, `game` | `ai`, `ui`, `fx`, `audio` |
| `damage.rejected` | `{targetId, reason}` (`'friendly'`, `'invuln'`, `'dead'`) | damage resolver | `ui` |
| `shield.broken` | `{entityId, overkill, point[3], normal[3]}` | damage resolver | `fx`, `audio`, `ui`, `ai` |
| `shield.recharge.start` | `{entityId}` | damage resolver | `audio`, `fx` |
| `shield.recharge.full` | `{entityId}` | damage resolver | `audio`, `fx`, `ui` |
| `health.changed` | `{entityId, health, maxHealth, shield, maxShield}` | damage resolver | `ui`, `ai` |
| `entity.spawned` | `{entityId, archetype, faction, position[3]}` | `game` | all |
| `entity.killed` | `{entityId, killerId, weaponId, hitRegion, damageType, position[3]}` | damage resolver | `ai`, `ui`, `audio`, `fx`, `game` |
| `entity.despawned` | `{entityId}` | `game` | all |

### 4.2 Weapons

| Event | Payload |
| --- | --- |
| `weapon.fired` | `{ownerId, weaponId, muzzle[3], direction[3], seed, ammoRemaining, isFirstOfBurst}` |
| `weapon.dryfire` | `{ownerId, weaponId}` |
| `weapon.reload.start` | `{ownerId, weaponId, durationMs, fromEmpty}` |
| `weapon.reload.end` | `{ownerId, weaponId}` |
| `weapon.swap.start` | `{ownerId, fromWeaponId, toWeaponId, durationMs}` |
| `weapon.swap.end` | `{ownerId, weaponId}` |
| `weapon.overheat` | `{ownerId, weaponId}` |
| `weapon.cooled` | `{ownerId, weaponId}` |
| `weapon.charge.start` / `weapon.charge.full` / `weapon.charge.released` | `{ownerId, weaponId, chargeLevel}` |
| `weapon.dropped` | `{ownerId, weaponId, ammo, position[3], velocity[3]}` |
| `weapon.pickedup` | `{ownerId, weaponId, ammo}` |
| `scope.enter` / `scope.exit` | `{ownerId, weaponId, magnification}` |
| `scope.descoped` | `{ownerId, weaponId}` |

### 4.3 Grenades and melee

| Event | Payload |
| --- | --- |
| `grenade.thrown` | `{ownerId, grenadeType, origin[3], velocity[3], fuseMs}` |
| `grenade.bounced` | `{grenadeId, point[3], normal[3], impactSpeed, surfaceId}` |
| `grenade.stuck` | `{grenadeId, targetId, localPoint[3]}` |
| `grenade.detonated` | `{grenadeId, grenadeType, point[3], radius, ownerId}` |
| `melee.swing` | `{ownerId, durationMs}` |
| `melee.landed` | `{ownerId, targetId, fromBehind, point[3]}` |
| `melee.whiffed` | `{ownerId}` |

### 4.4 World / feedback

| Event | Payload |
| --- | --- |
| `surface.impact` | `{point[3], normal[3], surfaceId, energy, damageType, sourceId}` — the single hook for impact decals, sparks, dust, and impact audio. Everything that hits geometry emits this. |
| `explosion.occurred` | `{point[3], radius, energy, damageType}` |
| `player.jumped` | `{entityId}` |
| `player.landed` | `{entityId, impactSpeed, surfaceId}` |
| `player.footstep` | `{entityId, foot, surfaceId, speed}` |
| `player.crouch.changed` | `{entityId, crouched}` |

### 4.5 AI

| Event | Payload |
| --- | --- |
| `ai.alerted` | `{entityId, squadId, cause, targetId}` |
| `ai.lostTarget` | `{entityId, lastKnown[3]}` |
| `ai.leaderKilled` | `{squadId, leaderId}` |
| `ai.panic.start` / `ai.panic.end` | `{entityId, squadId}` |
| `ai.vocalize` | `{entityId, archetype, cue}` — `audio` only. |

### 4.6 Vehicles

| Event | Payload |
| --- | --- |
| `vehicle.entered` | `{entityId, vehicleId, seat}` |
| `vehicle.exited` | `{entityId, vehicleId, seat, ejected}` |
| `vehicle.impact` | `{vehicleId, otherId, relativeSpeed, normal[3]}` |
| `vehicle.rolled` | `{vehicleId, uprightDot}` |
| `vehicle.flipped` | `{vehicleId, byEntityId}` |
| `vehicle.destroyed` | `{vehicleId, position[3]}` |

### 4.7 HUD-only

`hud.hitmarker {shielded, killed, headshot}`, `hud.damageDirection {yaw, severity}`,
`hud.pickupPrompt {show, label}`, `hud.objective {text}`.

---

## 5. Shared types (`src/shared/`)

### 5.1 `SurfaceId`

Drives impact FX, impact audio, decal family, footstep audio, and material assignment. Every
collider carries exactly one.

```
METAL_PAINTED  METAL_BARE  METAL_GRATE  CONCRETE  ROCK  DIRT  GRASS  SAND
GLASS  ALLOY_SMOOTH (Vess)  ALLOY_HARD (Wrought)  ENERGY_BARRIER
FLESH  ARMOR_HARD  SHIELD  VEHICLE_HULL  WATER
```

### 5.2 `DamageType`

```
KINETIC  PLASMA  EXPLOSIVE  MELEE  EMP  FALL  VEHICLE  ENVIRONMENT
```

### 5.3 Damage multiplier matrix (`src/shared/damage.js`) — **the sandbox lives here**

| DamageType | × vs Shield | × vs Health | Notes |
| --- | --- | --- | --- |
| `KINETIC` | 1.00 | 1.00 | Baseline. Keeps UNSC-analogue TTK arithmetic legible. |
| `PLASMA` | 1.60 | 0.55 | Strips shields fast, poor finisher. |
| `EXPLOSIVE` | 1.00 | 1.15 | |
| `MELEE` | 1.00 | 1.00 | |
| `EMP` | 4.00 | 0.00 | Charged bolt fully removes a 70-shield in one hit, deals no health damage. |
| `FALL` | 0.00 | 1.00 | Ignores shields entirely. |
| `VEHICLE` | 1.00 | 1.30 | |
| `ENVIRONMENT` | 1.00 | 1.00 | |

The `PLASMA` / `KINETIC` split is the reason two weapons are carried. It is a design invariant,
not a tuning value. Changing either column requires a §12 amendment.

### 5.4 `HitRegion` and multipliers

| Region | Kinetic multiplier | Notes |
| --- | --- | --- |
| `HEAD` | per-weapon (see `FEEL.md` §4) | Only precision weapons get a large head multiplier. |
| `TORSO` | 1.00 | |
| `LIMB` | 0.85 | |
| `WEAKPOINT` | 3.00 | Skirn methane tank, Warden back plate, vehicle fuel cell. |

Head multipliers apply **only when shields are down**, matching the reference sandbox. This is
what makes shield-strip → headshot a skill expression instead of a damage stat.

### 5.5 `Faction`

```
PLAYER  CDF (Colonial Defence Force, human)  VESS (antagonist)  WROUGHT (dormant, hostile-to-all)  NEUTRAL
```

### 5.6 Entity archetypes (frozen names — original IP)

| Archetype | Role analogue | Shield | Health | Silhouette key |
| --- | --- | --- | --- | --- |
| `SKIRN` | light infantry, panics | 0 | 30 | small, hunched, dorsal tank |
| `CULL` | shielded flanker | 0 (gauntlet blocker) | 55 | medium, forward-arm slab |
| `VANE` | leader, recharging shields | 90 | 60 | tall, flared shoulders, split helm |
| `WARDEN` | heavy | 0 | 220 | huge, wide, plated, low head |
| `PLAYER` | — | 70 | 45 | — |

### 5.7 Ids

Entity ids are `uint32`, monotonically allocated from `src/core/ids.js`, never reused within a
session. `0` is the null id.

---

## 6. Frame graph

Owner of every pass in this table: **`lighting` (S1)**. Order is fixed. Any change is a §12
amendment.

| # | Pass | Target | Format | Res | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 | Cull + cluster build | — | — | — | Clustered forward light assignment, 16×8×24 froxels. |
| 1 | Shadow cascades | `shadowAtlas` | `DEPTH24` 4×2048² | — | 4 cascades: 12 / 32 / 90 / 260 m. Stabilized, texel-snapped. |
| 2 | Depth + normal + velocity prepass | `gDepth`, `gNormal`, `gVelocity` | `DEPTH24`, `RG16F` (octahedral), `RG16F` | full | Velocity includes camera + object motion. Required by TAA and by GTAO. |
| 3 | GTAO | `aoTex` | `R8` | half | Ground-truth-ish AO from `gDepth`+`gNormal`, 8 slices/6 steps, then bilateral upsample + temporal accumulate using `gVelocity`. |
| 4 | Sky + aerial perspective LUT | `skyLUT`, `transLUT` | `RGBA16F` 128×64 | tiny | Recomputed only when sun or turbidity changes. Static per level ⇒ computed once at boot. |
| 5 | Opaque forward+ | `hdrColor`, reuses `gDepth` (EQUAL test) | `RGBA16F` | full | Clustered lights, CSM, `aoTex`, sky-SH indirect + ground bounce, fog inline. Depth writes off. |
| 6 | Sky dome + megastructure | `hdrColor` | `RGBA16F` | full | Depth test LEQUAL at far plane. Includes the ring arc geometry. |
| 7 | Decals | `hdrColor` | — | full | Projected boxes, depth-tested, forward-lit, additive-normal blended. |
| 8 | Transparent + particles | `hdrColor` | `RGBA16F` | full | Sorted back-to-front, soft-particle depth fade, no depth write. Excluded from TAA history clamp source. |
| 9 | TAA resolve | `taaHistory` ↔ `hdrResolved` | `RGBA16F` | full | Halton(2,3) 8-phase jitter, YCoCg variance clipping (γ=1.0), velocity reprojection, luminance-weighted blend, 0.9 feedback. |
| 10 | Bloom pyramid | `bloomChain[0..5]` | `RGBA16F` | ½→1/64 | Karis-average threshold downsample, tent-filter upsample. **Wide and bright by design** — see `ART.md` §7. |
| 11 | Composite | `ldrColor` | `RGBA8` sRGB | full | Fixed exposure → hue-preserving filmic tonemap → grade LUT (analytic) → vignette → dither. Owner-frozen. |
| 12 | UI | default framebuffer | `RGBA8` | full | Separate orthographic pass. Never tonemapped, never bloomed. |

**Exposure policy: there is no auto-exposure.** Exposure is a constant declared per level in
`src/render/exposure.js`. This is deliberate: an adaptive exposure term makes every art critique
non-reproducible and was the mechanism of the prior attempt's death spiral. If a scene is wrong,
the scene's lights are wrong.

**Render targets are allocated once at boot** and never resized during play except on window
resize (which is debounced 250 ms and flagged in the profile trace).

---

## 7. Determinism contract

Required by `baseline.mjs` (bit-identical across runs) and `feeltest.mjs`.

1. **Fixed timestep.** Simulation runs at exactly 120 Hz (`dt = 1/120`). Render interpolates.
   A frame consumes at most 8 sim steps; overflow is dropped and logged as `simOverrun`.
2. **Engine clock only.** No `Date.now()`, `performance.now()`, or `Math.random()` anywhere
   under `src/` except in `src/core/clock.js` and `src/core/rng.js`. Enforced by a grep in the
   gate (`tools/layercheck.mjs`).
3. **Seeded RNG streams.** `src/core/rng.js` provides named xorshift128+ streams. Each subsystem
   takes its own stream (`rng('fx')`, `rng('weapons.spread')`, …) so that adding a particle can
   never shift a bullet. Stream seeds derive from a single session seed.
4. **Deterministic capture mode.** `?det=1&seed=N` freezes the clock and steps the sim from a
   script. In this mode: TAA jitter follows a fixed phase table from frame 0, particle systems
   are reset, decal buffers cleared, and `window.__ringfall.ready` resolves only after all
   procedural texture generation and all shader compiles have completed.
5. **Fresh page per shot.** `baseline.mjs` opens a **new browser context and new page for every
   camera**, never reusing state. Shared-page capture leaks particle age, decal buffers, and
   temporal history forward; the prior harness differed on 10 of 11 shots between two identical
   runs, which invalidated every comparison made with it.
6. **Iteration order.** All per-frame iteration over entities uses stable arrays, never `Set`
   or `Map` insertion order derived from spawn timing that could vary.

---

## 8. Tooling contract (`tools/`)

All tools exit non-zero on failure and print machine-readable JSON to `artifacts/<tool>.json` in
addition to human output.

| Tool | Contract |
| --- | --- |
| `baseline.mjs` | Captures the 12-shot set (§9). Fresh context+page per shot, `?det=1&seed=1337`, fixed 90-frame warmup, then readback of raw RGBA from the WebGL canvas into `artifacts/shots/<name>.bin` plus a `.png` for humans. Must be bit-identical across 3 consecutive runs before Phase 2 opens. |
| `imagediff.mjs` | Compares `artifacts/shots/*.bin` against `baseline/shots/*.bin`. Non-zero exit on any moved pixel. Reports moved-pixel count, max ΔE, and a per-shot heat map PNG. Used to prove a perf change is pixel-neutral. |
| `profile.mjs` | **Real gameplay**, `devicePixelRatio = 2`, camera in motion along a scripted path, AI alive, weapons firing, grenades and a vehicle in play. 90 s capture. Reports p50 / p95 / p99 / worst frame, frame-time histogram, **per-frame `WEBGL_shader_compile` counts**, draw calls, triangles, and GC pauses. A median-only benchmark is not accepted: the prior harness reported 94 fps on a build that ran 12–17 fps in play with 700–1200 ms stalls. |
| `playtest.mjs` | Scripted movement + combat smoke test. Asserts: boots, no console errors, no NaN in player transform, kills at least one enemy, survives 60 s, no unhandled rejections. |
| `feeltest.mjs` | Headless (rendering disabled), drives synthetic input into the real controller and weapon code, asserts every numbered assertion in `FEEL.md` §8 with its stated tolerance. **This is a failing test, not a report.** |
| `assetguard.mjs` | §1 asset policy enforcement. |
| `layercheck.mjs` | §3 import lattice + §7 clock/RNG bans. |
| `silhouette.mjs` | `ART.md` §8 gate: renders each archetype at 60 m against sky, thresholds to binary, computes pairwise IoU, fails if any pair ≥ 0.60. |
| `palette.mjs` | `ART.md` §9 gates: scene mean L*, contrast ratio, mean saturation, highlight saturation on the 20 brightest pixels, atmospheric-perspective blend at 60 m / 200 m. |

**Tools may not be edited to make a failing gate pass.** A tool change requires a §12 amendment
naming the measurement error being corrected.

---

## 9. The 12-shot baseline set

Fixed cameras, fixed sun, fixed seed. Named exactly as below.

| # | Name | Purpose |
| --- | --- | --- |
| 1 | `int_corridor` | Interior CDF corridor — material read, local lights, AO |
| 2 | `int_hall_emissive` | Interior Wrought hall — seam strips, bloom behaviour |
| 3 | `ext_vista` | Exterior vista with megastructure arc — atmosphere, aerial perspective |
| 4 | `ext_ground` | Exterior mid-field — terrain, foliage-analogue, shadow cascade 1→2 seam |
| 5 | `weapon_close` | First-person weapon filling the frame — the shot that killed the prior attempt |
| 6 | `enemy_15m` | `VANE` at 15 m — character material read |
| 7 | `enemy_60m_sil` | Four archetypes at 60 m against sky — silhouette legibility |
| 8 | `vehicle_ext` | Ridgeback LRV, three-quarter, exterior light |
| 9 | `night_emissive` | Night lighting, emissive-dominated |
| 10 | `shield_flare` | Frame captured 2 frames after `shield.broken` — the flare |
| 11 | `firefight` | Mid-combat: tracers, impacts, grenade, HUD live — readability under load |
| 12 | `sky_only` | Sky dome alone, no geometry — isolates the sky model from everything else |

---

## 10. Gates

| Gate | Condition | Blocks |
| --- | --- | --- |
| G0 Harness | All 7 tools run green; `baseline.mjs` bit-identical 3× | Phase 2 |
| G1 Boot | `npm run dev` serves, page reaches `ready` in < 4 s | every commit |
| G2 Layer | `layercheck.mjs` green | every commit |
| G3 Asset | `assetguard.mjs` green | every commit |
| G4 Feel | `feeltest.mjs` green (all `FEEL.md` §8 assertions) | every gameplay commit |
| G5 Play | `playtest.mjs` green | every commit |
| G6 Perf | p50 ≥ 60 fps @ DPR 2 in combat; p99 ≥ 45 fps; worst frame ≤ 50 ms; **0 shader compiles during play**; boot < 4 s | every round close |
| G7 Art | `palette.mjs` + `silhouette.mjs` green | art-pass rounds |
| G8 Pixel | `imagediff.mjs` zero moved pixels | perf-only changes |

**Triangle budget rule:** an art pass may not raise visible triangle count more than 20% without
a perf pass in the same round, verified pixel-neutral by G8.

---

## 11. Critic protocol

Four critics, distinct mandates, each scoring 0–10 against a written rubric with measured
evidence. No generic "harsh critic".

| Critic | Grades against | Input it is allowed to see | Input it is forbidden to see |
| --- | --- | --- | --- |
| C1 Art direction | `ART.md` §§1–7, 9 | baseline shots, `palette.mjs` output | frame times |
| C2 Readability | `ART.md` §8, `FEEL.md` §7 | shots 6, 7, 10, 11; `silhouette.mjs` output | source code |
| C3 Feel | `FEEL.md` §§1–6, 8 | `feeltest.mjs` output, `playtest.mjs` trace | **screenshots — explicitly forbidden** |
| C4 Performance | `ARCHITECTURE.md` §10 G6 | `profile.mjs` distribution output only | screenshots, source |

Each round produces exactly one prioritized defect ledger with counts by severity
(`frame-ruining` / `major` / `minor`). **If the total defect count rises versus the previous
round, the round is reverted, not patched.**

Loop bounds for every critique loop: **max 5 rounds**, **minimum mean-score improvement 0.15
per round**. Three consecutive sub-threshold rounds ends the loop.

---

## 12. Amendment log

| # | Date | Change | Measurement / reason |
| --- | --- | --- | --- |
| A1 | 2026-07-25 | Jump gravity set to **9.3 m/s²**, not the brief's "~11". | The brief specifies apex 1.05 m, airtime 0.95 s, and g ≈ 11 m/s². Under symmetric ballistics these are mutually unsatisfiable: g = 11 with apex 1.05 gives airtime 0.874 s (−8%); g = 11 with airtime 0.95 gives apex 1.24 m (+18%). Apex and airtime are directly felt by the player; g is not. Resolved by holding both felt quantities and letting g fall out: g = 2·(2h/t²)… → **g = 8h/t² = 8(1.05)/0.95² = 9.31 m/s²**, launch velocity 4.42 m/s. Full derivation in `FEEL.md` §2.1. |
| A2 | 2026-07-25 | `KINETIC` multipliers set to 1.00/1.00 rather than an asymmetric split. | With any kinetic shield modifier ≠ 1.0 the precision-rifle "3 bursts to strip, 4th burst to the head" cadence cannot land on a whole number of rounds against a 70-shield. Verified arithmetic in `FEEL.md` §4.1. The `PLASMA` split alone carries the sandbox asymmetry. |
</content>
