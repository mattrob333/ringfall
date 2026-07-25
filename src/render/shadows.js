// L2 render — cascaded shadow maps. OWNER: `lighting` (S1).
// Frame graph pass 1. 4 cascades at 12/32/90/260 m in one 2x2 atlas.

import * as THREE from 'three';

const CASCADE_SPLITS = [12, 32, 90, 260];
const ATLAS_SIZE = 4096;
const TILE = ATLAS_SIZE / 2;

const _frustumCorners = Array.from({ length: 8 }, () => new THREE.Vector3());
const _center = new THREE.Vector3();
const _lightPos = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _altUp = new THREE.Vector3(0, 0, 1);
const _invView = new THREE.Matrix4();
const _tmp = new THREE.Vector3();

export class ShadowCascades {
  constructor(globals) {
    this.g = globals;
    this.splits = CASCADE_SPLITS.slice();
    this.cameras = Array.from({ length: 4 }, () => {
      const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
      c.matrixAutoUpdate = false;
      return c;
    });

    const depthTexture = new THREE.DepthTexture(ATLAS_SIZE, ATLAS_SIZE);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.compareFunction = null;

    this.target = new THREE.WebGLRenderTarget(ATLAS_SIZE, ATLAS_SIZE, {
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    // Colour attachment is unused; we render depth only.
    this.target.texture.minFilter = THREE.NearestFilter;
    this.target.texture.magFilter = THREE.NearestFilter;

    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.BasicDepthPacking,
      side: THREE.FrontSide,
    });
    this.depthMaterial.colorWrite = false;

    this.g.u.uShadowAtlas.value = depthTexture;
    this.g.u.uShadowSplits.value.set(...this.splits);
    this.g.u.uShadowTexel.value.set(1 / ATLAS_SIZE, 1 / ATLAS_SIZE);
  }

  /**
   * Fit each cascade's ortho box to the camera sub-frustum, then snap the box
   * centre to a shadow-texel grid. Without the snap the shadow edges crawl
   * every time the camera moves a sub-texel amount, which reads as shimmer and
   * is the single most common CSM defect.
   */
  updateCascades(camera, sunDir) {
    const near = camera.near;
    _invView.copy(camera.matrixWorld);

    for (let i = 0; i < 4; i++) {
      const n = i === 0 ? near : this.splits[i - 1];
      const f = this.splits[i];

      // Sub-frustum corners in world space.
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const tanH = tanV * camera.aspect;
      let k = 0;
      for (const d of [n, f]) {
        const hh = tanV * d;
        const hw = tanH * d;
        for (const sy of [-1, 1]) {
          for (const sx of [-1, 1]) {
            _frustumCorners[k++].set(sx * hw, sy * hh, -d).applyMatrix4(_invView);
          }
        }
      }

      _center.set(0, 0, 0);
      for (let c = 0; c < 8; c++) _center.add(_frustumCorners[c]);
      _center.multiplyScalar(1 / 8);

      // Bounding sphere radius is view-rotation invariant, which is the other
      // half of eliminating shimmer: the ortho box size must never change.
      let radius = 0;
      for (let c = 0; c < 8; c++) radius = Math.max(radius, _frustumCorners[c].distanceTo(_center));
      radius = Math.ceil(radius * 16) / 16;

      const texelsPerUnit = TILE / (radius * 2);
      const cam = this.cameras[i];

      // Build the light basis first so we can snap in light space.
      const up = Math.abs(sunDir.y) > 0.99 ? _altUp : _up;
      _lightPos.copy(_center).addScaledVector(sunDir, radius * 2.2);
      cam.position.copy(_lightPos);
      cam.up.copy(up);
      cam.lookAt(_center);
      cam.updateMatrix();
      cam.updateMatrixWorld(true);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

      // Snap the centre to the texel grid in light space.
      _tmp.copy(_center).applyMatrix4(cam.matrixWorldInverse);
      _tmp.x = Math.floor(_tmp.x * texelsPerUnit) / texelsPerUnit;
      _tmp.y = Math.floor(_tmp.y * texelsPerUnit) / texelsPerUnit;
      _tmp.applyMatrix4(cam.matrixWorld);
      _lightPos.copy(_tmp).addScaledVector(sunDir, radius * 2.2);
      cam.position.copy(_lightPos);
      cam.lookAt(_tmp);
      cam.updateMatrix();
      cam.updateMatrixWorld(true);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

      cam.left = -radius;
      cam.right = radius;
      cam.top = radius;
      cam.bottom = -radius;
      cam.near = 0.1;
      cam.far = radius * 4.4 + 50;
      cam.updateProjectionMatrix();

      this.g.u.uShadowMat.value[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

      // The shader biases in world units; give it the real numbers rather than
      // letting it guess from the split distances.
      const texelWorld = (radius * 2) / TILE;
      const depthScale = 1 / (cam.far - cam.near);
      const comp = ['x', 'y', 'z', 'w'][i];
      this.g.u.uShadowTexelWorld.value[comp] = texelWorld;
      this.g.u.uShadowDepthScale.value[comp] = depthScale;
    }
  }

  /** Frame graph pass 1. Renders depth-only into the 2x2 atlas. */
  render(renderer, scene, camera, sunDir) {
    this.updateCascades(camera, sunDir);

    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAutoClear = renderer.autoClear;

    renderer.setRenderTarget(this.target);
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.clear(true, true, false);

    scene.overrideMaterial = this.depthMaterial;
    for (let i = 0; i < 4; i++) {
      const x = (i & 1) * TILE;
      const y = (i >> 1) * TILE;
      renderer.setViewport(x, y, TILE, TILE);
      renderer.setScissor(x, y, TILE, TILE);
      renderer.setScissorTest(true);
      renderer.render(scene, this.cameras[i]);
    }

    scene.overrideMaterial = prevOverride;
    renderer.setScissorTest(false);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  }

  dispose() {
    this.target.dispose();
    this.depthMaterial.dispose();
  }
}
