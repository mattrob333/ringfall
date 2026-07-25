// L4 src/ui/panels — shield + health bars. FEEL.md §3, ART.md, brief item 1.
//
// Shield is the visually dominant bar (thicker, brighter, on top). It must
// unmistakably read as full / draining / BROKEN / recharging:
//   full        — solid bright fill, steady frame.
//   draining    — fill shrinks live; a low-shield state adds a slow warning
//                 pulse on the frame so "almost broken" is felt before it pops.
//   BROKEN      — frame snaps to danger red, fill empties, and a screen-edge
//                 flare fires (0.35s bloom-in / 0.9s decay, this module owns the
//                 envelope; index.js paints the actual full-screen flare using
//                 the intensity this panel reports).
//   recharging  — a scanning highlight sweeps the bar as it refills toward the
//                 2.5s-to-full value index.js is already feeding us from state.
//
// All static geometry (frame paths, positions) is computed once in resize() and
// cached on `this` — render() only strokes cached Path2D and fillRects, no
// per-frame Path2D allocation.

import { HUD } from '../../shared/palette.js';
import { chamferRectPath, withAlpha, clamp01, lerp } from '../chrome.js';
import { drawText } from '../glyphs.js';

const BREAK_BLOOM_IN = 0.35;
const BREAK_DECAY = 0.9;

export class ShieldHealthPanel {
  constructor() {
    this.flareActive = false;
    this.flareTimer = 0;
    this.chargeScan = 0; // 0..1 looping phase while recharging
    this.warnPhase = 0; // 0..1 looping phase for low-shield pulse
    this._geom = null;
  }

  resize(w, h, scale) {
    const barW = Math.min(w * 0.26, 420 * scale);
    const shieldH = 15 * scale;
    const healthH = 9 * scale;
    const gap = 4 * scale;
    const cx = w / 2;
    const baseY = h - 58 * scale;

    const shieldX = cx - barW / 2;
    const shieldY = baseY;
    const healthX = shieldX;
    const healthY = baseY + shieldH + gap;

    this._geom = {
      barW, shieldH, healthH, cx,
      shieldX, shieldY, healthX, healthY,
      chamfer: 5 * scale,
      scale,
      shieldFramePath: chamferRectPath(shieldX - 2 * scale, shieldY - 2 * scale, barW + 4 * scale, shieldH + 4 * scale, 6 * scale),
      healthFramePath: chamferRectPath(healthX - 2 * scale, healthY - 2 * scale, barW + 4 * scale, healthH + 4 * scale, 5 * scale),
      labelSize: 11 * scale,
      numSize: 13 * scale,
    };
  }

  /** Call once per shield.broken event for this entity. */
  triggerBreak() {
    this.flareActive = true;
    this.flareTimer = 0;
  }

  update(dt, recharging, shieldFrac) {
    if (this.flareActive) {
      this.flareTimer += dt;
      if (this.flareTimer > BREAK_BLOOM_IN + BREAK_DECAY) this.flareActive = false;
    }
    this.chargeScan = recharging ? (this.chargeScan + dt * 0.55) % 1 : 0;
    if (shieldFrac < 0.2 && shieldFrac > 0) {
      this.warnPhase = (this.warnPhase + dt * 2.2) % 1;
    } else {
      this.warnPhase = 0;
    }
  }

  /** 0..1 envelope for the screen-edge flare. Read by index.js. */
  flareIntensity() {
    if (!this.flareActive) return 0;
    const t = this.flareTimer;
    if (t < BREAK_BLOOM_IN) return t / BREAK_BLOOM_IN;
    const d = (t - BREAK_BLOOM_IN) / BREAK_DECAY;
    return Math.max(0, 1 - d);
  }

  render(ctx, state) {
    const g = this._geom;
    if (!g) return;
    const shieldFrac = clamp01(state.shield / Math.max(1, state.shieldMax));
    const healthFrac = clamp01(state.health / Math.max(1, state.healthMax));
    const broken = state.shield <= 0;

    // --- shield bar ---
    const shieldColor = broken ? HUD.danger : HUD.shield;
    ctx.lineWidth = 1.5 * g.scale;
    ctx.strokeStyle = withAlpha(shieldColor, 0.85);
    ctx.stroke(g.shieldFramePath);

    if (shieldFrac > 0) {
      const fillW = g.barW * shieldFrac;
      ctx.fillStyle = withAlpha(shieldColor, 0.85);
      ctx.fillRect(g.shieldX, g.shieldY, fillW, g.shieldH);

      // low-shield warning pulse on the leading edge
      if (this.warnPhase > 0) {
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(this.warnPhase * Math.PI * 2));
        ctx.fillStyle = withAlpha(HUD.warning, 0.5 * pulse);
        ctx.fillRect(g.shieldX, g.shieldY, fillW, g.shieldH);
      }

      // recharge scan highlight
      if (this.chargeScan > 0) {
        const sx = g.shieldX + fillW * this.chargeScan;
        const sw = Math.max(4 * g.scale, g.barW * 0.06);
        const grad = ctx.createLinearGradient(sx - sw, 0, sx + sw, 0);
        grad.addColorStop(0, withAlpha('#FFFFFF', 0));
        grad.addColorStop(0.5, withAlpha('#FFFFFF', 0.75));
        grad.addColorStop(1, withAlpha('#FFFFFF', 0));
        ctx.fillStyle = grad;
        ctx.fillRect(Math.max(g.shieldX, sx - sw), g.shieldY, Math.min(sw * 2, fillW), g.shieldH);
      }
    } else {
      // BROKEN — empty bar, cracked tick marks across the frame
      const crack = this.flareIntensity();
      if (crack > 0) {
        ctx.strokeStyle = withAlpha('#FFFFFF', 0.7 * crack);
        ctx.lineWidth = 1 * g.scale;
        ctx.beginPath();
        for (let i = 1; i < 5; i++) {
          const px = g.shieldX + (g.barW * i) / 5;
          ctx.moveTo(px - 4 * g.scale, g.shieldY - 2 * g.scale);
          ctx.lineTo(px + 3 * g.scale, g.shieldY + g.shieldH + 2 * g.scale);
        }
        ctx.stroke();
      }
    }

    // --- health bar ---
    ctx.lineWidth = 1.25 * g.scale;
    ctx.strokeStyle = withAlpha(HUD.health, 0.8);
    ctx.stroke(g.healthFramePath);
    if (healthFrac > 0) {
      const lowHealth = healthFrac < 0.4;
      ctx.fillStyle = withAlpha(lowHealth ? HUD.danger : HUD.health, 0.85);
      ctx.fillRect(g.healthX, g.healthY, g.barW * healthFrac, g.healthH);
    }

    // --- numeric readouts ---
    drawText(ctx, 'SHIELD', g.shieldX, g.shieldY - g.labelSize * 1.3, g.labelSize * 0.62, {
      color: withAlpha(shieldColor, 0.75),
    });
    drawText(ctx, String(Math.ceil(state.shield)), g.shieldX + g.barW, g.shieldY - g.labelSize * 1.3, g.numSize * 0.62, {
      color: shieldColor, align: 'right',
    });
    drawText(ctx, 'HP', g.healthX, g.healthY + g.healthH + 3 * g.scale, g.labelSize * 0.55, {
      color: withAlpha(HUD.health, 0.75),
    });
    drawText(ctx, String(Math.ceil(state.health)), g.healthX + g.barW, g.healthY + g.healthH + 3 * g.scale, g.numSize * 0.55, {
      color: HUD.health, align: 'right',
    });
  }
}
