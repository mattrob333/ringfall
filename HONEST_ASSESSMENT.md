# RINGFALL — HONEST ASSESSMENT

Every specific shortfall and every unfixed root cause. An unfixed root cause that is documented
is acceptable. One hidden behind a compensating constant is not.

Written against measurements in `artifacts/`, not against impressions.

---

## 1. What actually got built and verified

| Area | State | Evidence |
| --- | --- | --- |
| Render pipeline | Complete, running on a real GPU | 12-shot capture, 0 console errors, RTX 4070 Ti via ANGLE D3D11 |
| Performance | Comfortably inside gate G6 | p50 370 fps, p99 196 fps, worst frame 11.1 ms, 0 shader compiles in play, boot 289 ms, DPR 2 (2560×1440 internal), 1182 draws, 371k tris, 45 cluster lights |
| Physics | 8/8 self-tests | swept capsule, step-up, slope, restitution, OBB raycast, determinism |
| AI | 28/28 self-tests | panic cascade at 0.800 s over 120 measurements, barrier block, VANE shield timing, acquisition miss grace, determinism across 3 processes |
| Vehicles | 7/7 self-tests | 0→18 m/s in 4.275 s, rollover at 1.270 g, self-right at 1.208 s, determinism |
| FX | 32/32 self-tests | peak 3867/4000 particles, 3 constant draw calls, 0 NaN, ~89 B/frame allocation |
| Characters | ART.md §8 silhouette gate passes; one helper defect open | pairwise IoU max 0.550 (limit 0.60), aspect range 0.647 (floor 0.55), 704–1052 tris. `barrierBlocks()` off-axis arc still mis-resolves (`DEFECTS.md` CHAR2) |
| Weapons sandbox | **46/46 self-tests** | full FEEL.md F01-F42, F50-F53 block; see §3 |
| Playtest | 11/11 checks | 60 s scripted, 1013 shots, 44 impacts, 16 AI alerts, 0 console errors |
| Palette gates | 10/12 | see §2 |
| Capture determinism | **12/12 shots bit-identical across 3 runs** | gate for Phase 2, verified late — see §5 |
| Feel assertions | **120/120 pass**, 6/55 ids uncovered | see §3 |
| Production build | 834 kB (230 kB gzip), assetguard clean on the bundle | zero binary assets ship |

---

## 2. Art shortfalls, measured

### 2.1 ART.md P2 global contrast — **NOT MET** (`DEFECTS.md` ART1)

Target 8:1–20:1. Measured median across all 12 shots: **5.72**.

Per shot: `enemy_15m` 26.7, `shield_flare` 18.9, `firefight` 16.0, `int_corridor` 6.7,
`ext_vista` 6.1, `night_emissive` 6.1, `weapon_close` 5.4, `int_hall_emissive` 5.3,
`vehicle_ext` 4.3, `enemy_60m_sil` 3.1, `ext_ground` 2.6, `sky_only` 2.6.

Two things are true and I could not separate them without a reference image:

1. **The gate's shot set is wrong.** Frames containing architecture land inside or above the
   window. Frames that are open sky over flat grass are low-contrast *by content* and cannot
   reach 8:1 under any lighting. Averaging them measures level composition, not light.
2. **There may still be genuine flatness.** One real cause was found and fixed: fog density
   tuned to satisfy P5 (≥22% haze at 60 m) also laid 9.9% haze on a wall 20 m away, lifting
   every shadow. Adding a 15 m clear-air onset dropped that to 2.8% with all three P5 spec
   points still passing, and moved the median 4.65 → 5.72. That is a real improvement and it
   is not enough to reach the window.

**Root cause not fully resolved.** I declined to keep pushing exposure or fog to hit a number I
wrote in Phase 0 before anything had been measured, because that is precisely the failure mode
the brief describes. The honest statement is: the number is unmet, the gate is partly
mis-specified, and I do not know the correct target without a reference to measure against.

### 2.2 ART.md P10 high-frequency budget — **partially met, and the tool is a proxy** (ART2)

`int_hall_emissive` 0.024, `weapon_close` 0.012, `enemy_15m` 0.055 all pass against ≤0.06.
`int_corridor` measures 0.115 and fails.

The measure is a **box-blur residual, not the radially-averaged 2D FFT ART.md §9 specifies.**
It cannot distinguish surface high-frequency detail from legitimate geometric silhouette edges.
Proof it is measuring the wrong thing: `int_corridor` went 0.079 → 0.115 across a change that
altered only fog onset and touched no surface pattern whatsoever. The underlying design
constraint (§2, all detail analytic and structural, no FBM below 25 cm) is satisfied by
construction — there is no noise term in any shipped material to regress.

### 2.3 Emissive hue ceiling (ART3)

