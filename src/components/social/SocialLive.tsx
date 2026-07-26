'use client';

import { useEffect } from 'react';

import { startDrip } from '@/lib/social/simulation';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';

export interface SocialLiveProps {
  /** Pause the drip — e.g. while a modal is up or the globe is animating. */
  paused?: boolean;
  minMs?: number;
  maxMs?: number;
}

/**
 * The club, breathing.
 *
 * Mount once, near the root. Every twenty to forty-five seconds one withheld
 * peer signal is released, which nudges a peer count and occasionally adds a
 * face to a stack. That is the entire effect and it is deliberately almost
 * imperceptible: the goal is that after ten minutes the map is subtly more
 * populated than when you arrived, not that anything ever announces itself.
 *
 * Nothing renders. Nothing runs during SSR. It stops when the tab is hidden.
 */
export function SocialLive({ paused = false, minMs, maxMs }: SocialLiveProps) {
  const hydrated = useSocialHydration();

  useEffect(() => {
    if (paused || !hydrated) return;
    const controller = startDrip(() => useSocialStore.getState().revealNextPeer(), {
      ...(minMs !== undefined ? { minMs } : {}),
      ...(maxMs !== undefined ? { maxMs } : {}),
    });
    return () => controller.stop();
  }, [paused, hydrated, minMs, maxMs]);

  return null;
}
