// L2 render — post passes 3, 9, 10, 11. OWNER: `lighting` (S1).
// GTAO -> TAA -> Bloom -> Composite.

import * as THREE from 'three';
import { FullscreenPass, makeTarget } from './fullscreen.js';
import { CHUNK_COMMON } from './chunks.js';
import { TONEMAP_GLSL } from './tonemap.js';

// ---------------------------------------------------------------------------
// Pass 3 — GTAO. Half resolution, 4 slices x 6 steps, temporally rotated.
// ---------------------------------------------------------------------------
const GTAO_FRAG = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  uniform sampler2D uDepth;
  uniform sampler2D uNormal;
  uniform mat4  uInvProj;
  uniform mat4  uView;
  uniform vec2  uResolution;   // half-res target size
  uniform vec2  uNearFar;
  uniform float uRadius;
  uniform float uIntensity;
  uniform float uFrame;

  float linearDepth(float d) {
    float n = uNearFar.x, f = uNearFar.y;
    float z = d * 2.0 - 1.0;
    return (2.0 * n * f) / (f + n - z * (f - n));
  }

  vec3 viewPos(vec2 uv, float d) {
    vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = uInvProj * clip;
    return v.xyz / v.w;
  }

  void main() {
    float d = texture(uDepth, vUv).r;
    if (d >= 1.0) { fragColor = vec4(1.0); return; }

    vec3 P = viewPos(vUv, d);
    // The prepass stores WORLD-space normals; GTAO reasons in VIEW space, so
    // this transform is load-bearing, not cosmetic.
    vec3 Nw = octDecode(texture(uNormal, vUv).rg);
    vec3 N = normalize((uView * vec4(Nw, 0.0)).xyz);

    // Screen-space radius from a world radius at this depth.
    float viewZ = -P.z;
    float radiusPx = uRadius / max(viewZ, 0.1) * uResolution.y * 0.5;
    radiusPx = clamp(radiusPx, 4.0, 96.0);

    float rot = ign(gl_FragCoord.xy + uFrame * 7.0) * 6.2831853;
    float occ = 0.0;
    const int SLICES = 4;
    const int STEPS = 6;

    for (int s = 0; s < SLICES; s++) {
      float ang = rot + float(s) * (3.14159265 / float(SLICES));
      vec2 dir = vec2(cos(ang), sin(ang));
      float best = 0.0;
      for (int t = 1; t <= STEPS; t++) {
        float f = float(t) / float(STEPS);
        vec2 offs = dir * radiusPx * f / uResolution;
        vec2 suv = vUv + offs;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
        float sd = texture(uDepth, suv).r;
        if (sd >= 1.0) continue;
        vec3 S = viewPos(suv, sd);
        vec3 dv = S - P;
        float len = length(dv);
        if (len < 1e-4 || len > uRadius * 1.5) continue;
        float cosH = dot(dv / len, N);
        // Distance attenuation stops a distant silhouette darkening a surface.
        float att = 1.0 - clamp(len / (uRadius * 1.5), 0.0, 1.0);
        best = max(best, cosH * att);
      }
      occ += clamp(best, 0.0, 1.0);
    }
    occ /= float(SLICES);
    float ao = clamp(1.0 - occ * uIntensity, 0.0, 1.0);
    fragColor = vec4(ao, viewZ, 0.0, 1.0);
  }
`;

const GTAO_BLUR_FRAG = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;
  uniform sampler2D uAO;
  uniform sampler2D uHistory;
  uniform vec2 uTexel;
  uniform vec2 uDir;
  uniform float uBlend;

  void main() {
    vec4 c = texture(uAO, vUv);
    float centerZ = c.g;
    float sum = c.r;
    float wsum = 1.0;
    for (int i = 1; i <= 3; i++) {
      vec2 o = uDir * uTexel * float(i);
      for (int s = 0; s < 2; s++) {
        vec2 uv = vUv + (s == 0 ? o : -o);
        vec4 t = texture(uAO, uv);
        // Bilateral on linear view depth: do not blur across a silhouette.
        float w = exp(-abs(t.g - centerZ) * 4.0) * (1.0 - float(i) * 0.22);
        sum += t.r * w;
        wsum += w;
      }
    }
    float ao = sum / wsum;
    fragColor = vec4(ao, centerZ, 0.0, 1.0);
  }
`;

