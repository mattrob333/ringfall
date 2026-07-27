'use client';

/**
 * MERIDIAN — the cabin conversation.
 *
 * This is the only surface in the product where members speak in their own
 * voice, so it is deliberately not styled like a messaging app: no bubbles, no
 * rounded corners, no coloured tails, no read receipts. A thread here reads the
 * way a printed transcript reads — a name, a time, and what was said — because
 * that is the register the rest of MERIDIAN is written in.
 *
 * Three behaviours are load-bearing:
 *
 *   • The scroller only follows new messages when the reader is already at the
 *     bottom. Yanking somebody out of scrollback to show them a line they did
 *     not ask for is the single worst thing a thread can do.
 *   • Consecutive messages from one member collapse into a run, with the plate
 *     drawn once. A column of eighty identical avatars is noise.
 *   • The composer sends on Enter and breaks on Shift+Enter, and it stops the
 *     app's global scrub keys from firing while it has focus.
 */

import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { Button, cn, EmptyState, formatDayMonth, guardAppKeys } from '@/components/ui';
import { countUnread, mergeThread, type ChatMessage } from '@/lib/social/chat';
import { MEMBER_INDEX } from '@/lib/social/members';
import { useGroupPresence } from '@/lib/social/presence';
import { useOpenProfile } from '@/lib/social/profileStore';
import { useSocialStore } from '@/lib/social/useSocialStore';
import type { TravelGroup } from '@/lib/types';
import { Avatar } from './Avatar';
import { TypingDots } from './TypingDots';

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
//
// Same discipline as `hooks.ts`: select stable references or primitives, derive
// with `useMemo`. `myMessages` and `lastReadAt[groupId]` are both stable under
// `Object.is` between unrelated writes, so neither of these re-renders when
// somebody joins a cabin on the other side of the app.
// ─────────────────────────────────────────────────────────────────────────────

/** The merged thread: the seeded conversation plus anything the user sent. */
export function useThread(groupId: string): ChatMessage[] {
  const mine = useSocialStore((s) => s.myMessages);
  return useMemo(() => mergeThread(groupId, mine), [groupId, mine]);
}

