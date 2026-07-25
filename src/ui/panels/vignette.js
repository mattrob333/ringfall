// L4 src/ui/panels — low-health state + shield-break screen flare. Brief item 8
// and shield-health.js's flare envelope (FEEL.md §3).
//
// Low-health: red vignette below 40% health (hard requirement). FEEL.md also
// asks for "a desaturation cue you can approximate in 2D". Honest limitation
// (documented at length in README.md): this module draws into the single
// shared HUD canvas the orchestrator hands us, and Canvas2D composite
// operations only blend against pixels already drawn on *this* canvas, not
// against the separate WebGL canvas beneath it in the DOM — there is no way to
// desaturate the world through this API without a second canvas element or a
// CSS mix-blend-mode on the whole HUD layer, and the latter would also recolour
// every other HUD element by the world's hue behind it, which is worse than not
// desaturating at all. So the desaturation cue is *approximated*: a warm-grey
// wash layered under the red vignette, suggesting colour draining at the
// periphery, rather than a literal desaturation of the backdrop.

import { HUD } from '../../shared/palette.js';
import { withAlpha, clamp01 } from '../chrome.js';

const LOW_HEALTH_FRAC = 0.4;

export class VignettePanel {
  constructor() {
    this._geom = null;
    this.pulsePhase = 0;
  }

  resize(w, h, scale) {
    const r0 = Math.min(w, h) * 0.32;
    const r1 = Math.max(w, h) * 0.75;
    this._geom = { w, h, cx: w / 2, cy: h / 2, r0, r1, scale };
  }

  update(dt, healthFrac) {
    if (healthFrac < LOW_HEALTH_FRAC) {
      this.pulsePhase = (this.pulsePhase + dt * 1.4) % (Math.PI * 2);
    } else {
      this.pulsePhase = 0;
    }
  }

  /** Shield-break flare — full screen-edge bloom, driven by shieldHealth.js's envelope. */
  renderShieldFlare(ctx, intensity) {
    if (intensity <= 0) return;
    const g = this._geom;
    if (!g) return;
    const grad = ctx.createRadialGradient(g.cx, g.cy, g.r0 * 0.9, g.cx, g.cy, g.r1);
    grad.addColorStop(0, withAlpha(HUD.shield, 0));
    grad.addColorStop(1, withAlpha(HUD.shield, 0.55 * intensity));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, g.w, g.h);
  }

  render(ctx, healthFrac) {
    if (healthFrac >= LOW_HEALTH_FRAC) return;
    const g = this._geom;
    if (!g) return;
    const severity = clamp01((LOW_HEALTH_FRAC - healthFrac) / LOW_HEALTH_FRAC);
    const pulse = 0.85 + 0.15 * Math.sin(this.pulsePhase);
    const alpha = severity * 0.55 * pulse;

    // desaturation-suggestive warm-grey underlay (see file header)
    const greyGrad = ctx.createRadialGradient(g.cx, g.cy, g.r0 * 0.7, g.cx, g.cy, g.r1);
    greyGrad.addColorStop(0, 'rgba(120,110,105,0)');
    greyGrad.addColorStop(1, `rgba(120,110,105,${(alpha * 0.35).toFixed(3)})`);
    ctx.fillStyle = greyGrad;
    ctx.fillRect(0, 0, g.w, g.h);

    // red vignette
    const grad = ctx.createRadialGradient(g.cx, g.cy, g.r0, g.cx, g.cy, g.r1);
    grad.addColorStop(0, 'rgba(255,60,40,0)');
    grad.addColorStop(1, `rgba(255,40,25,${alpha.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, g.w, g.h);
  }
}
