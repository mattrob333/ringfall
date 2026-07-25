# src/audio — Ringfall audio engine

Owner: `audio` (ARCHITECTURE.md §2.2, parallel/decoupled track). Pure, listen-only
consumer of `src/core/events.js`. Emits nothing. Imports only `../shared/*` and
`../core/*`. Zero audio files — every sound is synthesized at runtime from
WebAudio primitives (`OscillatorNode`, `AudioBufferSourceNode` over a
procedurally filled `AudioBuffer`, `BiquadFilterNode`, `ConvolverNode` with a
procedurally generated impulse response, `DynamicsCompressorNode`, `GainNode`,
`PannerNode`). No `.wav`/`.mp3`/`.ogg`, no base64, no `fetch`.

## File map

```
index.js            AudioEngine class, wireAudioEvents(), the `audio` singleton
context.js           AudioContext creation — never throws, returns null if unavailable
graph.js             Master limiter, 5 mixer buses, convolution reverb + sends
voicePool.js         Voice / VoicePool — hard-capped, priority-stealing pool
noise.js             Procedural noise + impulse-response buffer generation, NoiseBank
spatial.js           ListenerState, PannerNode + air-absorption lowpass chain
grenadeTracker.js     Best-effort ballistic tracking for the proximity tick
constants.js          Bus names, voice-pool cap, priority ladder
synth/helpers.js      playBufferShot / playOscShot — the two synthesis primitives
synth/weapons.js      Weapon fire (7 ids) + charge whine/release
synth/impacts.js      surface.impact, one family per SurfaceId
synth/combat.js       Shields, melee, hit-confirm, kill-confirm
synth/player.js       Footsteps, landing, jump exertion
synth/handling.js     Reload, swap, overheat, cooled
synth/scope.js        Scope enter/exit/descope
synth/ai.js           ai.vocalize formant-ish chatter per archetype
synth/grenades.js     Bounce, stuck, proximity tick, detonation
synth/vehicle.js      Engine loop, tyre-skid heuristic, impact, rollover
synth/ui.js           playUi() direct-trigger cues
demo.html             Standalone test harness — one button per cue
```

## How to audition it

`demo.html` is dependency-free beyond the project's own `../core`/`../shared`
modules — it does not need `three` or any bundler feature. Serve the repo root
with any static server (`npx vite`, `npx serve`, etc.) and open
`src/audio/demo.html`; it cannot be opened via `file://` because module
`import` from a `file://` origin is blocked by most browsers' CORS rules for
local files. Click "Init Audio" first — `AudioContext` requires a user gesture.

## Mixer graph

```
each bus (sfx / weapons / world / ui / voice) -- GainNode
  -> master GainNode (setMasterVolume)
       -> DynamicsCompressor (limiter: threshold -8dB, ratio 16:1, attack 2ms)
            -> destination
  -> (except 'ui') reverb send GainNode -> ConvolverNode -> return Gain -> master
```

The limiter exists specifically so a grenade detonation (the loudest single
event in the game) can never clip the mix even if several other voices are
already playing. `ui` bus cues are deliberately dry (no reverb send) — they are
non-diegetic feedback (hit/kill confirmation, menu clicks), not part of the
simulated space.

**Reverb**: one `ConvolverNode`, two procedurally generated impulse responses
(`graph.js` / `noise.js#createImpulseResponse`) — a ~0.85 s tight-interior IR
(fast decay, exponent 5.5) and a ~2.4 s open-exterior IR (slow decay, exponent
2.1), both built as one-pole-lowpass-filtered noise decaying under a power
curve, per two independent stereo channels so the tail isn't mono-collapsed.
**Limitation**: nothing currently switches between the two presets — there is
no event or field in the current event vocabulary that tells `audio` which
room/zone the listener is in, so `interior` is the fixed default
(`graph.buildMixerGraph` exposes `setReverbPreset()` internally for whenever
that signal exists).

## Voice pool and stealing

