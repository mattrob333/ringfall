// L2 render — OWNER: `lighting` (S1) ONLY. ARCHITECTURE.md §2.1.
//
// ============================================================================
//  NO OTHER AGENT MAY EDIT THIS FILE. EVER. FOR ANY REASON.
//  A local brightness complaint is fixed on the object, in src/materials or in
//  that object's construction. It is NEVER fixed here.
// ============================================================================
//
// There is NO auto-exposure. Exposure is a per-level constant. An adaptive
// exposure term makes every art critique non-reproducible and was the documented
// mechanism of the prior attempt's death spiral (PROCESS_LOG.md).

/**
 * Derivation of the default, so a future reader can check it rather than trust it.
 *
 * ART.md P1 wants mean scene L* in 58-72. Take the midpoint, L* = 65:
 *     Y = ((65 + 16) / 116)^3 = 0.3405        (displayed linear luminance)
 *
 * The GT curve's linear section is  y = m + a(x - m)  with m = 0.22, a = 1.05,
 * so the pre-tonemap scene value that lands there is:
 *     x = 0.22 + (0.3405 - 0.22) / 1.05 = 0.3348
 *
 * uSunColor is IRRADIANCE, and the Lambert BRDF divides by PI:
 *     L_direct = (albedo / PI) * E * N.L
 *
 * (v1.0 of this file omitted the 1/PI and the whole scene rendered PI times too
 * dark. The fix was to raise the sun to a physically consistent value, NOT to
 * raise exposure to hide it — raising exposure would have crushed the contrast
 * ratio and failed ART.md P2 while looking "fixed".)
 *
 * For a 0.18-albedo surface at N.L = 0.85 with sun-disc linear luminance 0.911:
 *     E_lum   = 0.911 * SUN_INTENSITY = 0.911 * 7.4 = 6.74
 *     direct  = (0.18 / PI) * 6.74 * 0.85 = 0.328
 *     ambient = sky SH irradiance/PI (~0.30) * SKY_INTENSITY * 0.18
 *             = 0.054 * 0.72 = 0.0389
 *     total   = 0.367
 *
 *     EXPOSURE = 0.3348 / 0.367 = 0.912  ->  rounded to 0.91
 *
 * Shadowed ambient-only lands at 0.0389 * 0.91 = 0.0354, which the toe maps to
 * ~0.0248. Sunlit lands at 0.335. P95/P05 luminance ratio ~ 13.5:1, inside
 * ART.md P2's 8:1-20:1 window.
 *
 * SKY_INTENSITY was 1.0 and, worse, was declared here but never actually
 * applied to the SH projection. tools/palette.mjs measured whole-scene contrast
 * at a median of 4.25:1 against a floor of 8:1 — the ambient term was filling
 * every shadow. Wiring it up at 0.72 is a global change made in response to a
 * GLOBAL measurement, which is the level ARCHITECTURE.md §0.3 permits; it is
 * not a global fix for one object looking wrong.
 */
export const EXPOSURE = 0.91;

/** Sun IRRADIANCE scalar. Multiplied by the sun's linear colour. */
export const SUN_INTENSITY = 7.4;

/** Sky-SH ambient scalar. Applied in sky.js projectSH(). */
export const SKY_INTENSITY = 0.72;

/** Ground bounce as a fraction of sun irradiance. ART.md §4. */
export const GROUND_BOUNCE = 0.35;

/** Per-level overrides. Night is dimmer in the world, NOT darker in the curve. */
export const LEVEL_EXPOSURE = Object.freeze({
  default: EXPOSURE,
  night: EXPOSURE, // identical curve; the night look comes from the lights, not here
});

/**
 * The only sanctioned way to read exposure. Any call site that multiplies this
 * by something else is a COMPENSATION and must be logged in DEFECTS.md.
 */
export function exposureFor(levelKey = 'default') {
  return LEVEL_EXPOSURE[levelKey] ?? EXPOSURE;
}
