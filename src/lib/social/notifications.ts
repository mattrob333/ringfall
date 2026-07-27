'use client';

/**
 * MERIDIAN — activity.
 *
 * What the member missed while they were not looking: somebody new signalling
 * on a fixture they are watching, somebody landing on a cabin they are on, a
 * group reaching quorum, an aircraft being held.
 *
 * ── Two design rules ────────────────────────────────────────────────────────
 *
 * 1. THE FEED IS DERIVED, NOT STORED. It is a pure function of state the app
 *    already has — the user's own signals and cabins, plus how far the live
 *    drip in `simulation.ts` has advanced. Nothing here schedules anything:
 *    `SocialLive` already owns the only timer in the product, and every tick it
 *    releases one withheld peer signal, which is exactly the event this feed
 *    reports. A second timer would be a second source of truth about time.
 *
 * 2. IDS ARE DETERMINISTIC. A notification's id is a function of what it is
 *    about, never of when it was built, so "read" survives a refresh and the
 *    same arrival never announces itself twice.
 *
 * Ordering is by `seq`, not by `createdAt`. The underlying records carry real
 * timestamps, but a peer signal's timestamp is derived from its event's start
 * date — for a fixture next May, that is a date in the future. `seq` is the
 * order things actually reached this member, which is what a feed is for.
 */

import { useMemo } from 'react';

import { EVENT_INDEX } from '@/lib/data/events';
import type { InterestSignal, TravelGroup } from '@/lib/types';
import { MEMBER_INDEX } from './members';
import { getSimulation } from './simulation';
import { useSocialStore } from './useSocialStore';

export type NotificationKind =
  /** A member you do not know signalled on something you are watching. */
  | 'peer-interest'
  /** Somebody committed to an event where you have seats going. */
  | 'seat-interest'
  /** A cabin you are on has enough people to be viable. */
  | 'group-quorum'
  /** A cabin you are on has the aircraft held. */
  | 'group-chartered'
  /** A cabin you are on is full. */
  | 'group-full';

export interface ActivityNotification {
  id: string;
  kind: NotificationKind;
  eventId: string;
  groupId?: string;
  memberId?: string;
  /** ISO 8601, from the underlying record. */
  createdAt: string;
  read: boolean;
  /** Arrival order. Higher is newer. */
  seq: number;
}

export interface ActivityInput {
  currentMemberId: string;
  /** The user's own signals. */
  interests: readonly InterestSignal[];
  /** Live groups, with the user's joins applied. */
  groups: readonly TravelGroup[];
  /** How far the live drip has advanced this session. */
  dripRevealed: number;
  readIds: readonly string[];
}

/** More than this and it is a log, not a feed. */
const MAX_FEED = 24;

/**
 * Build the feed. Pure, and cheap enough to run on every drip tick — the drip
 * slice is bounded by the session length and the group scan is over the handful
 * of cabins the member is actually on.
 */
