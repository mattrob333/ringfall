# src/physics — algorithms, determinism, limitations

Owner: `physics`. Headless (no `src/render` import — this must run under
`tools/feeltest.mjs` with rendering disabled). Permitted imports: `three`,
`../shared/*`, `../core/*`.

## Files

| File | Contents |
| --- | --- |
| `index.js` | `PhysicsWorld` — the public API. Owns static storage, the broadphase grid, and the character/body lists. |
| `geometry.js` | Shape records (`StaticBox`, `StaticSphere`, `Heightfield`) and closed-form primitives: `raySphere`, `rayObb`, `rayHeightfield`, `closestPointOnObb`, `pointInObb`/`pointInSphere`, `obbPenetration`, `closestParamOnSegment`. |
| `sweep.js` | `capsuleVsObb`, `capsuleVsSphere` (discrete capsule/shape overlap + push-out) and `sphereCastObb`/`sphereCastSphereShape`/`sphereCastHeightfield` (continuous swept-sphere vs shape). |
| `grid.js` | `UniformGrid` — the XZ broadphase. |
| `character.js` | `CharacterBody`. |
| `body.js` | `DynamicBody`. |
| `selftest.js` | `runPhysicsSelfTest()`. |

## Static world representation

Exactly three shape types, per the brief — no general triangle mesh:

- **OBB** (`center`, `halfExtents`, `quaternion`) — the workhorse. Stored with
  its quaternion's inverse precomputed once at construction so every
  world→local transform in the hot path is a single `applyQuaternion` call,
  no per-call inversion.
- **Sphere** (`center`, `radius`).
- **Heightfield** — one per world (`setHeightfield` replaces any previous
  one), a regular grid of `Float32` heights sampled with **bilinear**
  interpolation, with the surface normal taken as a **finite-difference**
  estimate (central difference at half a cell width), not a per-triangle
  face normal. This is a deliberate simplification — see Limitations.

## Broadphase

`grid.js` is a uniform grid over XZ, default cell size 8 m (per the brief).
Boxes and spheres are inserted into every cell their XZ footprint (the box's
world-space axis-aligned bounding rectangle, computed once from its 8
corners) overlaps. The grid is **rebuilt lazily**: `addStaticBox`/
`addStaticSphere`/`removeStatic` only set a dirty flag; the actual rebuild
happens the next time any query needs it (`_ensureGrid`). `removeStatic`
tombstones the shape (`shape.removed = true`) rather than compacting the
backing arrays immediately — see Limitations.

The heightfield is not grid-indexed (there is at most one, and every query
tests it directly in addition to the grid).

## Queries: raycast / sphereCast / overlapSphere / pointInSolid

All four are **static-geometry only** — they do not see `DynamicBody` or
`CharacterBody` instances. `raycast` and `sphereCast` return `null` or
`this._hit`, **one shared record per `PhysicsWorld` instance**, exactly as
specified: copy the fields you need before calling another query. Internally,
character step-up/ground-snap sweeps and `DynamicBody` continuous collision
use their *own*, separate scratch hit records, so an internal sweep mid-tick
can never clobber a hit record a caller obtained from the public API earlier
in the same tick.

`overlapSphere` fills the caller-owned `out` array, growing it lazily (an
element is only ever `new`-ed the first time that index is used — reuse the
same array across calls for zero allocation in steady state).

## Continuous collision: why a ternary search + bisection

`sphereCastObb`/`sphereCastSphereShape`/`sphereCastHeightfield` sweep a
**point + radius** along a ray against a shape, exactly. The trick: distance
from a *moving point* to a *fixed convex set* is a convex function of the
travel parameter `t` (distance-to-convex-set is convex in the point, and a
translating point is an affine function of `t`; a convex function composed
with an affine map is convex). So `f(t) = distanceSquared(point(t), shape) -
radius²` is convex and therefore unimodal — it decreases to one minimum, then
increases. That means:

1. A fixed-iteration **ternary search** (40 iterations) finds the minimizer
   `t*` of `f` over `[0, maxDist]`.
2. If `f(t*) > 0`, the sweep never touches the shape inside `maxDist` — miss.
3. Otherwise, since `f` is convex and `f(0) > 0` (we assume the sweep doesn't
   start already overlapping — that case is special-cased and returns `t=0`
   directly), `f` is monotonically non-increasing on `[0, t*]`, so a
   fixed-iteration **bisection** (40 iterations) on that sub-interval finds
   the first crossing — the true time of impact.

This is exact for the sphere (closed-form quadratic, used directly instead)
and for the box (`closestPointOnObb` is a per-axis clamp, making `f`
piecewise-quadratic — still convex, still unimodal). It is what makes
`DynamicBody`'s continuous collision (grenades) genuinely exact rather than
substep-approximate: **the whole remaining motion for a bounce segment is
sphere-cast in one shot**, so a 19 m/s grenade cannot tunnel through a thin
wall regardless of frame rate.

