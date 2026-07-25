// L4 characters — the ART.md §8 silhouette gate, computed WITHOUT a GPU.
// OWNER: `charart` (S4).
//
// `tools/silhouette.mjs` will eventually run the real gate through a renderer.
// This file exists so the shapes can be iterated in a fraction of a second from
// plain node, with no browser, no WebGL and no image readback — which is the
// only way a silhouette gets designed instead of discovered.
//
// METHOD
//   1. Walk each archetype's THREE.Group, transform every triangle by its world
//      matrix, and drop Z. At 60 m an orthographic projection differs from the
//      §8 perspective framing by < 0.05% across a 3 m subject, so the mask is
//      the same mask.
//   2. Take the projected bounding box and rasterise the triangles into it at
//      1024x1024 with a half-space test at pixel centres, then box-downsample
//      4x4 to the 256x256 mask A3 calls for (>= 50% coverage = set).
//      Rasterising DIRECTLY into the bbox is equivalent to an infinite-
//      resolution render followed by A3's bounding-box normalisation, and it
//      removes the quantisation noise you get from up-sampling a 24 px-tall
//      SKIRN to 256 (see the A1 note below).
//   3. Pairwise IoU at 256 (A3, threshold 0.60) and at 64 (A5, threshold 0.68).
//   4. Aspect ratio w/h per archetype, spread checked against A4 (>= 0.55).
//
// A1 NOTE
//   §8 fixes the framing at 60 m, 1080p, vFOV 55.4°, which is
//       1080 / (2 * 60 * tan(27.7°)) = 17.14 px/m.
//   §5 fixes SKIRN's height at 1.42 m, so SKIRN's mask can only ever be
//   1.42 * 17.14 = 24.3 px tall. The original A1 floor of 30 px / 250 px was
//   therefore unreachable for SKIRN at ANY modelling quality. This file left
//   the gate FAILING and reported the arithmetic rather than relaxing it; the
//   orchestrator then corrected §8 to 22 px / 170 px in ART.md amendment A1.
//   The GATE table below carries the amended values.
//
// A3, A4 and A5 are used exactly as written and were never relaxed. Every
// change made to hit them was a change to the geometry.

import * as THREE from 'three';
import { LAYER_TRANSPARENT, LAYER_VIEWMODEL } from '../render/index.js';
import { createMaterial, Family, bindGlobals } from '../materials/index.js';
import {
  buildCharacter,
  countTriangles,
  animateCharacter,
  barrierBlocks,
  setShieldState,
} from './index.js';
import {
  buildViewModel,
  animateViewModel,
  setAmmoCounter,
  VIEWMODEL_IDS,
} from './viewmodels.js';

// --- ART.md §8 framing ------------------------------------------------------
export const FRAME = Object.freeze({
  rangeM: 60,
  frameHeightPx: 1080,
  vFovDeg: 55.4,
  eyeHeightM: 1.62,
});
const PX_PER_M = FRAME.frameHeightPx / (2 * FRAME.rangeM * Math.tan((FRAME.vFovDeg * Math.PI) / 360));

const MASK_N = 256; // A3
const LOW_N = 64; // A5
const SS = 4; // supersample factor; raster is MASK_N * SS = 1024
const RASTER_N = MASK_N * SS;

export const GATE = Object.freeze({
  // ART.md amendment A1: 30 px was unreachable — 17.14 px per metre at the
  // §8 framing caps a 1.42 m SKIRN at 24.3 px. Floor set below that with margin.
  a1MinHeightPx: 22,
  a1MinAreaPx: 170,
  a3MaxIoU: 0.6,
  a4MinAspectSpread: 0.55,
  a5MaxIoU: 0.68,
  maxTriangles: 3500, // ART.md §10 / ARCHITECTURE.md §10
  maxViewModelTriangles: 4000, // ART.md §10 / ARCHITECTURE.md §10
});

const ORDER = ['SKIRN', 'CULL', 'VANE', 'WARDEN'];

