// L2 render — the shared shader-chunk library. OWNER: `lighting` (S1).
// Materials (L3) import these. Nothing here is per-material.

import { TONEMAP_GLSL } from './tonemap.js';

export const CLUSTER_X = 16;
export const CLUSTER_Y = 8;
export const CLUSTER_Z = 16;
export const CLUSTER_COUNT = CLUSTER_X * CLUSTER_Y * CLUSTER_Z; // 2048
export const MAX_LIGHTS = 256;
export const MAX_LIGHT_INDICES = 16384;
export const CLUSTER_FAR = 200.0; // beyond this everything lands in the last slice
export const LIGHT_TEXELS = 4; // texels per light in lightsTex
export const INDEX_TEX_W = 128;
export const INDEX_TEX_H = MAX_LIGHT_INDICES / INDEX_TEX_W; // 128
export const CLUSTER_TEX_W = CLUSTER_X * CLUSTER_Y; // 128
export const CLUSTER_TEX_H = CLUSTER_Z; // 16

export const CHUNK_COMMON = /* glsl */ `
  #define PI 3.14159265359
  #define INV_PI 0.31830988618
  #define EPS 1e-5

  float sq(float x) { return x * x; }
  float maxc(vec3 v) { return max(v.x, max(v.y, v.z)); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // Henyey-Greenstein phase, used by the sky halo and by fog inscatter.
  float hgPhase(float mu, float g) {
    float g2 = g * g;
    float d = 1.0 + g2 - 2.0 * g * mu;
    return (1.0 - g2) / (4.0 * PI * d * sqrt(max(d, EPS)));
  }

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  // Octahedral normal encode/decode for the RG16F normal target.
  vec2 octEncode(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 e = n.xy;
    if (n.z < 0.0) e = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return e * 0.5 + 0.5;
  }
  vec3 octDecode(vec2 f) {
    f = f * 2.0 - 1.0;
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0);
    n.x += n.x >= 0.0 ? -t : t;
    n.y += n.y >= 0.0 ? -t : t;
    return normalize(n);
  }

  // Interleaved gradient noise — dithering and PCF rotation. Deterministic.
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }
`;

/**
 * Uniforms shared by every material and by the sky/fog passes. Declared once so
 * the sky dome and the aerial-perspective term are guaranteed to read the same
 * numbers — that is what makes ART.md P6 (sky/ground convergence) pass by
 * construction rather than by tuning.
 */
export const CHUNK_GLOBALS = /* glsl */ `
  uniform vec3  uSunDir;            // normalised, world space, pointing AT the sun
  uniform vec3  uSunColor;          // linear, already multiplied by intensity
  uniform float uSunAngularRadius;  // radians
  uniform vec3  uSkyZenith;
  uniform vec3  uSkyMid;
  uniform vec3  uSkyHorizon;
  uniform vec3  uSkyHorizonSun;
  uniform vec3  uGroundHaze;
  uniform vec3  uSkySH[9];          // L2 irradiance, cosine-convolved, /PI folded in
  uniform vec3  uGroundBounce;
  uniform vec4  uFog;               // x density, y heightFalloff, z strength, w baseHeight
  uniform vec3  uCameraPos;
  uniform vec2  uResolution;
  uniform vec2  uNearFar;
  uniform float uTime;
  uniform float uExposure;
`;

/**
 * The sky model. Used by:
 *   - the sky dome pass (plus sun disc and clouds)
 *   - the aerial-perspective inscatter term in every opaque material
 * ART.md §3.1.
 */
export const CHUNK_SKY = /* glsl */ `
  vec3 skyRadiance(vec3 dir) {
    float h = clamp(dir.y, -1.0, 1.0);
    float t = clamp(h, 0.0, 1.0);

    vec3 col = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.30, t));
    col = mix(col, uSkyZenith, smoothstep(0.24, 0.96, t));

    // Warm band on the sun side of the horizon.
    vec2 fd = normalize(dir.xz + vec2(1e-6));
    vec2 fs = normalize(uSunDir.xz + vec2(1e-6));
    float azim = max(dot(fd, fs), 0.0);
    float band = exp(-max(t, 0.0) * 6.0);
    col = mix(col, uSkyHorizonSun, band * azim * azim * 0.85);

    // Mie forward-scatter halo. Broad, low amplitude — this is the glow that
    // makes the sun feel like it is in an atmosphere rather than pasted on.
    float mu = dot(dir, uSunDir);
    col += uSunColor * hgPhase(mu, 0.76) * 0.055;
    col += uSunColor * pow(max(mu, 0.0), 8.0) * 0.020;

    // Below the horizon the dome darkens into ground haze.
    col = mix(uGroundHaze, col, smoothstep(-0.10, 0.015, h));
    return col;
  }

  float sunDiscMask(vec3 dir) {
    float cosR = cos(uSunAngularRadius);
    float mu = dot(dir, uSunDir);
    return smoothstep(cosR - 0.0009, cosR + 0.0002, mu);
  }
`;

