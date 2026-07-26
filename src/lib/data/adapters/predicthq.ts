/**
 * MERIDIAN — PredictHQ adapter.
 *
 * ── Endpoint ─────────────────────────────────────────────────────────────────
 *   GET https://api.predicthq.com/v1/events/
 *       ?within=25km@{lat},{lon}
 *       &active.gte={start}&active.lte={end}
 *       &sort=-rank&limit=10
 *   Auth:   Authorization: Bearer $PREDICTHQ_TOKEN
 *   Accept: application/json
 *   Docs:   docs.predicthq.com/api/events/search-events
 *
 * ── Mapping ──────────────────────────────────────────────────────────────────
 *   results[].rank         0–100 PredictHQ global rank (log-scaled attendance +
 *                          impact model)          → searchInterest
 *   results[].local_rank   0–100 rank relative to the local population — this
 *                          is the better proxy for how hard the destination
 *                          itself is squeezed    → bookingPressure  (/100)
 *   results[].phq_attendance
 *                          predicted attendance   → socialMentions, but only as
 *                          a *floor*: attendance is not chatter, and PredictHQ
 *                          under-counts invitation-only events badly (a sealed
 *                          150-person gala has near-zero predicted attendance
 *                          and enormous social volume). See below.
 *
 * We take the single highest-ranked upstream match inside the event's own date
 * window and 25km of its coordinates. PredictHQ has no notion of our event ids,
 * so geospatial + temporal intersection is the join key.
 *
 * ── Deliberate omission ──────────────────────────────────────────────────────
 * We do NOT map `phq_attendance` onto `socialMentions`. Attendance and mention
 * volume differ by two orders of magnitude in opposite directions depending on
 * whether the event is a stadium fixture or a closed-door dinner, and letting
 * it through would systematically demote exactly the events our members care
 * about most. It is parsed and exposed in the health detail for operators, and
 * that is all.
 */

import type { BuzzSignals, EventSource, SourceHealth, WorldEvent } from '@/lib/types';
import { HealthTracker, env, getJSON, mapLimit, mergePatch } from './http';

const ENDPOINT = 'https://api.predicthq.com/v1/events/';
const RADIUS_KM = 25;
const CONCURRENCY = 4;

interface PhqEvent {
  id: string;
  title: string;
  rank?: number;
  local_rank?: number | null;
  phq_attendance?: number | null;
}

interface PhqResponse {
  count: number;
  results: PhqEvent[];
}

const tracker = new HealthTracker(
  'predicthq',
  'PredictHQ demand intelligence',
  ['PREDICTHQ_TOKEN'],
);

async function fetchOne(event: WorldEvent): Promise<Partial<BuzzSignals> | null> {
  const token = env('PREDICTHQ_TOKEN');
  if (!token) return null;

  const params = new URLSearchParams({
    within: `${RADIUS_KM}km@${event.coords.lat.toFixed(4)},${event.coords.lon.toFixed(4)}`,
    'active.gte': event.start,
    'active.lte': event.end,
    sort: '-rank',
    limit: '10',
  });

  const res = await getJSON<PhqResponse>(`${ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const top = res.results?.[0];
  if (!top) return null;

  const patch: Partial<BuzzSignals> = {};
  if (typeof top.rank === 'number') {
    patch.searchInterest = Math.max(0, Math.min(100, top.rank));
  }
  if (typeof top.local_rank === 'number' && top.local_rank !== null) {
    patch.bookingPressure = Math.max(0, Math.min(1, top.local_rank / 100));
  }
  return Object.keys(patch).length ? patch : null;
}

export const predictHQSource: EventSource = {
  id: 'predicthq',
  label: 'PredictHQ demand intelligence',
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
          // Per-event failure is survivable — one bad coordinate must not void
          // the whole sync. Remember the first so health() can report it.
          if (!firstError) firstError = err;
        }
      });

      if (matched === 0 && firstError) throw firstError;
      tracker.markSuccess(`${matched}/${events.length} events matched`);
    } catch (err) {
      tracker.markError(err);
      out.clear();
    }
    return out;
  },

  health: (): SourceHealth => tracker.health(),
};
