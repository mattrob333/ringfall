/**
 * MERIDIAN — the heat ramp, in three.js terms.
 *
 * These five values are the same five in `globals.css` (`--color-heat-*`).
 * They are the only place colour is allowed to carry meaning in this product,
 * so they must match the CSS exactly — if you change one, change both.
 *
 * Note the ramp is *not* a simple hue sweep: it starts cold and dim (a distant
 * blue), passes through brass, and ends at a near-white that is deliberately
 * warm. A supernova beacon should look like it is overexposing the sensor.
 */

import * as THREE from 'three';
import type { HeatLevel } from '@/lib/types';

export const HEAT_COLORS: Record<HeatLevel, string> = {
  smoldering: '#3d6fa8',
  warm: '#4fa3c7',
  hot: '#d9a441',
  blazing: '#e8703a',
  supernova: '#fff0c4',
};

/**
 * Relative emissive weight per heat level. Bloom keys off luminance, so this
 * is what actually decides which beacons blaze — the colour alone would make
 * `supernova` bright and `blazing` (a darker orange) look weaker than it is.
 */
export const HEAT_INTENSITY: Record<HeatLevel, number> = {
  smoldering: 0.55,
  warm: 0.75,
  hot: 1.0,
  blazing: 1.35,
  supernova: 1.8,
};

/** Heat levels that earn an expanding pulse ring on the surface. */
export const PULSING_HEAT: ReadonlySet<HeatLevel> = new Set<HeatLevel>([
  'blazing',
  'supernova',
]);

const colorCache = new Map<HeatLevel, THREE.Color>();

/**
 * Cached `THREE.Color` for a heat level.
 *
 * The returned instance is shared — treat it as immutable. Call `.clone()` if
 * you need to mutate. (Colours are constructed in sRGB and three converts to
 * working colour space on assignment, matching the CSS token exactly.)
 */
export function heatColor(heat: HeatLevel): THREE.Color {
  let c = colorCache.get(heat);
  if (!c) {
    c = new THREE.Color(HEAT_COLORS[heat]);
    colorCache.set(heat, c);
  }
  return c;
}

/** Emissive weight for a heat level; see {@link HEAT_INTENSITY}. */
export function heatIntensity(heat: HeatLevel): number {
  return HEAT_INTENSITY[heat] ?? 1;
}

/** True when this beacon should emit surface pulse rings. */
export function heatPulses(heat: HeatLevel): boolean {
  return PULSING_HEAT.has(heat);
}

/** Brass, for chrome that lives inside the scene (focus reticles, ticks). */
export const BRASS = '#c8a866';
export const BRASS_BRIGHT = '#e6cf9b';
export const VOID = '#04050a';
