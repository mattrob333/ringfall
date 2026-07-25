// L2 render — the sky model, the sun, and the SH projection that drives all
// indirect light. OWNER: `lighting` (S1). ART.md §3.1 / §4.
//
// skyRadianceJS() below is a LINE-FOR-LINE mirror of skyRadiance() in
// chunks.js CHUNK_SKY. If they diverge, the ambient light stops matching the
// visible sky and ART.md P6 fails. tools/palette.mjs cross-checks them.

import * as THREE from 'three';
import { SKY } from '../shared/palette.js';
import { hexToLinear } from '../shared/palette.js';
import { SUN_INTENSITY, GROUND_BOUNCE } from './exposure.js';
import { TERRAIN } from '../shared/palette.js';
import { DEG } from '../shared/math.js';

function hgPhase(mu, g) {
  const g2 = g * g;
  const d = 1 + g2 - 2 * g * mu;
  return (1 - g2) / (4 * Math.PI * d * Math.sqrt(Math.max(d, 1e-5)));
}
const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class SkyModel {
  constructor(globals) {
    this.g = globals;
    this.zenith = hexToLinear(SKY.zenith);
    this.mid = hexToLinear(SKY.mid);
    this.horizon = hexToLinear(SKY.horizon);
    this.horizonSun = hexToLinear(SKY.horizonSun);
    this.groundHaze = this.horizon.map((c) => c * 0.42);
    this.sunColor = hexToLinear(SKY.sunDisc).map((c) => c * SUN_INTENSITY);
    this.sunDir = new THREE.Vector3();
    this.setSun(SKY.sunElevationDeg, SKY.sunAzimuthDeg);
  }

  setSun(elevationDeg, azimuthDeg) {
    const el = elevationDeg * DEG;
    const az = azimuthDeg * DEG;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this.g.u.uSunDir.value.copy(this.sunDir);
    this.g.u.uSunColor.value.set(this.sunColor[0], this.sunColor[1], this.sunColor[2]);
  }

  /** Mirror of CHUNK_SKY skyRadiance(). Returns linear RGB. */
  skyRadianceJS(dx, dy, dz) {
    const h = Math.max(-1, Math.min(1, dy));
    const t = Math.max(0, Math.min(1, h));

    let col = mix3(this.horizon, this.mid, smoothstep(0, 0.3, t));
    col = mix3(col, this.zenith, smoothstep(0.24, 0.96, t));

    const fdLen = Math.hypot(dx, dz) || 1e-6;
    const fsx = this.sunDir.x,
      fsz = this.sunDir.z;
    const fsLen = Math.hypot(fsx, fsz) || 1e-6;
    const azim = Math.max(0, (dx / fdLen) * (fsx / fsLen) + (dz / fdLen) * (fsz / fsLen));
    const band = Math.exp(-Math.max(t, 0) * 6);
    col = mix3(col, this.horizonSun, band * azim * azim * 0.85);

    const mu = dx * this.sunDir.x + dy * this.sunDir.y + dz * this.sunDir.z;
    const mie = hgPhase(mu, 0.76) * 0.055;
    const glow = Math.pow(Math.max(mu, 0), 8) * 0.02;
    col = [
      col[0] + this.sunColor[0] * (mie + glow),
      col[1] + this.sunColor[1] * (mie + glow),
      col[2] + this.sunColor[2] * (mie + glow),
    ];

    const gm = smoothstep(-0.1, 0.015, h);
    return mix3(this.groundHaze, col, gm);
  }

  /**
   * Project the sky into L2 SH irradiance. Fibonacci-sphere sampling, uniform
   * solid angle, so no importance weighting is needed. Cosine convolution and
   * the 1/PI Lambert factor are folded into the coefficients here so the shader
   * evaluates a plain polynomial.
   *
   * Deterministic: the sample set is a closed-form sequence, not RNG.
   */
  projectSH(sampleCount = 8192) {
    const sh = Array.from({ length: 9 }, () => [0, 0, 0]);
    const GA = Math.PI * (3 - Math.sqrt(5));
    const dw = (4 * Math.PI) / sampleCount;

    for (let i = 0; i < sampleCount; i++) {
      const y = 1 - (2 * (i + 0.5)) / sampleCount;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = GA * i;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;

      const c = this.skyRadianceJS(x, y, z);

      // Real SH basis, l = 0..2.
      const b = [
        0.282095,
        0.488603 * x,
        0.488603 * y,
        0.488603 * z,
        1.092548 * x * y,
        1.092548 * y * z,
        1.092548 * z * x,
        0.546274 * (x * x - y * y),
        0.315392 * (3 * z * z - 1),
      ];
      for (let k = 0; k < 9; k++) {
        const w = b[k] * dw;
        sh[k][0] += c[0] * w;
        sh[k][1] += c[1] * w;
        sh[k][2] += c[2] * w;
      }
    }

    // Cosine-lobe convolution (Ramamoorthi Â_l), then fold 1/PI for Lambert.
    const A = [Math.PI, 2.0943951, 2.0943951, 2.0943951, 0.7853982, 0.7853982, 0.7853982, 0.7853982, 0.7853982];
    const basisConst = [0.282095, 0.488603, 0.488603, 0.488603, 1.092548, 1.092548, 1.092548, 0.546274, 0.315392];

    const out = this.g.u.uSkySH.value;
    for (let k = 0; k < 9; k++) {
      const s = (A[k] / Math.PI) * basisConst[k];
      out[k].set(sh[k][0] * s, sh[k][1] * s, sh[k][2] * s);
    }
    // No DC correction: CHUNK_SH multiplies coefficient 8 by (3z^2 - 1), which
    // already carries the -1 of the Y20 basis function. Subtracting it again
    // here would darken the whole ambient term by ~0.6 of the Y20 magnitude.

    // Ground bounce: dominant terrain albedo x sun irradiance x GROUND_BOUNCE.
    // Divided by PI because CHUNK_SH adds this straight onto shIrradiance(),
    // which is already irradiance/PI. Without the /PI the bounce term would be
    // PI times too strong and would wash out every downward-facing surface.
    const ground = hexToLinear(TERRAIN.grass);
    const nDotL = Math.max(0.15, this.sunDir.y);
    const bounce = (nDotL * GROUND_BOUNCE) / Math.PI;
    this.g.u.uGroundBounce.value.set(
      ground[0] * this.sunColor[0] * bounce,
      ground[1] * this.sunColor[1] * bounce,
      ground[2] * this.sunColor[2] * bounce,
    );

    return out;
  }

  /** Mean sky luminance — reported by palette.mjs, used for sanity checks. */
  meanRadiance(sampleCount = 2048) {
    let sum = 0;
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < sampleCount; i++) {
      const y = 1 - (2 * (i + 0.5)) / sampleCount;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = GA * i;
      const c = this.skyRadianceJS(Math.cos(th) * r, y, Math.sin(th) * r);
      sum += 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    return sum / sampleCount;
  }
}
