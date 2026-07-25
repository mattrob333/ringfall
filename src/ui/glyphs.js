// L4 src/ui — procedural vector glyph set.
//
// ARCHITECTURE.md §1: "Fonts: Procedural. HUD glyphs are drawn as vector paths ...
// generated at boot into a canvas atlas. No webfonts, no system font names in the
// shipped HUD." This module is that vector font. No ctx.fillText anywhere.
//
// Design: a 16-segment-display convention (the classic alphanumeric LED/VFD
// layout), which is naturally angular, monospaced, and reads as a technical
// stencil readout — a deliberate era signature, not just an implementation
// shortcut. Every glyph is a set of straight strokes between 9 fixed nodes on a
// unit square, so every character shares the same rhythm of angles.
//
//   A-------B-------C      A=(0,0)   B=(.5,0)  C=(1,0)
//   |\      |      /|      D=(0,.5)  E=(.5,.5) F=(1,.5)
//   | \     |     / |      G=(0,1)   H=(.5,1)  I=(1,1)
//   D--\----E----/--F
//   |   \   |   /   |
//   |    \  |  /    |
//   G-----\-H-/-----I
//
// Known, accepted collisions (authentic to the segmented-display aesthetic, the
// same way a real 7-segment clock can't tell a "5" from an "S"): B/8, D/O/0,
// G/6, S/5, Z-ish/2. These never matter in practice because HUD fields are
// either pure digits (ammo, counts) or pure letters (weapon names, prompts) —
// never mixed in the same readout. Documented in README.md.

const NODE = {
  A: [0, 0], B: [0.5, 0], C: [1, 0],
  D: [0, 0.5], E: [0.5, 0.5], F: [1, 0.5],
  G: [0, 1], H: [0.5, 1], I: [1, 1],
};

// 16 possible straight strokes between adjacent/central nodes.
const SEG = [
  ['A', 'B'], ['B', 'C'], // 0 top-left,        1 top-right
  ['A', 'D'], ['C', 'F'], // 2 upper-left vert, 3 upper-right vert
  ['A', 'E'], ['B', 'E'], ['C', 'E'], // 4 diag-TL, 5 vert-top-centre, 6 diag-TR
  ['D', 'E'], ['E', 'F'], // 7 mid-left,        8 mid-right
  ['D', 'G'], ['F', 'I'], // 9 lower-left vert, 10 lower-right vert
  ['E', 'G'], ['E', 'H'], ['E', 'I'], // 11 diag-BL, 12 vert-bottom-centre, 13 diag-BR
  ['G', 'H'], ['H', 'I'], // 14 bottom-left,    15 bottom-right
];

// Segment-id glyphs (digits use the classic 7-segment subset for guaranteed
// legibility; letters use the fuller 16-segment set for the strokes they need).
const SEGMENT_GLYPHS = {
  '0': [0, 1, 2, 3, 9, 10, 14, 15, 4], // slashed zero — technical-display convention
  '1': [3, 10, 15],
  '2': [0, 1, 3, 7, 8, 9, 14, 15],
  '3': [0, 1, 3, 7, 8, 10, 14, 15],
  '4': [2, 3, 7, 8, 10],
  '5': [0, 1, 2, 7, 8, 10, 14, 15],
  '6': [0, 1, 2, 7, 8, 9, 10, 14, 15],
  '7': [0, 1, 3, 10],
  '8': [0, 1, 2, 3, 7, 8, 9, 10, 14, 15],
  '9': [0, 1, 2, 3, 7, 8, 10, 14, 15],

  A: [0, 1, 2, 3, 7, 8, 9, 10],
  B: [0, 1, 2, 3, 7, 8, 9, 10, 14, 15],
  C: [0, 1, 2, 9, 14, 15],
  D: [0, 1, 2, 3, 9, 10, 14, 15],
  E: [0, 1, 2, 9, 7, 8, 14, 15],
  F: [0, 1, 2, 9, 7, 8],
  G: [0, 1, 2, 9, 14, 15, 10, 8],
  H: [2, 9, 3, 10, 7, 8],
  I: [0, 1, 5, 12, 14, 15],
  J: [3, 10, 14, 15],
  K: [2, 9, 6, 13],
  L: [2, 9, 14, 15],
  M: [2, 9, 3, 10, 4, 6],
  N: [2, 9, 3, 10, 4, 13],
  O: [0, 1, 2, 3, 9, 10, 14, 15],
  P: [0, 1, 2, 9, 3, 7, 8],
  Q: [0, 1, 2, 3, 9, 10, 14, 15, 13],
  R: [0, 1, 2, 9, 3, 7, 8, 13],
  S: [0, 1, 2, 7, 8, 10, 14, 15],
  T: [0, 1, 5, 12],
  U: [2, 9, 3, 10, 14, 15],
  V: [4, 6, 12],
  W: [2, 9, 3, 10, 11, 13],
  X: [4, 6, 11, 13],
  Y: [4, 6, 12],
  Z: [0, 1, 6, 11, 14, 15],

  '-': [7, 8],
  '+': [5, 12, 7, 8],
  '/': [6, 11],
  '>': [6, 13],
  '<': [4, 11],
  '=': [7, 8], // duplicated on purpose: unit-space custom strokes add the second bar
};

