/**
 * MERIDIAN — date primitives for the buzz engine.
 *
 * Deliberately duplicated from `@/lib/stores/useTimelineStore` rather than
 * imported: that module is a `'use client'` zustand store, and the scoring
 * engine has to run in three places where a client store must not be pulled in —
 * the Next route handlers (server), `scripts/validate-data.ts` (plain node via
 * tsx), and the React selectors (client). These helpers are pure, UTC-only and
 * have no dependencies, so the duplication costs nothing and keeps the engine
 * importable from anywhere.
 *
 * Everything here operates on `YYYY-MM-DD` strings in UTC. No local timezones,
 * no `Date.now()` inside pure functions — determinism is a hard requirement of
 * the scoring model (see scoring.ts).
 */

const MS_PER_DAY = 86_400_000;

/** `Date` → `YYYY-MM-DD` in UTC. */
export const toISODate = (d: Date): string => d.toISOString().slice(0, 10);

/** Today in UTC as `YYYY-MM-DD`. The only impure function in the engine. */
export const todayISO = (): string => toISODate(new Date());

/** Parse `YYYY-MM-DD` to epoch ms at UTC midnight. `NaN` when malformed. */
export const parseISODate = (iso: string): number =>
  Date.parse(`${iso}T00:00:00.000Z`);

/** Whole days from `a` to `b`. Positive when `b` is later. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((parseISODate(b) - parseISODate(a)) / MS_PER_DAY);

/** Shift an ISO date by whole days. */
export const addDays = (iso: string, days: number): string => {
  const d = new Date(parseISODate(iso));
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
};

/** True when `iso` is a syntactically valid, real calendar date. */
export const isValidISODate = (iso: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const t = parseISODate(iso);
  if (Number.isNaN(t)) return false;
  // Rejects 2026-02-30 style overflow, which Date.parse silently rolls over.
  return toISODate(new Date(t)) === iso;
};

/** Inclusive containment: is `iso` within [start, end]? */
export const isWithin = (iso: string, start: string, end: string): boolean =>
  iso >= start && iso <= end;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

/**
 * Hermite smoothstep on [0,1]. C¹-continuous — no visible kink where a taper
 * meets a plateau, which matters because these curves drive beacon intensity.
 */
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
