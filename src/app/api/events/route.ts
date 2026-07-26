/**
 * GET /api/events
 *
 * The curated calendar with any live signal patches merged in, plus source
 * health so the client can render the Signal Integrity panel from one round
 * trip.
 *
 * **Caching (Next 16).** This handler is dynamic: it must reflect a newly added
 * API key without a rebuild, so it opts out of the static route cache with
 * `dynamic = 'force-dynamic'`. Freshness is instead owned by the module-scope
 * TTL cache in `@/lib/data` (10 minutes, shared across every request the
 * process serves) and advertised downstream via `Cache-Control:
 * s-maxage=600, stale-while-revalidate=1800` for any CDN in front of us.
 * Rationale for not using `export const revalidate`: ISR revalidation is
 * per-route-cache-entry and would still stampede all six upstream vendors on
 * every cold entry; the in-process cache plus in-flight de-duplication gives us
 * one sweep per ten minutes per instance regardless of traffic shape.
 *
 * Works with zero env vars set — that path returns the curated baseline and
 * every live source reporting `unconfigured`.
 */

import { NextResponse } from 'next/server';
import { dataMeta, getEnrichedEvents } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const events = await getEnrichedEvents();
    return NextResponse.json(
      { events, meta: dataMeta() },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800',
        },
      },
    );
  } catch (err) {
    // The curated import is static, so reaching here means something
    // pathological. Still: never 500 the globe's only data endpoint.
    return NextResponse.json(
      {
        events: [],
        meta: { eventCount: 0, sources: [] },
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