`voicePool.js` — hard cap of **48 concurrent voices** (`constants.js
MAX_VOICES`). Every synthesized sound acquires a `Voice` from the pool with a
priority (`constants.js Priority`, roughly: UI/kill-confirm/shield-break >
grenade detonation > weapon fire/melee > impacts/vocalize > footsteps). When
the pool is full, a new request steals the single lowest-priority active voice
if the incoming sound outranks it (ties broken by age — oldest steals first);
otherwise the new sound is silently dropped. This is the mechanism that keeps a
48-person firefight with grenades going off from ever growing the audio graph
without bound.

A composite sound (e.g. a gunshot = a noise-burst layer + a tonal click layer)
acquires **one** `Voice` and shares it across every layer
(`Voice.expectEnd()`/`signalEnd()`), so a layered sound costs one pool slot, not
one per layer. **Known inefficiency**: each layer still builds its own
`PannerNode`/lowpass chain when spatialized, rather than sharing one spatial
chain per composite voice — correct-sounding but not maximally cheap. Given the
voice cap this has not needed fixing, but a future pass could share the
spatial chain across a composite's layers.

Vehicle engine loops are **not** part of this pool — they are long-lived,
there are at most a handful of vehicles, and stealing an engine loop to make
room for a footstep would be the wrong trade. They are managed directly by
`synth/vehicle.js VehicleEngineManager` and torn down after 1.5 s of
inactivity (`setVehicleEngine(..., {active:false})`).

## Spatialization

`PannerNode` with `panningModel: 'equalpower'` (HRTF is too expensive at this
voice count, per the brief) plus a per-voice `BiquadFilterNode` lowpass whose
cutoff is chosen once at trigger time from distance-to-listener (18 kHz near,
900 Hz at ~90 m) as a cheap stand-in for air absorption. This is computed once
per one-shot rather than continuously, which is correct for anything that
doesn't move meaningfully over its own short lifetime (everything except
vehicle engine loops, whose panner position — not their lowpass — is updated
every call to `setVehicleEngine`).

## Determinism

Every sound that needs variation (pitch/gain jitter, AI vocalize syllable
count/timing, impulse-response noise) draws from `rng('audio')`
(`src/core/rng.js`), never `Math.random()`. `AudioContext.currentTime` is used
for scheduling (the standard WebAudio clock) — this is not `Date.now()` or
`performance.now()` and does not participate in the ARCHITECTURE.md §7
simulation-determinism contract; audio is explicitly presentation, not
simulation.

## Sound families shipped

- **Weapon fire** — one distinct synthesis per weapon id in
  `synth/weapons.js`: `cadence_ar` (bandpassed noise chatter + a falling
  square-wave click), `vector_br` (brighter/faster bandpassed crack + a
  falling sawtooth), `longbow` (lowpassed noise body + a long ~0.9–1.1 s sine
  boom sweeping down through the low register), `breaker` (heavily lowpassed
  broadband noise + a 68 Hz sine body), `ember_repeater` (a downward-sweeping
  sawtooth through an implied resonance + a short high-bandpass sizzle),
  `vess_sidearm` (a rising triangle-wave chirp + a highpassed tick, distinctly
  brighter/cleaner than `ember_repeater`), `ridgeback_turret` (bandpassed
  noise thud + a falling square click, pitched between `cadence_ar` and
  `breaker`). `vess_sidearm`'s charged shot is a separate rising sawtooth whine
  held open from `weapon.charge.start` (nominal 1.2 s ramp 260→1500 Hz per
  FEEL.md §4.2) through `weapon.charge.full`/`.released`, then a heavy
  descending-sine + crackle burst on release.
- **Impacts** — `synth/impacts.js` maps every `SurfaceId` in
  `shared/enums.js` (17 values) onto nine audible families named in the brief:
  metal ping (`METAL_PAINTED`/`METAL_BARE`/`METAL_GRATE`/`VEHICLE_HULL`/
  `ARMOR_HARD`, grate variant adds a crackle layer for rattle), concrete/rock
  crack+dust, dirt/grass/sand soft thud, glass shatter (broadband burst + 4
  randomized high sine "shards"), Vess alloy resonant ring (sustained near-pure
  sine), Wrought alloy hard bell (triangle fundamental + an inharmonic partial
  for beating), flesh thud, shield/energy-barrier electrical crackle, water
  splash. `energy` from the payload drives gain and brightness.
