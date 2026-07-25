# RINGFALL — ART

**Version 1.0 — binding spec. Phase 0 artifact.**

Critics C1 (art direction) and C2 (readability) grade against this document. `tools/palette.mjs`
and `tools/silhouette.mjs` mechanise the gates in §8 and §9. Unmeasured art complaints are
discarded.

---

## 1. Target statement, and why it is reachable

The target is a 2007-era console shooter's art direction: **clean, large-form, high-key,
saturated, emissive-led, atmospheric**. It is not photoreal.

This target is chosen *because* of the constraint that everything is generated from code. A
previous attempt at this harness aimed at a modern photoreal military shooter and scored 5.05/10
with every blind critic identifying the real game every time. The documented root cause was
target selection, not effort: **procedural texture generation cannot fake photographed reality at
close range — noise-derived surfaces read as noise.**

Everything this target is made of is something code is good at:

| The look needs | Code is good at |
| --- | --- |
| Low-frequency, clean painted metal and cast concrete | Analytic gradients, structured panelisation |
| Hard-edged repeated geometric motifs | Constructive geometry, instancing |
| Bold saturated silhouettes | Mesh construction, palette control |
| Emissive-driven readability, glowing strips, plasma, shield flare | HDR + bloom |
| Strong atmospheric perspective | Analytic scattering |
| A 720p30 rendering budget | We have far more headroom than the reference shipped with |

The bar: **a blind viewer with the reference art in front of them says "that's the same art
direction, competently executed."** Not "that's a photograph."

---

## 2. The high-frequency prohibition (the most important rule in this file)

> **All procedural surface detail must be structural, not noise-derived.**

Structural = panel seams, bolt rows, bevels, chamfers, panel gaps, stencil markings, weld beads,
grating, tread plate, ribs, greebles as geometry, painted decals with hard edges.

Noise is permitted **only** as low-amplitude, low-frequency modulation:

| Constraint | Limit |
| --- | --- |
| Max noise contribution to albedo | **±8%** of base value (σ ≤ 0.08 in linear) |
| Max noise contribution to roughness | **±0.15** |
| Max spatial frequency of any noise term | **4 cycles/metre** (25 cm features). Nothing finer. |
| Max normal-map slope from noise | **0.12** (≈ 6.8°) |
| Detail below 25 cm | must come from **geometry or a hard-edged analytic mask**, never from FBM |

Rationale: FBM at high frequency is the exact signal that reads as "procedural" to a human eye.
Removing it is not a limitation — the reference art has very little high-frequency grain to begin
with. Effort saved here is spent on §3 (palette), §5 (silhouette), and §7 (light).

`tools/palette.mjs` measures the radially-averaged power spectrum of a flat-lit close-up of each
material family and fails if energy above 4 cycles/m exceeds 6% of total.

---

## 3. Palette

High-key, saturated, **low global contrast**. Distant geometry fades hard toward sky colour.

### 3.1 Sky (`Ringfall noon` preset)

| Element | sRGB | Notes |
| --- | --- | --- |
| Zenith | `#2F7E90` | Teal |
| Mid-dome | `#6FB2B8` | |
| Horizon, away from sun | `#C9C6A8` | Warm pale |
| Horizon, sun side | `#F2D6A6` | Warm |
| Sun disc | `#FFF2DC`, angular diameter 0.62° | |
| Sun elevation / azimuth | 34° / 118° | Long shadows without being golden-hour |
| Cloud layer | 2 layers, low-frequency only, tinted between horizon and zenith colour | Purely analytic, no detail below 4 cycles/m at cloud scale |

The **megastructure arc** is mandatory in every exterior shot: a band of ringworld sweeping
overhead and down to the horizon, with visible surface features, its own aerial-perspective fade,
and a hard terminator. It is the single strongest silhouette cue in the whole game.

### 3.2 CDF (human) surfaces

Olive drab and gunmetal, bolted panels, stencil markings, matte, wear on **edges only**.

| Name | sRGB | HSV S | Roughness |
| --- | --- | --- | --- |
| Olive drab | `#4A5138` | 0.31 | 0.68 |
| Olive light | `#6B7350` | 0.31 | 0.66 |
| Gunmetal | `#4E5459` | 0.07 | 0.55 |
| Deck grey | `#767B78` | 0.04 | 0.72 |
| Caution yellow | `#C8A02C` | 0.78 | 0.60 |
| Hazard orange | `#D9541E` | 0.86 | 0.62 |
| Optic cyan (emissive) | `#2AA7C4` | 0.79 | — |