// ---------------------------------------------------------------------------
// The material library throws until the renderer binds its global uniform
// block. Headless there is no renderer, so bind an empty block. If the game
// already bound a real one this is a no-op and we leave it alone.
// ---------------------------------------------------------------------------
function ensureMaterialsBound() {
  try {
    const probe = createMaterial(Family.PLAIN, {});
    probe.dispose();
    return false;
  } catch (e) {
    bindGlobals({ u: {} });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3();

/**
 * Every triangle of `root`, projected to the XY plane, as a flat
 * [x0,y0,x1,y1,x2,y2, ...] array in metres.
 */
function projectTriangles(root, includeTransparent) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (!includeTransparent && (o.layers.mask & (1 << LAYER_TRANSPARENT)) !== 0) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const m = o.matrixWorld;
    const n = pos.count;
    const px = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      px[i * 2] = _v.x;
      px[i * 2 + 1] = _v.y;
    }
    const count = idx ? idx.count : n;
    for (let i = 0; i < count; i += 3) {
      const a = idx ? idx.getX(i) : i;
      const b = idx ? idx.getX(i + 1) : i + 1;
      const c = idx ? idx.getX(i + 2) : i + 2;
      out.push(px[a * 2], px[a * 2 + 1], px[b * 2], px[b * 2 + 1], px[c * 2], px[c * 2 + 1]);
    }
  });
  return out;
}

