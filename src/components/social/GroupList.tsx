'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { Button, cn, EmptyState, Rule } from '@/components/ui';
import { formatUsd, quoteCharter } from '@/lib/social/charter';
import { EVENT_INDEX } from '@/lib/data/events';
import { MEMBER_INDEX } from '@/lib/social/members';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import type { GroupStatus, TravelGroup } from '@/lib/types';
import { Avatar } from './Avatar';
import { useGroupsFor } from './hooks';
import { MemberBadge } from './MemberBadge';

export interface GroupListProps {
  eventId: string;
  className?: string;
}

const STATUS_COPY: Record<GroupStatus, { label: string; note: string }> = {
  forming: { label: 'Forming', note: 'Open to anyone' },
  quorum: { label: 'Quorum', note: 'Viable — aircraft not yet held' },
  chartered: { label: 'Chartered', note: 'Aircraft held' },
  locked: { label: 'Locked', note: 'Manifest closed' },
};

/**
 * The cabins on this event.
 *
 * A group at quorum is the conversion moment of the entire product — it is the
 * instant at which a solitary interest becomes a trip that is actually
 * happening — so it gets the brass. Everything else stays quiet.
 */
export function GroupList({ eventId, className }: GroupListProps) {
  const hydrated = useSocialHydration();
  const groups = useGroupsFor(eventId);
  const createGroup = useSocialStore((s) => s.createGroup);
  const [composing, setComposing] = useState(false);

  const ordered = useMemo(
    () =>
      [...groups].sort((a, b) => {
        const rank: Record<GroupStatus, number> = {
          quorum: 0,
          chartered: 1,
          forming: 2,
          locked: 3,
        };
        return rank[a.status] - rank[b.status] || b.members.length - a.members.length;
      }),
    [groups],
  );

  if (!hydrated) {
    return <div className={cn('h-24', className)} aria-hidden />;
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {ordered.length === 0 && !composing && (
        <EmptyState
          title="No cabin yet"
          body="Nobody has put a group together for this. Start one and the members watching it will see it."
          action={
            <Button variant="brass" size="sm" onClick={() => setComposing(true)}>
              Start a cabin
            </Button>
          }
        />
      )}

      {ordered.map((group) => (
        <GroupCard key={group.id} group={group} />
      ))}

      {composing ? (
        <Composer
          onCancel={() => setComposing(false)}
          onSubmit={(premise, capacity) => {
            createGroup(eventId, premise, capacity);
            setComposing(false);
          }}
        />
      ) : (
        ordered.length > 0 && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setComposing(true)}>
            Start another cabin
          </Button>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function GroupCard({ group }: { group: TravelGroup }) {
  const meId = useSocialStore((s) => s.currentMember.id);
  const home = useSocialStore((s) => s.currentMember.homeBase);
  const joinGroup = useSocialStore((s) => s.joinGroup);
  const leaveGroup = useSocialStore((s) => s.leaveGroup);

  const mine = group.members.some((m) => m.memberId === meId);
  const host = group.members.find((m) => m.role === 'host');
  const filled = group.members.length;
  const seatsLeft = Math.max(0, group.capacity - filled);
  const urgent = group.status === 'quorum';

  // Per-seat at the current fill — the number that makes the argument.
  const perSeat = useMemo(() => {
    const event = EVENT_INDEX.get(group.eventId);
    if (!event) return null;
    const q = quoteCharter(home.coords, event.nearestJetPort.coords, group.capacity, group.jet, {
      seatsFilled: Math.max(1, filled),
    });
    return q.costPerSeat;
  }, [group.eventId, group.capacity, group.jet, filled, home.coords]);

  return (
    <motion.article
      layout
      className={cn(
        'relative border p-3.5',
        urgent
          ? 'border-brass-deep/70 bg-brass-wash'
          : 'border-ink/8 bg-obsidian/40',
      )}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display truncate text-[16px] leading-5 text-ink">{group.name}</h3>
          <p className="label-sm mt-1.5 text-ink-faint">
            {group.departureHub} · {STATUS_COPY[group.status].note}
          </p>
        </div>
        <span
          className={cn(
            'label shrink-0 border px-1.5 py-1',
            urgent ? 'border-brass text-brass-bright' : 'border-ink/10 text-ink-faint',
          )}
        >
          {STATUS_COPY[group.status].label}
        </span>
      </header>

      <p className="mt-3 text-[12px] leading-[18px] text-ink-muted">{group.premise}</p>

      <Rule variant="ghost" className="my-3" />

      {/* Manifest — real faces, in join order, host first */}
      <div className="flex items-center justify-between gap-4">
        {host && <MemberBadge memberId={host.memberId} size="sm" />}
        <div className="flex items-center">
          {group.members.slice(1, 6).map((m, i) => {
            const member = MEMBER_INDEX.get(m.memberId);
            if (!member) return null;
            return (
              <span key={m.memberId} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                <Avatar seed={member.avatarSeed} size={20} name={member.name} decorative />
              </span>
            );
          })}
          {mine && (
            <span
              className="label-sm ml-2 border border-brass-deep/60 px-1.5 py-1 text-brass"
              title="You are on this manifest"
            >
              You
            </span>
          )}
        </div>
      </div>

      {/* Fill. Ticks, not a rounded bar — one mark per seat, so the count is
          readable without a number. */}
      <div className="mt-3.5 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-[3px]" aria-hidden>
          {Array.from({ length: group.capacity }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-[3px] flex-1',
                i < filled
                  ? urgent
                    ? 'bg-brass'
                    : 'bg-ink-muted'
                  : i < group.quorum
                    ? 'bg-ink/18'
                    : 'bg-ink/8',
              )}
            />
          ))}
        </div>
        <span className="tabular shrink-0 text-[11px] text-ink-muted">
          {filled}/{group.capacity}
        </span>
      </div>
      <p className="label-sm mt-2 text-ink-ghost">
        Quorum {group.quorum}
        {group.jet ? ` · ${group.jet.aircraft}` : ''}
      </p>

      <footer className="mt-3.5 flex items-end justify-between gap-4">
        <div>
          <p className="label-sm text-ink-faint">Per seat at {filled}</p>
          <p className="font-display mt-1 text-[20px] leading-6 text-ink">
            {perSeat === null ? '—' : formatUsd(perSeat)}
          </p>
        </div>
        {mine ? (
          <Button variant="quiet" size="sm" onClick={() => leaveGroup(group.id)}>
            Leave
          </Button>
        ) : seatsLeft === 0 || group.status === 'locked' ? (
          <span className="label text-ink-ghost">Manifest closed</span>
        ) : (
          <Button
            variant={urgent ? 'brass' : 'ghost'}
            size="md"
            onClick={() => joinGroup(group.id)}
          >
            {urgent ? `Take a seat — ${seatsLeft} left` : 'Join cabin'}
          </Button>
        )}
      </footer>
    </motion.article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Composer({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (premise: string, capacity: number) => void;
}) {
  const [premise, setPremise] = useState('');
  const [capacity, setCapacity] = useState(8);

  return (
    <div className="border border-ink/10 bg-obsidian/40 p-3.5">
      <p className="label text-ink-muted">Your premise</p>
      <textarea
        value={premise}
        onChange={(e) => setPremise(e.target.value.slice(0, 200))}
        rows={3}
        placeholder="Wheels up Thursday, back Sunday. Two rooms going at the house."
        className={cn(
          'mt-2.5 w-full resize-none rounded-[2px] border border-ink/10 bg-void/60 p-2.5',
          'text-[12px] leading-[18px] text-ink placeholder:text-ink-ghost',
          'focus:border-brass-deep focus:outline-none',
        )}
      />
      <div className="mt-3 flex items-end justify-between gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label-sm text-ink-faint">Seats</span>
          <input
            type="number"
            min={2}
            max={25}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className={cn(
              'tabular w-16 rounded-[2px] border border-ink/10 bg-void/60 px-2 py-1.5',
              'text-[13px] text-ink focus:border-brass-deep focus:outline-none',
            )}
          />
        </label>
        <div className="flex items-center gap-2">
          <Button variant="quiet" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="brass"
            size="sm"
            disabled={premise.trim().length < 8}
            onClick={() => onSubmit(premise, capacity)}
          >
            Open the cabin
          </Button>
        </div>
      </div>
      <p className="label-sm mt-2.5 text-ink-ghost">
        Opening a cabin commits you to the event
      </p>
    </div>
  );
}
