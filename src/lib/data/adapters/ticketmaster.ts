/**
 * MERIDIAN — Ticketmaster Discovery adapter.
 *
 * ── Endpoint ─────────────────────────────────────────────────────────────────
 *   GET https://app.ticketmaster.com/discovery/v2/events.json
 *       ?apikey=$TICKETMASTER_API_KEY
 *       &latlong={lat},{lon}&radius=25&unit=km
 *       &startDateTime={start}T00:00:00Z&endDateTime={end}T23:59:59Z
 *       &size=50&sort=relevance,desc
 *   Auth:  `apikey` query parameter (Discovery has no header auth — which is
 *          precisely why every call lives behind our route handlers and the key
 *          never reaches a browser).
 *   Docs:  developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *
 * ── Mapping ──────────────────────────────────────────────────────────────────
 *   page.totalElements                 → bookingPressure  (volume of ticketed
 *                                        supply in the destination that week —
 *                                        a busy calendar means a squeezed city)
 *   _embedded.events[].dates.status.code == 'offsale' | 'cancelled'
 *                                      → bookingPressure  (sell-through ratio;
 *                                        this is the real scarcity signal)
 *   _embedded.events[].priceRanges[].max
 *                                      → exclusivity      (only as a weak
 *                                        upward nudge — see below)
 *
 * ── Honest limits ────────────────────────────────────────────────────────────
 * Ticketmaster covers almost none of the MERIDIAN calendar directly: there is
 * no Discovery listing for a private dinner at a member house, and the Monaco
 * paddock club is not sold through it. Its real value is as a *destination
 * congestion* proxy — how much ticketed demand exists in that city on those
 * dates. That is genuinely useful for bookingPressure and useless for anything
 * else, so this adapter deliberately patches one and a half fields and leaves
 * the rest to the curated baseline.
 *
 * `exclusivity` is only ever nudged *upward* (`max` of curated and derived),
 * never down: an open-sale stadium show nearby says nothing about whether our
 * event's guest list is sealed.
 */

import type { BuzzSignals, EventSource, SourceHealth, WorldEvent } from '@/lib/types';
import { HealthTracker, env, getJSON, isoDateToInstant, mapLimit, mergePatch } from './http';

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
const RADIUS_KM = 25;
const CONCURRENCY = 3;

/**
 * Ticketed-event count at which destination congestion is considered saturated.
 * 40 concurrent ticketed events inside 25km is a city running hot.
 */
const CONGESTION_SAT = 40;

interface TmEvent {
  id: string;
  name: string;
  dates?: { status?: { code?: string } };
  priceRanges?: { type?: string; currency?: string; min?: number; max?: number }[];
}

interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalElements?: number };
}

const tracker = new HealthTracker(
  'ticketmaster',
  'Ticketmaster Discovery',
  ['TICKETMASTER_API_KEY'],
);

async function fetchOne(event: WorldEvent): Promise<Partial<BuzzSignals> | null> {
  const key = env('TICKETMASTER_API_KEY');
  if (!key) return null;

  const params = new URLSearchParams({
    apikey: key,
    latlong: `${event.coords.lat.toFixed(4)},${event.coords.lon.toFixed(4)}`,
    radius: String(RADIUS_KM),
    unit: 'km',
    startDateTime: isoDateToInstant(event.start),
    endDateTime: isoDateToInstant(event.end, true),
    size: '50',
    sort: 'relevance,desc',
  });

  const res = await getJSON<TmResponse>(`${ENDPOINT}?${params.toString()}`);

  const total = res.page?.totalElements ?? 0;
  const listed = res._embedded?.events ?? [];
  if (total === 0 && listed.length === 0) return null;

  // Congestion: how much ticketed supply exists here this week, log-saturated
  // so a festival city does not permanently peg at 1.0.
  const congestion = Math.min(1, Math.log1p(total) / Math.log1p(CONGESTION_SAT));

  // Sell-through: fraction of listed events that are no longer purchasable.
  const closed = listed.filter((e) => {
    const code = e.dates?.status?.code;
    return code === 'offsale' || code === 'cancelled';
  }).length;
  const sellThrough = listed.length ? closed / listed.length : 0;

  // Weighted toward sell-through, which is a fact, over congestion, which is a
  // proxy. Only emitted when we actually saw listings.
  const bookingPressure = Math.min(1, 0.4 * congestion + 0.6 * sellThrough);

  const patch: Partial<BuzzSignals> = { bookingPressure };

  // Ticket ceiling as a very weak exclusivity hint: a nearby $5k+ face value
  // suggests a market that tolerates our kind of pricing.
  const topPrice = listed.reduce((max, e) => {
    const p = e.priceRanges?.reduce((m, r) => Math.max(m, r.max ?? 0), 0) ?? 0;
    return Math.max(max, p);
  }, 0);
  if (topPrice > 0) {
    const derived = Math.min(1, Math.log1p(topPrice) / Math.log1p(5_000));
    patch.exclusivity = Math.max(event.signals.exclusivity, derived * 0.6);
  }

  return patch;
}

export const ticketmasterSource: EventSource = {
  id: 'ticketmaster',
  label: 'Ticketmaster Discovery',
  isConfigured: () => tracker.isConfigured(),

  async fetchSignals(events: WorldEvent[]): Promise<Map<string, Partial<BuzzSignals>>> {
    const out = new Map<string, Partial<BuzzSignals>>();
    if (!tracker.isConfigured()) return out;

    try {
      let matched = 0;
      let firstError: unknown = null;

      await mapLimit(events, CONCURRENCY, async (event) => {
        try {
          const patch = await fetchOne(event);
          if (patch) {
            mergePatch(out, event.id, patch);
            matched++;
          }
        } catch (err) {
          if (!firstError) firstError = err;
        }
      });

      if (matched === 0 && firstError) throw firstError;
      tracker.markSuccess(`${matched}/${events.length} destinations profiled`);
    } catch (err) {
      tracker.markError(err);
      out.clear();
    }
    return out;
  },

  health: (): SourceHealth => tracker.health(),
};