* HSV saturation for CDF structural surfaces: **0.15–0.35**. Markings are exempt.
* Metal is bare **only** on chamfers and edges, in a 2–4 cm band: roughness → 0.35, metalness → 1.0.
  Anisotropic, aligned to the edge direction. Never a broadcast dirt layer.
* Every large CDF panel carries at least one stencil element (numeral, arrow, hatch band) at a
  scale legible from 8 m. Stencils are hard-edged vector shapes, not textures.

### 3.3 Vess (antagonist) surfaces

Smooth lavender-to-blue organic shells, high gloss, emissive accents.

| Name | sRGB | HSV | Roughness |
| --- | --- | --- | --- |
| Shell base | `#6A5DA8` | H 251° S 0.44 V 0.66 | 0.18 |
| Shell light | `#A99BDC` | H 252° S 0.30 V 0.86 | 0.15 |
| Shell deep | `#3B3468` | H 249° S 0.50 V 0.41 | 0.22 |
| Plasma cyan (emissive) | `#57E0FF` | | — |
| Plasma violet (emissive) | `#B36BFF` | | — |

* Roughness **0.12–0.25**, with a clearcoat lobe. Shells read as a single continuous form with
  smooth curvature gradients — no panel gaps, no bolts, no stencils.
* Emissive accents run at **3–8× the linear luminance of the adjacent diffuse surface**, which
  places them cleanly above the bloom threshold (§7). This is the specified range; below 3× they
  do not bloom and the faction loses its read, above 8× they clip and lose hue.

### 3.4 Wrought (precursor) surfaces

Clean pale slabs, deep panel gaps, glowing seam strips, large-radius repeated motifs.

| Name | sRGB | HSV S | Roughness |
| --- | --- | --- | --- |
| Slab pale | `#C6C7BE` | 0.04 | 0.42 |
| Slab shadow | `#9AA09B` | 0.04 | 0.45 |
| Gap dark | `#24282A` | 0.10 | 0.80 |
| Seam emissive | `#8FE6E0` | — | — |

* Panel gaps are **4–8 cm wide and 6–12 cm deep**, real geometry, not a texture line. The gap
  shadow is the primary form-reading cue.
* Motifs repeat at a **2.5 m to 8 m** module. Large radius, never fussy.

### 3.5 Terrain

| Name | sRGB | HSV S |
| --- | --- | --- |
| Rock | `#7C7466` | 0.18 |
| Dirt | `#6E5B45` | 0.38 |
| Grass | `#5F7A3A` | 0.52 |
| Sand | `#C2AE86` | 0.31 |

Terrain saturation runs higher than CDF hardware on purpose — the world is lush and the machinery
is drab, which is what makes the machinery read.

---

## 4. Lighting model (owner: `lighting` / S1 only)

| Component | Spec |
| --- | --- |
| Sun | One directional light, CSM 4 cascades, angular softness matched to a 0.62° disc |
| Sky ambient | L2 spherical harmonics projected from the procedural sky LUT at boot. Not a constant colour, not an image. |
| Ground bounce | Single-colour hemisphere term derived from the dominant terrain albedo × sun irradiance × 0.35 |
| Local lights | Clustered forward+, point and spot, up to 256 visible. No area lights. |
| Emissive | Contributes to bloom and to nothing else — emissives do not light the scene. Where an emissive strip must light its surroundings, a co-located low-intensity point light is authored explicitly. |
| Fog / aerial perspective | Exponential height fog, two-lobe Henyey-Greenstein inscatter, **sampled from the same sky LUT as the sky dome** so distant geometry converges exactly to the sky colour behind it |
| Exposure | A **per-level constant**. There is no auto-exposure, ever. See `ARCHITECTURE.md` §6. |
| Shadows | 4 cascades at 12 / 32 / 90 / 260 m, 2048², stabilised and texel-snapped, 3×3 PCF with a normal-offset bias |

---

## 5. Silhouette (hard gate, see §8)

Silhouette is graded above surface quality. A character that reads at 60 m in one glance is worth
more than a character with perfect close-up material.

