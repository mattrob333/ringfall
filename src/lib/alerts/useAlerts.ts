'use client';

/**
 * MERIDIAN — booking alerts, React surface.
 *
 * A thin client layer over the pure engine. All three hooks are projections of
 * one memoised pass over the calendar; none of them holds state, and none of
 * them reads the clock more than once per render.
 *
 * ── The memo key is a *day string*, never a timestamp ─────────────────────────
 *
 * This is the whole performance story. `todayISO()` returns `YYYY-MM-DD`, which
 * is stable for twenty-four hours, so the memo key is stable for twenty-four
 * hours. Keying on `Date.now()` — or calling `bookingAlerts(EVENTS)` inline and
 * letting the default parameter resolve — would produce a new value on every
 * render and re-run 241 alerts, with 241 fresh string allocations, on every
 * frame of any animation on the page. Alerts are the least volatile thing in
 * the product; they must cost nothing to look at.
 *
 * The cache lives at module scope rather than in each hook, so N mounted
 * consumers (a dossier, a rail, a badge on the globe) share a single pass and
 * survive each other's unmounts.
 *
 * ── Wall clock, not the scrubber ─────────────────────────────────────────────
 *
 * `@/lib/selectors` deliberately anchors buzz and `daysUntil` to the *timeline
 * focus*, so scrubbing to March makes March feel like now. Alerts do the
 * opposite and stay on the wall clock, as that module's own note prescribes:
 * a deadline is a fact about the real world. Sliding the scrubber must never
 * make a booking deadline appear to move.
 *
 * ── Hydration ────────────────────────────────────────────────────────────────
 *
 * `todayISO()` is UTC on both sides, so server and client agree except for a
 * request that straddles UTC midnight. The consequence there is one day's drift
 * in a headline until the next navigation, not a hydration mismatch of any
 * consequence — and the alternative (deferring to an effect) costs a blank
 * first paint on every alert in the app.
 */

import { useMemo } from 'react';
import { EVENTS } from '@/lib/data';
import type { WorldEvent } from '@/lib/types';
import { todayISO } from '@/lib/buzz/dates';
import { bookingAlerts, isActionable, sortByUrgency, type BookingAlert } from './engine';

interface AlertCache {
  key: string;
  sorted: BookingAlert[];
  actionable: BookingAlert[];
  byId: Map<string, BookingAlert>;
}

let cache: AlertCache | null = null;

/**
 * One pass, three projections, cached together — `useActionableAlerts` and
 * `useAlertFor` are filters over work `useBookingAlerts` has already done, so
 * computing them separately would triple the cost for no benefit.
 */
function computeAlerts(events: WorldEvent[], today: string, key: string): AlertCache {
  if (cache && cache.key === key) return cache;

  const sorted = sortByUrgency(bookingAlerts(events, today));
  const byId = new Map<string, BookingAlert>();
  for (const a of sorted) byId.set(a.eventId, a);

  cache = { key, sorted, actionable: sorted.filter(isActionable), byId };
  return cache;
}

/** `events.length` is enough: the curated calendar is a frozen module constant. */
function useAlertCache(): AlertCache {
  const today = todayISO();
  const key = `${today}|${EVENTS.length}`;
  return useMemo(
    () => computeAlerts(EVENTS, today, key),
    // `key` fully determines the result; `today` is an input to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
}

/**
 * Every event's booking alert, ranked: urgency band first (critical → closing →
 * passed → open → underway), then deadline ascending, then event id.
 */
export function useBookingAlerts(): BookingAlert[] {
  return useAlertCache().sorted;
}

/**
 * Only the alerts where acting today changes what the member gets — `closing`
 * and `critical`. This is the list a notification rail should render; the full
 * set is for a dossier, where "nothing to do until March" is useful context
 * rather than noise.
 */
export function useActionableAlerts(): BookingAlert[] {
  return useAlertCache().actionable;
}

/**
 * The alert for one event, or `undefined` when the id is null or unknown.
 *
 * Backed by the shared map, so opening a dossier is a hash lookup rather than a
 * linear scan of the calendar.
 */
export function useAlertFor(eventId: string | null): BookingAlert | undefined {
  const { byId } = useAlertCache();
  return eventId ? byId.get(eventId) : undefined;
}