export function buildActivityFeed(input: ActivityInput): ActivityNotification[] {
  const { currentMemberId, interests, groups, dripRevealed, readIds } = input;
  const read = new Set(readIds);
  const out: ActivityNotification[] = [];

  const watching = new Set(interests.map((i) => i.eventId));
  const myGroups = groups.filter((g) => g.members.some((m) => m.memberId === currentMemberId));
  const myGroupsByEvent = new Map(myGroups.map((g) => [g.eventId, g]));

  // ── Arrivals, from the live drip ───────────────────────────────────────
  const world = getSimulation();
  const released = world.dripQueue.slice(0, Math.max(0, dripRevealed));
  released.forEach((signal, index) => {
    if (signal.memberId === currentMemberId) return;
    const onMyEvent = watching.has(signal.eventId);
    const cabin = myGroupsByEvent.get(signal.eventId);
    if (!onMyEvent && !cabin) return;

    const member = MEMBER_INDEX.get(signal.memberId);
    if (!member) return;

    // Somebody committing to an event where you have seats going is a
    // different fact from somebody idly watching it, and it is the one worth
    // interrupting for.
    const isSeat =
      Boolean(cabin) &&
      cabin!.members.length < cabin!.capacity &&
      member.openToJetShare &&
      signal.level !== 'watching';

    out.push({
      id: `sig:${signal.eventId}:${signal.memberId}`,
      kind: isSeat ? 'seat-interest' : 'peer-interest',
      eventId: signal.eventId,
      ...(cabin ? { groupId: cabin.id } : {}),
      memberId: signal.memberId,
      createdAt: signal.createdAt,
      read: read.has(`sig:${signal.eventId}:${signal.memberId}`),
      seq: 2000 + index,
    });
  });

  // ── Standing facts about your own cabins ───────────────────────────────
  myGroups.forEach((group, index) => {
    const push = (kind: NotificationKind, suffix: string): void => {
      const id = `grp:${group.id}:${suffix}`;
      out.push({
        id,
        kind,
        eventId: group.eventId,
        groupId: group.id,
        createdAt: group.createdAt,
        read: read.has(id),
        seq: 1000 + index,
      });
    };
    if (group.status === 'locked' || group.members.length >= group.capacity) {
      push('group-full', 'full');
    } else if (group.jet) {
      push('group-chartered', `jet:${group.jet.id}`);
    } else if (group.members.length >= group.quorum) {
      push('group-quorum', `quorum:${group.quorum}`);
    }
  });

  return out.sort((a, b) => b.seq - a.seq).slice(0, MAX_FEED);
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationCopy {
  /** One line, sentence case, no exclamation. */
  title: string;
  /** The context underneath — where and when. */
  detail: string;
}

/** House voice: state the fact, name the person, name the place. */
export function describeNotification(n: ActivityNotification): NotificationCopy {
  const event = EVENT_INDEX.get(n.eventId);
  const member = n.memberId ? MEMBER_INDEX.get(n.memberId) : undefined;
  const eventName = event?.name ?? 'an event';
  const where = event ? `${event.city} · ${event.start.slice(0, 10)}` : '';

  switch (n.kind) {
    case 'seat-interest':
      return {
        title: `${member?.name ?? 'A member'} is going to ${eventName}`,
        detail: member?.aircraft
          ? `${member.homeBase.city} · flies a ${member.aircraft} · your cabin has room`
          : `${member?.homeBase.city ?? where} · open to sharing · your cabin has room`,
      };
    case 'peer-interest':
      return {
        title: `${member?.name ?? 'A member'} signalled on ${eventName}`,
        detail: member ? `${member.homeBase.city} · ${member.homeBase.homeJetPort}` : where,
      };
    case 'group-quorum':
      return {
        title: `Your cabin to ${eventName} has quorum`,
        detail: 'Enough people to justify the charter. The aircraft is the next decision',
      };
    case 'group-chartered':
      return {
        title: `The aircraft is held for ${eventName}`,
        detail: 'Your cabin is chartered. Per-seat is fixed from here',
      };
    case 'group-full':
      return {
        title: `Your cabin to ${eventName} is full`,
        detail: 'Manifest closed',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The feed, live.
 *
 * Follows the selector discipline in `components/social/hooks.ts`: every
 * `useSocialStore` call selects a stable reference or a primitive, and the
 * derivation happens in a `useMemo` keyed on those. Building the array inside
 * the selector would re-render on every store write.
 */
export function useActivityFeed(): ActivityNotification[] {
  const currentMemberId = useSocialStore((s) => s.currentMember.id);
  const interests = useSocialStore((s) => s.interests);
  const groups = useSocialStore((s) => s.groups);
  const dripRevealed = useSocialStore((s) => s.dripRevealed);
  const readIds = useSocialStore((s) => s.readActivityIds);

  return useMemo(
    () => buildActivityFeed({ currentMemberId, interests, groups, dripRevealed, readIds }),
    [currentMemberId, interests, groups, dripRevealed, readIds],
  );
}

/** Unread count for the masthead mark. */
export function useUnreadActivityCount(): number {
  const feed = useActivityFeed();
  return useMemo(() => feed.reduce((n, item) => n + (item.read ? 0 : 1), 0), [feed]);
}
