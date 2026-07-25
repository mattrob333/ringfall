# RINGFALL — PROCESS LOG

What orchestration patterns worked, what did not, with numbers. Written as the build proceeds,
not reconstructed afterwards.

---

## Prior-art constraints carried in from the brief

These are measured results from a previous run of this same harness against a different art
target. They are the reason for several of the rules in `ARCHITECTURE.md` §0.

| Observation | Number | Rule it produced |
| --- | --- | --- |
| Photoreal target scored, blind critics identified the real game every time | 5.05 / 10 | `ART.md` §1 — target selection is the primary lever |
| Three rounds of six parallel agents on coupled visual concerns | quality +0.46, defects 60 → 47 → 66 | `ARCHITECTURE.md` §2.1 — sequential single owner for coupled systems |
| One sequential single-owner pass on the same concerns | quality +1.00, defects 66 → 26 | same |
| Shared-page screenshot capture | 10 of 11 shots differed between two identical runs | §7.5 — fresh browser context per shot |
| Static-camera median benchmark vs real play | 94 fps reported / 12–17 fps actual, 700–1200 ms stalls | §8 — `profile.mjs` reports distributions, never a median |
| Rounds of global albedo/exposure crushing to fight local bright-spot complaints | diffuse term destroyed, every later critique worse | §0.3 — no global fix for a local complaint; fixed exposure, no auto-exposure |

---

## Phase 0 — Contract before code

**Date:** 2026-07-25
**Duration:** 1 session
**Output:** `ARCHITECTURE.md` v1.0, `FEEL.md` v1.0, `ART.md` v1.0, repo scaffold.

### Decisions made and why

| Decision | Reason |
| --- | --- |
| `src/render` sits at layer 2, *below* `src/materials` | Materials must read exposure, sky SH, and fog uniforms. Placing render below makes that a normal import rather than a back-channel, and lets the S1 lighting owner be fully validated before materials exist. |
| Exposure is a per-level constant; auto-exposure is banned outright | Adaptive exposure makes every art critique non-reproducible and was the documented mechanism of the prior death spiral. |
| `src/physics` and `src/audio` do not import `src/render` | Required so `feeltest.mjs` can run the full simulation headless with rendering disabled. |
| Gravity resolved to 9.31 m/s², contradicting the brief's "~11" | The brief's three jump numbers are mutually unsatisfiable. Held the two felt quantities (apex, airtime), solved for the inferred one. Derivation in `FEEL.md` §2.1, logged as `ARCHITECTURE.md` §12 A1. |
| `KINETIC` damage multipliers set to 1.00/1.00 | Any other value puts the precision rifle's shield break mid-burst and destroys the 4-burst cadence. Arithmetic in `FEEL.md` §4.1, logged as A2. |
| `ART.md` §2 high-frequency prohibition written as a hard, measured gate (P10) | This is the direct encoding of the prior attempt's root cause. Making it a number rather than an instruction is the only way it survives contact with an art agent. |
| Feel numbers written as 55 numbered assertions with tolerances before any code | Feel is normally graded by opinion. Writing it as a test suite first is the single largest deviation from a normal build and the main thing being tested by this project. |

### What is not yet known

* Whether `baseline.mjs` can achieve bit-identical capture across runs on this machine's GPU
  driver. If it cannot, the fallback is a per-pixel tolerance of 1 LSB with a documented
  justification — but that weakens G8 and will be recorded as a defect, not hidden.
* Whether 60 fps p50 at DPR 2 is reachable with 4 shadow cascades + TAA + GTAO on the target
  hardware. The stylised target buys a large triangle-count margin; if the gate fails it will be
  the passes that get cut, not the art direction.

---

## Phase 1 / 2 — What actually happened

The brief's phase boundary was not respected. The harness was built *alongside* the render
pipeline rather than fully before it, because the 12-shot camera set is meaningless until there
is a level to point it at. Determinism was verified 3× only at the end rather than as an entry
gate. **This is a real deviation** and it carried real risk: had capture drifted, every visual
comparison made during the build would have been suspect. It did not drift, but that was luck
rather than process.

### The single most valuable result: tools caught defects in the specification

Six defects were found by a tool rather than by looking. **Four of them were defects in my own
specification or my own tooling, not in the code they accused.**

