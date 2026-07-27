'use client';

import { useMemo, useState } from 'react';

import { Button, cn, EmptyState } from '@/components/ui';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import type { GroupStatus } from '@/lib/types';
import { GroupCard } from './GroupCard';
import { useGroupsFor } from './hooks';

export interface GroupListProps {
  eventId: string;
  className?: string;
}

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
