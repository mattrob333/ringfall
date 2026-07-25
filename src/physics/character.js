// L3 physics — CharacterBody: swept-capsule collide-and-slide with step-up
// and ground-snap. Driven entirely by move(displacement); the owner (L5
// src/player) is responsible for gravity, input, and jump velocity — this
// class only guarantees the capsule cannot pass through world geometry and
// classifies what it is standing on.
import { Vector3 } from 'three';
import { DEG } from '../shared/math.js';
import { SIM_DT } from '../shared/tuning.js';
import { capsuleVsObb, capsuleVsSphere } from './sweep.js';

const SKIN = 0.001; // separation kept after a push-out, prevents re-touch jitter
const MAX_SUBSTEPS = 48; // hard cap regardless of requested distance

// Module-scope scratch. Never retained past a single move() call.
const _startPos = new Vector3();
const _stepDisp = new Vector3();
const _subStart = new Vector3();
const _posA = new Vector3();
const _posB = new Vector3();
const _remaining = new Vector3();
const _candidate = new Vector3();
const _bottom = new Vector3();
const _top = new Vector3();
const _bestNormal = new Vector3();
const _groundNormalA = new Vector3();
const _groundNormalB = new Vector3();
const _hfNormal = new Vector3();
const _topSphereOrigin = new Vector3();
const _bottomSphereOrigin = new Vector3();
const _raisedStart = new Vector3();
const _canStandBottom = new Vector3();
const _canStandTop = new Vector3();
const _pen = { normal: new Vector3(), depth: 0 };
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);

export class CharacterBody {
  /**
   * @param {object} world PhysicsWorld instance (duck-typed: _queryXZ,
   *   _heightfield, _sphereCastStatics — internal, not part of the public API).
   * @param {{position:Vector3, radius:number, height:number, stepHeight?:number,
   *   maxSlopeDeg?:number, entityId?:number, filter?:Function}} spec
   */
  constructor(world, spec) {
    this._world = world;
    this._filter = spec.filter ?? null;
    this.entityId = spec.entityId ?? 0;
    this.radius = spec.radius;
    this.height = Math.max(spec.height, this.radius * 2 + 0.01);
    this.stepHeight = spec.stepHeight ?? 0;
    this.maxSlopeDeg = spec.maxSlopeDeg ?? 45;
    this.position = spec.position.clone();
    this.velocity = new Vector3();
    this.grounded = false;
    this.groundNormal = new Vector3(0, 1, 0);
    this.groundSurfaceId = -1;
    this.lastMoveBlocked = false;
  }

  get _walkableCosine() {
    return Math.cos(this.maxSlopeDeg * DEG);
  }

  setRadiusHeight(r, h) {
    this.radius = r;
    this.height = Math.max(h, r * 2 + 0.01);
  }

  /**
   * Would a capsule of (targetRadius, targetHeight) at the current position
   * overlap any static geometry? Defaults to the current radius/height, i.e.
   * "is where I am right now valid". Used before growing the capsule back
   * up out of a crouch.
   */
  canStand(targetRadius = this.radius, targetHeight = this.height) {
    const r = targetRadius;
    const h = Math.max(targetHeight, r * 2 + 0.01);
    const p = this.position;
    _canStandBottom.set(p.x, p.y + r, p.z);
    _canStandTop.set(p.x, p.y + h - r, p.z);
    const margin = r + 0.001;
    const candidates = this._world._queryXZ(p.x - margin, p.z - margin, p.x + margin, p.z + margin);
    for (let i = 0; i < candidates.length; i++) {
      const shape = candidates[i];
      if (this._filter && !this._filter(shape.entityId, shape.surfaceId)) continue;
      const hit =
        shape.type === 'box'
          ? capsuleVsObb(_canStandBottom, _canStandTop, r, shape, _pen)
          : capsuleVsSphere(_canStandBottom, _canStandTop, r, shape, _pen);
      if (hit) return false;
    }
    const hf = this._world._heightfield;
    if (hf && hf.inBounds(p.x, p.z)) {
      const groundY = hf.heightAt(p.x, p.z);
      if (p.y < groundY - 1e-4) return false;
    }
    return true;
  }