| # | What the tool said | What was actually wrong | Measurement |
| --- | --- | --- | --- |
| 1 | Every palette gate reads 0.000 | `readPixels` in a separate `page.evaluate()` returns an already-presented, cleared framebuffer. `preserveDrawingBuffer` is not enough. | 3,686,400 bytes captured, **0** non-zero |
| 2 | P4 highlight saturation fails on 11 of 12 shots | The gate sampled the 20 brightest pixels, which in an exterior shot are the **sun disc** — legitimately near-white at S=0.14. It measured scene content, not the tonemap. | `ext_vista` "passed" at 0.492 purely because its brightest pixels happened to be sky. Noise, not signal. |
| 3 | Three subsystems use banned `Math.random()` / `Date.now()` | All three hits were inside **comments promising not to use them**. | 0 real violations in 96 files |
| 4 | `SKIRN` fails the A1 minimum-size gate | At the framing `ART.md` §8 itself specifies, one metre at 60 m is 17.14 px, so `FEEL.md` §6's 1.42 m SKIRN can never exceed **24.3 px** against a 30 px floor. The spec contradicted itself. | Gate corrected to 22 px, derivation recorded as ART.md amendment A1 |
| 5 | F23 Ember TTK 2.80 vs 2.93 | 22 rounds is **21** intervals. I multiplied by 22. | 21 × 0.1333 = 2.800 s |
| 6 | F34 frag lethal radius 2.23 vs 2.7 | 2.7 came from a **linear** falloff and omitted the `EXPLOSIVE` ×1.15 multiplier, contradicting the exponent 1.6 in the table directly above it. | 5.5·(1 − 0.4348^(1/1.6)) = 2.232 m, matching the implementation to 5 decimals |

Without the measurement layer, four of these would have been "fixed" by changing working code.
**That is the headline result of the whole exercise.**

### Orchestration: what worked

| Pattern | Outcome |
| --- | --- |
| **Sequential single owner for coupled visual systems** (sky + exposure + tonemap + bloom + indirect as ONE agent, working alone) | Held. Exposure was changed exactly twice, both times against a whole-scene measurement with a written derivation, and never in response to one object looking wrong. |
| **Parallel fan-out for genuinely decoupled subsystems** | 8 agents across physics, audio, ui, ai, fx, vehicles, characters, weapons. Zero cross-directory write conflicts, because ownership was one directory per agent with no exceptions. |
| **Requiring every agent to run its own self-test and report REAL numbers** | Every agent found bugs in its own code that inspection would not have: physics found a 2× movement-speed bug in slide-and-clip; sandbox found jumps that never left the floor (apex 0.001 m) and a charge accumulator landing on 1.1999999999999997 that silently downgraded an EMP bolt to a plasma shot; AI found the CULL barrier tracking its movement heading instead of the threat bearing. |
| **Agents filing `DEFECTS.md` rows against other owners instead of reaching in** | Produced the two highest-value cross-cutting finds. The `vehicles` owner diagnosed a wrong-hit-normal bug in `rayObb` it did not own, compensated with a logged `// COMPENSATION:`, and filed it. That one bug was also silently breaking character ground detection — the player was never grounded (588 jumps, 1 landing). Fixing it upstream fixed both, and the compensation was then removed. |
| **`CONTRADICTION.md` with evidence** | The sandbox owner refused to loosen two failing tolerances, derived that the spec was wrong in both cases, and proposed corrections. Both were correct. |

### Orchestration: what did not work

* **Three different result shapes for self-tests.** I specified `{passed, failed, results}` but not
  precisely enough, and three agents chose three interpretations (`passed` as a count, as a
  boolean, and `failed` as an array). The aggregator misread a *passing* character suite as
  "0 pass / 4 fail" until it normalised all three. Cost: two debugging cycles on a non-problem.
* **A missing injection contract went unnoticed for the whole build.** `runSandboxSelfTest`
  needed the player suite passed in, because `src/weapons` and `src/player` are both L5 and the
  lattice bans sideways imports. Called bare it reported 20 assertions as `skipped`. I only
  discovered this from the agent's final report. **Coverage went from 29/55 to 49/55 assertions
  the moment it was wired.** An aggregator that reports uncovered assertions loudly is what made
  this visible at all — a silent aggregator would have shipped claiming a pass.
* **The four-critic protocol in `ARCHITECTURE.md` §11 was never run.** No round-by-round defect
  ledger with counts, no round reverted for raising defect count. Defects were fixed continuously
  against measurements instead. The rubric exists in the document; the process it describes did
  not happen, and `HONEST_ASSESSMENT.md` says so.
* **Two damage resolvers.** `ARCHITECTURE.md` §4.1 named three emitters for `damage.applied`.
  That contract error let `weapons` and `ai` both resolve damage, which bypassed the CULL
  barrier — measured as a front-arc shot taking health 55 → 0 where the spec requires 0 damage.
  The `ai` owner compensated correctly and logged it, but `entity.killed` still double-fires
  (measured 2× over a 5 s burst). **A shared contract needs exactly one owner per responsibility,
  and I did not write it that way.**

### Numbers

| Metric | Value |
| --- | --- |
| Subagents run | 8 |
| Files under `src/` | 96 |
| Feel assertions passing | 120/120 |
| Palette gates passing | 10/12 |
| Defects logged | 16, of which 4 closed |
| Compensations outstanding | 1 (`AI4-C`, dual damage resolver) |
| Compensations removed after upstream fix | 1 (`VEH1-C`) |
