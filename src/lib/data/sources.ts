/**
 * MERIDIAN — source registry and merge policy.
 *
 * Server-only. Nothing here may be imported from a client component: the
 * adapters read `process.env` and the whole point of this layer is that API
 * keys stop at the route handler.
 *
 * ── Merge policy ─────────────────────────────────────────────────────────────
 *
 * The curated dataset provides the **base** `BuzzSignals` for every event. Live
 * adapters return `Partial<BuzzSignals>` *patches* which override the base
 * field-by-field. A patch that omits a field leaves the curated value standing —
 * an adapter never has to invent a number just to fill a slot.
 *
 * Precedence, lowest to highest. Later sources overwrite earlier ones for the
 * fields they emit:
 *
 *   1. curated         all six fields (the baseline; always present)
 *   2. ticketmaster    bookingPressure, exclusivity
 *   3. predicthq       searchInterest, bookingPressure
 *   4. googleTrends    searchInterest, socialVelocity
 *   5. x               socialMentions, socialVelocity
 *   6. amadeus         bookingPressure
 *
 * The ordering is by *directness of measurement*, not by vendor quality:
 *
 *  • `socialMentions` — X is the only source that literally counts posts. It
 *    ranks last so nothing can override it. PredictHQ's attendance model is
 *    deliberately not mapped here at all (see predicthq.ts).
 *  • `searchInterest` — Google Trends is the definition of the field, so it
 *    outranks PredictHQ's rank model, which is a broader popularity proxy.
 *  • `socialVelocity` — X's own daily buckets beat the Trends slope, because
 *    Trends is weekly-smoothed and lags by days.
 *  • `bookingPressure` — Amadeus wins outright: it is real inventory that has
 *    actually been sold, whereas PredictHQ's local rank and Ticketmaster's
 *    congestion are both inference.
 *  • `exclusivity` — structural, essentially unmeasurable from public APIs.
 *    Only Ticketmaster nudges it, and only upward. In practice it stays curated.
 *
 * Unconfigured sources return an empty map and cost nothing. With no env vars
 * set — the default — the merged output is byte-identical to the curated
 * baseline, which is the state the app must always work in.
 */

import type { BuzzSignals, EventSource, SourceHealth, WorldEvent } from '@/lib/types';
import { curatedSource } from './adapters/curated';
import { ticketmasterSource } from './adapters/ticketmaster';
import { predictHQSource } from './adapters/predicthq';
import { googleTrendsSource } from './adapters/googleTrends';
import { xSource } from './adapters/x';
import { amadeusSource } from './adapters/amadeus';

/**
 * Registry in merge order — index 0 is lowest precedence. Reordering this array
 * *is* changing the merge policy; the doc block above is the contract.
 */
export const SOURCES: EventSource[] = [
  curatedSource,
  ticketmasterSource,
  predictHQSource,
  googleTrendsSource,
  xSource,
  amadeusSource,
];

/** Live sources are everything that enriches rather than provides records. */
export const LIVE_SOURCES: EventSource[] = SOURCES.filter((s) => s.id !== 'curated');

export function getSource(id: string): EventSource | undefined {
  return SOURCES.find((s) => s.id === id);
}

/** Health for every registered source, in merge order. */
export function getSourceHealth(): SourceHealth[] {
  return SOURCES.map((s) => {
    try {
      return s.health();
    } catch (err) {
      return {
        id: s.id,
        label: s.label,
        status: 'error' as const,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

/** True when at least one live adapter has credentials. */
export const anyLiveConfigured = (): boolean =>
  LIVE_SOURCES.some((s) => {
    try {
      return s.isConfigured();
    } catch {
      return false;
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Signal collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask every configured live source for signal patches and fold them together
 * in precedence order.
 *
 * Sources run in parallel — they hit unrelated vendors and there is no reason
 * to serialise — but they are *folded* in registry order, so the outcome is
 * independent of which one happens to answer first. That determinism matters:
 * without it, two identical requests could produce different scores.
 *
 * Never throws. A source that blows up contributes nothing and reports `error`.
 */
export async function collectSignalPatches(
  events: WorldEvent[],
): Promise<Map<string, Partial<BuzzSignals>>> {
  const merged = new Map<string, Partial<BuzzSignals>>();
  if (!events.length) return merged;

  const configured = LIVE_SOURCES.filter((s) => {
    try {
      return s.isConfigured() && typeof s.fetchSignals === 'function';
    } catch {
      return false;
    }
  });
  if (!configured.length) return merged;

  const settled = await Promise.all(
    configured.map(async (source) => {
      try {
        return await source.fetchSignals!(events);
      } catch {
        // Adapters already trap internally; this is belt-and-braces so a
        // synchronous throw in an adapter cannot reach the route handler.
        return new Map<string, Partial<BuzzSignals>>();
      }
    }),
  );

  // Fold in registry order, not completion order.
  for (const patchMap of settled) {
    for (const [eventId, patch] of patchMap) {
      const existing = merged.get(eventId);
      merged.set(eventId, existing ? { ...existing, ...patch } : { ...patch });
    }
  }

  return merged;
}

/** Apply a patch map to events, returning new records. Pure. */
export function applySignalPatches(
  events: WorldEvent[],
  patches: Map<string, Partial<BuzzSignals>>,
): WorldEvent[] {
  if (!patches.size) return events;
  return events.map((e) => {
    const patch = patches.get(e.id);
    return patch ? { ...e, signals: { ...e.signals, ...patch } } : e;
  });
}
