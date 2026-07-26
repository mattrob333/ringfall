import { cn } from '@/components/ui';
import type { MemberTier } from '@/lib/types';

const BARS: Record<MemberTier, number> = { founding: 3, signature: 2, charter: 1 };

export const MEMBER_TIER_LABEL: Record<MemberTier, string> = {
  founding: 'Founding',
  signature: 'Signature',
  charter: 'Charter',
};

export interface MemberTierMarkProps {
  tier: MemberTier;
  withLabel?: boolean;
  className?: string;
}

/**
 * Rank, engraved. Three brass bars for founding, two for signature, one for
 * charter — the same visual grammar as a service stripe, which is exactly the
 * register this club operates in. No badges, no icons, no colour beyond brass.
 */
export function MemberTierMark({ tier, withLabel = false, className }: MemberTierMarkProps) {
  const n = BARS[tier];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={`${MEMBER_TIER_LABEL[tier]} member`}
    >
      <span className="flex items-center gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'block h-[7px] w-[1.5px]',
              i < n ? 'bg-brass' : 'bg-ink/12',
            )}
          />
        ))}
      </span>
      {withLabel && (
        <span className="label-sm text-ink-faint">{MEMBER_TIER_LABEL[tier]}</span>
      )}
      <span className="sr-only">{MEMBER_TIER_LABEL[tier]} member</span>
    </span>
  );
}
