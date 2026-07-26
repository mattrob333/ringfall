'use client';

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the user has asked the system to calm down.
 *
 * In the globe this means: no auto-rotate, no pulse rings, and camera flights
 * become instant cuts. It does *not* mean a static image — damping on
 * relevance/score still runs, because that is a data readout, not decoration,
 * and snapping values would be harder to read, not easier.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