A violet emissive cannot hold HSV S ≥ 0.25 above post-exposure luminance 1.22. This is a
display-gamut property, not a tonemap defect: lowering `DESAT_STRENGTH` from 0.22 to 0.08 moved
it only 0.195 → 0.226. Measured crossovers — cyan never, orange never, yellow never, mint 3.54,
violet 1.22. Shipped values all pass (violet runs at L=0.40, S=0.496). ART.md §3.3 permits up to
8× adjacent diffuse (≈2.7 post-exposure), which would breach it. Recorded as ART.md amendment A2
so a future art pass does not walk into it.

### 2.4 Gates never implemented

`tools/palette.mjs` implements **P1, P2, P3, P4, P10 only**. **P5 (aerial perspective at
60/200/500 m), P6 (sky/ground convergence), P7 (emissive ratio), P8 (bloom extent), P9 (weapon
luminance match), P11 (family hue separation) and P12 (megastructure coverage) are NOT
measured.** Their values are computed by hand in comments and code, and they are believed
correct by construction — the fog inscatter and the sky dome call the same `skyRadiance()`
function, so P6 holds structurally — but **believed is not measured, and this is a gap.**

`tools/silhouette.mjs` was never written as a standalone tool. The §8 gate is measured instead
inside `src/characters/selftest.js`, which rasterises the masks on the CPU without a GPU. That
gate genuinely passes; the standalone tool named in ARCHITECTURE.md §8 does not exist.

---

## 3. Feel shortfalls, measured

`tools/feeltest.mjs`: **120 assertions pass, 0 fail**, across 6 suites, after wiring the player suite injection described in §3.2.

### 3.1 Resolved during the final pass

Four assertions were failing when this section was first written. All four are now resolved, and
how they resolved is more informative than the fact that they did:

| ID | Assertion | Outcome |
| --- | --- | --- |
| F25 | Charged `Vess Sidearm` strips a full 70 shield in one bolt | **Real bug, fixed by its owner.** A charge accumulator summing 1/120 over 144 ticks landed on `1.1999999999999997` against a 1.2 s threshold, so the release silently emitted an *uncharged* `PLASMA` 8 instead of an `EMP` 25 bolt. Measured shield 57.2 remaining; 70 − 57.2 = 12.8 = 8 × 1.60 identified it exactly. Now 70 → 0, health untouched. |
| F26 | Golden-combo TTK | Followed from F25. Now **2.192 s** against 2.17 ±0.12. |
| F23 | `Ember Repeater` full TTK | **Spec was wrong, code was right.** Corrected to 2.80 s. Note the owner derived a *second*, subtler reason beyond my interval-count error: `resolveDamage()` bleeds the shield-breaking round's overkill into health, so the health phase starts at 42.66, not 45 — 13 finishing rounds, not 14. |
| F34 | Frag lethal radius, unshielded | **Spec was wrong, code was right.** Corrected to 2.23 m; the implementation matched the analytic answer to 5 decimal places. |

**Current state: 120/120 assertions pass.** No tolerance was loosened to get there — the two
spec corrections carry derivations in `FEEL.md` and `CONTRADICTION.md`.

### 3.2 Coverage gap — narrowed, but still real

When first measured, **26 of 55** `FEEL.md` §8 assertions were claimed by no suite. The cause was
a missing injection contract: `runSandboxSelfTest` covers F01–F17 only when the player suite is
passed *into* it, because `src/weapons` and `src/player` are both L5 and the lattice bans
sideways imports. Called bare it reported those 20 as `skipped`. Wiring it in `tools/feeltest.mjs`
took coverage from 29/55 to **49/55**, and the whole locomotion and shield/health block is now
genuinely measured: 4.400 m/s, 0.900 strafe ratio, 75.0 ms acceleration, 1.050 m apex, 0.950 s
airtime, 4.017 s / 2.492 s shield cycle, 8.000 s / 4.992 s health cycle.

**Six remain uncovered: F45, F47, F48, F49, F54, F55.** Four of those (F45, F47, F48, F49) *are*
genuinely tested — by the `vehicles` and `ai` suites, under their own names rather than the
`FEEL.md` ids, so the aggregator cannot credit them. **F54 (frame-rate independence at 30/60/144
Hz) and F55 (bit-identical transforms from identical input) are genuinely untested.**

`feeltest.mjs` prints the uncovered list on every run rather than letting silence read as a pass.
That property is what surfaced the injection gap at all — a quieter aggregator would have shipped
claiming full coverage.

### 3.3 Two damage resolvers (`DEFECTS.md` AI4 / AI4-C) — **architectural defect, compensated**

`ARCHITECTURE.md` §4.1 names three emitters for `damage.applied` (`weapons`, `vehicles`, `game`).
That was a mistake in the contract. `src/weapons` resolves damage and writes `state.shield/health`
directly; but archetype mitigation (the CULL frontal barrier, WARDEN plates) is knowledge only
`src/ai` has. Measured: a CULL shot in the front arc with `Vector BR` went health 55 → 0 and
died, where FEEL.md §6 requires **0** damage.

