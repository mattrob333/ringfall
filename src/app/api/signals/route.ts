/**
 * GET /api/signals?ids=a,b,c
 *
 * Refreshed `Partial<BuzzSignals>` patches for specific events — what the
 * dossier calls when a member opens an event and we want its numbers to be
 * current without re-shipping the whole calendar.
 *
 * `?force=1` bypasses the 10-minute TTL cache. Guarded by `MAX_IDS` so a
 * crafted query cannot turn one request into a full six-vendor sweep on repeat.
 *
 * Dynamic by necessity (it reads `searchParams`); freshness is owned by the
 * shared TTL cache in `@/lib/data`. `Cache-Control: no-store` because the
 * response varies per id list and the useful caching already happened upstream.
 *
 * With zero env vars set this returns `{ signals: {} }` — correct, not an
 * error: there is nothing to sharpen, and the curated baseline already shipped
 * with the events.
 */

import { NextResponse } from 'next/server';
import { getEventById, refreshSignals } from '@/lib/data';
import { getSourceHealth } from '@/lib/data/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Enough for a viewport's worth of beacons; refuses to be a fan-out amplifier. */
const MAX_IDS = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get('ids') ?? '';

    const ids = Array.from(
      new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ).slice(0, MAX_IDS);

    if (!ids.length) {
      return NextResponse.json(
        { signals: {}, unknownIds: [], sources: getSourceHealth() },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const known = ids.filter((id) => getEventById(id) !== undefined);
    const unknownIds = ids.filter((id) => !known.includes(id));

    const signals = await refreshSignals(known, {
      force: url.searchParams.get('force') === '1',
    });

    return NextResponse.json(
      { signals, unknownIds, sources: getSourceHealth() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { signals: {}, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