export class GtaoPass {
  constructor(width, height) {
    this.uniforms = {
      uDepth: { value: null },
      uNormal: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2() },
      uNearFar: { value: new THREE.Vector2(0.05, 4000) },
      uRadius: { value: 1.35 },
      uIntensity: { value: 1.15 },
      uFrame: { value: 0 },
    };
    this.pass = new FullscreenPass(GTAO_FRAG, this.uniforms);
    this.blurUniforms = {
      uAO: { value: null },
      uHistory: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
      uBlend: { value: 0.0 },
    };
    this.blur = new FullscreenPass(GTAO_BLUR_FRAG, this.blurUniforms);
    this.resize(width, height);
  }

  resize(width, height) {
    this.w = Math.max(1, width >> 1);
    this.h = Math.max(1, height >> 1);
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.rtA = makeTarget(this.w, this.h, { type: THREE.HalfFloatType });
    this.rtB = makeTarget(this.w, this.h, { type: THREE.HalfFloatType });
    this.uniforms.uResolution.value.set(this.w, this.h);
    this.blurUniforms.uTexel.value.set(1 / this.w, 1 / this.h);
  }

  render(renderer, depthTex, normalTex, camera, frame) {
    this.uniforms.uDepth.value = depthTex;
    this.uniforms.uNormal.value = normalTex;
    this.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uView.value.copy(camera.matrixWorldInverse);
    this.uniforms.uNearFar.value.set(camera.near, camera.far);
    this.uniforms.uFrame.value = frame % 64;

    this.pass.render(renderer, this.rtA, true);

    this.blurUniforms.uAO.value = this.rtA.texture;
    this.blurUniforms.uDir.value.set(1, 0);
    this.blur.render(renderer, this.rtB, true);

    this.blurUniforms.uAO.value = this.rtB.texture;
    this.blurUniforms.uDir.value.set(0, 1);
    this.blur.render(renderer, this.rtA, true);

    return this.rtA.texture;
  }

  dispose() {
    this.pass.dispose();
    this.blur.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
  }
}

// ---------------------------------------------------------------------------
// Pass 9 — TAA. Velocity reprojection + YCoCg variance clipping.
// ---------------------------------------------------------------------------
const TAA_FRAG = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  uniform sampler2D uCurrent;
  uniform sampler2D uHistory;
  uniform sampler2D uVelocity;
  uniform sampler2D uDepth;
  uniform vec2 uTexel;
  uniform float uFeedback;
  uniform float uVarianceGamma;
  uniform float uReset;
  // Maps current NDC to previous NDC for a point at infinity (rotation only).
  // Background pixels have no geometry, so nothing writes them into the
  // velocity buffer; without this the entire sky and the ring smear whenever
  // the camera turns, which is the most visible TAA artefact in the game.
  uniform mat4 uSkyReproj;

  vec3 rgbToYCoCg(vec3 c) {
    return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
                0.5  * c.r - 0.5 * c.b,
               -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
  }
  vec3 yCoCgToRgb(vec3 c) {
    return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
  }

  void main() {
    vec3 curr = texture(uCurrent, vUv).rgb;
    if (uReset > 0.5) { fragColor = vec4(curr, 1.0); return; }

    // Dilate velocity toward the closest depth in a 3x3 neighbourhood so thin
    // moving geometry drags its own motion vector instead of the background's.
    vec2 bestOffset = vec2(0.0);
    float bestDepth = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y)) * uTexel;
        float d = texture(uDepth, vUv + o).r;
        if (d < bestDepth) { bestDepth = d; bestOffset = o; }
      }
    }
    vec2 prevUv;
    float centreDepth = texture(uDepth, vUv).r;
    if (centreDepth >= 1.0) {
      vec4 pn = uSkyReproj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      prevUv = (pn.xy / max(pn.w, 1e-6)) * 0.5 + 0.5;
    } else {
      vec2 vel = texture(uVelocity, vUv + bestOffset).rg;
      prevUv = vUv - vel;
    }

    if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
      fragColor = vec4(curr, 1.0);
      return;
    }

    // Neighbourhood statistics in YCoCg — clipping in a luma/chroma space keeps
    // saturated highlights from being dragged toward grey, which matters a lot
    // for this art direction (ART.md P4).
    vec3 m1 = vec3(0.0), m2 = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 c = rgbToYCoCg(texture(uCurrent, vUv + vec2(float(x), float(y)) * uTexel).rgb);
        m1 += c;
        m2 += c * c;
      }
    }
    vec3 mean = m1 / 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));
    vec3 minC = mean - uVarianceGamma * sigma;
    vec3 maxC = mean + uVarianceGamma * sigma;

    vec3 hist = rgbToYCoCg(texture(uHistory, prevUv).rgb);
    hist = clamp(hist, minC, maxC);

    vec3 currY = rgbToYCoCg(curr);
    // Luminance-weighted blend: bright pixels trust history less, which kills
    // the classic TAA smear on muzzle flashes and plasma.
    float wc = 1.0 / (1.0 + currY.x);
    float wh = 1.0 / (1.0 + hist.x);
    float feedback = uFeedback * (wh / max(wc + wh, 1e-5)) * 2.0;
    feedback = clamp(feedback, 0.0, uFeedback);

    vec3 outY = mix(currY, hist, feedback);
    fragColor = vec4(max(yCoCgToRgb(outY), vec3(0.0)), 1.0);
  }
