// L4 fx — bullet-impact decal pool. One instanced draw, hard cap, oldest-out.
//
// These are ORIENTED quads offset 1.2 cm along the surface normal, not true
// projected decal boxes. A projected box needs to read the scene depth buffer,
// and in ARCHITECTURE.md §6 the pass-8 colour target shares its depth
// attachment with the prepass depth texture — sampling it while it is attached
// is a framebuffer feedback loop. See src/fx/README.md "Limitations".
//
// Same allocation contract as the particle pool: everything is allocated at cap
// in the constructor, update() allocates nothing, and there is no per-decal
// object anywhere.

import * as THREE from 'three';
import {
  DECAL_CAP,
  D_STRIDE,
  D_PX, D_PY, D_PZ, D_NX, D_NY, D_NZ,
  D_SIZE, D_ROT, D_PATTERN, D_AGE, D_LIFE,
  D_R, D_G, D_B, D_ALPHA, D_BIRTH,
} from './constants.js';
import { DECAL_VERT, DECAL_FRAG } from './shaders.js';
import { LAYER_TRANSPARENT } from '../render/index.js';

export class DecalPool {
  constructor(cap = DECAL_CAP) {
    this.cap = cap;
    this.count = 0;
    this._stamp = 0;
    this._ranges = [
      { start: 0, count: 0 },
      { start: 0, count: 0 },
      { start: 0, count: 0 },
      { start: 0, count: 0 },
    ];
    this.replaced = 0; // how many times oldest-out actually fired
    this.peak = 0;

    this.data = new Float32Array(cap * D_STRIDE);

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aNormal = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aPos, this.aNormal, this.aParams, this.aColor]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }

    const g = new THREE.InstancedBufferGeometry();
    const pos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    g.setAttribute('dPos', this.aPos);
    g.setAttribute('dNormal', this.aNormal);
    g.setAttribute('dParams', this.aParams);
    g.setAttribute('dColor', this.aColor);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: {},
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, // premultiplied
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(LAYER_TRANSPARENT);
    this.mesh.renderOrder = 10; // under both particle pools
    this.mesh.name = 'fx.decals';
  }

  /**
   * @returns {number} the slot used
   */
  add(px, py, pz, nx, ny, nz, size, rot, pattern, life, r, g, b, alpha) {
    let slot;
    if (this.count < this.cap) {
      slot = this.count++;
      if (this.count > this.peak) this.peak = this.count;
    } else {
      // Oldest-out. Exact, by birth stamp — a 256-entry scan that only runs
      // once the pool is genuinely saturated.
      let oldest = 0;
      let oldestStamp = Infinity;
      const d = this.data;
      for (let i = 0; i < this.cap; i++) {
        const s = d[i * D_STRIDE + D_BIRTH];
        if (s < oldestStamp) {
          oldestStamp = s;
          oldest = i;
        }
      }
      slot = oldest;
      this.replaced++;
    }

    const o = slot * D_STRIDE;
    const d = this.data;
    d[o + D_PX] = px; d[o + D_PY] = py; d[o + D_PZ] = pz;
    // Normalise here so the vertex shader never sees a zero-length basis.
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-5) {
      d[o + D_NX] = nx / len; d[o + D_NY] = ny / len; d[o + D_NZ] = nz / len;
    } else {
      d[o + D_NX] = 0; d[o + D_NY] = 1; d[o + D_NZ] = 0;
    }
    d[o + D_SIZE] = size;
    d[o + D_ROT] = rot;
    d[o + D_PATTERN] = pattern;
    d[o + D_AGE] = 0;
    d[o + D_LIFE] = life;
    d[o + D_R] = r; d[o + D_G] = g; d[o + D_B] = b;
    d[o + D_ALPHA] = alpha;
    d[o + D_BIRTH] = this._stamp++;
    return slot;
  }

  update(dt) {
    const d = this.data;
    let n = this.count;
    for (let i = 0; i < n; ) {
      const o = i * D_STRIDE;
      const age = d[o + D_AGE] + dt;
      if (age >= d[o + D_LIFE]) {
        n--;
        if (i !== n) {
          const s = n * D_STRIDE;
          for (let k = 0; k < D_STRIDE; k++) d[o + k] = d[s + k];
        }
        continue;
      }
      d[o + D_AGE] = age;
      i++;
    }
    this.count = n;

    const ap = this.aPos.array;
    const an = this.aNormal.array;
    const apar = this.aParams.array;
    const acol = this.aColor.array;

    for (let i = 0; i < n; i++) {
      const o = i * D_STRIDE;
      const i3 = i * 3;
      const i4 = i * 4;
      ap[i3] = d[o + D_PX]; ap[i3 + 1] = d[o + D_PY]; ap[i3 + 2] = d[o + D_PZ];
      an[i3] = d[o + D_NX]; an[i3 + 1] = d[o + D_NY]; an[i3 + 2] = d[o + D_NZ];
      apar[i4] = d[o + D_SIZE];
      apar[i4 + 1] = d[o + D_ROT];
      apar[i4 + 2] = d[o + D_PATTERN];
      // Seed derives from the birth stamp so a decal's outline is stable for
      // its whole life and deterministic across runs.
      apar[i4 + 3] = (d[o + D_BIRTH] * 0.6180339887) % 1;

      // Fade only over the last 20% of life — a decal that fades from birth
      // reads as a dirty lens, not as damage.
      const t = d[o + D_AGE] / d[o + D_LIFE];
      const fade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      acol[i4] = d[o + D_R]; acol[i4 + 1] = d[o + D_G]; acol[i4 + 2] = d[o + D_B];
      acol[i4 + 3] = d[o + D_ALPHA] * fade;
    }

    this.geometry.instanceCount = n;
    this._flush(this.aPos, 0, n * 3);
    this._flush(this.aNormal, 1, n * 3);
    this._flush(this.aParams, 2, n * 4);
    this._flush(this.aColor, 3, n * 4);
  }

  /** See the note on ParticlePool._flush() — cached ranges, zero allocation. */
  _flush(attr, slot, len) {
    if (len === 0) {
      attr.needsUpdate = false;
      return;
    }
    const r = this._ranges[slot];
    r.start = 0;
    r.count = len;
    // Only re-push when WebGLAttributes cleared the list after its upload.
    // `length = 0` followed by `push` every frame makes V8 shrink and then
    // regrow the backing store — measured at 156 bytes of garbage per call.
    const ur = attr.updateRanges;
    if (ur.length !== 1 || ur[0] !== r) {
      ur.length = 0;
      ur.push(r);
    }
    attr.needsUpdate = true;
  }

  hasNaN() {
    const end = this.count * D_STRIDE;
    for (let i = 0; i < end; i++) if (!Number.isFinite(this.data[i])) return true;
    const n = this.count;
    const check = (arr, len) => {
      for (let i = 0; i < len; i++) if (!Number.isFinite(arr[i])) return true;
      return false;
    };
    return (
      check(this.aPos.array, n * 3) ||
      check(this.aNormal.array, n * 3) ||
      check(this.aParams.array, n * 4) ||
      check(this.aColor.array, n * 4)
    );
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