| Archetype | Silhouette key | Distinguishing mass |
| --- | --- | --- |
| `SKIRN` | Small, hunched, wide dorsal tank cluster | Squat oval body + bulbous back mass, head below shoulder line |
| `CULL` | Medium, asymmetric, forward arm slab | One arm reads as a flat vertical rectangle held forward; body offset behind it |
| `VANE` | Tall, flared shoulders, split helm | Inverted-triangle torso, tall narrow head with a forked crest |
| `WARDEN` | Huge, wide, low-headed, plated | Nearly square outline, head sunk between shoulders, wider than tall at the shoulder |
| `Ridgeback` | Open-frame vehicle, exposed roll cage, rear turret post | Reads as a rectangle of negative space |
| Player | — | — |

Height and mass separation is deliberate and must be preserved by every art pass:

```
SKIRN  1.42 m   CULL 1.78 m   VANE 2.34 m   WARDEN 2.85 m
shoulder width:  0.52 / 0.61 / 0.78 / 1.42 m
```

---

## 6. Weapon view models

The close first-person weapon is the shot that destroyed the prior attempt. Requirements:

* Silhouette-first: every weapon is identifiable as a black shape.
* **Chunky, oversized, readable proportions** — the reference era exaggerates receiver mass and
  magazine size. Do not make an anatomically correct firearm.
* Detail is geometry: rails, vents, bolts, ejection ports, carry handles, hard bevels. Not a
  normal map, and specifically not noise (§2).
* CDF weapons carry a small emissive ammo counter with legible digits — a functional light source
  in the frame and an era signature.
* Vess weapons have visible internal plasma volume glowing through a translucent shell, with the
  glow intensity driven by heat state.
* Diffuse mean luminance of the view model, measured on shot 5 (`weapon_close`), must land in
  **L\* 50–75** against a world mean of L\* 58–72. A weapon that is 30 L\* darker than its world is
  the specific failure mode that produced "looks flat" in the prior attempt.

---

## 7. Tonemap, exposure, and bloom (owner: `lighting` / S1 only)

### 7.1 Hue-preserving filmic composite

A standard neutral filmic curve desaturates highlights toward white and **kills this look on its
own**. The composite is therefore:

```glsl
vec3 c   = hdr * EXPOSURE;                       // EXPOSURE is a per-level constant
float L  = dot(c, vec3(0.2126, 0.7152, 0.0722));
float Lt = gt_tonemap(L);                        // scalar GT curve, params below
vec3 hue = c * (Lt / max(L, 1e-5));              // preserves hue AND saturation
vec3 pc  = vec3(gt_tonemap(c.r), gt_tonemap(c.g), gt_tonemap(c.b));
vec3 o   = mix(hue, pc, DESAT_STRENGTH);         // DESAT_STRENGTH = 0.22
```

`gt_tonemap` is the Uchimura GT curve with `P = 1.0` (max), `a = 1.05` (contrast),
`m = 0.22` (linear section start), `l = 0.40` (linear length), `c = 1.20` (black tightness),
`b = 0.0` (pedestal).

`DESAT_STRENGTH = 0.22` is the only lever between "highlights hold their colour" and "highlights
clip into neon". It is gated by §9's highlight-saturation measurement, not by taste.

### 7.2 Bloom — bright and wide, on purpose

| Property | Value |
| --- | --- |
| Threshold | 1.0 in post-exposure linear |
| Soft knee | 0.55 |
| Pyramid | 6 levels, ½ → 1/64 |
| Downsample | 13-tap with Karis average on level 0 only (fireflies) |
| Upsample | 3×3 tent, radius 1.0 in level-relative texels |
| Composite | additive, intensity **0.075**, level weights `[1.0, 0.85, 0.68, 0.52, 0.38, 0.26]` |
| Lens dirt / streaks | **none** — that is a different era |

Bloom is part of the look, not a defect. Critics may not file "too much bloom" without the §9
measurement showing the halo extent outside spec.

---

## 8. Hard gates — `tools/silhouette.mjs`

Render each archetype at **60 m**, full body, camera at 1.62 m eye height, flat sky background,
1080p, vFOV 55.4°.