function bounds2d(tris) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < tris.length; i += 2) {
    const x = tris[i];
    const y = tris[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Half-space rasteriser. Fills at pixel centres, orientation-agnostic (a
 * coverage mask does not care about winding), into an N x N grid mapped onto
 * `box`. Row 0 is the TOP of the figure.
 */
function rasterize(tris, box, N) {
  const bits = new Uint8Array(N * N);
  const sx = N / box.w;
  const sy = N / box.h;
  for (let t = 0; t < tris.length; t += 6) {
    const x0 = (tris[t] - box.minX) * sx;
    const y0 = (box.maxY - tris[t + 1]) * sy;
    const x1 = (tris[t + 2] - box.minX) * sx;
    const y1 = (box.maxY - tris[t + 3]) * sy;
    const x2 = (tris[t + 4] - box.minX) * sx;
    const y2 = (box.maxY - tris[t + 5]) * sy;

    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue;
    const inv = 1 / area;

    let lox = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    let hix = Math.min(N - 1, Math.ceil(Math.max(x0, x1, x2)));
    let loy = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    let hiy = Math.min(N - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (lox > hix || loy > hiy) continue;

    for (let py = loy; py <= hiy; py++) {
      const cy = py + 0.5;
      const row = py * N;
      for (let px = lox; px <= hix; px++) {
        const cx = px + 0.5;
        const w0 = ((x1 - x0) * (cy - y0) - (cx - x0) * (y1 - y0)) * inv;
        const w1 = ((x2 - x1) * (cy - y1) - (cx - x1) * (y2 - y1)) * inv;
        const w2 = ((x0 - x2) * (cy - y2) - (cx - x2) * (y0 - y2)) * inv;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) bits[row + px] = 1;
      }
    }
  }
  return bits;
}

/** Box-downsample a supersampled bitmask; a cell is set at >= 50% coverage. */
function downsample(src, srcN, dstN) {
  const f = srcN / dstN;
  if (!Number.isInteger(f)) throw new Error('[selftest] non-integer downsample factor');
  const half = (f * f) / 2;
  const dst = new Uint8Array(dstN * dstN);
  for (let y = 0; y < dstN; y++) {
    for (let x = 0; x < dstN; x++) {
      let n = 0;
      for (let sy = 0; sy < f; sy++) {
        const row = (y * f + sy) * srcN + x * f;
        for (let sx = 0; sx < f; sx++) if (src[row + sx]) n++;
      }
      dst[y * dstN + x] = n >= half ? 1 : 0;
    }
  }
  return dst;
}

function popcount(m) {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

function iou(a, b) {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x & y) inter++;
    if (x | y) uni++;
  }
  return uni === 0 ? 0 : inter / uni;
}

/** ASCII art of a mask, for eyeballing a failure in a terminal. */
export function maskToAscii(mask, n, cols = 48) {
  const step = n / cols;
  const rows = Math.round(cols * 0.9);
  const rstep = n / rows;
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) {
      const sy = Math.min(n - 1, Math.floor(y * rstep));
      const sx = Math.min(n - 1, Math.floor(x * step));
      s += mask[sy * n + sx] ? '#' : '.';
    }
    lines.push(s);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Rig / animation soundness. Procedural animation has no clips to eyeball, so
// the only honest check is that it stays finite and actually moves things.
// ---------------------------------------------------------------------------
const _wp = new THREE.Vector3();

function exerciseCharacter(handle) {
  const phases = [
    { state: 'idle', speed: 0 },
    { state: 'walk', speed: handle.gait.refSpeed },
    { state: 'walk', speed: handle.gait.refSpeed * 0.4 },
    { state: 'stagger', speed: 0 },
    { state: 'death', speed: 0 },
  ];
  let nonFinite = 0;
  let moved = 0;
  const before = new Map();
  handle.root.updateMatrixWorld(true);
  handle.root.traverse((o) => {
    if (o.isMesh) before.set(o, o.getWorldPosition(new THREE.Vector3()).clone());
  });
  for (const ph of phases) {
    for (let i = 0; i < 90; i++) {
      animateCharacter(handle, {
        state: ph.state,
        dt: 1 / 120,
        speed: ph.speed,
        aimYaw: Math.sin(i * 0.07) * 1.1,
        aimPitch: Math.cos(i * 0.05) * 0.6,
      });
    }
    handle.root.updateMatrixWorld(true);
    handle.root.traverse((o) => {
      if (!o.isMesh) return;
      o.getWorldPosition(_wp);
      if (!Number.isFinite(_wp.x + _wp.y + _wp.z)) nonFinite++;
      const b = before.get(o);
      if (b && b.distanceTo(_wp) > 1e-4) moved++;
    });
  }
  return { nonFinite, moved };
}

/**
 * ±(arcDeg/2) about the barrier normal, sampled either side of the edge.
 * Runs a full second of idle first: aim tracking is exponentially damped, so a
 * single dt = 0 tick would leave the barrier still yawed by whatever the
 * previous animation phase asked for. Settling proves the rest pose is
 * recovered, which is the property `weapons` actually depends on.
 */
function checkBarrierArc(handle) {
  for (let i = 0; i < 120; i++) {
    animateCharacter(handle, { state: 'idle', dt: 1 / 120, speed: 0, aimYaw: 0, aimPitch: 0 });
  }
  const half = handle.barrier.arcDeg * 0.5;

  // Sample relative to the barrier's ACTUAL world normal, not to world -Z.
  // Idle breathing rocks the torso ±0.018 rad and the braced arm inherits it,
  // so a world-axis sample 1° inside the edge flickers across the boundary —
  // that is the pose moving, not the arc arithmetic being wrong. Building an
  // orthonormal basis on the live normal makes the sampled angle exact.
  const n = new THREE.Vector3();
  handle.barrier.node.getWorldDirection(n).normalize();
  const t = new THREE.Vector3(0, 1, 0).cross(n);
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
  t.normalize();
  const dir = new THREE.Vector3();
  const at = (deg) => {
    const r = (deg * Math.PI) / 180;
    // direction of TRAVEL = away from a shooter standing at `deg` off the normal
    dir.copy(n).multiplyScalar(Math.cos(r)).addScaledVector(t, Math.sin(r)).negate();
    return barrierBlocks(handle, dir);
  };
  return {
    arcDeg: handle.barrier.arcDeg,
    onAxis: at(0),
    insideEdge: at(half - 0.5),
    outsideEdge: at(half + 0.5),
    side: at(90),
    behind: at(180),
  };
}

// ---------------------------------------------------------------------------
// View models — ART.md §6 structural requirements and the §10 budget.
// ---------------------------------------------------------------------------
const REQUIRED_VM_PARTS = ['body', 'magazine', 'bolt', 'counter', 'muzzle'];

export function runViewModelSelfTest() {
  ensureMaterialsBound();
  const out = [];
  const failed = [];

  for (const id of VIEWMODEL_IDS) {
    const h = buildViewModel(id);
    h.root.updateMatrixWorld(true);

    let meshes = 0;
    let offLayer = 0;
    h.root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      if ((o.layers.mask & (1 << LAYER_VIEWMODEL)) === 0) offLayer++;
    });

    const missing = REQUIRED_VM_PARTS.filter((k) => !h.parts[k]);
    // muzzleTip must actually hang off the model, not float free
    let tipAttached = false;
    h.root.traverse((o) => {
      if (o === h.muzzleTip) tipAttached = true;
    });

    // The counter must actually change what it SHOWS. Counting lit meshes is
    // not enough: on a one-digit display "6" and "0" both light six segments,
    // so compare the visibility pattern instead.
    const patternFor = (v) => {
      setAmmoCounter(h, v);
      let s = '';
      h.parts.counter.traverse((o) => {
        if (o.isMesh) s += o.visible ? '1' : '0';
      });
      return s;
    };
    const seen = new Set();
    for (const v of [h.capacity, Math.floor(h.capacity / 2), 1, 0]) seen.add(patternFor(v));
    const counterResponds = seen.size >= 3;
    setAmmoCounter(h, h.capacity);

    let nonFinite = 0;
    const seq = [
      { firing01: 0, recoil01: 0, reload01: 0, swap01: 1, heat01: 0, charge01: 0 },
      { firing01: 1, recoil01: 1, reload01: 0, swap01: 1, heat01: 0.6, charge01: 0 },
      { firing01: 0, recoil01: 0, reload01: 0.3, swap01: 1, heat01: 1, charge01: 0.5 },
      { firing01: 0, recoil01: 0, reload01: 0.85, swap01: 1, heat01: 0.1, charge01: 1 },
      { firing01: 0, recoil01: 0, reload01: 0, swap01: 0, heat01: 0, charge01: 0 },
    ];
    // magazine travel over a full reload, which is the FEEL.md §7 "reload state
    // readable from the view model alone" requirement
    let magTravel = 0;
    const magRef = new THREE.Vector3();
    animateViewModel(h, { ...seq[0], dt: 1 / 120 });
    h.root.updateMatrixWorld(true);
    h.parts.magazine.getWorldPosition(magRef);
    for (const s of seq) {
      for (let i = 0; i < 60; i++) animateViewModel(h, { ...s, dt: 1 / 120 });
      h.root.updateMatrixWorld(true);
      h.root.traverse((o) => {
        if (!o.isMesh) return;
        o.getWorldPosition(_wp);
        if (!Number.isFinite(_wp.x + _wp.y + _wp.z)) nonFinite++;
      });
      if (s.reload01 > 0 && s.reload01 < 0.4) {
        h.parts.magazine.getWorldPosition(_wp);
        magTravel = Math.max(magTravel, magRef.distanceTo(_wp));
      }
    }

    const bbox = new THREE.Box3().setFromObject(h.root);
    const size = bbox.getSize(new THREE.Vector3());

    const r = {
      weaponId: id,
      triangles: h.triangles,
      meshes,
      capacity: h.capacity,
      counterKind: h.parts.counter.userData.kind,
      counterResponds,
      isVess: h.isVess,
      hasDetachableMag: h.hasDetachableMag,
      muzzleTipLocal: [h.muzzleTip.position.x, h.muzzleTip.position.y, h.muzzleTip.position.z],
      lengthM: size.z,
      heightM: size.y,
      widthM: size.x,
      magDropM: magTravel,
      budgetOk: h.triangles < GATE.maxViewModelTriangles,
      layerOk: offLayer === 0,
      partsOk: missing.length === 0 && tipAttached,
      finite: nonFinite === 0,
    };
    out.push(r);

    if (!r.budgetOk) failed.push(`VM BUDGET ${id}: ${h.triangles} tris (limit ${GATE.maxViewModelTriangles})`);
    if (!r.layerOk) failed.push(`VM LAYER ${id}: ${offLayer} meshes not on LAYER_VIEWMODEL`);
    if (missing.length) failed.push(`VM PARTS ${id}: missing ${missing.join(', ')}`);
    if (!tipAttached) failed.push(`VM PARTS ${id}: muzzleTip is not attached to root`);
    if (!counterResponds) failed.push(`VM COUNTER ${id}: display shows only ${seen.size} distinct patterns across 4 values`);
    if (!r.finite) failed.push(`VM ANIM ${id}: ${nonFinite} non-finite world positions`);
    if (h.hasDetachableMag && magTravel < 0.05) {
      failed.push(`VM RELOAD ${id}: magazine moved only ${magTravel.toFixed(3)} m during the drop`);
    }
  }
  return { passed: failed.length === 0, failed, results: out };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Build all four archetypes and measure the ART.md §8 silhouette gate.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeTransparent=true]  Count LAYER_TRANSPARENT
 *   geometry (i.e. the VANE shield shell) as part of the silhouette. It IS
 *   visible against sky, so the honest default is true. Pass false to see how
 *   much of VANE's separation is carried by the shell rather than the body.
 * @param {boolean} [opts.ascii=false]  Attach an ASCII render of each mask.
 * @returns {{passed:boolean, separationPassed:boolean, failed:string[],
 *            ious:Array, iousLow:Array, aspects:Object, results:Array,
 *            gates:Object, notes:string[]}}
 */
