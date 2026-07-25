// L4 src/ui/panels — ammo + grenade counters. Brief item 6.
//
// Bottom-right. Primary weapon mag/reserve large, offhand weapon smaller above
// it, grenade counts with the selected type boxed/brightened. All numerals and
// labels are drawn with the vector glyph set (glyphs.js) — no fillText.

import { HUD } from '../../shared/palette.js';
import { chamferRectPath, withAlpha, clamp01 } from '../chrome.js';
import { drawText, measureText } from '../glyphs.js';

export class AmmoPanel {
  constructor() {
    this._geom = null;
  }

  resize(w, h, scale) {
    const panelW = 230 * scale;
    const rightX = w - 24 * scale;
    const baseY = h - 40 * scale;
    this._geom = {
      scale, rightX, baseY, panelW,
      primarySize: 26 * scale,
      reserveSize: 13 * scale,
      offhandSize: 13 * scale,
      labelSize: 10 * scale,
      heatBarW: panelW,
      heatBarH: 4 * scale,
    };
  }

  update(_dt) {
    // no continuously-animated state beyond what `state` already carries
  }

  render(ctx, weapon, offhand, grenades) {
    const g = this._geom;
    if (!g) return;
    const { rightX, scale } = g;

    // --- primary weapon ---
    let y = g.baseY;
    const name = (weapon?.name ?? '').toUpperCase();
    drawText(ctx, name, rightX, y - g.primarySize * 1.5, g.labelSize, {
      color: withAlpha(HUD.primary, 0.75), align: 'right',
    });

    const ammoStr = String(weapon?.ammo ?? 0);
    const reserveStr = `/${weapon?.reserve ?? 0}`;
    const ammoColor = weapon?.overheated ? HUD.danger : weapon?.reloading ? HUD.warning : HUD.primary;

    const reserveW = measureText(reserveStr, g.reserveSize);
    drawText(ctx, reserveStr, rightX, y - g.primarySize, g.reserveSize, {
      color: withAlpha(HUD.primary, 0.7), align: 'right',
    });
    drawText(ctx, ammoStr, rightX - reserveW, y - g.primarySize, g.primarySize, {
      color: ammoColor, align: 'right',
    });

    // reload progress bar
    if (weapon?.reloading) {
      const barY = y - g.primarySize * 0.15;
      const barW = g.panelW;
      ctx.strokeStyle = withAlpha(HUD.warning, 0.6);
      ctx.lineWidth = 1 * scale;
      ctx.strokeRect(rightX - barW, barY, barW, 3 * scale);
      ctx.fillStyle = withAlpha(HUD.warning, 0.85);
      ctx.fillRect(rightX - barW, barY, barW * clamp01(weapon.reloadProgress ?? 0), 3 * scale);
    }

    // heat bar (Ember-Repeater-style weapons)
    if (weapon && (weapon.heat > 0 || weapon.overheated)) {
      const barY = y - g.primarySize * 0.15 + (weapon.reloading ? 6 * scale : 0);
      const heatColor = weapon.overheated ? HUD.danger : HUD.warning;
      ctx.strokeStyle = withAlpha(heatColor, 0.6);
      ctx.lineWidth = 1 * scale;
      ctx.strokeRect(rightX - g.heatBarW, barY, g.heatBarW, g.heatBarH);
      ctx.fillStyle = withAlpha(heatColor, 0.85);
      ctx.fillRect(rightX - g.heatBarW, barY, g.heatBarW * clamp01(weapon.heat ?? 0), g.heatBarH);
      if (weapon.overheated) {
        drawText(ctx, 'OVERHEAT', rightX, barY + g.heatBarH + 3 * scale, g.labelSize * 0.9, {
          color: HUD.danger, align: 'right',
        });
      }
    }

    // charge weapon (Vess Sidearm)
    if (weapon && weapon.charge > 0) {
      const barY = y + 4 * scale;
      ctx.strokeStyle = withAlpha(HUD.warning, 0.6);
      ctx.lineWidth = 1 * scale;
      ctx.strokeRect(rightX - g.heatBarW, barY, g.heatBarW, g.heatBarH);
      ctx.fillStyle = withAlpha(HUD.warning, 0.9);
      ctx.fillRect(rightX - g.heatBarW, barY, g.heatBarW * clamp01(weapon.charge), g.heatBarH);
    }

    // --- offhand weapon (smaller, above) ---
    if (offhand) {
      const oy = y - g.primarySize * 1.9;
      const oName = (offhand.name ?? '').toUpperCase();
      const oAmmo = `${offhand.ammo ?? 0}/${offhand.reserve ?? 0}`;
      drawText(ctx, oName, rightX, oy - g.offhandSize * 1.4, g.labelSize * 0.85, {
        color: withAlpha(HUD.primaryDim, 0.7), align: 'right',
      });
      drawText(ctx, oAmmo, rightX, oy - g.offhandSize * 0.5, g.offhandSize, {
        color: withAlpha(HUD.primaryDim, 0.85), align: 'right',
      });
    }

    // --- grenades ---
    if (grenades) {
      const gy = g.baseY + 22 * scale;
      const boxW = 34 * scale, boxH = 22 * scale, gap = 8 * scale;
      const types = [
        { id: 'frag', count: grenades.frag ?? 0, color: HUD.danger },
        { id: 'plasma', count: grenades.plasma ?? 0, color: HUD.shield },
      ];
      let bx = rightX - boxW;
      for (let i = types.length - 1; i >= 0; i--) {
        const t = types[i];
        const selected = grenades.selected === t.id;
        const path = chamferRectPath(bx, gy, boxW, boxH, 4 * scale);
        ctx.fillStyle = selected ? withAlpha(t.color, 0.22) : 'rgba(0,0,0,0)';
        if (selected) ctx.fill(path);
        ctx.strokeStyle = withAlpha(t.color, selected ? 0.95 : 0.5);
        ctx.lineWidth = selected ? 2 * scale : 1.2 * scale;
        ctx.stroke(path);
        drawText(ctx, String(t.count), bx + boxW / 2, gy + boxH * 0.22, 13 * scale, {
          color: t.color, align: 'center',
        });
        bx -= boxW + gap;
      }
    }
  }
}
