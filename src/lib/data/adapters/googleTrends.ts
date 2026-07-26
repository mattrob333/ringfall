/**
 * MERIDIAN — Google Trends adapter, via SerpAPI.
 *
 * ── Endpoint ─────────────────────────────────────────────────────────────────
 *   GET https://serpapi.com/search.json
 *       ?engine=google_trends
 *       &q={term}
 *       &data_type=TIMESERIES
 *       &date=today%203-m
 *       &api_key=$SERPAPI_KEY
 *   Auth:  `api_key` query parameter.
 *   Docs:  serpapi.com/google-trends-api
 *
 * Google does not offer a public Trends API; SerpAPI is the standard licensed
 * scraper and returns the same 0–100 relative index the Trends UI shows.
 *
 * ── Mapping ──────────────────────────────────────────────────────────────────
 *   interest_over_time.timeline_data[last].values[0].extracted_value
 *                                → searchInterest  (0–100, exactly the field's
 *                                  declared semantics — this adapter is the
 *                                  authoritative source for it)
 *   trailing slope of the series → socialVelocity  (only as a *fallback*, when
 *                                  X is unconfigured; see precedence in
 *                                  sources.ts)
 *
 * ── The normalisation trap ───────────────────────────────────────────────────
 * Trends values are normalised *within a single query*, so "Monaco Grand Prix"
 * scoring 100 and "Kentucky Derby" scoring 100 does not mean they are equally
 * searched — each is 100 relative to its own peak. Cross-event comparison
 * therefore requires either a multi-term query (max 5 terms, comparable within
 * the batch) or a shared anchor term.
 *
 * We use the batching approach: events are grouped 5 at a time into a single
 * comma-separated `q`, which makes the five values genuinely comparable, and
 * the *first* term of every batch after the first is a fixed anchor
 * (`ANCHOR_TERM`) so batches can be rescaled onto a common axis. This is why
 * `BATCH_SIZE` is 4 real terms plus 1 anchor rather than 5 real terms.
 */

import type { BuzzSignals, EventSource, SourceHealth, WorldEvent } from '@/lib/types';
import { HealthTracker, env, getJSON, mapLimit, mergePatch } from './http';

const ENDPOINT = 'https://serpapi.com/search.json';
/**
 * A high-volume, extremely stable travel term. Its Trends value is effectively
 * constant week to week, so its position within each batch gives us the scale
 * factor needed to compare one batch against another.
 */
const ANCHOR_TERM = 'private jet charter';
/** Google Trends compares at most 5 terms; one slot goes to the anchor. */
const BATCH_SIZE = 4;
const CONCURRENCY = 2;

interface TrendsTimelinePoint {
  date?: string;
  timestamp?: string;
  values?: { query?: string; value?: string; extracted_value?: number }[];
}

interface TrendsResponse {
  error?: string;
  interest_over_time?: { timeline_data?: TrendsTimelinePoint[] };
}

const tracker = new HealthTracker(
  'google-trends',
  'Google Trends (SerpAPI)',
  ['SERPAPI_KEY'],
);

/** Chunk a list into fixed-size groups. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The search term for an event. The bare event name beats "name + city" —
 * "Monaco Grand Prix Monaco" has materially lower volume than "Monaco Grand
 * Prix" because nobody types the city twice.
 */
