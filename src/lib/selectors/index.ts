'use client';

/**
 * MERIDIAN — selectors.
 *
 * The single bridge between the data/buzz layers and everything that renders.
 * The globe, the timeline ribbon, the dossier and the filter panel all import
 * from here and from nowhere else in `@/lib/data` or `@/lib/buzz`.
 *
 * ── Performance contract ─────────────────────────────────────────────────────
 *
 * These hooks run on every frame of a scrubber drag. The whole design is built
 * around one observation: **buzz scores do not depend on the scrubber.** They
 * depend on the event set, the peer counts and today's date — none of which
 * change while dragging. Only `relevance` and `daysUntil` are focus-dependent,
 * and both are a few float ops.
 *
 * So the work is split into two tiers:
 *
 *   Tier 1 — `useBuzzMap()`   scoring, ~200 events × 6 signals + a sort.
 *                             Memoised on (events, peerSignature, today) and
 *                             additionally cached at module scope, so it runs
 *                             once per session, not once per consumer.
 *   Tier 2 — `useAllScoredEvents()`  a 200-element map computing two numbers
 *                             per event. Recomputed per scrub. Trivial.
 *
 * `useHeatByDay` is Tier 1: it is keyed off the buzz map's object identity and
 * memoised at module scope, so the 426-day density ribbon is computed exactly
 * once and never touched again during a drag.
 *
 * ── daysUntil semantics ──────────────────────────────────────────────────────
 *
 * `ScoredEvent.daysUntil` (and `Beacon.daysUntil`) is measured from the
 * **timeline focus date, not from today**. Scrub to March and an event in March
 * reads "in 2 days". This is deliberate and consistent with `relevance`, which
 * is also focus-relative: the scrubber is a time machine, and every temporal
 * readout on screen must agree about what "now" means. Use
 * `daysBetween(todayISO(), event.start)` directly if you need the wall-clock
 * countdown.
 */

import { useMemo } from 'react';
import type {
  Beacon,
  BuzzScore,
  EventCategory,
  EventTier,
  WorldEvent,
} from '@/lib/types';
import { EVENTS } from '@/lib/data';
import { scoreEvents } from '@/lib/buzz/scoring';
import { computeRelevance, daysUntil as daysUntilFocus } from '@/lib/buzz/relevance';
import { daysBetween, todayISO } from '@/lib/buzz/dates';
import { useTimelineStore } from '@/lib/stores/useTimelineStore';
import { useFilterStore } from '@/lib/stores/useFilterStore';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { usePeerCounts } from '@/lib/social';

// ─────────────────────────────────────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoredEvent extends WorldEvent {
  buzz: BuzzScore;
  /** 0..1 at the current timeline focus. */
  relevance: number;
  /** Days from the timeline focus to `start`. Negative once started. */
  daysUntil: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1 — scoring (focus-independent)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_PEERS: Record<string, number> = Object.freeze({});

/**
 * Peer counts, defended against the social layer being absent, empty, or
 * returning a fresh object identity on every render.
 *
 * The signature is `count:sum` — cheap (one pass over ≤ 200 small ints) and
 * sufficient: peer counts only ever change by a whole interest signal, so a
 * collision would require two simultaneous equal-and-opposite moves.
 */
function usePeerData(): { counts: Record<string, number>; signature: string } {
  const raw = usePeerCounts();
  const counts = raw && typeof raw === 'object' ? raw : EMPTY_PEERS;

  const signature = useMemo(() => {
    const keys = Object.keys(counts);
    let sum = 0;
    for (const k of keys) sum += counts[k] ?? 0;
    return `${keys.length}:${sum}`;
  }, [counts]);

  return { counts, signature };
}

/** Module-scope memo so N mounted consumers share one scoring pass. */
let buzzCache: { key: string; map: Map<string, BuzzScore> } | null = null;

function computeBuzzMap(
  events: WorldEvent[],
  peerCounts: Record<string, number>,
  now: string,
  key: string,
): Map<string, BuzzScore> {
  if (buzzCache && buzzCache.key === key) return buzzCache.map;
  const map = new Map<string, BuzzScore>();
  for (const s of scoreEvents(events, { now, peerCounts })) map.set(s.eventId, s);
  buzzCache = { key, map };
  return map;
}

/**
 * The cache key that fully determines the current buzz map: calendar size, peer
 * signature, and today's date. Anything downstream that is a pure function of
 * the buzz map can memoise on this string instead of on the Map's identity,
 * which keeps those memos alive across component remounts.
 */
function useBuzzKey(): string {
  const events = useEvents();
  const { signature } = usePeerData();
  // Recomputes when the calendar day rolls over, which is exactly right: an
  // event's proximity multiplier is a function of the date, not the clock.
  return `${events.length}|${signature}|${todayISO()}`;
}

/**
 * eventId → BuzzScore for the full calendar. Stable across scrubbing.
 * Exported because `useHeatByDay` and the debug panels want it directly.
 */
