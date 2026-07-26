/**
 * The single bridge between `globals.css` and TypeScript.
 *
 * Nothing else in `components/**` is allowed to name a colour. Components use
 * the Tailwind utility maps below; canvas code (which cannot use classes) reads
 * the live custom property off `:root` via `readCssVar`, so even the pixels
 * painted into `<canvas>` come from the same tokens as the DOM.
 *
 * Contrast note — measured against the composited `.glass` surface
 * (82% obsidian over the void, and over a lit globe pixel):
 *   ink        17.3:1   body, headings, anything that must be read
 *   ink-muted   7.9:1   secondary body — still comfortably AA
 *   brass       8.6:1   safe as text; reserved for active/chrome
 *   ink-faint   3.6:1   FAILS AA for body — decoration and rules only
 *   ink-ghost   1.9:1   structural marks only, never text
 * Heat colours span 3.4:1 (smoldering) to 17:1 (supernova), so heat is
 * expressed as a *mark* and its label is always drawn in ink / ink-muted.
 */

import type { EventCategory, EventTier, HeatLevel } from '@/lib/types';
import { HEAT_LEVELS } from '@/lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// CSS custom property access (for canvas / imperative paint)
// ─────────────────────────────────────────────────────────────────────────────

/** Reads a custom property off the document root. SSR-safe via `fallback`. */
export function readCssVar(name: string, fallback = '#000000'): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Heat
// ─────────────────────────────────────────────────────────────────────────────

export const HEAT_CSS_VAR: Record<HeatLevel, string> = {
  smoldering: '--color-heat-smoldering',
  warm: '--color-heat-warm',
  hot: '--color-heat-hot',
  blazing: '--color-heat-blazing',
  supernova: '--color-heat-supernova',
};

/** Tailwind text utilities. Use for marks — see the contrast note above. */
export const HEAT_TEXT: Record<HeatLevel, string> = {
  smoldering: 'text-heat-smoldering',
  warm: 'text-heat-warm',
  hot: 'text-heat-hot',
  blazing: 'text-heat-blazing',
  supernova: 'text-heat-supernova',
};

export const HEAT_BG: Record<HeatLevel, string> = {
  smoldering: 'bg-heat-smoldering',
  warm: 'bg-heat-warm',
  hot: 'bg-heat-hot',
  blazing: 'bg-heat-blazing',
  supernova: 'bg-heat-supernova',
};

/** Copy for the ramp. Deliberately understated — no exclamation anywhere. */
export const HEAT_LABEL: Record<HeatLevel, string> = {
  smoldering: 'Smoldering',
  warm: 'Warm',
  hot: 'Hot',
  blazing: 'Blazing',
  supernova: 'Supernova',
};

export const HEAT_NOTE: Record<HeatLevel, string> = {
  smoldering: 'Quiet. Early enough that nothing is booked out',
  warm: 'Building. The circuit has noticed',
  hot: 'Contended. Beds and slots are tightening',
  blazing: 'Peak demand. Book, or accept the compromise',
  supernova: 'The defining week of its season',
};

/**
 * Score → heat, for places where only a number is available (the density
 * ribbon aggregates by day and has no `BuzzScore`). Authoritative per-event
 * heat always comes from `buzz.heat`; this is the fallback ramp.
 */
export function heatFromScore(score: number): HeatLevel {
  if (score >= 84) return 'supernova';
  if (score >= 68) return 'blazing';
  if (score >= 52) return 'hot';
  if (score >= 35) return 'warm';
  return 'smoldering';
}

export const heatRank = (h: HeatLevel): number => HEAT_LEVELS.indexOf(h);

// ─────────────────────────────────────────────────────────────────────────────
// Tiers
// ─────────────────────────────────────────────────────────────────────────────

export const TIER_LABEL: Record<EventTier, string> = {
  legendary: 'Legendary',
  marquee: 'Marquee',
  insider: 'Insider',
};

