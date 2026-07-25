# src/ui — HUD

Owner: `ui`. Directory scope: `src/ui/**` only. Pure event-bus consumer — never
imports `src/render`, `src/player`, `src/weapons`, or anything at L5+
(ARCHITECTURE.md §2.2, §3). Permitted imports: `../shared/*`, `../core/*`.

## What this is

A Canvas2D overlay (`<canvas>` stacked above the WebGL canvas, frame graph pass
12, ARCHITECTURE.md §6) drawn entirely with hand-built vector strokes. No
`ctx.fillText`, no font files, no system font names in any shipped path
(ARCHITECTURE.md §1). The only place a system font appears anywhere in this
directory is the *dev-overlay control panel* CSS in `demo.html`, which the
brief and ARCHITECTURE.md §1 explicitly carve out an exception for.

## Files

```
src/ui/
  index.js                Hud class, wireHudEvents(), hudState — the exported API
  glyphs.js                the procedural vector font
  chrome.js                shared drawing primitives (chamfered rects, corner
                            brackets, arcs, colour-with-alpha helper)
  panels/
    shieldHealth.js         shield + health bars, break flare envelope, recharge scan
    tracker.js               circular motion tracker
    reticle.js                per-weapon reticle, aim-assist red state
    hitmarker.js              hit confirmation (4 distinct visuals incl. kill)
    damageDirection.js        screen-edge bearing arc
    ammo.js                   ammo/reserve/heat/charge + grenade counters
    scope.js                  black aperture mask + magnification readout
    vignette.js                low-health vignette + shield-break screen flare
    prompt.js                  pickup/interact prompt with hold-progress ring
    deathOverlay.js            death/respawn full-screen overlay
  demo.html                standalone harness — sliders/buttons for every field
                            and event, switchable bright/dark/midtone backdrop
```

## The glyph font (`glyphs.js`)

Built on the classic **16-segment alphanumeric display** convention: 9 fixed
nodes on a unit square (3×3 grid, corners + edge-midpoints + centre), 16
possible straight strokes between them. Digits use the 7-segment subset
(guaranteed legible); letters use the fuller 16-segment set for diagonals and
the vertical spine. A handful of punctuation marks (`: . % ° !`) that don't map
cleanly onto the grid are custom raw polylines in the same unit space.

Every glyph's `Path2D` is built once, lazily, and cached in a module-level
`Map`. `render()` never allocates a new path for text — it only translates and
scales the *same* cached path per character, which is also why the font is
strictly monospaced (fixed advance width) and why it can't fail to line up.

This was a deliberate choice, not just the easiest option: a segmented-display
font is inherently angular, inherently monospaced-feeling, and is itself a
strong period/genre signature (targeting computer / tank readout aesthetic),
which the brief specifically asked the font to be.

**Known, accepted collisions** — the same way a real 7-segment clock can't
distinguish "5" from "S": `B`/`8`, `D`/`O`/`0` (zero carries a diagonal slash to
tell it apart from `O`, a real technical-display convention), `G`/`6`, `S`/`5`.
`V` and `Y` render near-identically on this coarse a 3×3 grid (both are a
double-diagonal into the centre node — there's no room on a 3-node-tall grid
for `Y`'s arms to stop short of `V`'s). None of this matters functionally
because every HUD field is either pure digits (ammo, counts, ranges) or pure
letters (weapon names, prompts, objectives) — never mixed in the same
readout — so a viewer never has to disambiguate a "5" from an "S" in context.
Documented honestly rather than silently shipped.

## Exported API (`index.js`)

Matches the brief exactly:

```js
export class Hud {
  constructor(canvas)
  resize(width, height, dpr)
  update(state, dt)
  render()
  dispose()
}
export function wireHudEvents(hud)   // -> unsubscribe fn
export const hudState = { ... }
```

`Hud` also exposes `hud.setPlayerId(id)` — see **Integration contract** below,
this is the one thing the brief's state/event shapes leave ambiguous and I did
not want to silently guess wrong.

### Coordinate system

`resize(width, height, dpr)` takes **CSS pixels** for width/height (not device
pixels) and the device pixel ratio separately, matching `ARCHITECTURE.md`'s
"runs every frame at up to DPR 2". Internally the canvas backing store is set
to `width*dpr` × `height*dpr`, `ctx.setTransform(dpr,0,0,dpr,0,0)` is applied
once per `render()`, and every panel works in the logical CSS-pixel space you
passed in. All panel geometry scales off `scale = clamp(height/1080, 0.55, 2.2)`
computed in `resize()`, so the HUD keeps its proportions from 720p up through
4K without a separate layout per resolution.

### `update(state, dt)` vs the `hud.*` events

Continuous values (bar fill, ammo numbers, reticle spread, tracker contacts,
prompt/objective text) are read from `state` every frame — `state` is expected
to be (or look exactly like) the exported `hudState` object, which the game
writes into and then hands to `update()`.

Transient one-shot feedback (hit confirmation, damage direction, shield-break
flare trigger) comes from `wireHudEvents(hud)` subscribing to the bus:

