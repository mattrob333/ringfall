// L4 src/ui/panels — pickup / interact prompt. Brief item 9.
//
// `state.prompt` is either null or `{label, holdProgress}`. Drawn centre-low,
// above the shield/health bars, with a chamfered label plate and a hold-progress
// ring (matches `interactHeld` from core/input.js sampled by the orchestrator).

import { HUD } from '../../shared/palette.js';
import { chamferRectPath, drawArc, withAlpha } from '../chrome.js';
import { drawText, measureText } from '../glyphs.js';

export class PromptPanel {
  constructor() {
    this._geom = null;
  }

  resize(w, h, scale) {
    this._geom = { cx: w / 2, y: h - 130 * scale, scale };
  }

  render(ctx, prompt) {
    if (!prompt) return;
    const g = this._geom;
    if (!g) return;
    const { cx, y, scale } = g;
    const label = (prompt.label ?? '').toUpperCase();
    const textSize = 13 * scale;
    const textW = measureText(label, textSize);
    const padX = 14 * scale;
    const padY = 10 * scale;
    const ringR = 9 * scale;
    const plateW = textW + padX * 2 + (ringR * 2 + 10 * scale);
    const plateH = textSize + padY * 1.4;
    const plateX = cx - plateW / 2;
    const plateY = y - plateH / 2;

    ctx.save();
    const path = chamferRectPath(plateX, plateY, plateW, plateH, 5 * scale);
    ctx.fillStyle = 'rgba(6, 20, 18, 0.55)';
    ctx.fill(path);
    ctx.strokeStyle = withAlpha(HUD.primary, 0.8);
    ctx.lineWidth = 1.4 * scale;
    ctx.stroke(path);

    const ringCx = plateX + padX + ringR;
    const ringCy = plateY + plateH / 2;
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(HUD.primaryDim, 0.5);
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    const hold = Math.max(0, Math.min(1, prompt.holdProgress ?? 0));
    if (hold > 0) {
      drawArc(ctx, ringCx, ringCy, ringR, 0, hold * Math.PI * 2, HUD.primary, 2.4 * scale);
    }

    drawText(ctx, label, ringCx + ringR + 10 * scale, plateY + padY * 0.7, textSize, {
      color: HUD.reticle,
    });
    ctx.restore();
  }
}
