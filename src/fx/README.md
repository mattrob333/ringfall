# `src/fx` — particles, decals, tracers, impacts, flares

Owner: `fx` (ARCHITECTURE.md §2.2). Layer **L4**. `fx` is a **pure, listen-only
consumer of the event bus** — it subscribes, it never emits, and it never calls
into gameplay. Permitted imports: `three`, `../shared/*`, `../core/*`,
`../materials/*`, and `../render/index.js` for the layer constants only.

Everything drawn here lives on `LAYER_TRANSPARENT`, so it is rendered by
**frame graph pass 8**: after opaque, after the sky dome, excluded from the
depth/normal/velocity prepass and from the shadow cascades, depth **tested**
against the opaque depth buffer, depth **write off**.

---

## 1. Public API

```js
import { FxSystem, wireFxEvents } from './fx/index.js';

const fx = new FxSystem({
  scene:    renderer.scene,
  globals:  renderer.globals,   // only uExposure is read
  camera,                       // LOD + alpha sort only
  clusters: renderer.clusters,  // optional; without it there are no FX lights
});
const unwireFx = wireFxEvents(fx);   // returns an unsubscribe fn

// once per rendered frame, before renderer.render()
fx.update(dt, camera.position);

fx.dispose();
unwireFx();
```

`FxSystem` also exposes `reset()` (for `?det=1` deterministic capture,
ARCHITECTURE.md §7.4), `caps()`, `stats`, and
`setEntityPosition(id, x, y, z)` — see §7 for why that last one exists.

---

## 2. Effects shipped

### `surface.impact` — the primary hook, one response per `SurfaceId`

| `SurfaceId` | Response |
| --- | --- |
| `METAL_PAINTED` / `METAL_BARE` / `METAL_GRATE` / `ARMOR_HARD` | Hot core flash at 11× the bloom threshold, 8 velocity-aligned sparks, **2 long fast ricochet streaks** (24–42 m/s, 0.09–0.16 s), 3 paint-dust puffs, metal decal |
| `CONCRETE` / `ROCK` | Small spall glow, 9 dust puffs that grow and slow, **5 solid chips under full gravity**, stone decal (irregular lobed chip ring) |
| `DIRT` / `GRASS` / `SAND` | 7 airborne puffs + 8 clods/blades thrown clear, tinted per surface from the ART.md §3.5 terrain palette, soft scatter decal |
| `GLASS` | 10 hard-edged analytic shards with spin, small flash, crack-star decal |
| `ALLOY_SMOOTH` (Vess) | **Resonant ring flash** — a cyan annulus expanding to ~0.9 m in 0.34 s, plus a 12× core and 6 cyan/violet sparks. The shell answers a hit by *ringing*, not chipping (ART.md §3.3: one continuous form, no panel gaps) |
| `ALLOY_HARD` (Wrought) | **Hard bright flash** at 18× threshold, 0.075 s, plus a fast pale ring and 8 short sparks. No spall, no ring-down |
| `FLESH` | **Blood-free**: 10 warm bright particulate motes that dissipate, one soft warm bloom. No gore, no decal |
| `SHIELD` / `ENERGY_BARRIER` | **Electric crackle sheet** — an analytic six-spoke arc panel lying on the shell, a break ring, and 6 arcs skating *tangentially* across the surface. No decal (energy leaves no mark) |
| `VEHICLE_HULL` | Metal response |
| `WATER` | Ring + droplet spray, no decal |
| anything else | Falls back to the stone response |

A `PLASMA` `damageType` adds a cyan scorch ring on top of whatever the surface
did.

### The rest

* **Bullet decals** — 7 analytic patterns (metal crater + scratch spokes, stone
  chip, soft scatter, glass crack-star, Vess scorch ring, Wrought hexagon,
  explosion scorch). Pooled at **256**, exact oldest-out replacement by birth
  stamp, 20–40 s life, fading only over the last 20%.
* **Tracers** — one velocity-aligned streak per `weapon.fired`, 190 m/s (Vess) /
  265 m/s (CDF), **0.30 s life**, at most **4 m long**, dimming as it flies.
  CDF warm (`#FFC46A`), Vess cyan (`#57E0FF`). It is deliberately short and dim
  enough to read as a fast round, not a beam.
