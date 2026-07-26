/**
 * MERIDIAN — data access facade.
 *
 * Two clearly separated halves:
 *
 *  • **Isomorphic** (`getEvents`, `getEventById`, …) — straight reads off the
 *    curated dataset. Safe in a client component, safe in a node script, no
 *    `fetch`, no `process.env`.
 *
 *  • **Server-only** (`getEnrichedEvents`, `refreshSignals`) — pulls live
 *    adapters through the source registry. These reach for API keys and must
 *    only ever be called from a route handler or a server component.
 *
 * The split is enforced by import discipline rather than by the `server-only`
 * package (not a dependency): the client bundle reaches this module solely
 * through `@/lib/selectors`, which imports only the isomorphic half.
 */

import type { BuzzSignals, WorldEvent } from '@/lib/types';
import { EVENTS, EVENT_INDEX } from '@/lib/data/events';
import { applySignalPatches, collectSignalPatches, getSourceHealth } from './sources';

export { getSourceHealth, getSourceHealth as sourceHealth } from './sources';
export { SOURCES, LIVE_SOURCES, anyLiveConfigured } from './sources';

// ─────────────────────────────────────────────────────────────────────────────
// Isomorphic reads
// ─────────────────────────────────────────────────────────────────────────────

/** The curated calendar, exactly as authored. Never mutate the result. */
export function getEvents(): WorldEvent[] {
  return EVENTS;
}

export function getEventById(id: string): WorldEvent | undefined {
  return EVENT_INDEX.get(id);
}

export function getEventsByIds(ids: string[]): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (const id of ids) {
    const e = EVENT_INDEX.get(id);
    if (e) out.push(e);
  }
  return out;
}

export { EVENTS, EVENT_INDEX };

// ─────────────────────────────────────────────────────────────────────────────
// Server-only: live enrichment with a TTL cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-process cache lifetime for merged live signals.
 *
 * Ten minutes is the brief's number and it is the right one: the fastest signal
 * in the model (X daily buckets) has a floor resolution of one day, so refresh
 * any faster and we are paying rate limit for noise. It also bounds the worst
 * case cost of a traffic spike to six upstream sweeps an hour.
 *
 * **Next 16 caching semantics used here:** the route handlers are dynamic
 * (`/api/signals` reads `searchParams`, and all three must reflect env changes
 * without a rebuild), so we do *not* rely on `export const revalidate` or the
 * `use cache` directive — a request-scoped ISR window cannot express "shared
 * across all requests in this process". Instead this is a plain module-scope
 * TTL cache, which survives for the lifetime of the server instance and is
 * shared by every request it serves. The routes additionally set an explicit
 * `Cache-Control: s-maxage=600, stale-while-revalidate=1800` so any CDN in
 * front of the app gets the same window. Adapter `fetch` calls set
 * `cache: 'no-store'` so Next's own fetch cache does not add a second,
 * differently-timed layer underneath this one.
 */
export const SIGNAL_TTL_MS = 10 * 60 * 1000;

interface SignalCacheEntry {
  patches: Map<string, Partial<BuzzSignals>>;
  fetchedAt: number;
}

let signalCache: SignalCacheEntry | null = null;
/** De-duplicates concurrent refreshes — a cold start under load must sweep once. */
let inFlight: Promise<Map<string, Partial<BuzzSignals>>> | null = null;

/**
 * Merged live signal patches for the whole calendar, cached for
 * {@link SIGNAL_TTL_MS}. Returns an empty map when no adapter is configured.
 * Never throws.
 */
export async function getSignalPatches(
  options: { force?: boolean } = {},
): Promise<Map<string, Partial<BuzzSignals>>> {
  const now = Date.now();
  if (!options.force && signalCache && now - signalCache.fetchedAt < SIGNAL_TTL_MS) {
    return signalCache.patches;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const patches = await collectSignalPatches(EVENTS);
      signalCache = { patches, fetchedAt: Date.now() };
      return patches;
    } catch {
      // Serve the stale entry rather than nothing — a degraded live layer must
      // never be worse than no live layer.
      return signalCache?.patches ?? new Map<string, Partial<BuzzSignals>>();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Curated events with any live signal patches folded in. Server-only. */
export async function getEnrichedEvents(
  options: { force?: boolean } = {},
): Promise<WorldEvent[]> {
  const patches = await getSignalPatches(options);
  return applySignalPatches(EVENTS, patches);
}

/** Signal patches for a specific subset of ids. Server-only. */
export async function refreshSignals(
  ids: string[],
  options: { force?: boolean } = {},
): Promise<Record<string, Partial<BuzzSignals>>> {
  const patches = await getSignalPatches(options);
  const out: Record<string, Partial<BuzzSignals>> = {};
  for (const id of ids) {
    const p = patches.get(id);
    if (p) out[id] = p;
  }
  return out;
}

/** Age of the cached signal sweep in ms, or null when nothing is cached. */
export function signalCacheAgeMs(): number | null {
  return signalCache ? Date.now() - signalCache.fetchedAt : null;
}

/** Diagnostics payload shared by `/api/events` and `/api/sources`. */
export function dataMeta() {
  const age = signalCacheAgeMs();
  return {
    eventCount: EVENTS.length,
    signalCacheAgeMs: age,
    signalTtlMs: SIGNAL_TTL_MS,
    sources: getSourceHealth(),
  };
}