export function useBuzzMap(): Map<string, BuzzScore> {
  const events = useEvents();
  const { counts } = usePeerData();
  const key = useBuzzKey();
  return useMemo(
    () => computeBuzzMap(events, counts, key.split('|')[2], key),
    // `key` fully determines the result; `events`/`counts` are inputs to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The curated calendar. A module-level constant, so the reference is stable for
 * the lifetime of the page and every downstream `useMemo` behaves.
 *
 * Live signal enrichment deliberately does *not* flow through here — it happens
 * server-side behind `/api/events`. Shipping the curated baseline in the bundle
 * means the globe renders instantly on first paint with no waterfall, and a
 * live sweep can only ever sharpen numbers the member is already looking at.
 */
export function useEvents(): WorldEvent[] {
  return EVENTS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 — focus-dependent projection
// ─────────────────────────────────────────────────────────────────────────────

/** Every event, scored and projected onto the current focus. Not filtered. */
export function useAllScoredEvents(): ScoredEvent[] {
  const events = useEvents();
  const buzz = useBuzzMap();
  const focus = useTimelineStore((s) => s.focus);
  const spanDays = useTimelineStore((s) => s.spanDays);

  return useMemo(() => {
    const out: ScoredEvent[] = new Array(events.length);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      out[i] = {
        ...e,
        buzz:
          buzz.get(e.id) ??
          // Defensive: an event with no score would otherwise crash the globe.
          {
            eventId: e.id,
            score: 0,
            heat: 'smoldering',
            rank: events.length,
            components: {
              socialMentions: 0,
              socialVelocity: 0,
              searchInterest: 0,
              mediaMentions: 0,
              bookingPressure: 0,
              exclusivity: 0,
            },
            trend: 0,
          },
        relevance: computeRelevance(e, focus, spanDays),
        daysUntil: daysUntilFocus(e, focus),
      };
    }
    out.sort((a, b) => a.buzz.rank - b.buzz.rank);
    return out;
  }, [events, buzz, focus, spanDays]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtering
// ─────────────────────────────────────────────────────────────────────────────

function matchesQuery(e: WorldEvent, needle: string): boolean {
  if (!needle) return true;
  if (e.name.toLowerCase().includes(needle)) return true;
  if (e.city.toLowerCase().includes(needle)) return true;
  if (e.country.toLowerCase().includes(needle)) return true;
  for (const tag of e.tags) if (tag.toLowerCase().includes(needle)) return true;
  return false;
}

/**
 * Filtered, scored, sorted by rank (hottest first).
 *
 * Ranks are global, assigned across the *whole* calendar — filtering to "ski"
 * does not renumber the ski events 1..n. Heat and rank are properties of the
 * event, not of the current view, so two members with different filters always
 * agree about how hot Monaco is.
 */
export function useScoredEvents(): ScoredEvent[] {
  const all = useAllScoredEvents();
  const { counts } = usePeerData();

  const categories = useFilterStore((s) => s.categories);
  const tiers = useFilterStore((s) => s.tiers);
  const maxPriceIndex = useFilterStore((s) => s.maxPriceIndex);
  const minScore = useFilterStore((s) => s.minScore);
  const peerActivityOnly = useFilterStore((s) => s.peerActivityOnly);
  const query = useFilterStore((s) => s.query);

  const needle = query.trim().toLowerCase();

  return useMemo(() => {
    const catSet = categories.length ? new Set<EventCategory>(categories) : null;
    const tierSet = tiers.length ? new Set<EventTier>(tiers) : null;

    return all.filter((e) => {
      if (catSet) {
        // Secondary categories count — an event tagged music/gala should
        // surface under either lens.
        const primary = catSet.has(e.category);
        const secondary = e.secondaryCategories?.some((c) => catSet.has(c)) ?? false;
        if (!primary && !secondary) return false;
      }
      if (tierSet && !tierSet.has(e.tier)) return false;
      if (e.priceIndex > maxPriceIndex) return false;
      if (e.buzz.score < minScore) return false;
      if (peerActivityOnly && (counts[e.id] ?? 0) <= 0) return false;
      if (!matchesQuery(e, needle)) return false;
      return true;
    });
  }, [all, categories, tiers, maxPriceIndex, minScore, peerActivityOnly, needle, counts]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Globe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The globe renderer's only input. Every `Beacon` field is populated here —
 * the renderer must never reach back into a store for `focused` or `peerCount`,
 * or it stops being a pure function of this array.
 */
export function useBeacons(): Beacon[] {
  const events = useScoredEvents();
  const selectedEventId = useGlobeStore((s) => s.selectedEventId);
  const { counts } = usePeerData();

  return useMemo(
    () =>
      events.map((e) => ({
        eventId: e.id,
        coords: e.coords,
        score: e.buzz.score,
        heat: e.buzz.heat,
        category: e.category,
        label: e.name,
        city: e.city,
        relevance: e.relevance,
        daysUntil: e.daysUntil,
        focused: e.id === selectedEventId,
        peerCount: counts[e.id] ?? 0,
      })),
    [events, selectedEventId, counts],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up one scored event. Searches the *unfiltered* set on purpose: opening a
 * dossier must keep working after the member narrows the filters underneath it.
 */
export function useEventById(id: string | null): ScoredEvent | undefined {
  const all = useAllScoredEvents();
  return useMemo(() => (id ? all.find((e) => e.id === id) : undefined), [all, id]);
}

/** The n hottest events that survive the current filters. */
export function useTopEvents(n: number): ScoredEvent[] {
  const events = useScoredEvents();
  return useMemo(() => events.slice(0, Math.max(0, n)), [events, n]);
}

/** Peer interest count for one event. 0 when the social layer is unavailable. */
export function useNearbyPeersCount(eventId: string): number {
  const { counts } = usePeerData();
  return counts[eventId] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline density ribbon
// ─────────────────────────────────────────────────────────────────────────────

export interface HeatDay {
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** Summed buzz of every event running that day */
  total: number;
  /** Highest single buzz score running that day */
  peak: number;
  /** Number of events running that day */
  count: number;
}

let heatCache: { key: string; days: HeatDay[] } | null = null;

function computeHeatByDay(
  events: WorldEvent[],
  buzz: Map<string, BuzzScore>,
  rangeStart: string,
  rangeEnd: string,
  key: string,
): HeatDay[] {
  if (heatCache && heatCache.key === key) return heatCache.days;

  const span = daysBetween(rangeStart, rangeEnd);
  const n = Math.max(0, span) + 1;

  // Dense arrays indexed by day offset — one allocation, no string keys in the
  // hot loop. 426 days × 3 arrays is nothing, and it keeps the whole build
  // linear in Σ(event duration) rather than events × days.
  const total = new Float64Array(n);
  const peak = new Float64Array(n);
  const count = new Int32Array(n);

  for (const e of events) {
    const score = buzz.get(e.id)?.score ?? 0;
    // A finished event scores 0 and contributes nothing — but it must still not
    // be skipped structurally, or a same-day event at the range start vanishes.
    let from = daysBetween(rangeStart, e.start);
    let to = daysBetween(rangeStart, e.end);
    if (to < 0 || from > span) continue; // entirely outside the scrubber
    if (from < 0) from = 0;
    if (to > span) to = span;

    for (let d = from; d <= to; d++) {
      total[d] += score;
      if (score > peak[d]) peak[d] = score;
      count[d] += 1;
    }
  }

  const days: HeatDay[] = new Array(n);
  const base = Date.parse(`${rangeStart}T00:00:00.000Z`);
  for (let d = 0; d < n; d++) {
    days[d] = {
      date: new Date(base + d * 86_400_000).toISOString().slice(0, 10),
      total: Math.round(total[d] * 100) / 100,
      peak: Math.round(peak[d] * 100) / 100,
      count: count[d],
    };
  }

  heatCache = { key, days };
  return days;
}

/**
 * One entry per day across the full scrubber range (today → +425 days), driving
 * the timeline's density ribbon.
 *
 * **Computed once per session.** It depends only on the buzz map (stable) and
 * the scrubber bounds (module constants in the timeline store), never on
 * `focus` — so dragging the scrubber does not touch this at all. The module
 * -scope cache means it survives remounts of the timeline component too.
 *
 * Events partially outside the range are clipped, not dropped: a regatta that
 * started yesterday still contributes to today's column.
 */
export function useHeatByDay(): HeatDay[] {
  const events = useEvents();
  const buzz = useBuzzMap();
  const rangeStart = useTimelineStore((s) => s.rangeStart);
  const rangeEnd = useTimelineStore((s) => s.rangeEnd);
  const buzzKey = useBuzzKey();

  // Keyed on the buzz map's *inputs*, not its identity — so the ribbon survives
  // a remount of the timeline component without a 426-day rebuild.
  const key = `${rangeStart}|${rangeEnd}|${buzzKey}`;

  return useMemo(
    () => computeHeatByDay(events, buzz, rangeStart, rangeEnd, key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category breakdown
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoryBreakdown {
  category: EventCategory;
  count: number;
  avgScore: number;
}

/**
 * Per-category counts and mean buzz across the **unfiltered** calendar, sorted
 * by average score descending.
 *
 * Unfiltered on purpose: this drives the category chooser, and a chooser whose
 * numbers collapse the moment you pick a category is useless for picking a
 * second one.
 *
 * Finished events (score 0) are excluded from both figures — they are not part
 * of the calendar a member can act on, and including them would drag every
 * average toward zero by an amount that depends only on how far into the year
 * we are.
 */
export function useCategoryBreakdown(): CategoryBreakdown[] {
  const all = useAllScoredEvents();

  return useMemo(() => {
    const acc = new Map<EventCategory, { count: number; sum: number }>();
    for (const e of all) {
      if (e.buzz.score <= 0) continue;
      const cur = acc.get(e.category);
      if (cur) {
        cur.count += 1;
        cur.sum += e.buzz.score;
      } else {
        acc.set(e.category, { count: 1, sum: e.buzz.score });
      }
    }
    return Array.from(acc, ([category, { count, sum }]) => ({
      category,
      count,
      avgScore: Math.round((sum / count) * 100) / 100,
    })).sort((a, b) => b.avgScore - a.avgScore);
  }, [all]);
}
