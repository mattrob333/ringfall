/**
 * MERIDIAN — X (Twitter) API v2 adapter.
 *
 * ── Endpoint ─────────────────────────────────────────────────────────────────
 *   GET https://api.twitter.com/2/tweets/counts/recent
 *       ?query={q}&granularity=day
 *   Auth:  Authorization: Bearer $X_BEARER_TOKEN   (app-only OAuth 2.0)
 *   Docs:  developer.x.com/en/docs/x-api/tweets/counts/api-reference/get-tweets-counts-recent
 *
 * ── Mapping ──────────────────────────────────────────────────────────────────
 *   meta.total_tweet_count        → socialMentions   (trailing-7d post volume —
 *                                   an exact match for the field's declared
 *                                   semantics, which is why this adapter is the
 *                                   authoritative source for it)
 *   data[] daily buckets          → socialVelocity   (see below)
 *
 * ── Velocity from a 7-day window ─────────────────────────────────────────────
 * `BuzzSignals.socialVelocity` is defined as week-over-week change, but the
 * `counts/recent` endpoint only reaches back 7 days on every access tier below
 * Enterprise. Rather than silently mislabel the field, we compute the closest
 * honest equivalent — the *second half of the window versus the first*:
 *
 *     velocity = (late − early) / (late + early)      ∈ −1 .. 1
 *
 * This is a half-week-over-half-week rate. It is noisier than a true WoW figure
 * and it responds about twice as fast, which for our purpose (catching a week
 * that is starting to move) is arguably the better instrument anyway. Operators
 * on an Enterprise tier can point this at `/2/tweets/counts/all` with
 * `start_time` 14 days back and get the literal definition; the parsing below
 * is unchanged, only the bucket split moves.
 *
 * ── Query construction ───────────────────────────────────────────────────────
 * X's query grammar caps at 512 chars on Basic. We build:
 *
 *     ("Event Name" OR #EventHashtag) -is:retweet lang:en
 *
 * Retweets are excluded because they inflate volume by 3–5× without adding
 * distinct interest, and the log normalisation in the scorer would happily
 * absorb that inflation as real heat. The hashtag is derived from the event id
 * (`monaco-grand-prix` → `#MonacoGrandPrix`), which matches the real tag for
 * the large fixtures and harmlessly matches nothing for the small ones.
 */

import type { BuzzSignals, EventSource, SourceHealth, WorldEvent } from '@/lib/types';
import { HealthTracker, env, getJSON, mapLimit, mergePatch } from './http';

const ENDPOINT = 'https://api.twitter.com/2/tweets/counts/recent';
/** X rate limits app-only counts hard (300 req / 15 min on Basic). */
const CONCURRENCY = 2;

interface XCountsResponse {
  data?: { start: string; end: string; tweet_count: number }[];
  meta?: { total_tweet_count?: number };
  errors?: { title?: string; detail?: string }[];
}

const tracker = new HealthTracker('x', 'X / Twitter mention volume', ['X_BEARER_TOKEN']);

/** `monaco-grand-prix` → `#MonacoGrandPrix` */
export function hashtagFor(eventId: string): string {
  return (
    '#' +
    eventId
      .split('-')
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  );
}

export function buildQuery(event: WorldEvent): string {
  const name = event.name.replace(/"/g, '').slice(0, 120);
  const q = `("${name}" OR ${hashtagFor(event.id)}) -is:retweet lang:en`;
  return q.slice(0, 512);
}

async function fetchOne(event: WorldEvent): Promise<Partial<BuzzSignals> | null> {
  const token = env('X_BEARER_TOKEN');
  if (!token) return null;

  const params = new URLSearchParams({
    query: buildQuery(event),
    granularity: 'day',
  });

  const res = await getJSON<XCountsResponse>(`${ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.errors?.length) {
    throw new Error(res.errors[0].detail ?? res.errors[0].title ?? 'X API error');
  }

  const buckets = res.data ?? [];
  const total =
    res.meta?.total_tweet_count ?? buckets.reduce((a, b) => a + b.tweet_count, 0);

  const patch: Partial<BuzzSignals> = { socialMentions: Math.max(0, total) };

  if (buckets.length >= 4) {
    const mid = Math.floor(buckets.length / 2);
    const early = buckets.slice(0, mid).reduce((a, b) => a + b.tweet_count, 0);
    const late = buckets.slice(mid).reduce((a, b) => a + b.tweet_count, 0);
    const denom = early + late;
    if (denom > 0) {
      patch.socialVelocity = Math.max(-1, Math.min(1, (late - early) / denom));
    }
  }

  return patch;
}

export const xSource: EventSource = {
  id: 'x',
  label: 'X / Twitter mention volume',
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
      tracker.markSuccess(`${matched}/${events.length} queries counted`);
    } catch (err) {
      tracker.markError(err);
      out.clear();
    }
    return out;
  },

  health: (): SourceHealth => tracker.health(),
};
