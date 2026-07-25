// L3 physics — public API. ARCHITECTURE.md §2.2, §3: this module (and
// everything it imports from ./*) must stay headless — no `src/render`
// import, ever (tools/feeltest.mjs runs the whole simulation with rendering
// disabled). Permitted imports: three, ../shared/*, ../core/*.
//
// See README.md for the algorithms used and their determinism argument.
import { Vector3 } from 'three';
import { StaticBox, StaticSphere, Heightfield, raySphere, rayObb, rayHeightfield, closestPointOnObb, pointInObb, pointInSphere } from './geometry.js';
import { capsuleVsObb, capsuleVsSphere, sphereCastObb, sphereCastSphereShape, sphereCastHeightfield } from './sweep.js';
import { UniformGrid } from './grid.js';
import { CharacterBody } from './character.js';
import { DynamicBody } from './body.js';

export { capsuleVsObb, capsuleVsSphere, raySphere, rayObb, rayHeightfield, sphereCastObb, sphereCastSphereShape, sphereCastHeightfield };
export { CharacterBody, DynamicBody };

// ---------------------------------------------------------------------------
// Internal scratch (module scope, never exported as public API).
// ---------------------------------------------------------------------------
const _corner = new Vector3();
const _bounds = [0, 0, 0, 0];
const _tmpHit = { point: new Vector3(), normal: new Vector3(), distance: 0 }; // per-candidate scratch
const _tmpHit2 = { point: new Vector3(), normal: new Vector3(), distance: 0 };
const _tmpPt = new Vector3();

function makeHitRecord() {
  return { hit: true, point: new Vector3(), normal: new Vector3(), distance: 0, surfaceId: -1, entityId: 0, handle: 0 };
}

function obbXZBounds(box, out) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  const he = box.halfExtents;
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        _corner.set(sx * he.x, sy * he.y, sz * he.z).applyQuaternion(box.quaternion).add(box.center);
        if (_corner.x < minX) minX = _corner.x;
        if (_corner.x > maxX) maxX = _corner.x;
        if (_corner.z < minZ) minZ = _corner.z;
        if (_corner.z > maxZ) maxZ = _corner.z;
      }
    }
  }
  out[0] = minX;
  out[1] = minZ;
  out[2] = maxX;
  out[3] = maxZ;
  return out;
}

export class PhysicsWorld {
  constructor({ cellSize = 8 } = {}) {
    this._grid = new UniformGrid(cellSize);
    this._gridDirty = false;
    this._boxes = [];
    this._spheres = [];
    this._heightfield = null;
    this._shapesByHandle = new Map(); // setup-time lookup only, never iterated
    this._nextHandle = 1;

    this._characters = [];
    this._bodies = [];

    this._queryScratch = []; // reused by _queryXZ / grid.query
    this._hit = makeHitRecord(); // the ONE shared record returned by the public queries
    this._pointInSolidResult = { surfaceId: -1, entityId: 0, handle: 0 };
  }

  // -- statics ----------------------------------------------------------

  addStaticBox(center, halfExtents, quaternion, surfaceId, entityId = 0) {
    const handle = this._nextHandle++;
    const shape = new StaticBox(handle, center, halfExtents, quaternion, surfaceId, entityId);
    this._boxes.push(shape);
    this._shapesByHandle.set(handle, shape);
    this._gridDirty = true;
    return handle;
  }

  addStaticSphere(center, radius, surfaceId, entityId = 0) {
    const handle = this._nextHandle++;
    const shape = new StaticSphere(handle, center, radius, surfaceId, entityId);
    this._spheres.push(shape);
    this._shapesByHandle.set(handle, shape);
    this._gridDirty = true;
    return handle;
  }

  /** Replaces any previous heightfield — the world holds at most one. */
  setHeightfield({ origin, cellSize, width, depth, heights, surfaceId }) {
    if (this._heightfield) this._shapesByHandle.delete(this._heightfield.handle);
    const handle = this._nextHandle++;
    const hf = new Heightfield({ origin, cellSize, width, depth, heights, surfaceId });
    hf.handle = handle;
    this._heightfield = hf;
    this._shapesByHandle.set(handle, hf);
    return handle;
  }

  removeStatic(handle) {
    const shape = this._shapesByHandle.get(handle);
    if (!shape) return;
    if (shape === this._heightfield) this._heightfield = null;
    else shape.removed = true;
    this._shapesByHandle.delete(handle);
    this._gridDirty = true;
  }

  clearStatics() {
    this._boxes.length = 0;
    this._spheres.length = 0;
    this._heightfield = null;
    this._shapesByHandle.clear();
    this._nextHandle = 1;
    this._grid.clear();
    this._gridDirty = false;
  }