* **Muzzle flash** — a 24× core, an expanding crown ring, 5 forward petal
  streaks, a grey wisp on CDF chemical weapons, **plus a co-located clustered
  point light** (intensity 12 CDF / 9 Vess, range 7.5 m, 55 ms) added through
  `renderer.clusters`.
* **Grenades**
  * `grenade.thrown` starts a trail emitter. **Frag**: dark smoke (`#3A3B38`)
    every 30 ms plus a **5 Hz blinking hazard-orange indicator at 9× the bloom
    threshold** — dark body + saturated blink is what makes it readable against
    the bright warm sky of ART.md §3.1. **Plasma**: a **continuous cyan ribbon**
    (a streak segment every 18 ms, placed at the segment midpoint so consecutive
    segments abut) plus a sustained cyan point light, which is what makes it
    readable against dark saturated ground. Both requirements are FEEL.md §4.6.
  * `grenade.bounced` — surface-tinted bounce puff, plus a spark on fast metal
    bounces; the trail is re-anchored and reflected with the type's restitution.
  * `grenade.stuck` — the ribbon stops dead.
  * `grenade.detonated` — see below.
* **Detonations / `explosion.occurred` / `vehicle.destroyed`** — a 34× core
  flash, an expanding **shockwave ring**, an expanding shell, 26–34 ejecta
  streaks, smoke, a scorch decal, and a strong point light. **Frag vs plasma is
  a deliberate silhouette difference**: frag is warm orange, broad slow ring,
  22 heavy dark smoke puffs, ejecta under full gravity; plasma is cyan, a thin
  ring that expands 2.1× the radius, 6 pale puffs, ejecta with heavy drag and
  almost no gravity.
* **`shield.broken`** — the biggest thing FX draws, because it is the visual
  half of the game's most important feedback moment (FEEL.md §3): a 26× bright
  expanding shell out to 3.5 m, a second slower shell behind it, a break ring on
  the hit plane, a crackle sheet at the impact, 26 radial arcs, and a 70-intensity
  9 m cyan light for 0.36 s.
* **`shield.recharge.start` / `.full`** — a faint shell shimmer.
* **`melee.landed`** — a 14× spark burst and a short light; **1.7× everything**
  when `fromBehind` is set (the assassination read).
* **`vehicle.impact`** — a heavier metal response scaled by `relativeSpeed`,
  with smoke above ~14 m/s.
* **`weapon.overheat`** — a 3.4 s vent plume (the FEEL.md §4.5 lockout window)
  of cyan hot gas plus cooling vapour, tapering to nothing, anchored to the
  owner's last known muzzle.

---

## 3. Architecture: one pooled system, three draw calls

| Draw | Contents | Blend | Cap |
| --- | --- | --- | --- |
| `fx.decals` | every bullet hole and scorch mark | premultiplied over | 256 |
| `fx.particles.alpha` | smoke, dust, dirt, chips, debris | premultiplied over, CPU depth sorted | 1400 |
| `fx.particles.additive` | sparks, flashes, tracers, plasma, rings, shells | `(ONE, ONE)` — order independent | 2600 |

**Three `THREE.Mesh`es exist, forever.** Each is an `InstancedBufferGeometry`
holding one unit quad plus four `InstancedBufferAttribute`s allocated at full
cap. Nothing is added to or removed from the scene at runtime; only
`instanceCount` changes. `renderOrder` is 10 / 11 / 12 so decals draw under
particles, and `frustumCulled` is off on all three.

Particle **shapes are analytic**, exactly as `src/materials/index.js` does for
surfaces: soft disc, ring, velocity-aligned streak, spark (hot core + halo),
crackle sheet (six radial arcs at a fixed angular frequency), hard-edged
triangular shard (three half planes, `fwidth`-antialiased), and shell. Decal
patterns are the same idea with a two-term low-order harmonic radius modulation
for irregular outlines. **There is not one `sampler2D`, one texture file, one
generated bitmap, or one noise function in this directory** (ART.md §2 / §10,
ARCHITECTURE.md §1).

### Lights