/**
 * Aerial perspective. Analytic exponential-height-fog integral, with the
 * inscatter colour taken from skyRadiance() in the SAME direction.
 * ART.md P5 / P6.
 */
export const CHUNK_FOG = /* glsl */ `
  float fogOpticalDepth(vec3 camPos, vec3 dir, float dist) {
    float density = uFog.x;
    float hFall   = uFog.y;
    float base    = uFog.w;
    float c0 = camPos.y - base;
    float dy = dir.y;
    float k = density * exp(-hFall * c0);
    if (abs(dy) < 1e-4) return k * dist;
    return k * (1.0 - exp(-hFall * dy * dist)) / (hFall * dy);
  }

  vec3 applyAerial(vec3 color, vec3 worldPos) {
    vec3 d = worldPos - uCameraPos;
    float dist = length(d);
    if (dist < 1e-4) return color;
    vec3 dir = d / dist;
    float od = fogOpticalDepth(uCameraPos, dir, dist);
    float f = clamp((1.0 - exp(-max(od, 0.0))) * uFog.z, 0.0, 1.0);
    return mix(color, skyRadiance(dir), f);
  }
`;

/** Sky-SH indirect. Coefficients are cosine-convolved and 1/PI-folded CPU-side. */
export const CHUNK_SH = /* glsl */ `
  vec3 shIrradiance(vec3 n) {
    return uSkySH[0]
         + uSkySH[1] * n.x + uSkySH[2] * n.y + uSkySH[3] * n.z
         + uSkySH[4] * (n.x * n.y)
         + uSkySH[5] * (n.y * n.z)
         + uSkySH[6] * (n.z * n.x)
         + uSkySH[7] * (n.x * n.x - n.y * n.y)
         + uSkySH[8] * (3.0 * n.z * n.z - 1.0);
  }

  // Sky SH above, ground bounce below, blended across the horizon band.
  vec3 indirectDiffuse(vec3 n, float ao) {
    vec3 sky = max(shIrradiance(n), vec3(0.0));
    float down = smoothstep(0.15, -0.55, n.y);
    vec3 bounced = uGroundBounce * down;
    return (sky + bounced) * ao;
  }
`;

