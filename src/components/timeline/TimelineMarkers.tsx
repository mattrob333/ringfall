'use client';

import { useMemo, useState } from 'react';
import { HEAT_BG, cn, formatDayMonth } from '@/components/ui';
import { useTopEvents, type ScoredEvent } from '@/lib/selectors';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { useTimelineStore } from '@/lib/stores/useTimelineStore';
import { inRange, xForDate, type Geometry } from './geometry';

export interface TimelineMarkersProps {
  geometry: Geometry;
  /** How many of the top-ranked events to tick. */
  limit?: number;
  className?: string;
}

/**
 * The year's landmarks, ticked above the ribbon.
 *
 * Twenty marks and no more. A marker rail that shows everything shows nothing;
 * this one answers a single question — "where are the weeks I would organise a
 * year around?" — and stops. Hovering names the event, clicking takes you
 * there: the scrubber moves to its opening day and the dossier opens.
 */
export function TimelineMarkers({
  geometry,
  limit = 20,
  className,
}: TimelineMarkersProps) {
  const top = useTopEvents(limit);
  const setFocus = useTimelineStore((s) => s.setFocus);
  const select = useGlobeStore((s) => s.select);
  const flyTo = useGlobeStore((s) => s.flyTo);
  const hover = useGlobeStore((s) => s.hover);
  const [preview, setPreview] = useState<ScoredEvent | null>(null);

  const marks = useMemo(
    () =>
      top
        .filter((e) => inRange(geometry, e.start))
        .map((e) => ({ event: e, x: xForDate(geometry, e.start) })),
    [top, geometry],
  );

  const previewX = preview ? xForDate(geometry, preview.start) : 0;
  // Keep the preview label inside the track rather than letting it run off the
  // end of the screen at either extreme of the year.
  const clampedX = Math.min(Math.max(previewX, 88), Math.max(88, geometry.width - 88));

  return (
    <div
      className={cn('relative h-5 w-full select-none', className)}
      style={{ width: geometry.width }}
      onPointerLeave={() => {
        setPreview(null);
        hover(null);
      }}
    >
      {marks.map(({ event, x }) => {
        const active = preview?.id === event.id;
        return (
          <button
            key={event.id}
            type="button"
            className="absolute bottom-0 flex h-5 w-3 -translate-x-1/2 cursor-pointer items-end justify-center focus-visible:outline-1"
            style={{ left: x }}
            title={`${event.name} — ${formatDayMonth(event.start)}`}
            aria-label={`${event.name}, ${formatDayMonth(event.start)}. Rank ${event.buzz.rank}`}
            onPointerEnter={() => {
              setPreview(event);
              hover(event.id);
            }}
            onFocus={() => setPreview(event)}
            onBlur={() => setPreview(null)}
            onClick={() => {
              setFocus(event.start);
              select(event.id);
              flyTo(event.coords);
            }}
          >
            <span
              className={cn(
                'block w-px transition-[height,background-color] duration-[var(--duration-instant)]',
                active ? 'h-4 bg-brass-bright' : 'h-2.5 bg-brass-deep',
              )}
            />
            <span
              className={cn(
                'absolute top-0 size-[3px] rotate-45',
                active ? 'bg-brass-bright' : HEAT_BG[event.buzz.heat],
              )}
            />
          </button>
        );
      })}

      {preview ? (
        <div
          className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 whitespace-nowrap"
          style={{ left: clampedX }}
        >
          <span className="glass-deep inline-flex items-baseline gap-2 rounded-[2px] px-2 py-1">
            <span className="font-display text-[12px] leading-none text-ink">
              {preview.name}
            </span>
            <span className="tabular text-[10px] leading-none text-ink-muted">
              {formatDayMonth(preview.start)}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
