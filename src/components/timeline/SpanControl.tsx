'use client';

import { IconButton, Tooltip, cn } from '@/components/ui';
import { useTimelineStore } from '@/lib/stores/useTimelineStore';

/** The steps a person actually thinks in: a long weekend, a week, a fortnight… */
const STOPS = [3, 7, 10, 21, 45, 90] as const;

export interface SpanControlProps {
  className?: string;
}

/**
 * How wide "now" is.
 *
 * The scrubber picks a day; this picks how much of the year either side of it
 * still counts as in view. Widening it is how you go from "what is on that
 * Friday" to "what is on that trip" — it changes the rail, the globe's live
 * beacons and the ranking together, so it is deliberately sitting right next to
 * the date rather than buried in the filter panel.
 */
export function SpanControl({ className }: SpanControlProps) {
  const spanDays = useTimelineStore((s) => s.spanDays);
  const setSpan = useTimelineStore((s) => s.setSpan);

  const stepTo = (dir: -1 | 1) => {
    const i = nearestStop(spanDays);
    const next = STOPS[Math.min(STOPS.length - 1, Math.max(0, i + dir))];
    if (next !== undefined) setSpan(next);
  };

  const atMin = spanDays <= (STOPS[0] ?? 3);
  const atMax = spanDays >= (STOPS[STOPS.length - 1] ?? 90);

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Tooltip content="How many days either side of the scrubber count as in view">
        <span className="label-sm text-ink-muted">Window</span>
      </Tooltip>
      <IconButton
        label="Narrow the window"
        onClick={() => stepTo(-1)}
        disabled={atMin}
      >
        <svg viewBox="0 0 12 12" width={10} height={10} stroke="currentColor" strokeWidth={1} aria-hidden>
          <path d="M2.5 6h7" strokeLinecap="round" />
        </svg>
      </IconButton>
      <span
        className="tabular w-14 text-center text-[11px] leading-none text-ink"
        aria-live="polite"
      >
        ±{spanDays}d
      </span>
      <IconButton
        label="Widen the window"
        onClick={() => stepTo(1)}
        disabled={atMax}
      >
        <svg viewBox="0 0 12 12" width={10} height={10} stroke="currentColor" strokeWidth={1} aria-hidden>
          <path d="M2.5 6h7M6 2.5v7" strokeLinecap="round" />
        </svg>
      </IconButton>
    </div>
  );
}

function nearestStop(v: number): number {
  let best = 0;
  let bestD = Infinity;
  STOPS.forEach((s, i) => {
    const d = Math.abs(s - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