  /**
   * Find the single deepest static-shape penetration for a capsule standing
   * at `pos` (feet position). Returns {normal, depth, surfaceId, handle} or
   * null. Resolving the worst offender first, then re-testing, is what gives
   * us "up to 4 slide iterations" per the contract.
   */
  _findPenetration(pos) {
    const r = this.radius;
    _bottom.set(pos.x, pos.y + r, pos.z);
    _top.set(pos.x, pos.y + this.height - r, pos.z);
    const margin = r + 0.001;
    const candidates = this._world._queryXZ(pos.x - margin, pos.z - margin, pos.x + margin, pos.z + margin);
    let bestDepth = 0;
    let found = false;
    let bestSurface = -1;
    let bestHandle = 0;
    for (let i = 0; i < candidates.length; i++) {
      const shape = candidates[i];
      if (this._filter && !this._filter(shape.entityId, shape.surfaceId)) continue;
      const hit =
        shape.type === 'box'
          ? capsuleVsObb(_bottom, _top, r, shape, _pen)
          : capsuleVsSphere(_bottom, _top, r, shape, _pen);
      if (hit && _pen.depth > bestDepth) {
        bestDepth = _pen.depth;
        _bestNormal.copy(_pen.normal);
        bestSurface = shape.surfaceId;
        bestHandle = shape.handle;
        found = true;
      }
    }
    const hf = this._world._heightfield;
    if (hf && hf.inBounds(pos.x, pos.z)) {
      const groundY = hf.heightAt(pos.x, pos.z);
      if (pos.y < groundY) {
        const depth = groundY - pos.y;
        if (depth > bestDepth) {
          hf.normalAt(pos.x, pos.z, _hfNormal);
          bestDepth = depth;
          _bestNormal.copy(_hfNormal);
          bestSurface = hf.surfaceId;
          bestHandle = 0;
          found = true;
        }
      }
    }
    if (!found) return null;
    return { normal: _bestNormal, depth: bestDepth, surfaceId: bestSurface, handle: bestHandle };
  }

  /**
   * Discrete collide-and-slide from `startPos` by `disp`, up to 4 iterations.
   * Writes the resulting position into `outPos`. Returns {blocked, groundNormal|null, groundSurfaceId}.
   *
   * Invariant: `outPos` is only ever assigned from a `candidate` that tested
   * clear (no penetration) — never from a candidate we then tried to shove
   * out of an obstacle. Each blocked iteration instead clips `remaining`
   * (removing the into-surface component) and retries from the SAME
   * `outPos` with the clipped vector. This is what a standard "slide move"
   * clip loop does; the earlier version of this method instead advanced
   * `outPos` by the un-clipped `remaining` and only pushed out along the
   * normal, which silently re-applied the tangential component on every
   * subsequent iteration (a real bug caught by this module's own selftest —
   * see README.md).
   *
   * Each iteration also binary-searches the largest fraction of `remaining`
   * that keeps the capsule clear (12 fixed iterations — deterministic).
   * Without this, a substep whose full displacement is blocked gets ZERO
   * progress even when most of it was free room (e.g. a wall 0.08m away and
   * a 0.17m substep) — testing only the two endpoints of a discrete substep
   * is not enough once the substep is larger than the remaining clearance.
   */
  _slideFrom(startPos, disp, outPos, groundNormalScratch) {
    outPos.copy(startPos);
    _remaining.copy(disp);
    let blocked = false;
    let groundNormal = null;
    let groundSurfaceId = -1;
    let bestGroundY = -Infinity;

    for (let iter = 0; iter < 4; iter++) {
      if (_remaining.lengthSq() < 1e-12) break;
      _candidate.copy(outPos).add(_remaining);
      let pen = this._findPenetration(_candidate);
      if (!pen) {
        outPos.copy(_candidate);
        _remaining.set(0, 0, 0);
        break;
      }
      blocked = true;

      // Binary search: lo stays a known-clear fraction (invariant: outPos is
      // clear, i.e. fraction 0 is clear), hi a known-blocked fraction.
      let lo = 0,
        hi = 1;
      let contactPen = pen;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) * 0.5;
        _candidate.copy(outPos).addScaledVector(_remaining, mid);
        const p = this._findPenetration(_candidate);
        if (p) {
          hi = mid;
          contactPen = p;
        } else {
          lo = mid;
        }
      }
      outPos.addScaledVector(_remaining, lo);

      if (contactPen.normal.y >= this._walkableCosine && contactPen.normal.y > bestGroundY) {
        bestGroundY = contactPen.normal.y;
        groundNormalScratch.copy(contactPen.normal);
        groundNormal = groundNormalScratch;
        groundSurfaceId = contactPen.surfaceId;
      }