export function runCharacterSelfTest(opts = {}) {
  const includeTransparent = opts.includeTransparent !== false;
  ensureMaterialsBound();

  const results = [];
  const masks = {};
  const masksLow = {};
  const aspects = {};

  for (const name of ORDER) {
    const h = buildCharacter(name);
    const tris = projectTriangles(h.root, includeTransparent);
    const box = bounds2d(tris);
    const raster = rasterize(tris, box, RASTER_N);
    const mask = downsample(raster, RASTER_N, MASK_N);
    const low = downsample(raster, RASTER_N, LOW_N);
    masks[name] = mask;
    masksLow[name] = low;

    const set = popcount(mask);
    const fill = set / (MASK_N * MASK_N);
    const aspect = box.w / box.h;
    aspects[name] = aspect;

    // A1 is measured at the real §8 framing, not in mask space.
    const heightPx = box.h * PX_PER_M;
    const widthPx = box.w * PX_PER_M;
    const areaPx = fill * box.w * box.h * PX_PER_M * PX_PER_M;

    const r = {
      archetype: name,
      triangles: h.triangles,
      meshTriangles: countTriangles(h.root),
      widthM: box.w,
      heightM: box.h,
      specHeightM: h.height,
      specShoulderM: h.shoulderWidth,
      groundOffsetM: box.minY,
      aspect,
      fill,
      heightPx,
      widthPx,
      areaPx,
      hitboxes: h.hitboxes.length,
      regions: h.hitboxes.reduce((m, hb) => {
        m[hb.region] = (m[hb.region] || 0) + 1;
        return m;
      }, {}),
      a1: heightPx >= GATE.a1MinHeightPx && areaPx >= GATE.a1MinAreaPx,
      budgetOk: h.triangles < GATE.maxTriangles,
    };
    r.anim = exerciseCharacter(h);
    if (h.barrier) r.barrier = checkBarrierArc(h);
    if (h.shield) {
      setShieldState(h, { fraction: 1, flash01: 1 });
      r.shieldFlashIntensity = h.shield.material.uniforms.uEmissiveIntensity.value;
      setShieldState(h, { fraction: 1, flash01: 0 });
      h.anim.shieldFlash = 0;
      setShieldState(h, { fraction: 1 });
      r.shieldRestIntensity = h.shield.material.uniforms.uEmissiveIntensity.value;
      r.shieldAdditive = h.shield.material.blending === THREE.AdditiveBlending;
    }
    if (opts.ascii) r.ascii = maskToAscii(mask, MASK_N);
    results.push(r);
  }

  const ious = [];
  const iousLow = [];
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      ious.push([ORDER[i], ORDER[j], iou(masks[ORDER[i]], masks[ORDER[j]])]);
      iousLow.push([ORDER[i], ORDER[j], iou(masksLow[ORDER[i]], masksLow[ORDER[j]])]);
    }
  }

  const aspectValues = ORDER.map((n) => aspects[n]);
  const aspectSpread = Math.max(...aspectValues) - Math.min(...aspectValues);

  const failed = [];
  const notes = [];

  for (const r of results) {
    if (!r.a1) {
      failed.push(
        `A1 ${r.archetype}: ${r.heightPx.toFixed(1)} px tall (need >= ${GATE.a1MinHeightPx}), ` +
          `${r.areaPx.toFixed(0)} px area (need >= ${GATE.a1MinAreaPx}) at the §8 framing`,
      );
    }
    if (!r.budgetOk) {
      failed.push(`BUDGET ${r.archetype}: ${r.triangles} tris (limit ${GATE.maxTriangles})`);
    }
  }

  const a3Fails = ious.filter((p) => p[2] >= GATE.a3MaxIoU);
  for (const p of a3Fails) failed.push(`A3 ${p[0]}/${p[1]}: IoU ${p[2].toFixed(3)} >= ${GATE.a3MaxIoU}`);

  const a4Ok = aspectSpread >= GATE.a4MinAspectSpread;
  if (!a4Ok) failed.push(`A4: aspect spread ${aspectSpread.toFixed(3)} < ${GATE.a4MinAspectSpread}`);

  const a5Fails = iousLow.filter((p) => p[2] >= GATE.a5MaxIoU);
  for (const p of a5Fails) failed.push(`A5 ${p[0]}/${p[1]}: IoU@64 ${p[2].toFixed(3)} >= ${GATE.a5MaxIoU}`);

  const separationPassed = a3Fails.length === 0 && a4Ok && a5Fails.length === 0;

  // ---- rig soundness ------------------------------------------------------
  for (const r of results) {
    if (r.anim.nonFinite > 0) {
      failed.push(`RIG ${r.archetype}: ${r.anim.nonFinite} non-finite world positions during animation`);
    }
    if (r.anim.moved === 0) {
      failed.push(`RIG ${r.archetype}: animation moved nothing`);
    }
    if (r.barrier) {
      const b = r.barrier;
      if (!(b.onAxis && b.insideEdge && !b.outsideEdge && !b.side && !b.behind)) {
        failed.push(
          `BARRIER CULL: ${b.arcDeg} deg arc mis-resolves — ` +
            `onAxis=${b.onAxis} inside=${b.insideEdge} outside=${b.outsideEdge} ` +
            `side=${b.side} behind=${b.behind}`,
        );
      }
    }
    if (r.shieldRestIntensity !== undefined) {
      if (!(r.shieldFlashIntensity > r.shieldRestIntensity * 2)) {
        failed.push(
          `SHIELD VANE: flash ${r.shieldFlashIntensity.toFixed(2)} is not clearly above ` +
            `rest ${r.shieldRestIntensity.toFixed(2)}`,
        );
      }
      if (!r.shieldAdditive) failed.push('SHIELD VANE: shell is not additively blended');
    }
  }

  // ---- view models --------------------------------------------------------
  const vm = opts.viewModels === false ? null : runViewModelSelfTest();
  if (vm) for (const f of vm.failed) failed.push(f);

  if (results.some((r) => !r.a1)) {
    notes.push(
      'A1 measures the real §8 framing (17.14 px/m at 60 m). The ceiling per archetype is ' +
        'SKIRN 24.3 px, CULL 30.5 px, VANE 40.1 px, WARDEN 48.9 px — those are set by ' +
        'FEEL.md §6 heights and cannot be modelled around. Thresholds are ART.md amendment A1.',
    );
  }

  return {
    passed: failed.length === 0,
    separationPassed,
    failed,
    ious,
    iousLow,
    aspects,
    aspectSpread,
    results,
    gates: {
      a1: results.every((r) => r.a1),
      a3: a3Fails.length === 0,
      a4: a4Ok,
      a5: a5Fails.length === 0,
      budget: results.every((r) => r.budgetOk),
      rig: results.every((r) => r.anim.nonFinite === 0 && r.anim.moved > 0),
      viewModels: vm ? vm.passed : null,
    },
    viewModels: vm ? vm.results : null,
    framing: { pxPerMetre: PX_PER_M, ...FRAME },
    notes,
  };
}