- **Shields** — `shield.broken` is a rising sawtooth that gets a **hard cut**
  (gain snapped to near-zero via `setValueAtTime`, not an exponential ramp) at
  the top of the rise, plus a crackle burst at the cut point; the player's own
  break is pitched an octave lower and gets an extra low body thump so it
  reads as "worse news" than an enemy's break, which is brighter/quicker.
  `shield.recharge.start` is a slow rising sine ramp; `shield.recharge.full` is
  a two-note resolving chime.
- **Grenades** — `bounced` scales a bandpassed tick + short sine by
  `impactSpeed`; `stuck` is a distinct crackle+falling-sawtooth "zap" designed
  to be unmistakable; `detonated` is a low sine body + a broadband crack + a
  tail that differs by type (dirty lowpassed rumble for frag, an electric
  sawtooth ring-down for plasma); a proximity tick (`synth/grenades.js
  playGrenadeTick`, scheduled from `index.js AudioEngine.update()`) fires with
  increasing rate as a tracked enemy grenade's estimated position closes on
  the listener.
- **Melee** — `swing` is an envelope-shaped bandpassed noise whoosh scaled to
  `durationMs`; `landed` is a lowpassed thud + a triangle "thock"; an
  `fromBehind` assassination adds a low ominous tone and a sharp highpassed
  snap so it cannot be mistaken for a routine melee hit.
- **Player** — footsteps pick a bright/dark noise layer and filter cutoff from
  `SURFACE_PHYSICS[surfaceId].hardness`, scaled by `speed`; landing scales gain
  and lowpass cutoff by `impactSpeed`; jump exertion is a short bandpassed
  noise breath.
- **Weapon handling** — reload/swap are two bookending clicks (start = bright
  mechanical, end = darker "seated" thunk) rather than one sound stretched to
  `durationMs`; overheat is a long highpassed noise vent; cooled is a rising
  two-tone chime.
- **Scope** — enter/exit are rising/falling sine sweeps, pitched higher and
  faster for 8x than 2x per FEEL.md §4.4; descope is a sharper, more abrupt
  highpassed click + falling square, distinct from a manual exit.
- **AI vocalizations** — `synth/ai.js` builds 1–4 short "syllables" per
  archetype from a sawtooth fundamental plus a triangle "formant" partner
  voiced at a fixed multiple of the fundamental (a crude stand-in for a vowel
  formant), with archetype-specific pitch range, syllable duration, and gap:
  `SKIRN` high and fast/jittery, `CULL` low-variance short blips, `VANE` slower
  and more resonant, `WARDEN` very low and long. This is deliberately abstract
  texture, not phonemes — it is not intelligible speech in any real language.
- **Vehicle** — a persistent two-oscillator (detuned sawtooth+square) engine
  drone whose fundamental tracks `rpm01` and whose lowpass cutoff tracks
  `load01`, plus a looped bandpassed-noise "skid" layer. Impact/rollover/
  destroyed are one-shot composites scaled by `relativeSpeed`.
