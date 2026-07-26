/**
 * GET /api/sources
 *
 * `SourceHealth[]` for every registered source, in merge-precedence order.
 * Powers the Signal Integrity panel.
 *
 * Never cached — the entire point of this endpoint is to report the *current*
 * state of the adapters, including an error that started thirty seconds ago.
 * It reads in-memory bookkeeping only and issues no upstream calls, so it is
 * cheap enough to poll.
 *
 * Returns no secrets: only whether each key is present, never its value.
 */

import { NextResponse } from 'next/server';
import { getSourceHealth } from '@/lib/data/sources';
import { signalCacheAgeMs, SIGNAL_TTL_MS } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(
      {
        sources: getSourceHealth(),
        signalCacheAgeMs: signalCacheAgeMs(),
        signalTtlMs: SIGNAL_TTL_MS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { sources: [], error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
