// L3 physics — static shape types + closed-form geometry primitives.
// Internal module: PhysicsWorld (index.js) owns the public surface. This file
// has no mutable module-level state except scratch vectors reused across
// calls (never retained past a single function call — see ARCHITECTURE §7).
//
// Permitted imports only: three, ../shared/*, ../core/*.
import { Vector3 } from 'three';

// ---------------------------------------------------------------------------
// Shape records. Plain classes, one instance per addStatic* call. `removed`
// is a tombstone flag so the uniform grid does not need to rebuild on every
// removeStatic() — it is checked at query time and the grid is fully rebuilt
// only when the caller triggers PhysicsWorld's dirty flag.
// ---------------------------------------------------------------------------

export class StaticBox {
  constructor(handle, center, halfExtents, quaternion, surfaceId, entityId) {
    this.type = 'box';
    this.handle = handle;
    this.center = center.clone();
    this.halfExtents = halfExtents.clone();
    this.quaternion = quaternion.clone();
    this.invQuaternion = quaternion.clone().invert();
    this.surfaceId = surfaceId;
    this.entityId = entityId;
    this.removed = false;
    this._stamp = -1; // grid query de-dup stamp, see grid.js
  }
}

export class StaticSphere {
  constructor(handle, center, radius, surfaceId, entityId) {
    this.type = 'sphere';
    this.handle = handle;
    this.center = center.clone();
    this.radius = radius;
    this.surfaceId = surfaceId;
    this.entityId = entityId;
    this.removed = false;
    this._stamp = -1;
  }
}

export class Heightfield {
  constructor({ origin, cellSize, width, depth, heights, surfaceId }) {
    this.type = 'heightfield';
    this.origin = origin.clone();
    this.cellSize = cellSize;
    this.width = width; // vertex count along x
    this.depth = depth; // vertex count along z
    this.heights = heights; // Float32Array, length === width*depth, row-major z*width+x
    this.surfaceId = surfaceId;
    this.handle = 0; // assigned by PhysicsWorld; a heightfield is not grid-indexed
    this.entityId = 0;
  }

  get minX() {
    return this.origin.x;
  }
  get minZ() {
    return this.origin.z;
  }
  get maxX() {
    return this.origin.x + (this.width - 1) * this.cellSize;
  }
  get maxZ() {
    return this.origin.z + (this.depth - 1) * this.cellSize;
  }

  _sample(ix, iz) {
    const cx = ix < 0 ? 0 : ix > this.width - 1 ? this.width - 1 : ix;
    const cz = iz < 0 ? 0 : iz > this.depth - 1 ? this.depth - 1 : iz;
    return this.heights[cz * this.width + cx];
  }

  /** Bilinear world-space height at (x,z). Clamps outside the grid to the edge cell. */
  heightAt(x, z) {
    const fx = (x - this.origin.x) / this.cellSize;
    const fz = (z - this.origin.z) / this.cellSize;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h00 = this._sample(ix, iz);
    const h10 = this._sample(ix + 1, iz);
    const h01 = this._sample(ix, iz + 1);
    const h11 = this._sample(ix + 1, iz + 1);
    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return this.origin.y + h0 + (h1 - h0) * tz;
  }

  /** Finite-difference surface normal at (x,z). Smoothed across the grid, not per-triangle. */
  normalAt(x, z, out) {
    const e = this.cellSize * 0.5;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }

  inBounds(x, z) {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }
}

// ---------------------------------------------------------------------------
// Scratch (module scope, private — never exported).
// ---------------------------------------------------------------------------
const _lo = new Vector3();
const _ld = new Vector3();
const _lh = new Vector3();
const _n = new Vector3();

export const clampNum = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// Raycasts. All take a pre-normalized `dir`. `out`, if given, is written with
// {point, normal, distance} — caller owns `out.point`/`out.normal` Vector3s.
// ---------------------------------------------------------------------------

/** @returns {number|null} distance along the ray, or null. */
export function raySphere(origin, dir, center, radius, maxDist, out) {
  const ocx = origin.x - center.x,
    ocy = origin.y - center.y,
    ocz = origin.z - center.z;
  const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return null;
  if (out) {
    out.distance = t;
    out.point.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    out.normal.set(out.point.x - center.x, out.point.y - center.y, out.point.z - center.z).divideScalar(radius);
  }
  return t;
}

/**
 * Slab-method ray/OBB intersection in the box's local frame. Exact.
 * @returns {number|null}
 */
