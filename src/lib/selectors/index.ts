'use client';

/**
 * MERIDIAN — selectors.
 *
 * The single bridge between the data/buzz layers and everything that renders.
 * The globe, the timeline ribbon, the dossier and the filter panel all import
 * from here and from nowhere else in `@/lib/data` or `@/lib/buzz`.
 *
 * ── The scrubber is the "now" ────────────────────────────────────────────────
 *
 * The single most consequential decision in this layer: **buzz is evaluated at
 * the timeline focus date, not at today's date.** `scoreEvents` is called with
 * `now = focus`.
 *
 * Why. The proximity multiplier in the scoring model is what makes the globe
 * honest — an event 300 days out must not out-rank one happening next week at
 * comparable signal levels. But that same multiplier, if it is always anchored
 * to today, permanently flattens the far half of a 425-day scrubber: measured
 * against the shipped calendar, the Monaco Grand Prix has the single highest
 * intrinsic signal profile of all 237 events (88.1) and yet lands at rank 131,
 * "warm", simply because it is 313 days away. Slide to Monaco GP weekend and
 * Monaco is a dim beacon. That is the product being broken.
 *
 * Anchoring to the focus date resolves it without weakening the model:
 *
 *   • On load, `focus === today`, so the opening view is *exactly* the
 *     distribution the validator measures and reports. Nothing changes about
 *     the calibration, the heat histogram, or the top-20 list.
 *   • The proximity requirement still holds in full — within any single scoring
 *     pass, an event 300 days beyond the focus scores 0.27× against 0.96× for
 *     one seven days out.
 *   • Scrub to Monaco GP weekend and Monaco's proximity is 1.0: it scores 88.1
 *     and burns supernova, which is the stated acceptance test.
 *   • "Events already past score 0" becomes past *relative to where you are
 *     looking*, which is what a time machine should mean.
 *
 * ── Performance contract ─────────────────────────────────────────────────────
 *
 * Scoring the full calendar measures at **0.54 ms** (237 events, six signals,
 * plus the rank sort) — 3% of a 60fps frame. It is memoised on the focus *date
 * string*, so a drag only re-scores when it crosses a day boundary, not per
 * frame, and the module-scope cache means N mounted consumers share one pass.
 *
 * Two tiers:
 *
 *   Tier 1 — `useBuzzMap()`  re-scores on day-boundary crossings only.
 *   Tier 2 — `useAllScoredEvents()`  a 237-element map computing two floats per
 *            event. Genuinely per-scrub, genuinely trivial.
 *
 * `useHeatByDay` is in neither tier: see its own note. It is anchored to each
 * event's own dates, so it is completely independent of the scrubber and is
 * built exactly once per session.
 *
 * ── daysUntil semantics ──────────────────────────────────────────────────────
 *
 * `ScoredEvent.daysUntil` (and `Beacon.daysUntil`) is measured from the
 * **timeline focus date, not from today**. Scrub to March and an event in March
 * reads "in 2 days". Consistent with `relevance` and with the scoring anchor
 * above: every temporal readout on screen agrees about what "now" means. Use
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
import { scoreEvent, scoreEvents } from '@/lib/buzz/scoring';
import { computeRelevance, daysUntil as daysUntilFocus } from '@/lib/buzz/relevance';
import { daysBetween } from '@/lib/buzz/dates';
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
 * eventId → BuzzScore for the full calendar, evaluated at the timeline focus.
 *
 * Re-scores only when the focus crosses a day boundary (the memo key is the ISO
 * date), and the module-scope cache is shared by every consumer. Exported for
 * debug panels.
 */
export function useBuzzMap(): Map<string, BuzzScore> {
  const events = useEvents();
  const { counts, signature } = usePeerData();
  const focus = useTimelineStore((s) => s.focus);
  const key = `${events.length}|${signature}|${focus}`;
  return useMemo(
    () => computeBuzzMap(events, counts, focus, key),
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
  peerCounts: Record<string, number>,
  rangeStart: string,
  rangeEnd: string,
  key: string,
): HeatDay[] {
  if (heatCache && heatCache.key === key) return heatCache.days;

  /**
   * The ribbon is scored **at each event's own dates**, not at the scrubber
   * position — every event contributes its score as evaluated on the day it is
   * running, i.e. with proximity at its 1.0 plateau.
   *
   * This is what makes the ribbon a *preview*: because beacons are scored at
   * the focus date, the tallest beacon you will see when you scrub to day D is
   * exactly `peak` for day D. The ribbon and the globe cannot disagree.
   *
   * It also makes the ribbon completely independent of the scrubber, which is
   * the stated requirement — it is built once and never rebuilt during a drag.
   */
  const intrinsic = new Map<string, number>();
  for (const e of events) {
    intrinsic.set(e.id, scoreEvent(e, { now: e.start, peerCounts }).score);
  }

  const span = daysBetween(rangeStart, rangeEnd);
  const n = Math.max(0, span) + 1;

  // Dense arrays indexed by day offset — one allocation, no string keys in the
  // hot loop. 426 days × 3 arrays is nothing, and it keeps the whole build
  // linear in Σ(event duration) rather than events × days.
  const total = new Float64Array(n);
  const peak = new Float64Array(n);
  const count = new Int32Array(n);

  for (const e of events) {
    const score = intrinsic.get(e.id) ?? 0;
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
 * **Computed once per session.** It depends on the event set, the peer counts
 * and the scrubber bounds — never on `focus` — so dragging does not touch it at
 * all. The module-scope cache means it also survives a remount of the timeline
 * component without a 426-day rebuild.
 *
 * Events partially outside the range are clipped, not dropped: a regatta that
 * started yesterday still contributes to today's column.
 */
export function useHeatByDay(): HeatDay[] {
  const events = useEvents();
  const { counts, signature } = usePeerData();
  const rangeStart = useTimelineStore((s) => s.rangeStart);
  const rangeEnd = useTimelineStore((s) => s.rangeEnd);

  const key = `${rangeStart}|${rangeEnd}|${events.length}|${signature}`;

  return useMemo(
    () => computeHeatByDay(events, counts, rangeStart, rangeEnd, key),
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
