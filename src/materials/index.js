// L3 materials — OWNER: `materials` (S2). ARCHITECTURE.md §2.1.
//
// DESIGN DECISION (ART.md §2): there are NO generated textures. Every surface
// detail is an ANALYTIC, HARD-EDGED mask evaluated in the fragment shader from
// world-space triplanar coordinates, antialiased with fwidth().
//
// Why this and not procedural texture generation:
//   - ART.md §2 caps noise at 4 cycles/m and forbids FBM detail below 25 cm.
//     Analytic masks satisfy that BY CONSTRUCTION — there is no high-frequency
//     term to accidentally introduce, so gate P10 cannot regress.
//   - Panels, gaps, bolts and stencils are exactly what the reference art is
//     made of, and they are cheaper and infinitely crisper as signed distance
//     functions than as a baked atlas.
//   - Zero texture memory, zero generation time at boot, nothing to stream.
//
// The cost is that surfaces cannot have unique per-instance grunge. That is the
// correct trade for this target and is stated in HONEST_ASSESSMENT.md.

import * as THREE from 'three';
import { OPAQUE_PRELUDE } from '../render/chunks.js';
import { hexToLinear, CDF, VESS, WROUGHT, TERRAIN, EMISSIVE_RATIO } from '../shared/palette.js';
import { SurfaceId } from '../shared/enums.js';

export const Family = Object.freeze({
  CDF: 0,
  VESS: 1,
  WROUGHT: 2,
  TERRAIN: 3,
  PLAIN: 4,
});

