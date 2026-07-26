// L4 fx — the effect recipes. Every function here is a pure spawner: it reads
// an event payload and pushes particles / decals / lights into the pools. It
// owns no state and allocates nothing per call.
//
// Brightness is expressed in MULTIPLES OF THE BLOOM THRESHOLD. ART.md §7.2 puts
// the threshold at 1.0 in POST-EXPOSURE linear, and exposure is a frozen
// constant owned by `lighting`, so `ctx.B = 1 / uExposure` is the scene-linear
// value that lands exactly on the knee. Writing `9 * ctx.B` therefore means
// "nine times the bloom threshold" and stays correct if `lighting` ever
// re-derives EXPOSURE. This reads the sanctioned uniform; it is not a
// compensation and does not duplicate the constant.

import { SurfaceId, DamageType } from '../shared/enums.js';
import { Shape, Decal, FxColor } from './constants.js';

// --- scratch, module level, never reallocated -------------------------------
//
// This is a Float32Array rather than nine `let` bindings ON PURPOSE. V8 stores
// a module-level `let` holding a double as a boxed HeapNumber, so every write
// to one allocates ~16 bytes. A single concrete impact writes this scratch ~45
// times; measured, that was ~670 bytes of garbage PER BULLET HOLE. Typed-array
// element stores are unboxed and allocate nothing.
//
//   [0..2] direction (cone output)   [3..5] tangent   [6..8] bitangent
const _s = new Float32Array(9);
const D0 = 0, D1 = 1, D2 = 2;
const T0 = 3, T1 = 4, T2 = 5;
const B0 = 6, B1 = 7, B2 = 8;

/** Build an orthonormal basis around (nx,ny,nz) into the module scratch. */
function basis(nx, ny, nz) {
  const ux = Math.abs(ny) < 0.9 ? 0 : 1;
  const uy = Math.abs(ny) < 0.9 ? 1 : 0;
  // t = normalize(cross(u, n))
  let tx = uy * nz - 0 * ny;
  let ty = 0 * nx - ux * nz;
  let tz = ux * ny - uy * nx;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  _s[T0] = tx; _s[T1] = ty; _s[T2] = tz;
  _s[B0] = ny * tz - nz * ty;
  _s[B1] = nz * tx - nx * tz;
  _s[B2] = nx * ty - ny * tx;
}

/**
 * Cosine-ish cone around the current basis normal. `spread` in [0,1]:
 * 0 = straight along n, 1 = full hemisphere.
 */
function cone(rand, nx, ny, nz, spread) {
  const cosA = 1 - rand.next() * spread;
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const phi = rand.next() * Math.PI * 2;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  _s[D0] = nx * cosA + _s[T0] * sinA * cp + _s[B0] * sinA * sp;
  _s[D1] = ny * cosA + _s[T1] * sinA * cp + _s[B1] * sinA * sp;
  _s[D2] = nz * cosA + _s[T2] * sinA * cp + _s[B2] * sinA * sp;
}

/**
 * Copy a payload triple into a caller-owned Float32Array(3), substituting a
 * default if the field is missing or non-finite. Handlers must not retain event
 * payload references (ARCHITECTURE.md §4), which is exactly why this copies.
 * @param {ArrayLike<number>|undefined} arr
 * @param {Float32Array} out
 */
function readVec(arr, out, def0, def1, def2) {
  if (!arr || arr.length < 3) {
    out[0] = def0; out[1] = def1; out[2] = def2;
    return out;
  }
  const x = arr[0], y = arr[1], z = arr[2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    out[0] = def0; out[1] = def1; out[2] = def2;
    return out;
  }
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/** In-place normalise with a fallback direction. */
function normalizeInto(out, def0, def1, def2) {
  const l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
  if (l > 1e-5) {
    out[0] /= l; out[1] /= l; out[2] /= l;
  } else {
    out[0] = def0; out[1] = def1; out[2] = def2;
  }
  return out;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * `energy` has no declared unit in ARCHITECTURE.md §4.4, so it is compressed
 * with a square root and clamped. Whether the emitter sends damage points or
 * joules, the visual response stays inside a sane band.
 */
function energyNorm(energy) {
  const e = Number.isFinite(energy) && energy > 0 ? energy : 10;
  return clamp(Math.sqrt(e) / 6, 0.25, 1.8);
}

// ---------------------------------------------------------------------------
// surface.impact — the single most important hook (ARCHITECTURE.md §4.4)
// ---------------------------------------------------------------------------

export function surfaceImpact(ctx, px, py, pz, nx, ny, nz, surfaceId, energy, damageType) {
  const B = ctx.B;
  const rand = ctx.rand;
  const lod = ctx.lod(px, py, pz);
  if (lod <= 0) return;
  const e = energyNorm(energy);
  basis(nx, ny, nz);

  switch (surfaceId) {
    case SurfaceId.METAL_PAINTED:
    case SurfaceId.METAL_BARE:
    case SurfaceId.METAL_GRATE:
    case SurfaceId.ARMOR_HARD:
    case SurfaceId.VEHICLE_HULL:
      metalImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand, surfaceId);
      break;

    case SurfaceId.CONCRETE:
    case SurfaceId.ROCK:
      stoneImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand, surfaceId);
      break;

    case SurfaceId.DIRT:
    case SurfaceId.GRASS:
    case SurfaceId.SAND:
      softImpact(ctx, px, py, pz, nx, ny, nz, e, lod, rand, surfaceId);
      break;

    case SurfaceId.GLASS:
      glassImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand);
      break;

    case SurfaceId.ALLOY_SMOOTH:
      vessImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand);
      break;

    case SurfaceId.ALLOY_HARD:
      wroughtImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand);
      break;

    case SurfaceId.FLESH:
      fleshImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand);
      break;

    case SurfaceId.SHIELD:
    case SurfaceId.ENERGY_BARRIER:
      shieldImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand);
      break;

    case SurfaceId.WATER:
      waterImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand);
      break;

    default:
      stoneImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand, SurfaceId.CONCRETE);
      break;
  }

  // A plasma round scorches whatever it hits, on top of the surface response.
  if (damageType === DamageType.PLASMA) {
    const c = FxColor.plasmaBody;
    ctx.add.spawn(
      px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02, 0, 0, 0,
      0.16, 0.10 * e, 0.34 * e,
      c[0], c[1], c[2], 5 * B, 0.2 * B,
      0, 0, rand.next() * 6.28, 0,
      Shape.RING, 0, rand.next(), 0.9, 1.7,
    );
  }
}

function metalImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand, surfaceId) {
  const hot = FxColor.sparkHot;
  const warm = FxColor.sparkWarm;

  // Hot core flash. Above the bloom threshold by a wide margin so a hit on
  // metal is unmistakable in a firefight (FEEL.md §7).
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.065, 0.10 + 0.10 * e, 0.02,
    hot[0], hot[1], hot[2], 11 * B, 0.5 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.2,
  );

  // Sparks. Streaks, velocity aligned — the shape that reads as struck steel.
  const n = Math.max(2, Math.round(8 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 0.85);
    const sp = rand.range(5, 15) * e;
    const c = rand.bool(0.55) ? hot : warm;
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.16, 0.42), 0.016, 0.006,
      c[0], c[1], c[2], 5.5 * B, 0.35 * B,
      1.5, 1.0, 0, 0, Shape.STREAK, 0.05, rand.next(), 1, 1.3,
    );
  }

  // Two long fast ricochets — the read that separates metal from stone.
  const ric = Math.max(1, Math.round(2 * lod));
  for (let i = 0; i < ric; i++) {
    cone(rand, nx, ny, nz, 0.55);
    const sp = rand.range(24, 42);
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.09, 0.16), 0.022, 0.010,
      hot[0], hot[1], hot[2], 7 * B, 0.4 * B,
      0.6, 1.0, 0, 0, Shape.STREAK, 0.075, rand.next(), 1, 1.1,
    );
  }

  // Paint / primer dust off the panel.
  const dust = Math.max(1, Math.round(3 * lod));
  const dc = FxColor.smokeMid;
  for (let i = 0; i < dust; i++) {
    cone(rand, nx, ny, nz, 0.9);
    const sp = rand.range(0.6, 2.2);
    ctx.alpha.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.30, 0.60), 0.05, 0.26,
      dc[0], dc[1], dc[2], 1, 1,
      3.2, 0.05, rand.next() * 6.28, rand.range(-1, 1),
      Shape.DISC, 0, rand.next(), 0.30, 1.2,
    );
  }

  const ink = FxColor.inkMetal;
  ctx.decals.add(
    px, py, pz, nx, ny, nz,
    rand.range(0.10, 0.16), rand.next() * 6.28,
    surfaceId === SurfaceId.VEHICLE_HULL ? Decal.METAL : Decal.METAL,
    26, ink[0], ink[1], ink[2], 0.85,
  );
}

function stoneImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand, surfaceId) {
  const dustCol = surfaceId === SurfaceId.ROCK ? FxColor.rockDust : FxColor.concreteDust;
  const chip = FxColor.concreteChip;

  // A small spall glow — bright but nothing like the metal flash.
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.05, 0.07 * e, 0.02,
    dustCol[0], dustCol[1], dustCol[2], 2.6 * B, 0.2 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.4,
  );

  // Dust puff — the dominant read on concrete and rock.
  const n = Math.max(2, Math.round(9 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 1.0);
    const sp = rand.range(0.8, 3.4) * e;
    ctx.alpha.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.45, 1.05), rand.range(0.06, 0.13), rand.range(0.35, 0.70),
      dustCol[0], dustCol[1], dustCol[2], 1, 1,
      2.6, 0.10, rand.next() * 6.28, rand.range(-1.2, 1.2),
      Shape.DISC, 0, rand.next(), 0.42, 1.15,
    );
  }

  // Chips: solid debris, full gravity, they arc and drop.
  const chips = Math.max(1, Math.round(5 * e * lod));
  for (let i = 0; i < chips; i++) {
    cone(rand, nx, ny, nz, 0.7);
    const sp = rand.range(3, 9) * e;
    ctx.alpha.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.5, 1.1), rand.range(0.012, 0.030), rand.range(0.010, 0.022),
      chip[0], chip[1], chip[2], 1, 1,
      0.35, 1.0, rand.next() * 6.28, rand.range(-8, 8),
      Shape.SHARD, 0, rand.next(), 0.95, 0.8,
    );
  }

  const ink = FxColor.inkStone;
  ctx.decals.add(
    px, py, pz, nx, ny, nz,
    rand.range(0.13, 0.22), rand.next() * 6.28, Decal.STONE,
    26, ink[0], ink[1], ink[2], 0.8,
  );
}

