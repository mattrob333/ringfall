'use client';

import { cn } from '@/components/ui';

const HINTS: { keys: string[]; action: string }[] = [
  { keys: ['←', '→'], action: 'Day' },
  { keys: ['⇧', '←→'], action: 'Week' },
  { keys: ['Space'], action: 'Play' },
  { keys: ['Esc'], action: 'Close' },
];

export interface CommandHintProps {
  className?: string;
}

/**
 * The shortcuts, stated once and then left alone.
 *
 * Not a modal, not a "?" that opens a cheatsheet — one row at the edge of the
 * frame that a returning user stops seeing and a new one reads in three
 * seconds.
 */
export function CommandHint({ className }: CommandHintProps) {
  return (
    <div
      className={cn('flex w-fit items-center gap-4 px-1', className)}
      aria-label="Keyboard shortcuts"
    >
      {HINTS.map((h) => (
        <span key={h.action} className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {h.keys.map((k) => (
              <kbd
                key={k}
                className="tabular rounded-[2px] border border-ink/12 px-1 py-0.5 text-[9px] leading-none text-ink-muted"
              >
                {k}
              </kbd>
            ))}
          </span>
          <span className="label-sm text-ink-muted">{h.action}</span>
        </span>
      ))}
    </div>
  );
}
