'use client';

import { cn } from '@/components/ui';
import { useUnreadActivityCount } from '@/lib/social/notifications';
import { useProfileUiStore } from '@/lib/social/profileStore';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import { Avatar } from './Avatar';
import { SocialRoot } from './MemberProfileSheet';
import { MemberTierMark } from './MemberTierMark';

export interface CurrentMemberChipProps {
  className?: string;
}

/**
 * The signed-in member, and the door to their record.
 *
 * Reads as a name plate rather than an account button — no chevron, no
 * gravatar, no "signed in as". The plate, the name, the rank mark, and a small
 * brass count when something has happened. Brass, and never red: this product
 * does not badger anybody.
 *
 * It also mounts `SocialRoot` — the profile sheet and the share-link reader —
 * exactly once. The masthead is the one component guaranteed to be on screen,
 * and putting the sheet here is what lets `useOpenProfile()` work from a peer
 * plate on the globe, a roster row, or a line in a cabin thread without any of
 * them sharing an ancestor.
 */
export function CurrentMemberChip({ className }: CurrentMemberChipProps) {
  const hydrated = useSocialHydration();
  const me = useSocialStore((s) => s.currentMember);
  const openProfile = useProfileUiStore((s) => s.openProfile);
  const unread = useUnreadActivityCount();

  return (
    <>
      <button
        type="button"
        onClick={() => openProfile(me.id)}
        aria-label={
          unread > 0 ? `Your member record — ${unread} new` : 'Your member record'
        }
        className={cn(
          'group relative flex items-center gap-2.5 rounded-[2px] border border-transparent px-1.5 py-1',
          'transition-colors duration-[var(--duration-instant)]',
          'hover:border-ink/10 hover:bg-obsidian/60',
          className,
        )}
      >
        <span className="relative">
          <Avatar
            seed={me.avatarSeed}
            size={24}
            name={me.name}
            {...(hydrated && me.photoUrl ? { photoUrl: me.photoUrl } : {})}
            accented
            decorative
          />
          {hydrated && unread > 0 && (
            <span
              aria-hidden
              className={cn(
                'tabular absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center',
                'rounded-full border border-brass-deep bg-abyss px-1 text-[9px] leading-none text-brass',
              )}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="font-display truncate text-[13px] leading-4 text-ink">
            {hydrated ? me.name : ' '}
          </span>
          <span className="flex items-center gap-1.5">
            <MemberTierMark tier={me.tier} />
            <span className="label-sm text-ink-faint">{me.homeBase.homeJetPort}</span>
          </span>
        </span>
      </button>

      <SocialRoot />
    </>
  );
}