FX needs real lights, not just emissive — ART.md §4 is explicit that emissives
light nothing and that a co-located point light must be authored where an
emissive should illuminate its surroundings. `src/render/clusters.js` has
`addPointLight` but no remove, and `clear()` drops everything, so `FxLightPool`
**reserves 24 lights once at construction** (9% of the 256 `MAX_LIGHTS` budget)
and afterwards only toggles `enabled` / `intensity` / `position`. It can never
grow the cluster list mid-firefight, and therefore can never cause light
overflow. When saturated it steals the slot with the least time remaining, so a
detonation never loses to a muzzle flash.

### Brightness and bloom

ART.md §7.2 puts the bloom threshold at **1.0 in post-exposure linear**.
Exposure is a frozen constant owned by `lighting`, so FX reads
`globals.u.uExposure.value` and derives `B = 1 / exposure` (1.136 at the shipped
0.88). Every brightness in `effects.js` is written as a multiple of `B` — `24 * B`
means "24× the bloom threshold". Muzzle flashes (24×), Wrought impacts (18×),
detonation cores (34×) and the shield-break shell (26×) all clear the knee by a
wide margin. This reads the sanctioned uniform rather than duplicating the
constant; it is **not** a `// COMPENSATION:`.

---

## 4. The allocation argument

The brief is zero garbage per frame. This is what that cost and how it was
verified, all measured on node 24 with `--expose-gc`:

1. **No per-particle objects anywhere.** Simulation state is one interleaved
   `Float32Array` per pool, 24 floats per particle. `spawn()` takes 23
   positional arguments rather than an options object precisely so the hot path
   never builds a descriptor.
2. **Swap-with-last retirement.** The active set is always the dense range
   `[0, count)`, so the GPU upload is one contiguous sub-range and there is no
   free list to walk.
3. **Cached `updateRanges`.** three's `BufferAttribute.addUpdateRange()`
   allocates a `{start, count}` object, and `WebGLAttributes` clears the list
   after every upload. Calling it once per attribute per frame measured **156
   bytes of garbage per call** — 12 calls a frame. `_flush()` pushes a cached
   record and only re-pushes when the renderer actually cleared the list.
4. **Typed-array scratch instead of module-level `let`.** V8 boxes a double
   stored into a module binding or a plain object property. The nine-float
   direction/tangent/bitangent scratch in `effects.js` was originally nine
   `let`s; a single concrete impact writes it ~45 times, which measured **~670
   bytes of garbage per bullet hole**. It is now a `Float32Array(9)`. The same
   fix applies to `FxSystem`'s camera cache and elapsed time (`Float64Array(4)`).
5. **`FxRand`.** `src/core/rng.js` returns `(uint32) / 2^32`; both the `>>> 0`
   and the quotient escape V8's small-integer range, so **every `rng.next()`
   call boxes a HeapNumber** — measured ~4.5 B/call, and a concrete impact draws
   ~65 of them. `src/fx/rand.js` draws `rng('fx')` **once** at construction into
   a fixed 8192-entry `Float32Array` and walks that table on the hot path. This
   is not a second RNG: same seeded stream, same determinism, unboxed reads.
   The trade is periodicity after 8192 draws, which is not a pattern a player
   can see. Filed upstream as **DEFECTS.md FX4**.
6. **Bounded, one-off maps.** `_entityPos` and `_muzzle` create one small record
   the first time an entity id is seen and mutate it in place forever after.

**Measured result:** `update()` in steady state with 256 decals live and
particles draining costs **~89 bytes/frame** — inside interpreter noise, and
about 5 KB/s, three orders of magnitude below a V8 young-generation scavenge.
A `surface.impact` costs **~177 bytes** of transient garbage; at 20 impacts/s
that is 3.5 KB/s.

---

## 5. Measured numbers

All from `runFxSelfTest()` on node 24 (`node --expose-gc`), and from a separate
timing harness (timing is not measured inside `src/` — ARCHITECTURE.md §7.2
bans wall-clock reads outside `core/clock.js`).

### Self-test: 32 assertions, 32 pass, 0 fail — 1533 frames stepped

| Metric | Measured | Cap |
| --- | --- | --- |
| Peak particles (both pools) | **3867** | 4000 |
| Peak additive | **2492** | 2600 |
| Peak alpha | **1388** | 1400 |
| Peak decals | **256** | 256 |
| Peak FX lights burning | **24** | 24 reserved |
| Draw calls | **3, every frame** | 3 |
| Scene children contributed | **3, every frame** | 3 |
| Particles dropped at the cap | 22 085 | — |
| Decals replaced oldest-out | 1 624 | — |
| Events handled | 4 118 | — |
| NaN / Inf found | **0** | 0 |
| `update()` allocation | **~89 B/frame** (88.5–89.1 across runs) | < 256 |
| Garbage per `surface.impact` | ~177 B (176–178 across runs) | informational |

