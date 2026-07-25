// L4 src/ui/panels — damage direction indicator. Brief item 5 / FEEL.md §3, §7.
//
// "An arc at the screen edge at the attacker's bearing, 0.6s, opacity scaled by
// severity. Must resolve bearing to within 30 degrees." Fed by the
// `hud.damageDirection {yaw, severity}` event.
//
// Convention (declared here + README.md, since ARCHITECTURE.md doesn't pin one):
// yaw is signed radians relative to camera forward, 0 = directly ahead,
// positive = clockwise/right, matching `angleDelta` in shared/math.js. The arc
// is drawn on a ring around the screen centre so "ahead" sits at 12 o'clock —
// bearing resolves to better than the required 30 degrees, it is drawn exactly.

import { HUD } from '../../shared/palette.js';
import { withAlpha } from '../chrome.js';

const POOL_SIZE = 6;
const DURATION = 0.6;
const ARC_WIDTH = (34 * Math.PI) / 180; // total angular width of one indicator

export class DamageDirectionPanel {
  constructor() {
    this._slots = Array.from({ length: POOL_SIZE }, () => ({
      active: false, timer: 0, yaw: 0, severity: 1,
    }));
    this._cursor = 0;
    this._geom = null;
  }

  resize(w, h, scale) {
    this._geom = { cx: w / 2, cy: h / 2, r: Math.min(w, h) * 0.46, scale };
  }

  /** @param {{yaw:number, severity:number}} payload */
  spawn(payload) {
    let slot = null;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!this._slots[i].active) { slot = this._slots[i]; break; }
    }
    if (!slot) {
      slot = this._slots[this._cursor];
      this._cursor = (this._cursor + 1) % POOL_SIZE;
    }
    slot.active = true;
    slot.timer = 0;
    slot.yaw = payload.yaw ?? 0;
    slot.severity = Math.min(1, Math.max(0.15, payload.severity ?? 1));
  }

  update(dt) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = this._slots[i];
      if (s.active) {
        s.timer += dt;
        if (s.timer >= DURATION) s.active = false;
      }
    }
  }

  render(ctx) {
    const g = this._geom;
    if (!g) return;
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = this._slots[i];
      if (!s.active) continue;
      const p = s.timer / DURATION;
      const fade = p < 0.1 ? p / 0.1 : 1 - (p - 0.1) / 0.9;
      const alpha = Math.max(0, fade) * s.severity;
      const start = s.yaw - ARC_WIDTH / 2 - Math.PI / 2;
      const end = s.yaw + ARC_WIDTH / 2 - Math.PI / 2;

      ctx.strokeStyle = withAlpha(HUD.danger, alpha);
      ctx.lineWidth = 5 * g.scale;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, start, end, false);
      ctx.stroke();

      // a thin bright core so it reads under a bright sky as well as indoors
      ctx.strokeStyle = withAlpha('#FFFFFF', alpha * 0.5);
      ctx.lineWidth = 1.5 * g.scale;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, start, end, false);
      ctx.stroke();
    }
  }
}
