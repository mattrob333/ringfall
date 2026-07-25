// L3 physics — swept-sphere continuous collision + discrete capsule/box &
// capsule/sphere penetration tests. Internal module; index.js re-exports the
// pieces the API contract names explicitly.
//
// Design note (determinism + no closed-form capsule/OBB sweep):
// Distance-to-a-convex-set is a convex function of a point moving along a
// line (a translate is affine, and distance-to-convex-set is convex, and a
// convex function composed with an affine map is convex). That means, for a
// POINT (radius-less) sweeping against a convex shape, "distance(t) - r" is
// convex in t and therefore unimodal: it has one minimum, decreasing then
// increasing. sphereCastObb/sphereCastSphere below exploit that directly
// with a fixed-iteration ternary search (find the minimum) followed by a
// fixed-iteration bisection (find where it first crosses zero). Both loop
// counts are constants, so every run is bit-identical (ARCHITECTURE §7).
//
// Capsules are not points, so the same trick does not apply to a swept
// capsule in closed form without a lot more machinery. CharacterBody instead
// gets its continuous-collision guarantee from fixed-size sub-stepping
// (move.js) combined with the discrete capsuleVsObb/capsuleVsSphere tests
// below, which use an alternating-projection closest-point search (fixed 8
// iterations — segment and box are both simple convex sets, this converges
// to the true closest points well within that budget for the shapes we ever
// see). This is documented as a deliberate approximation in README.md, not
// hidden.
import { Vector3 } from 'three';
import { clampNum, closestParamOnSegment } from './geometry.js';

const _segA = new Vector3();
const _segB = new Vector3();
const _segPt = new Vector3();
const _boxPt = new Vector3();
const _rayPt = new Vector3();
const _cpTmp = new Vector3();
const _diff = new Vector3();

// ---------------------------------------------------------------------------
// Discrete capsule vs static shape. Segment p0-p1 is the capsule's medial
// axis (world space), `radius` its tube radius. Returns true + fills
// out.normal/out.depth (push-out direction/amount for the CAPSULE) on
// overlap, false otherwise. `out.depth` is defined as "move the segment this
// far along normal to just separate" (0 at exact touch).
// ---------------------------------------------------------------------------

export function capsuleVsObb(p0, p1, radius, box, out) {
  _segA.copy(p0).sub(box.center).applyQuaternion(box.invQuaternion);
  _segB.copy(p1).sub(box.center).applyQuaternion(box.invQuaternion);
  const he = box.halfExtents;

  let s = 0.5;
  for (let i = 0; i < 8; i++) {
    _segPt.lerpVectors(_segA, _segB, s);
    _boxPt.set(clampNum(_segPt.x, -he.x, he.x), clampNum(_segPt.y, -he.y, he.y), clampNum(_segPt.z, -he.z, he.z));
    s = closestParamOnSegment(_segA, _segB, _boxPt);
  }
  _segPt.lerpVectors(_segA, _segB, s);

  const inside =
    Math.abs(_segPt.x) <= he.x && Math.abs(_segPt.y) <= he.y && Math.abs(_segPt.z) <= he.z;

  if (inside) {
    // Segment's closest-approach point is inside the box: use the shortest
    // exit face, and the capsule needs to clear by that plus its radius.
    const dx = he.x - Math.abs(_segPt.x);
    const dy = he.y - Math.abs(_segPt.y);
    const dz = he.z - Math.abs(_segPt.z);
    let axis, faceDepth;
    if (dx <= dy && dx <= dz) {
      axis = 0;
      faceDepth = dx;
    } else if (dy <= dx && dy <= dz) {
      axis = 1;
      faceDepth = dy;
    } else {
      axis = 2;
      faceDepth = dz;
    }
    const comp = axis === 0 ? _segPt.x : axis === 1 ? _segPt.y : _segPt.z;
    const sign = Math.sign(comp || 1);
    out.normal.set(0, 0, 0);
    if (axis === 0) out.normal.x = sign;
    else if (axis === 1) out.normal.y = sign;
    else out.normal.z = sign;
    out.normal.applyQuaternion(box.quaternion);
    out.depth = faceDepth + radius;
    return true;
  }

  _boxPt.set(clampNum(_segPt.x, -he.x, he.x), clampNum(_segPt.y, -he.y, he.y), clampNum(_segPt.z, -he.z, he.z));
  _diff.copy(_segPt).sub(_boxPt);
  const dist = _diff.length();
  const sep = dist - radius;
  if (sep >= 0) return false;
  out.normal.copy(dist > 1e-9 ? _diff.divideScalar(dist) : _diff.set(0, 1, 0)).applyQuaternion(box.quaternion);
  out.depth = -sep;
  return true;
}

export function capsuleVsSphere(p0, p1, radius, sphere, out) {
  const t = closestParamOnSegment(p0, p1, sphere.center);
  _segPt.lerpVectors(p0, p1, t);
  _diff.copy(_segPt).sub(sphere.center);
  const dist = _diff.length();
  const sep = dist - radius - sphere.radius;
  if (sep >= 0) return false;
  out.normal.copy(dist > 1e-9 ? _diff.divideScalar(dist) : _diff.set(0, 1, 0));
  out.depth = -sep;
  return true;
}

// ---------------------------------------------------------------------------
// Continuous (swept) sphere casts — see the module-level note for the
// convexity argument. `dir` must be a unit vector. Fixed iteration counts:
// 40 for the ternary minimum search, 40 for the bisection refinement — both
// small enough to be cheap per-call and large enough that the returned `t`
// is accurate to well under a millimetre over any realistic maxDist.
// ---------------------------------------------------------------------------

