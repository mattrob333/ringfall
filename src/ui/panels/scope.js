// L4 src/ui/panels — scope overlay. Brief item 7 / FEEL.md §4.4.
//
// "A black vignette mask (a MASK, not a blur) with a magnification readout.
// Must not be a full-screen dark tint that kills readability." Implemented by
// filling the frame opaque black then cutting a transparent hole with
// `destination-out` — genuinely a mask (full alpha=0 inside the circle,
// alpha=1 outside), not a translucency trick, so the scene stays perfectly
// readable through the aperture.

import { HUD } from '../../shared/palette.js';
import { withAlpha } from '../chrome.js';
import { drawText } from '../glyphs.js';

export class ScopePanel {
  constructor() {
    this._geom = null;
  }

  resize(w, h, scale) {
    const r = Math.min(w, h) * 0.42;
    this._geom = { w, h, cx: w / 2, cy: h / 2, r, scale };
  }

  render(ctx, weapon) {
    if (!weapon?.scoped) return;
    const g = this._geom;
    if (!g) return;
    const { w, h, cx, cy, r, scale } = g;

    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // punch the circular aperture — a real mask, alpha 0 inside
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // slight binocular figure-eight lobes so it reads as a scope, not a hole punch
    ctx.beginPath();
    ctx.arc(cx - r * 0.02, cy, r * 0.985, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // bridge struts across the aperture (thin, physical scope-body read)
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.18, cy);
    ctx.moveTo(cx + r * 0.18, cy); ctx.lineTo(cx + r, cy);
    ctx.stroke();

    // rim highlight
    ctx.strokeStyle = withAlpha(HUD.primary, 0.5);
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // precision reticle inside the aperture
    ctx.strokeStyle = withAlpha(HUD.reticle, 0.85);
    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.7); ctx.lineTo(cx, cy - 6 * scale);
    ctx.moveTo(cx, cy + 6 * scale); ctx.lineTo(cx, cy + r * 0.7);
    ctx.moveTo(cx - r * 0.7, cy); ctx.lineTo(cx - 6 * scale, cy);
    ctx.moveTo(cx + 6 * scale, cy); ctx.lineTo(cx + r * 0.7, cy);
    ctx.stroke();
    // range/mil ticks
    for (let i = 1; i <= 3; i++) {
      const ty = cy - 6 * scale - i * r * 0.16;
      ctx.beginPath();
      ctx.moveTo(cx - 4 * scale, ty); ctx.lineTo(cx + 4 * scale, ty);
      ctx.stroke();
    }

    // magnification readout, bottom of the aperture
    const mag = weapon.magnification ?? 1;
    drawText(ctx, `${mag}X`, cx, cy + r * 0.78, 16 * scale, {
      color: HUD.primary, align: 'center',
    });

    ctx.restore();
  }
}
