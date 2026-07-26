import type { HeatLevel } from '@/lib/types';
import { HEAT_BG, HEAT_LABEL, formatScore, heatRank } from './tokens';
import { cn } from './cn';

export interface HeatDotProps {
  heat: HeatLevel;
  size?: 'sm' | 'md';
  /** Adds a bloom behind the dot as the level climbs. Off in dense lists. */
  glow?: boolean;
  className?: string;
  /** Announce the level. Off when a `HeatBadge` already says the word. */
  labelled?: boolean;
}

/**
 * The heat mark. Colour here is *data* — it is the one place in the chrome
 * where a non-brass hue is allowed, and it always means the same thing.
 */
export function HeatDot({
  heat,
  size = 'sm',
  glow = false,
  className,
  labelled = false,
}: HeatDotProps) {
  const px = size === 'sm' ? 6 : 8;
  const rank = heatRank(heat);
  return (
    <span
      role={labelled ? 'img' : 'presentation'}
      aria-label={labelled ? `${HEAT_LABEL[heat]} demand` : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: px, height: px }}
    >
      {glow && rank >= 2 && (
        <span
          className={cn('absolute rounded-full', HEAT_BG[heat])}
          style={{
            width: px * 2.6,
            height: px * 2.6,
            opacity: 0.06 + rank * 0.05,
            filter: `blur(${px * 0.9}px)`,
          }}
        />
      )}
      <span
        className={cn('relative rounded-full', HEAT_BG[heat])}
        style={{ width: px, height: px }}
      />
    </span>
  );
}

export interface HeatBadgeProps {
  heat: HeatLevel;
  /** 0–100. Rendered in tabular figures beside the level. */
  score?: number;
  /** Drop the word and keep the dot + number. For dense rails. */
  compact?: boolean;
  className?: string;
}

/**
 * Heat level plus score. The *word* is drawn in ink, not in the heat colour:
 * `smoldering` measures 3.4:1 against the glass and would fail AA as text.
 * The colour lives in the dot, where it is a mark and not a reading task.
 */
export function HeatBadge({ heat, score, compact = false, className }: HeatBadgeProps) {
  return (
    <span
      className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap', className)}
      title={`${HEAT_LABEL[heat]}${score === undefined ? '' : ` — ${formatScore(score)}`}`}
    >
      <HeatDot heat={heat} className="translate-y-[-1px]" />
      {!compact && <span className="label-sm text-ink-muted">{HEAT_LABEL[heat]}</span>}
      {score !== undefined && (
        <span className="tabular text-[11px] leading-none text-ink">
          {formatScore(score)}
        </span>
      )}
      <span className="sr-only">
        {HEAT_LABEL[heat]} demand
        {score === undefined ? '' : `, score ${formatScore(score)} of 100`}
      </span>
    </span>
  );
}

export interface HeatBarProps {
  heat: HeatLevel;
  /** 0–100 */
  score: number;
  className?: string;
}

/** A 2px bar. Used where a dot is too small to carry the reading — the dossier. */
export function HeatBar({ heat, score, className }: HeatBarProps) {
  return (
    <span
      className={cn('block h-px w-full bg-ink/10', className)}
      role="img"
      aria-label={`${HEAT_LABEL[heat]}, ${formatScore(score)} of 100`}
    >
      <span
        className={cn('block h-px', HEAT_BG[heat])}
        style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
      />
    </span>
  );
}