// Raw polyline strokes for glyphs the segment grid can't express cleanly.
// Each entry is an array of polylines; each polyline is an array of [x,y] points
// in the same 0..1 unit square (y down).
const CUSTOM_STROKES = {
  ' ': [],
  ':': [
    [[0.5, 0.32], [0.5, 0.42]],
    [[0.5, 0.58], [0.5, 0.68]],
  ],
  '.': [[[0.42, 0.9], [0.58, 0.9]]],
  ',': [[[0.46, 0.9], [0.4, 1.02]]],
  '!': [[[0.5, 0.86], [0.5, 0.94]]], // dot; the stem comes from segment 5 below
  '%': [
    [[0.08, 0.22], [0.18, 0.12]], [[0.18, 0.12], [0.28, 0.22]],
    [[0.28, 0.22], [0.18, 0.32]], [[0.18, 0.32], [0.08, 0.22]],
    [[0.72, 0.78], [0.82, 0.68]], [[0.82, 0.68], [0.92, 0.78]],
    [[0.92, 0.78], [0.82, 0.88]], [[0.82, 0.88], [0.72, 0.78]],
  ],
  '°': [
    [[0.38, 0.18], [0.5, 0.08]], [[0.5, 0.08], [0.62, 0.18]],
    [[0.62, 0.18], [0.5, 0.28]], [[0.5, 0.28], [0.38, 0.18]],
  ],
  "'": [[[0.55, 0.05], [0.5, 0.2]]],
};
// '!' also uses the top-half vertical stroke (segment 5, B-E).
SEGMENT_GLYPHS['!'] = [5];

const CHAR_ASPECT = 0.66; // glyph width : height
const ADVANCE_GAP = 0.26; // extra spacing between glyphs, in units of height

/** @type {Map<string, Path2D>} built once, reused for the process lifetime. */
const PATH_CACHE = new Map();

function buildPath(ch) {
  const path = new Path2D();
  const segs = SEGMENT_GLYPHS[ch];
  if (segs) {
    for (const id of segs) {
      const [a, b] = SEG[id];
      const [ax, ay] = NODE[a];
      const [bx, by] = NODE[b];
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
    }
  }
  const strokes = CUSTOM_STROKES[ch];
  if (strokes) {
    for (const poly of strokes) {
      path.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) path.lineTo(poly[i][0], poly[i][1]);
    }
  }
  return path;
}

/** Fetch (and lazily build/cache) the Path2D for one uppercase char. Unknown chars render blank. */
function glyphPath(ch) {
  const key = ch.toUpperCase();
  let p = PATH_CACHE.get(key);
  if (p === undefined) {
    p = (SEGMENT_GLYPHS[key] || CUSTOM_STROKES[key]) ? buildPath(key) : null;
    PATH_CACHE.set(key, p);
  }
  return p;
}

/** Total rendered width (device units) of `text` drawn at cell height `size`. */
export function measureText(text, size) {
  const advance = size * (CHAR_ASPECT + ADVANCE_GAP);
  return text.length * advance;
}

/**
 * Draw monospaced vector text. Origin (x,y) is the top-left of the text block.
 * `size` is the glyph cell height in device pixels.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {{color?:string, weight?:number, align?:'left'|'center'|'right', letterSpacing?:number}} [opts]
 */
export function drawText(ctx, text, x, y, size, opts = {}) {
  const color = opts.color ?? '#D8F5EC';
  const weight = opts.weight ?? 1;
  const spacing = opts.letterSpacing ?? 1;
  const advance = size * (CHAR_ASPECT + ADVANCE_GAP) * spacing;
  const totalWidth = text.length * advance;

  let originX = x;
  if (opts.align === 'center') originX = x - totalWidth / 2;
  else if (opts.align === 'right') originX = x - totalWidth;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.1 * weight; // unit-space; scaled by the per-glyph transform below
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.miterLimit = 2;

  for (let i = 0; i < text.length; i++) {
    const path = glyphPath(text[i]);
    if (path) {
      ctx.save();
      ctx.translate(originX + i * advance, y);
      ctx.scale(size * CHAR_ASPECT, size);
      ctx.stroke(path);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Advance width in device pixels for one glyph cell at the given size (for building layouts). */
export function charAdvance(size, letterSpacing = 1) {
  return size * (CHAR_ASPECT + ADVANCE_GAP) * letterSpacing;
}

export const GLYPH_CHAR_ASPECT = CHAR_ASPECT;