export const CHUNK_SHADOW = /* glsl */ `
  uniform sampler2D uShadowAtlas;
  uniform mat4  uShadowMat[4];
  uniform vec4  uShadowSplits;      // cascade far distances
  uniform vec2  uShadowTexel;       // 1 / atlas size
  uniform vec4  uShadowTexelWorld;  // world-space size of one shadow texel, per cascade
  uniform vec4  uShadowDepthScale;  // 1 / (far - near) of each cascade's ortho box
  uniform float uShadowNormalBias;
  uniform float uShadowDepthBias;

  // Atlas is 2x2. Cascade i occupies quadrant i.
  vec2 cascadeOffset(int i) {
    return vec2(float(i & 1) * 0.5, float(i >> 1) * 0.5);
  }

  int pickCascade(float viewDepth) {
    if (viewDepth < uShadowSplits.x) return 0;
    if (viewDepth < uShadowSplits.y) return 1;
    if (viewDepth < uShadowSplits.z) return 2;
    return 3;
  }

  float cascadeTexelWorld(int i) {
    return i == 0 ? uShadowTexelWorld.x : i == 1 ? uShadowTexelWorld.y
         : i == 2 ? uShadowTexelWorld.z : uShadowTexelWorld.w;
  }
  float cascadeDepthScale(int i) {
    return i == 0 ? uShadowDepthScale.x : i == 1 ? uShadowDepthScale.y
         : i == 2 ? uShadowDepthScale.z : uShadowDepthScale.w;
  }

  float sampleShadow(vec3 worldPos, vec3 N, float viewDepth, float NdotL) {
    if (viewDepth > uShadowSplits.w) return 1.0;
    int c = pickCascade(viewDepth);

    // Normal-offset bias, scaled by the ACTUAL world size of one texel in this
    // cascade and by the slope. A fabricated texel size here is what produced
    // the acne in the first capture: cascade 0 was biased ~5x too coarse while
    // cascade 3 was biased far too fine.
    float texelWorld = cascadeTexelWorld(c);
    float slope = clamp(1.0 - NdotL, 0.0, 1.0);
    vec3 offsetPos = worldPos + N * (uShadowNormalBias * texelWorld * (1.0 + slope * 2.5));

    vec4 lp = uShadowMat[c] * vec4(offsetPos, 1.0);
    vec3 proj = lp.xyz / lp.w;
    proj = proj * 0.5 + 0.5;
    if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0 || proj.z > 1.0) return 1.0;

    // Constant depth bias expressed in WORLD units, converted into this
    // cascade's normalised depth range.
    vec2 base = cascadeOffset(c) + proj.xy * 0.5;
    float ref = proj.z - uShadowDepthBias * cascadeDepthScale(c) * (1.0 + slope * 3.0);

    // 3x3 PCF, rotated by interleaved gradient noise to break up the grid.
    // One tile texel is 1/2048 of tile UV = 1/4096 of atlas UV, which is
    // exactly uShadowTexel — no extra halving.
    float ang = ign(gl_FragCoord.xy) * 6.2831853;
    float s = sin(ang), co = cos(ang);
    mat2 rot = mat2(co, -s, s, co);
    float sum = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = rot * vec2(float(x), float(y)) * uShadowTexel;
        float d = texture(uShadowAtlas, base + o).r;
        sum += ref <= d ? 1.0 : 0.0;
      }
    }
    float shadow = sum / 9.0;

    // Fade the last cascade out rather than popping to lit.
    float fade = smoothstep(uShadowSplits.w, uShadowSplits.w * 0.85, viewDepth);
    return mix(1.0, shadow, fade);
  }
`;

export const CHUNK_BRDF = /* glsl */ `
  float d_ggx(float NdotH, float a) {
    float a2 = a * a;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, EPS);
  }
  float v_smith(float NdotV, float NdotL, float a) {
    float a2 = a * a;
    float gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    float gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, EPS);
  }
  vec3 f_schlick(vec3 f0, float u) {
    float f = pow(1.0 - u, 5.0);
    return f0 + (vec3(1.0) - f0) * f;
  }
  // Analytic DFG approximation (Karis mobile fit) — no BRDF LUT texture,
  // because ARCHITECTURE.md §1 forbids shipping one and generating one is waste.
  vec3 envBRDFApprox(vec3 f0, float rough, float NdotV) {
    const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = rough * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
    return f0 * ab.x + ab.y;
  }

  struct Surface {
    vec3  albedo;
    vec3  N;
    vec3  V;
    float roughness;
    float metalness;
    float ao;
    vec3  f0;
    float clearcoat;
    float clearcoatRoughness;
  };

  vec3 directLight(Surface s, vec3 L, vec3 radiance) {
    vec3 H = normalize(s.V + L);
    float NdotL = max(dot(s.N, L), 0.0);
    if (NdotL <= 0.0) return vec3(0.0);
    float NdotV = max(dot(s.N, s.V), 1e-4);
    float NdotH = max(dot(s.N, H), 0.0);
    float VdotH = max(dot(s.V, H), 0.0);

    float a = max(s.roughness * s.roughness, 0.002);
    vec3 F = f_schlick(s.f0, VdotH);
    float D = d_ggx(NdotH, a);
    float Vis = v_smith(NdotV, NdotL, a);
    vec3 spec = F * D * Vis;

    vec3 kd = (vec3(1.0) - F) * (1.0 - s.metalness);
    vec3 diff = kd * s.albedo * INV_PI;

    vec3 result = (diff + spec) * radiance * NdotL;

    if (s.clearcoat > 0.0) {
      float ca = max(s.clearcoatRoughness * s.clearcoatRoughness, 0.002);
      float cD = d_ggx(NdotH, ca);
      float cV = v_smith(NdotV, NdotL, ca);
      float cF = f_schlick(vec3(0.04), VdotH).x * s.clearcoat;
      result = result * (1.0 - cF) + vec3(cD * cV * cF) * radiance * NdotL;
    }
    return result;
  }
`;

