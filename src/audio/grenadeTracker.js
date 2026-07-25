// L3 audio — best-effort ballistic tracking for the enemy-grenade proximity
// tick (FEEL.md §7). `grenade.thrown` gives an origin/velocity/fuse but no
// grenadeId, and `grenade.bounced`/`.stuck`/`.detonated` carry a grenadeId
// that `.thrown` never supplies — so per-grenade correlation across the
// bounce/detonate lifecycle isn't possible from the event stream alone (see
// DEFECTS.md). This tracker instead free-falls each thrown grenade under the
// shared GRAVITY constant and expires it after its fuse elapses. It is an
// approximation for "is an enemy grenade nearby", not a physics replica.

import { GRAVITY } from '../shared/tuning.js';
import { toXYZ } from './spatial.js';

export class GrenadeTracker {
  constructor() {
    this.items = [];
  }

  /** @param {{ownerId:number, origin, velocity, fuseMs:number}} payload */
  track(payload) {
    if (!payload.origin || !payload.velocity) return;
    const v = toXYZ(payload.velocity);
    this.items.push({
      ownerId: payload.ownerId,
      pos: toXYZ(payload.origin),
      vel: { x: v.x, y: v.y, z: v.z },
      life: (payload.fuseMs ?? 3000) / 1000 + 0.4,
      tickTimer: 0,
    });
  }

  update(dt) {
    for (const it of this.items) {
      it.vel.y -= GRAVITY * dt;
      it.pos.x += it.vel.x * dt;
      it.pos.y += it.vel.y * dt;
      it.pos.z += it.vel.z * dt;
      it.life -= dt;
      it.tickTimer -= dt;
    }
    if (this.items.length) this.items = this.items.filter((it) => it.life > 0);
  }

  clear() {
    this.items.length = 0;
  }
}
