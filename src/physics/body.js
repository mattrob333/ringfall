// L3 physics — DynamicBody: a sphere integrated with continuous collision
// (sphere-cast the whole remaining motion each bounce — exact, not a
// substep approximation, see sweep.js). Used for grenades and debris.
import { Vector3 } from 'three';
import { GRAVITY, TERMINAL_VELOCITY } from '../shared/tuning.js';
import { SURFACE_PHYSICS } from '../shared/enums.js';
import { clamp } from '../shared/math.js';

const MAX_BOUNCES_PER_STEP = 4;
const SKIN = 0.001;
const SLEEP_LINGER = 0.4; // seconds below sleepThreshold before actually sleeping

const _dir = new Vector3();
const _vn = new Vector3();
const _vt = new Vector3();

export class DynamicBody {
  constructor(spec) {
    this.entityId = spec.entityId ?? 0;
    this.position = spec.position.clone();
    this.velocity = (spec.velocity ?? new Vector3()).clone();
    this.radius = spec.radius;
    this.restitution = spec.restitution ?? 0.5;
    this.friction = spec.friction ?? 0.5;
    this.sleepThreshold = spec.sleepThreshold ?? 0.05;
    this.sleeping = false;
    this.onCollide = spec.onCollide ?? null;
    /** @type {null|{entityId:number, localPoint:Vector3}} */
    this.stuckTo = null;
    this._sleepTimer = 0;
    this.filter = spec.filter ?? null;
  }

  /** Called by PhysicsWorld.step(dt). `world` supplies the internal static-query API. */
  _step(dt, world) {
    if (this.sleeping || this.stuckTo) return;

    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -TERMINAL_VELOCITY) this.velocity.y = -TERMINAL_VELOCITY;

    let remaining = dt;
    let bounces = 0;
    while (remaining > 1e-9 && bounces < MAX_BOUNCES_PER_STEP) {
      const speed = this.velocity.length();
      if (speed < 1e-9) break;
      _dir.copy(this.velocity).divideScalar(speed);
      const maxDist = speed * remaining;
      const hit = world._sphereCastStatics(this.position, _dir, this.radius, maxDist, this.filter);
      if (!hit) {
        this.position.addScaledVector(this.velocity, remaining);
        remaining = 0;
        break;
      }
      this.position.addScaledVector(_dir, hit.distance);
      const consumed = speed > 0 ? hit.distance / speed : remaining;
      remaining -= consumed;

      const vnScalar = this.velocity.dot(hit.normal);
      _vn.copy(hit.normal).multiplyScalar(vnScalar);
      _vt.copy(this.velocity).sub(_vn);

      const surf = SURFACE_PHYSICS[hit.surfaceId] ?? { restitution: 0.3, friction: 0.6 };
      const restitution = clamp(this.restitution * surf.restitution, 0, 1);
      const friction = clamp(this.friction * surf.friction, 0, 1);

      const impactSpeed = -vnScalar;
      this.velocity.copy(_vn).multiplyScalar(-restitution).addScaledVector(_vt, 1 - friction);
      this.position.addScaledVector(hit.normal, SKIN);

      if (this.onCollide && impactSpeed > 0) {
        this.onCollide(hit.point, hit.normal, impactSpeed, hit.surfaceId, hit.entityId);
      }
      bounces++;
    }

    if (this.velocity.lengthSq() < this.sleepThreshold * this.sleepThreshold) {
      this._sleepTimer += dt;
      if (this._sleepTimer >= SLEEP_LINGER) {
        this.sleeping = true;
        this.velocity.set(0, 0, 0);
      }
    } else {
      this._sleepTimer = 0;
    }
  }
}
