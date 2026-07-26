'use client';

import { useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { Button, cn, Rule } from '@/components/ui';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import type { InterestLevel } from '@/lib/types';
import { useGroupsFor, useInterestLevel, useMyGroupFor } from './hooks';
import { MemberBadge } from './MemberBadge';

export interface InterestControlProps {
  eventId: string;
  className?: string;
}

interface Rung {
  level: InterestLevel;
  title: string;
  /** What actually happens. Stated, because the last rung costs money. */
  consequence: string;
}

/**
 * The ladder. Three rungs, each one a larger claim than the last, and each one
 * says what it does.
 *
 * This is not a like button. The top rung means the user is prepared to be on
 * a manifest and to pay a share of a charter, so the escalation is deliberate:
 * one step at a time, no skipping, and stepping down is always available.
 */
const RUNGS: readonly Rung[] = [
  {
    level: 'watching',
    title: 'Watching',
    consequence: 'Kept on your calendar. Nothing is shared and nobody is told.',
  },
  {
    level: 'interested',
    title: 'Interested',
    consequence:
      'Visible to members on this event. You count toward quorum on forming cabins.',
  },
  {
    level: 'committed',
    title: 'Committed',
    consequence:
      'You are on the manifest. Charter cost is split across the cabin, and the split is binding once the aircraft is held.',
  },
];

const RANK: Record<InterestLevel, number> = { watching: 0, interested: 1, committed: 2 };

export function InterestControl({ eventId, className }: InterestControlProps) {
  const hydrated = useSocialHydration();
  const level = useInterestLevel(eventId);
  const setInterest = useSocialStore((s) => s.setInterest);
  const clearInterest = useSocialStore((s) => s.clearInterest);
  const joinGroup = useSocialStore((s) => s.joinGroup);

  const groups = useGroupsFor(eventId);
  const myGroup = useMyGroupFor(eventId);

  // The cabin worth surfacing at the moment of commitment: the one closest to
  // quorum that still has a seat.
  const openGroup = groups
    .filter((g) => !myGroup && g.members.length < g.capacity && g.status !== 'locked')
    .sort((a, b) => b.members.length / b.capacity - a.members.length / a.capacity)[0];

  const onPick = useCallback(
    (next: InterestLevel) => {
      if (level === next) clearInterest(eventId);
      else setInterest(eventId, next);
    },
    [level, eventId, setInterest, clearInterest],
  );

  const current = hydrated ? level : null;

  return (
    <div className={cn('flex flex-col', className)}>
      <div role="radiogroup" aria-label="Your interest in this event" className="flex flex-col">
        {RUNGS.map((rung, i) => {
          const active = current === rung.level;
          const beneath = current !== null && RANK[current] > RANK[rung.level];
          return (
            <div key={rung.level}>
              {i > 0 && <Rule variant="ghost" />}
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPick(rung.level)}
                className={cn(
                  'group flex w-full items-start gap-3 py-2.5 text-left',
                  'transition-colors duration-[var(--duration-instant)]',
                )}
              >
                <Notch active={active} filled={active || beneath} index={i} />
                <span className="flex min-w-0 flex-col gap-1">
                  <span
                    className={cn(
                      'label transition-colors',
                      active ? 'text-brass' : beneath ? 'text-ink-muted' : 'text-ink-faint',
                      'group-hover:text-ink',
                    )}
                  >
                    {rung.title}
                  </span>
                  <AnimatePresence initial={false}>
                    {active && (
                      <motion.span
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        className="block overflow-hidden text-[11px] leading-4 text-ink-muted"
                      >
                        {rung.consequence}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {current && (
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="label-sm text-ink-ghost">Click again to withdraw</span>
          <Button variant="quiet" size="sm" onClick={() => clearInterest(eventId)}>
            Withdraw
          </Button>
        </div>
      )}

      {/* Committing is the moment a cabin becomes relevant. Surface it here
          rather than making the user go looking for the group list. */}
      <AnimatePresence initial={false}>
        {current === 'committed' && openGroup && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="mt-3 border border-brass-deep/50 bg-brass-wash p-3"
          >
            <p className="label text-brass">
              {openGroup.capacity - openGroup.members.length} seat
              {openGroup.capacity - openGroup.members.length === 1 ? '' : 's'} open ·{' '}
              {openGroup.departureHub}
            </p>
            <p className="mt-2 text-[12px] leading-[18px] text-ink-muted">{openGroup.premise}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              {openGroup.members[0] && (
                <MemberBadge memberId={openGroup.members[0].memberId} size="sm" />
              )}
              <Button variant="brass" size="sm" onClick={() => joinGroup(openGroup.id)}>
                Join cabin
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {current === 'committed' && myGroup && (
        <p className="mt-3 text-[11px] leading-4 text-ink-muted">
          You are on <span className="text-ink">{myGroup.name}</span> out of{' '}
          <span className="tabular text-ink">{myGroup.departureHub}</span>.
        </p>
      )}
    </div>
  );
}

/**
 * The rung mark. A hairline square that fills brass as you climb — the rungs
 * below the current one stay filled, so the ladder reads as a level, not a
 * radio selection.
 */
function Notch({ active, filled, index }: { active: boolean; filled: boolean; index: number }) {
  return (
    <span className="relative mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center">
      <span
        className={cn(
          'block transition-all duration-[var(--duration-quick)] ease-[var(--ease-glide)]',
          filled ? 'bg-brass' : 'bg-transparent',
          active ? 'h-3 w-3' : 'h-2 w-2',
        )}
        style={{ outline: '1px solid var(--color-brass-deep)', outlineOffset: active ? 1 : 0 }}
      />
      {/* Weight increases up the ladder — the third rung is visibly heavier */}
      <span className="sr-only">{`rung ${index + 1}`}</span>
    </span>
  );
}