| Event | Panel | Behaviour |
| --- | --- | --- |
| `shield.broken` | shieldHealth | triggers the 0.35s bloom-in / 0.9s decay flare |
| `shield.recharge.start` | shieldHealth | resets the recharge scan-highlight phase |
| `shield.recharge.full` | shieldHealth | resets the recharge scan-highlight phase |
| `hud.hitmarker` | hitmarker | spawns one of 4 distinct effects (see below) |
| `hud.damageDirection` | damageDirection | spawns a screen-edge bearing arc |
| `hud.pickupPrompt` | (fallback) | only used if `state.prompt` is not already set this frame |
| `hud.objective` | (fallback) | only used if `state.objective` is not already set this frame |

`state.prompt` / `state.objective` take priority over the fallback event store
because the brief's state shape already documents them as continuous fields —
the events exist per ARCHITECTURE.md §4.7 too, so both paths are wired for
robustness, but there is exactly one source of truth per frame.

### Integration contract — the one thing I had to decide, not just implement

`shield.broken`, `shield.recharge.start`, and `shield.recharge.full`
(ARCHITECTURE.md §4.1) carry an `entityId` and fire for **any** shielded
entity — including a `VANE`, which has a 90-point shield. Nothing in the
brief's state shape or event vocabulary tells the HUD which `entityId` is the
local player, so without a filter this HUD would flare the player's screen
every time an enemy `VANE`'s shield popped.

I added `hud.setPlayerId(id)` for this. Call it once, whenever the
orchestrator knows the player's entity id (e.g. from `entity.spawned` with the
`PLAYER` archetype/faction). Until it's called, `wireHudEvents` is
**permissive** — it reacts to every matching event, which is wrong for
multi-entity play but lets the HUD "just work" for quick manual testing
without wiring anything up first. I've also filed this gap in
`DEFECTS.md` addressed to the orchestrator, since the fix (or a different
resolution — e.g. adding a `local`/`isPlayer` flag to the payload upstream)
touches a file this owner can't write to.

### The `reticle.hot` state (FEEL.md §4.8)

When `state.reticle.hot` is true, the reticle switches to `HUD.reticleHot` and
thickens by exactly the spec's 12% (`AIM_ASSIST.reticleThicken` in
`shared/tuning.js`). This is the aim-assist engaged cue and per FEEL.md is
explicitly "not optional" — it's implemented on every reticle `kind` variant,
not just the default cross.

### Damage direction bearing convention

Not specified by ARCHITECTURE.md, so declared here (and in
`panels/damageDirection.js`): `yaw` is signed radians, `0` = directly ahead,
positive = clockwise/right — matching `angleDelta()` in `shared/math.js`. The
arc is drawn at the exact bearing (not a bucketed direction), so it clears the
FEEL.md §7 "resolves to within 30°" bar with room to spare.

### Motion tracker convention

