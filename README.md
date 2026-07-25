# Ringfall

A browser first-person shooter in Three.js + WebGL2. **Everything is generated from code** —
no image files, no models, no HDRIs, no audio files, no fonts. The only runtime dependency
is `three`.

Original work. Not affiliated with, endorsed by, or derived from any existing game.

```bash
npm install
npm run dev
```

Then click the canvas to lock the pointer. **WASD** move · **Space** jump · **Ctrl/C** crouch ·
**LMB** fire · **RMB** scope · **F** melee · **G** grenade · **X** switch grenade · **R** reload ·
**Q**/wheel swap · **E** interact. There is no sprint, and that is deliberate.

---

## What it is

An arena on the inner surface of a ringworld: a CDF outpost with a walkable interior, a Wrought
monolith complex, a Vess landing site, open ground for the vehicle, and the ring arc overhead.
Eight enemies across three squads, four archetypes, a two-layer shield/health sandbox, six
weapons, two grenade types, melee, and a drivable four-wheel LRV.

The art target is a 2007-era console shooter, chosen deliberately: clean large-form surfaces,
bold saturated silhouettes, emissive-led readability and heavy atmospheric perspective are things
code is good at, where photoreal micro-detail is not.

## Measured state

| Gate | Result |
| --- | --- |
| Feel (`FEEL.md` §8) | **120/120 assertions pass** across 6 headless suites |
| Performance @ DPR 2 | p50 **370 fps**, p99 **196 fps**, worst frame **11.1 ms**, **0** shader compiles in play, boot **289 ms** |
| Capture determinism | **12/12 shots bit-identical across 3 runs** |
| Silhouette (`ART.md` §8) | pairwise IoU max **0.550** (limit 0.60), aspect range **0.647** (floor 0.55) |
| Palette (`ART.md` §9) | **10/12** gates — P2 and P10 unmet, both analysed in `HONEST_ASSESSMENT.md` |
| Playtest | 11/11 checks, 60 s scripted, 0 console errors |
| Asset policy / import lattice | clean over 96 files |

Every number above is produced by a tool in `tools/`, not asserted. Where a gate is unmet, the
measurement and the diagnosis are in [HONEST_ASSESSMENT.md](HONEST_ASSESSMENT.md) — including
the parts that are implemented but **not** verified.

## Documents

| Document | What it is |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Binding contract: ownership, import lattice, event vocabulary, shared types, frame graph, determinism, gates |
| [FEEL.md](FEEL.md) | The numbers, as 55 pass/fail assertions |
| [ART.md](ART.md) | Art direction and the measured gates critics grade against |
| [HONEST_ASSESSMENT.md](HONEST_ASSESSMENT.md) | Every shortfall and every unfixed root cause |
| [DEFECTS.md](DEFECTS.md) | Append-only ledger, including every compensating constant |
| [PROCESS_LOG.md](PROCESS_LOG.md) | Which orchestration patterns worked, with numbers |
| [CONTRADICTION.md](CONTRADICTION.md) | Where a subagent contradicted its brief, with evidence |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production bundle |
| `npm run gate` | Asset policy + import lattice + feel assertions + play smoke test |
| `npm run feeltest` | Headless assertion of `FEEL.md` §8. **The most important tool here.** |
| `npm run playtest` | 60 s scripted combat in a real browser |
| `npm run profile` | Frame-time distribution during real gameplay at DPR 2 |
| `npm run baseline` | Deterministic 12-shot capture (`--verify 3`, `--accept`) |
| `npm run imagediff` | Per-pixel comparison against the accepted baseline |
| `npm run palette` | Palette, contrast, saturation and tonemap gates |

## How it is built

Three structural decisions do most of the work:

**Surface detail is analytic, not textured.** Panels, gaps, bolts, stencils and seams are
antialiased signed-distance masks evaluated in the fragment shader from world-space triplanar
coordinates. There are no generated textures anywhere. This satisfies `ART.md` §2's
high-frequency prohibition *by construction* — there is no noise term that can regress into
looking procedural.

**Exposure is a constant and there is no auto-exposure.** An adaptive term makes every art
critique non-reproducible, which is the documented mechanism by which the previous attempt at
this brief spiralled.

**The gameplay layers cannot import the renderer.** `ARCHITECTURE.md` §3 enforces it and
`tools/layercheck.mjs` verifies it, which is what lets `feeltest.mjs` run the entire simulation
headless in Node with no GPU. Feel becomes a failing test instead of an opinion.
