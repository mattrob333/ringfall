/**
 * MERIDIAN — deterministic randomness for the social layer.
 *
 * Every peer, signal and group in this product is fabricated. That is only
 * acceptable if the fabrication is *stable*: the same member must be interested
 * in the same event on every render, on the server and on the client, forever.
 * So there is no `Math.random()` anywhere in `lib/social`, and no `Date.now()`
 * inside anything that feeds a render.
 *
 * `xmur3` gives us a well-mixed 32-bit seed from an arbitrary string;
 * `mulberry32` is a small, fast, statistically decent PRNG. Both are
 * integer-only and behave identically in every JS engine, which is what makes
 * SSR and hydration agree.
 */

/** String → well-distributed uint32. Avalanches on single-character changes. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Raw mulberry32 generator. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** [0, 1) */
  float(): number;
  /** [min, max) */
  range(min: number, max: number): number;
  /** Integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Uniform pick. Throws on an empty list rather than returning `undefined`. */
  pick<T>(items: readonly T[]): T;
  /** Pick by relative weight. `weights` aligns index-for-index with `items`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Fisher–Yates on a copy. Never mutates the input. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * Roughly normal in [0,1] via the mean of three uniforms (Bates, n=3).
   * Used wherever a flat distribution reads as obviously synthetic.
   */
  bell(): number;
}

export function makeRng(seed: string | number): Rng {
  const next = mulberry32(typeof seed === 'number' ? seed : hashSeed(seed));

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('rng.pick: empty list');
    return items[Math.floor(next() * items.length)]!;
  }

  return {
    float: next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick,
    weighted<T>(items: readonly T[], weights: readonly number[]): T {
      if (items.length === 0) throw new Error('rng.weighted: empty list');
      let total = 0;
      for (let i = 0; i < items.length; i++) total += Math.max(0, weights[i] ?? 0);
      if (total <= 0) return pick(items);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r <= 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const swap = out[i]!;
        out[i] = out[j]!;
        out[j] = swap;
      }
      return out;
    },
    bell: () => (next() + next() + next()) / 3,
  };
}

/** Clamp helper used all over the simulation. */
export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;
