/**
 * MERIDIAN — member portraits.
 *
 * Two pipelines, one component surface.
 *
 *   (a) A REAL PHOTOGRAPH, when there is one. `Member.photoUrl` (see
 *       `MemberDossier` in `members.ts`) is rendered cover-cropped at whatever
 *       size the caller asks for. The signed-in member can set their own from a
 *       file input; `readImageAsPortrait` downscales it through a canvas to
 *       {@link PORTRAIT_MAX_PX} before it is ever handed to the store, because
 *       a 4 MB phone photo in localStorage is a quota failure, not a feature.
 *
 *   (b) A GENERATED PLATE otherwise. This repo ships no binary assets and this
 *       environment has no CDN egress, and — more to the point — fabricating
 *       photorealistic faces for eighty people who do not exist is not
 *       something this product should do. So the fallback is drawn: a duotone
 *       plate in the house palette, a soft generated form under a single key
 *       light, engine-turned hairlines, a brass frame and a serif monogram.
 *       It is meant to read as a considered editorial placeholder — the plate
 *       an expensive magazine runs when the sitter would not be photographed.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 * Every number here is a pure function of the seed string. No `Math.random`,
 * no `Date`, no module-level counters, no `useId`. The markup the server emits
 * is byte-identical to the client's, which is why the plate is safe above the
 * hydration boundary. The drawing is expressed once, as a small node tree, and
 * both the string serializer and the React component consume that same tree —
 * so the SVG a verification script writes to disk is the SVG the browser gets.
 */

import { avatarSpec, initialsFrom, type AvatarSpec } from './avatar';
import { hashSeed, mulberry32 } from './rng';

// ─────────────────────────────────────────────────────────────────────────────
// Spec
// ─────────────────────────────────────────────────────────────────────────────

/** Longest edge, in px, that a stored portrait photo is downscaled to. */
export const PORTRAIT_MAX_PX = 256;

/** Rough ceiling on a stored data URI. Above this we refuse rather than fill the quota. */
export const PORTRAIT_MAX_BYTES = 220_000;

export interface PortraitSpec extends AvatarSpec {
  /** Key light position, fractions of the plate. */
  lightX: number;
  lightY: number;
  /** The generated form: centre, size and lean, all fractions of the plate. */
  formX: number;
  formY: number;
  formR: number;
  formLean: number;
  /** Closed blob outline, in unit space (0..1 on both axes). */
  formPoints: readonly (readonly [number, number])[];
  /** Engine-turned arc count and their rotation. */
  guillocheRings: number;
  guillocheAngle: number;
  /** Where the horizon hairline sits, fraction of height. */
  horizonY: number;
  /** Vignette strength, 0..1. */
  vignette: number;
}

const cache = new Map<string, PortraitSpec>();

/**
 * Pure and memoised. Derives from the same hash as {@link avatarSpec} so a
 * member's plate, their accent ring on the globe and their portrait all agree
 * on a hue — the extra geometry comes off a second, independent stream.
 */
export function portraitSpec(seed: string): PortraitSpec {
  const hit = cache.get(seed);
  if (hit) return hit;

  const base = avatarSpec(seed);
  const rand = mulberry32(hashSeed(`portrait:${seed}`));

  const formX = 0.5 + (rand() - 0.5) * 0.28;
  // Anchored below the bottom edge, so the mass is cropped rather than floating
  // — a shoulder line leaving the frame, not an egg in the middle of it.
  const formY = 1.0 + rand() * 0.16;
  const formR = 0.26 + rand() * 0.2;
  const formLean = (rand() - 0.5) * 0.34;

  // A closed, gently irregular outline. Nine radii around the centre, smoothed
  // into one path later. Wider than tall and sitting low: it reads as a lit
  // form under a single source, which is as close to a portrait as this gets
  // without inventing a face for somebody who does not exist.
  const points: [number, number][] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble = 0.84 + rand() * 0.36;
    const rx = formR * wobble * 1.5;
    const ry = formR * wobble * 1.62;
    points.push([
      round3(formX + Math.cos(t) * rx + formLean * Math.sin(t) * 0.5),
      round3(formY + Math.sin(t) * ry),
    ]);
  }

  const spec: PortraitSpec = {
    ...base,
    lightX: round3(0.2 + rand() * 0.2),
    lightY: round3(0.1 + rand() * 0.14),
    formX: round3(formX),
    formY: round3(formY),
    formR: round3(formR),
    formLean: round3(formLean),
    formPoints: points,
    guillocheRings: 4 + Math.floor(rand() * 4),
    guillocheAngle: Math.round(rand() * 180),
    horizonY: round3(0.58 + rand() * 0.1),
    vignette: round3(0.5 + rand() * 0.16),
  };

  cache.set(seed, spec);
  return spec;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Rescale an `hsl(h s% l%)` string's saturation and lightness independently.
 *
 * One generator, two sizes: the same seed has to work as a 24px plate in a peer
 * stack and as a full-height panel on a profile, and those want different
 * tones for the same colour. This is the only place that difference lives.
 */
