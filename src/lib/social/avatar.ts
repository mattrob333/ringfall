/**
 * MERIDIAN — generated avatars.
 *
 * There is no CDN egress in this environment and the product ships no binary
 * assets, so every member portrait is drawn from their `avatarSeed`. That is a
 * constraint, but it is also the right answer: a members' club does not show
 * you selfies. It shows you a plate with a monogram on it.
 *
 * The result is a deep, desaturated gradient plate — hue derived from the seed,
 * always inside the product's palette, never bright — with a brass hairline
 * ring and a serif monogram. Not an identicon: no blocks, no pixels, no
 * generated faces. It should read as an engraved luggage tag.
 *
 * Determinism is load-bearing. Everything here is a pure function of the seed
 * string, including the gradient element ids, so the markup React renders on
 * the server is byte-identical to what it renders on the client. No
 * `Math.random()`, no `Date`, no counters.
 */

import { hashSeed, mulberry32 } from './rng';

/**
 * The hue bank. Full-spectrum hue selection produces mint greens and hot pinks
 * that fight the globe; these ten are picked to sit inside the house palette
 * at low saturation — steel, indigo, teal, moss, ochre, oxblood, plum, slate
 * violet, sea, brick.
 */
const HUES = [198, 212, 172, 96, 38, 18, 286, 258, 148, 6] as const;

export interface AvatarSpec {
  /** The seed this spec was derived from. */
  seed: string;
  /** Stable, collision-resistant suffix for SVG element ids. */
  key: string;
  hue: number;
  /** Top-left of the plate gradient — the lit corner. */
  plateTop: string;
  /** Bottom-right of the plate gradient — where it falls into the surface. */
  plateBottom: string;
  /** Sheen sweep angle in degrees. */
  angle: number;
  /** Brass ring alpha. Founding-feeling seeds get a slightly brighter ring. */
  ringAlpha: number;
  /** A saturated version of the plate hue, for status dots and rings. */
  accent: string;
  /** Ink colour for the monogram — always warm white, never pure. */
  monogram: string;
}

/**
 * Initials from a display name. Handles particles ("van Doorne", "bin Ghurair",
 * "El-Kassab") by skipping lowercase connectives, and hyphenated double-barrels
 * by taking the first segment only — "Vasseur-Roche" is one surname, not two.
 */
export function initialsFrom(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(van|von|de|del|della|di|da|bin|bint|al|el|le|la|of)$/i.test(w));
  if (words.length === 0) return '·';

  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : '';
  const head = firstLetter(first);
  const tail = last ? firstLetter(last) : '';
  return (head + tail).toUpperCase() || '·';
}

function firstLetter(word: string): string {
  // Strip leading punctuation and take the first letter of the first segment
  // of a hyphenated name.
  const cleaned = word.replace(/^[^\p{L}]+/u, '');
  const seg = cleaned.split('-')[0] ?? cleaned;
  return seg.slice(0, 1);
}

const cache = new Map<string, AvatarSpec>();

/** Pure, memoised. Same seed → same spec, on both sides of the wire. */
export function avatarSpec(seed: string): AvatarSpec {
  const hit = cache.get(seed);
  if (hit) return hit;

  const h32 = hashSeed(`avatar:${seed}`);
  const rand = mulberry32(h32);

  const hue = HUES[Math.floor(rand() * HUES.length)]!;
  // Low saturation is the whole aesthetic. 12–26% reads as tinted graphite;
  // above ~35% it starts to look like a consumer app.
  const sat = 12 + rand() * 14;
  const topL = 15 + rand() * 8; // 15–23%
  const bottomL = 5.5 + rand() * 3.5; // 5.5–9%
  // The gradient drifts hue slightly across the plate so it never reads flat.
  const drift = (rand() - 0.5) * 26;

  const spec: AvatarSpec = {
    seed,
    key: h32.toString(36),
    hue,
    plateTop: `hsl(${round(hue)} ${round(sat)}% ${round(topL)}%)`,
    plateBottom: `hsl(${round(hue + drift)} ${round(sat * 0.72)}% ${round(bottomL)}%)`,
    angle: 118 + rand() * 44,
    ringAlpha: 0.3 + rand() * 0.24,
    accent: `hsl(${round(hue)} ${round(sat * 2.4)}% 62%)`,
    monogram: 'rgba(244,241,234,0.86)',
  };

  cache.set(seed, spec);
  return spec;
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** Just the accent colour — for peer rings and presence dots. */
export const avatarAccent = (seed: string): string => avatarSpec(seed).accent;

/**
 * Standalone SVG markup. The React component in `components/social/Avatar.tsx`
 * draws the same thing in JSX; this string form exists for anywhere a DOM tree
 * is not available — canvas textures on the globe, `background-image`, and the
 * scratch scripts that verify the generator.
 */
export function avatarSvg(seed: string, size: number, name: string): string {
  const s = avatarSpec(seed);
  const initials = initialsFrom(name);
  const id = `av${s.key}`;
  const r = size / 2;
  // Ring sits half a pixel inside the edge so a 1px stroke is not clipped.
  const ringR = r - 0.5;
  const fontSize = size * 0.34;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeAttr(name)}">`,
    `<defs>`,
    `<linearGradient id="${id}p" gradientTransform="rotate(${s.angle} 0.5 0.5)">`,
    `<stop offset="0%" stop-color="${s.plateTop}"/>`,
    `<stop offset="100%" stop-color="${s.plateBottom}"/>`,
    `</linearGradient>`,
    `<radialGradient id="${id}s" cx="28%" cy="20%" r="72%">`,
    `<stop offset="0%" stop-color="rgba(255,255,255,0.16)"/>`,
    `<stop offset="100%" stop-color="rgba(255,255,255,0)"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<circle cx="${r}" cy="${r}" r="${r}" fill="url(#${id}p)"/>`,
    `<circle cx="${r}" cy="${r}" r="${r}" fill="url(#${id}s)"/>`,
    `<circle cx="${r}" cy="${r}" r="${ringR}" fill="none" stroke="rgba(200,168,102,${round(s.ringAlpha)})" stroke-width="1"/>`,
    `<circle cx="${r}" cy="${r}" r="${Math.max(0, ringR - 2.5)}" fill="none" stroke="rgba(244,241,234,0.05)" stroke-width="1"/>`,
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" `,
    `fill="${s.monogram}" font-family="Didot, 'Bodoni MT', 'Hoefler Text', Garamond, 'Times New Roman', serif" `,
    `font-size="${round(fontSize)}" letter-spacing="${round(size * 0.012)}">${escapeText(initials)}</text>`,
    `</svg>`,
  ].join('');
}

/** `data:` URI form of {@link avatarSvg}. Safe in `src` and `background-image`. */
export function avatarDataUri(seed: string, size: number, name: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(seed, size, name))}`;
}

const escapeText = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (v: string): string => escapeText(v).replace(/"/g, '&quot;');
