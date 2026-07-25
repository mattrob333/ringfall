// L4 fx — pool sizes, buffer layouts, shape ids and the palette FX draws from.
// OWNER: `fx`. ARCHITECTURE.md §2.2 — `fx` is a pure, listen-only consumer of
// the event bus. Nothing in this directory emits.
//
// ART.md §2 (the high-frequency prohibition) applies here exactly as it does to
// surfaces: every particle and every decal shape in this system is an ANALYTIC
// mask evaluated in the fragment shader. There are no texture files, no
// generated bitmaps, no FBM, and no noise term of any frequency.

import { hexToLinear, CDF, VESS, WROUGHT, TERRAIN } from '../shared/palette.js';

// ---------------------------------------------------------------------------
// Pool caps. Total particle cap is ADD_CAP + ALPHA_CAP = 4000 (the brief's cap).
// ---------------------------------------------------------------------------
export const ADD_CAP = 2600; // additive: sparks, flashes, tracers, plasma, rings
export const ALPHA_CAP = 1400; // alpha: smoke, dust, dirt, chips
export const PARTICLE_CAP = ADD_CAP + ALPHA_CAP;
export const DECAL_CAP = 256;
export const LIGHT_CAP = 24; // clustered point lights we reserve from renderer.clusters
export const EMITTER_CAP = 24; // grenade trails + vent plumes in flight at once

/** Draw calls this system contributes to frame graph pass 8. Constant, always. */
export const FX_DRAW_CALLS = 3; // decals, alpha particles, additive particles

// ---------------------------------------------------------------------------
// Particle CPU buffer layout. One flat Float32Array, interleaved, STRIDE floats
// per particle. There is no per-particle object anywhere in this system.
// ---------------------------------------------------------------------------
export const P_STRIDE = 24;
export const P_PX = 0;
export const P_PY = 1;
export const P_PZ = 2;
export const P_VX = 3;
export const P_VY = 4;
export const P_VZ = 5;
export const P_AGE = 6;
export const P_LIFE = 7;
export const P_SIZE0 = 8;
export const P_SIZE1 = 9;
export const P_R = 10;
export const P_G = 11;
export const P_B = 12;
export const P_I0 = 13; // intensity multiplier at birth
export const P_I1 = 14; // intensity multiplier at death
export const P_DRAG = 15; // exponential velocity damping, per second
export const P_GRAV = 16; // multiplier on the shared GRAVITY constant
export const P_ROT = 17;
export const P_SPIN = 18;
export const P_SHAPE = 19;
export const P_STRETCH = 20; // metres of streak per (m/s) of speed. 0 = billboard.
export const P_SEED = 21; // 0..1, used by the analytic shard/crackle shapes
export const P_ALPHA = 22; // coverage at birth
export const P_FADE = 23; // exponent on (1 - t); >1 dies fast, <1 lingers

// ---------------------------------------------------------------------------
// Decal CPU buffer layout.
// ---------------------------------------------------------------------------
export const D_STRIDE = 16;
export const D_PX = 0;
export const D_PY = 1;
export const D_PZ = 2;
export const D_NX = 3;
export const D_NY = 4;
export const D_NZ = 5;
export const D_SIZE = 6;
export const D_ROT = 7;
export const D_PATTERN = 8;
export const D_AGE = 9;
export const D_LIFE = 10;
export const D_R = 11;
export const D_G = 12;
export const D_B = 13;
export const D_ALPHA = 14;
export const D_BIRTH = 15; // monotonic stamp, drives oldest-out replacement

// ---------------------------------------------------------------------------
// Analytic particle shapes. Implemented in src/fx/shaders.js.
// ---------------------------------------------------------------------------
export const Shape = Object.freeze({
  DISC: 0, // soft puff — smoke, dust, muzzle bloom
  RING: 1, // annulus — shockwave, resonant ring, vent ring
  STREAK: 2, // velocity-aligned taper — sparks, ricochets, tracers
  SPARK: 3, // hot core + halo — ember, chip glow
  CRACKLE: 4, // radial spoke sheet — SHIELD / ENERGY_BARRIER
  SHARD: 5, // hard-edged triangle — GLASS
  SHELL: 6, // bright expanding shell — shield.broken, detonation core
});

/** Analytic decal patterns. Implemented in src/fx/shaders.js. */
export const Decal = Object.freeze({
  METAL: 0, // dark crater, bright rim, radial scratch spokes
  STONE: 1, // pale irregular chip ring with a dark core
  SOFT: 2, // dirt / grass / sand scatter, no rim
  GLASS: 3, // hole plus radial crack star
  ALLOY_SMOOTH: 4, // Vess: clean scorch ring
  ALLOY_HARD: 5, // Wrought: hard hexagonal scorch
  SCORCH: 6, // explosion / grenade blast mark
});

// ---------------------------------------------------------------------------
// Linear-space colours. Every value derives from ART.md §3 via shared/palette.
// ---------------------------------------------------------------------------
const L = (hex) => {
  const c = hexToLinear(hex);
  return Object.freeze(c);
};

export const FxColor = Object.freeze({
  // Kinetic sparks: hot steel. Warm white core through orange.
  sparkHot: L('#FFE9C6'),
  sparkWarm: L('#FF9A3C'),
  sparkDeep: L('#D9541E'),

  // CDF muzzle / tracer family — warm, per the brief.
  cdfMuzzle: L('#FFD9A0'),
  cdfTracer: L('#FFC46A'),

  // Vess family — cyan / violet.
  vessMuzzle: L(VESS.plasmaCyan),
  vessTracer: L(VESS.plasmaCyan),
  vessViolet: L(VESS.plasmaViolet),

  // Wrought.
  wroughtSeam: L(WROUGHT.seamEmissive),
  wroughtSlab: L(WROUGHT.slabPale),

  // Surface debris.
  concreteDust: L('#B7B2A2'),
  concreteChip: L('#8E8878'),
  rockDust: L(TERRAIN.rock),
  dirtDust: L(TERRAIN.dirt),
  grassBit: L(TERRAIN.grass),
  sandDust: L(TERRAIN.sand),
  glassShard: L('#CFE8EE'),

  // Smoke. Dark, low value — FEEL.md §4.6 wants the frag trail readable
  // against a bright sky, which means DARK, not bright.
  smokeDark: L('#3A3B38'),
  smokeMid: L('#6A6B64'),

  // Shields and energy.
  shieldCrackle: L('#8FD8FF'),
  shieldFlare: L('#CFF0FF'),

  // Flesh — ART/FEEL want feedback without gore. Bright particulate, not blood.
  fleshSpark: L('#FFD2B0'),

  // Explosions.
  fragCore: L('#FFE3B0'),
  fragBody: L(CDF.hazardOrange),
  plasmaCore: L('#DFF8FF'),
  plasmaBody: L(VESS.plasmaCyan),

  // Indicator light on a thrown frag (FEEL.md §4.6, must read against sky).
  fragBlink: L('#FF5A2A'),

  // Decal inks. Linear, dark — decals darken the surface, they never add light.
  inkScorch: [0.006, 0.0055, 0.005],
  inkMetal: [0.012, 0.012, 0.013],
  inkStone: [0.09, 0.086, 0.078],
  inkSoft: [0.018, 0.014, 0.010],
  inkGlass: [0.35, 0.42, 0.45],
  inkAlloy: [0.02, 0.03, 0.035],
});
