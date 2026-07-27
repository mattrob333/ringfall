'use client';

/**
 * MERIDIAN — the cabin card.
 *
 * The primary social surface in the product. Collapsed it is a summary you can
 * scan: who is hosting, what the premise is, how full it is, what a seat costs.
 * Expanded it is a room — the conversation the people on it are already having,
 * and the manifest of who they are.
 *
 * The expansion is the whole idea. A booking form asks you to fill a row. This
 * asks you whether you want to be in that cabin with those people, which is the
 * question members actually answer.
 *
 * Status carries the visual weight. `quorum` is the conversion moment of the
 * entire product — the instant a solitary interest becomes a trip that is
 * happening — so it gets the brass and a full-width rule. Everything else stays
 * quiet, because if three states shout, none of them do.
 */

import type { KeyboardEvent } from 'react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { Button, cn, EASE_SETTLE, Rule } from '@/components/ui';
import { EVENT_INDEX } from '@/lib/data/events';
import { formatUsd, quoteCharter } from '@/lib/social/charter';
import { formatUnread } from '@/lib/social/chat';
import { MEMBER_INDEX } from '@/lib/social/members';
import { useGroupPresence } from '@/lib/social/presence';
import { useOpenProfile } from '@/lib/social/profileStore';
import { useSocialStore } from '@/lib/social/useSocialStore';
import type { GroupStatus, TravelGroup } from '@/lib/types';
import { Avatar } from './Avatar';
import { GroupChat, useUnreadFor } from './GroupChat';
import { GroupRoster } from './GroupRoster';
import { MemberBadge } from './MemberBadge';

// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COPY: Record<GroupStatus, { label: string; note: string }> = {
  forming: { label: 'Forming', note: 'Open to anyone' },
  quorum: { label: 'Quorum', note: 'Viable — aircraft not yet held' },
  chartered: { label: 'Chartered', note: 'Aircraft held' },
  locked: { label: 'Locked', note: 'Manifest closed' },
};

const TABS = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'roster', label: "Who's going" },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Faces drawn in the collapsed row before the overflow count takes over. */
const FACE_LIMIT = 6;

export interface GroupCardProps {
  group: TravelGroup;
  /** Start open. The card the user just created, or a deep link. */
  defaultOpen?: boolean;
  className?: string;
}