  _ensureGrid() {
    if (!this._gridDirty) return;
    this._grid.clear();
    for (let i = 0; i < this._boxes.length; i++) {
      const shape = this._boxes[i];
      if (shape.removed) continue;
      obbXZBounds(shape, _bounds);
      this._grid.insert(shape, _bounds[0], _bounds[1], _bounds[2], _bounds[3]);
    }
    for (let i = 0; i < this._spheres.length; i++) {
      const shape = this._spheres[i];
      if (shape.removed) continue;
      this._grid.insert(
        shape,
        shape.center.x - shape.radius,
        shape.center.z - shape.radius,
        shape.center.x + shape.radius,
        shape.center.z + shape.radius,
      );
    }
    this._gridDirty = false;
  }

  /** Internal: candidate boxes/spheres overlapping an XZ box. Reused scratch array — consume immediately. */
  _queryXZ(minX, minZ, maxX, maxZ) {
    this._ensureGrid();
    this._grid.query(minX, minZ, maxX, maxZ, this._queryScratch);
    return this._queryScratch;
  }

  /**
   * Internal: swept sphere vs every static (grid-indexed boxes/spheres +
   * the heightfield). Returns a hit record owned by this call site's caller
   * contract — same "immediately consumed" rule as the public queries, but
   * this one is a *different* object than the public this._hit so that an
   * internal CCD/character sweep mid-frame can never clobber a hit the
   * caller obtained from the public API earlier in the same tick.
   */
  _sphereCastStatics(origin, dir, radius, maxDist, filter) {
    this._ensureGrid();
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    const minX = Math.min(origin.x, ex) - radius;
    const maxX = Math.max(origin.x, ex) + radius;
    const minZ = Math.min(origin.z, ez) - radius;
    const maxZ = Math.max(origin.z, ez) + radius;
    const candidates = this._queryXZ(minX, minZ, maxX, maxZ);
    let bestT = maxDist;
    let found = false;
    for (let i = 0; i < candidates.length; i++) {
      const shape = candidates[i];
      if (filter && !filter(shape.entityId, shape.surfaceId)) continue;
      const t =
        shape.type === 'box'
          ? sphereCastObb(origin, dir, radius, bestT, shape, _tmpHit2)
          : sphereCastSphereShape(origin, dir, radius, bestT, shape, _tmpHit2);
      if (t !== null && t <= bestT) {
        bestT = t;
        found = true;
        _tmpHit.point.copy(_tmpHit2.point);
        _tmpHit.normal.copy(_tmpHit2.normal);
        _tmpHit.distance = t;
        _tmpHit.surfaceId = shape.surfaceId;
        _tmpHit.entityId = shape.entityId;
        _tmpHit.handle = shape.handle;
      }
    }
    if (this._heightfield && !(filter && !filter(this._heightfield.entityId, this._heightfield.surfaceId))) {
      const t = sphereCastHeightfield(origin, dir, radius, bestT, this._heightfield, _tmpHit2);
      if (t !== null && t <= bestT) {
        bestT = t;
        found = true;
        _tmpHit.point.copy(_tmpHit2.point);
        _tmpHit.normal.copy(_tmpHit2.normal);
        _tmpHit.distance = t;
        _tmpHit.surfaceId = this._heightfield.surfaceId;
        _tmpHit.entityId = 0;
        _tmpHit.handle = this._heightfield.handle;
      }
    }
    return found ? _tmpHit : null;
  }

  // -- bodies -------------------------------------------------------------

  addCharacter(spec) {
    const body = new CharacterBody(this, spec);
    this._characters.push(body);
    return body;
  }

  addBody(spec) {
    const body = new DynamicBody(spec);
    this._bodies.push(body);
    return body;
  }

  remove(body) {
    let i = this._characters.indexOf(body);
    if (i >= 0) {
      this._characters.splice(i, 1);
      return;
    }
    i = this._bodies.indexOf(body);
    if (i >= 0) this._bodies.splice(i, 1);
  }

  /** Integrates DynamicBody only. CharacterBody is driven by its owner via move(). */
  step(dt) {
    for (let i = 0; i < this._bodies.length; i++) {
      this._bodies[i]._step(dt, this);
    }
  }

  // -- public queries -------------------------------------------------------
  // Every query below returns null or `this._hit` — a single shared record.
  // Copy the fields you need before calling another query.