The `ai` owner compensated inside its own directory with an authoritative snapshot and re-resolve,
carrying a `// COMPENSATION:` comment and a `DEFECTS.md` entry as the rules require. After it,
F48 is correct. **It is a workaround, not a fix:** it cannot un-emit events `weapons` already
sent, so `entity.killed` double-fires (measured 2× over a 5 s burst), which means kill audio and
kill FX can trigger twice.

The correct fix is a single resolver — the target's owner resolves and emits, and `weapons`
only reports the hit. That is a shared-contract change and it is **not done**.

---

## 4. Known-weak subsystems, in their owners' own words

* **AI has no pathfinding.** Whisker sphere-casts plus local steering. **Concave geometry traps
  agents.** Cover points are sampled from one spawn position within 42 m; choosing a point is not
  the same as being able to reach it. Agents never patrol or investigate — verified: 5 agents
  stayed IDLE for 30 s in a sight-blocked pillar field. AI perf was measured at 5 agents
  (20 µs/tick idle, 89–166 µs/tick combat); the 20-agent figure in its README is an
  extrapolation and is labelled as one.
* **FX has no soft-particle depth fade, and it cannot be obtained** in the current frame graph:
  the HDR target's depth attachment *is* the prepass depth texture, so sampling it during the
  transparent pass is a framebuffer feedback loop. Particles are hard depth-tested instead, so
  large smoke puffs meet the ground on a hard edge. Decals are oriented offset quads rather than
  projected boxes for the same reason, and will clip on convex edges.
* **Physics**: heightfield collision and raycast are a bilinear march, not per-triangle, with no
  lateral cliff-face collision. Characters and dynamic bodies collide with statics only — never
  with each other. No sleep/wake. `removeStatic` tombstones rather than compacting.
* **Vehicles**: chassis-vs-world is a bounding-sphere sweep, not the real box, because physics
  exposes no box sweep. Because dynamic bodies do not collide, **vehicle ram damage and
  vehicle-vs-character collision do not actually occur in play.** No drag force, so the vehicle
  coasts at constant speed with the throttle released.
* **Audio**: 14 event payloads carry no world position, so those cues play dry and centred
  regardless of distance — an AI's melee whoosh is as loud at 50 m as at 2 m. Reverb has two
  presets and nothing selects between them, because no room/zone signal exists in the event
  vocabulary. **Nobody has heard any of it**; the synthesis is verified to execute, not to sound
  correct.
* **UI**: the low-health desaturation is a warm-grey wash, not real desaturation, because the HUD
  is a separate 2D canvas and cannot desaturate the WebGL layer beneath it. Its draw cost at DPR 2
  was never measured on a GPU.

---

## 5. Process and harness caveats

* **`baseline/` is gitignored.** 12 shots × 3.6 MB is ~44 MB of binary per capture, which does not
  belong in git. The consequence is that `tools/imagediff.mjs` (gate G8) only works within a
  working copy that has run `--accept`; it cannot compare against a reference on a fresh clone.
  Shot SHA-256 hashes ARE committed in `artifacts/baseline.json` when captured, but artifacts are
  gitignored too. **G8 is therefore not enforceable in CI as shipped.**
* **Determinism was verified late.** The brief requires `baseline.mjs` bit-identical across three
  runs before Phase 2 opens. It was run as a single capture for most of the build and only
  verified 3× at the end. If it had drifted, earlier visual comparisons would have been suspect.
* **Only one machine, one GPU, one driver.** Every number here is from an RTX 4070 Ti through
  ANGLE D3D11. Nothing has been checked on AMD, Intel, Mac, or a real headless server.
* **The four-critic protocol in ARCHITECTURE.md §11 was never run as written.** There was no
  round-by-round defect ledger with counts, and no round was reverted for raising defect count.
  Defects were found and fixed continuously against measurements instead. The rubric structure
  exists in the document; the process it describes did not happen.

---

## 6. The honest summary

The thing that most distinguishes this build from the 5.05/10 attempt described in the brief is
that **the target was chosen to suit the constraint, and the failure modes were made measurable.**
Analytic, hard-edged surface detail cannot regress into noise, because there is no noise term.
Fixed exposure cannot spiral, because there is no adaptive term to spiral. Both are structural,
not disciplined.

Six defects in this build were found by a tool rather than by looking, and four of them were
**defects in my own specification or my own tools** rather than in the code they accused:
`readPixels` returning 3,686,400 zero bytes; the P4 gate sampling the sun disc; `layercheck`
flagging comments; `ART.md` A1 demanding 30 px from a character that can only be 24.3 px. Two
`FEEL.md` TTK numbers were arithmetically wrong and the implementations were right. That ratio is
the useful result: without the measurement layer I would have "fixed" working code four times.

What I am least confident about: **feel.** Performance is measured, the art is partly measured,
but the locomotion block that defines how the game actually plays is implemented and unverified,
and nobody — human or agent — has ever played it.