`sphereCastHeightfield` cannot use this trick (a heightfield is not convex),
so it is a **marched approximation**: sample clearance at a fixed step
derived from `cellSize`, then bisect the bracketing interval. See
Limitations.

## CharacterBody: swept-capsule collide-and-slide

A capsule (two spheres of the same radius joined by a segment) is not
convex-in-translation the same cheap way a single point is, so
`CharacterBody.move()` does not use the ternary/bisection trick directly.
Instead:

1. **Fixed-size sub-stepping.** `move(displacement)` splits the requested
   displacement into pieces no longer than `max(radius * 0.5, 0.02)` m,
   capped at 48 sub-steps. This bounds how far the capsule can travel
   between collision tests — the wall-tunneling selftest throws 100 m/s at a
   0.3 m wall specifically to prove the substep size is smaller than the
   thinnest wall we need to guarantee.
2. **Per-substep collide-and-slide**, up to 4 iterations (`_slideFrom`):
   each iteration finds the *single deepest* overlapping static shape
   against the capsule at the candidate position (`_findPenetration`, using
   `capsuleVsObb`/`capsuleVsSphere` — an 8-iteration alternating-projection
   closest-point search between the capsule's medial segment and the shape;
   segment and box are both simple convex sets, 8 iterations converges well
   past floating-point-noise level for the shapes this engine has), then
   **binary-searches (12 fixed iterations) the largest fraction of the
   remaining displacement that stays clear**, advances to that point, and
   clips the *unspent* fraction against the contact normal for the next
   iteration. A final depenetration safety net corrects any residual overlap
   directly.

   The binary-search-for-partial-progress step is not optional: testing only
   the two endpoints of a substep (an earlier, simpler version of this
   method did exactly that) means a substep whose *full* displacement is
   blocked gets **zero** progress even when most of the substep's length was
   free room — e.g. a wall 0.08 m away and a 0.17 m substep would report
   "blocked" and never move at all, rather than advancing the 0.08 m that
   was actually free. The project's own selftest caught this as a real bug
   during development (see the git history / commit for this module); it is
   recorded here because ARCHITECTURE.md §0.2 requires every fix to carry a
   measurement, and "the capsule didn't move at all near a wall" was that
   measurement.
3. **Slopes vs walls.** A contact's normal is classified as ground only if
   `normal.y >= cos(maxSlopeDeg)`. A steeper contact is a wall: it still
   blocks/deflects the slide, it just never sets `grounded`.
4. **Step-up.** If a substep's plain slide (step 2) is blocked and the
   substep has a horizontal component, the capsule is virtually lifted (up
   to `stepHeight`, less if a sphere-cast straight up finds a ceiling
   sooner), the same substep displacement is re-tried at that height, and if
   — critically — **that raised attempt is fully unobstructed**
   (`!resultB.blocked`), a sphere-cast straight down settles the capsule onto
   whatever is below. The `!resultB.blocked` requirement is the fix for a
   second real bug found via the selftest: accepting the raised attempt
   merely because it "advanced further than the flat attempt" let the
   capsule climb a ledge *taller* than `stepHeight`, one bisection-fraction
   at a time, because the down-sweep sphere (radius = capsule radius)
   touching the ledge's top corner reports a blended edge normal that can
   coincidentally clear the walkable-slope threshold even when the capsule
   never actually cleared the obstruction. Requiring a genuinely unobstructed
   raised slide closes that hole.
5. **Ground snap.** If the capsule was grounded before `move()` and ends the
   substep loop ungrounded, a final sphere-cast straight down (distance =
   `stepHeight`, or 0.3 m if `stepHeight` is 0) looks for ground within reach
   and snaps onto it if the slope is walkable — this is what stops a shallow
   downhill slope from launching the character for one tick every time
   gravity's per-tick descent is smaller than the slope's drop.

`CharacterBody.velocity` is **not** an input — it is derived after the fact
as `(finalPosition - startPosition) / SIM_DT` (a fixed constant from
`shared/tuning.js`, since the sim always runs at 120 Hz), purely for the
owner's convenience (e.g. computing landing impact speed).

## DynamicBody: exact continuous collision, restitution/friction split

`DynamicBody._step(dt, world)` integrates gravity (the single `GRAVITY`
constant — no per-body scale, per FEEL.md F50 / ARCHITECTURE.md §12 A1),
then repeatedly sphere-casts the **entire remaining motion for this step** in
one shot (see the ternary+bisection argument above — this is exact, not a
substep hack) and resolves a bounce when it finds one, up to 4 bounces per
step (bounded, same rationale as the character's slide-iteration cap: a
cluttered corner should not spin the loop forever).