      // Clip the unspent (1-lo) fraction of `remaining` against the contact
      // plane, then let the next iteration retry with what's left.
      _remaining.multiplyScalar(1 - lo);
      const into = _remaining.dot(contactPen.normal);
      if (into < 0) _remaining.addScaledVector(contactPen.normal, -into);
    }

    // Safety net: if outPos itself ended up embedded (accumulated drift,
    // or the loop exhausted its 4 iterations while still blocked), correct
    // it directly. This never fires in the common case.
    const finalPen = this._findPenetration(outPos);
    if (finalPen) {
      outPos.addScaledVector(finalPen.normal, finalPen.depth + SKIN);
      blocked = true;
      if (finalPen.normal.y >= this._walkableCosine && finalPen.normal.y > bestGroundY) {
        groundNormalScratch.copy(finalPen.normal);
        groundNormal = groundNormalScratch;
        groundSurfaceId = finalPen.surfaceId;
      }
    }
    return { blocked, groundNormal, groundSurfaceId };
  }

  /** One small substep of a move(): slide, then try step-up if blocked. */
  _advanceSubstep(disp) {
    _subStart.copy(this.position);
    const resultA = this._slideFrom(_subStart, disp, _posA, _groundNormalA);

    let chosenPos = _posA;
    let chosenGroundNormal = resultA.groundNormal;
    let chosenGroundSurfaceId = resultA.groundSurfaceId;
    let chosenBlocked = resultA.blocked;

    const hasHorizontal = disp.x !== 0 || disp.z !== 0;
    if (resultA.blocked && this.stepHeight > 0 && hasHorizontal) {
      _topSphereOrigin.set(_subStart.x, _subStart.y + this.height - this.radius, _subStart.z);
      const upHit = this._world._sphereCastStatics(
        _topSphereOrigin,
        UP,
        this.radius,
        this.stepHeight,
        this._filter,
      );
      const liftDist = upHit ? Math.max(0, upHit.distance - SKIN) : this.stepHeight;

      if (liftDist > 0.005) {
        _raisedStart.set(_subStart.x, _subStart.y + liftDist, _subStart.z);
        const resultB = this._slideFrom(_raisedStart, disp, _posB, _groundNormalB);

        _bottomSphereOrigin.set(_posB.x, _posB.y + this.radius, _posB.z);
        const settleDist = liftDist + this.stepHeight * 0.2 + 0.05;
        const downHit = this._world._sphereCastStatics(
          _bottomSphereOrigin,
          DOWN,
          this.radius,
          settleDist,
          this._filter,
        );

        // Require the raised slide to be genuinely UNOBSTRUCTED, not merely
        // "advanced further than the unraised attempt". A blocked-but-closer
        // result can happen right at a ledge corner: the down-sweep sphere
        // (radius = capsule radius) touching the corner reports a *blended*
        // normal that can accidentally clear the walkable-slope threshold
        // even though the capsule never actually cleared the obstruction
        // (this is exactly how a 0.5m ledge could get climbed with only a
        // 0.42m stepHeight in an earlier version of this method — the
        // capsule "corner-crawled" its way up one bisection-fraction at a
        // time). Requiring !resultB.blocked means the lift genuinely put the
        // capsule's whole cross-section above the obstruction before we ever
        // trust the down-sweep's normal.
        if (!resultB.blocked && downHit && downHit.normal.y >= this._walkableCosine) {
          const settledY = _posB.y - Math.max(downHit.distance - SKIN, 0);
          const advA = Math.hypot(_posA.x - _subStart.x, _posA.z - _subStart.z);
          const advB = Math.hypot(_posB.x - _subStart.x, _posB.z - _subStart.z);
          if (advB > advA + 1e-6) {
            chosenPos = _posB;
            chosenPos.y = settledY;
            chosenGroundNormal = _groundNormalB.copy(downHit.normal);
            chosenGroundSurfaceId = downHit.surfaceId;
            chosenBlocked = false; // successfully stepped up and settled on the ledge
          }
        }
      }
    }

    this.position.copy(chosenPos);
    if (chosenGroundNormal) {
      this.grounded = true;
      this.groundNormal.copy(chosenGroundNormal);
      this.groundSurfaceId = chosenGroundSurfaceId;
    }
    if (chosenBlocked) this.lastMoveBlocked = true;
  }

  /**
   * Move the capsule by `displacement` this tick. Performs swept-capsule
   * collide-and-slide (fixed-size sub-stepping, see sweep.js for why),
   * step-up over ledges up to stepHeight, and a ground snap so a shallow
   * downhill slope does not launch the character into the air.
   */
  move(displacement) {
    _startPos.copy(this.position);
    const wasGrounded = this.grounded;
    this.lastMoveBlocked = false;
    this.grounded = false;
    this.groundSurfaceId = -1;

    const totalLen = displacement.length();
    if (totalLen > 1e-9) {
      const maxSub = Math.max(this.radius * 0.5, 0.02);
      const numSteps = Math.min(Math.max(1, Math.ceil(totalLen / maxSub)), MAX_SUBSTEPS);
      _stepDisp.copy(displacement).multiplyScalar(1 / numSteps);
      for (let i = 0; i < numSteps; i++) {
        this._advanceSubstep(_stepDisp);
      }
    }

    if (!this.grounded && wasGrounded) {
      _bottomSphereOrigin.set(this.position.x, this.position.y + this.radius, this.position.z);
      const snapDist = this.stepHeight > 0 ? this.stepHeight : 0.3;
      const downHit = this._world._sphereCastStatics(
        _bottomSphereOrigin,
        DOWN,
        this.radius,
        snapDist,
        this._filter,
      );
      if (downHit && downHit.normal.y >= this._walkableCosine) {
        this.position.y -= Math.max(downHit.distance - SKIN, 0);
        this.grounded = true;
        this.groundNormal.copy(downHit.normal);
        this.groundSurfaceId = downHit.surfaceId;
      }
    }

    this.velocity.copy(this.position).sub(_startPos).divideScalar(SIM_DT);
  }
}