function softImpact(ctx, px, py, pz, nx, ny, nz, e, lod, rand, surfaceId) {
  const col =
    surfaceId === SurfaceId.GRASS ? FxColor.grassBit
      : surfaceId === SurfaceId.SAND ? FxColor.sandDust
        : FxColor.dirtDust;

  // Airborne puff.
  const n = Math.max(2, Math.round(7 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 1.0);
    const sp = rand.range(0.7, 2.8) * e;
    ctx.alpha.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.5, 1.2), rand.range(0.07, 0.15), rand.range(0.32, 0.62),
      col[0], col[1], col[2], 1, 1,
      2.9, 0.14, rand.next() * 6.28, rand.range(-1, 1),
      Shape.DISC, 0, rand.next(), 0.5, 1.2,
    );
  }

  // Clods / grass blades thrown clear.
  const bits = Math.max(2, Math.round(8 * e * lod));
  for (let i = 0; i < bits; i++) {
    cone(rand, nx, ny, nz, 0.75);
    const sp = rand.range(2.5, 7.5) * e;
    ctx.alpha.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.45, 0.95), rand.range(0.012, 0.034), rand.range(0.008, 0.020),
      col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 1, 1,
      0.4, 1.0, rand.next() * 6.28, rand.range(-9, 9),
      Shape.SHARD, 0, rand.next(), 0.95, 0.75,
    );
  }

  const ink = FxColor.inkSoft;
  ctx.decals.add(
    px, py, pz, nx, ny, nz,
    rand.range(0.16, 0.26), rand.next() * 6.28, Decal.SOFT,
    22, ink[0], ink[1], ink[2], 0.62,
  );
}

function glassImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand) {
  const c = FxColor.glassShard;
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.06, 0.11, 0.02,
    c[0], c[1], c[2], 6 * B, 0.3 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.0,
  );

  const n = Math.max(3, Math.round(10 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 0.9);
    const sp = rand.range(3, 11) * e;
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.5, 1.2), rand.range(0.020, 0.055), rand.range(0.010, 0.030),
      c[0], c[1], c[2], 2.4 * B, 0.15 * B,
      0.25, 1.0, rand.next() * 6.28, rand.range(-10, 10),
      Shape.SHARD, 0, rand.next(), 0.9, 0.85,
    );
  }

  const ink = FxColor.inkGlass;
  ctx.decals.add(
    px, py, pz, nx, ny, nz,
    rand.range(0.18, 0.30), rand.next() * 6.28, Decal.GLASS,
    30, ink[0], ink[1], ink[2], 0.55,
  );
}

function vessImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand) {
  const c = FxColor.vessTracer;
  const v = FxColor.vessViolet;

  // The resonant ring: ALLOY_SMOOTH is a single continuous shell (ART.md §3.3),
  // so it answers a hit by ringing rather than by chipping.
  ctx.add.spawn(
    px + nx * 0.01, py + ny * 0.01, pz + nz * 0.01, 0, 0, 0,
    0.34, 0.12, 0.85 * (0.7 + e * 0.5),
    c[0], c[1], c[2], 8 * B, 0.15 * B,
    0, 0, rand.next() * 6.28, 0, Shape.RING, 0, rand.next(), 1, 1.5,
  );
  ctx.add.spawn(
    px + nx * 0.01, py + ny * 0.01, pz + nz * 0.01, 0, 0, 0,
    0.09, 0.16 * e, 0.03,
    c[0], c[1], c[2], 12 * B, 0.4 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.2,
  );

  const n = Math.max(2, Math.round(6 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 0.8);
    const sp = rand.range(4, 12) * e;
    const col = rand.bool(0.7) ? c : v;
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.14, 0.32), 0.016, 0.005,
      col[0], col[1], col[2], 4.5 * B, 0.2 * B,
      2.0, 0.6, 0, 0, Shape.STREAK, 0.05, rand.next(), 1, 1.4,
    );
  }

  const ink = FxColor.inkAlloy;
  ctx.decals.add(
    px, py, pz, nx, ny, nz,
    rand.range(0.09, 0.14), rand.next() * 6.28, Decal.ALLOY_SMOOTH,
    20, ink[0], ink[1], ink[2], 0.7,
  );
}

function wroughtImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand) {
  const c = FxColor.wroughtSeam;
  const p = FxColor.wroughtSlab;

  // Hard, bright, short. Wrought does not spall and does not ring — it flashes.
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.075, 0.20 + 0.14 * e, 0.03,
    c[0], c[1], c[2], 18 * B, 0.6 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.6,
  );
  ctx.add.spawn(
    px + nx * 0.01, py + ny * 0.01, pz + nz * 0.01, 0, 0, 0,
    0.18, 0.10, 0.62,
    c[0], c[1], c[2], 9 * B, 0.1 * B,
    0, 0, rand.next() * 6.28, 0, Shape.RING, 0, rand.next(), 1, 2.0,
  );

  const n = Math.max(2, Math.round(8 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 0.9);
    const sp = rand.range(6, 18) * e;
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.10, 0.28), 0.015, 0.005,
      p[0], p[1], p[2], 6 * B, 0.3 * B,
      1.2, 1.0, 0, 0, Shape.STREAK, 0.055, rand.next(), 1, 1.5,
    );
  }

  const ink = FxColor.inkAlloy;
  ctx.decals.add(
    px, py, pz, nx, ny, nz,
    rand.range(0.12, 0.19), rand.next() * 6.28, Decal.ALLOY_HARD,
    24, ink[0], ink[1], ink[2], 0.72,
  );
}

function fleshImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand) {
  // Deliberately NOT gore. Bright warm particulate that dissipates: it reads as
  // "that hit connected" without a single drop of blood on screen.
  const c = FxColor.fleshSpark;
  const n = Math.max(3, Math.round(10 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 1.0);
    const sp = rand.range(1.5, 5.5) * e;
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.18, 0.40), rand.range(0.014, 0.030), 0.002,
      c[0], c[1], c[2], 3.2 * B, 0.1 * B,
      3.0, 0.85, 0, 0, Shape.SPARK, 0, rand.next(), 1, 1.6,
    );
  }
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.10, 0.07 * e, 0.30 * e,
    c[0], c[1], c[2], 2.4 * B, 0.05 * B,
    0, 0, rand.next() * 6.28, 0, Shape.DISC, 0, rand.next(), 0.8, 1.8,
  );
  // No decal on FLESH.
}

function shieldImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand) {
  const c = FxColor.shieldCrackle;

  // The crackle sheet: a flat panel of analytic radial arcs lying on the shell.
  ctx.add.spawn(
    px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02, 0, 0, 0,
    0.20, 0.30 + 0.30 * e, 0.62 + 0.35 * e,
    c[0], c[1], c[2], 7.5 * B, 0.2 * B,
    0, 0, 0, 0, Shape.CRACKLE, 0, rand.next(), 1, 1.9,
  );
  ctx.add.spawn(
    px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02, 0, 0, 0,
    0.26, 0.14, 0.70,
    c[0], c[1], c[2], 5 * B, 0.1 * B,
    0, 0, rand.next() * 6.28, 0, Shape.RING, 0, rand.next(), 1, 1.6,
  );

  // Arcs skating across the surface rather than bouncing off it: directions
  // are taken from the tangent plane (t, b) of the basis set by the caller,
  // with only a small component along the normal.
  const n = Math.max(2, Math.round(6 * e * lod));
  for (let i = 0; i < n; i++) {
    const phi = rand.next() * Math.PI * 2;
    const cp = Math.cos(phi);
    const sp2 = Math.sin(phi);
    const lift = rand.range(0.05, 0.25);
    _s[D0] = _s[T0] * cp + _s[B0] * sp2 + nx * lift;
    _s[D1] = _s[T1] * cp + _s[B1] * sp2 + ny * lift;
    _s[D2] = _s[T2] * cp + _s[B2] * sp2 + nz * lift;
    const sp = rand.range(3, 9);
    ctx.add.spawn(
      px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02,
      _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.08, 0.20), 0.016, 0.004,
      c[0], c[1], c[2], 6 * B, 0.2 * B,
      4.0, 0, 0, 0, Shape.STREAK, 0.045, rand.next(), 1, 1.5,
    );
  }
  // No decal: energy leaves no mark.
}

function waterImpact(ctx, px, py, pz, nx, ny, nz, e, lod, B, rand) {
  const c = FxColor.concreteDust;
  ctx.alpha.spawn(
    px, py, pz, 0, 0, 0,
    0.35, 0.06, 0.55 * e,
    c[0], c[1], c[2], 1, 1,
    0, 0, rand.next() * 6.28, 0, Shape.RING, 0, rand.next(), 0.6, 1.4,
  );
  const n = Math.max(2, Math.round(8 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 0.5);
    const sp = rand.range(2, 6) * e;
    ctx.alpha.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.3, 0.7), 0.02, 0.01,
      c[0], c[1], c[2], 1, 1,
      0.3, 1.0, 0, 0, Shape.SPARK, 0, rand.next(), 0.7, 1.0,
    );
  }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export const Family = Object.freeze({ CDF: 0, VESS: 1 });