Restitution and friction are each **the body's own value multiplied by the
struck surface's `SURFACE_PHYSICS` value, then clamped to `[0, 1]`** — per
the brief. The bounce splits velocity into its normal and tangential
components *before* either is touched:

```
vn = normal * dot(velocity, normal)
vt = velocity - vn
velocity' = vn * (-combinedRestitution) + vt * (1 - combinedFriction)
```

Friction only ever scales `vt`; restitution only ever scales `vn`. This is
why F32 (frag grenade, restitution 0.42 vs `METAL_PAINTED`) measures cleanly:
a straight-down drop has a purely-normal impact velocity (`vt = 0`), so
friction cannot leak into the bounce at all, and the measured self-test
result (see below) matches the analytic `e²` energy ratio to within
numerical-integration noise.

`stuckTo` is a plain nullable `{entityId, localPoint}` field. When set, the
body's integration is **entirely skipped** — physics does not know what a
"character" or "entity transform" is (it only knows static shapes, dynamic
spheres, and capsules), so a plasma grenade sticking to a Cull or a player is
the *weapons* system's decision (it detects the hit, e.g. via `overlapSphere`
against its own entity bounds, and sets `stuckTo` itself) and the weapons
system is likewise responsible for moving `body.position` to track the
target entity every tick thereafter. Physics only guarantees it will not
overwrite that position.

## Determinism argument

1. **No wall-clock, no `Math.random`.** Grep-verified: neither
   `Date.now`/`performance.now` nor `Math.random` appears anywhere under
   `src/physics/`. `SIM_DT` (a compile-time constant, 1/120) is used for the
   one place this module needs a time step it wasn't handed
   (`CharacterBody.velocity` bookkeeping) — never a wall-clock read.
2. **No RNG at all.** Nothing in this module currently needs randomness. If
   that ever changes, it must go through `rng('physics')` from
   `../core/rng.js` — there is no other sanctioned source.
3. **Only plain-array iteration in every hot path.** The uniform grid's
   `Map` is used exclusively for O(1) key→bucket lookup, keyed by an integer
   cell coordinate — it is never iterated. Every query walks an explicitly
   ascending `(cx, cz)` nested loop and then a plain `Array` bucket (whose
   order is insertion order, which is itself a deterministic function of the
   deterministic call sequence that built the level). `PhysicsWorld` uses a
   `Map<handle, shape>` for `removeStatic` lookups only — also never
   iterated. The only other `Map`/`Set`-shaped state in the whole module is
   that grid-bucket map; nothing in the step loop (`PhysicsWorld.step`,
   `CharacterBody.move`, any sweep/geometry function) iterates a `Map` or
   `Set`.