export function trendsTermFor(event: WorldEvent): string {
  return event.name.replace(/[,&]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

interface BatchResult {
  /** term → latest 0..100 value */
  latest: Map<string, number>;
  /** term → trailing slope, −1..1 */
  slope: Map<string, number>;
  /** the anchor's own latest value in this batch, for cross-batch rescaling */
  anchor: number | null;
}

async function fetchBatch(terms: string[]): Promise<BatchResult> {
  const key = env('SERPAPI_KEY');
  const empty: BatchResult = { latest: new Map(), slope: new Map(), anchor: null };
  if (!key) return empty;

  const q = [ANCHOR_TERM, ...terms].join(',');
  const params = new URLSearchParams({
    engine: 'google_trends',
    q,
    data_type: 'TIMESERIES',
    date: 'today 3-m',
    api_key: key,
  });

  const res = await getJSON<TrendsResponse>(`${ENDPOINT}?${params.toString()}`);
  if (res.error) throw new Error(res.error);

  const timeline = res.interest_over_time?.timeline_data ?? [];
  if (!timeline.length) return empty;

  // Series per query term, in timeline order.
  const series = new Map<string, number[]>();
  for (const point of timeline) {
    for (const v of point.values ?? []) {
      const name = v.query ?? '';
      if (!name) continue;
      const value =
        typeof v.extracted_value === 'number'
          ? v.extracted_value
          : Number.parseFloat(v.value ?? '0');
      if (!Number.isFinite(value)) continue;
      const arr = series.get(name);
      if (arr) arr.push(value);
      else series.set(name, [value]);
    }
  }

  const latest = new Map<string, number>();
  const slope = new Map<string, number>();
  for (const [name, values] of series) {
    if (!values.length) continue;
    latest.set(name, Math.max(0, Math.min(100, values[values.length - 1])));

    // Trailing slope: last quarter of the series vs. the quarter before it,
    // expressed as a symmetric rate in −1..1.
    const window = Math.max(2, Math.floor(values.length / 4));
    const late = values.slice(-window);
    const early = values.slice(-2 * window, -window);
    if (early.length) {
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const l = avg(late);
      const e = avg(early);
      const denom = l + e;
      if (denom > 0) slope.set(name, Math.max(-1, Math.min(1, (l - e) / denom)));
    }
  }

  return { latest, slope, anchor: latest.get(ANCHOR_TERM) ?? null };
}

export const googleTrendsSource: EventSource = {
  id: 'google-trends',
  label: 'Google Trends (SerpAPI)',
  isConfigured: () => tracker.isConfigured(),

  async fetchSignals(events: WorldEvent[]): Promise<Map<string, Partial<BuzzSignals>>> {
    const out = new Map<string, Partial<BuzzSignals>>();
    if (!tracker.isConfigured()) return out;

    try {
      const batches = chunk(events, BATCH_SIZE);
      const indexed = batches.map((batch, i) => ({ batch, i }));
      const results = new Array<BatchResult | null>(batches.length).fill(null);
      let firstError: unknown = null;

      await mapLimit(indexed, CONCURRENCY, async ({ batch, i }) => {
        try {
          results[i] = await fetchBatch(batch.map(trendsTermFor));
        } catch (err) {
          results[i] = null;
          if (!firstError) firstError = err;
        }
      });

      // Rescale every batch onto the first successful batch's anchor so the
      // 0–100 values are comparable across the whole calendar.
      const reference =
        results.find((r): r is BatchResult => !!r && r.anchor !== null && r.anchor > 0)
          ?.anchor ?? null;

      let matched = 0;
      batches.forEach((batch, bi) => {
        const result = results[bi];
        if (!result) return;
        const scale =
          reference !== null && result.anchor !== null && result.anchor > 0
            ? reference / result.anchor
            : 1;

        for (const event of batch) {
          const term = trendsTermFor(event);
          const raw = result.latest.get(term);
          if (raw === undefined) continue;
          const patch: Partial<BuzzSignals> = {
            searchInterest: Math.max(0, Math.min(100, raw * scale)),
          };
          const s = result.slope.get(term);
          if (typeof s === 'number') patch.socialVelocity = s;
          mergePatch(out, event.id, patch);
          matched++;
        }
      });

      if (matched === 0 && firstError) throw firstError;
      tracker.markSuccess(`${matched}/${events.length} terms indexed`);
    } catch (err) {
      tracker.markError(err);
      out.clear();
    }
    return out;
  },

  health: (): SourceHealth => tracker.health(),
};
