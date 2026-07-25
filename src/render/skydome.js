// L2 render — frame graph pass 6: sky dome, sun disc, cloud layers.
// OWNER: `lighting` (S1). Uses the SAME skyRadiance() as the fog inscatter.

import * as THREE from 'three';
import { FULLSCREEN_VERT } from './fullscreen.js';
import { CHUNK_COMMON, CHUNK_GLOBALS, CHUNK_SKY } from './chunks.js';

const SKY_FRAG = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}
  ${CHUNK_GLOBALS}
  ${CHUNK_SKY}

  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  uniform mat4  uInvViewProj;
  uniform float uCloudCoverage;
  uniform float uCloudDensity;
  uniform vec3  uCloudTint;

  // Value noise on a 2D plane. Cloud features are hundreds of metres across, so
  // this never approaches ART.md §2's 4 cycles/m ceiling.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1, 0));
    float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm3(vec2 p) {
    return vnoise(p) * 0.55 + vnoise(p * 2.03) * 0.30 + vnoise(p * 4.01) * 0.15;
  }

  // Project the view ray onto a flat cloud slab at height h.
  float cloudLayer(vec3 dir, float h, float scale, vec2 drift, float coverage) {
    if (dir.y <= 0.012) return 0.0;
    vec2 uv = dir.xz / dir.y * h * scale + drift;
    float n = fbm3(uv);
    float c = smoothstep(coverage, coverage + 0.30, n);
    // Fade the slab out toward the horizon so it does not form a hard band.
    return c * smoothstep(0.012, 0.14, dir.y);
  }

  void main() {
    vec4 nd = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 wp = uInvViewProj * nd;
    vec3 dir = normalize(wp.xyz / wp.w - uCameraPos);

    vec3 col = skyRadiance(dir);

    // Clouds sit between the sky gradient and the sun, so the sun still burns
    // through their edges. Two layers at different heights give parallax.
    float c1 = cloudLayer(dir, 1.0,  0.55, vec2(uTime * 0.0016, uTime * 0.0009), 1.0 - uCloudCoverage);
    float c2 = cloudLayer(dir, 1.85, 0.31, vec2(uTime * 0.0009, -uTime * 0.0006), 1.0 - uCloudCoverage * 0.75);
    float cloud = clamp(c1 * 0.75 + c2 * 0.55, 0.0, 1.0) * uCloudDensity;

    float sunFacing = pow(max(dot(dir, uSunDir), 0.0), 3.0);
    vec3 cloudCol = uCloudTint * mix(0.78, 1.55, sunFacing);
    col = mix(col, cloudCol * (uSkyMid + uSunColor * 0.10), cloud);

    // Sun disc last, and only where clouds are thin.
    float disc = sunDiscMask(dir) * (1.0 - cloud * 0.85);
    col += uSunColor * disc * 42.0;

    fragColor = vec4(col, 1.0);
  }
`;

export class SkyDome {
  constructor(globals) {
    this.g = globals;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

    this.uniforms = Object.assign({}, globals.u, {
      uInvViewProj: { value: new THREE.Matrix4() },
      uCloudCoverage: { value: 0.42 },
      uCloudDensity: { value: 0.72 },
      uCloudTint: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
    });

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT.replace(
        'gl_Position = vec4(position.xy, 0.0, 1.0);',
        // z = w = 1 puts the sky at the far plane, so a LEQUAL test draws it
        // only where nothing else was written. No dome mesh needed.
        'gl_Position = vec4(position.xy, 1.0, 1.0);',
      ),
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      depthTest: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._invVP = new THREE.Matrix4();
  }

  render(renderer, camera, target) {
    this._invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    this.uniforms.uInvViewProj.value.copy(this._invVP);

    const prev = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.render(this.scene, this._camera);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.material.dispose();
  }
}