const TERNARY_ITERS = 40;
const BISECT_ITERS = 40;

export function sphereCastObb(origin, dir, radius, maxDist, box, out) {
  const rr = radius * radius;
  const f = (t) => {
    _rayPt.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    _cpTmp.copy(_rayPt).sub(box.center).applyQuaternion(box.invQuaternion);
    const he = box.halfExtents;
    _cpTmp.set(clampNum(_cpTmp.x, -he.x, he.x), clampNum(_cpTmp.y, -he.y, he.y), clampNum(_cpTmp.z, -he.z, he.z));
    _cpTmp.applyQuaternion(box.quaternion).add(box.center);
    return _rayPt.distanceToSquared(_cpTmp) - rr;
  };
  return sweepConvex(f, origin, dir, radius, maxDist, box, out, closestPointObbWorld);
}

/** Swept moving-sphere (radius) vs static sphere shape. Exact (quadratic). */
export function sphereCastSphereShape(origin, dir, radius, maxDist, sphere, out) {
  const inflated = radius + sphere.radius;
  const center = sphere.center;
  const ocx = origin.x - center.x,
    ocy = origin.y - center.y,
    ocz = origin.z - center.z;
  const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - inflated * inflated;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return null;
  if (out) {
    out.distance = t;
    _rayPt.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    // Contact point lies on the STATIC sphere's own surface, not the swept centre.
    _diff.copy(_rayPt).sub(center);
    const d = _diff.length();
    if (d > 1e-9) out.normal.copy(_diff).divideScalar(d);
    else out.normal.set(0, 1, 0);
    out.point.copy(out.normal).multiplyScalar(sphere.radius).add(center);
  }
  return t;
}

function closestPointObbWorld(p, box, out) {
  _cpTmp.copy(p).sub(box.center).applyQuaternion(box.invQuaternion);
  const he = box.halfExtents;
  out
    .set(clampNum(_cpTmp.x, -he.x, he.x), clampNum(_cpTmp.y, -he.y, he.y), clampNum(_cpTmp.z, -he.z, he.z))
    .applyQuaternion(box.quaternion)
    .add(box.center);
  return out;
}

/**
 * Generic convex ternary-search + bisection sweep. `f(t)` must be convex and
 * equal to distanceSquared(point(t), shape) - radius^2.
 */
function sweepConvex(f, origin, dir, radius, maxDist, shape, out, closestPointFn) {
  if (f(0) <= 0) {
    if (out) {
      _rayPt.copy(origin);
      closestPointFn(_rayPt, shape, _cpTmp);
      out.distance = 0;
      out.point.copy(_cpTmp);
      _diff.copy(_rayPt).sub(_cpTmp);
      out.normal.copy(_diff.lengthSq() > 1e-14 ? _diff.normalize() : _diff.set(0, 1, 0));
    }
    return 0;
  }
  let lo = 0,
    hi = maxDist;
  for (let i = 0; i < TERNARY_ITERS; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) < f(m2)) hi = m2;
    else lo = m1;
  }
  const tMin = (lo + hi) / 2;
  if (f(tMin) > 0) return null;
  let a = 0,
    b = tMin;
  for (let i = 0; i < BISECT_ITERS; i++) {
    const mid = (a + b) / 2;
    if (f(mid) > 0) a = mid;
    else b = mid;
  }
  const t = b;
  if (t > maxDist) return null;
  if (out) {
    _rayPt.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    closestPointFn(_rayPt, shape, _cpTmp);
    out.distance = t;
    out.point.copy(_cpTmp);
    _diff.copy(_rayPt).sub(_cpTmp);
    out.normal.copy(_diff.lengthSq() > 1e-14 ? _diff.normalize() : _diff.set(0, 1, 0));
  }
  return t;
}

/**
 * Marched sphere-cast against a heightfield: samples the sphere-bottom
 * clearance along the path at a fixed step derived from cellSize, then
 * bisects the bracketing interval. Approximate — see README limitations.
 */
export function sphereCastHeightfield(origin, dir, radius, maxDist, hf, out) {
  const clearance = (t) => {
    const px = origin.x + dir.x * t;
    const pz = origin.z + dir.z * t;
    const py = origin.y + dir.y * t;
    if (!hf.inBounds(px, pz)) return Infinity;
    return py - radius - hf.heightAt(px, pz);
  };
  const c0 = clearance(0);
  if (c0 !== Infinity && c0 <= 0) {
    if (out) {
      out.distance = 0;
      out.point.set(origin.x, hf.heightAt(origin.x, origin.z), origin.z);
      hf.normalAt(origin.x, origin.z, out.normal);
    }
    return 0;
  }
  const samples = Math.max(8, Math.ceil(maxDist / (hf.cellSize * 0.5)));
  let prevT = 0,
    prevC = c0;
  for (let i = 1; i <= samples; i++) {
    const t = (i / samples) * maxDist;
    const c = clearance(t);
    if (prevC !== Infinity && c !== Infinity && prevC > 0 && c <= 0) {
      let a = prevT,
        b = t;
      for (let k = 0; k < 24; k++) {
        const mid = (a + b) / 2;
        if (clearance(mid) > 0) a = mid;
        else b = mid;
      }
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
    prevC = c;
  }
  return null;
}