The surge window (20 impacts + 8 shots per frame for 80 frames) exists so the
caps are genuinely *hit* rather than merely approached — both pools saturate and
the drop path runs 22 000 times.

### CPU cost (separate harness, node 24, saturated pools)

With **2 368 additive + 1 365 alpha particles + 256 decals live**, integrating,
retiring, sorting the alpha pool and packing all 12 instance attributes:

| | ms |
| --- | --- |
| `update()` p50 | **0.219** |
| `update()` p95 | 0.276 |
| `update()` p99 | 0.333 |
| `update()` worst of 3000 | 0.523 |
| 30 `surface.impact` + 30 `weapon.fired` spawn cost, p50 | 0.068 |

That is **~1.3% of a 16.7 ms frame** at full saturation. Instance upload at
saturation is **217 KB/frame ≈ 12.8 MB/s** at 60 fps.

---

## 6. Limitations — things that are honestly not done

1. **No soft-particle depth fade.** The brief asked for it "if you can get the
   depth buffer from the globals". You cannot, and it is worse than that:
   * `GlobalUniforms` (`src/render/globals.js`) exposes no depth texture
     uniform at all. There is `uAOTex`, `uShadowAtlas`, the light textures —
     no `uDepthTex`.
   * Even if it did, pass 8 renders into `renderer.hdr`, whose **depth
     attachment *is* `prepass.depthTex`**. Sampling a texture that is currently
     attached to the bound framebuffer is a framebuffer feedback loop; WebGL2
     makes the draw an error rather than reading stale texels. Soft particles
     need a *copy* of depth, or a second depth target, and both belong to
     `lighting` (S1). Filed as **DEFECTS.md FX3**.

   What ships instead: particles are hard depth-**tested** against the opaque
   depth buffer with depth write off, so they are correctly occluded by
   geometry — they just intersect it with a hard edge instead of fading. On the
   large soft dust and smoke puffs that edge will be visible where a puff meets
   the ground. This is the single most visible shortfall in the system.

2. **Decals are oriented quads, not projected boxes.** Same root cause: a true
   projected decal reconstructs world position from depth. A quad offset 1.2 cm
   along the reported normal, with polygon offset, is correct on flat surfaces
   and will visibly clip through geometry on a convex edge or a tight corner.

3. **Alpha-pool sorting is per-particle, not per-fragment.** The insertion sort
   over a persistent permutation is correct back-to-front for particle centres,
   but two large intersecting smoke puffs still blend in centre order. Standard
   for this technique; visible only on heavily overlapping smoke.

4. **The two pools saturate independently.** Total peak is 3867 of 4000 rather
   than exactly 4000 because additive can fill while alpha still has room. The
   4000 cap is a genuine hard ceiling, but the split (2600/1400) is a fixed
   guess, not a measured optimum from real gameplay.

5. **`vehicle.impact` is frequently dropped.** Its payload has no `point[3]`
   (ARCHITECTURE.md §4.6), so FX places it at the vehicle's last known position
   from `entity.spawned` / `damage.applied` / `vehicle.destroyed`. If a vehicle
   has never been damaged or spawned into the FX cache, the impact produces
   **nothing** and increments `stats.skippedNoPosition`. Filed as **FX1**.

6. **`weapon.overheat` needs a prior `weapon.fired`.** Also positionless. The
   vent plume attaches to the owner's last known muzzle; an overheat with no
   preceding shot from that owner is skipped. Filed as **FX2**.

7. **Grenade trails are ballistic estimates, not the real grenade.**
   `grenade.thrown` carries no `grenadeId` (DEFECTS.md **AUDIO2**, same gap),
   so a trail cannot be bound to a grenade. FX integrates the throw under the
   shared `GRAVITY`, re-anchors it at every `grenade.bounced` (which does carry
   a point and normal), and retires the nearest trail on stick/detonate, with a
   12 m reconciliation gate. Exact for one grenade in flight, right nearly
   always for two, and can mis-assign with three or more in the air at once.

