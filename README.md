# Ringfall

A browser-based first-person shooter in Three.js + WebGL2. Everything is generated
procedurally from code — no image files, no models, no HDRIs, no audio files. The only
runtime dependency is `three`.

Original work. Not affiliated with, endorsed by, or derived from any existing game.

```bash
npm install
npm run dev
```

## Status

**Phase 0 complete — contract written, no gameplay code yet.**

## Documents

| Document | What it is |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Binding contract: ownership, import lattice, event vocabulary, shared types, frame graph, determinism, tooling, gates |
| [FEEL.md](FEEL.md) | The numbers. 55 numbered assertions enforced by `tools/feeltest.mjs` |
| [ART.md](ART.md) | Art direction spec and the measured gates critics grade against |
| [DEFECTS.md](DEFECTS.md) | Append-only defect ledger, including every compensating constant |
| [PROCESS_LOG.md](PROCESS_LOG.md) | Orchestration patterns that worked and that did not, with numbers |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production bundle |
| `npm run gate` | Asset policy + import lattice + feel assertions + play smoke test |
| `npm run baseline` | Deterministic 12-shot capture |
| `npm run imagediff` | Per-pixel comparison against the committed baseline |
| `npm run profile` | Real-gameplay frame-time distribution at DPR 2 |
| `npm run feeltest` | Headless assertion of every number in `FEEL.md` §8 |
| `npm run silhouette` | Enemy silhouette separation gate |
| `npm run palette` | Palette, contrast, saturation, atmosphere, and bloom gates |