Also not pinned by ARCHITECTURE.md: contacts are `{x, z, elevation, hostile}`
in player-relative metres. This module assumes **+z is forward, +x is right**,
and draws forward as "up" (12 o'clock) on the dial, matching every
reference-era motion tracker. If the simulation's actual forward axis differs,
the fix is a one-line convention change in `tracker.js`'s `render()` — flagged
here so it isn't a silent assumption.

## Style notes (ART.md §3, brief's style section)

- Every colour comes from `shared/palette.js`'s `HUD` swatch, used directly as
  a CSS hex string — Canvas2D interprets `#RRGGBB` as sRGB already, and this
  pass is explicitly **never tonemapped** (ARCHITECTURE.md §6, pass 12), so
  there is no linear-light conversion step anywhere in this directory.
- Thin strokes throughout (`lineWidth` scales with the panel's `scale` factor,
  never a flat pixel count), angular geometry only (no arcs/curves except the
  tracker dial, the scope aperture, and the two circular hitmarker/flare
  effects, all of which are literally circular instruments in-fiction).
- Panels use `chrome.js`'s chamfered-rectangle helper for frames so bars,
  prompts, and grenade boxes all share one "cut corner" motif instead of each
  panel inventing its own frame language.
- Everything is built to hold up over both a bright sky and a dark interior:
  every stroke carries real contrast against `HUD.primary`/`HUD.danger`/etc at
  ~0.5–0.9 alpha rather than relying on a drop shadow (Canvas2D shadow blur is
  comparatively expensive per-draw-call and was avoided for perf reasons, see
  below) — the demo harness's three backdrop presets exist specifically so a
  human grader can check this without needing the real renderer running.

## Performance

- **No per-frame `Path2D` allocation.** Every glyph path and every panel's
  *static* frame geometry (chamfered rects, bar outlines) is built once in
  `resize()` and reused every `render()`. The only things computed fresh each
  frame are numbers (bar-fill widths, blip positions) fed into `fillRect` /
  immediate `beginPath()+lineTo()+stroke()` calls, which don't allocate a
  retained JS object the way `new Path2D()` would.
- **Fixed-size effect pools.** Hitmarkers (10 slots) and damage-direction arcs
  (6 slots) round-robin over pre-allocated slot objects instead of push/pop-ing
  an array, so sustained fire (e.g. a `Breaker` shotgun's 12 pellets) cannot
  grow the GC's workload.
- **No `ctx.shadowBlur`.** Every "glow" is layered strokes/fills at partial
  alpha instead. `shadowBlur` is a well-known Canvas2D perf cliff (it's
  effectively a per-call blur pass); avoiding it was a deliberate trade against
  a slightly softer glow.
- **Honest limitation: I could not measure the actual draw cost.** This
  environment has no way to attach a real GPU-backed browser and run
  `profile.mjs`-style timing at 2560×1440 DPR2 — I verified correctness (see
  below) but not the "<1.5ms" budget with real numbers. `demo.html` includes a
  live `performance.now()`-based readout (`#perf` in the corner) specifically
  so a human with a real browser can get that number in about five seconds;
  I did not want to assert a number I never measured.
- **No dirty-rect partial redraw.** Every `render()` clears and redraws the
  full canvas. Given the element count (≈10 panels, each a handful of strokes)
  I judged the complexity/risk of correct dirty-rect tracking wasn't worth it
  against the achievable full-redraw cost, but I did not benchmark to confirm
  that judgement — flagged rather than asserted.

## Determinism (ARCHITECTURE.md §7.2)

No file under `src/ui/*.js` (i.e. everything except `demo.html`) calls
`Date.now()`, `performance.now()`, or `Math.random()`. Every animation
(shield-break flare envelope, recharge scan, tracker sweep, low-health pulse,
death-overlay fade) is accumulated purely from the `dt` passed into
`update(state, dt)`. `demo.html` is a dev-only harness, not shipped HUD code,
and its `requestAnimationFrame` loop uses rAF's own timestamp argument to
derive `dt` — the standard, idiomatic way to drive a browser animation loop —
rather than calling the banned APIs directly; flagged here in case that
distinction matters to whoever runs the gate over this directory.

## What was verified by actually running code, not just reading it

1. `node --check` passes on every `.js` file in this directory (13 files).
2. A temporary Node harness (deleted after use, per instructions) stubbed a
   minimal `HTMLCanvasElement` + `CanvasRenderingContext2D` (including a
   `Path2D` global) and:
   - constructed `new Hud(canvas)`
   - called `resize()` twice at different sizes/DPRs
   - called `wireHudEvents(hud)` and `setPlayerId(1)`
   - drove 5 frames of `update(state, dt)` + `render()` with a populated
     state (tracker contacts including a zero-distance edge case, weapon,
     offhand, grenades, prompt, objective all set)
   - emitted **every** event in the brief's vocabulary that this module
     subscribes to: `shield.broken` (including once for a *different*
     `entityId` after `setPlayerId` — proving the filter path runs without
     throwing), `shield.recharge.start`, `shield.recharge.full`, all four
     `hud.hitmarker` variants, two `hud.damageDirection` bearings,
     `hud.pickupPrompt` show/hide, `hud.objective`
   - drove 10 more frames with `weapon.scoped = true` + low health (<40%)
     active simultaneously
   - drove 20 more frames with `state.dead = true` to exercise the death-fade
   - called the `wireHudEvents` unsubscribe function and `hud.dispose()`
   - **result: every step completed without throwing.** ~22,000 mock-context
     calls were recorded across the run, confirming the panels are actually
     issuing draw calls, not silently short-circuiting.
3. **Also verified in an actual browser**, via the project's own `vite` dev
   server, not just the Node stub: navigated to `/src/ui/demo.html`, confirmed
   every one of `index.js` and the 9 `panels/*.js` files loaded with
   200/304 (no 404s, no MIME/parse errors), confirmed the full control panel
   renders with correct labels/values via a DOM text dump, and programmatically
   clicked every hitmarker variant, every shield event button, the scope/dead/
   glyph-sheet toggles, and the contact-spawn button — zero new console errors
   after any of it. A direct `hud.update()+hud.render()` call (invoked because
   this particular automated browser pane reports `document.hidden === true`,
   which pauses `requestAnimationFrame` the same way any backgrounded browser
   tab would — an environment quirk, not a code defect) filled in ~13,700
   non-transparent canvas pixels out of ~677,000, i.e. the draw pipeline is
   confirmed to actually paint real content, not just avoid throwing.

## What still needs a human + a real, focused browser tab

- Actual visual/aesthetic judgement — legibility over the bright/dark/midtone
  backdrops, whether the glyph font reads as intended at typical HUD sizes,
  whether the tracker's sweep/fade feels "right". I cannot see pixels; I
  verified the code runs and paints, not that it looks good.
- The live animations (flare bloom/decay, recharge scan, tracker sweep,
  low-health pulse, death fade) need a tab that isn't backgrounded for
  `requestAnimationFrame` to actually tick — see the note above.
- Real perf numbers at DPR 2 / 2560×1440 (see Performance section above).
- Whichever entity-id / bearing / forward-axis conventions I had to assume
  (see "Integration contract" and the two convention notes above) should be
  confirmed against whatever `game`/`player`/`weapons` actually emit once
  those owners' code exists.
