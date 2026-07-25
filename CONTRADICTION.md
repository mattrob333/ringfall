# RINGFALL — CONTRADICTIONS

Append-only, per `ARCHITECTURE.md` §0.7. A subagent that believes its brief is wrong files here
with **the measurement**, **what the brief predicts**, and **what it proposes**. It does not
silently deviate.

---

## C1 — `FEEL.md` F23 (`Ember Repeater` full TTK) is unsatisfiable against `src/shared/damage.js`

**Filed by:** `sandbox` (owner of `src/weapons/**`), round 0.
**Assertion:** F23 — `Ember Repeater` full TTK, target **2.93 s**, tolerance **±0.10**.
**Status:** open. `src/weapons/selftest.js` reports F23 as a **FAIL** with the real number.

### Measurement

Real `WeaponSystem` firing `ember_repeater` (6.0 `PLASMA`, 450 rpm) at a 70-shield / 45-health
target, every round on the torso, damage resolved through `resolveDamage()`:

```
round  1  shield 60.4000  health 45.0000
round  2  shield 50.8000  health 45.0000
...
round  7  shield  2.8000  health 45.0000
round  8  shield  0.0000  health 42.6625   <- SHIELD BREAK  (F22 = 8, passes)
round  9  shield  0.0000  health 39.3625
...
round 21  shield  0.0000  health  0.0000   <- KILL

strip rounds        =  8          (FEEL.md §4.2:  8  ✔)
finishing rounds    = 13          (FEEL.md §4.2: 14  ✘)
total rounds        = 21          (FEEL.md §4.2: 22  ✘)
TTK, rounds × refire = 2.8000 s   (FEEL.md F23:  2.93 s, tolerance ±0.10 → fails by 0.03)
TTK, first-to-last   = 2.6750 s
```

### What the brief predicts, and why it does not happen

`FEEL.md` §4.2 derives the number as two independent ceilings:

```
vs shields: 6.0 × 1.60 = 9.6  ⇒ ⌈70 / 9.6⌉ = 8 rounds (1.07 s)
vs health:  6.0 × 0.55 = 3.3  ⇒ ⌈45 / 3.3⌉ = 14 rounds (1.87 s)
                                   total 22 rounds = 2.93 s
```

The health term starts from a **full 45 hp**. It does not, because `resolveDamage()`
(`src/shared/damage.js`, orchestrator-owned) bleeds the shield-breaking round's overkill through
to health:

```js
const consumed = shield / vsShield;   // 2.80 / 1.60 = 1.75 raw units spent on the shield
shield = 0;
pool -= consumed;                     // 6.00 − 1.75 = 4.25 raw units left
health -= pool * vsHealth;            // 4.25 × 0.55 = 2.3375 hp
```

So the health phase begins at **42.6625 hp**, and `⌈42.6625 / 3.3⌉ = 13`, not 14. One round
short — 0.1333 s — which is exactly the 0.13 s by which F23 misses.

The same bleed-through is *harmless* for the other two weapons and both of those assertions pass:
`Cadence AR` breaks the shield with 14 × 5.0 = 70 exactly (zero overkill, F21 = 2.3000 s exact),
and `Vector BR` leaks only 2.0 hp on round 9, not enough to change the burst count (F18 = 4,
F19 = 1.3250 s, F20 = round 9).

### Options

| # | Change | Consequence |
| --- | --- | --- |
| **1 (preferred)** | Correct F23's target to **2.80 s** and `FEEL.md` §4.2's derivation to `8 + 13 = 21 rounds`. | Zero code change. The *felt* property — "plasma strips 31% faster and finishes 69% slower" (F24) — is unaffected and still measures 1.067 s strip vs 1.400 s for kinetic, 1.733 s finish vs 0.900 s. The asymmetry the sandbox is built on survives intact. |
| 2 | Change `Ember Repeater` damage 6.0 → 5.7 so 8 strip rounds still hold but the health phase needs 14. | Touches a felt number to protect a derived one. Also re-derives §4.2's whole plasma paragraph. |
| 3 | Make `resolveDamage()` discard shield-break overkill. | A §12 amendment to the damage contract, affecting every weapon, both grenade types, melee and vehicles. Disproportionate. |

**Proposed:** option 1. `FEEL.md`'s prose already contains the arithmetic error; the code is right.

---

## C2 — `FEEL.md` F34 (frag kill radius 2.70 m) contradicts `FEEL.md` §4.6's own falloff exponent

**Filed by:** `sandbox`, round 0.
**Assertion:** F34 — frag kills an unshielded player at ≤ **2.70 m**, tolerance **±0.10**.
**Status:** open. `src/weapons/selftest.js` reports F34 as a **FAIL** with the real number.

### Measurement

Real grenade, real detonation, damage through `resolveDamage()` + `blastFalloff()`, kill radius
found by 30-step bisection on the target's distance from the detonation point:

```
measured kill radius vs a 0-shield / 45-health target : 2.23199 m
FEEL.md F34 target                                    : 2.70 m ± 0.10  → fails by 0.37 m
```

### What the brief predicts, and why it does not happen

`FEEL.md` §4.6 specifies frag blast **90** at 0 m, radius **5.50 m**, falloff **`(1 − d/r)^1.6`**,
type `EXPLOSIVE`. `ARCHITECTURE.md` §5.3 gives `EXPLOSIVE` a **×1.15** health multiplier. Solving
`90 · (1 − d/5.5)^1.6 · 1.15 = 45`:

```
(1 − d/5.5)^1.6 = 0.434783
 1 − d/5.5      = 0.594164
        d       = 2.2320 m        ← what the code does, and what was measured
```

`FEEL.md`'s own "they kill an unshielded player out to 2.7 m" is only true under a **linear**
falloff with no health multiplier:

```
90 · (1 − d/5.5) = 45   →   d = 2.7500 m      ← matches "2.7 m" to the digit
```

i.e. the 2.7 m figure predates the `^1.6` exponent and was never recomputed. It is arithmetically
impossible to satisfy F34 and §4.6 simultaneously as written.

### Options

| # | Change | Kill radius | Notes |
| --- | --- | --- | --- |
| **1 (preferred)** | Correct F34's target to **2.23 m** and drop "out to 2.7 m" from §4.6's prose. | 2.232 m | Zero code change. Holds the exponent, which is the *shape* of the falloff and the felt quantity ("grenades open a window, they do not close a fight"). A tighter lethal radius is, if anything, more on-brief. |
| 2 | Frag falloff exponent **1.6 → 1.234**. | 2.700 m | Flattens the falloff; the frag becomes meaningfully more dangerous at every distance from 0.4 m out. |
| 3 | Frag blast radius **5.50 → 6.65 m**. | 2.700 m | Widens the whole blast, including its non-lethal reach, by 21%. |
| 4 | Frag blast damage **90 → 115.25**. | 2.700 m | **Rejected — this breaks F33.** Effective HP of a full-shield player against `EXPLOSIVE` is `70 + 45/1.15 = 109.13`; 115.25 at 0 m would delete a healthy player, violating "grenades never delete a healthy player". |

**Proposed:** option 1. If a wider lethal radius is genuinely wanted on feel, option 2 is the
cheapest and F33 survives it (`90 < 109.13` regardless of the exponent).

### Cross-check that the implementation is not the problem

F33 (`frag at 0 m does not kill a full-shield player`) passes with the same code path: the target
ends on `shield 0 / health 22.000`, exactly `45 − (90 − 70) × 1.15`. F36 (level-throw apex,
0.16225 m vs 0.170 ± 0.02) and F32 (restitution) pass. The blast maths is right; only the
predicted radius is wrong.
