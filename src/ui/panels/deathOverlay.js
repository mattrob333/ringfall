// L4 src/ui/panels — death / respawn overlay. Brief item 10.

import { HUD } from '../../shared/palette.js';
import { withAlpha } from '../chrome.js';
import { drawText } from '../glyphs.js';

const FADE_IN = 0.5;
const FADE_OUT = 0.35;

export class DeathOverlayPanel {
  constructor() {
    this._geom = null;
    this.alpha = 0;
    this._wasDead = false;
  }

  resize(w, h, scale) {
    this._geom = { w, h, cx: w / 2, cy: h / 2, scale };
  }

  update(dt, dead) {
    const target = dead ? 1 : 0;
    const rate = dead ? 1 / FADE_IN : 1 / FADE_OUT;
    const delta = rate * dt;
    if (this.alpha < target) this.alpha = Math.min(target, this.alpha + delta);
    else if (this.alpha > target) this.alpha = Math.max(target, this.alpha - delta);
    this._wasDead = dead;
  }

  render(ctx) {
    if (this.alpha <= 0) return;
    const g = this._geom;
    if (!g) return;
    ctx.save();
    ctx.fillStyle = `rgba(4,6,6,${(0.78 * this.alpha).toFixed(3)})`;
    ctx.fillRect(0, 0, g.w, g.h);

    const textAlpha = Math.max(0, (this.alpha - 0.3) / 0.7);
    if (textAlpha > 0) {
      drawText(ctx, 'ELIMINATED', g.cx, g.cy - 24 * g.scale, 30 * g.scale, {
        color: withAlpha(HUD.danger, textAlpha), align: 'center', weight: 1.3,
      });
      drawText(ctx, 'AWAITING RESPAWN', g.cx, g.cy + 18 * g.scale, 11 * g.scale, {
        color: withAlpha(HUD.primary, textAlpha * 0.8), align: 'center',
      });
    }
    ctx.restore();
  }
}
