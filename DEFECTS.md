# RINGFALL — DEFECT LEDGER

Append-only. Every agent may add. Nobody may delete an entry; entries are closed, not removed.

**Severity:** `frame-ruining` / `major` / `minor`
**Every entry must carry a measurement.** Entries without one are closed as `discarded-unmeasured`.

## Open compensations

Any constant marked `// COMPENSATION:` in source must have a row here and is counted as an open
defect until the upstream cause is fixed and the constant removed.

| ID | File:line | Compensating for | Measurement | Opened | Status |
| --- | --- | --- | --- | --- | --- |
| — | — | *(none)* | | | |

## Open defects

| ID | Round | Sev | Subsystem | Description | Measurement | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ART1 | 1 | major | lighting / gate design | ART.md P2 (global contrast 8:1–20:1) fails on the whole-set median. Diagnosis: the 12-shot set mixes frames that contain architecture with frames that are open sky over flat grass, and the latter are low-contrast **by content**, not by lighting. Frames with real architecture are inside or above the window; sky/grass frames cannot reach 8:1 no matter how the scene is lit. Either P2 must be measured on a content-qualified subset, or the window is wrong for this art direction. Not fixed by distorting the image to hit a number written in Phase 0 before anything was measured. | Median across all 12 shots 5.72 (was 4.65 before the fog-onset fix). Per shot: enemy_15m 26.7, shield_flare 18.9, firefight 16.0, int_corridor 6.7, ext_vista 6.1, night_emissive 6.1, weapon_close 5.4, int_hall_emissive 5.3, vehicle_ext 4.3, enemy_60m_sil 3.1, ext_ground 2.6, sky_only 2.6. | lighting | open |
| ART2 | 1 | minor | tooling / palette.mjs | P10's high-frequency measure is a box-blur residual proxy, not a radially-averaged 2D FFT as ART.md §9 specifies. It cannot separate surface high-frequency detail from legitimate geometric silhouette edges, so a darker, higher-contrast interior scores *worse* on it despite no material change. | int_corridor went 0.079 → 0.115 across a change that only altered fog onset and touched no surface pattern. int_hall_emissive 0.024, weapon_close 0.012, enemy_15m 0.055 all pass. | orchestrator | open |
| ART3 | 1 | minor | materials / ART.md §3.3 | A violet emissive cannot hold HSV S ≥ 0.25 (ART.md P4) above a post-exposure luminance of 1.22, because a hue whose maximum-luminance form is dark desaturates on clamp when driven toward display white. This is a display-gamut property, not a tonemap defect — lowering DESAT_STRENGTH from 0.22 to 0.08 moved it only 0.195 → 0.226. ART.md §3.3 permits emissive up to 8× adjacent diffuse (≈2.7 post-exposure), which would breach it. Shipped violet runs at L=0.40 and passes at S=0.496, so no content violates it today; the ceiling needs recording in ART.md so a future art pass does not walk into it. | Crossover luminance by hue: cyan never, orange never, yellow never, mint 3.54, violet 1.22. Shipped values all pass: cyan 0.612, violet 0.496, orange 0.859, yellow 0.778, mint 0.358. | materials | open |
| UI1 | 0 | minor | ui (addressed to orchestrator) | `shield.broken` / `shield.recharge.start` / `shield.recharge.full` (ARCHITECTURE.md §4.1) carry `entityId` and fire for every shielded entity, including a `VANE` (90 shield). Nothing in the brief's `hudState` shape or event vocabulary tells `src/ui` which `entityId` is the local player, so `Hud`'s screen-edge shield-break flare would fire on enemy shield pops too unless filtered. Mitigated locally with an opt-in `hud.setPlayerId(id)` (permissive/unfiltered until called) — see `src/ui/README.md` "Integration contract". Needs a real decision: either the orchestrator calls `hud.setPlayerId()` once the player entity spawns, or the event payloads gain an `isLocalPlayer`/similar flag upstream. | Reviewed ARCHITECTURE.md §4.1, §5.6, §5.7 and `src/shared/*` — confirmed no player-id convention exists anywhere `ui` is permitted to read. | orchestrator | open |
| AUDIO1 | 0 | minor | audio (addressed to orchestrator) | `player.footstep`, `player.landed`, `player.jumped`, `weapon.dryfire`, `weapon.reload.start/end`, `weapon.swap.start/end`, `weapon.overheat`, `weapon.cooled`, `weapon.charge.start/full/released`, `scope.enter/exit/descoped`, `melee.swing`, `ai.vocalize`, and `grenade.stuck` (ARCHITECTURE.md §4.2–4.5) carry no world `point`/`position` field, so `audio` cannot spatialize these with a `PannerNode` — they play dry/centered on the listener regardless of which entity emitted them. For the local player this is usually fine (most of these are first-person events anyway), but it means an AI's `melee.swing` whoosh or `ai.vocalize` chatter plays at full, unpositioned volume no matter how far away it is, which is wrong for readability at range. `vehicle.impact`/`.rolled`/`.flipped` have the same gap; worked around locally by caching each vehicle's last known position from `setVehicleEngine`. Recommend adding a `point[3]`/`position[3]` to whichever of these are emitted by non-player entities, at minimum `melee.swing`, `ai.vocalize`, and the three vehicle events. | Diffed every event payload in ARCHITECTURE.md §4 against the fields `audio` needs for `createSpatialChain`: 14 of the audio-relevant payloads have no position field. | orchestrator | open |
| AUDIO2 | 0 | minor | audio (addressed to orchestrator) | `grenade.thrown` (ARCHITECTURE.md §4.3) has no `grenadeId`, while `grenade.bounced`, `grenade.stuck`, and `grenade.detonated` all do. `audio`'s proximity-tick tracker (`src/audio/grenadeTracker.js`) needs `.thrown` to seed a ballistic estimate and would ideally reconcile it against later bounce/detonate ground truth by id, but can't — it currently free-falls an anonymous tracked point under `GRAVITY` and expires it by its own fuse timer instead. Works for the common 1–2-grenades-in-flight case; ambiguous with several grenades in flight simultaneously. Recommend adding `grenadeId` to `grenade.thrown`'s payload. | `grenade.thrown` payload is `{ownerId, grenadeType, origin, velocity, fuseMs}` — no `grenadeId` field, confirmed against ARCHITECTURE.md §4.3 and `src/shared/events.js`. | orchestrator | open |

## Closed defects

| ID | Closed in round | How it was fixed | Verifying measurement |
| --- | --- | --- | --- |
| — | — | — | — |

## Round counts

| Round | frame-ruining | major | minor | total | Δ vs prev | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |
