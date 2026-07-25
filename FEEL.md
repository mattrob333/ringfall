# RINGFALL — FEEL

**Version 1.0 — binding spec. Phase 0 artifact.**

Feel is graded by `tools/feeltest.mjs`, not by opinion. Every number below that carries an
assertion ID (`F##`) is a **failing test** if it drifts outside tolerance. Critic C3 reads the
test output and this document, and is forbidden from grading from screenshots.

Every value here is tunable, but **every change must be justified in §9 (Tuning Log)** with what
was felt, what was measured, and what moved. A change with no entry is reverted.

---

## 1. Identity statement

The player is heavy, fast, and never in a hurry. There is no sprint, so distance is crossed at
one speed and the player's attention stays on the fight instead of on a stamina bar. Time-to-kill
is long, so a fight has phases: strip the shield, reposition, throw, finish. The floaty jump makes
every leap a commitment with a visible arc. Aim assist is generous because the reference is a
controller game whose feel comes from magnetism, and removing it does not make the game more
skilful, it makes it feel broken.

If a change makes the player faster, more lethal, or more twitchy, it is probably wrong.

---

## 2. Player locomotion

| Property | Value |
| --- | --- |
| Capsule radius | 0.42 m |
| Capsule height (standing) | 1.85 m |
| Eye height (standing) | 1.62 m |
| Eye height (crouched) | 1.05 m |
| Crouch transition | 0.18 s, eased |
| Mass (for physics interactions) | 88 kg |
| Step height | 0.42 m |
| Max ground slope | 48° |

| Speed | Value |
| --- | --- |
| Forward | **4.40 m/s** |
| Strafe | 3.96 m/s (90%) |
| Backpedal | 3.96 m/s (90%) |
| Crouched | 1.90 m/s |
| Sprint | **does not exist** — do not add it |

| Acceleration | Value |
| --- | --- |
| Ground acceleration toward desired velocity | 65.0 m/s² → **67.7 ms** standstill to full speed |
| Ground deceleration (no input) | 42.0 m/s² → 105 ms to full stop, retains a short slide |
| Air acceleration | 19.5 m/s² (**30%** of ground) |
| Air speed cap | 4.40 m/s — air control redirects, it does not add speed |
| Strafe reversal (+3.96 → −3.96) | 7.92 / 65.0 = **122 ms** |

### 2.1 Jump — resolved from the brief (see `ARCHITECTURE.md` §12 A1)

The brief specifies apex 1.05 m, airtime 0.95 s, gravity ≈ 11 m/s². Under symmetric ballistics
those three are mutually unsatisfiable:

```
h = g·t²/8        (symmetric arc, t = total airtime)

g = 11, h = 1.05  →  t = √(8h/g) = √(8.4/11)  = 0.874 s   (−8% airtime)
g = 11, t = 0.95  →  h = g·t²/8  = 11(0.9025)/8 = 1.241 m  (+18% apex)
```

Apex and airtime are both directly felt. Gravity is not felt, it is inferred. So both felt
quantities are held and gravity is solved for:

```
g  = 8h/t² = 8(1.05)/0.95²  = 9.31 m/s²
v₀ = g·t/2 = 9.31 × 0.475   = 4.42 m/s
```

| Property | Value |
| --- | --- |
| Gravity | **9.31 m/s²** (symmetric — no fast-fall multiplier) |
| Jump launch velocity | 4.42 m/s |
| Apex height | 1.05 m |
| Total airtime (flat ground) | 0.95 s |
| Time to apex | 0.475 s |
| Coyote time | 90 ms |
| Jump buffer | 120 ms |
| Variable jump height | **no** — a jump is a full commitment |
| Landing recovery | none for ≤ 6.0 m/s impact; 140 ms of −35% move speed above that |
| Fall damage | none below 8.5 m/s; above, `FALL` damage = (v − 8.5) × 9.0, ignores shields |
| Terminal velocity | 42 m/s |

Grenades, vehicles, and ragdolls use the same 9.31 m/s². There is no per-object gravity scalar;
if one is ever introduced it is a `// COMPENSATION:`.

### 2.2 Camera

| Property | Value |
| --- | --- |
| Default FOV | 85° horizontal (≈ 55.4° vertical at 16:9), user range 70–110 |
| View-model FOV | 65° horizontal, rendered in the same pass with a separate projection |
| Look sensitivity | 0.022°/count, no acceleration, no smoothing |
| View bob amplitude | 0.9 cm vertical, 1.4 cm lateral at full speed; scales with speed, zero when still |
| Landing dip | 4.5 cm over 180 ms, ease-out |
| Weapon sway (look-driven lag) | 3.2° max, 90 ms spring, critically damped |

Head bob and sway are **view-model only** where possible; camera translation stays under 1 cm so
the world does not swim.

---

## 3. Shields, health, and the damage cycle

| Property | Value |
| --- | --- |
| Player shields | **70** |
| Player health | **45** |
| Shield recharge delay after last damage | **4.0 s** |
| Shield recharge rate | 28 /s → **2.5 s** empty to full |
| Shield recharge interrupt | any damage resets the 4.0 s delay |
| Health regen precondition | shields at 100% |
| Health regen delay | **8.0 s** after shields reach full |
| Health regen rate | 9 /s → **5.0 s** empty to full |
| Shield break feedback | screen-edge flare (0.35 s bloom-in, 0.9 s decay), rising-then-cut audio, HUD bar shatter |
| Shield recharge feedback | audible charge-up ramp beginning at t+4.0 s, resolving at t+6.5 s |
| Damage direction indicator | arc at the screen edge, 0.6 s, opacity scaled by fraction of max health removed |
| Low-health state | desaturation to 0.55× and a red vignette below 40% health, no heartbeat audio |

Effective HP from full: **115**. Nothing in the sandbox one-shots a full-shield player except a
stuck plasma grenade, a sniper headshot, an assassination, or a vehicle at speed.

---

## 4. Weapon sandbox

Two weapons carried. Four frag and four plasma grenades carried (4 max per type). Weapon swap
**0.7 s**. Weapons drop on death with their remaining ammo and are pickupable.

### 4.1 The precision-rifle cadence — the arithmetic that fixes the whole sandbox

`Vector BR`, 3-round burst, `KINETIC` 8.0 body / 20.0 head (2.5×), head multiplier applies only
once shields are down.

```
shields 70:   rounds 1–9  ×8 = 72  ≥ 70   →  shields break on round 9 = last round of burst 3
health  45:   burst 4, three head rounds ×20 = 60 ≥ 45  →  kill
              burst 4, three body rounds ×8  = 24 <  45  →  no kill, needs bursts 5–6
```

**4 bursts to kill, and the fourth must be a headshot.** Timing, first round to last:

```
3 × 400 ms burst refire + 2 × 60 ms intra-burst = 1.32 s
```

Target from the brief: ~1.3 s. ✔

This is why `KINETIC` shield multiplier is 1.00 (`ARCHITECTURE.md` §12 A2) — any other value
puts the shield break mid-burst and destroys the cadence.

### 4.2 Weapon table

| Weapon | Family | Damage (body/head) | Type | RPM | Mag | Reserve | Optic | TTK vs full shields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Cadence AR` | CDF | 5.0 / 6.25 (1.25×) | KINETIC | 600 | 32 | 224 | none | 23 rounds ⇒ **2.30 s** |
| `Vector BR` | CDF | 8.0 / 20.0 (2.5×) | KINETIC | 3-rnd burst, 400 ms refire, 60 ms intra | 36 | 108 | 2× | 4 bursts ⇒ **1.32 s** |
| `Longbow` | CDF | 80 / 240 (3×) | KINETIC | 40 (1.5 s refire) | 4 | 16 | 2× / 8× | 1 headshot, or 2 body ⇒ 1.50 s |
| `Breaker` | CDF | 12 pellets × 11 | KINETIC | 70 (0.85 s) | 6 tube | 24 | none | 1 shot ≤ 2.2 m ⇒ **0.00 s** |
| `Ember Repeater` | Vess | 6.0 (no head bonus) | PLASMA | 450 | heat | — | none | 8 + 14 rounds ⇒ **2.80 s** |
| `Vess Sidearm` | Vess | 8.0 / uncharged | PLASMA | 300 | battery 100 | — | none | see 4.3 |
| `Vess Sidearm` (charged) | Vess | 25 EMP | EMP | 1.2 s charge | 12 battery | — | none | strips 70 shields in **1 bolt** |

Derived, with the `ARCHITECTURE.md` §5.3 matrix applied:

* `Ember Repeater` vs shields: 6.0 × 1.60 = 9.6 ⇒ ⌈70/9.6⌉ = **8 rounds** to strip.
  vs health: 6.0 × 0.55 = 3.3 ⇒ ⌈45/3.3⌉ = 14 rounds. Total **22 rounds**, and
  first round to last is **21** intervals at 60/450 = 0.1333 s ⇒ **2.80 s**.
  *(v1.0 said 2.93 s, which multiplied 22 × 0.1333 — one interval too many. TTK
  is measured first-round-to-last, exactly as the `Vector BR` figure above is.)*
* `Cadence AR` vs shields: 5.0 ⇒ 14 rounds (1.40 s) to strip.
* So plasma strips **31% faster** and finishes **69% slower**. That asymmetry is the reason the
  player carries one of each, and it must survive every tuning pass.

### 4.3 The golden combination

`Vess Sidearm` charged bolt (EMP 25 × 4.00 = 100 ≥ 70) removes the entire shield with zero health
damage, then one `Vector BR` burst to the head (3 × 20 = 60 ≥ 45) kills.

```
1.20 s charge + 0.15 s travel + 0.70 s weapon swap + 0.12 s burst  ≈  2.17 s
```

Slower in raw seconds than a clean 4-burst BR, but it does not require four consecutive
uninterrupted bursts. Skill expression, not a strictly dominant option. This is the intended
shape and `feeltest.mjs` asserts both numbers.

### 4.4 Spread, recoil, and accuracy

| Weapon | Base spread | Bloom | Decay | Recoil |
| --- | --- | --- | --- | --- |
| `Cadence AR` | 0.60° | +0.30°/shot to 3.00° cap | 6.0°/s | 0.45° vertical/shot, 55% auto-recentre |
| `Vector BR` | 0.35° fixed | none | — | 1.1° per burst, 85% auto-recentre |
| `Longbow` | 0.00° | none | — | 3.2° kick, 100% auto-recentre over 0.4 s |
| `Breaker` | 4.5° cone, 12 pellets, fixed pattern per shot from the `weapons.spread` RNG stream | none | — | 2.6° |
| `Ember Repeater` | 0.85° → 2.4° with heat | heat-driven | vent-driven | 0.30°/shot |
| `Vess Sidearm` | 0.50° | none | — | 0.6° |

**No ADS.** Hip-fire is the default and only stance for everything except the scoped weapons.
Scoped weapons get a 2×/8× overlay with a distinct zoom-in sound, a black vignette mask (not a
blur), and **descope on any damage taken**.

### 4.5 Overheat (`Ember Repeater`)

Heat 0→1 over 3.2 s of continuous fire. Venting begins 0.55 s after trigger release, empties in
2.6 s. Overheat lockout **3.4 s** with a vent plume and a distinct cooldown whine. There is no
reload and no ammo pickup; a Vess weapon is a resource you spend and discard.

### 4.6 Grenades

| Property | Frag | Plasma |
| --- | --- | --- |
| Throw speed | 17.0 m/s | 19.0 m/s |
| Throw pitch above aim | +6.0° | +4.0° |
| Fuse | 3.00 s | 3.00 s free / 2.20 s after sticking |
| Restitution | **0.42** | 0.10 (dead, does not roll far) |
| Friction | 0.55 | 0.80 |
| Sticks to | nothing | `FLESH`, `ARMOR_HARD`, `VEHICLE_HULL` |
| Direct damage on stick | — | 130 (`PLASMA`, unconditional kill on a player) |
| Blast damage at 0 m | 90 | 70 |
| Blast radius (to zero) | 5.50 m | 4.00 m |
| Falloff | `(1 − d/r)^1.6` | `(1 − d/r)^1.4` |
| Damage type | `EXPLOSIVE` | `PLASMA` |
| Self-damage | 100% | 100% |
| Carried max | 4 | 4 |
| Trail | dark smoke + a single blinking indicator light, readable against sky | continuous cyan plasma ribbon, readable against ground |

A frag at 0 m deals 90 < 115 effective HP: **grenades never delete a healthy player**. They kill
an unshielded player out to **2.23 m**:

```
damage(d) = 90 · (1 − d/5.5)^1.6 · 1.15      (EXPLOSIVE is ×1.15 vs health)
45 = 103.5 · (1 − d/5.5)^1.6   ⇒   d = 5.5 · (1 − 0.4348^(1/1.6)) = 2.232 m
```

*(v1.0 said 2.7 m. That number came from a LINEAR falloff and omitted the ×1.15
`EXPLOSIVE` multiplier, contradicting the exponent 1.6 in the table directly
above it. The implementation was correct and the spec was wrong.)*

That is the correct role — grenades open a window, they do not close a fight on their own.

Apex of a level throw from eye height: v₀ᵧ = 17.0 sin 6° = 1.78 m/s ⇒ rise 0.170 m above the
release point, reached at 0.191 s. Flat, fast, throwable on instinct.

### 4.7 Melee

| Property | Value |
| --- | --- |
| Damage | 60 (`MELEE`) |
| Hits to kill from full (70 + 45) | **2** — first leaves 10 shield, second removes 10 shield + 45 health |
| Lunge range | 2.10 m |
| Lunge assist | up to 1.1 m of forward pull toward a valid target inside the cone |
| Windup | 0.12 s |
| Contact frame | 0.20 s |
| Recovery | 0.55 s (0.35 s on kill) |
| From behind | instant kill — requires `dot(attackerForward, targetForward) > 0.55` (within 57° of directly behind) and range ≤ 1.6 m |
| Interrupts | melee cancels reload; it does not cancel a weapon swap |

### 4.8 Aim assist — **not optional**

| Property | Value |
| --- | --- |
| Red-reticle cone | half-angle `clamp(atan(1.35·r_target / d), 1.2°, 5.0°)` — 5.0° cap inside effective range |
| Reticle response | reticle turns red and thickens by 12% inside the cone |
| Bullet magnetism | bends the fired ray up to **3.0°** toward the target's centre of mass; strength ramps 0→1 across the outer 40% of the cone, so a dead-centre shot is never bent |
| Magnetism range | 100% within effective range, decaying to 0 at 1.6× effective range |
| Hitbox inflation | capsule radius × **1.15** for shots originating inside red-reticle state |
| Turn friction | look sensitivity × 0.80 while the crosshair is inside the cone **and** the player is supplying look input; no effect on a stationary crosshair |
| Auto-aim (snap) | **none** — magnetism and friction only |
| Applies to | player only. AI uses its own accuracy model (§6). |

Without this the game feels broken to anyone who knows the reference, and no amount of visual
polish compensates. It is a `feeltest` assertion, not a preference.

---

## 5. Vehicle — `Ridgeback` LRV

| Property | Value |
| --- | --- |
| Mass | 2 100 kg |
| Suspension | 4-wheel raycast, spring 42 kN/m, damper 4.2 kN·s/m, travel 0.32 m, rest 0.18 m |
| Tyre friction | 1.55 lateral, 1.20 longitudinal, Pacejka-lite curve |
| Max forward speed | 18.0 m/s |
| Max reverse speed | 6.0 m/s |
| 0 → max | **4.20 s** |
| Braking | 11.0 m/s² |
| Steering | 32° max lock, falling to 11° at max speed |
| Rollover trigger | sustained lateral accel > 1.25 g for 0.25 s, or `uprightDot < 0.15` |
| Rollover consequence | **funny, not punishing** — occupants are ejected with a light ragdoll toss, take no damage below 12 m/s impact, and the vehicle can be flipped back by holding interact for 1.2 s |
| Seats | driver + one rear turret gunner |
| Turret | 360° yaw, −25° to +70° pitch, `KINETIC` 14/round, 480 RPM, spin-up 0.35 s, overheat at 6.0 s of fire |
| Chase camera | 5.20 m behind, 2.10 m above, 0.12 s critically damped spring, FOV widens to 95° at max speed |
| Ram damage | `VEHICLE` type, `0.5·m·v²` scaled, lethal to infantry above 9 m/s |
| EMP | a charged `Vess Sidearm` bolt disables drive and turret for 4.0 s |

---

## 6. Enemies — the Vess

Two-layer enemies are what give the AI its rhythm: the shield layer forces a weapon switch or a
grenade, the health layer rewards precision.

| Archetype | Shield | Health | Recharge | Behaviour |
| --- | --- | --- | --- | --- |
| `SKIRN` | 0 | 30 | — | Cheap, numerous, aggressive while led. **Panics and flees when its squad leader dies** — 0.8 s freeze, then break formation, 6 s of unaimed retreat, may re-rally at 12 s if another `VANE` is alive. Dorsal tank is a `WEAKPOINT` (×3) that detonates for 45 `EXPLOSIVE` in 2.2 m. |
| `CULL` | 0 | 55 | — | Carries a forward arm barrier that blocks `KINETIC` entirely from the front (0 damage, ricochet FX) but not `PLASMA` (×0.35) or `EXPLOSIVE`. Sidesteps laterally. The barrier breaks after 90 absorbed damage. Answer: flank, plasma, or grenade. |
| `VANE` | 90 | 60 | 4.0 s delay, 3.0 s to full | Squad leader. Strafes, dodge-rolls on a 2.6 s cooldown when shot at while shields are down, throws plasma grenades, melees at close range. Killing it triggers `ai.leaderKilled` and the `SKIRN` panic cascade. |
| `WARDEN` | 0 | 220 | — | Slow, heavy, plated. Front plates take ×0.35 `KINETIC`; the back plate is a `WEAKPOINT` (×3). Answer: movement and positioning, not damage output. |

AI accuracy model: per-archetype base hit probability with a burst-pattern miss distribution, a
0.35–1.10 s reaction latency band, and **guaranteed misses on the first 0.5 s of re-acquisition**
so the player always gets a moment to react to being spotted. AI never uses player aim assist.

---

## 7. Readability requirements that are feel, not art

| Property | Requirement |
| --- | --- |
| Hitmarker | Distinct shape and pitch for shielded hit, unshielded hit, and headshot. Latency from `damage.applied` to on-screen ≤ 1 frame. |
| Kill confirmation | Reticle flash + a two-note descending cue, never ambiguous with a hitmarker. |
| Enemy shield state | `VANE` shield is visible as a translucent shell that flares on hit and audibly pops on break, legible at 60 m. |
| Grenade warning | Enemy grenades emit a distinct proximity tick audible before detonation, and the indicator light is visible against both sky and ground. |
| Reload state | Readable from the view model alone with the HUD hidden. |
| Damage source | Direction indicator arc resolves the attacker's bearing to within 30°. |

---

## 8. `feeltest.mjs` assertions

Headless. Rendering disabled. Synthetic input driven into the real controller, weapon, physics,
and damage code. Every row is a hard pass/fail.

| ID | Assertion | Target | Tolerance |
| --- | --- | --- | --- |
| F01 | Standstill → 99% of forward speed | 67.7 ms | ≤ 80 ms |
| F02 | Steady-state forward speed | 4.40 m/s | ±0.02 |
| F03 | Strafe speed / forward speed | 0.90 | ±0.01 |
| F04 | Backpedal speed / forward speed | 0.90 | ±0.01 |
| F05 | Crouch speed | 1.90 m/s | ±0.02 |
| F06 | Full-speed strafe reversal (+v → −v) | 122 ms | ≤ 140 ms |
| F07 | Jump apex above launch plane | 1.05 m | ±0.02 |
| F08 | Jump total airtime, flat ground | 0.950 s | ±0.020 |
| F09 | Air acceleration / ground acceleration | 0.30 | ±0.02 |
| F10 | Air speed never exceeds ground speed | — | hard |
| F11 | Sprint input does nothing | — | hard: no bind exists |
| F12 | Shield recharge start after last damage | 4.00 s | ±0.05 |
| F13 | Shield 0 → 70 duration | 2.50 s | ±0.05 |
| F14 | Damage during recharge resets delay to 4.00 s | — | hard |
| F15 | Health regen does not start until shields full | — | hard |
| F16 | Health regen start after shields full | 8.00 s | ±0.10 |
| F17 | Health 0 → 45 duration | 5.00 s | ±0.10 |
| F18 | `Vector BR` bursts to kill a full-shield target, final burst to head | 4 | exact |
| F19 | `Vector BR` TTK, first round to last | 1.32 s | ±0.04 |
| F20 | `Vector BR` shields break on round 9 | round 9 | exact |
| F21 | `Cadence AR` TTK at 0 spread, all hits | 2.30 s | ±0.08 |
| F22 | `Ember Repeater` rounds to strip a 70 shield | 8 | exact |
| F23 | `Ember Repeater` full TTK | 2.93 s | ±0.10 |
| F24 | Plasma strips shields faster than kinetic, kinetic finishes faster than plasma | — | hard |
| F25 | Charged `Vess Sidearm` removes a full 70 shield in one bolt and deals 0 health damage | — | hard |
| F26 | Golden-combo TTK (charge → swap → burst) | 2.17 s | ±0.12 |
| F27 | Melee hits to kill through full shields | 2 | exact |
| F28 | Melee from behind kills in 1 | — | hard |
| F29 | Melee lunge range | 2.10 m | ±0.05 |
| F30 | Weapon swap duration | 0.70 s | ±0.02 |
| F31 | Frag fuse | 3.00 s | ±0.02 |
| F32 | Frag first-bounce apex from a 45° throw at a flat wall, restitution check | e = 0.42 | ±0.03 measured |
| F33 | Frag at 0 m does not kill a full-shield player | 90 < 115 | hard |
| F34 | Frag kills an unshielded player at ≤ 2.7 m, not beyond | 2.70 m | ±0.10 |
| F35 | Stuck plasma kills a full-shield player | — | hard |
| F36 | Level frag throw apex above release | 0.170 m | ±0.02 |
| F37 | Grenade carry cap enforced | 4 / 4 | exact |
| F38 | Red reticle engages at 5.0° half-angle inside effective range | 5.0° | ±0.2° |
| F39 | Bullet magnetism maximum bend | 3.0° | ±0.15° |
| F40 | Magnetism bend is 0 at the exact centre of the cone | 0° | hard |
| F41 | Hitbox inflation factor inside red reticle | 1.15 | ±0.01 |
| F42 | Descope occurs on any damage while scoped | — | hard |
| F43 | `Ridgeback` 0 → 18 m/s | 4.20 s | ±0.15 |
| F44 | `Ridgeback` rolls at sustained lateral accel > 1.25 g | 1.25 g | ±0.08 |
| F45 | Rollover deals no damage to occupants below 12 m/s | — | hard |
| F46 | Self-right hold duration | 1.20 s | ±0.05 |
| F47 | `SKIRN` panic triggers within 0.8 s of `ai.leaderKilled` | 0.80 s | ±0.10 |
| F48 | `CULL` front barrier takes 0 `KINETIC` and > 0 `PLASMA` | — | hard |
| F49 | `VANE` shield recharge delay / duration | 4.0 s / 3.0 s | ±0.10 |
| F50 | Gravity is identical for player, grenades, vehicles, and ragdolls | 9.31 m/s² | exact, single constant |
| F51 | Fall damage threshold | 8.5 m/s | ±0.2 |
| F52 | Coyote time window | 90 ms | ±10 ms |
| F53 | Jump buffer window | 120 ms | ±10 ms |
| F54 | Simulation is frame-rate independent: F01–F08 identical at 30, 60, 144 Hz render rates | — | hard |
| F55 | Two identical input scripts produce bit-identical player transforms | — | hard |

---

## 9. Tuning log

| # | Date | Value changed | From → To | What was felt | What was measured |
| --- | --- | --- | --- | --- | --- |
| — | — | *(empty at Phase 0)* | | | |
</content>