export const TIER_NOTE: Record<EventTier, string> = {
  legendary: 'Defines its week on the calendar',
  marquee: 'Major fixture, widely known inside the circuit',
  insider: 'Known to the people who go. Not yet crowded',
};

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  art: 'Art',
  music: 'Music',
  motorsport: 'Motorsport',
  sailing: 'Sailing',
  ski: 'Ski',
  culinary: 'Culinary',
  fashion: 'Fashion',
  wellness: 'Wellness',
  safari: 'Safari',
  equestrian: 'Equestrian',
  film: 'Film',
  design: 'Design',
  golf: 'Golf',
  tennis: 'Tennis',
  nature: 'Nature',
  cultural: 'Cultural',
  gala: 'Gala',
};

// ─────────────────────────────────────────────────────────────────────────────
// Motion — mirrors the @theme block. Used where `motion` needs raw numbers.
// ─────────────────────────────────────────────────────────────────────────────

export type CubicBezier = [number, number, number, number];

export const EASE_GLIDE: CubicBezier = [0.22, 1, 0.36, 1];
export const EASE_SETTLE: CubicBezier = [0.16, 1, 0.3, 1];

export const DURATION = {
  instant: 0.12,
  quick: 0.24,
  considered: 0.52,
  cinematic: 1.4,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

const UTC = { timeZone: 'UTC' } as const;

const parse = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/**
 * Dates are formatted by hand rather than through `Intl.DateTimeFormat`.
 *
 * This is not premature cleverness — it fixes a real hydration failure. Node
 * and Chromium ship different ICU versions, and they disagree about `en-GB`
 * long dates: Node emits `Sunday, 26 July 2026` and the browser emits
 * `Sunday 26 July 2026`. React sees the server text and the client text differ
 * by one comma and throws away the whole tree (error #418). Any locale-aware
 * formatter rendered during SSR is exposed to the same class of drift on the
 * next ICU bump.
 *
 * These tables are the product's house date style, they are UTC-anchored so a
 * traveller's own timezone cannot shift an event's date, and they produce
 * byte-identical output everywhere forever.
 */
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const WEEKDAYS_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
] as const;

const dd = (n: number): string => String(n).padStart(2, '0');

/** `14 May 2027` */
export const formatDate = (iso: string): string => {
  const d = parse(iso);
  return `${dd(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** `14 May` */
export const formatDayMonth = (iso: string): string => {
  const d = parse(iso);
  return `${dd(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]}`;
};

/** `Friday 14 May 2027` — used where the date is the subject, not a stat. */
export const formatDateFull = (iso: string): string => {
  const d = parse(iso);
  return `${WEEKDAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** `May` */
export const formatMonth = (iso: string): string =>
  MONTHS_SHORT[parse(iso).getUTCMonth()];

/**
 * A run of dates as a person would write it:
 *   single day  → `14 May 2027`
 *   same month  → `14 – 17 May 2027`
 *   same year   → `28 May – 2 Jun 2027`
 *   spanning    → `28 Dec 2027 – 2 Jan 2028`
 */
export function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const a = parse(start);
  const b = parse(end);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) {
    return `${String(a.getUTCDate()).padStart(2, '0')} – ${formatDate(end)}`;
  }
  if (sameYear) return `${formatDayMonth(start)} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Human phrasing for `daysUntil`, which is negative once an event has begun. */
export function formatDaysUntil(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `${days}d`;
}

/** Compact money, no cents. `$18,000` → `$18k`, `$1,200,000` → `$1.2m` */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m >= 10 ? Math.round(m) : m.toFixed(1)}m`;
  }
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

export const formatScore = (n: number): string =>
  Number.isFinite(n) ? n.toFixed(1) : '—';

/** Signed percentage for trend. `+18%` / `−4%` (true minus sign). */
export function formatTrend(trend: number): string {
  const pct = Math.round(trend * 100);
  if (pct === 0) return 'flat';
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}