export const CHUNK_CLUSTER = /* glsl */ `
  uniform sampler2D uLightsTex;     // ${LIGHT_TEXELS} texels per light, RGBA32F
  uniform sampler2D uClusterTex;    // offset,count per cluster
  uniform sampler2D uLightIndexTex; // flat index list
  uniform float uLightCount;

  const float CL_X = ${CLUSTER_X}.0;
  const float CL_Y = ${CLUSTER_Y}.0;
  const float CL_Z = ${CLUSTER_Z}.0;
  const float CL_FAR = ${CLUSTER_FAR.toFixed(1)};
  const float LIGHT_TEXELS_F = ${LIGHT_TEXELS}.0;
  const float IDX_W = ${INDEX_TEX_W}.0;
  const float IDX_H = ${INDEX_TEX_H}.0;

  int clusterZSlice(float viewDepth) {
    float n = uNearFar.x;
    float d = clamp(viewDepth, n, CL_FAR);
    float s = log(d / n) / log(CL_FAR / n);
    return int(clamp(floor(s * CL_Z), 0.0, CL_Z - 1.0));
  }

  vec4 fetchLightTexel(int light, int texel) {
    float x = (float(light) * LIGHT_TEXELS_F + float(texel) + 0.5) / (${MAX_LIGHTS}.0 * LIGHT_TEXELS_F);
    return texture(uLightsTex, vec2(x, 0.5));
  }

  vec3 accumulateClusteredLights(Surface s, vec3 worldPos, float viewDepth) {
    if (uLightCount < 0.5) return vec3(0.0);
    ivec2 tile = ivec2(gl_FragCoord.xy / uResolution * vec2(CL_X, CL_Y));
    tile = clamp(tile, ivec2(0), ivec2(int(CL_X) - 1, int(CL_Y) - 1));
    int zs = clusterZSlice(viewDepth);
    int cx = tile.y * int(CL_X) + tile.x;

    vec2 cuv = (vec2(float(cx) + 0.5, float(zs) + 0.5)) / vec2(CL_X * CL_Y, CL_Z);
    vec4 cell = texture(uClusterTex, cuv);
    int offset = int(cell.r + 0.5);
    int count  = int(cell.g + 0.5);

    vec3 sum = vec3(0.0);
    for (int i = 0; i < 64; i++) {
      if (i >= count) break;
      int flat_i = offset + i;
      vec2 iuv = (vec2(float(flat_i - (flat_i / int(IDX_W)) * int(IDX_W)) + 0.5,
                       float(flat_i / int(IDX_W)) + 0.5)) / vec2(IDX_W, IDX_H);
      int li = int(texture(uLightIndexTex, iuv).r + 0.5);

      vec4 pr = fetchLightTexel(li, 0);   // xyz position, w range
      vec4 ci = fetchLightTexel(li, 1);   // rgb colour, a intensity
      vec4 dc = fetchLightTexel(li, 2);   // xyz spot dir, w cos outer
      vec4 ex = fetchLightTexel(li, 3);   // x cos inner, y type

      vec3 toL = pr.xyz - worldPos;
      float dist2 = dot(toL, toL);
      float range = pr.w;
      if (dist2 > range * range) continue;
      float dist = sqrt(max(dist2, EPS));
      vec3 L = toL / dist;

      // Inverse-square with a smooth windowed cutoff at the range boundary.
      float win = clamp(1.0 - sq(sq(dist / range)), 0.0, 1.0);
      float atten = win * win / max(dist2, 0.01);

      if (ex.y > 0.5) { // spot
        float cd = dot(-L, normalize(dc.xyz));
        float t = clamp((cd - dc.w) / max(ex.x - dc.w, 1e-4), 0.0, 1.0);
        atten *= t * t;
      }
      if (atten <= 0.0) continue;
      sum += directLight(s, L, ci.rgb * ci.a * atten);
    }
    return sum;
  }
`;

export const CHUNK_TONEMAP = TONEMAP_GLSL;

/** Everything an opaque forward material needs, in dependency order. */
export const OPAQUE_PRELUDE =
  CHUNK_COMMON + CHUNK_GLOBALS + CHUNK_SKY + CHUNK_FOG + CHUNK_SH + CHUNK_BRDF + CHUNK_SHADOW + CHUNK_CLUSTER;
