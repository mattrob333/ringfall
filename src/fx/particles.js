// L4 fx — THE pooled particle system. Two draws, one CPU simulation.
//
// Allocation contract (this is the load-bearing part of the file):
//   * Every buffer is allocated once, in the constructor, at full cap.
//   * update() allocates NOTHING. No closures, no temporaries, no `{}`, no
//     array literals, no Vector3. Every scratch value is a local number.
//   * spawn() takes a long positional argument list rather than an options
//     object precisely so that the hot path never builds a descriptor.
//   * Dead particles are removed by swap-with-last, so the active set is always
//     the dense range [0, count) and the instance upload is one contiguous
//     sub-range of the typed array.
//
// The alpha pool is depth sorted on the CPU because premultiplied "over"
// blending is order dependent. The sort is an insertion sort over a persistent
// index array: frame-to-frame the order barely changes, so it runs at close to
// O(n) and never allocates.

import * as THREE from 'three';
import {
  P_STRIDE,
  P_PX, P_PY, P_PZ, P_VX, P_VY, P_VZ,
  P_AGE, P_LIFE, P_SIZE0, P_SIZE1,
  P_R, P_G, P_B, P_I0, P_I1,
  P_DRAG, P_GRAV, P_ROT, P_SPIN, P_SHAPE, P_STRETCH, P_SEED, P_ALPHA, P_FADE,
} from './constants.js';
import { PARTICLE_VERT, PARTICLE_FRAG } from './shaders.js';
import { GRAVITY } from '../shared/tuning.js';
import { LAYER_TRANSPARENT } from '../render/index.js';

const MAX_STREAK = 4.0; // metres — a tracer must read as fast, never as a laser

