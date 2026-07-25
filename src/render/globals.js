// L2 render — the global uniform block. ONE object, shared BY REFERENCE with
// every material so a single write updates the whole frame. Never clone these.

import * as THREE from 'three';
import { exposureFor, SUN_INTENSITY, GROUND_BOUNCE } from './exposure.js';
import { SKY } from '../shared/palette.js';
import { hexToLinear } from '../shared/palette.js';
import { MAX_LIGHTS, LIGHT_TEXELS, CLUSTER_TEX_W, CLUSTER_TEX_H, INDEX_TEX_W, INDEX_TEX_H } from './chunks.js';

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class GlobalUniforms {
  constructor() {
    const zenith = hexToLinear(SKY.zenith);
    const mid = hexToLinear(SKY.mid);
    const horizon = hexToLinear(SKY.horizon);
    const horizonSun = hexToLinear(SKY.horizonSun);
    const sunCol = hexToLinear(SKY.sunDisc);

    this.u = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: v3(sunCol).multiplyScalar(SUN_INTENSITY) },
      uSunAngularRadius: { value: (SKY.sunAngularDiameterDeg * 0.5 * Math.PI) / 180 },
      uSkyZenith: { value: v3(zenith) },
      uSkyMid: { value: v3(mid) },
      uSkyHorizon: { value: v3(horizon) },
      uSkyHorizonSun: { value: v3(horizonSun) },
      uGroundHaze: { value: v3(horizon).multiplyScalar(0.42) },
      uSkySH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
      uGroundBounce: { value: new THREE.Vector3() },
      // x density, y heightFalloff, z strength, w baseHeight.
      // With a 15 m clear-air onset, density 0.005675 gives:
      //    60 m  -> 22.6%   (ART.md P5 floor 22%)
      //   200 m  -> 65.0%   (floor 65%)
      //   500 m  -> 93.6%   (floor 92%)
      //    20 m  ->  2.8%   (was 9.9% with no onset — this is the contrast win)
      // Verified by tools/palette.mjs, not assumed.
      uFog: { value: new THREE.Vector4(0.005675, 0.0085, 1.0, 0.0) },
      uFogStart: { value: 15.0 },
      uCameraPos: { value: new THREE.Vector3() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNearFar: { value: new THREE.Vector2(0.05, 4000) },
      uTime: { value: 0 },
      uExposure: { value: exposureFor('default') },

      uShadowAtlas: { value: null },
      uShadowMat: { value: Array.from({ length: 4 }, () => new THREE.Matrix4()) },
      uShadowSplits: { value: new THREE.Vector4(12, 32, 90, 260) },
      uShadowTexel: { value: new THREE.Vector2(1 / 4096, 1 / 4096) },
      uShadowTexelWorld: { value: new THREE.Vector4(0.012, 0.032, 0.09, 0.26) },
      uShadowDepthScale: { value: new THREE.Vector4(1, 1, 1, 1) },
      uShadowNormalBias: { value: 1.4 },
      uShadowDepthBias: { value: 0.035 }, // world units

      uLightsTex: { value: null },
      uClusterTex: { value: null },
      uLightIndexTex: { value: null },
      uLightCount: { value: 0 },

      uAOTex: { value: null },
      uAOEnabled: { value: 1 },
    };

    this._initLightTextures();
  }

  _initLightTextures() {
    const lightData = new Float32Array(MAX_LIGHTS * LIGHT_TEXELS * 4);
    this.lightsTex = new THREE.DataTexture(
      lightData,
      MAX_LIGHTS * LIGHT_TEXELS,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.lightsTex.needsUpdate = true;
    this.lightsTex.minFilter = THREE.NearestFilter;
    this.lightsTex.magFilter = THREE.NearestFilter;
    this.lightsTex.generateMipmaps = false;

    const clusterData = new Float32Array(CLUSTER_TEX_W * CLUSTER_TEX_H * 4);
    this.clusterTex = new THREE.DataTexture(
      clusterData,
      CLUSTER_TEX_W,
      CLUSTER_TEX_H,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.clusterTex.needsUpdate = true;
    this.clusterTex.minFilter = THREE.NearestFilter;
    this.clusterTex.magFilter = THREE.NearestFilter;
    this.clusterTex.generateMipmaps = false;

    const indexData = new Float32Array(INDEX_TEX_W * INDEX_TEX_H * 4);
    this.indexTex = new THREE.DataTexture(
      indexData,
      INDEX_TEX_W,
      INDEX_TEX_H,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.indexTex.needsUpdate = true;
    this.indexTex.minFilter = THREE.NearestFilter;
    this.indexTex.magFilter = THREE.NearestFilter;
    this.indexTex.generateMipmaps = false;

    this.u.uLightsTex.value = this.lightsTex;
    this.u.uClusterTex.value = this.clusterTex;
    this.u.uLightIndexTex.value = this.indexTex;

    this.lightData = lightData;
    this.clusterData = clusterData;
    this.indexData = indexData;
  }

  setCamera(camera) {
    camera.getWorldPosition(this.u.uCameraPos.value);
    this.u.uNearFar.value.set(camera.near, camera.far);
  }

  setResolution(w, h) {
    this.u.uResolution.value.set(w, h);
  }

  dispose() {
    this.lightsTex.dispose();
    this.clusterTex.dispose();
    this.indexTex.dispose();
  }
}
