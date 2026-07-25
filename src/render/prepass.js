// L2 render — frame graph pass 2: depth + normal + velocity.
// OWNER: `lighting` (S1). Feeds GTAO (pass 3) and TAA (pass 9).

import * as THREE from 'three';
import { makeTarget } from './fullscreen.js';
import { CHUNK_COMMON } from './chunks.js';

const VERT = /* glsl */ `
  uniform mat4 uPrevModel;
  uniform mat4 uPrevViewProj;   // UNJITTERED
  uniform mat4 uCurrViewProj;   // UNJITTERED

  out vec3 vNormalW;
  out vec4 vClipCurr;
  out vec4 vClipPrev;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);

    // Velocity is computed from UNJITTERED clip positions on both ends, so the
    // TAA jitter never leaks into the motion vectors. gl_Position uses the
    // camera's own (jittered) projection matrix, which is what actually shades.
    vClipCurr = uCurrViewProj * worldPos;
    vClipPrev = uPrevViewProj * uPrevModel * vec4(position, 1.0);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  ${CHUNK_COMMON}

  in vec3 vNormalW;
  in vec4 vClipCurr;
  in vec4 vClipPrev;

  layout(location = 0) out vec4 gNormal;
  layout(location = 1) out vec4 gVelocity;

  void main() {
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    gNormal = vec4(octEncode(N), 0.0, 1.0);

    vec2 curr = vClipCurr.xy / max(vClipCurr.w, 1e-6);
    vec2 prev = vClipPrev.xy / max(vClipPrev.w, 1e-6);
    // Screen-space motion in UV units, current -> previous.
    gVelocity = vec4((curr - prev) * 0.5, 0.0, 1.0);
  }
`;

export class Prepass {
  constructor(width, height) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPrevModel: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uCurrViewProj: { value: new THREE.Matrix4() },
      },
      side: THREE.FrontSide,
    });

    this.prevViewProj = new THREE.Matrix4();
    this._currViewProj = new THREE.Matrix4();
    this.resize(width, height);
  }

  resize(width, height) {
    if (this.target) this.target.dispose();
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.type = THREE.FloatType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    this.target = makeTarget(width, height, {
      count: 2,
      type: THREE.HalfFloatType,
      depthTexture,
      depthBuffer: true,
    });

    this.normalTex = this.target.textures[0];
    this.velocityTex = this.target.textures[1];
    this.depthTex = depthTexture;
    this.normalTex.minFilter = this.normalTex.magFilter = THREE.NearestFilter;
    this.velocityTex.minFilter = this.velocityTex.magFilter = THREE.NearestFilter;
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Matrix4} unjitteredProj the camera projection WITHOUT TAA jitter
   * @param {boolean} clear
   */
  render(renderer, scene, camera, unjitteredProj, clear = true) {
    this._currViewProj.multiplyMatrices(unjitteredProj, camera.matrixWorldInverse);
    this.material.uniforms.uCurrViewProj.value.copy(this._currViewProj);
    this.material.uniforms.uPrevViewProj.value.copy(this.prevViewProj);

    // Every object writes its own previous world matrix. Static objects have
    // prevMatrixWorld === matrixWorld, so this stays correct without a second
    // material variant, at the cost of one small uniform upload per draw.
    const mat = this.material;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.prevMatrixWorld) o.userData.prevMatrixWorld = o.matrixWorld.clone();
      o.onBeforeRender = onBeforeRenderPrepass;
      o.userData._prepassMat = mat;
    });

    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    scene.overrideMaterial = mat;
    renderer.setRenderTarget(this.target);
    if (clear) renderer.clear(true, true, false);
    renderer.render(scene, camera);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);

    scene.traverse((o) => {
      if (o.isMesh) o.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
    });
  }

  /** Call once per frame AFTER all passes that need the previous matrices. */
  endFrame(scene) {
    this.prevViewProj.copy(this._currViewProj);
    scene.traverse((o) => {
      if (o.isMesh && o.userData.prevMatrixWorld) o.userData.prevMatrixWorld.copy(o.matrixWorld);
    });
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}

function onBeforeRenderPrepass(renderer, scene, camera, geometry, material) {
  if (material.uniforms?.uPrevModel) {
    material.uniforms.uPrevModel.value.copy(this.userData.prevMatrixWorld ?? this.matrixWorld);
    material.uniformsNeedUpdate = true;
  }
}