function makeQuad(cap) {
  const g = new THREE.InstancedBufferGeometry();
  // Unit quad in [-0.5, 0.5]. The vertex shader doubles it into -1..1 local uv.
  const pos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  g.instanceCount = 0;
  // The geometry is a unit quad at the origin but the instances are everywhere;
  // three's frustum test would cull the whole draw. Disabled on the mesh.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/**
 * One pool = one draw call. Two of these exist: additive and alpha.
 */
export class ParticlePool {
  /**
   * @param {number} cap hard particle cap for this pool
   * @param {boolean} additive true => blend(ONE, ONE); false => premultiplied over
   * @param {boolean} sorted   depth sort on the CPU (alpha pool only)
   */
  constructor(cap, additive, sorted) {
    this.cap = cap;
    this.count = 0;
    this.additive = additive;
    this.sorted = sorted;

    /** Interleaved CPU simulation state. Never reallocated. */
    this.data = new Float32Array(cap * P_STRIDE);

    // GPU instance attributes, allocated once at cap.
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aPos, this.aVel, this.aParams, this.aColor]) a.setUsage(THREE.DynamicDrawUsage);

    this.geometry = makeQuad(cap);
    this.geometry.setAttribute('iPos', this.aPos);
    this.geometry.setAttribute('iVel', this.aVel);
    this.geometry.setAttribute('iParams', this.aParams);
    this.geometry.setAttribute('iColor', this.aColor);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {},
      transparent: true,
      depthTest: true,
      depthWrite: false, // ARCHITECTURE.md §6 pass 8
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, // shaders write premultiplied alpha
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(LAYER_TRANSPARENT);
    this.mesh.renderOrder = additive ? 12 : 11;
    this.mesh.name = additive ? 'fx.particles.additive' : 'fx.particles.alpha';

    // Sorting scratch, allocated once.
    this.order = new Int32Array(cap);
    this.scratch = new Int32Array(cap);
    this.keys = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this.order[i] = i;

    // Cached {start,count} records reused by _flush(); see the note there.
    this._ranges = [
      { start: 0, count: 0 },
      { start: 0, count: 0 },
      { start: 0, count: 0 },
      { start: 0, count: 0 },
    ];

    this.dropped = 0; // particles refused because the pool was full
    this.peak = 0;
  }

  /** True if the pool is full. Spawns are DROPPED, never grown. */
  get full() {
    return this.count >= this.cap;
  }

  /**
   * Add one particle. Returns false if the cap was hit.
   * Positional on purpose — see the allocation contract at the top of the file.
   */
  spawn(
    px, py, pz,
    vx, vy, vz,
    life,
    size0, size1,
    r, g, b,
    i0, i1,
    drag, grav,
    rot, spin,
    shape, stretch, seed, alpha, fade,
  ) {
    if (this.count >= this.cap) {
      this.dropped++;
      return false;
    }
    const o = this.count * P_STRIDE;
    const d = this.data;
    d[o + P_PX] = px; d[o + P_PY] = py; d[o + P_PZ] = pz;
    d[o + P_VX] = vx; d[o + P_VY] = vy; d[o + P_VZ] = vz;
    d[o + P_AGE] = 0;
    d[o + P_LIFE] = life > 1e-4 ? life : 1e-4;
    d[o + P_SIZE0] = size0;
    d[o + P_SIZE1] = size1;
    d[o + P_R] = r; d[o + P_G] = g; d[o + P_B] = b;
    d[o + P_I0] = i0; d[o + P_I1] = i1;
    d[o + P_DRAG] = drag;
    d[o + P_GRAV] = grav;
    d[o + P_ROT] = rot;
    d[o + P_SPIN] = spin;
    d[o + P_SHAPE] = shape;
    d[o + P_STRETCH] = stretch;
    d[o + P_SEED] = seed;
    d[o + P_ALPHA] = alpha;
    d[o + P_FADE] = fade > 0 ? fade : 1;
    this.count++;
    if (this.count > this.peak) this.peak = this.count;
    return true;
  }

  /** Integrate, retire, and repack the instance buffers. Zero allocation. */
  update(dt, camX, camY, camZ) {
    const d = this.data;
    let n = this.count;
    const gdt = GRAVITY * dt;

    for (let i = 0; i < n; ) {
      const o = i * P_STRIDE;
      const age = d[o + P_AGE] + dt;
      if (age >= d[o + P_LIFE]) {
        // swap-with-last, then re-test this slot
        n--;
        if (i !== n) {
          const s = n * P_STRIDE;
          for (let k = 0; k < P_STRIDE; k++) d[o + k] = d[s + k];
        }
        continue;
      }
      d[o + P_AGE] = age;

      // Exponential drag, first-order. dt here is a render delta, never larger
      // than the clock's 0.25 s clamp, so the linear form stays stable.
      const damp = 1 - d[o + P_DRAG] * dt;
      const k = damp > 0 ? damp : 0;
      let vx = d[o + P_VX] * k;
      let vy = d[o + P_VY] * k - gdt * d[o + P_GRAV];
      let vz = d[o + P_VZ] * k;
      d[o + P_VX] = vx; d[o + P_VY] = vy; d[o + P_VZ] = vz;
      d[o + P_PX] += vx * dt;
      d[o + P_PY] += vy * dt;
      d[o + P_PZ] += vz * dt;

      i++;
    }
    this.count = n;

    // --- pack instance attributes ------------------------------------------
    const ap = this.aPos.array;
    const av = this.aVel.array;
    const apar = this.aParams.array;
    const acol = this.aColor.array;

    if (this.sorted && n > 1) this._sortByDepth(camX, camY, camZ, n);

    for (let j = 0; j < n; j++) {
      const i = this.sorted ? this.order[j] : j;
      const o = i * P_STRIDE;
      const t = d[o + P_AGE] / d[o + P_LIFE];
      const u = Math.pow(1 - t, d[o + P_FADE]);

      const px = d[o + P_PX], py = d[o + P_PY], pz = d[o + P_PZ];
      const j3 = j * 3;
      ap[j3] = px; ap[j3 + 1] = py; ap[j3 + 2] = pz;

      const vx = d[o + P_VX], vy = d[o + P_VY], vz = d[o + P_VZ];
      av[j3] = vx; av[j3 + 1] = vy; av[j3 + 2] = vz;

      const size = d[o + P_SIZE0] + (d[o + P_SIZE1] - d[o + P_SIZE0]) * t;
      const stretchK = d[o + P_STRETCH];
      let streak = 0;
      if (stretchK > 0) {
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        streak = sp * stretchK;
        if (streak > MAX_STREAK) streak = MAX_STREAK;
        if (streak < size) streak = size;
      }

      const j4 = j * 4;
      apar[j4] = size;
      // Rotation doubles as the analytic seed for CRACKLE and SHARD; for the
      // billboarded shapes it is the actual roll angle.
      apar[j4 + 1] = d[o + P_SHAPE] >= 4 ? d[o + P_SEED] : d[o + P_ROT] + d[o + P_SPIN] * d[o + P_AGE];
      apar[j4 + 2] = d[o + P_SHAPE];
      apar[j4 + 3] = streak;

      const intens = d[o + P_I1] + (d[o + P_I0] - d[o + P_I1]) * u;
      acol[j4] = d[o + P_R] * intens;
      acol[j4 + 1] = d[o + P_G] * intens;
      acol[j4 + 2] = d[o + P_B] * intens;
      acol[j4 + 3] = d[o + P_ALPHA] * u;
    }

    this.geometry.instanceCount = n;
    this._flush(this.aPos, 0, n * 3);
    this._flush(this.aVel, 1, n * 3);
    this._flush(this.aParams, 2, n * 4);
    this._flush(this.aColor, 3, n * 4);
  }

  /**
   * Upload only the live prefix of an instance attribute.
   *
   * three's `BufferAttribute.addUpdateRange()` allocates a `{start, count}`
   * object per call, and WebGLAttributes clears the list after every upload —
   * so calling it once per attribute per frame is 12 objects per frame of pure
   * garbage. We push a CACHED range object instead. Same effect on the
   * renderer, zero allocation.
   */
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

  /**
   * Back-to-front insertion sort on a persistent permutation. `order` is kept
   * as a true permutation of [0, cap) so the active prefix is always exactly
   * the n live slots with no duplicates; the previous frame's relative order is
   * preserved, which is what makes the insertion sort ~O(n) in practice.
   * Allocation free — `scratch` is sized at cap in the constructor.
   */
  _sortByDepth(camX, camY, camZ, n) {
    const d = this.data;
    const order = this.order;
    const keys = this.keys;
    const scratch = this.scratch;
    const cap = this.cap;

    // Stable partition: live slots (< n) to the front, retired slots to the
    // back, preserving the previous frame's ordering among the live ones.
    let w = 0;
    let b = cap - 1;
    for (let i = 0; i < cap; i++) {
      const idx = order[i];
      if (idx < n) scratch[w++] = idx;
      else scratch[b--] = idx;
    }
    for (let i = 0; i < cap; i++) order[i] = scratch[i];

    for (let i = 0; i < n; i++) {
      const o = order[i] * P_STRIDE;
      const dx = d[o + P_PX] - camX;
      const dy = d[o + P_PY] - camY;
      const dz = d[o + P_PZ] - camZ;
      keys[order[i]] = dx * dx + dy * dy + dz * dz;
    }
    // Descending distance = back to front.
    for (let i = 1; i < n; i++) {
      const v = order[i];
      const kv = keys[v];
      let j = i - 1;
      while (j >= 0 && keys[order[j]] < kv) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = v;
    }
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
    for (let i = 0; i < this.cap; i++) this.order[i] = i;
  }

  /** NaN audit for the self-test. Scans only the active range. */
  hasNaN() {
    const d = this.data;
    const end = this.count * P_STRIDE;
    for (let i = 0; i < end; i++) if (!Number.isFinite(d[i])) return true;
    const n = this.count;
    if (this._scanNaN(this.aPos.array, n * 3)) return true;
    if (this._scanNaN(this.aVel.array, n * 3)) return true;
    if (this._scanNaN(this.aParams.array, n * 4)) return true;
    if (this._scanNaN(this.aColor.array, n * 4)) return true;
    return false;
  }

  _scanNaN(arr, len) {
    for (let i = 0; i < len; i++) if (!Number.isFinite(arr[i])) return true;
    return false;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
