// L4 src/ui/panels — motion tracker. Brief item 2: "a defining era signature."
//
// Circular radar, bottom-left, player-relative. Convention (undocumented by the
// state shape, so declared here and in README.md): +z is forward, +x is right,
// metres. Forward is drawn as "up" (12 o'clock) on the dial, matching every
// reference-era motion tracker.
//
// Contact positions vary every frame so their draw geometry cannot be cached
// like the static dial chrome; diamonds are drawn with immediate ctx.beginPath
// calls (no `new Path2D()` per blip) to keep the per-frame allocation footprint
// at "one path-builder buffer the browser already owns", not a JS object churn.

import { HUD } from '../../shared/palette.js';
import { withAlpha, clamp01 } from '../chrome.js';
import { drawText } from '../glyphs.js';

const SWEEP_PERIOD = 2.6; // seconds per revolution

export class TrackerPanel {
  constructor() {
    this.sweepPhase = 0; // radians, 0..2PI
    this._geom = null;
  }

  resize(w, h, scale) {
    const r = 64 * scale;
    const cx = 34 * scale + r;
    const cy = h - 34 * scale - r;
    this._geom = {
      cx, cy, r, scale,
      ringR: [r * 0.34, r * 0.67, r],
    };
  }

  update(dt) {
    this.sweepPhase = (this.sweepPhase + (dt / SWEEP_PERIOD) * Math.PI * 2) % (Math.PI * 2);
  }

  render(ctx, tracker) {
    const g = this._geom;
    if (!g) return;
    const { cx, cy, r, scale } = g;
    const range = Math.max(1, tracker?.rangeM ?? 40);

    ctx.save();

    // dial background + frame
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 20, 18, 0.45)';
    ctx.fill();

    for (const rr of g.ringR) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(HUD.primaryDim, 0.5);
      ctx.lineWidth = 1 * scale;
      ctx.stroke();
    }
    // N/S/E/W ticks
    ctx.strokeStyle = withAlpha(HUD.primary, 0.55);
    ctx.lineWidth = 1.25 * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r + 6 * scale);
    ctx.moveTo(cx, cy + r); ctx.lineTo(cx, cy + r - 6 * scale);
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r + 6 * scale, cy);
    ctx.moveTo(cx + r, cy); ctx.lineTo(cx + r - 6 * scale, cy);
    ctx.stroke();

    // outer frame
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(HUD.primary, 0.85);
    ctx.lineWidth = 1.75 * scale;
    ctx.stroke();

    // rotating sweep wedge (fading trail behind the leading edge)
    const sweepSpan = Math.PI * 0.32;
    const grad = ctx.createConicGradient
      ? ctx.createConicGradient(this.sweepPhase - sweepSpan, cx, cy)
      : null;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, this.sweepPhase - sweepSpan, this.sweepPhase, false);
    ctx.closePath();
    if (grad) {
      grad.addColorStop(0, withAlpha(HUD.primary, 0));
      grad.addColorStop(1, withAlpha(HUD.primary, 0.28));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = withAlpha(HUD.primary, 0.12);
    }
    ctx.fill();
    ctx.restore();

    // player marker: forward-facing wedge at centre
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6 * scale);
    ctx.lineTo(cx + 4.5 * scale, cy + 4 * scale);
    ctx.lineTo(cx, cy + 1.5 * scale);
    ctx.lineTo(cx - 4.5 * scale, cy + 4 * scale);
    ctx.closePath();
    ctx.fillStyle = HUD.reticle;
    ctx.fill();

    // contacts
    const entries = tracker?.entries;
    if (entries && entries.length) {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const dist = Math.hypot(e.x, e.z);
        const clamped = Math.min(dist, range);
        const px = cx + (e.x / range) * r * (clamped / Math.max(dist, 0.0001));
        const py = cy - (e.z / range) * r * (clamped / Math.max(dist, 0.0001));
        // fade over the outer 12% of the dial so contacts approaching max range
        // dissolve instead of hard-clipping at the rim
        const edge = clamp01((1 - clamped / range) / 0.12);
        const alpha = 0.45 + 0.55 * edge;
        const color = e.hostile ? HUD.danger : HUD.primary;
        const br = 3.2 * scale;

        ctx.beginPath();
        ctx.moveTo(px, py - br);
        ctx.lineTo(px + br, py);
        ctx.lineTo(px, py + br);
        ctx.lineTo(px - br, py);
        ctx.closePath();
        ctx.fillStyle = withAlpha(color, alpha);
        ctx.fill();

        if (e.elevation > 0) {
          ctx.beginPath();
          ctx.moveTo(px - br * 0.9, py - br * 1.6);
          ctx.lineTo(px, py - br * 2.6);
          ctx.lineTo(px + br * 0.9, py - br * 1.6);
          ctx.strokeStyle = withAlpha(color, alpha);
          ctx.lineWidth = 1.2 * scale;
          ctx.stroke();
        } else if (e.elevation < 0) {
          ctx.beginPath();
          ctx.moveTo(px - br * 0.9, py + br * 1.6);
          ctx.lineTo(px, py + br * 2.6);
          ctx.lineTo(px + br * 0.9, py + br * 1.6);
          ctx.strokeStyle = withAlpha(color, alpha);
          ctx.lineWidth = 1.2 * scale;
          ctx.stroke();
        }
      }
    }

    ctx.restore();

    drawText(ctx, `${Math.round(range)}M`, cx, cy + r + 4 * scale, 9 * scale, {
      color: withAlpha(HUD.primary, 0.7), align: 'center',
    });
  }
}
