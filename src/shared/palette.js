// L0 shared — ART.md §3 palette, as linear-space floats.
// Hex values here must match ART.md exactly. palette.mjs grades against ART.md.

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** '#RRGGBB' -> [r,g,b] linear. */
export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)];
}

/** '#RRGGBB' -> [r,g,b] sRGB 0..1 (for UI, which is never tonemapped). */
export function hexToSrgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const SKY = Object.freeze({
  zenith: '#2F7E90',
  mid: '#6FB2B8',
  horizon: '#C9C6A8',
  horizonSun: '#F2D6A6',
  sunDisc: '#FFF2DC',
  sunAngularDiameterDeg: 0.62,
  sunElevationDeg: 34,
  sunAzimuthDeg: 118,
});

export const CDF = Object.freeze({
  oliveDrab: '#4A5138',
  oliveLight: '#6B7350',
  gunmetal: '#4E5459',
  deckGrey: '#767B78',
  cautionYellow: '#C8A02C',
  hazardOrange: '#D9541E',
  opticCyan: '#2AA7C4',
});

export const VESS = Object.freeze({
  shellBase: '#6A5DA8',
  shellLight: '#A99BDC',
  shellDeep: '#3B3468',
  plasmaCyan: '#57E0FF',
  plasmaViolet: '#B36BFF',
});

export const WROUGHT = Object.freeze({
  slabPale: '#C6C7BE',
  slabShadow: '#9AA09B',
  gapDark: '#24282A',
  seamEmissive: '#8FE6E0',
});

export const TERRAIN = Object.freeze({
  rock: '#7C7466',
  dirt: '#6E5B45',
  grass: '#5F7A3A',
  sand: '#C2AE86',
});

/** ART.md §3.3 — emissive runs 3-8x the linear luminance of adjacent diffuse. */
export const EMISSIVE_RATIO = Object.freeze({ min: 3.0, max: 8.0, nominal: 5.0 });

export const HUD = Object.freeze({
  primary: '#7FE3C8',
  primaryDim: '#3E8F7C',
  shield: '#6FD8FF',
  health: '#8FE07A',
  warning: '#FFC24A',
  danger: '#FF6B3D',
  reticle: '#D8F5EC',
  reticleHot: '#FF5A46',
});