function tone(hsl: string, satFactor: number, lightFactor: number): string {
  const m = /^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/.exec(hsl);
  if (!m) return hsl;
  const h = Number(m[1]);
  const sat = Math.min(34, Number(m[2]) * satFactor);
  const light = Math.min(26, Number(m[3]) * lightFactor);
  return `hsl(${r2(h)} ${r2(sat)}% ${r2(light)}%)`;
}
const r2 = (n: number): number => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// The node tree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A minimal SVG element description. Attribute names are written exactly as
 * they appear in SVG (`stop-color`, not `stopColor`) — React DOM sets unknown
 * hyphenated attributes verbatim, so one tree serves both renderers and the
 * two can never drift apart.
 */
export interface PortraitNode {
  tag: string;
  attrs: Record<string, string | number>;
  text?: string;
  children?: PortraitNode[];
}

export type PortraitShape = 'circle' | 'panel';

export interface PortraitOptions {
  shape?: PortraitShape;
  /** `panel` only. Height = size × ratio. */
  ratio?: number;
  /** Draw the accent ring — used for the signed-in member and your manifest. */
  accented?: boolean;
  /**
   * Force a detail level. `auto` picks from the rendered size: a 24px plate
   * with a blurred form and eight guilloché arcs is mud, so it does not get
   * them.
   */
  detail?: 'auto' | 'minimal' | 'full';
}

export interface PortraitDrawing {
  width: number;
  height: number;
  nodes: PortraitNode[];
  /** Id prefix used inside `defs`. Stable for a given seed + shape. */
  id: string;
}

const INK = '244,241,234';
const BRASS = '200,168,102';

function detailFor(size: number, forced: PortraitOptions['detail']): 'minimal' | 'full' {
  if (forced && forced !== 'auto') return forced;
  return size >= 56 ? 'full' : 'minimal';
}

/**
 * Build the drawing. `size` is the rendered edge in CSS px — it selects the
 * level of detail and scales the type, and nothing else: every gradient works
 * in object-bounding-box units so the same plate is the same plate at 24px and
 * at 320px.
 */