export function GroupCard({ group, defaultOpen = false, className }: GroupCardProps) {
  const meId = useSocialStore((s) => s.currentMember.id);
  const home = useSocialStore((s) => s.currentMember.homeBase);
  const joinGroup = useSocialStore((s) => s.joinGroup);
  const leaveGroup = useSocialStore((s) => s.leaveGroup);
  const openProfile = useOpenProfile();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<TabId>('conversation');
  const bodyId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const unread = useUnreadFor(group.id);

  const mine = group.members.some((m) => m.memberId === meId);
  const host = group.members.find((m) => m.role === 'host');
  const filled = group.members.length;
  const seatsLeft = Math.max(0, group.capacity - filled);
  const urgent = group.status === 'quorum';
  const closed = group.status === 'locked' || seatsLeft === 0;

  const memberIds = useMemo(() => group.members.map((m) => m.memberId), [group.members]);
  const { online } = useGroupPresence(group.id, memberIds);

  // Per-seat at the current fill — the number that makes the argument.
  const perSeat = useMemo(() => {
    const event = EVENT_INDEX.get(group.eventId);
    if (!event) return null;
    const q = quoteCharter(home.coords, event.nearestJetPort.coords, group.capacity, group.jet, {
      seatsFilled: Math.max(1, filled),
    });
    return q.costPerSeat;
  }, [group.eventId, group.capacity, group.jet, filled, home.coords]);

  // The host is already named in full underneath; drawing their plate again in
  // the stack is a duplicate, and the reader notices duplicates.
  const faces = useMemo(
    () =>
      group.members
        .filter((m) => m.memberId !== meId && m.role !== 'host')
        .slice(0, FACE_LIMIT)
        .map((m) => MEMBER_INDEX.get(m.memberId))
        .filter((m): m is NonNullable<typeof m> => m !== undefined),
    [group.members, meId],
  );
  // Everyone drawn or named elsewhere on the card comes off the count. The
  // host and the viewer can be the same person, so they are counted once.
  const named = new Set<string>([
    ...faces.map((m) => m.id),
    ...(host ? [host.memberId] : []),
    ...(mine ? [meId] : []),
  ]);
  const overflow = Math.max(0, group.members.length - named.size);

  const reveal = useCallback(
    (next: TabId) => {
      setTab(next);
      setOpen(true);
    },
    [],
  );

  // Arrow-key navigation across the tab strip, with a roving tabindex. The
  // guard stops the page's own ←/→ scrub handler from also firing.
  const onTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const i = TABS.findIndex((t) => t.id === tab);
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = TABS.length - 1;
      if (next < 0) return;
      e.preventDefault();
      e.stopPropagation();
      setTab(TABS[next]!.id);
      tabRefs.current[next]?.focus();
    },
    [tab],
  );

  return (
    <motion.article
      layout={reduced ? false : 'position'}
      className={cn(
        'relative border',
        urgent ? 'border-brass-deep/70 bg-brass-wash' : 'border-ink/8 bg-obsidian/40',
        className,
      )}
      transition={{ duration: 0.32, ease: EASE_SETTLE }}
    >
      {/* Quorum gets the house rule across the top. Used once per card, at the
          one moment that deserves it. */}
      {urgent && <span aria-hidden className="brass-rule absolute inset-x-0 top-0 h-px" />}

      {/* ── The summary, as one control ─────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="block w-full px-3.5 pt-3.5 text-left"
      >
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="font-display block truncate text-[16px] leading-5 text-ink">
              {group.name}
            </span>
            <span className="label-sm mt-1.5 block text-ink-faint">
              {group.departureHub} · {STATUS_COPY[group.status].note}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {unread > 0 && (
              <span
                className={cn(
                  'label-sm tabular border px-1.5 py-1',
                  urgent
                    ? 'border-brass text-brass-bright'
                    : 'border-signal/40 text-signal',
                )}
              >
                {formatUnread(unread)} new
              </span>
            )}
            <span
              className={cn(
                'label border px-1.5 py-1',
                urgent ? 'border-brass text-brass-bright' : 'border-ink/10 text-ink-faint',
              )}
            >
              {STATUS_COPY[group.status].label}
            </span>
            <Chevron open={open} reduced={Boolean(reduced)} />
          </span>
        </span>

        <span className="mt-3 block text-[12px] leading-[18px] text-ink-muted">
          {group.premise}
        </span>
      </button>

      <div className="px-3.5 pb-3.5">
        <Rule variant="ghost" className="my-3" />

        {/* ── The people. Faces are the product; they are clickable. ─────── */}
        <div className="flex items-center justify-between gap-4">
          {host && (
            <button
              type="button"
              onClick={() => openProfile(host.memberId)}
              className="min-w-0 text-left"
              aria-label="Open the host's profile"
            >
              <MemberBadge memberId={host.memberId} size="sm" />
            </button>
          )}
          <div className="flex shrink-0 items-center" role="list" aria-label="On this manifest">
            {faces.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="listitem"
                onClick={() => openProfile(m.id)}
                title={m.name}
                aria-label={`Open ${m.name}'s profile`}
                className="relative block rounded-full transition-transform hover:z-10 hover:-translate-y-[2px]"
                style={{ marginLeft: i === 0 ? 0 : -6, zIndex: FACE_LIMIT - i }}
              >
                <span
                  aria-hidden
                  className="absolute inset-[-1.5px] rounded-full bg-abyss"
                  style={{ zIndex: -1 }}
                />
                <Avatar seed={m.avatarSeed} size={22} name={m.name} photoUrl={m.photoUrl} decorative />
                {online.has(m.id) && (
                  <span
                    aria-hidden
                    className="absolute -right-px -bottom-px block size-[6px] rounded-full bg-signal ring-2 ring-abyss"
                  />
                )}
              </button>
            ))}
            {overflow > 0 && (
              <span
                className="tabular ml-1.5 text-[11px] text-ink-faint"
                title={`${overflow} more on the manifest`}
              >
                +{overflow}
              </span>
            )}
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

        {/* ── Fill. Ticks, not a rounded bar — one mark per seat. ────────── */}
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

        {/* ── The money, and the two things you can do about it ──────────── */}
        <footer className="mt-3.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="label-sm text-ink-faint">Per seat at {filled}</p>
            <p className="font-display mt-1 text-[20px] leading-6 text-ink">
              {perSeat === null ? '—' : formatUsd(perSeat)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!open && (
              <Button variant="ghost" size="md" onClick={() => reveal('conversation')}>
                {unread > 0 ? `Read ${formatUnread(unread)}` : 'Open cabin'}
              </Button>
            )}
            {mine ? (
              <Button variant="quiet" size="sm" onClick={() => leaveGroup(group.id)}>
                Leave
              </Button>
            ) : closed ? (
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
          </div>
        </footer>
      </div>

      {/* ── The room ───────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: reduced ? 0 : 0.42,
              ease: EASE_SETTLE,
              opacity: { duration: reduced ? 0 : 0.24 },
            }}
            className="overflow-hidden"
          >
            <div className="border-t border-ink/8 px-3.5 pt-3 pb-3.5">
              {/* The rule is a sibling of the tablist, not a child of it —
                  a `role="tablist"` may only contain tabs. */}
              <div className="flex items-stretch">
                <div
                  role="tablist"
                  aria-label="Cabin detail"
                  aria-orientation="horizontal"
                  className="flex items-center gap-1"
                >
                  {TABS.map((t, i) => {
                    const selected = t.id === tab;
                    return (
                      <button
                        key={t.id}
                        ref={(el) => {
                          tabRefs.current[i] = el;
                        }}
                        type="button"
                        role="tab"
                        id={`${bodyId}-tab-${t.id}`}
                        aria-selected={selected}
                        aria-controls={`${bodyId}-panel-${t.id}`}
                        tabIndex={selected ? 0 : -1}
                        onKeyDown={onTabKeyDown}
                        onClick={() => setTab(t.id)}
                        className={cn(
                          'label h-7 border-b px-2 pb-1 transition-colors',
                          'duration-[var(--duration-instant)] ease-[var(--ease-glide)]',
                          selected
                            ? 'border-brass text-brass-bright'
                            : 'border-transparent text-ink-faint hover:text-ink',
                        )}
                      >
                        {t.label}
                        {t.id === 'conversation' && unread > 0 && (
                          <span className="tabular ml-1.5 text-signal">{formatUnread(unread)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <span aria-hidden className="mb-px h-px flex-1 self-end bg-ink/8" />
              </div>

              <div
                role="tabpanel"
                id={`${bodyId}-panel-conversation`}
                aria-labelledby={`${bodyId}-tab-conversation`}
                hidden={tab !== 'conversation'}
                tabIndex={0}
                className="mt-3 focus-visible:outline-1 focus-visible:outline-brass"
              >
                {tab === 'conversation' && <GroupChat groupId={group.id} group={group} />}
              </div>

              <div
                role="tabpanel"
                id={`${bodyId}-panel-roster`}
                aria-labelledby={`${bodyId}-tab-roster`}
                hidden={tab !== 'roster'}
                tabIndex={0}
                className="mt-3 focus-visible:outline-1 focus-visible:outline-brass"
              >
                {tab === 'roster' && <GroupRoster groupId={group.id} group={group} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** A hairline chevron. One weight, one colour, and it rotates rather than swaps. */
function Chevron({ open, reduced }: { open: boolean; reduced: boolean }) {
  return (
    <motion.svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      aria-hidden
      className="shrink-0 text-ink-faint"
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: reduced ? 0 : 0.32, ease: EASE_SETTLE }}
    >
      <path d="M1.5 3.5 5 7 8.5 3.5" fill="none" stroke="currentColor" strokeWidth={1} />
    </motion.svg>
  );
}