  raycast(origin, dir, maxDist, filter) {
    this._ensureGrid();
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    const candidates = this._queryXZ(Math.min(origin.x, ex), Math.min(origin.z, ez), Math.max(origin.x, ex), Math.max(origin.z, ez));
    let bestT = maxDist;
    let found = false;
    for (let i = 0; i < candidates.length; i++) {
      const shape = candidates[i];
      if (filter && !filter(shape.entityId, shape.surfaceId)) continue;
      const t = shape.type === 'box' ? rayObb(origin, dir, shape, bestT, _tmpHit) : raySphere(origin, dir, shape.center, shape.radius, bestT, _tmpHit);
      if (t !== null) {
        bestT = t;
        found = true;
        this._hit.point.copy(_tmpHit.point);
        this._hit.normal.copy(_tmpHit.normal);
        this._hit.distance = t;
        this._hit.surfaceId = shape.surfaceId;
        this._hit.entityId = shape.entityId;
        this._hit.handle = shape.handle;
      }
    }
    if (this._heightfield && !(filter && !filter(this._heightfield.entityId, this._heightfield.surfaceId))) {
      const t = rayHeightfield(origin, dir, this._heightfield, bestT, _tmpHit);
      if (t !== null) {
        bestT = t;
        found = true;
        this._hit.point.copy(_tmpHit.point);
        this._hit.normal.copy(_tmpHit.normal);
        this._hit.distance = t;
        this._hit.surfaceId = this._heightfield.surfaceId;
        this._hit.entityId = 0;
        this._hit.handle = this._heightfield.handle;
      }
    }
    return found ? this._hit : null;
  }

  sphereCast(origin, dir, radius, maxDist, filter) {
    const hit = this._sphereCastStatics(origin, dir, radius, maxDist, filter);
    if (!hit) return null;
    this._hit.point.copy(hit.point);
    this._hit.normal.copy(hit.normal);
    this._hit.distance = hit.distance;
    this._hit.surfaceId = hit.surfaceId;
    this._hit.entityId = hit.entityId;
    this._hit.handle = hit.handle;
    return this._hit;
  }

  /** Fills `out` (caller-owned array, grown lazily — reuse it across calls for zero steady-state allocation). */
  overlapSphere(center, radius, out, filter) {
    this._ensureGrid();
    const candidates = this._queryXZ(center.x - radius, center.z - radius, center.x + radius, center.z + radius);
    let count = 0;
    for (let i = 0; i < candidates.length; i++) {
      const shape = candidates[i];
      if (filter && !filter(shape.entityId, shape.surfaceId)) continue;
      let dist, px, py, pz;
      if (shape.type === 'box') {
        closestPointOnObb(center, shape, _tmpPt);
        dist = center.distanceTo(_tmpPt);
        if (dist > radius && !pointInObb(center, shape)) continue;
        px = _tmpPt.x;
        py = _tmpPt.y;
        pz = _tmpPt.z;
      } else {
        const d = center.distanceTo(shape.center);
        dist = d - shape.radius;
        if (dist > radius) continue;
        const dir = d > 1e-9 ? 1 / d : 0;
        px = shape.center.x + (center.x - shape.center.x) * dir * shape.radius;
        py = shape.center.y + (center.y - shape.center.y) * dir * shape.radius;
        pz = shape.center.z + (center.z - shape.center.z) * dir * shape.radius;
      }
      if (!out[count]) out[count] = { entityId: 0, point: new Vector3(), distance: 0 };
      out[count].entityId = shape.entityId;
      out[count].point.set(px, py, pz);
      out[count].distance = dist;
      count++;
    }
    if (this._heightfield && this._heightfield.inBounds(center.x, center.z)) {
      if (!(filter && !filter(this._heightfield.entityId, this._heightfield.surfaceId))) {
        const groundY = this._heightfield.heightAt(center.x, center.z);
        const dist = center.y - radius - groundY;
        if (dist <= radius) {
          if (!out[count]) out[count] = { entityId: 0, point: new Vector3(), distance: 0 };
          out[count].entityId = 0;
          out[count].point.set(center.x, groundY, center.z);
          out[count].distance = dist;
          count++;
        }
      }
    }
    return count;
  }

  pointInSolid(point) {
    this._ensureGrid();
    const candidates = this._queryXZ(point.x - 0.001, point.z - 0.001, point.x + 0.001, point.z + 0.001);
    for (let i = 0; i < candidates.length; i++) {
      const shape = candidates[i];
      const inside = shape.type === 'box' ? pointInObb(point, shape) : pointInSphere(point, shape);
      if (inside) {
        this._pointInSolidResult.surfaceId = shape.surfaceId;
        this._pointInSolidResult.entityId = shape.entityId;
        this._pointInSolidResult.handle = shape.handle;
        return this._pointInSolidResult;
      }
    }
    if (this._heightfield && this._heightfield.inBounds(point.x, point.z)) {
      if (point.y < this._heightfield.heightAt(point.x, point.z)) {
        this._pointInSolidResult.surfaceId = this._heightfield.surfaceId;
        this._pointInSolidResult.entityId = 0;
        this._pointInSolidResult.handle = this._heightfield.handle;
        return this._pointInSolidResult;
      }
    }
    return null;
  }
}