/** Human-readable dump. Returns a string; prints nothing. */
export function formatSelfTest(res) {
  const L = [];
  L.push(`framing: ${res.framing.pxPerMetre.toFixed(3)} px/m at ${res.framing.rangeM} m`);
  L.push('');
  L.push('archetype   tris   w(m)   h(m)  aspect   fill   h(px)  area(px)  A1');
  for (const r of res.results) {
    L.push(
      `${r.archetype.padEnd(9)} ${String(r.triangles).padStart(5)} ` +
        `${r.widthM.toFixed(3).padStart(6)} ${r.heightM.toFixed(3).padStart(6)} ` +
        `${r.aspect.toFixed(3).padStart(7)} ${r.fill.toFixed(3).padStart(6)} ` +
        `${r.heightPx.toFixed(1).padStart(7)} ${r.areaPx.toFixed(0).padStart(9)}  ${r.a1 ? 'ok' : 'FAIL'}`,
    );
  }
  L.push('');
  L.push('A3 pairwise IoU @256 (limit < 0.60):');
  for (const [a, b, v] of res.ious) {
    L.push(`  ${a.padEnd(7)} ${b.padEnd(7)} ${v.toFixed(4)}  ${v < 0.6 ? 'ok' : 'FAIL'}`);
  }
  L.push('A5 pairwise IoU @64 (limit < 0.68):');
  for (const [a, b, v] of res.iousLow) {
    L.push(`  ${a.padEnd(7)} ${b.padEnd(7)} ${v.toFixed(4)}  ${v < 0.68 ? 'ok' : 'FAIL'}`);
  }
  L.push('');
  L.push(`A4 aspect spread ${res.aspectSpread.toFixed(3)} (need >= 0.55) ${res.gates.a4 ? 'ok' : 'FAIL'}`);
  L.push('');
  L.push('rig / hitboxes:');
  for (const r of res.results) {
    let s =
      `  ${r.archetype.padEnd(7)} hitboxes ${String(r.hitboxes).padStart(2)}  ` +
      `nonFinite ${r.anim.nonFinite}  movedParts ${String(r.anim.moved).padStart(4)}`;
    if (r.barrier) {
      s += `  barrier ${r.barrier.arcDeg}deg on=${r.barrier.onAxis} in=${r.barrier.insideEdge} out=${r.barrier.outsideEdge} side=${r.barrier.side}`;
    }
    if (r.shieldRestIntensity !== undefined) {
      s += `  shield rest ${r.shieldRestIntensity.toFixed(2)} -> flash ${r.shieldFlashIntensity.toFixed(2)} additive=${r.shieldAdditive}`;
    }
    L.push(s);
  }
  if (res.viewModels) {
    L.push('');
    L.push('view models (budget < 4000 tris, ART.md §6 parts, LAYER_VIEWMODEL):');
    L.push('  weapon           tris  meshes  len(m)  counter   magDrop  budget layer parts finite');
    for (const v of res.viewModels) {
      L.push(
        `  ${v.weaponId.padEnd(15)} ${String(v.triangles).padStart(4)}  ` +
          `${String(v.meshes).padStart(6)}  ${v.lengthM.toFixed(3).padStart(6)}  ` +
          `${v.counterKind.padEnd(7)}  ${v.magDropM.toFixed(3).padStart(7)}  ` +
          `${(v.budgetOk ? 'ok' : 'FAIL').padStart(6)} ${(v.layerOk ? 'ok' : 'FAIL').padStart(5)} ` +
          `${(v.partsOk ? 'ok' : 'FAIL').padStart(5)} ${(v.finite ? 'ok' : 'FAIL').padStart(6)}`,
      );
    }
  }
  L.push('');
  L.push(`gates: ${JSON.stringify(res.gates)}`);
  L.push(`separationPassed (A3+A4+A5): ${res.separationPassed}`);
  if (res.failed.length) {
    L.push('');
    L.push('FAILURES:');
    for (const f of res.failed) L.push(`  - ${f}`);
  }
  for (const n of res.notes) {
    L.push('');
    L.push(`note: ${n}`);
  }
  return L.join('\n');
}
