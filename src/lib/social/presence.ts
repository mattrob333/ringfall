'use client';

/**
 * MERIDIAN — presence.
 *
 * A room feels occupied when the people in it move slightly. That is the whole
 * brief: a dot beside a name, and once in a while somebody starting to type.
 * Nothing here announces itself, and nothing here is allowed to cost anything.
 *
 * ── How it is built ─────────────────────────────────────────────────────────
 * There is exactly one timer in the process, and it is the same `startDrip`
 * the simulated club already runs on. It advances a single integer every four
 * to seven seconds. Everything else — who is online, who is typing — is a
 * *pure function* of that integer, so:
 *
 *   • nothing is stored per member, so nothing can leak;
 *   • the server and the first client render both see tick 0 and therefore
 *     agree exactly, which is the only way to put this above the hydration
 *     boundary;
 *   • a component re-renders at most once every four seconds, not per frame.
 *
 * The timer is refcounted by subscribers and stops itself when the last
 * consumer unmounts, when the tab is hidden (inherited from `startDrip`), and
 * whenever `setPresencePaused(true)` is called.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { hashSeed } from './rng';
import { startDrip, type DripController } from './simulation';

// ─────────────────────────────────────────────────────────────────────────────
// Tuning
// ─────────────────────────────────────────────────────────────────────────────

const PRESENCE_SEED = 'meridian.presence.v1';

/** Share of the roster lit at any moment. A club, not a call centre. */
const ONLINE_RATE = 0.34;
/** Members who share cabins are, definitionally, the ones who answer. */
const ONLINE_RATE_SHARER = 0.46;

/** Ticks a presence state holds before it is re-rolled. ~7 × 5s ≈ 35s. */
const ONLINE_HOLD = 7;

/** Ticks a typing burst lasts. ~2 × 5s ≈ 10s. */
const TYPING_HOLD = 2;

/** Percent of typing windows in which somebody in a given cabin is composing. */
const TYPING_CHANCE_PCT = 16;

const MIN_MS = 4_000;
const MAX_MS = 7_000;

// ─────────────────────────────────────────────────────────────────────────────
// Pure state — everything below is a function of (id, tick)
// ─────────────────────────────────────────────────────────────────────────────

/** 0..1 from a seed string. Stable in every engine. */
const unit = (key: string): number => (hashSeed(key) % 100_000) / 100_000;

/**
 * Whether a member reads as online at this tick.
 *
 * `sharer` nudges the rate up for members who are open to sharing a cabin —
 * the ones the product keeps telling you about are the ones who answer.
 */
export function isOnline(memberId: string, tick: number, sharer = false): boolean {
  const window = Math.floor(tick / ONLINE_HOLD);
  const rate = sharer ? ONLINE_RATE_SHARER : ONLINE_RATE;
  return unit(`${PRESENCE_SEED}:on:${memberId}:${window}`) < rate;
}

/**
 * Who, if anyone, is composing in this cabin right now.
 *
 * Never before the first tick: a typing indicator painted during SSR would be
 * stale by the time anybody read it, and a lie the moment it was.
 */
export function typingIn(
  groupId: string,
  memberIds: readonly string[],
  tick: number,
): string | null {
  if (tick <= 0 || memberIds.length === 0) return null;
  const phase = Math.floor(tick / TYPING_HOLD);
  const roll = hashSeed(`${PRESENCE_SEED}:type:${groupId}:${phase}`);
  if (roll % 100 >= TYPING_CHANCE_PCT) return null;
  const lit = memberIds.filter((id) => isOnline(id, tick));
  const pool = lit.length > 0 ? lit : memberIds;
  return pool[roll % pool.length] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The single timer
// ─────────────────────────────────────────────────────────────────────────────

let tick = 0;
let controller: DripController | null = null;
let paused = false;
const listeners = new Set<() => void>();

function ensureRunning(): void {
  if (controller || paused || listeners.size === 0) return;
  controller = startDrip(
    () => {
      tick += 1;
      for (const l of listeners) l();
    },
    { minMs: MIN_MS, maxMs: MAX_MS },
  );
}

function halt(): void {
  controller?.stop();
  controller = null;
}

/** Subscribe to the tick. Starts the timer on the first subscriber. */
export function subscribePresence(onChange: () => void): () => void {
  listeners.add(onChange);
  ensureRunning();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) halt();
  };
}

export const getPresenceTick = (): number => tick;

/** The server, and the first client render, always see zero. */
const getServerTick = (): number => 0;

/**
 * Pause presence — while a heavy transition is running, or from a settings
 * toggle. Idempotent, and safe to call before anything has subscribed.
 */
export function setPresencePaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  if (paused) halt();
  else ensureRunning();
}

export const isPresencePaused = (): boolean => paused;

/**
 * Test/verification hook. Winds the clock back to zero. Any live subscribers
 * keep their subscription and the timer restarts under them, so this is safe
 * to call from a running app as well as from a script.
 */
export function resetPresence(): void {
  halt();
  tick = 0;
  paused = false;
  for (const l of listeners) l();
  ensureRunning();
}

// ─────────────────────────────────────────────────────────────────────────────
// React
// ─────────────────────────────────────────────────────────────────────────────

/** The raw tick. Re-renders roughly once every five seconds, and no faster. */
export function usePresenceTick(): number {
  return useSyncExternalStore(subscribePresence, getPresenceTick, getServerTick);
}

/**
 * Presence for a single member — the avatar dot. Selects a boolean, so a
 * component using it only re-renders when that member's own state flips, not
 * on every tick.
 */
export function useIsOnline(memberId: string, sharer = false): boolean {
  const snapshot = useCallback(
    () => isOnline(memberId, tick, sharer),
    [memberId, sharer],
  );
  return useSyncExternalStore(subscribePresence, snapshot, () =>
    isOnline(memberId, 0, sharer),
  );
}

export interface GroupPresence {
  /** Member ids currently lit. */
  online: ReadonlySet<string>;
  /** Exactly one composer at a time, or none. Two is noise, three is a lie. */
  typingId: string | null;
}

const EMPTY_PRESENCE: GroupPresence = { online: new Set<string>(), typingId: null };

/** Presence for a whole cabin. One re-render per tick, for the whole roster. */
export function useGroupPresence(
  groupId: string,
  memberIds: readonly string[],
): GroupPresence {
  const t = usePresenceTick();
  // The id list is rebuilt by the caller on every render; key on its contents
  // so the memo does not thrash on an identical roster.
  const key = memberIds.join(',');
  return useMemo(() => {
    if (memberIds.length === 0) return EMPTY_PRESENCE;
    const online = new Set<string>();
    for (const id of memberIds) if (isOnline(id, t)) online.add(id);
    return { online, typingId: typingIn(groupId, memberIds, t) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, key, t]);
}
