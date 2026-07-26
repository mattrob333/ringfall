'use client';

import { useEffect, useRef } from 'react';
import { Button, IconButton, cn } from '@/components/ui';
import { addDays, useTimelineStore } from '@/lib/stores/useTimelineStore';

/** Days per second. Six is roughly a month every five seconds — a walking pace. */
const SPEEDS = [2, 6, 14, 30] as const;

export interface TransportProps {
  className?: string;
  /** Hide the speed selector when the bar is tight. */
  compact?: boolean;
}

/**
 * Play, pause, speed, and a way back to today.
 *
 * The clock is driven by `requestAnimationFrame`, not `setInterval`: playback
 * has to stay locked to the compositor so the globe's beacons and the scrubber
 * move as one object. A timer would drift against the render loop and the two
 * would visibly disagree.
 */
export function Transport({ className, compact = false }: TransportProps) {
  const playing = useTimelineStore((s) => s.playing);
  const playSpeed = useTimelineStore((s) => s.playSpeed);
  const togglePlay = useTimelineStore((s) => s.togglePlay);
  const setPlaySpeed = useTimelineStore((s) => s.setPlaySpeed);
  const reset = useTimelineStore((s) => s.reset);
  const carry = useRef(0);

  useEffect(() => {
    if (!playing) {
      carry.current = 0;
      return;
    }
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25); // swallow tab-away jumps
      last = now;
      const s = useTimelineStore.getState();
      carry.current += dt * s.playSpeed;

      if (carry.current >= 1) {
        const whole = Math.floor(carry.current);
        carry.current -= whole;
        const next = addDays(s.focus, whole);
        if (next >= s.rangeEnd) {
          s.setFocus(s.rangeEnd);
          s.togglePlay(); // the year has run out; stop rather than loop
          return;
        }
        s.setFocus(next);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <IconButton
        label={playing ? 'Pause' : 'Play through the year'}
        variant={playing ? 'brass' : 'ghost'}
        selected={playing}
        onClick={togglePlay}
        aria-pressed={playing}
      >
        {playing ? (
          <svg viewBox="0 0 12 12" width={10} height={10} fill="currentColor" aria-hidden>
            <rect x="3" y="2" width="2" height="8" />
            <rect x="7" y="2" width="2" height="8" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width={10} height={10} fill="currentColor" aria-hidden>
            <path d="M3.5 2 10 6l-6.5 4Z" />
          </svg>
        )}
      </IconButton>

      {!compact && (
        <div
          className="flex items-center gap-px"
          role="radiogroup"
          aria-label="Playback speed, days per second"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={playSpeed === s}
              aria-label={`${s} days per second`}
              onClick={() => setPlaySpeed(s)}
              className={cn(
                'tabular h-6 px-1.5 text-[10px] leading-none transition-colors',
                'duration-[var(--duration-instant)]',
                playSpeed === s ? 'text-brass' : 'text-ink-muted hover:text-ink',
              )}
            >
              {s}
            </button>
          ))}
          <span className="label-sm ml-0.5 text-ink-muted">d/s</span>
        </div>
      )}

      <Button variant="quiet" size="sm" onClick={reset} className="px-1.5">
        Today
      </Button>
    </div>
  );
}