`;

export class TaaPass {
  constructor(width, height) {
    this.uniforms = {
      uCurrent: { value: null },
      uHistory: { value: null },
      uVelocity: { value: null },
      uDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uFeedback: { value: 0.9 },
      uVarianceGamma: { value: 1.0 },
      uReset: { value: 1 },
      uSkyReproj: { value: new THREE.Matrix4() },
    };
    this.pass = new FullscreenPass(TAA_FRAG, this.uniforms);
    this._first = true;
    this._curRot = new THREE.Matrix4();
    this._prevRot = new THREE.Matrix4();
    this._hasPrevRot = false;
    this.resize(width, height);
  }

  resize(width, height) {
    this.historyA?.dispose();
    this.historyB?.dispose();
    this.historyA = makeTarget(width, height, { type: THREE.HalfFloatType });
    this.historyB = makeTarget(width, height, { type: THREE.HalfFloatType });
    this.uniforms.uTexel.value.set(1 / width, 1 / height);
    this._first = true;
    this._ping = true;
  }

  reset() {
    this._first = true;
  }

  /**
   * Build the infinity reprojection from the camera's ROTATION only. A point at
   * infinity is unaffected by camera translation, so zeroing the view matrix
   * translation gives the exact background motion.
   */
  updateSkyReprojection(camera, unjitteredProj) {
    const v = this._curRot.copy(camera.matrixWorldInverse);
    v.elements[12] = 0;
    v.elements[13] = 0;
    v.elements[14] = 0;
    v.premultiply(unjitteredProj);
    if (this._hasPrevRot) {
      this.uniforms.uSkyReproj.value.copy(this._curRot).invert().premultiply(this._prevRot);
    } else {
      this.uniforms.uSkyReproj.value.identity();
    }
    this._prevRot.copy(this._curRot);
    this._hasPrevRot = true;
  }

  render(renderer, currentTex, velocityTex, depthTex) {
    const dst = this._ping ? this.historyA : this.historyB;
    const src = this._ping ? this.historyB : this.historyA;
    this.uniforms.uCurrent.value = currentTex;
    this.uniforms.uHistory.value = src.texture;
    this.uniforms.uVelocity.value = velocityTex;
    this.uniforms.uDepth.value = depthTex;
    this.uniforms.uReset.value = this._first ? 1 : 0;
    this.pass.render(renderer, dst, true);
    this._first = false;
    this._ping = !this._ping;
    return dst.texture;
  }

  dispose() {
    this.pass.dispose();
    this.historyA.dispose();
    this.historyB.dispose();
  }
}

// ---------------------------------------------------------------------------
// Pass 10 — Bloom. 6-level pyramid, Karis average on level 0, tent upsample.
// ART.md §7.2: bright and wide ON PURPOSE. This is the look, not a defect.
// ---------------------------------------------------------------------------
const BLOOM_PREFILTER = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  uniform float uThreshold;
  uniform float uKnee;
  uniform float uExposure;

  vec3 tap(vec2 uv) { return max(texture(uSrc, uv).rgb, vec3(0.0)) * uExposure; }

  void main() {
    // 13-tap downsample with Karis average on the 4 quads, which stops a single
    // overbright pixel from becoming a permanent flickering firefly.
    vec2 t = uTexel;
    vec3 a = tap(vUv + vec2(-2,  2) * t); vec3 b = tap(vUv + vec2( 0,  2) * t); vec3 c = tap(vUv + vec2( 2,  2) * t);
    vec3 d = tap(vUv + vec2(-2,  0) * t); vec3 e = tap(vUv);                     vec3 f = tap(vUv + vec2( 2,  0) * t);
    vec3 g = tap(vUv + vec2(-2, -2) * t); vec3 h = tap(vUv + vec2( 0, -2) * t); vec3 i = tap(vUv + vec2( 2, -2) * t);
    vec3 j = tap(vUv + vec2(-1,  1) * t); vec3 k = tap(vUv + vec2( 1,  1) * t);
    vec3 l = tap(vUv + vec2(-1, -1) * t); vec3 m = tap(vUv + vec2( 1, -1) * t);

    vec3 g0 = (j + k + l + m) * 0.25;
    vec3 g1 = (a + b + d + e) * 0.25;
    vec3 g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25;
    vec3 g4 = (e + f + h + i) * 0.25;
    float w0 = 1.0 / (1.0 + luma(g0));
    float w1 = 1.0 / (1.0 + luma(g1));
    float w2 = 1.0 / (1.0 + luma(g2));
    float w3 = 1.0 / (1.0 + luma(g3));
    float w4 = 1.0 / (1.0 + luma(g4));
    float wsum = w0 * 0.5 + (w1 + w2 + w3 + w4) * 0.125;
    vec3 col = (g0 * w0 * 0.5 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.125) / max(wsum, 1e-5);

    // Soft-knee threshold.
    float br = maxc(col);
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-5);
    float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
    fragColor = vec4(col * contrib, 1.0);
  }
`;

