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

## Phase 1 — Harness before game

*(not started)*

---

## Phase 2 — Vertical slice, then subsystems

*(not started)*