export function rayObb(origin, dir, box, maxDist, out) {
  _lo.copy(origin).sub(box.center).applyQuaternion(box.invQuaternion);
  _ld.copy(dir).applyQuaternion(box.invQuaternion);
  const he = box.halfExtents;
  const o = [_lo.x, _lo.y, _lo.z];
  const d = [_ld.x, _ld.y, _ld.z];
  const h = [he.x, he.y, he.z];
  let tmin = 0,
    tmax = maxDist;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < -h[i] || o[i] > h[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (-h[i] - o[i]) * inv;
    let t2 = (h[i] - o[i]) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin > maxDist || tmax < 0) return null;
  const t = tmin;
  _lh.set(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
  // Face = local axis whose |component| lands closest to its half-extent.
  let axis = 0,
    best = -Infinity;
  const comp = [_lh.x, _lh.y, _lh.z];
  for (let i = 0; i < 3; i++) {
    const score = h[i] - Math.abs(Math.abs(comp[i]) - h[i]);
    if (score > best) {
      best = score;
      axis = i;
    }
  }
  const sign = Math.sign(comp[axis] || 1);
  _n.set(0, 0, 0);
  if (axis === 0) _n.x = sign;
  else if (axis === 1) _n.y = sign;
  else _n.z = sign;
  _n.applyQuaternion(box.quaternion);
  if (out) {
    out.distance = t;
    out.point.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    out.normal.copy(_n);
  }
  return t;
}

/**
 * Marched ray/heightfield intersection: samples bilinear height along the ray
 * at a fixed step derived from cellSize, then bisects the bracketing interval.
 * Approximate (see README limitations) — not an exact per-triangle test.
 */
export function rayHeightfield(origin, dir, hf, maxDist, out) {
  if (Math.abs(dir.x) < 1e-9 && Math.abs(dir.z) < 1e-9) {
    // Purely vertical ray: solve directly.
    if (!hf.inBounds(origin.x, origin.z)) return null;
    const h = hf.heightAt(origin.x, origin.z);
    const t = (h - origin.y) / dir.y;
    if (t < 0 || t > maxDist || !Number.isFinite(t)) return null;
    if (out) {
      out.distance = t;
      out.point.set(origin.x, h, origin.z);
      hf.normalAt(origin.x, origin.z, out.normal);
    }
    return t;
  }
  const samples = Math.max(8, Math.ceil(maxDist / (hf.cellSize * 0.5)));
  let prevT = 0;
  let prevF = null;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * maxDist;
    const px = origin.x + dir.x * t;
    const pz = origin.z + dir.z * t;
    const py = origin.y + dir.y * t;
    if (!hf.inBounds(px, pz)) {
      prevT = t;
      prevF = null;
      continue;
    }
    const f = py - hf.heightAt(px, pz);
    if (prevF !== null && prevF > 0 && f <= 0) {
      let a = prevT,
        b = t;
      for (let k = 0; k < 24; k++) {
        const mid = (a + b) / 2;
        const mx = origin.x + dir.x * mid;
        const mz = origin.z + dir.z * mid;
        const my = origin.y + dir.y * mid;
        const fm = my - hf.heightAt(mx, mz);
        if (fm > 0) a = mid;
        else b = mid;
      }
      if (b > maxDist) return null;
      if (out) {
        const hx = origin.x + dir.x * b;
        const hz = origin.z + dir.z * b;
        out.distance = b;
        out.point.set(hx, hf.heightAt(hx, hz), hz);
        hf.normalAt(hx, hz, out.normal);
      }
      return b;
    }
    prevT = t;
    prevF = f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Closest point / containment.
// ---------------------------------------------------------------------------

/** Closest point on (surface or interior of) an OBB to a world point. Writes `out`, returns it. */
export function closestPointOnObb(point, box, out) {
  _lo.copy(point).sub(box.center).applyQuaternion(box.invQuaternion);
  const he = box.halfExtents;
  out
    .set(clampNum(_lo.x, -he.x, he.x), clampNum(_lo.y, -he.y, he.y), clampNum(_lo.z, -he.z, he.z))
    .applyQuaternion(box.quaternion)
    .add(box.center);
  return out;
}

export function pointInObb(point, box) {
  _lo.copy(point).sub(box.center).applyQuaternion(box.invQuaternion);
  const he = box.halfExtents;
  return Math.abs(_lo.x) <= he.x && Math.abs(_lo.y) <= he.y && Math.abs(_lo.z) <= he.z;
}

export function pointInSphere(point, sphere) {
  return point.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
}

/**
 * Push-out normal + depth for a point already inside an OBB (shortest exit).
 * Undefined (garbage) if the point is not inside — check pointInObb first.
 */
export function obbPenetration(point, box, out) {
  _lo.copy(point).sub(box.center).applyQuaternion(box.invQuaternion);
  const he = box.halfExtents;
  const dx = he.x - Math.abs(_lo.x);
  const dy = he.y - Math.abs(_lo.y);
  const dz = he.z - Math.abs(_lo.z);
  let axis, depth;
  if (dx <= dy && dx <= dz) {
    axis = 0;
    depth = dx;
  } else if (dy <= dx && dy <= dz) {
    axis = 1;
    depth = dy;
  } else {
    axis = 2;
    depth = dz;
  }
  const comp = axis === 0 ? _lo.x : axis === 1 ? _lo.y : _lo.z;
  const sign = Math.sign(comp || 1);
  _n.set(0, 0, 0);
  if (axis === 0) _n.x = sign;
  else if (axis === 1) _n.y = sign;
  else _n.z = sign;
  _n.applyQuaternion(box.quaternion);
  out.normal.copy(_n);
  out.depth = depth;
  return out;
}

/** Parametric projection of world point `p` onto segment a-b, clamped to [0,1]. */
export function closestParamOnSegment(a, b, p) {
  const abx = b.x - a.x,
    aby = b.y - a.y,
    abz = b.z - a.z;
  const apx = p.x - a.x,
    apy = p.y - a.y,
    apz = p.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  if (abLenSq < 1e-12) return 0;
  const t = (apx * abx + apy * aby + apz * abz) / abLenSq;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