8. **Muzzle flash and tracers are world-space.** They are placed at the
   `muzzle[3]` in the payload, which for the local player is a world position,
   not a view-model position. When `src/player` lands with a view model on
   `LAYER_VIEWMODEL` (its own narrower FOV), the first-person muzzle flash will
   need either a view-model-space variant or a muzzle position that already
   accounts for the view-model projection. FX cannot resolve this alone.

9. **A tracer per shot.** Real weapons tracer every third round. Every
   `weapon.fired` gets one here because the payload gives no round index that
   FX can key off deterministically. At 600 RPM this is 10 short streaks a
   second from one weapon — correct-looking, but denser than the reference era.

10. **Nothing here has been seen.** Every claim about *look* in this document is
    an argument from the spec, not an observation. Shapes, colours, sizes and
    intensities are chosen against ART.md §3/§7 and FEEL.md §4/§7 and are
    verified only for structure (analytic, above threshold, correct palette
    entry), never for appearance. `tools/palette.mjs` shot 11 (`firefight`) and
    shot 10 (`shield_flare`) are the real gates and require a GPU.

11. **`FxRand` periodicity.** 8192 pre-drawn values. Long enough that no effect
    repeats visibly, but it is a table, not a stream.

12. **Three's own allocations are not eliminated.** `l.position.set(...)` and
    `l.color.setRGB(...)` on a clustered light write doubles into plain object
    fields, which V8 boxes. That is a handful of HeapNumbers per active light
    per frame and lives in `three`/`src/render`, not here.

---

## 7. What needs a GPU to verify

Nothing in this directory has been rendered. These are the specific claims a
GPU run must check:

* **Shader compilation.** Both programs are `GLSL3` `ShaderMaterial`s using
  three's built-in `position`, `viewMatrix`, `projectionMatrix` and
  `cameraPosition`, plus `flat` varyings and `fwidth`. They are syntactically
  reviewed but never compiled. **G6 requires zero shader compiles during play,
  so both must be pre-warmed** — `renderer.prewarm()` calls
  `renderer.compile(this.scene, camera)`, which will pick them up provided the
  FX system is constructed *before* `prewarm()`.
* **Bloom crossing.** That 24× / 26× / 34× really do land above the post-exposure
  threshold of 1.0 and bloom the way ART.md §7.2 P8 describes, without clipping
  to white and failing P4 (highlight saturation ≥ 0.25).
* **Readability, FEEL.md §4.6.** That the frag indicator blink actually reads
  against the sky and the plasma ribbon actually reads against ground. Both are
  argued from the palette here; only shot 11 settles it.
* **Blend correctness.** Premultiplied `(ONE, ONE)` and `(ONE, ONE_MINUS_SRC_ALPHA)`
  against an `RGBA16F` target, with the composite's hue-preserving tonemap on
  top.
* **Draw-call count.** The self-test asserts FX contributes exactly three scene
  objects every frame; that they resolve to exactly three GL draw calls is
  `renderer.info.render.calls` in `tools/profile.mjs`, not something node can
  see.
* **Decal z-fighting.** The 1.2 cm normal offset plus polygon offset at a 0.05 m
  near plane is a calculation, not an observation.
* **G6 perf.** The 0.219 ms CPU figure is real; the GPU cost of up to 3867
  overlapping additive quads at DPR 2 is entirely unmeasured and is the most
  likely place this system blows a frame budget. If it does, the fix is the
  fixed caps in `constants.js` and the LOD thresholds in `index.js`
  (`LOD_NEAR` 45 m, `LOD_FAR` 90 m, `FX_CULL` 260 m), both already in place.

---

## 8. Running the self-test

```
node --expose-gc -e "import('./src/fx/selftest.js').then(async m => { \
  const r = m.runFxSelfTest({ verbose: true }); \
  console.log(JSON.stringify(r.metrics, null, 2)); \
  console.log('passed', r.passed, 'failed', r.failed); \
  process.exit(r.failed ? 1 : 0); })"
```

`--expose-gc` is optional; without it the allocation assertion reports
`skipped` and passes. Everything else runs either way. `three` works headless in
node for all of this — the only thing it cannot do is actually rasterise.