/** FEEL.md §4.2 weapon list. Anything Vess-flavoured reads cyan/violet. */
export function familyOf(weaponId) {
  if (typeof weaponId !== 'string') return Family.CDF;
  const w = weaponId.toLowerCase();
  if (w.includes('vess') || w.includes('ember') || w.includes('plasma')) return Family.VESS;
  return Family.CDF;
}

export function muzzleFlash(ctx, mx, my, mz, dx, dy, dz, family) {
  const B = ctx.B;
  const rand = ctx.rand;
  const vess = family === Family.VESS;
  const c = vess ? FxColor.vessMuzzle : FxColor.cdfMuzzle;

  // Core. 24x the bloom threshold — ART.md §7.2 wants this well past the knee
  // so the flash blooms hard and briefly, which is the era signature.
  ctx.add.spawn(
    mx, my, mz, 0, 0, 0,
    0.048, 0.30, 0.06,
    c[0], c[1], c[2], 24 * B, 1.0 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.4,
  );
  // Expanding ring at the crown.
  ctx.add.spawn(
    mx + dx * 0.05, my + dy * 0.05, mz + dz * 0.05, 0, 0, 0,
    0.075, 0.10, 0.46,
    c[0], c[1], c[2], 10 * B, 0.2 * B,
    0, 0, rand.next() * 6.28, 0, Shape.RING, 0, rand.next(), 1, 2.0,
  );

  basis(dx, dy, dz);
  for (let i = 0; i < 5; i++) {
    cone(rand, dx, dy, dz, 0.16);
    const sp = rand.range(11, 22);
    ctx.add.spawn(
      mx, my, mz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.035, 0.075), 0.022, 0.006,
      c[0], c[1], c[2], 12 * B, 0.5 * B,
      3.0, 0.2, 0, 0, Shape.STREAK, 0.05, rand.next(), 1, 1.6,
    );
  }

  if (!vess) {
    // CDF weapons are chemical: a small grey wisp off the crown.
    const s = FxColor.smokeMid;
    ctx.alpha.spawn(
      mx + dx * 0.1, my + dy * 0.1, mz + dz * 0.1,
      dx * 1.4, dy * 1.4 + 0.5, dz * 1.4,
      0.42, 0.05, 0.30,
      s[0], s[1], s[2], 1, 1,
      2.4, -0.05, rand.next() * 6.28, rand.range(-1, 1),
      Shape.DISC, 0, rand.next(), 0.22, 1.3,
    );
  }

  ctx.lights.flash(
    mx + dx * 0.15, my + dy * 0.15, mz + dz * 0.15,
    c[0], c[1], c[2],
    vess ? 9 : 12, 7.5, 0.055,
  );
}

/**
 * A tracer. Short-lived and fast — ARCHITECTURE-legal and, more importantly,
 * NOT a laser: it lives 0.30 s, is at most 4 m long, and dims as it travels.
 */
export function tracer(ctx, mx, my, mz, dx, dy, dz, family) {
  const B = ctx.B;
  const rand = ctx.rand;
  const vess = family === Family.VESS;
  const c = vess ? FxColor.vessTracer : FxColor.cdfTracer;
  // ORCHESTRATOR TUNE, from play: at 0.038 m wide and 265 m/s the round was
  // sub-pixel past a few metres and the shot read as nothing leaving the gun.
  // Widened ~3x and slowed ~25% so the round is legible in flight without
  // becoming a laser. It still crosses 60 m in a third of a second.
  const speed = vess ? 150 : 200;
  ctx.add.spawn(
    mx + dx * 0.3, my + dy * 0.3, mz + dz * 0.3,
    dx * speed, dy * speed, dz * speed,
    0.32, vess ? 0.16 : 0.115, vess ? 0.055 : 0.035,
    c[0], c[1], c[2], (vess ? 6.5 : 5.0) * B, 0.2 * B,
    0, 0, 0, 0, Shape.STREAK, vess ? 0.008 : 0.012, rand.next(), 1, 1.25,
  );
}

// ---------------------------------------------------------------------------
// Explosions, grenades, shields, melee
// ---------------------------------------------------------------------------

/**
 * @param {number} kind 0 = frag/high-explosive (warm), 1 = plasma (cyan)
 */
