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
| — | — | — | — | *(Phase 0 — no code yet)* | | | |
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
