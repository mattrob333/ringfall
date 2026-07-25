// L2 render — fullscreen triangle helper. One geometry, reused by every pass.

import * as THREE from 'three';

// A single oversized triangle beats a quad: no diagonal seam, one fewer vertex,
// and the rasteriser does not run the fragment shader twice along the diagonal.
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FULLSCREEN_VERT = /* glsl */ `
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class FullscreenPass {
  /**
   * @param {string} fragmentShader must declare `layout(location = 0) out vec4 fragColor;`
   * @param {object} uniforms shared by reference
   * @param {object} defines
   */
  constructor(fragmentShader, uniforms, defines = {}, blending = THREE.NoBlending) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      blending,
      transparent: blending !== THREE.NoBlending,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  get uniforms() {
    return this.material.uniforms;
  }

  render(renderer, target = null, clear = false) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    if (clear) renderer.clear(true, false, false);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.material.dispose();
  }
}

export function makeTarget(w, h, opts = {}) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: opts.type ?? THREE.HalfFloatType,
    format: opts.format ?? THREE.RGBAFormat,
    minFilter: opts.minFilter ?? THREE.LinearFilter,
    magFilter: opts.magFilter ?? THREE.LinearFilter,
    depthBuffer: opts.depthBuffer ?? !!opts.depthTexture,
    depthTexture: opts.depthTexture ?? null,
    stencilBuffer: false,
    generateMipmaps: false,
    count: opts.count ?? 1,
    colorSpace: THREE.NoColorSpace,
  });
  t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
  if (t.textures) {
    for (const tex of t.textures) {
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
    }
  }
  return t;
}