export function portraitDrawing(
  seed: string,
  size: number,
  name: string,
  opts: PortraitOptions = {},
): PortraitDrawing {
  const spec = portraitSpec(seed);
  const shape: PortraitShape = opts.shape ?? 'circle';
  const ratio = shape === 'panel' ? (opts.ratio ?? 1.25) : 1;
  const W = size;
  const H = Math.round(size * ratio);
  const detail = detailFor(Math.min(W, H), opts.detail);
  const id = `mp${spec.key}${shape === 'panel' ? 'v' : ''}`;

  // A panel is looked at; an avatar is glanced at. The plate is lifted and the
  // hue allowed to show at panel sizes — at 24px the same values would turn the
  // stack into a row of coloured dots.
  // Area effect: the same fill that reads as dark graphite in a 24px disc reads
  // as a colour wash across a 320px panel. A panel therefore gets the *darker*
  // treatment — two thirds of the lightness, full saturation — which is what
  // keeps a wall of these looking like black glass rather than swatches.
  const top = shape === 'panel' ? tone(spec.plateTop, 1, 0.62) : spec.plateTop;
  const bottom = shape === 'panel' ? tone(spec.plateBottom, 1, 0.6) : spec.plateBottom;
  // A panel is lit from above. An SVG linear gradient runs left→right at 0°, so
  // "from the top" is 90° — the seeded angle becomes a ±18° variation around
  // that, rather than a free rotation that would light a third of the roster
  // from underneath.
  const plateAngle = shape === 'panel' ? r2(90 + ((spec.angle % 36) - 18)) : r2(spec.angle);

  const defs: PortraitNode[] = [
    {
      tag: 'linearGradient',
      attrs: { id: `${id}p`, gradientTransform: `rotate(${plateAngle} 0.5 0.5)` },
      children: [
        { tag: 'stop', attrs: { offset: '0%', 'stop-color': top } },
        { tag: 'stop', attrs: { offset: '100%', 'stop-color': bottom } },
      ],
    },
    {
      tag: 'radialGradient',
      attrs: {
        id: `${id}k`,
        cx: `${r2(spec.lightX * 100)}%`,
        cy: `${r2(spec.lightY * 100)}%`,
        r: '64%',
      },
      children: [
        { tag: 'stop', attrs: { offset: '0%', 'stop-color': `rgba(${INK},0.11)` } },
        { tag: 'stop', attrs: { offset: '45%', 'stop-color': `rgba(${INK},0.03)` } },
        { tag: 'stop', attrs: { offset: '100%', 'stop-color': `rgba(${INK},0)` } },
      ],
    },
  ];

  if (detail === 'full') {
    defs.push(
      // A band of light along the top edge. Two sources — this and the key
      // light — are what stop the plate reading as a single flat wash.
      {
        tag: 'linearGradient',
        attrs: { id: `${id}e`, gradientTransform: 'rotate(90 0.5 0.5)' },
        children: [
          { tag: 'stop', attrs: { offset: '0%', 'stop-color': `rgba(${INK},0.07)` } },
          { tag: 'stop', attrs: { offset: '30%', 'stop-color': `rgba(${INK},0)` } },
        ],
      },
      // The halo sits behind the form, in the plate's own accent, and is the
      // only place in the drawing where the hue is unambiguous.
      {
        tag: 'radialGradient',
        attrs: { id: `${id}h`, cx: '50%', cy: '50%', r: '50%' },
        children: [
          { tag: 'stop', attrs: { offset: '0%', 'stop-color': spec.accent, 'stop-opacity': '0.17' } },
          { tag: 'stop', attrs: { offset: '55%', 'stop-color': spec.accent, 'stop-opacity': '0.06' } },
          { tag: 'stop', attrs: { offset: '100%', 'stop-color': spec.accent, 'stop-opacity': '0' } },
        ],
      },
      // The form: lit along its top edge, falling into the plate at the bottom.
      {
        tag: 'linearGradient',
        attrs: { id: `${id}f`, x1: '0.25', y1: '0', x2: '0.75', y2: '1' },
        children: [
          { tag: 'stop', attrs: { offset: '0%', 'stop-color': `rgba(${INK},0.12)` } },
          { tag: 'stop', attrs: { offset: '38%', 'stop-color': `rgba(${INK},0.05)` } },
          { tag: 'stop', attrs: { offset: '72%', 'stop-color': 'rgba(0,0,0,0.18)' } },
          { tag: 'stop', attrs: { offset: '100%', 'stop-color': 'rgba(0,0,0,0.55)' } },
        ],
      },
      {
        tag: 'radialGradient',
        attrs: { id: `${id}v`, cx: '50%', cy: '38%', r: '80%' },
        children: [
          { tag: 'stop', attrs: { offset: '30%', 'stop-color': 'rgba(0,0,0,0)' } },
          { tag: 'stop', attrs: { offset: '100%', 'stop-color': `rgba(0,0,0,${r2(spec.vignette)})` } },
        ],
      },
      {
        tag: 'filter',
        attrs: { id: `${id}b`, x: '-25%', y: '-25%', width: '150%', height: '150%' },
        children: [
          {
            tag: 'feGaussianBlur',
            attrs: { stdDeviation: r2(Math.max(0.8, W * 0.018)), edgeMode: 'duplicate' },
          },
        ],
      },
      {
        tag: 'filter',
        attrs: { id: `${id}s`, x: '-25%', y: '-25%', width: '150%', height: '150%' },
        children: [
          {
            tag: 'feGaussianBlur',
            attrs: { stdDeviation: r2(Math.max(0.4, W * 0.006)), edgeMode: 'duplicate' },
          },
        ],
      },
    );
  }

  // ── Clip ─────────────────────────────────────────────────────────────────
  const clipChild: PortraitNode =
    shape === 'circle'
      ? { tag: 'circle', attrs: { cx: r2(W / 2), cy: r2(H / 2), r: r2(W / 2) } }
      : { tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, rx: 2 } };
  defs.push({ tag: 'clipPath', attrs: { id: `${id}c` }, children: [clipChild] });
  if (detail === 'full') {
    // Upper half only — the lit side.
    defs.push({
      tag: 'clipPath',
      attrs: { id: `${id}t` },
      children: [
        {
          tag: 'rect',
          attrs: { x: 0, y: 0, width: W, height: r2((spec.formY - spec.formR * 0.9) * H) },
        },
      ],
    });
  }

  // ── Plate ────────────────────────────────────────────────────────────────
  const body: PortraitNode[] = [
    { tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, fill: `url(#${id}p)` } },
    { tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, fill: `url(#${id}k)` } },
  ];

  if (detail === 'full') {
    const cx = spec.formX * W;
    const haloR = spec.formR * W * 2.2;
    const haloY = (spec.formY - spec.formR * 1.5) * H;

    // Engine turning first, so the form occludes it: concentric hairlines
    // struck through the plate at an angle. The texture of a banknote or a
    // watch dial, at the threshold of visibility — it is what stops the
    // gradient reading as a CSS background.
    const arcs: PortraitNode[] = [];
    for (let i = 0; i < spec.guillocheRings; i++) {
      const t = (i + 1) / (spec.guillocheRings + 1);
      arcs.push({
        tag: 'ellipse',
        attrs: {
          cx: r2(cx),
          cy: r2(haloY),
          rx: r2(haloR * (0.5 + t * 1.35)),
          ry: r2(haloR * (0.46 + t * 1.3)),
          fill: 'none',
          stroke: `rgba(${INK},${r2(0.07 - t * 0.04)})`,
          'stroke-width': 0.6,
        },
      });
    }
    body.push({ tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, fill: `url(#${id}e)` } });
    body.push({
      tag: 'g',
      attrs: { transform: `rotate(${spec.guillocheAngle} ${r2(cx)} ${r2(haloY)})` },
      children: arcs,
    });

    // The one horizontal in the composition. Everything else is soft.
    body.push({
      tag: 'rect',
      attrs: {
        x: 0,
        y: r2(spec.horizonY * H),
        width: W,
        height: 1,
        fill: `rgba(${BRASS},0.14)`,
      },
    });

    // The halo, then the mass in front of it.
    body.push({
      tag: 'ellipse',
      attrs: {
        cx: r2(cx),
        cy: r2(haloY),
        rx: r2(haloR),
        ry: r2(haloR),
        fill: `url(#${id}h)`,
      },
    });

    const d = blobPath(spec.formPoints, W, H);
    body.push({
      tag: 'path',
      attrs: { d, fill: `url(#${id}f)`, filter: `url(#${id}b)` },
    });
    // Rim light along the lit edge. A stroke on the same path, softened, and
    // masked to the top half so it reads as light catching an edge rather than
    // an outline drawn around a shape.
    body.push({
      tag: 'path',
      attrs: {
        d,
        fill: 'none',
        stroke: `rgba(${INK},0.17)`,
        'stroke-width': r2(Math.max(0.8, W * 0.005)),
        filter: `url(#${id}s)`,
        'clip-path': `url(#${id}t)`,
      },
    });

    body.push({ tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, fill: `url(#${id}v)` } });
  }

  // ── Frame ────────────────────────────────────────────────────────────────
  const frame: PortraitNode[] = [];
  if (shape === 'circle') {
    const r = W / 2;
    frame.push({
      tag: 'circle',
      attrs: {
        cx: r2(r),
        cy: r2(r),
        r: r2(r - 0.5),
        fill: 'none',
        stroke: `rgba(${BRASS},${r2(spec.ringAlpha)})`,
        'stroke-width': 1,
      },
    });
    frame.push({
      tag: 'circle',
      attrs: {
        cx: r2(r),
        cy: r2(r),
        r: r2(Math.max(0, r - 3)),
        fill: 'none',
        stroke: `rgba(${INK},0.05)`,
        'stroke-width': 1,
      },
    });
    if (opts.accented) {
      frame.push({
        tag: 'circle',
        attrs: {
          cx: r2(r),
          cy: r2(r),
          r: r2(Math.max(0, r - 1.5)),
          fill: 'none',
          stroke: spec.accent,
          'stroke-opacity': '0.55',
          'stroke-width': 1,
        },
      });
    }
  } else {
    frame.push({
      tag: 'rect',
      attrs: {
        x: 0.5,
        y: 0.5,
        width: r2(W - 1),
        height: r2(H - 1),
        rx: 2,
        fill: 'none',
        stroke: `rgba(${BRASS},${r2(spec.ringAlpha)})`,
        'stroke-width': 1,
      },
    });
    frame.push({
      tag: 'rect',
      attrs: {
        x: 4.5,
        y: 4.5,
        width: r2(W - 9),
        height: r2(H - 9),
        rx: 1,
        fill: 'none',
        stroke: `rgba(${INK},0.06)`,
        'stroke-width': 1,
      },
    });
  }

  // ── Monogram ─────────────────────────────────────────────────────────────
  const initials = initialsFrom(name);
  const fontSize = shape === 'panel' ? Math.max(11, W * 0.115) : W * 0.34;
  const caption: PortraitNode[] = [];

  if (shape === 'panel') {
    // Set like a plate caption in a catalogue: a hairline, then the monogram
    // beneath it at the left margin. Centring it would put type over the
    // brightest part of the form, which is the one place it cannot go.
    const capY = H - Math.max(14, H * 0.085);
    caption.push({
      tag: 'rect',
      attrs: {
        x: r2(W * 0.09),
        y: r2(capY - fontSize * 1.15),
        width: r2(Math.max(18, W * 0.17)),
        height: 1,
        fill: `rgba(${BRASS},0.55)`,
      },
    });
    caption.push({
      tag: 'text',
      attrs: {
        x: r2(W * 0.09),
        y: r2(capY),
        fill: spec.monogram,
        'font-family': SERIF,
        'font-size': r2(fontSize),
        'letter-spacing': r2(fontSize * 0.16),
      },
      text: initials,
    });
  } else {
    caption.push({
      tag: 'text',
      attrs: {
        x: '50%',
        y: '50%',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: spec.monogram,
        'font-family': SERIF,
        'font-size': r2(fontSize),
        'letter-spacing': r2(W * 0.012),
      },
      text: initials,
    });
  }

  const nodes: PortraitNode[] = [
    { tag: 'defs', attrs: {}, children: defs },
    { tag: 'g', attrs: { 'clip-path': `url(#${id}c)` }, children: [...body, ...caption] },
    ...frame,
  ];

  return { width: W, height: H, nodes, id };
}

