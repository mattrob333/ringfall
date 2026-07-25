// L4 src/ui/panels — reticle. Brief item 3 + FEEL.md §4.8 (aim assist, NOT optional).
//
// Shape depends on `reticle.kind`: auto / burst / precision / shotgun / plasma /
// none. It expands with spreadDeg and, critically, turns red and thickens 12%
// when `reticle.hot` is true — that is the aim-assist red-reticle cue from
// FEEL.md §4.8 and it must be legible, this is a feeltest-adjacent readability
// requirement even though feeltest itself can't see pixels.

import { HUD } from '../../shared/palette.js';
import { withAlpha, lerp } from '../chrome.js';

const HOT_THICKEN = 1.12; // FEEL.md AIM_ASSIST.reticleThicken

export class ReticlePanel {
  constructor() {
    this._geom = null;
    this.spreadDisplay = 0.6;
  }

  resize(w, h, scale) {
    this._geom = { cx: w / 2, cy: h / 2, scale };
  }

  update(dt, spreadDeg) {
    // Light smoothing so bloom/recoil expansion reads as a snap, not a teleport,
    // without needing wall-clock time (dt-driven exponential approach only).
    const target = spreadDeg ?? 0.6;
    const k = 1 - Math.exp(-18 * dt);
    this.spreadDisplay += (target - this.spreadDisplay) * k;
  }

  render(ctx, reticle) {
    const g = this._geom;
    if (!g || !reticle || reticle.kind === 'none') return;
    const { cx, cy, scale } = g;

    const hot = !!reticle.hot;
    const color = hot ? HUD.reticleHot : HUD.reticle;
    const baseWidth = 1.6 * scale * (hot ? HOT_THICKEN : 1);
    // px-per-degree gives the spread a readable, non-trivial expansion.
    const spreadPx = this.spreadDisplay * 3.6 * scale;
    const gap = 6 * scale + spreadPx;
    const len = 8 * scale;

    ctx.save();
    ctx.strokeStyle = withAlpha(color, 0.92);
    ctx.lineWidth = baseWidth;
    ctx.lineCap = 'butt';

    switch (reticle.kind) {
      case 'precision': {
        // fine cross with a centre gap, thin — scoped/precision feel
        ctx.beginPath();
        ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
        ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 1.4 * scale, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(color, 0.9);
        ctx.fill();
        break;
      }
      case 'shotgun': {
        // wide diamond bracket — reads as a spread weapon
        const r = gap + len;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.4, cy - r * 0.4);
        ctx.moveTo(cx + r, cy); ctx.lineTo(cx + r * 0.4, cy + r * 0.4);
        ctx.moveTo(cx, cy + r); ctx.lineTo(cx - r * 0.4, cy + r * 0.4);
        ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.4, cy - r * 0.4);
        ctx.stroke();
        break;
      }
      case 'plasma': {
        // rotated square (diamond) bracket — Vess-weapon signature
        ctx.beginPath();
        ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx + gap * 0.5, cy - gap * 0.5);
        ctx.moveTo(cx + gap + len, cy); ctx.lineTo(cx + gap * 0.5, cy + gap * 0.5);
        ctx.moveTo(cx, cy + gap + len); ctx.lineTo(cx - gap * 0.5, cy + gap * 0.5);
        ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap * 0.5, cy - gap * 0.5);
        ctx.stroke();
        break;
      }
      case 'burst': {
        // three-tick top/bottom marks either side of a standard cross — burst cadence cue
        ctx.beginPath();
        ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
        ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
        ctx.stroke();
        ctx.lineWidth = baseWidth * 0.7;
        ctx.beginPath();
        for (let i = -1; i <= 1; i++) {
          const tx = cx + i * 4 * scale;
          ctx.moveTo(tx, cy - gap - len - 5 * scale);
          ctx.lineTo(tx, cy - gap - len - 2 * scale);
        }
        ctx.stroke();
        break;
      }
      case 'auto':
      default: {
        // standard four-tick cross, gap grows with spread/bloom
        ctx.beginPath();
        ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
        ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}
