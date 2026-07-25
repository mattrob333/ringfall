// L4 src/ui — shared "chrome" drawing primitives.
//
// Small stateless helpers that every panel uses so the whole HUD reads as one
// angular, thin-stroked, stencil-military system (ART.md §3 / the brief's style
// note) instead of ten panels each inventing their own frame. No allocation
// beyond what Canvas2D itself does internally for path building — none of
// these keep references across calls.

/** Path for a rectangle with chamfered (45°) corners. Caller strokes/fills it. */
export function chamferRectPath(x, y, w, h, c) {
  const p = new Path2D();
  const cc = Math.min(c, w / 2, h / 2);
  p.moveTo(x + cc, y);
  p.lineTo(x + w - cc, y);
  p.lineTo(x + w, y + cc);
  p.lineTo(x + w, y + h - cc);
  p.lineTo(x + w - cc, y + h);
  p.lineTo(x + cc, y + h);
  p.lineTo(x, y + h - cc);
  p.lineTo(x, y + cc);
  p.closePath();
  return p;
}

export function drawChamferRect(ctx, x, y, w, h, c, { stroke, fill, lineWidth = 1.5 } = {}) {
  const path = chamferRectPath(x, y, w, h, c);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke(path);
  }
}

/** Four L-shaped corner brackets framing a rect — the classic HUD "targeting frame". */
export function drawCornerBrackets(ctx, x, y, w, h, len, color, lineWidth = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  // top-left
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  // top-right
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  // bottom-right
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  // bottom-left
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

/** A ring/arc segment, stroked. Angles in radians, 0 = up (12 o'clock), clockwise positive. */
export function drawArc(ctx, cx, cy, r, startAngle, endAngle, color, lineWidth = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  // Convert "up = 0, clockwise" into canvas' "right = 0, clockwise" convention.
  ctx.arc(cx, cy, r, startAngle - Math.PI / 2, endAngle - Math.PI / 2, false);
  ctx.stroke();
}

/** A thin diamond/chevron tick — used for blips, elevation marks, selection carets. */
export function diamondPath(cx, cy, r) {
  const p = new Path2D();
  p.moveTo(cx, cy - r);
  p.lineTo(cx + r, cy);
  p.lineTo(cx, cy + r);
  p.lineTo(cx - r, cy);
  p.closePath();
  return p;
}

/** A small upward chevron ("^"), used for the tracker's "above" elevation mark. */
export function chevronUpPath(cx, cy, w, h) {
  const p = new Path2D();
  p.moveTo(cx - w / 2, cy + h / 2);
  p.lineTo(cx, cy - h / 2);
  p.lineTo(cx + w / 2, cy + h / 2);
  return p;
}

/** A small downward chevron ("v"), used for the tracker's "below" elevation mark. */
export function chevronDownPath(cx, cy, w, h) {
  const p = new Path2D();
  p.moveTo(cx - w / 2, cy - h / 2);
  p.lineTo(cx, cy + h / 2);
  p.lineTo(cx + w / 2, cy - h / 2);
  return p;
}

/** Hex color + alpha -> rgba() string. No allocation beyond the one string. */
export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