- **Kill confirmation** — `synth/combat.js playKillConfirm`, a two-note
  descending pure-sine motif (980 Hz → 640 Hz), only fired for kills the
  tracked local player scored. Hit confirmation (`playHitConfirm`, driven by
  `damage.applied` for the player's own shots) is a much shorter single/double
  click that varies by shield-absorbed/body/headshot — deliberately a
  different timbre and duration family from the kill cue so they can never be
  confused, per FEEL.md §7.
- **UI cues** — `playUi('select'|'confirm'|'back'|'pickup'|'lowAmmo')`, short
  sine/triangle blips on the dry `ui` bus.

## How "is this the local player" is determined

No API in the brief exposes a player-entity id directly, and several cues
(shield pitch, kill confirmation, hit confirmation, footstep/landed/jumped
filtering, weapon-fire dry-vs-spatialized) need to know it. `wireAudioEvents`
watches `entity.spawned` and records the first `entityId` whose `archetype ===
'PLAYER'` as the tracked local player. Everything keys off that. This means
audio has zero dependency on `src/player` or any other L4/L5 module — it stays
a pure event consumer — but it does mean these cues are wrong until the first
`entity.spawned{archetype:'PLAYER'}` event has fired.

## Verified vs. not verified

**Verified by execution** (Node, no browser): every `.js` file passes `node
--check`. A throwaway script (deleted after use, per instructions) imported
`index.js`, constructed `AudioEngine`, called `init()` (resolves with
`ready === false` in Node, since there is no `AudioContext`), called
`wireAudioEvents()`, emitted one representative payload for **every** event
name declared in `shared/events.js` (all combat/weapons/grenade/melee/world/
AI/vehicle/HUD events, including every `SurfaceId` for `surface.impact` and
every AI archetype for `ai.vocalize`), called `update(1/60)` ten times, called
the unsubscribe function, called `dispose()`, and — separately — constructed a
**second** independent `AudioEngine` instance and drove one more event through
it to confirm no module-level state leaks between engine instances. Exit code
0, no exceptions anywhere in that path.

**Not verified** (requires a browser): that anything actually sounds good, or
sounds *like* what its name claims. I cannot hear the output. `demo.html` is
built specifically so a human can audition every cue; I have not run it in a
browser myself. The DSP choices above are informed sound-design reasoning
(filter types/frequencies chosen for the described character), not confirmed
by listening.

## Limitations (honest list)

1. **Reverb preset never switches.** No event/field currently tells `audio`
   which room the listener is in; `interior` is hard-coded as the default. See
   `graph.js setReverbPreset()`.
2. **Several event payloads carry no world position**, so those cues always
   play dry/centered on the listener rather than spatialized:
   `player.footstep`, `player.landed`, `player.jumped`, `weapon.dryfire`,
   `weapon.reload.*`, `weapon.swap.*`, `weapon.overheat`, `weapon.cooled`,
   `weapon.charge.*`, `scope.*`, `melee.swing`, `ai.vocalize`,
   `grenade.stuck` (carries a target-*local* point, not world), and
   `vehicle.impact`/`.rolled`/`.flipped` (patched around using the vehicle's
   last known position from `setVehicleEngine`, since those three events don't
   carry one either). This flattens AI footsteps/vocalizations/melee-swings to
   "centered, full volume regardless of distance" instead of spatialized —
   likely fine for the local player's own footsteps, less good for hearing an
   AI melee-swing whoosh from off-screen. Flagged to the orchestrator in
   `DEFECTS.md`.
3. **`grenade.thrown` carries no `grenadeId`**, while `.bounced`/`.stuck`/
   `.detonated` do, so a thrown grenade can't be exactly correlated with its
   own later bounce/stick/detonation events. The proximity-tick tracker
   (`grenadeTracker.js`) works around this by free-falling each thrown
   grenade under the shared `GRAVITY` constant and expiring it by its own fuse
   timer, rather than snapping to bounce/detonate ground truth. For the common
   case (one or two grenades in flight) this is a reasonable proximity
   estimate; it is not a physics replica, and if a grenade rolls somewhere its
   free-fall estimate wouldn't predict, the tick may not track it precisely.
4. **Tyre skid is a heuristic**, not driven by real lateral-slip data (no such
   field exists on `setVehicleEngine` or in the event vocabulary). It's
   approximated from how fast `load01` changes frame-to-frame relative to
   `rpm01` (`synth/vehicle.js EngineChain.update`). It will sometimes be wrong.
5. **Composite sounds spend one panner/lowpass chain per layer**, not one per
   voice — correct output, more nodes than strictly necessary. Not a problem
   at current voice-cap scale.
6. **A charge whine only stops on `.full`/`.released`, or on
   `entity.killed`/`entity.despawned` for its owner** (added as a safety net).
   If a weapon system ever leaves a charge dangling without emitting any of
   those four events, that one voice leaks until the pool eventually steals it
   under pressure (low priority already assigned) — it cannot grow past the
   pool cap, but it can occupy a slot indefinitely in a quiet scene.
7. **Voice budget is 48 concurrent, hard cap, priority-stolen.** Not tuned
   against a real firefight — no profiling tool exists yet for audio load. The
   cap and priority ladder are a reasoned starting point (`constants.js`), not
   a measured one.
8. I have not listened to a single one of these sounds. Everything above is a
   description of what was built, not a claim about how it sounds.
