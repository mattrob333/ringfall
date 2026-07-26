'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { cn } from '@/components/ui';
import { MEMBER_INDEX } from '@/lib/social/members';
import type { Member } from '@/lib/types';
import { Avatar } from './Avatar';
import { usePeers } from './hooks';
import { MemberTierMark } from './MemberTierMark';

export interface PeerStackProps {
  eventId: string;
  /** Plates drawn before the overflow count takes over. */
  limit?: number;
  size?: number;
  /** Suppress the "N members you'd fly with…" line and draw plates only. */
  bare?: boolean;
  className?: string;
}

/**
 * Social proof, stated plainly.
 *
 * The plates overlap left-to-right with the leftmost on top, which is the
 * order a guest list is read in. Hovering lifts one out of the stack and names
 * it — the reveal is the whole point, because "+12" is not proof of anything
 * and a name is.
 *
 * The line underneath counts only members who are open to sharing a cabin. If
 * it says four members you'd fly with, four of them will actually take you.
 */
export function PeerStack({
  eventId,
  limit = 6,
  size = 26,
  bare = false,
  className,
}: PeerStackProps) {
  const peers = usePeers(eventId);
  const [hovered, setHovered] = useState<string | null>(null);

  const { shown, overflow, shareable } = useMemo(() => {
    // Members who will actually take a stranger lead the stack — they are the
    // ones the copy underneath is about.
    const ordered = [...peers].sort((a, b) => {
      const s = Number(b.openToJetShare) - Number(a.openToJetShare);
      if (s !== 0) return s;
      return Number(Boolean(b.aircraft)) - Number(Boolean(a.aircraft));
    });
    return {
      shown: ordered.slice(0, limit),
      overflow: Math.max(0, ordered.length - limit),
      shareable: ordered.filter((m) => m.openToJetShare).length,
    };
  }, [peers, limit]);

  if (peers.length === 0) {
    return bare ? null : (
      <p className={cn('text-[11px] leading-4 text-ink-faint', className)}>
        No members have signalled on this yet.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className="flex items-center"
        role="list"
        aria-label="Members signalling on this event"
        onMouseLeave={() => setHovered(null)}
      >
        {shown.map((m, i) => (
          <PeerPlate
            key={m.id}
            member={m}
            size={size}
            index={i}
            active={hovered === m.id}
            dimmed={hovered !== null && hovered !== m.id}
            onHover={setHovered}
          />
        ))}
        {overflow > 0 && (
          <span
            className={cn(
              'relative flex items-center justify-center rounded-full',
              'border border-ink/12 bg-obsidian/80 text-ink-muted tabular',
            )}
            style={{ width: size, height: size, marginLeft: -size * 0.28, fontSize: size * 0.34 }}
            title={`${overflow} more`}
          >
            +{overflow}
          </span>
        )}
      </div>

      {!bare && (
        <p className="text-[11px] leading-4 text-ink-muted">
          {hovered ? (
            <HoveredLine memberId={hovered} />
          ) : shareable > 0 ? (
            <>
              <span className="tabular text-ink">{shareable}</span>
              {` member${shareable === 1 ? '' : 's'} you'd fly with `}
              {shareable === 1 ? 'is' : 'are'} watching this
            </>
          ) : (
            <>
              <span className="tabular text-ink">{peers.length}</span>
              {` member${peers.length === 1 ? '' : 's'} signalling — none open to sharing a cabin`}
            </>
          )}
        </p>
      )}
    </div>
  );
}

interface PeerPlateProps {
  member: Member;
  size: number;
  index: number;
  active: boolean;
  dimmed: boolean;
  onHover: (id: string | null) => void;
}

function PeerPlate({ member, size, index, active, dimmed, onHover }: PeerPlateProps) {
  return (
    <motion.span
      className="relative block rounded-full"
      style={{
        marginLeft: index === 0 ? 0 : -size * 0.28,
        // Leftmost on top — a guest list reads left to right.
        zIndex: active ? 50 : 40 - index,
      }}
      animate={{ y: active ? -3 : 0, opacity: dimmed ? 0.4 : 1 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => onHover(member.id)}
      onFocus={() => onHover(member.id)}
      onBlur={() => onHover(null)}
      tabIndex={0}
      role="listitem"
      aria-label={member.name}
    >
      {/* A ring in the surface colour cuts each plate out of the one behind it */}
      <span
        className="absolute inset-[-1.5px] rounded-full bg-abyss"
        aria-hidden
        style={{ zIndex: -1 }}
      />
      <Avatar seed={member.avatarSeed} size={size} name={member.name} decorative />
    </motion.span>
  );
}

function HoveredLine({ memberId }: { memberId: string }) {
  const m = MEMBER_INDEX.get(memberId);
  if (!m) return null;
  return (
    <span className="flex items-center gap-2">
      <span className="font-display text-[13px] text-ink">{m.name}</span>
      <MemberTierMark tier={m.tier} />
      <span className="truncate text-ink-faint">
        {m.homeBase.city}
        {m.aircraft ? ` · ${m.aircraft}` : m.openToJetShare ? ' · open to sharing' : ''}
      </span>
    </span>
  );
}