export function detonation(ctx, px, py, pz, radius, kind) {
  const B = ctx.B;
  const rand = ctx.rand;
  const lod = ctx.lod(px, py, pz);
  const plasma = kind === 1;
  const core = plasma ? FxColor.plasmaCore : FxColor.fragCore;
  const body = plasma ? FxColor.plasmaBody : FxColor.fragBody;
  const r = clamp(radius > 0.2 ? radius : 4.0, 0.5, 24);

  // 1. The core flash. Enormous relative to the bloom threshold, very short.
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    plasma ? 0.10 : 0.13, r * 0.30, r * 0.16,
    core[0], core[1], core[2], 34 * B, 1.0 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.2,
  );

  // 2. The shockwave ring. Plasma's is thin and fast; frag's is broad and slow.
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    plasma ? 0.34 : 0.52, r * 0.25, r * (plasma ? 2.1 : 1.7),
    body[0], body[1], body[2], (plasma ? 16 : 11) * B, 0.05 * B,
    0, 0, rand.next() * 6.28, 0, Shape.RING, 0, rand.next(), 1, plasma ? 1.5 : 1.9,
  );

  // 3. The expanding shell — gives the blast volume rather than a flat sprite.
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    plasma ? 0.26 : 0.38, r * 0.20, r * (plasma ? 1.3 : 1.0),
    body[0], body[1], body[2], (plasma ? 13 : 9) * B, 0.05 * B,
    0, 0, 0, 0, Shape.SHELL, 0, rand.next(), 1, 1.6,
  );

  // 4. Ejecta.
  const n = Math.max(6, Math.round((plasma ? 26 : 34) * lod));
  for (let i = 0; i < n; i++) {
    ctx.rand.sphere(ctx.sphereOut);
    const ux = ctx.sphereOut[0], uy = ctx.sphereOut[1], uz = ctx.sphereOut[2];
    const sp = rand.range(6, 24) * (r / 5);
    const c = rand.bool(0.4) ? core : body;
    ctx.add.spawn(
      px, py, pz, ux * sp, uy * sp + 1.5, uz * sp,
      rand.range(plasma ? 0.25 : 0.4, plasma ? 0.6 : 1.1),
      rand.range(0.03, 0.08), 0.008,
      c[0], c[1], c[2], 7 * B, 0.25 * B,
      plasma ? 2.4 : 1.1, plasma ? 0.25 : 1.0,
      0, 0, Shape.STREAK, 0.05, rand.next(), 1, plasma ? 1.6 : 1.15,
    );
  }

  // 5. Smoke. Frag makes a lot; plasma makes almost none — that difference is
  //    the main silhouette cue for telling the two apart at a glance.
  const sn = Math.max(2, Math.round((plasma ? 6 : 22) * lod));
  const sc = plasma ? FxColor.smokeMid : FxColor.smokeDark;
  for (let i = 0; i < sn; i++) {
    ctx.rand.sphere(ctx.sphereOut);
    const sp = rand.range(1.5, 6.0) * (r / 5);
    ctx.alpha.spawn(
      px, py, pz,
      ctx.sphereOut[0] * sp, ctx.sphereOut[1] * sp * 0.7 + 1.4, ctx.sphereOut[2] * sp,
      rand.range(1.0, 2.4), r * 0.12, r * rand.range(0.35, 0.65),
      sc[0], sc[1], sc[2], 1, 1,
      1.5, -0.05, rand.next() * 6.28, rand.range(-0.7, 0.7),
      Shape.DISC, 0, rand.next(), plasma ? 0.28 : 0.62, 1.05,
    );
  }

  // 6. Scorch mark. Placed on the up-facing assumption because
  //    `explosion.occurred` / `grenade.detonated` carry no surface normal.
  const ink = plasma ? FxColor.inkAlloy : FxColor.inkScorch;
  ctx.decals.add(
    px, py + 0.02, pz, 0, 1, 0,
    r * rand.range(0.45, 0.62), rand.next() * 6.28,
    plasma ? Decal.ALLOY_SMOOTH : Decal.SCORCH,
    40, ink[0], ink[1], ink[2], plasma ? 0.55 : 0.8,
  );

  // 7. Light.
  ctx.lights.flash(
    px, py + 0.3, pz, body[0], body[1], body[2],
    plasma ? 90 : 130, r * 3.2, plasma ? 0.30 : 0.42,
  );
}

export function shieldBroken(ctx, px, py, pz, nx, ny, nz, overkill) {
  const B = ctx.B;
  const rand = ctx.rand;
  const flare = FxColor.shieldFlare;
  const crackle = FxColor.shieldCrackle;
  const e = clamp(1 + (Number.isFinite(overkill) ? overkill : 0) / 60, 1, 1.8);

  // The shell. This is the visual half of the game's most important feedback
  // moment (FEEL.md §3), so it is the brightest single element FX ships.
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.46, 0.55, 3.5 * e,
    flare[0], flare[1], flare[2], 26 * B, 0.1 * B,
    0, 0, 0, 0, Shape.SHELL, 0, rand.next(), 1, 1.7,
  );
  // A second, slower shell so the flare has depth instead of one hard pop.
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.85, 0.30, 2.6 * e,
    crackle[0], crackle[1], crackle[2], 9 * B, 0.05 * B,
    0, 0, 0, 0, Shape.SHELL, 0, rand.next(), 0.75, 2.1,
  );
  // Break ring on the hit plane.
  ctx.add.spawn(
    px + nx * 0.05, py + ny * 0.05, pz + nz * 0.05, 0, 0, 0,
    0.40, 0.30, 2.4 * e,
    flare[0], flare[1], flare[2], 14 * B, 0.05 * B,
    0, 0, rand.next() * 6.28, 0, Shape.RING, 0, rand.next(), 1, 1.6,
  );
  // Crackle sheet at the impact.
  ctx.add.spawn(
    px + nx * 0.05, py + ny * 0.05, pz + nz * 0.05, 0, 0, 0,
    0.30, 0.55, 1.30,
    crackle[0], crackle[1], crackle[2], 10 * B, 0.1 * B,
    0, 0, 0, 0, Shape.CRACKLE, 0, rand.next(), 1, 1.8,
  );

  const lod = ctx.lod(px, py, pz);
  const n = Math.max(8, Math.round(26 * lod));
  for (let i = 0; i < n; i++) {
    rand.sphere(ctx.sphereOut);
    const sp = rand.range(5, 16);
    ctx.add.spawn(
      px, py, pz,
      ctx.sphereOut[0] * sp, ctx.sphereOut[1] * sp, ctx.sphereOut[2] * sp,
      rand.range(0.20, 0.55), 0.020, 0.004,
      crackle[0], crackle[1], crackle[2], 8 * B, 0.2 * B,
      3.2, 0.15, 0, 0, Shape.STREAK, 0.05, rand.next(), 1, 1.4,
    );
  }

  ctx.lights.flash(px, py, pz, flare[0], flare[1], flare[2], 70, 9, 0.36);
}