const BLOOM_DOWN = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  void main() {
    vec2 t = uTexel;
    vec3 a = texture(uSrc, vUv + vec2(-2,  2) * t).rgb; vec3 b = texture(uSrc, vUv + vec2( 0,  2) * t).rgb; vec3 c = texture(uSrc, vUv + vec2( 2,  2) * t).rgb;
    vec3 d = texture(uSrc, vUv + vec2(-2,  0) * t).rgb; vec3 e = texture(uSrc, vUv).rgb;                     vec3 f = texture(uSrc, vUv + vec2( 2,  0) * t).rgb;
    vec3 g = texture(uSrc, vUv + vec2(-2, -2) * t).rgb; vec3 h = texture(uSrc, vUv + vec2( 0, -2) * t).rgb; vec3 i = texture(uSrc, vUv + vec2( 2, -2) * t).rgb;
    vec3 j = texture(uSrc, vUv + vec2(-1,  1) * t).rgb; vec3 k = texture(uSrc, vUv + vec2( 1,  1) * t).rgb;
    vec3 l = texture(uSrc, vUv + vec2(-1, -1) * t).rgb; vec3 m = texture(uSrc, vUv + vec2( 1, -1) * t).rgb;
    vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    fragColor = vec4(col, 1.0);
  }
`;

const BLOOM_UP = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  uniform float uRadius;
  uniform float uWeight;
  void main() {
    vec2 t = uTexel * uRadius;
    vec3 a = texture(uSrc, vUv + vec2(-1,  1) * t).rgb; vec3 b = texture(uSrc, vUv + vec2( 0,  1) * t).rgb; vec3 c = texture(uSrc, vUv + vec2( 1,  1) * t).rgb;
    vec3 d = texture(uSrc, vUv + vec2(-1,  0) * t).rgb; vec3 e = texture(uSrc, vUv).rgb;                     vec3 f = texture(uSrc, vUv + vec2( 1,  0) * t).rgb;
    vec3 g = texture(uSrc, vUv + vec2(-1, -1) * t).rgb; vec3 h = texture(uSrc, vUv + vec2( 0, -1) * t).rgb; vec3 i = texture(uSrc, vUv + vec2( 1, -1) * t).rgb;
    vec3 tent = (e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + i)) / 16.0;
    // Written with ADDITIVE BLENDING into the destination level. Reading and
    // writing the same target in one draw is undefined; blending is the fix.
    fragColor = vec4(tent * uWeight, 1.0);
  }
`;

export const BLOOM_LEVELS = 6;
export const BLOOM_WEIGHTS = [1.0, 0.85, 0.68, 0.52, 0.38, 0.26];

