'use client';

/**
 * MERIDIAN — who is going.
 *
 * The other half of the cabin card, and arguably the more persuasive one. The
 * conversation tells you what the trip is; this tells you who you would be
 * sitting with, which is the thing the product is actually selling.
 *
 * Every row is a real record out of the roster: rank, home field, the airframe
 * they keep there, and whether they will put a stranger in the back of it.
 * Nothing is summarised into a count that the reader has to take on trust —
 * "four members you'd fly with" is only worth saying when you can name them.
 */

import { useMemo } from 'react';

import { Button, cn, Rule } from '@/components/ui';
import { MEMBER_INDEX, type MemberDossier } from '@/lib/social/members';
import { useGroupPresence } from '@/lib/social/presence';
import { useOpenProfile } from '@/lib/social/profileStore';
import { useSocialStore } from '@/lib/social/useSocialStore';
import type { GroupMembership, TravelGroup } from '@/lib/types';
import { Avatar } from './Avatar';
import { MemberTierMark } from './MemberTierMark';

export interface GroupRosterProps {
  groupId: string;
  /** Pass it if you already have it — saves a lookup. */
  group?: TravelGroup;
  className?: string;
}

interface Seat {
  membership: GroupMembership;
  /** The dossier form — carries the photograph when the record has one. */
  member: MemberDossier;
  isHost: boolean;
  isMe: boolean;
}

export function GroupRoster({ groupId, group, className }: GroupRosterProps) {
  const groups = useSocialStore((s) => s.groups);
  const meId = useSocialStore((s) => s.currentMember.id);
  const myName = useSocialStore((s) => s.currentMember.name);
  const myAvatarSeed = useSocialStore((s) => s.currentMember.avatarSeed);
  const myPhotoUrl = useSocialStore((s) => s.currentMember.photoUrl);
  const joinGroup = useSocialStore((s) => s.joinGroup);
  const openProfile = useOpenProfile();

  const cabin = useMemo(
    () => group ?? groups.find((g) => g.id === groupId),
    [group, groups, groupId],
  );

  const seats = useMemo<Seat[]>(() => {
    if (!cabin) return [];
    return cabin.members
      .map((membership) => {
        const member = MEMBER_INDEX.get(membership.memberId);
        if (!member) return null;
        return {
          membership,
          member,
          isHost: membership.role === 'host',
          isMe: membership.memberId === meId,
        };
      })
      .filter((s): s is Seat => s !== null)
      // Host first, then join order. That is how a manifest is printed.
      .sort((a, b) => Number(b.isHost) - Number(a.isHost));
  }, [cabin, meId]);

  const memberIds = useMemo(() => seats.map((s) => s.member.id), [seats]);
  const { online } = useGroupPresence(groupId, memberIds);

  if (!cabin) return null;

  const filled = cabin.members.length;
  const seatsLeft = Math.max(0, cabin.capacity - filled);
  const mine = cabin.members.some((m) => m.memberId === meId);
  // The signed-in member is not in the simulated roster, so they never resolve
  // through MEMBER_INDEX. Draw them explicitly rather than dropping them.
  const meMissing = mine && !seats.some((s) => s.isMe);
  const sharers = seats.filter((s) => s.member.openToJetShare && !s.isHost).length;
  const closed = cabin.status === 'locked' || seatsLeft === 0;

  return (
    <div className={cn('flex flex-col', className)}>
      <ul className="flex flex-col" role="list">
        {seats.map((seat, i) => (
          <li key={seat.member.id}>
            {i > 0 && <Rule variant="ghost" />}
            <SeatRow
              seat={seat}
              online={online.has(seat.member.id)}
              onOpen={() => openProfile(seat.member.id)}
            />
          </li>
        ))}
        {meMissing && (
          <li>
            {seats.length > 0 && <Rule variant="ghost" />}
            <div className="flex items-center gap-3 py-2.5">
              <Avatar seed={myAvatarSeed} size={30} name={myName} photoUrl={myPhotoUrl} accented decorative />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-display text-[14px] leading-5 text-brass">You</span>
                <span className="label-sm text-ink-faint">On this manifest</span>
              </span>
            </div>
          </li>
        )}
      </ul>

      <Rule className="my-3" />

      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label-sm text-ink-faint">
            {closed ? 'Cabin' : 'Seats left'}
          </p>
          <p className="font-display mt-1 text-[20px] leading-6 text-ink">
            {closed ? `${filled} of ${cabin.capacity}` : seatsLeft}
          </p>
          <p className="mt-1.5 text-[11px] leading-4 text-ink-muted">
            {closed
              ? 'Manifest closed'
              : sharers > 0
                ? `${sharers} of them regularly share a cabin`
                : `${filled} on the manifest, ${cabin.quorum} needed for quorum`}
          </p>
        </div>

        {!mine && !closed && (
          <Button variant="brass" size="md" onClick={() => joinGroup(cabin.id)}>
            {`Take a seat — ${seatsLeft} left`}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SeatRow({
  seat,
  online,
  onOpen,
}: {
  seat: Seat;
  online: boolean;
  onOpen: () => void;
}) {
  const { member, isHost } = seat;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex w-full items-center gap-3 py-2.5 text-left',
        'transition-colors duration-[var(--duration-instant)]',
      )}
      aria-label={`Open ${member.name}'s profile`}
    >
      <span className="relative shrink-0">
        <Avatar
          seed={member.avatarSeed}
          size={30}
          name={member.name}
          photoUrl={member.photoUrl}
          accented={isHost}
          decorative
        />
        {/* Presence sits on the plate itself, cut out of the surface behind it,
            so it reads as part of the portrait rather than a badge on top. */}
        <span
          aria-hidden
          className={cn(
            'absolute -right-px -bottom-px block size-[7px] rounded-full ring-2 ring-obsidian',
            online ? 'bg-signal' : 'bg-ink-ghost',
          )}
        />
        <span className="sr-only">{online ? 'Online' : 'Offline'}</span>
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-display truncate text-[14px] leading-5 text-ink group-hover:text-brass-bright">
            {member.name}
          </span>
          <MemberTierMark tier={member.tier} />
          {isHost && (
            <span className="label-sm shrink-0 border border-brass-deep/60 px-1 py-0.5 text-brass">
              Host
            </span>
          )}
        </span>
        <span className="label-sm truncate text-ink-faint">
          {member.homeBase.city} · {member.homeBase.homeJetPort}
          {member.aircraft ? ` · ${member.aircraft}` : ''}
        </span>
      </span>

      {member.aircraft && member.openToJetShare && (
        <span className="label-sm shrink-0 text-signal" title="Offers seats on their own aircraft">
          Offers seats
        </span>
      )}
    </button>
  );
}
