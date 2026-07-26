import type { EventTier } from '@/lib/types';
import { TIER_LABEL, TIER_NOTE } from './tokens';
import { cn } from './cn';

export interface TierMarkProps {
  tier: EventTier;
  /** Print the tier name beside the mark. */
  withLabel?: boolean;
  size?: number;
  className?: string;
}

/**
 * How hard the door is, as a mark. A lozenge that fills as the door closes:
 * outline for `insider`, solid for `marquee`, solid-in-a-ring for `legendary`.
 * Brass throughout — tier is access, and access is chrome, not data.
 */
export function TierMark({
  tier,
  withLabel = false,
  size = 10,
  className,
}: TierMarkProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}
      title={TIER_NOTE[tier]}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        className="shrink-0 text-brass"
        role="img"
        aria-label={`${TIER_LABEL[tier]} tier`}
      >
        {tier === 'legendary' && (
          <>
            <path d="M6 0.8 11.2 6 6 11.2 0.8 6Z" />
            <path d="M6 3.4 8.6 6 6 8.6 3.4 6Z" fill="currentColor" stroke="none" />
          </>
        )}
        {tier === 'marquee' && (
          <path d="M6 1.8 10.2 6 6 10.2 1.8 6Z" fill="currentColor" stroke="none" />
        )}
        {tier === 'insider' && <path d="M6 1.8 10.2 6 6 10.2 1.8 6Z" />}
      </svg>
      {withLabel ? (
        <span className="label-sm text-ink-muted">{TIER_LABEL[tier]}</span>
      ) : null}
    </span>
  );
}
