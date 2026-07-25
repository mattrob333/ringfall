// L0 shared — pure math helpers. No state, no allocation in hot paths.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const smootherstep = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Move `a` toward `b` by at most `maxDelta`. */
export function moveToward(a, b, maxDelta) {
  const d = b - a;
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
}

export function moveToward3(out, ax, ay, az, bx, by, bz, maxDelta) {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len <= maxDelta || len === 0) {
    out[0] = bx;
    out[1] = by;
    out[2] = bz;
  } else {
    const s = maxDelta / len;
    out[0] = ax + dx * s;
    out[1] = ay + dy * s;
    out[2] = az + dz * s;
  }
  return out;
}

/** Relative luminance from linear RGB (Rec.709). */
export const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** CIE L* from a linear luminance value. Used by every ART.md gate. */
export function toLStar(Y) {
  return Y > 0.008856451679 ? 116 * Math.cbrt(Y) - 16 : 903.2962962 * Y;
}

export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** Signed shortest angular difference in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Halton sequence — TAA jitter. Deterministic by construction. */
export function halton(index, base) {
  let f = 1,
    r = 0,
    i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** 8-phase Halton(2,3) jitter table, centred on zero. Frozen for determinism. */
export const JITTER_TABLE = Object.freeze(
  Array.from({ length: 8 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]),
);
