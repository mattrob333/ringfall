'use client';

/**
 * The sun, derived from the timeline.
 *
 * The scrubber carries a date but no time of day, so we pin the time of day to
 * *now* and let the date come from the timeline. Scrub through the year and the
 * terminator tilts with the seasons — Europe in darkness by four in December,
 * the Arctic never setting in June — while the line itself sits where it
 * genuinely is at this moment. It advances 0.25° a minute, so a one-minute tick
 * is well below the threshold where anyone would notice a jump.
 */

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useTimelineStore } from '@/lib/stores/useTimelineStore';
import { subsolarPoint, latLonToVec3 } from '@/lib/geo/projection';

const TICK_MS = 60_000;

export function useSunDate(): Date {
  const focus = useTimelineStore((s) => s.focus);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return useMemo(() => {
    const wall = new Date(now);
    const parsed = Date.parse(`${focus}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return wall;

    const d = new Date(parsed);
    d.setUTCHours(wall.getUTCHours(), wall.getUTCMinutes(), 0, 0);
    return d;
  }, [focus, now]);
}

/**
 * Unit vector from the Earth's centre toward the sun, in world space.
 *
 * Stable identity between ticks — the same Vector3 is mutated in place — so
 * uniforms referencing it never need reassigning.
 */
export function useSunDirection(): THREE.Vector3 {
  const date = useSunDate();
  const vec = useMemo(() => new THREE.Vector3(1, 0, 0), []);

  return useMemo(() => {
    const p = subsolarPoint(date);
    return latLonToVec3(p.lat, p.lon, 1, vec);
  }, [date, vec]);
}