/** Messages the user has not seen. Excludes their own. */
export function useUnreadFor(groupId: string): number {
  const mine = useSocialStore((s) => s.myMessages);
  const since = useSocialStore((s) => s.lastReadAt[groupId]);
  const meId = useSocialStore((s) => s.currentMember.id);
  return useMemo(
    () => countUnread(mergeThread(groupId, mine), since, meId),
    [groupId, mine, since, meId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocks
// ─────────────────────────────────────────────────────────────────────────────

interface Run {
  kind: 'run';
  key: string;
  memberId: string;
  mine: boolean;
  messages: ChatMessage[];
}

type Block =
  | { kind: 'day'; key: string; date: string }
  | { kind: 'system'; key: string; message: ChatMessage }
  | Run;

/** A gap this long ends a run even when the same person is still talking. */
const RUN_GAP_MS = 40 * 60_000;

function toBlocks(messages: readonly ChatMessage[], meId: string): Block[] {
  const out: Block[] = [];
  let day = '';
  let run: Run | null = null;

  for (const m of messages) {
    const date = m.sentAt.slice(0, 10);
    if (date !== day) {
      day = date;
      run = null;
      out.push({ kind: 'day', key: `d-${date}-${m.id}`, date });
    }

    if (m.kind === 'system') {
      run = null;
      out.push({ kind: 'system', key: m.id, message: m });
      continue;
    }

    const last = run?.messages[run.messages.length - 1];
    const gap = last ? Date.parse(m.sentAt) - Date.parse(last.sentAt) : Infinity;
    if (run && run.memberId === m.memberId && gap < RUN_GAP_MS) {
      run.messages.push(m);
      continue;
    }

    run = {
      kind: 'run',
      key: `r-${m.id}`,
      memberId: m.memberId,
      mine: m.memberId === meId,
      messages: [m],
    };
    out.push(run);
  }

  return out;
}

/** `09:40`, UTC, straight off the ISO string. No locale, no hydration drift. */
const timeOf = (iso: string): string => iso.slice(11, 16);

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupChatProps {
  groupId: string;
  /** Pass it if you already have it — saves a lookup and a subscription. */
  group?: TravelGroup;
  /** Scroller height. The card uses a fixed one so expansion is not jumpy. */
  maxHeight?: number;
  className?: string;
}

export function GroupChat({ groupId, group, maxHeight = 320, className }: GroupChatProps) {
  const groups = useSocialStore((s) => s.groups);
  const meId = useSocialStore((s) => s.currentMember.id);
  const sendMessage = useSocialStore((s) => s.sendMessage);
  const myAvatarSeed = useSocialStore((s) => s.currentMember.avatarSeed);
  const myPhotoUrl = useSocialStore((s) => s.currentMember.photoUrl);
  const markRead = useSocialStore((s) => s.markRead);
  const reduced = useReducedMotion();
  const openProfile = useOpenProfile();

  const cabin = useMemo(
    () => group ?? groups.find((g) => g.id === groupId),
    [group, groups, groupId],
  );
  const memberIds = useMemo(
    () => (cabin ? cabin.members.map((m) => m.memberId) : []),
    [cabin],
  );
  const mine = cabin?.members.some((m) => m.memberId === meId) ?? false;

  const messages = useThread(groupId);
  const blocks = useMemo(() => toBlocks(messages, meId), [messages, meId]);
  const { typingId } = useGroupPresence(groupId, memberIds);
  const typist = typingId && typingId !== meId ? MEMBER_INDEX.get(typingId) : undefined;

  // ── Scroll ────────────────────────────────────────────────────────────
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [pending, setPending] = useState(0);
  const settled = useRef(false);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    setAtBottom(near);
    if (near) setPending(0);
  }, []);

  const toBottom = useCallback(
    (smooth: boolean) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced ? 'smooth' : 'auto' });
      setPending(0);
      setAtBottom(true);
    },
    [reduced],
  );

  // Open at the newest message, with no animation — the first paint should
  // already be where the reader wants to be.
  useLayoutEffect(() => {
    if (settled.current) return;
    settled.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const count = messages.length;
  const seen = useRef(count);
  useEffect(() => {
    if (count === seen.current) return;
    const added = count - seen.current;
    seen.current = count;
    if (atBottom) toBottom(true);
    else if (added > 0) setPending((p) => p + added);
  }, [count, atBottom, toBottom]);

  // Reading the thread is what marks it read. Runs once per mount and again
  // whenever the newest message changes — `markRead` is idempotent, so this
  // cannot loop.
  const newest = messages[messages.length - 1]?.sentAt;
  useEffect(() => {
    markRead(groupId);
  }, [groupId, newest, markRead]);

  // ── Composer ──────────────────────────────────────────────────────────
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement | null>(null);

  const send = useCallback(() => {
    if (draft.trim().length === 0) return;
    const sent = sendMessage(groupId, draft);
    if (!sent) return;
    setDraft('');
    if (box.current) box.current.style.height = 'auto';
    setAtBottom(true);
    requestAnimationFrame(() => toBottom(true));
  }, [draft, groupId, sendMessage, toBottom]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // The page owns Space and the arrows. A textarea must not let them out.
      guardAppKeys(e);
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        ref={scroller}
        onScroll={measure}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Cabin conversation"
        className="relative min-h-0 overflow-y-auto overflow-x-hidden pr-1"
        style={{ maxHeight }}
      >
        {blocks.length === 0 ? (
          <EmptyState
            className="px-0 py-6"
            title="Nothing said yet"
            body={
              mine
                ? 'You opened this cabin. Say where you are leaving from and what the plan is — nobody joins a blank thread.'
                : 'This cabin has not started talking. Joining is usually what starts it.'
            }
          />
        ) : (
          <div className="flex flex-col gap-3 py-1">
            {blocks.map((b) =>
              b.kind === 'day' ? (
                <DayMark key={b.key} date={b.date} />
              ) : b.kind === 'system' ? (
                <SystemLine key={b.key} message={b.message} />
              ) : (
                <MessageRun
                  key={b.key}
                  run={b}
                  onOpenProfile={openProfile}
                  myAvatarSeed={myAvatarSeed}
                  myPhotoUrl={myPhotoUrl}
                />
              ),
            )}
          </div>
        )}

        <AnimatePresence initial={false}>
          {typist && (
            <motion.p
              key={typist.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="mt-2 flex items-center gap-2 pl-[30px] text-[11px] leading-4 text-ink-faint"
            >
              <TypingDots label={`${typist.name} is typing`} />
              <span aria-hidden>{typist.name.split(' ')[0]} is typing</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {pending > 0 && !atBottom && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          className={cn(
            'label mt-2 self-center border border-brass-deep/60 bg-brass-wash px-2.5 py-1',
            'text-brass transition-colors hover:border-brass hover:text-brass-bright',
          )}
        >
          {pending} new {pending === 1 ? 'message' : 'messages'}
        </button>
      )}

      {mine ? (
        <div className="mt-3 flex items-end gap-2 border-t border-ink/8 pt-3">
          <label className="sr-only" htmlFor={`composer-${groupId}`}>
            Write to the cabin
          </label>
          <textarea
            id={`composer-${groupId}`}
            ref={box}
            value={draft}
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value.slice(0, 600));
              // Grow with the content up to the max height, then scroll. Done
              // imperatively because a textarea has no intrinsic content size.
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder="Wheels up Thursday works. I will come up the night before."
            className={cn(
              'max-h-24 min-h-8 flex-1 resize-none rounded-[2px] border border-ink/10 bg-void/60 px-2.5 py-[7px]',
              'text-[12px] leading-[18px] text-ink placeholder:text-ink-ghost',
              'focus:border-brass-deep focus:outline-none',
            )}
          />
          <Button
            variant="brass"
            size="md"
            disabled={draft.trim().length === 0}
            onClick={send}
            aria-label="Send to the cabin"
          >
            Send
          </Button>
        </div>
      ) : (
        <p className="label-sm mt-3 border-t border-ink/8 pt-3 text-ink-ghost">
          Take a seat to join the conversation
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function DayMark({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-1 first:pt-0" role="presentation">
      <span className="h-px flex-1 bg-ink/6" aria-hidden />
      <span className="label-sm text-ink-ghost">{formatDayMonth(date)}</span>
      <span className="h-px flex-1 bg-ink/6" aria-hidden />
    </div>
  );
}

/**
 * A state change, not a person talking. Reads as a ledger entry: brass tick,
 * small caps, no plate.
 */
function SystemLine({ message }: { message: ChatMessage }) {
  return (
    <p className="flex items-center gap-2 pl-[30px]">
      <span aria-hidden className="block h-px w-3 shrink-0 bg-brass-deep" />
      <span className="label-sm text-ink-faint">{message.body}</span>
    </p>
  );
}

function MessageRun({
  run,
  onOpenProfile,
  myAvatarSeed,
  myPhotoUrl,
}: {
  run: Run;
  onOpenProfile: (memberId: string) => void;
  myAvatarSeed: string;
  myPhotoUrl?: string;
}) {
  const member = MEMBER_INDEX.get(run.memberId);
  const first = run.messages[0]!;
  const name = run.mine ? 'You' : (member?.name ?? 'Member');

  return (
    <article
      className={cn(
        'flex gap-2.5',
        // The reader's own run is set off by a brass hairline down its left
        // edge rather than by a coloured bubble. Distinguished, not shouted.
        run.mine && 'border-l border-brass-deep/50 -ml-px pl-2.5',
      )}
    >
      <span className="shrink-0 pt-[3px]">
        {member && !run.mine ? (
          <button
            type="button"
            onClick={() => onOpenProfile(member.id)}
            className="block rounded-full focus-visible:outline-1 focus-visible:outline-brass"
            aria-label={`Open ${member.name}'s profile`}
          >
            <Avatar seed={member.avatarSeed} size={22} name={member.name} photoUrl={member.photoUrl} decorative />
          </button>
        ) : (
          <Avatar
            seed={member?.avatarSeed ?? myAvatarSeed}
            size={22}
            name={name}
            photoUrl={run.mine ? myPhotoUrl : member?.photoUrl}
            accented={run.mine}
            decorative
          />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          {member && !run.mine ? (
            <button
              type="button"
              onClick={() => onOpenProfile(member.id)}
              className="font-display truncate text-[13px] leading-4 text-ink hover:text-brass-bright"
            >
              {member.name}
            </button>
          ) : (
            <span className={cn('font-display truncate text-[13px] leading-4', run.mine ? 'text-brass' : 'text-ink')}>
              {name}
            </span>
          )}
          <time className="tabular shrink-0 text-[10px] text-ink-ghost" dateTime={first.sentAt}>
            {timeOf(first.sentAt)}
          </time>
        </p>
        {run.messages.map((m) => (
          <p
            key={m.id}
            className={cn(
              'mt-1 text-[12px] leading-[18px] whitespace-pre-wrap',
              run.mine ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {m.body}
          </p>
        ))}
      </div>
    </article>
  );
}
