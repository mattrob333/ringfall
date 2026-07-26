'use client';

import { useMemo } from 'react';
import { computePeerCounts } from './simulation';
import { useSocialStore } from './useSocialStore';

/**
 * Reactive peer counts. Re-renders only when the live drip advances — the
 * baseline simulation is immutable, so the memo key is just the drip position.
 *
 * The returned record is frozen and shared; treat it as read-only. Callers that
 * need to mutate should copy, or use the non-reactive `getPeerCounts()`.
 */
export function usePeerCounts(): Record<string, number> {
  const dripRevealed = useSocialStore((s) => s.dripRevealed);
  return useMemo(() => computePeerCounts(dripRevealed) as Record<string, number>, [dripRevealed]);
}
