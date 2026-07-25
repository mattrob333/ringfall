// L2 render — clustered forward+ light assignment. OWNER: `lighting` (S1).
// Frame graph pass 0. 16x8x16 froxels, log-distributed in Z over [near, 200m].
//
// ARCHITECTURE.md §6 originally specified 16x8x24. Reduced to 16x8x16 with the
// far slice absorbing everything past 200 m: at our view distances slices 17-24
// were empty on every shot in the baseline set, so they cost bandwidth and
// bought nothing. Logged as amendment A3.

import * as THREE from 'three';
import {
  CLUSTER_X,
  CLUSTER_Y,
  CLUSTER_Z,
  CLUSTER_FAR,
  MAX_LIGHTS,
  MAX_LIGHT_INDICES,
  LIGHT_TEXELS,
  CLUSTER_TEX_W,
  INDEX_TEX_W,
} from './chunks.js';

const CLUSTER_TOTAL = CLUSTER_X * CLUSTER_Y * CLUSTER_Z;
const MAX_PER_CLUSTER = 64; // matches the loop bound in CHUNK_CLUSTER

const _v = new THREE.Vector3();
const _view = new THREE.Vector3();

export class LightClusters {
  constructor(globals) {
    this.g = globals;
    /** @type {Array<{position:THREE.Vector3, color:THREE.Color, intensity:number, range:number, type:number, dir:THREE.Vector3, cosOuter:number, cosInner:number, enabled:boolean}>} */
    this.lights = [];
    this._buckets = Array.from({ length: CLUSTER_TOTAL }, () => []);
    this._counts = new Int32Array(CLUSTER_TOTAL);
    this._overflow = 0;
    this._indexOverflow = 0;
  }

  addPointLight(position, color, intensity, range) {
    if (this.lights.length >= MAX_LIGHTS) {
      this._overflow++;
      return null;
    }
    const l = {
      position: position.clone(),
      color: color.clone(),
      intensity,
      range,
      type: 0,
      dir: new THREE.Vector3(0, -1, 0),
      cosOuter: -1,
      cosInner: -1,
      enabled: true,
    };
    this.lights.push(l);
    return l;
  }

  addSpotLight(position, dir, color, intensity, range, outerDeg, innerDeg) {
    if (this.lights.length >= MAX_LIGHTS) {
      this._overflow++;
      return null;
    }
    const l = {
      position: position.clone(),
      color: color.clone(),
      intensity,
      range,
      type: 1,
      dir: dir.clone().normalize(),
      cosOuter: Math.cos((outerDeg * Math.PI) / 180),
      cosInner: Math.cos((innerDeg * Math.PI) / 180),
      enabled: true,
    };
    this.lights.push(l);
    return l;
  }

  clear() {
    this.lights.length = 0;
    this._overflow = 0;
  }

  /** Frame graph pass 0. Rebuilds the froxel light lists on the CPU. */
  build(camera) {
    const lights = this.lights;
    const n = lights.length;
    const buckets = this._buckets;
    for (let i = 0; i < CLUSTER_TOTAL; i++) buckets[i].length = 0;

    const near = camera.near;
    const logRatio = Math.log(CLUSTER_FAR / near);
    const proj = camera.projectionMatrix;
    const viewMat = camera.matrixWorldInverse;

    // --- Pack the light parameter texture ---
    const ld = this.g.lightData;
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      const o = i * LIGHT_TEXELS * 4;
      ld[o + 0] = l.position.x;
      ld[o + 1] = l.position.y;
      ld[o + 2] = l.position.z;
      ld[o + 3] = l.range;
      ld[o + 4] = l.color.r;
      ld[o + 5] = l.color.g;
      ld[o + 6] = l.color.b;
      ld[o + 7] = l.enabled ? l.intensity : 0;
      ld[o + 8] = l.dir.x;
      ld[o + 9] = l.dir.y;
      ld[o + 10] = l.dir.z;
      ld[o + 11] = l.cosOuter;
      ld[o + 12] = l.cosInner;
      ld[o + 13] = l.type;
      ld[o + 14] = 0;
      ld[o + 15] = 0;
    }
    this.g.lightsTex.needsUpdate = true;

    // --- Assign lights to froxels ---
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      if (!l.enabled || l.intensity <= 0) continue;
      _view.copy(l.position).applyMatrix4(viewMat);
      const r = l.range;
      const depth = -_view.z;

