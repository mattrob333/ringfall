// L2 render — OWNER: `lighting` (S1) ONLY. ARCHITECTURE.md §2.1.
//
// ============================================================================
//  NO OTHER AGENT MAY EDIT THIS FILE. EVER. FOR ANY REASON.
// ============================================================================
//
// ART.md §7.1. A standard neutral filmic curve desaturates highlights toward
// white and kills this art direction on its own. Halo-era highlights hold their
// colour, so the composite tonemaps LUMINANCE and re-applies chroma, then mixes
// in a small amount of per-channel response to stop saturated highlights from
// going neon.
//
// DESAT_STRENGTH is the ONLY lever between "highlights hold colour" and
// "highlights clip into neon". It is gated by ART.md P4 (20 brightest pixels
// must average HSV S >= 0.25), not by taste.

export const DESAT_STRENGTH = 0.22;

/** Uchimura GT curve parameters. ART.md §7.1. */
export const GT = Object.freeze({
  P: 1.0, // maximum display brightness
  a: 1.05, // contrast
  m: 0.22, // linear section start
  l: 0.4, // linear section length
  c: 1.2, // black tightness
  b: 0.0, // pedestal
});

/** JS mirror of the GLSL curve, used by tools/palette.mjs to predict targets. */
export function gtTonemap(x) {
  const { P, a, m, l, c, b } = GT;
  const l0 = ((P - m) * l) / a;
  const S0 = m + l0;
  const S1 = m + a * l0;
  const C2 = (a * P) / (P - S1);
  const CP = -C2 / P;

  const w0 = 1 - smoothstep01(0, m, x);
  const w2 = x < m + l0 ? 0 : 1;
  const w1 = 1 - w0 - w2;

  const T = m * Math.pow(Math.max(x, 0) / m, c) + b;
  const S = P - (P - S1) * Math.exp(CP * (x - S0));
  const L = m + a * (x - m);
  return T * w0 + L * w1 + S * w2;
}

function smoothstep01(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export const TONEMAP_GLSL = /* glsl */ `
  const float GT_P = ${GT.P.toFixed(4)};
  const float GT_A = ${GT.a.toFixed(4)};
  const float GT_M = ${GT.m.toFixed(4)};
  const float GT_L = ${GT.l.toFixed(4)};
  const float GT_C = ${GT.c.toFixed(4)};
  const float GT_B = ${GT.b.toFixed(4)};
  const float DESAT_STRENGTH = ${DESAT_STRENGTH.toFixed(4)};

  float gtTonemap(float x) {
    float l0 = ((GT_P - GT_M) * GT_L) / GT_A;
    float S0 = GT_M + l0;
    float S1 = GT_M + GT_A * l0;
    float C2 = (GT_A * GT_P) / (GT_P - S1);
    float CP = -C2 / GT_P;

    float w0 = 1.0 - smoothstep(0.0, GT_M, x);
    float w2 = step(GT_M + l0, x);
    float w1 = 1.0 - w0 - w2;

    float T = GT_M * pow(max(x, 0.0) / GT_M, GT_C) + GT_B;
    float S = GT_P - (GT_P - S1) * exp(CP * (x - S0));
    float L = GT_M + GT_A * (x - GT_M);
    return T * w0 + L * w1 + S * w2;
  }

  // Hue- AND saturation-preserving composite. ART.md §7.1.
  vec3 tonemapHuePreserving(vec3 c) {
    float L  = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float Lt = gtTonemap(L);
    vec3  hue = c * (Lt / max(L, 1e-5));
    vec3  pc  = vec3(gtTonemap(c.r), gtTonemap(c.g), gtTonemap(c.b));
    return mix(hue, pc, DESAT_STRENGTH);
  }
`;