4. **Fixed iteration counts everywhere a numeric search is used** — the
   sweep's ternary search (40) and bisection (40), the capsule/box
   alternating-projection closest-point search (8), the slide loop's
   per-iteration partial-advance bisection (12), the slide loop itself (4),
   the bounce loop (4 per `DynamicBody` step). None of these loops have a
   convergence-based early exit whose iteration count could vary run to run
   for the same input — they always run their fixed count (the few early
   `return`s that exist — e.g. "no penetration found", "already touching at
   t=0" — are taken deterministically from the same floating-point inputs).
5. **Verified, not asserted.** `runPhysicsSelfTest()`'s determinism case runs
   an identical 600-step scene (one `CharacterBody` walking a scripted path
   plus one `DynamicBody` bouncing) twice from a freshly constructed
   `PhysicsWorld` each time, and requires the final position/velocity arrays
   to be **exactly** `===` equal component-wise (not "close to" — literal
   float64 bit-equality). This was additionally run across two **separate
   `node` process invocations** (not just twice in the same process) during
   development, and matched byte-for-byte both times.

## Known limitations — stated plainly, not hedged

- **Heightfield collision is an approximation, not exact.** Ground contact
  and raycasts against a heightfield use bilinear height sampling and a
  finite-difference normal, not a true per-triangle intersection. A
  raycast/sphere-cast against a heightfield is a **marched** search (fixed
  step derived from `cellSize`, then bisected) — a feature narrower than
  half a cell can be stepped over entirely. There is no lateral
  (capsule-vs-cliff-face) collision against a heightfield at all: a
  character can only be stopped by heightfield *height*, never by walking
  into the side of a steep heightfield feature the way it would be stopped
  by an OBB wall. Steep terrain should be modelled with OBBs, not encoded
  purely in the heightfield, until this is addressed.
- **CharacterBody vs CharacterBody, or CharacterBody vs DynamicBody, do not
  collide.** All world queries and all character/body collision are against
  **static geometry only**. Two players cannot push each other via this
  module, and a rolling grenade will pass straight through a standing
  character. Any character-vs-character or character-vs-projectile
  interaction has to be handled by whichever L4/L5 system owns entity
  bounds (typically via `overlapSphere` against the target's own hitbox,
  which this module happily supports as a primitive — it just doesn't do it
  automatically).
- **`removeStatic` tombstones rather than compacting.** A removed shape's
  slot in `_boxes`/`_spheres` is marked `removed = true` and skipped by grid
  rebuilds and queries, but the array entry itself is never spliced out.
  `clearStatics()` is the only way to reclaim that memory. A level that adds
  and removes thousands of destructible statics over a long play session
  without ever calling `clearStatics()` will leak array slots (not memory
  for removed *neighbours* in the grid — those get dropped on the next
  rebuild — just the flat shape-list entries). Fine for a level-scoped
  world; would need a compaction pass for a "infinite destructible sandbox"
  use case this game does not have.
- **The capsule's swept guarantee is a substep-size argument, not a
  closed-form time-of-impact solve.** `move()` is robust against tunneling
  because every substep is capped at `max(radius * 0.5, 0.02)` m and every
  substep's target is validated as genuinely reachable via the partial-
  advance bisection — but this means a **very** thin obstacle (thinner than
  the substep size, i.e. under roughly `radius * 0.5`) is not guaranteed to
  stop the capsule at extreme per-substep speeds. `DynamicBody`, by
  contrast, has an honest closed-form solve and no such caveat.
- **Step-up and ground-snap use vertical sphere-casts of the capsule's own
  radius**, not the exact swept capsule. This is exact for purely vertical
  motion (the capsule's horizontal cross-section is constant along its
  height, so sweeping the top/bottom sphere straight up/down is equivalent
  to sweeping the whole capsule) but means step-up specifically assumes the
  ledge is directly reachable by a vertical probe from the capsule's own
  footprint — an overhanging or undercut ledge geometry is not modelled.
- **No dynamic-vs-dynamic broadphase.** The uniform grid only ever indexes
  *static* boxes/spheres. `DynamicBody` and `CharacterBody` instances are
  kept in flat arrays with no spatial index at all; `PhysicsWorld` does not
  need one today (nothing queries "which dynamic bodies are near X"), but if
  a future system wants dynamic-vs-dynamic queries, that's new code, not a
  hidden capability of the existing grid.
- **No sleeping/wake mechanism beyond a speed threshold.** A `DynamicBody`
  goes to sleep (`sleeping = true`, velocity zeroed) after its speed stays
  below `sleepThreshold` for 0.4 s running, and there is no automatic wake —
  an owner that wants to disturb a sleeping body (e.g. an explosion nearby)
  must set `sleeping = false` and `velocity` directly; both are plain public
  fields, this is intentional, not an oversight, but it is also not
  automatic.
- **`overlapSphere` against the heightfield tests only the query centre's
  column**, not the true closest point on the terrain surface within the
  sphere — for a heightfield with significant local slope this can under- or
  over-report at the margins of the query radius.

## Self-test results (measured, not predicted)

Run via `runPhysicsSelfTest()` from `selftest.js`. All 8 assertions pass as
of this writing; representative measured numbers from a real run (`node`
24.13.0, this repo's pinned `three` 0.185.1):

| Assertion | Measured | Expected | Notes |
| --- | --- | --- | --- |
| Capsule cannot tunnel a 0.3 m wall at 100 m/s | stops at x=4.45 | wall face at x≈4.85−radius, i.e. ≤5.25 | never exceeds the wall's near face + radius across 40 repeated ticks |
| Step-up over 0.4 m ledge | succeeds | succeeds | reaches the ledge top, `grounded === true` |
| Step-up over 0.5 m ledge (stepHeight 0.42) | fails | fails | stops flush against the ledge's vertical face at x=1.58 and stays there |
| Slope 45° (maxSlopeDeg 48) | walkable | walkable | `grounded === true` after settling |
| Slope 55° (maxSlopeDeg 48) | not walkable | not walkable | `grounded === false` — treated as a wall |
| Restitution vs `METAL_PAINTED` (0.42) | bounce rise 0.859 m | analytic 0.864 m (drop 4.9 m × 0.42²) | 0.6% low — normal numerical-integration loss over ~120 discrete steps to the first bounce, well inside the ±3% budget |
| Raycast vs a 45°-yawed unit-cube OBB | hit.x = 8.585786437626906 | analytic 8.585786437626904 | agrees to 1e-14 |
| Determinism, 600 steps × 2 runs | bit-identical | bit-identical | verified both within one process and across two separate `node` invocations |

To reproduce: write a throwaway script that imports `runPhysicsSelfTest` from
`./selftest.js`, call it, and inspect `results` — do not leave the throwaway
script in the repo (see ARCHITECTURE.md — this is the orchestrator's tree
outside `tools/`, which only the orchestrator owns).