      if (depth + r < near) continue; // entirely behind the camera

      // Z slice range, log-distributed.
      const dMin = Math.max(near, depth - r);
      const dMax = Math.max(near, Math.min(CLUSTER_FAR, depth + r));
      let z0 = Math.floor((Math.log(dMin / near) / logRatio) * CLUSTER_Z);
      let z1 = Math.floor((Math.log(dMax / near) / logRatio) * CLUSTER_Z);
      if (depth + r >= CLUSTER_FAR) z1 = CLUSTER_Z - 1;
      z0 = Math.max(0, Math.min(CLUSTER_Z - 1, z0));
      z1 = Math.max(0, Math.min(CLUSTER_Z - 1, z1));

      // Conservative screen bounds: project the view-space AABB of the sphere.
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (let c = 0; c < 8; c++) {
        _v.set(
          _view.x + (c & 1 ? r : -r),
          _view.y + (c & 2 ? r : -r),
          _view.z + (c & 4 ? r : -r),
        );
        // Clamp in front of the near plane so the perspective divide stays sane.
        if (-_v.z < near) _v.z = -near;
        _v.applyMatrix4(proj);
        if (_v.x < minX) minX = _v.x;
        if (_v.x > maxX) maxX = _v.x;
        if (_v.y < minY) minY = _v.y;
        if (_v.y > maxY) maxY = _v.y;
      }

      let tx0 = Math.floor(((minX * 0.5 + 0.5) * CLUSTER_X) | 0);
      let tx1 = Math.floor(((maxX * 0.5 + 0.5) * CLUSTER_X) | 0);
      let ty0 = Math.floor(((minY * 0.5 + 0.5) * CLUSTER_Y) | 0);
      let ty1 = Math.floor(((maxY * 0.5 + 0.5) * CLUSTER_Y) | 0);
      tx0 = Math.max(0, Math.min(CLUSTER_X - 1, tx0));
      tx1 = Math.max(0, Math.min(CLUSTER_X - 1, tx1));
      ty0 = Math.max(0, Math.min(CLUSTER_Y - 1, ty0));
      ty1 = Math.max(0, Math.min(CLUSTER_Y - 1, ty1));

      for (let z = z0; z <= z1; z++) {
        for (let y = ty0; y <= ty1; y++) {
          for (let x = tx0; x <= tx1; x++) {
            const ci = z * (CLUSTER_X * CLUSTER_Y) + y * CLUSTER_X + x;
            const b = buckets[ci];
            if (b.length < MAX_PER_CLUSTER) b.push(i);
          }
        }
      }
    }

    // --- Flatten into the cluster + index textures ---
    const cd = this.g.clusterData;
    const id = this.g.indexData;
    let cursor = 0;
    this._indexOverflow = 0;

    for (let z = 0; z < CLUSTER_Z; z++) {
      for (let t = 0; t < CLUSTER_X * CLUSTER_Y; t++) {
        const ci = z * (CLUSTER_X * CLUSTER_Y) + t;
        const b = buckets[ci];
        let count = b.length;
        if (cursor + count > MAX_LIGHT_INDICES) {
          this._indexOverflow += count - Math.max(0, MAX_LIGHT_INDICES - cursor);
          count = Math.max(0, MAX_LIGHT_INDICES - cursor);
        }
        // clusterTex is CLUSTER_TEX_W x CLUSTER_Z, texel (t, z).
        const to = (z * CLUSTER_TEX_W + t) * 4;
        cd[to + 0] = cursor;
        cd[to + 1] = count;
        cd[to + 2] = 0;
        cd[to + 3] = 0;
        for (let k = 0; k < count; k++) {
          const io = ((cursor + k) % INDEX_TEX_W) * 4 + Math.floor((cursor + k) / INDEX_TEX_W) * INDEX_TEX_W * 4;
          id[io] = b[k];
        }
        cursor += count;
      }
    }

    this.g.clusterTex.needsUpdate = true;
    this.g.indexTex.needsUpdate = true;
    this.g.u.uLightCount.value = n;
    this._usedIndices = cursor;
  }

  stats() {
    return {
      lights: this.lights.length,
      usedIndices: this._usedIndices ?? 0,
      lightOverflow: this._overflow,
      indexOverflow: this._indexOverflow,
    };
  }
}
