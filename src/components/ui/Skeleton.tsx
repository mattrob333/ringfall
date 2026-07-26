import { cn } from './cn';

export interface SkeletonProps {
  className?: string;
  /** Number of stacked lines. Widths taper so it reads as text, not blocks. */
  lines?: number;
  height?: number;
}

/**
 * Loading placeholder. It breathes rather than shimmers — a travelling
 * highlight would be the loudest thing on screen. The pulse is killed outright
 * under `prefers-reduced-motion` by the global rule in `globals.css`.
 */
export function Skeleton({ className, lines = 1, height = 10 }: SkeletonProps) {
  if (lines <= 1) {
    return (
      <div
        aria-hidden
        className={cn('animate-pulse rounded-[2px] bg-ink/8', className)}
        style={{ height }}
      />
    );
  }
  return (
    <div aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[2px] bg-ink/8"
          style={{
            height,
            width: `${100 - (i % 3) * 14}%`,
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}