| Gate | Condition |
| --- | --- |
| A1 | Each archetype's thresholded mask is ≥ 30 px tall and ≥ 250 px in area (i.e. it is actually visible at 60 m) |
| A2 | Threshold: a pixel is figure if its luminance differs from the local sky luminance by > 12% |
| A3 | Masks are bounding-box normalised to 256×256, then pairwise IoU computed. **Any pair ≥ 0.60 fails the character pass**, regardless of close-up quality |
| A4 | Aspect ratio (w/h) of the four archetype masks must span a range of at least 0.55 |
| A5 | Each archetype is still distinguishable with the mask reduced to 64×64 (IoU test repeated at low resolution, threshold 0.68) |

---

## 9. Hard gates — `tools/palette.mjs`

Measured on the 12-shot baseline set. `L*` is CIE lightness from the composited sRGB output.

| Gate | Shot(s) | Condition |
| --- | --- | --- |
| P1 Scene lightness | 3, 4 | Mean `L*` of all pixels in **58–72** |
| P2 Global contrast | 3, 4 | `L(P95) / L(P05)` in **8:1 – 20:1** (low contrast, high key). A ratio > 30:1 means the look has gone modern-shooter. |
| P3 Scene saturation | 3, 4, 6 | Mean HSV `S` over non-sky pixels in **0.18–0.34** |
| P4 **Highlight saturation** | all | Sample the 20 brightest pixels; mean HSV `S` must be **≥ 0.25**. A neutral filmic curve fails this. |
| P5 Aerial perspective | 3 | A neutral 0.18-albedo test slab blends toward sky colour by **≥ 22% at 60 m**, **≥ 65% at 200 m**, **≥ 92% at 500 m** |
| P6 Sky/ground convergence | 3 | At the horizon line, mean colour difference between the furthest terrain band and the sky directly above it: ΔE < 6 |
| P7 Emissive ratio | 2, 9 | Vess/Wrought emissive pixels measure **3–8×** the linear luminance of adjacent diffuse |
| P8 Bloom extent | 9 | A 4× overbright emissive strip 4 px wide produces a halo whose luminance is ≥ 5% of source at ≥ 18 px from the strip edge, and < 5% beyond 90 px |
| P9 Weapon luminance match | 5 | View-model diffuse mean `L*` in **50–75**, and within **±22 L\*** of the world mean in the same frame |
| P10 High-frequency budget | 1, 2, 5, 6 | Radially-averaged power spectrum: energy above 4 cycles/m ≤ **6%** of total (the §2 prohibition) |
| P11 Family separation | 1, 2, 6 | Mean hue of CDF, Vess, and Wrought surface pixels separated by ≥ 45° pairwise |
| P12 Megastructure present | 3, 4, 12 | The ring arc occupies ≥ 4% of frame pixels and is distinguishable from sky by ΔE ≥ 10 |

---

## 10. Explicitly out of scope

Do not spend effort on any of these. They belong to a different target and every hour spent on
them is an hour taken from silhouette, palette coherence, and light.

* Pore-level or micro-scratch surface detail
* Photographic grain, sensor noise, film emulation
* Screen-space reflections beyond a cheap planar/box fallback on wet-deck materials
* Subsurface scattering
* Parallax-occlusion mapping
* Lens dirt, anamorphic streaks, heavy chromatic aberration
* Physically measured material databases
* Anything that requires an image file (§1 of `ARCHITECTURE.md`)

---

## 11. Critic rubrics

### C1 Art direction (0–10)

| Weight | Criterion | Evidence |
| --- | --- | --- |
| 25% | Palette coherence and family separation | P3, P11, §3 tables |
| 25% | Atmosphere and depth | P5, P6, P12 |
| 20% | Light quality and highlight behaviour | P1, P2, P4, P7, P8 |
| 20% | Material read at the intended distance | P9, P10, §2 |
| 10% | Megastructure and vista composition | P12, shots 3/4/12 |

### C2 Readability (0–10)

| Weight | Criterion | Evidence |
| --- | --- | --- |
| 35% | Enemy silhouette separation at range | A1–A5 |
| 25% | Shield and damage state legibility in a firefight | shot 10, shot 11, `FEEL.md` §7 |
| 20% | HUD clarity under load | shot 11 |
| 20% | Weapon and reload state legible from the view model alone | shot 5 |

---

## 12. Amendment log

| # | Date | Change | Measurement / reason |
| --- | --- | --- | --- |
| — | 2026-07-25 | *(v1.0 baseline)* | |
</content>
