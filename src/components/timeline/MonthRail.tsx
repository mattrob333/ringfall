'use client';

import { useMemo } from 'react';
import { cn } from '@/components/ui';
import { monthTicks, xForColumn, type Geometry } from './geometry';

export interface MonthRailProps {
  geometry: Geometry;
  className?: string;
}

/**
 * The axis. Month names in small caps, year boundaries in brass — the only
 * two things a fourteen-month scrubber needs written on it.
 *
 * Labels are dropped rather than shrunk as the track narrows: at 900px there is
 * still room for every month, below that every second one. Type never gets
 * smaller than the `.label-sm` step, because a 7px month name is not a month
 * name, it is texture.
 */
export function MonthRail({ geometry, className }: MonthRailProps) {
  const ticks = useMemo(() => monthTicks(geometry), [geometry]);
  const monthPx = geometry.colWidth * 30.4;
  const step = monthPx >= 44 ? 1 : monthPx >= 26 ? 2 : 3;

  return (
    <div
      aria-hidden
      className={cn('relative h-4 w-full select-none', className)}
      style={{ width: geometry.width }}
    >
      {ticks.map((t, i) => {
        const x = xForColumn(geometry, t.index);
        const show = i % step === 0 || t.isYearBoundary;
        return (
          <div
            key={t.iso}
            className="absolute top-0 flex h-full items-start"
            style={{ left: x }}
          >
            <span
              className={cn(
                'block w-px',
                t.isYearBoundary ? 'h-2.5 bg-brass-deep' : 'h-1.5 bg-ink/15',
              )}
            />
            {show ? (
              <span
                className={cn(
                  'label-sm ml-1.5 -mt-px whitespace-nowrap',
                  t.isYearBoundary ? 'text-brass' : 'text-ink-muted',
                )}
              >
                {t.isYearBoundary ? t.year : t.label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