const VERT = /* glsl */ `
  out vec3 vWorldPos;
  out vec3 vNormalW;
  out vec3 vObjPos;
  out float vViewDepth;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vObjPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDepth = -(viewMatrix * wp).z;

    // MUST be written exactly as the prepass writes it. GLSL associates
    // left-to-right, so P * V * wp evaluates as (P*V)*wp, whereas grouping it
    // as P * (V * wp) differs in the last ULP. With the depth buffer already
    // laid down by the prepass, a LEQUAL test then rejects the surface in
    // stripes. Do not "simplify" this by reusing the view-space position.
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PATTERN_GLSL = /* glsl */ `
  // --- Analytic pattern primitives. All antialiased against screen-space
  // --- derivatives so nothing shimmers at grazing angles or at range.

  // Antialiased "is x within w of a grid line of period p".
  //
  // The naive version (smoothstep(w-aa, w+aa, f)) produces heavy moire at
  // grazing angles: once the screen-space footprint exceeds the feature width
  // the result oscillates between 0 and 1 instead of converging. The fix is to
  // fade toward the feature's AVERAGE COVERAGE (2w/p) as it drops below the
  // sampling rate, which is what a correctly mip-mapped texture would do.
  float gridLine(float x, float p, float w) {
    // 1.0x the derivative rather than 0.7x: at 0.7 the interior shot measured
    // 0.069 high-frequency energy against ART.md P10's 0.06 ceiling.
    float aa = fwidth(x) * 1.0 + 1e-6;
    float f = abs(fract(x / p - 0.5) - 0.5) * p;
    float line = 1.0 - smoothstep(w - aa, w + aa, f);
    float avg = clamp((2.0 * w) / p, 0.0, 1.0);
    float fade = clamp(aa / max(w, 1e-5), 0.0, 1.0);
    return mix(line, avg, fade);
  }

  // Antialiased disc field: bolts on a lattice. Same convergence rule.
  float boltField(vec2 uv, float period, float radius) {
    float aa = max(fwidth(uv.x), fwidth(uv.y)) * 0.9 + 1e-6;
    vec2 c = (fract(uv / period) - 0.5) * period;
    float d = length(c);
    float disc = 1.0 - smoothstep(radius - aa, radius + aa, d);
    float avg = clamp((3.14159265 * radius * radius) / (period * period), 0.0, 1.0);
    float fade = clamp(aa / max(radius, 1e-5), 0.0, 1.0);
    return mix(disc, avg, fade);
  }

  // Antialiased box mask, used for stencil marks and hazard bands.
  float boxMask(vec2 p, vec2 half_) {
    vec2 d = abs(p) - half_;
    float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    float aa = fwidth(p.x) + 1e-5;
    return 1.0 - smoothstep(-aa, aa, dist);
  }

  // Diagonal hazard stripes.
  float hazardStripes(vec2 uv, float period) {
    return gridLine(uv.x + uv.y, period, period * 0.25);
  }

  // Triplanar weights, sharpened so blends are narrow rather than mushy.
  vec3 triWeights(vec3 n) {
    vec3 w = pow(abs(n), vec3(6.0));
    return w / max(w.x + w.y + w.z, 1e-5);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  ${OPAQUE_PRELUDE}
  ${PATTERN_GLSL}

  in vec3 vWorldPos;
  in vec3 vNormalW;
  in vec3 vObjPos;
  in float vViewDepth;

  layout(location = 0) out vec4 fragColor;

  uniform vec3  uBaseColor;
  uniform vec3  uAccentColor;
  uniform vec3  uEmissiveColor;
  uniform float uEmissiveIntensity;
  uniform float uRoughness;
  uniform float uMetalness;
  uniform float uClearcoat;
  uniform float uPanelSize;
  uniform float uGapWidth;
  uniform float uBoltPeriod;
  uniform float uPatternScale;
  uniform float uWearAmount;
  uniform float uMarkings;
  uniform float uEmissiveSeams;
  uniform float uPatternRotation;
  uniform sampler2D uAOTex;
  uniform float uAOEnabled;

  void main() {
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 P = vWorldPos * uPatternScale;

    vec3 tw = triWeights(N);
    vec2 uvX = P.zy, uvY = P.xz, uvZ = P.xy;

    vec3  albedo    = uBaseColor;
    float roughness = uRoughness;
    float metalness = uMetalness;
    float clearcoat = uClearcoat;
    vec3  emissive  = vec3(0.0);
    float cavity    = 1.0;

    #if FAMILY == 0
      // ---- CDF: bolted painted panels, stencils, wear on edges only. --------
      float gp = uPanelSize;
      float gw = uGapWidth;
      float gapX = max(gridLine(uvX.x, gp, gw), gridLine(uvX.y, gp * 0.5, gw));
      float gapY = max(gridLine(uvY.x, gp, gw), gridLine(uvY.y, gp, gw));
      float gapZ = max(gridLine(uvZ.x, gp, gw), gridLine(uvZ.y, gp * 0.5, gw));
      float gap = gapX * tw.x + gapY * tw.y + gapZ * tw.z;

      float bolts = boltField(uvX, uBoltPeriod, uBoltPeriod * 0.10) * tw.x
                  + boltField(uvY, uBoltPeriod, uBoltPeriod * 0.10) * tw.y
                  + boltField(uvZ, uBoltPeriod, uBoltPeriod * 0.10) * tw.z;

      // Panel-to-panel value variation. Constant per panel — a hard step, not
      // a gradient, so it reads as manufactured plate rather than as noise.
      vec2 pid = floor(uvZ / gp);
      float panelVar = fract(sin(dot(pid, vec2(41.3, 289.1))) * 43758.5453);
      albedo *= mix(0.90, 1.10, step(0.5, panelVar));

      // Gap: darker, rougher, and reads as a real recess via cavity occlusion.
      albedo = mix(albedo, albedo * 0.34, gap);
      cavity = mix(1.0, 0.55, gap);
      roughness = mix(roughness, 0.82, gap);

      // Bolts: slightly proud, brighter, more metallic.
      albedo = mix(albedo, albedo * 1.25, bolts);
      metalness = mix(metalness, 0.85, bolts * 0.7);
      roughness = mix(roughness, 0.42, bolts * 0.7);

      // ART.md §3.2: bare metal ONLY in a narrow band beside the panel gaps.
      float edgeBand = gridLine(uvZ.x, gp, gw * 3.2) * tw.z
                     + gridLine(uvY.x, gp, gw * 3.2) * tw.y
                     + gridLine(uvX.x, gp, gw * 3.2) * tw.x;
      float wear = clamp((edgeBand - gap) * uWearAmount, 0.0, 1.0);
      albedo = mix(albedo, vec3(0.42, 0.43, 0.45), wear * 0.8);
      metalness = mix(metalness, 1.0, wear * 0.8);
      roughness = mix(roughness, 0.35, wear * 0.8);

      // Stencil markings: hard-edged bands, legible from 8 m.
      if (uMarkings > 0.5) {
        vec2 mp = uvZ - floor(uvZ / (gp * 2.0)) * (gp * 2.0) - gp;
        float bar = boxMask(mp - vec2(0.0, gp * 0.34), vec2(gp * 0.30, gp * 0.035));
        float bar2 = boxMask(mp - vec2(0.0, gp * 0.26), vec2(gp * 0.18, gp * 0.022));
        float mark = clamp(bar + bar2, 0.0, 1.0) * tw.z;
        albedo = mix(albedo, uAccentColor, mark * 0.9);
        roughness = mix(roughness, 0.60, mark);
      }

    #elif FAMILY == 1
      // ---- Vess: smooth shell, gloss, clearcoat, emissive accent seams. -----
      // No panels, no bolts, no stencils. The form does all the work.
      float shade = smoothstep(-0.4, 0.9, dot(N, vec3(0.0, 1.0, 0.0)));
      albedo = mix(uBaseColor * 0.72, uAccentColor, shade * 0.55);

      // Accent seams follow one object-space axis so they wrap the shell shape.
      // Period 1.6 m: a few deliberate seams per form, not a stripe pattern.
      float seamC = vObjPos.y * uPatternScale + uPatternRotation;
      float seam = gridLine(seamC, 1.6, 0.035);
      float seamEdge = gridLine(seamC, 1.6, 0.075) - seam;
      albedo = mix(albedo, uBaseColor * 0.35, clamp(seamEdge, 0.0, 1.0));
      emissive += uEmissiveColor * uEmissiveIntensity * seam * uEmissiveSeams;
      roughness = mix(roughness, 0.30, clamp(seamEdge, 0.0, 1.0));

    #elif FAMILY == 2
      // ---- Wrought: pale slabs, DEEP gaps, glowing seam strips. -------------
      float gp = uPanelSize;
      float gw = uGapWidth;
      float gX = max(gridLine(uvX.x, gp, gw), gridLine(uvX.y, gp, gw));
      float gY = max(gridLine(uvY.x, gp, gw), gridLine(uvY.y, gp, gw));
      float gZ = max(gridLine(uvZ.x, gp, gw), gridLine(uvZ.y, gp, gw));
      float gap = gX * tw.x + gY * tw.y + gZ * tw.z;

      // The gap shadow is the primary form-reading cue (ART.md §3.4), so the
      // cavity term here is deliberately strong.
      albedo = mix(uBaseColor, vec3(0.06, 0.07, 0.075), gap);
      cavity = mix(1.0, 0.18, gap);
      roughness = mix(uRoughness, 0.85, gap);

      // A thinner strip INSIDE the gap glows.
      float strip = gridLine(uvZ.x, gp, gw * 0.34) * tw.z
                  + gridLine(uvY.x, gp, gw * 0.34) * tw.y
                  + gridLine(uvX.x, gp, gw * 0.34) * tw.x;
      emissive += uEmissiveColor * uEmissiveIntensity * clamp(strip, 0.0, 1.0) * uEmissiveSeams;

      // Large-radius repeated motif at a 2.5-8 m module.
      vec2 mp = fract(uvZ / (gp * 2.0)) - 0.5;
      float motif = boxMask(mp * gp * 2.0, vec2(gp * 0.16, gp * 0.42))
                  - boxMask(mp * gp * 2.0, vec2(gp * 0.10, gp * 0.34));
      albedo = mix(albedo, uAccentColor, clamp(motif, 0.0, 1.0) * 0.5 * tw.z);

    #elif FAMILY == 3
      // ---- Terrain: slope- and height-driven blend, triplanar. --------------
      float slope = clamp(dot(N, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
      float rocky = 1.0 - smoothstep(0.62, 0.86, slope);
      vec3 grass = uBaseColor;
      vec3 rock = uAccentColor;
      albedo = mix(grass, rock, rocky);
      roughness = mix(uRoughness, 0.88, rocky);

      // Very low-frequency variation only: ART.md §2 caps this at 4 cycles/m
      // and +/-8% amplitude, so it is one large soft wave, not FBM grain.
      float wave = sin(vWorldPos.x * 0.06) * cos(vWorldPos.z * 0.052);
      albedo *= 1.0 + wave * 0.07;
      metalness = 0.0;
    #endif

    // ---- Screen-space AO from the GTAO pass ---------------------------------
    float ao = 1.0;
    if (uAOEnabled > 0.5) {
      ao = texture(uAOTex, gl_FragCoord.xy / uResolution).r;
    }
    ao *= cavity;

    Surface s;
    s.albedo = albedo;
    s.N = N;
    s.V = V;
    s.roughness = clamp(roughness, 0.035, 1.0);
    s.metalness = clamp(metalness, 0.0, 1.0);
    s.ao = ao;
    s.f0 = mix(vec3(0.04), albedo, s.metalness);
    s.clearcoat = clearcoat;
    s.clearcoatRoughness = 0.08;

    // Sun
    float NdotL = max(dot(N, uSunDir), 0.0);
    float shadow = sampleShadow(vWorldPos, N, vViewDepth, NdotL);
    vec3 color = directLight(s, uSunDir, uSunColor * shadow);

    // Clustered local lights
    color += accumulateClusteredLights(s, vWorldPos, vViewDepth);

    // Indirect: sky SH above, ground bounce below, modulated by AO
    vec3 kd = (vec3(1.0) - s.f0) * (1.0 - s.metalness);
    color += indirectDiffuse(N, ao) * s.albedo * kd;

    // Specular ambient from the sky in the reflection direction
    float NdotV = max(dot(N, V), 1e-4);
    vec3 R = reflect(-V, N);
    vec3 envSpec = skyRadiance(normalize(mix(R, N, s.roughness * s.roughness)));
    color += envSpec * envBRDFApprox(s.f0, s.roughness, NdotV) * ao;

    color += emissive;

    // Aerial perspective LAST, using the same skyRadiance() the dome uses.
    color = applyAerial(color, vWorldPos);

    fragColor = vec4(color, 1.0);
  }
`;

let _globals = null;
/** Called once by the game at boot. Materials share the global uniforms BY REFERENCE. */
export function bindGlobals(globals) {
  _globals = globals;
}

const _cache = new Map();

/**
 * @param {number} family Family.*
 * @param {object} params
 * @returns {THREE.ShaderMaterial}
 */
export function createMaterial(family, params = {}) {
  if (!_globals) throw new Error('[materials] bindGlobals() must be called before createMaterial()');

  const p = {
    baseColor: '#808080',
    accentColor: '#ffffff',
    emissiveColor: '#ffffff',
    emissiveIntensity: 0,
    roughness: 0.65,
    metalness: 0.0,
    clearcoat: 0.0,
    panelSize: 2.0,
    gapWidth: 0.022,
    boltPeriod: 0.42,
    patternScale: 1.0,
    wearAmount: 0.0,
    markings: false,
    emissiveSeams: 1.0,
    patternRotation: 0.0,
    surfaceId: SurfaceId.METAL_PAINTED,
    side: THREE.FrontSide,
    ...params,
  };

  const bc = hexToLinear(p.baseColor);
  const ac = hexToLinear(p.accentColor);
  const ec = hexToLinear(p.emissiveColor);

  const uniforms = Object.assign({}, _globals.u, {
    uBaseColor: { value: new THREE.Vector3(bc[0], bc[1], bc[2]) },
    uAccentColor: { value: new THREE.Vector3(ac[0], ac[1], ac[2]) },
    uEmissiveColor: { value: new THREE.Vector3(ec[0], ec[1], ec[2]) },
    uEmissiveIntensity: { value: p.emissiveIntensity },
    uRoughness: { value: p.roughness },
    uMetalness: { value: p.metalness },
    uClearcoat: { value: p.clearcoat },
    uPanelSize: { value: p.panelSize },
    uGapWidth: { value: p.gapWidth },
    uBoltPeriod: { value: p.boltPeriod },
    uPatternScale: { value: p.patternScale },
    uWearAmount: { value: p.wearAmount },
    uMarkings: { value: p.markings ? 1 : 0 },
    uEmissiveSeams: { value: p.emissiveSeams },
    uPatternRotation: { value: p.patternRotation },
  });

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    defines: { FAMILY: family },
    side: p.side,
    // Depth is already laid down by the prepass. LEQUAL rather than EQUAL: the
    // prepass and this shader compute clip space through different code paths,
    // and EQUAL would z-fight on the last ULP.
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
  mat.userData.surfaceId = p.surfaceId;
  return mat;
}

// ---------------------------------------------------------------------------
// The shipped material library. ART.md §3 palette values, nothing invented here.
// ---------------------------------------------------------------------------
export const Materials = {
  cdfHull: () =>
    createMaterial(Family.CDF, {
      baseColor: CDF.oliveDrab,
      accentColor: CDF.cautionYellow,
      roughness: 0.68,
      metalness: 0.15,
      panelSize: 2.0,
      gapWidth: 0.022,
      boltPeriod: 0.44,
      wearAmount: 0.85,
      markings: true,
      surfaceId: SurfaceId.METAL_PAINTED,
    }),
  cdfFloor: () =>
    createMaterial(Family.CDF, {
      baseColor: CDF.deckGrey,
      accentColor: CDF.hazardOrange,
      roughness: 0.72,
      metalness: 0.1,
      panelSize: 1.4,
      gapWidth: 0.018,
      boltPeriod: 0.35,
      wearAmount: 0.6,
      markings: true,
      surfaceId: SurfaceId.METAL_GRATE,
    }),
  cdfGunmetal: () =>
    createMaterial(Family.CDF, {
      baseColor: CDF.gunmetal,
      accentColor: CDF.opticCyan,
      roughness: 0.55,
      // ART.md §3.2: CDF surfaces are matte, with bare metal ONLY on chamfers
      // and edges. A high base metalness kills the diffuse term and these read
      // as black holes indoors; the wear band still drives metalness to 1.0.
      metalness: 0.12,
      panelSize: 0.9,
      gapWidth: 0.012,
      boltPeriod: 0.22,
      wearAmount: 1.0,
      markings: false,
      surfaceId: SurfaceId.METAL_BARE,
    }),
  cdfLight: () =>
    createMaterial(Family.CDF, {
      baseColor: CDF.oliveLight,
      accentColor: CDF.cautionYellow,
      roughness: 0.66,
      metalness: 0.12,
      panelSize: 2.4,
      wearAmount: 0.7,
      markings: true,
      surfaceId: SurfaceId.METAL_PAINTED,
    }),
  vessShell: (emissive = VESS.plasmaCyan) =>
    createMaterial(Family.VESS, {
      baseColor: VESS.shellBase,
      accentColor: VESS.shellLight,
      emissiveColor: emissive,
      // ART.md §3.3 wants emissive at 3-8x adjacent diffuse luminance. A sunlit
      // Vess shell sits near 0.27 linear, so 1.6 lands at ~5.9x — inside the
      // window and above the post-exposure bloom threshold of 1.0.
      emissiveIntensity: 1.6,
      roughness: 0.18,
      metalness: 0.1,
      clearcoat: 0.85,
      patternScale: 1.0,
      surfaceId: SurfaceId.ALLOY_SMOOTH,
    }),
  vessDeep: () =>
    createMaterial(Family.VESS, {
      baseColor: VESS.shellDeep,
      accentColor: VESS.shellBase,
      emissiveColor: VESS.plasmaViolet,
      emissiveIntensity: 1.6,
      roughness: 0.22,
      metalness: 0.15,
      clearcoat: 0.7,
      surfaceId: SurfaceId.ALLOY_SMOOTH,
    }),
  wroughtSlab: () =>
    createMaterial(Family.WROUGHT, {
      baseColor: WROUGHT.slabPale,
      accentColor: WROUGHT.slabShadow,
      emissiveColor: WROUGHT.seamEmissive,
      emissiveIntensity: 1.6,
      roughness: 0.42,
      metalness: 0.05,
      panelSize: 4.0,
      gapWidth: 0.06,
      surfaceId: SurfaceId.ALLOY_HARD,
    }),
  terrain: () =>
    createMaterial(Family.TERRAIN, {
      baseColor: TERRAIN.grass,
      accentColor: TERRAIN.rock,
      roughness: 0.86,
      metalness: 0.0,
      surfaceId: SurfaceId.GRASS,
    }),
  plain: (color, opts = {}) =>
    createMaterial(Family.PLAIN, { baseColor: color, roughness: 0.6, ...opts }),
};

export { EMISSIVE_RATIO };