export function shieldRecharged(ctx, px, py, pz, full) {
  const B = ctx.B;
  const rand = ctx.rand;
  const c = FxColor.shieldCrackle;
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    full ? 0.42 : 0.55, full ? 2.4 : 0.4, full ? 1.5 : 2.0,
    c[0], c[1], c[2], (full ? 5 : 1.6) * B, 0.05 * B,
    0, 0, 0, 0, Shape.SHELL, 0, rand.next(), full ? 0.8 : 0.35, full ? 2.0 : 1.2,
  );
}

export function meleeImpact(ctx, px, py, pz, fromBehind) {
  const B = ctx.B;
  const rand = ctx.rand;
  const hot = FxColor.sparkHot;
  const mult = fromBehind ? 1.7 : 1.0;

  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.075, 0.20 * mult, 0.03,
    hot[0], hot[1], hot[2], 14 * B * mult, 0.5 * B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 2.3,
  );

  const n = Math.round((fromBehind ? 16 : 9) * ctx.lod(px, py, pz));
  for (let i = 0; i < Math.max(3, n); i++) {
    rand.sphere(ctx.sphereOut);
    const sp = rand.range(5, 15) * mult;
    ctx.add.spawn(
      px, py, pz,
      ctx.sphereOut[0] * sp, ctx.sphereOut[1] * sp, ctx.sphereOut[2] * sp,
      rand.range(0.14, 0.34), 0.018, 0.005,
      hot[0], hot[1], hot[2], 6 * B, 0.3 * B,
      2.0, 1.0, 0, 0, Shape.STREAK, 0.05, rand.next(), 1, 1.35,
    );
  }
  ctx.lights.flash(px, py, pz, hot[0], hot[1], hot[2], 18 * mult, 4.5, 0.09);
}

export function bouncePuff(ctx, px, py, pz, nx, ny, nz, surfaceId, speed) {
  const rand = ctx.rand;
  const lod = ctx.lod(px, py, pz);
  const e = clamp(speed / 12, 0.2, 1.4);
  let col = FxColor.concreteDust;
  if (surfaceId === SurfaceId.DIRT) col = FxColor.dirtDust;
  else if (surfaceId === SurfaceId.GRASS) col = FxColor.grassBit;
  else if (surfaceId === SurfaceId.SAND) col = FxColor.sandDust;
  else if (surfaceId === SurfaceId.ROCK) col = FxColor.rockDust;

  basis(nx, ny, nz);
  const n = Math.max(1, Math.round(4 * e * lod));
  for (let i = 0; i < n; i++) {
    cone(rand, nx, ny, nz, 1.0);
    const sp = rand.range(0.4, 1.6) * e;
    ctx.alpha.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      rand.range(0.35, 0.7), 0.06, rand.range(0.20, 0.38),
      col[0], col[1], col[2], 1, 1,
      3.0, 0.08, rand.next() * 6.28, rand.range(-1, 1),
      Shape.DISC, 0, rand.next(), 0.30 * e, 1.2,
    );
  }
  // A hard surface also throws one small spark on a fast bounce.
  if (e > 0.7 && (surfaceId === SurfaceId.METAL_PAINTED || surfaceId === SurfaceId.METAL_BARE)) {
    const hot = FxColor.sparkHot;
    cone(rand, nx, ny, nz, 0.7);
    const sp = rand.range(3, 8);
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
      0.16, 0.014, 0.004,
      hot[0], hot[1], hot[2], 4 * ctx.B, 0.2 * ctx.B,
      1.5, 1.0, 0, 0, Shape.STREAK, 0.05, rand.next(), 1, 1.3,
    );
  }
}

