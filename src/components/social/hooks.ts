'use client';

import { useMemo } from 'react';

import { socialSnapshot, useSocialStore } from '@/lib/social/useSocialStore';
import type { InterestLevel, Member, TravelGroup } from '@/lib/types';

/**
 * Selector discipline for the social components.
 *
 * zustand 5 compares selector results with `Object.is`, so a selector that
 * builds a new array on every call re-renders on every store write and trips
 * React's `getSnapshot should be cached` warning. The rule in this directory
 * is therefore: **select stable references or primitives, derive with
 * `useMemo`**. These hooks are the sanctioned way to do that, and components
 * should not call `useSocialStore` with a deriving selector directly.
 */

/** Peers signalling on an event, ordered as the simulation produced them. */
export function usePeers(eventId: string): Member[] {
  const drip = useSocialStore((s) => s.dripRevealed);
  const meId = useSocialStore((s) => s.currentMember.id);
  return useMemo(
    () => socialSnapshot().membersInterestedIn(eventId),
    // `membersInterestedIn` reads the drip pointer and the current member off
    // the snapshot; both are in the dep list so the memo tracks them.
    [eventId, drip, meId],
  );
}

/** Peer count including anything the live drip has released. */
export function usePeerCount(eventId: string): number {
  const drip = useSocialStore((s) => s.dripRevealed);
  return useMemo(() => socialSnapshot().peerCountFor(eventId), [eventId, drip]);
}

/** Every cabin on an event — simulated and user-created. */
export function useGroupsFor(eventId: string): TravelGroup[] {
  const groups = useSocialStore((s) => s.groups);
  return useMemo(() => groups.filter((g) => g.eventId === eventId), [groups, eventId]);
}

/** The cabin the user is on for this event, if any. */
export function useMyGroupFor(eventId: string): TravelGroup | undefined {
  const groups = useSocialStore((s) => s.groups);
  const meId = useSocialStore((s) => s.currentMember.id);
  return useMemo(
    () =>
      groups.find(
        (g) => g.eventId === eventId && g.members.some((m) => m.memberId === meId),
      ),
    [groups, eventId, meId],
  );
}

/** The user's own commitment level on an event. */
export function useInterestLevel(eventId: string): InterestLevel | null {
  const interests = useSocialStore((s) => s.interests);
  return useMemo(
    () => interests.find((i) => i.eventId === eventId)?.level ?? null,
    [interests, eventId],
  );
}
