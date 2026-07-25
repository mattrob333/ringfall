// L2 render — public API and the frame graph. OWNER: `lighting` (S1).
// ARCHITECTURE.md §6 defines the pass order; this file is that table in code.

import * as THREE from 'three';
import { GlobalUniforms } from './globals.js';
import { SkyModel } from './sky.js';
import { ShadowCascades } from './shadows.js';
import { LightClusters } from './clusters.js';
import { Prepass } from './prepass.js';
import { SkyDome } from './skydome.js';
import { GtaoPass, TaaPass, BloomPass, CompositePass } from './passes.js';
import { makeTarget } from './fullscreen.js';
import { exposureFor } from './exposure.js';
import { JITTER_TABLE } from '../shared/math.js';

export const LAYER_WORLD = 0; // opaque, casts shadows
export const LAYER_TRANSPARENT = 1; // particles, no shadow, no prepass
export const LAYER_VIEWMODEL = 2; // rendered with the narrow view-model FOV
// Opaque but NON shadow casting. The megastructure lives here: it is 12-24 km
// away, and letting it into the shadow cascades would have it shadow the entire
// playable area from orbit.
export const LAYER_SKYBOX = 3;

export { LightClusters } from './clusters.js';
export { GlobalUniforms } from './globals.js';

export class RingfallRenderer {
  constructor(canvas, { dpr = Math.min(window.devicePixelRatio || 1, 2), levelKey = 'default' } = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // TAA does the AA; MSAA on an HDR target is wasted bandwidth
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: true, // required by tools/baseline.mjs readback
    });
    this.renderer.autoClear = false;
    // info.autoReset defaults to true, which zeroes the counters at the START
    // of every render() call. A frame issues ~10 render() calls (4 shadow
    // cascades, prepass, opaque, sky, view model, transparent, then the post
    // chain), so the reported draw count was only ever the LAST one — measured
    // as "draws 1, tris 1" in playtest. We reset once per frame instead.
    this.renderer.info.autoReset = false;
    // The composite pass encodes sRGB itself, so the renderer must NOT convert
    // again. LinearSRGBColorSpace is the pass-through setting; NoColorSpace is
    // not a legal value here in r185.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // ours is in the composite pass
    this.renderer.shadowMap.enabled = false; // we run our own CSM

    this.scene = new THREE.Scene();
    this.globals = new GlobalUniforms();
    this.globals.u.uExposure.value = exposureFor(levelKey);
    this.sky = new SkyModel(this.globals);
    this.sky.projectSH();

    this.shadows = new ShadowCascades(this.globals);
    this.clusters = new LightClusters(this.globals);
    this.skyDome = new SkyDome(this.globals);

    this.taaEnabled = true;
    this.gtaoEnabled = true;
    this._frame = 0;
    this._jitter = new THREE.Vector2();
    this._unjitteredProj = new THREE.Matrix4();

    this.stats = { drawCalls: 0, triangles: 0, programs: 0, lastProgramCount: 0, compilesThisFrame: 0 };

    this.dpr = dpr;
    this._w = 1;
    this._h = 1;
    this.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, dpr);
  }

  setSize(width, height, dpr = this.dpr) {
    this.dpr = dpr;
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;

    this.renderer.setPixelRatio(1); // we size the drawing buffer ourselves
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;

    this.globals.setResolution(w, h);

    this.prepass?.dispose();
    this.prepass = new Prepass(w, h);

    this.hdr?.dispose();
    this.hdr = makeTarget(w, h, {
      type: THREE.HalfFloatType,
      depthTexture: this.prepass.depthTex,
      depthBuffer: true,
    });

    this.gtao?.dispose();
    this.gtao = new GtaoPass(w, h);

    this.taa?.dispose();
    this.taa = new TaaPass(w, h);

    this.bloom?.dispose();
    this.bloom = new BloomPass(w, h, this.globals.u.uExposure.value);

    if (!this.composite) this.composite = new CompositePass(this.globals.u.uExposure.value);
    this.composite.uniforms.uResolution.value.set(w, h);
    this.composite.uniforms.uExposure.value = this.globals.u.uExposure.value;
  }

  /** Pre-warm every program so G6 (zero shader compiles during play) can hold. */
  async prewarm(camera) {
    this.renderer.compile(this.scene, camera);
    this.renderer.compile(this.skyDome.scene, camera);
    // Fullscreen passes compile on first use; force one throwaway frame of each.
    const w = this._w,
      h = this._h;
    this.gtao.render(this.renderer, this.prepass.depthTex, this.prepass.normalTex, camera, 0);
    this.taa.render(this.renderer, this.hdr.texture, this.prepass.velocityTex, this.prepass.depthTex);
    this.taa.reset();
    this.bloom.render(this.renderer, this.hdr.texture, w, h);
    this.composite.render(this.renderer, this.hdr.texture, this.bloom.chain[0].texture, null, 0);
    this.stats.lastProgramCount = this.renderer.info.programs?.length ?? 0;
  }

  /** Apply the 8-phase Halton jitter to a camera's projection matrix. */
  _applyJitter(camera) {
    this._unjitteredProj.copy(camera.projectionMatrix);
    if (!this.taaEnabled) {
      this._jitter.set(0, 0);
      return;
    }
    const [jx, jy] = JITTER_TABLE[this._frame % JITTER_TABLE.length];
    this._jitter.set((jx * 2) / this._w, (jy * 2) / this._h);
    camera.projectionMatrix.elements[8] += this._jitter.x;
    camera.projectionMatrix.elements[9] += this._jitter.y;
  }

  _removeJitter(camera) {
    camera.projectionMatrix.copy(this._unjitteredProj);
  }

  /**
   * One frame, in ARCHITECTURE.md §6 order.
   * @param {THREE.PerspectiveCamera} camera world camera
   * @param {THREE.PerspectiveCamera} vmCamera view-model camera (same transform, narrower FOV)
   * @param {number} time seconds, engine clock only
   */
  render(camera, vmCamera, time) {
    const r = this.renderer;
    const g = this.globals;
    const programsBefore = r.info.programs?.length ?? 0;

    r.info.reset();
    g.u.uTime.value = time;
    g.setCamera(camera);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    if (vmCamera) {
      vmCamera.updateMatrixWorld();
      vmCamera.matrixWorldInverse.copy(vmCamera.matrixWorld).invert();
    }

    // Pass 0 — light clustering
    this.clusters.build(camera);

    // Pass 1 — shadow cascades. The cascade cameras keep their default layer
    // mask (layer 0 only), so LAYER_SKYBOX geometry never reaches them.
    this.shadows.render(r, this.scene, camera, this.sky.sunDir);

    // Jitter for passes 2 and 5 so the prepass depth and the shaded depth agree.
    this._applyJitter(camera);
    if (vmCamera) {
      this._vmUnjitteredProj ??= new THREE.Matrix4();
      this._vmUnjitteredProj.copy(vmCamera.projectionMatrix);
      vmCamera.projectionMatrix.elements[8] += this._jitter.x;
      vmCamera.projectionMatrix.elements[9] += this._jitter.y;
    }

    // Pass 2 — depth + normal + velocity prepass
    camera.layers.set(LAYER_WORLD);
    camera.layers.enable(LAYER_SKYBOX);
    this.prepass.render(r, this.scene, camera, this._unjitteredProj, true);
    if (vmCamera) {
      vmCamera.layers.set(LAYER_VIEWMODEL);
      this.prepass.render(r, this.scene, vmCamera, this._vmUnjitteredProj, false);
    }

    // Pass 3 — GTAO
    if (this.gtaoEnabled) {
      g.u.uAOTex.value = this.gtao.render(
        r,
        this.prepass.depthTex,
        this.prepass.normalTex,
        camera,
        this._frame,
      );
      g.u.uAOEnabled.value = 1;
    } else {
      g.u.uAOEnabled.value = 0;
    }

    // Pass 5 — opaque forward+ (depth already populated: LEQUAL, no depth write)
    r.setRenderTarget(this.hdr);
    r.clear(true, false, false); // colour only — keep the prepass depth
    camera.layers.set(LAYER_WORLD);
    camera.layers.enable(LAYER_SKYBOX);
    r.render(this.scene, camera);

    // Pass 6 — sky dome at the far plane
    this.skyDome.render(r, camera, this.hdr);

    // View model, with its own narrower FOV, after the sky so it composites over it.
    if (vmCamera) {
      vmCamera.layers.set(LAYER_VIEWMODEL);
      r.setRenderTarget(this.hdr);
      r.render(this.scene, vmCamera);
    }

    // Pass 8 — transparent and particles
    camera.layers.set(LAYER_TRANSPARENT);
    r.setRenderTarget(this.hdr);
    r.render(this.scene, camera);
    camera.layers.set(LAYER_WORLD);

    this._removeJitter(camera);
    if (vmCamera) vmCamera.projectionMatrix.copy(this._vmUnjitteredProj);

    // Pass 9 — TAA
    let resolved = this.hdr.texture;
    if (this.taaEnabled) {
      this.taa.updateSkyReprojection(camera, this._unjitteredProj);
      resolved = this.taa.render(r, this.hdr.texture, this.prepass.velocityTex, this.prepass.depthTex);
    }

    // Pass 10 — bloom
    const bloomTex = this.bloom.render(r, resolved, this._w, this._h);

    // Pass 11 — composite to the default framebuffer
    this.composite.render(r, resolved, bloomTex, null, this._frame);

    // Pass 12 (UI) lives on its own 2D canvas — src/ui owns it.

    this.prepass.endFrame(this.scene);
    this._frame++;

    const programsAfter = r.info.programs?.length ?? 0;
    this.stats.compilesThisFrame = programsAfter - programsBefore;
    this.stats.programs = programsAfter;
    this.stats.drawCalls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
  }

  dispose() {
    this.shadows.dispose();
    this.prepass.dispose();
    this.gtao.dispose();
    this.taa.dispose();
    this.bloom.dispose();
    this.composite.dispose();
    this.skyDome.dispose();
    this.hdr.dispose();
    this.globals.dispose();
    this.renderer.dispose();
  }
}
