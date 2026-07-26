import type { ReactNode } from 'react';
import { cn } from './cn';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** A quiet line under the value — units, provenance, a caveat. */
  note?: ReactNode;
  /** `tabular` for figures, `display` for serif names, `plain` for prose. */
  face?: 'tabular' | 'display' | 'plain';
  size?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'end';
  className?: string;
}

const SIZE: Record<NonNullable<StatProps['size']>, string> = {
  sm: 'text-[12px] leading-4',
  md: 'text-[15px] leading-5',
  lg: 'text-[22px] leading-7',
};

/**
 * Label over value. The label is always small caps and muted; the value is
 * always full-strength ink. Hierarchy here comes from size and letterspacing,
 * never from dimming text below the AA threshold.
 */
export function Stat({
  label,
  value,
  note,
  face = 'tabular',
  size = 'md',
  align = 'start',
  className,
}: StatProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        align === 'end' ? 'items-end text-right' : 'items-start',
        className,
      )}
    >
      <span className="label-sm text-ink-muted">{label}</span>
      <span
        className={cn(
          'text-ink',
          SIZE[size],
          face === 'tabular' && 'tabular',
          face === 'display' && 'font-display',
        )}
      >
        {value}
      </span>
      {note ? (
        <span className="text-[11px] leading-4 text-ink-muted">{note}</span>
      ) : null}
    </div>
  );
}