const SERIF =
  "Didot, 'Bodoni MT', 'Playfair Display', 'Hoefler Text', Garamond, 'Times New Roman', serif";

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closed smooth path through unit-space points, via midpoint quadratics. Two
 * decimal places everywhere so the emitted `d` string is stable across engines
 * — floating point tails are the classic way a "deterministic" generator
 * produces a hydration mismatch.
 */
function blobPath(
  points: readonly (readonly [number, number])[],
  W: number,
  H: number,
): string {
  const p = points.map(([x, y]) => [x * W, y * H] as const);
  if (p.length < 3) return '';
  const mid = (a: readonly [number, number], b: readonly [number, number]) =>
    [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)] as const;

  const start = mid(p[p.length - 1]!, p[0]!);
  let d = `M${start[0]} ${start[1]}`;
  for (let i = 0; i < p.length; i++) {
    const cur = p[i]!;
    const next = p[(i + 1) % p.length]!;
    const m = mid(cur, next);
    d += `Q${r2(cur[0])} ${r2(cur[1])} ${m[0]} ${m[1]}`;
  }
  return `${d}Z`;
}

function scalePoints(
  points: readonly (readonly [number, number])[],
  cx: number,
  cy: number,
  k: number,
): (readonly [number, number])[] {
  return points.map(([x, y]) => [round3(cx + (x - cx) * k), round3(cy + (y - cy) * k)] as const);
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

/** Standalone SVG markup for anywhere a DOM tree is not available. */
export function portraitSvg(
  seed: string,
  size: number,
  name: string,
  opts: PortraitOptions = {},
): string {
  const { width, height, nodes } = portraitDrawing(seed, size, name, opts);
  const inner = nodes.map(serialize).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(name)}">${inner}</svg>`
  );
}