export function vehicleImpact(ctx, px, py, pz, nx, ny, nz, relativeSpeed) {
  const e = clamp(relativeSpeed / 14, 0.25, 2.0);
  basis(nx, ny, nz);
  metalImpact(ctx, px, py, pz, nx, ny, nz, e * 1.4, ctx.lod(px, py, pz), ctx.B, ctx.rand, SurfaceId.VEHICLE_HULL);
  if (e > 1.0) {
    const s = FxColor.smokeDark;
    const rand = ctx.rand;
    for (let i = 0; i < 5; i++) {
      cone(rand, nx, ny, nz, 1.0);
      const sp = rand.range(1, 4) * e;
      ctx.alpha.spawn(
        px, py, pz, _s[D0] * sp, _s[D1] * sp, _s[D2] * sp,
        rand.range(0.7, 1.4), 0.12, rand.range(0.5, 0.9),
        s[0], s[1], s[2], 1, 1,
        2.0, -0.04, rand.next() * 6.28, rand.range(-0.8, 0.8),
        Shape.DISC, 0, rand.next(), 0.4, 1.1,
      );
    }
  }
}

export function ventPlume(ctx, px, py, pz, dx, dy, dz, strength) {
  const B = ctx.B;
  const rand = ctx.rand;
  const c = FxColor.vessMuzzle;
  const s = FxColor.smokeMid;

  // Hot vent gas, cyan, above the bloom threshold at the throat.
  for (let i = 0; i < 2; i++) {
    basis(dx, dy, dz);
    cone(rand, dx, dy, dz, 0.5);
    const sp = rand.range(1.5, 4.0) * strength;
    ctx.add.spawn(
      px, py, pz, _s[D0] * sp, _s[D1] * sp + 0.8, _s[D2] * sp,
      rand.range(0.25, 0.5), 0.035, 0.14,
      c[0], c[1], c[2], 3.0 * B * strength, 0.05 * B,
      2.6, -0.2, rand.next() * 6.28, rand.range(-1.5, 1.5),
      Shape.DISC, 0, rand.next(), 0.55, 1.5,
    );
  }
  // Cooling vapour behind it.
  basis(dx, dy, dz);
  cone(rand, dx, dy, dz, 0.8);
  const sp2 = rand.range(0.8, 2.2) * strength;
  ctx.alpha.spawn(
    px, py, pz, _s[D0] * sp2, _s[D1] * sp2 + 1.1, _s[D2] * sp2,
    rand.range(0.6, 1.2), 0.07, rand.range(0.30, 0.55),
    s[0], s[1], s[2], 1, 1,
    2.2, -0.12, rand.next() * 6.28, rand.range(-1, 1),
    Shape.DISC, 0, rand.next(), 0.30 * strength, 1.2,
  );
}

export function fragTrail(ctx, px, py, pz, blinkOn) {
  const rand = ctx.rand;
  const s = FxColor.smokeDark;
  // Dark smoke: FEEL.md §4.6 wants the frag trail readable AGAINST SKY, and the
  // sky here is a bright warm pale (#C9C6A8). Dark reads; bright would vanish.
  ctx.alpha.spawn(
    px, py, pz, rand.range(-0.2, 0.2), rand.range(0.1, 0.45), rand.range(-0.2, 0.2),
    rand.range(0.55, 0.95), 0.055, rand.range(0.22, 0.38),
    s[0], s[1], s[2], 1, 1,
    1.6, -0.06, rand.next() * 6.28, rand.range(-1, 1),
    Shape.DISC, 0, rand.next(), 0.45, 1.1,
  );
  if (blinkOn) {
    // The indicator light. Saturated hazard orange well above the bloom
    // threshold, so it survives against the brightest part of the sky.
    const c = FxColor.fragBlink;
    ctx.add.spawn(
      px, py, pz, 0, 0, 0,
      0.075, 0.11, 0.05,
      c[0], c[1], c[2], 9 * ctx.B, 1.0 * ctx.B,
      0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 1.4,
    );
  }
}

export function plasmaTrail(ctx, px, py, pz, vx, vy, vz) {
  const rand = ctx.rand;
  const c = FxColor.plasmaBody;
  const core = FxColor.plasmaCore;
  // A continuous ribbon: each segment is a short velocity-aligned streak, so
  // consecutive segments overlap into one unbroken line rather than a dotted
  // one. FEEL.md §4.6 wants this readable against GROUND, which is dark and
  // saturated — hence a bright cyan well over the bloom threshold.
  ctx.add.spawn(
    px, py, pz, vx, vy, vz,
    0.55, 0.075, 0.020,
    c[0], c[1], c[2], 6.5 * ctx.B, 0.4 * ctx.B,
    0, 0, 0, 0, Shape.STREAK, 0.030, rand.next(), 1, 1.1,
  );
  ctx.add.spawn(
    px, py, pz, 0, 0, 0,
    0.30, 0.055, 0.010,
    core[0], core[1], core[2], 8 * ctx.B, 0.3 * ctx.B,
    0, 0, 0, 0, Shape.SPARK, 0, rand.next(), 1, 1.3,
  );
}

export { readVec, normalizeInto, basis, clamp, energyNorm };
