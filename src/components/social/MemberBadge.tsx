'use client';

import { cn, Tooltip } from '@/components/ui';
import { MEMBER_INDEX } from '@/lib/social/members';
import { useOpenProfile } from '@/lib/social/profileStore';
import { Avatar } from './Avatar';
import { MemberTierMark } from './MemberTierMark';

export interface MemberBadgeProps {
  memberId: string;
  size?: 'sm' | 'md';
  /** Drop the name and handle — just the plate, with the identity on hover. */
  compact?: boolean;
  className?: string;
  /**
   * Open the member's record on click. Off by default, because this badge is
   * routinely rendered inside rows that are themselves clickable and a button
   * inside a button is invalid markup. Turn it on wherever the badge is the
   * only interactive thing in its row.
   */
  interactive?: boolean;
}

const AVATAR_PX = { sm: 22, md: 32 } as const;

/**
 * Vouched for at intake. A hairline brass lozenge, not a tick in a circle —
 * this is a members' register, not a social network.
 */
function VerifiedMark() {
  return (
    <svg
      width={7}
      height={7}
      viewBox="0 0 8 8"
      className="shrink-0"
      role="img"
      aria-label="Verified at intake"
    >
      <title>Verified at intake</title>
      <path
        d="M4 0.6 7.4 4 4 7.4 0.6 4Z"
        fill="none"
        stroke="var(--color-brass)"
        strokeWidth={1}
        opacity={0.8}
      />
    </svg>
  );
}

/**
 * A member, identified. Serif for the name — people get the display face,
 * numbers and labels do not.
 *
 * Renders nothing for an unknown id rather than a placeholder: a badge for a
 * member who does not exist is worse than a gap.
 */
export function MemberBadge({
  memberId,
  size = 'sm',
  compact = false,
  className,
  interactive = false,
}: MemberBadgeProps) {
  const openProfile = useOpenProfile();
  const member = MEMBER_INDEX.get(memberId);
  if (!member) return null;

  const px = AVATAR_PX[size];
  const photo = member.photoUrl ? { photoUrl: member.photoUrl } : {};

  if (compact) {
    return (
      <Tooltip
        content={
          <span className="flex flex-col gap-0.5">
            <span className="font-display text-[13px] text-ink">{member.name}</span>
            <span className="label-sm text-ink-faint">
              {member.homeBase.city} · {member.homeBase.homeJetPort}
            </span>
          </span>
        }
      >
        {interactive ? (
          <button
            type="button"
            onClick={() => openProfile(member.id)}
            aria-label={`${member.name} — member record`}
            className={cn('block rounded-full', className)}
          >
            <Avatar seed={member.avatarSeed} size={px} name={member.name} {...photo} decorative />
          </button>
        ) : (
          <Avatar
            seed={member.avatarSeed}
            size={px}
            name={member.name}
            {...photo}
            className={className}
          />
        )}
      </Tooltip>
    );
  }

  const Root = interactive ? 'button' : 'span';

  return (
    <Root
      {...(interactive
        ? {
            type: 'button' as const,
            onClick: () => openProfile(member.id),
            'aria-label': `${member.name} — member record`,
          }
        : {})}
      className={cn('flex min-w-0 items-center gap-2.5 text-left', className)}
    >
      <Avatar seed={member.avatarSeed} size={px} name={member.name} {...photo} decorative />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'font-display truncate text-ink',
              size === 'md' ? 'text-[15px] leading-5' : 'text-[13px] leading-4',
            )}
          >
            {member.name}
          </span>
          <MemberTierMark tier={member.tier} />
          {member.verified && <VerifiedMark />}
        </span>
        <span className="label-sm truncate text-ink-faint">
          {member.homeBase.city} · {member.homeBase.homeJetPort}
          {member.aircraft ? ` · ${member.aircraft}` : ''}
        </span>
      </span>
    </Root>
  );
}