/** `data:` URI form. Safe in `src` and in `background-image`. */
export function portraitDataUri(
  seed: string,
  size: number,
  name: string,
  opts: PortraitOptions = {},
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(portraitSvg(seed, size, name, opts))}`;
}

function serialize(node: PortraitNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
  const inner =
    node.text !== undefined
      ? escapeText(node.text)
      : (node.children ?? []).map(serialize).join('');
  return inner ? `<${node.tag}${attrs}>${inner}</${node.tag}>` : `<${node.tag}${attrs}/>`;
}

const escapeText = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (v: string): string => escapeText(v).replace(/"/g, '&quot;');

// ─────────────────────────────────────────────────────────────────────────────
// The photo pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface PortraitReadResult {
  /** A `data:image/jpeg` URI, longest edge ≤ {@link PORTRAIT_MAX_PX}. */
  dataUri: string;
  /** Approximate stored size in bytes, for the quota conversation. */
  bytes: number;
}

const ACCEPTED = /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i;

/**
 * Read a picked file into a small, square-croppable data URI.
 *
 * Deliberately lossy: centre-cropped to a square, downscaled to 256px and
 * re-encoded as JPEG at 0.82. The original never touches storage. A 4 MB
 * upload lands at roughly 20–40 KB, which localStorage will actually hold.
 *
 * Browser-only — it needs `FileReader`, `Image` and a canvas. Callers are
 * event handlers, so that is never a problem, but it throws rather than
 * silently no-ops if it is ever reached during a render.
 */
export async function readImageAsPortrait(
  file: File,
  maxPx: number = PORTRAIT_MAX_PX,
): Promise<PortraitReadResult> {
  if (typeof document === 'undefined') {
    throw new Error('readImageAsPortrait: browser only');
  }
  if (!ACCEPTED.test(file.type)) {
    throw new Error('That file is not an image the browser can open.');
  }

  const source = await readAsDataUri(file);
  const img = await loadImage(source);

  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!side) throw new Error('That image could not be decoded.');
  const out = Math.min(maxPx, side);

  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give us a canvas.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Centre crop: faces sit centrally often enough, and a portrait that is
  // cropped consistently beats one that is cropped cleverly and sometimes wrong.
  const sx = ((img.naturalWidth || img.width) - side) / 2;
  const sy = ((img.naturalHeight || img.height) - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);

  const dataUri = canvas.toDataURL('image/jpeg', 0.82);
  const bytes = Math.round((dataUri.length - dataUri.indexOf(',') - 1) * 0.75);
  if (bytes > PORTRAIT_MAX_BYTES) {
    throw new Error('That image is still too large after downscaling. Try another.');
  }
  return { dataUri, bytes };
}

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be decoded.'));
    img.src = src;
  });
}

/** True for anything we are willing to put in an `<img src>`. */
export function isUsablePhotoUrl(url: string | undefined): url is string {
  if (!url) return false;
  return /^(data:image\/|https:\/\/|\/)/.test(url);
}