export class BloomPass {
  constructor(width, height, exposure) {
    this.preU = {
      uSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1.0 },
      uKnee: { value: 0.55 },
      uExposure: { value: exposure },
    };
    this.downU = { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } };
    this.upU = {
      uSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.0 },
      uWeight: { value: 1.0 },
    };
    this.prefilter = new FullscreenPass(BLOOM_PREFILTER, this.preU);
    this.down = new FullscreenPass(BLOOM_DOWN, this.downU);
    this.up = new FullscreenPass(BLOOM_UP, this.upU, {}, THREE.AdditiveBlending);
    this.resize(width, height);
  }

  resize(width, height) {
    if (this.chain) for (const t of this.chain) t.dispose();
    this.chain = [];
    let w = width,
      h = height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this.chain.push(makeTarget(w, h, { type: THREE.HalfFloatType }));
    }
  }

  render(renderer, srcTex, srcW, srcH) {
    this.preU.uSrc.value = srcTex;
    this.preU.uTexel.value.set(1 / srcW, 1 / srcH);
    this.prefilter.render(renderer, this.chain[0], true);

    for (let i = 1; i < BLOOM_LEVELS; i++) {
      const prev = this.chain[i - 1];
      this.downU.uSrc.value = prev.texture;
      this.downU.uTexel.value.set(1 / prev.width, 1 / prev.height);
      this.down.render(renderer, this.chain[i], true);
    }
    // Upsample from the smallest level, blending each into the next larger one.
    // ART.md §7.2 level weights make the halo wide without smearing the base.
    for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
      const src = this.chain[i];
      this.upU.uSrc.value = src.texture;
      this.upU.uTexel.value.set(1 / src.width, 1 / src.height);
      this.upU.uRadius.value = 1.0;
      this.upU.uWeight.value = BLOOM_WEIGHTS[i];
      this.up.render(renderer, this.chain[i - 1], false); // additive, no clear
    }
    return this.chain[0].texture;
  }

  dispose() {
    for (const t of this.chain) t.dispose();
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
  }
}

// ---------------------------------------------------------------------------
// Pass 11 — Composite. Exposure -> hue-preserving filmic -> vignette -> dither.
// ---------------------------------------------------------------------------
const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}
  ${TONEMAP_GLSL}
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  uniform sampler2D uColor;
  uniform sampler2D uBloom;
  uniform float uExposure;
  uniform float uBloomIntensity;
  uniform float uVignette;
  uniform vec2  uResolution;
  uniform float uFrame;

  void main() {
    vec3 hdr = max(texture(uColor, vUv).rgb, vec3(0.0));
    vec3 bloom = max(texture(uBloom, vUv).rgb, vec3(0.0));

    vec3 c = hdr * uExposure + bloom * uBloomIntensity;
    c = tonemapHuePreserving(c);

    // Vignette is subtle: ART.md wants high-key and low-contrast, and a heavy
    // vignette is a modern-shooter signature that would fail P2.
    vec2 q = vUv - 0.5;
    float v = 1.0 - dot(q, q) * uVignette;
    c *= clamp(v, 0.0, 1.0);

    c = linearToSrgb(clamp(c, 0.0, 1.0));

    // Ordered dither before the 8-bit quantise, otherwise the sky gradient
    // bands visibly — and this sky is one large smooth gradient.
    float dither = (ign(gl_FragCoord.xy + uFrame) - 0.5) / 255.0;
    fragColor = vec4(c + dither, 1.0);
  }
`;

export class CompositePass {
  constructor(exposure) {
    this.uniforms = {
      uColor: { value: null },
      uBloom: { value: null },
      uExposure: { value: exposure },
      uBloomIntensity: { value: 0.075 },
      uVignette: { value: 0.28 },
      uResolution: { value: new THREE.Vector2() },
      uFrame: { value: 0 },
    };
    this.pass = new FullscreenPass(COMPOSITE_FRAG, this.uniforms);
  }

  render(renderer, colorTex, bloomTex, target, frame) {
    this.uniforms.uColor.value = colorTex;
    this.uniforms.uBloom.value = bloomTex;
    this.uniforms.uFrame.value = frame % 64;
    this.pass.render(renderer, target, true);
  }

  dispose() {
    this.pass.dispose();
  }
}
