import { cn } from './cn';

const NOTE: Record<number, string> = {
  1: 'Accessible',
  2: 'Considered',
  3: 'Substantial',
  4: 'Serious',
  5: 'Ruinous',
};

export interface PriceIndexProps {
  /** 1 (accessible) .. 5 (ruinous) */
  value: number;
  /** Height of each mark, px. */
  size?: number;
  /** Print the word beside the marks. */
  withLabel?: boolean;
  className?: string;
}

/**
 * Five marks, filled to `value`. Not currency symbols — a currency symbol
 * repeated five times is a restaurant guide, and this is not one. Five equal
 * strokes reading left to right, the filled ones in brass.
 */
export function PriceIndex({
  value,
  size = 10,
  withLabel = false,
  className,
}: PriceIndexProps) {
  const v = Math.max(1, Math.min(5, Math.round(value)));
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="inline-flex items-end gap-[3px]"
        role="img"
        aria-label={`Spend index ${v} of 5 — ${NOTE[v] ?? ''}`}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn('w-px', i <= v ? 'bg-brass' : 'bg-ink/18')}
            style={{ height: i <= v ? size : Math.round(size * 0.55) }}
          />
        ))}
      </span>
      {withLabel ? (
        <span className="label-sm text-ink-muted">{NOTE[v]}</span>
      ) : null}
    </span>
  );
}
