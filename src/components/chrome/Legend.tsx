'use client';

import { HEAT_BG, HEAT_LABEL, HEAT_NOTE, Tooltip, cn } from '@/components/ui';
import { HEAT_LEVELS } from '@/lib/types';

export interface LegendProps {
  className?: string;
}

/**
 * The ramp, explained once.
 *
 * Colour is the only non-brass hue in the product and it always means the same
 * thing, so it needs saying exactly once, quietly, in the corner — five swatches
 * cold to hot and the two readings of the ribbon.
 */
export function Legend({ className }: LegendProps) {
  return (
    <div className={cn('glass w-fit rounded-[3px] px-3.5 py-2.5', className)}>
      <div className="flex items-center gap-3">
        <span className="label-sm shrink-0 text-ink-muted">Demand</span>
        <ul className="flex items-center gap-2.5">
          {HEAT_LEVELS.map((h) => (
            <li key={h}>
              <Tooltip content={HEAT_NOTE[h]}>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn('size-1.5 shrink-0 rounded-full', HEAT_BG[h])}
                  />
                  <span className="label-sm text-ink-muted">{HEAT_LABEL[h]}</span>
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 max-w-[26rem] text-[10px] leading-4 text-ink-muted">
        On the scrubber, height is the day&rsquo;s total demand and colour is its
        hottest single event.
      </p>
    </div>
  );
}
