// L4 src/ui/panels — hitmarker. Brief item 4 / FEEL.md §7.
//
// "Visually DISTINCT for shielded hit vs unshielded hit vs headshot vs kill."
// and the kill confirmation must never be mistakable for a plain hitmarker.
// Fed exclusively by the `hud.hitmarker {shielded, killed, headshot}` event via
// wireHudEvents — this panel owns a small fixed-size effect pool so bursts of
// hits (e.g. a shotgun's 12 pellets) never allocate.

import { HUD } from '../../shared/palette.js';
import { withAlpha } from '../chrome.js';

const POOL_SIZE = 10;
const DUR_PLAIN = 0.15;
const DUR_SHIELDED = 0.2;
const DUR_HEADSHOT = 0.24;
const DUR_KILL = 0.42;

export class HitmarkerPanel {
  constructor() {
    this._slots = Array.from({ length: POOL_SIZE }, () => ({
      active: false, timer: 0, duration: DUR_PLAIN, shielded: false, headshot: false, killed: false,
    }));
    this._cursor = 0;
    this._geom = null;
  }

  resize(w, h, scale) {
    this._geom = { cx: w / 2, cy: h / 2, scale };
  }

  /** @param {{shielded?:boolean, killed?:boolean, headshot?:boolean}} payload */
  spawn(payload) {
    // Reuse the oldest slot round-robin — bounded pool, zero allocation.
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
    slot.shielded = !!payload.shielded;
    slot.headshot = !!payload.headshot;
    slot.killed = !!payload.killed;
    slot.duration = slot.killed ? DUR_KILL : slot.headshot ? DUR_HEADSHOT : slot.shielded ? DUR_SHIELDED : DUR_PLAIN;
  }

  update(dt) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = this._slots[i];
      if (s.active) {
        s.timer += dt;
        if (s.timer >= s.duration) s.active = false;
      }
    }
  }

  render(ctx) {
    const g = this._geom;
    if (!g) return;
    const { cx, cy, scale } = g;
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = this._slots[i];
      if (!s.active) continue;
      const p = s.timer / s.duration; // 0..1
      if (s.killed) this._drawKill(ctx, cx, cy, scale, p);
      else if (s.headshot) this._drawHeadshot(ctx, cx, cy, scale, p);
      else if (s.shielded) this._drawShielded(ctx, cx, cy, scale, p);
      else this._drawPlain(ctx, cx, cy, scale, p);
    }
  }

  _drawPlain(ctx, cx, cy, scale, p) {
    const alpha = 1 - p;
    const r = (5 + p * 2) * scale;
    ctx.strokeStyle = withAlpha(HUD.reticle, alpha);
    ctx.lineWidth = 1.6 * scale;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx - r * 0.4, cy - r * 0.4);
    ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx + r * 0.4, cy - r * 0.4);
    ctx.moveTo(cx - r, cy + r); ctx.lineTo(cx - r * 0.4, cy + r * 0.4);
    ctx.moveTo(cx + r, cy + r); ctx.lineTo(cx + r * 0.4, cy + r * 0.4);
    ctx.stroke();
  }

  _drawShielded(ctx, cx, cy, scale, p) {
    const alpha = 1 - p;
    const r = (9 - p * 3) * scale; // contracts inward — "absorbed" read
    ctx.strokeStyle = withAlpha(HUD.shield, alpha);
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
  }

  _drawHeadshot(ctx, cx, cy, scale, p) {
    this._drawPlain(ctx, cx, cy, scale, p);
    const alpha = 1 - p;
    const r = (7 + p * 3) * scale;
    ctx.strokeStyle = withAlpha(HUD.warning, alpha);
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6, cy - r - 3 * scale);
    ctx.lineTo(cx, cy - r - 8 * scale);
    ctx.lineTo(cx + r * 0.6, cy - r - 3 * scale);
    ctx.stroke();
  }

  _drawKill(ctx, cx, cy, scale, p) {
    // Deliberately the biggest, brightest, longest-lived marker in the set so it
    // is never confused with a plain hitmarker (FEEL.md §7).
    const alpha = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
    const r = (10 + p * 14) * scale;
    ctx.strokeStyle = withAlpha('#FFFFFF', Math.max(0, alpha));
    ctx.lineWidth = 2.6 * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
    // four accent ticks flying outward
    const tickR = r + 6 * scale;
    ctx.lineWidth = 1.8 * scale;
    ctx.strokeStyle = withAlpha(HUD.danger, Math.max(0, alpha));
    ctx.beginPath();
    const dirs = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of dirs) {
      const x0 = cx + dx * (tickR - 5 * scale);
      const y0 = cy + dy * (tickR - 5 * scale);
      const x1 = cx + dx * (tickR + 5 * scale);
      const y1 = cy + dy * (tickR + 5 * scale);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }
}
