'use client';

/**
 * MERIDIAN — the social store.
 *
 * Local-first, and only local-first. There is no backend and there is not going
 * to be one, so `localStorage` is the system of record for everything the user
 * authored: who they are, what they have signalled interest in, and which
 * cabins they are on. Everything else — the peers, their signals, the groups
 * they host — is regenerated deterministically from `simulation.ts` on every
 * load and is never persisted. That keeps the payload small and means the
 * simulated world can be improved without stranding anyone's saved state.
 *
 * ── Hydration ───────────────────────────────────────────────────────────────
 * `skipHydration: true`. Nothing reads `localStorage` during the server render
 * or during React's hydration pass; the first client render is byte-identical
 * to the server's. `useSocialHydration()` kicks off rehydration in an effect
 * after mount, and components that display persisted state gate on `hydrated`.
 * This is the only way to use `persist` with the App Router without a mismatch.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { EVENT_INDEX } from '@/lib/data/events';
import type {
  EventCategory,
  InterestLevel,
  InterestSignal,
  JetOption,
  Member,
  TravelGroup,
} from '@/lib/types';
import { MEMBER_INDEX, YOU } from './members';
import { deriveStatus, getSimulation } from './simulation';

// ─────────────────────────────────────────────────────────────────────────────
// Local view types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deliberately minimal and defined here rather than imported from
 * `@/lib/selectors` — the selectors module consumes the social layer for peer
 * counts, and importing it back would close a cycle.
 */
export interface ScoredEventLite {
  eventId: string;
  name: string;
  city: string;
  country: string;
  start: string;
  end: string;
  /** The user's own commitment level. */
  level: InterestLevel;
  /** Set when the user is on a cabin for this event. */
  groupId?: string;
  /** Days from `today` to `start`. Negative once the event has begun. */
  daysUntil: number;
}

const USER_GROUP_PREFIX = 'usr-';

const isUserGroup = (g: TravelGroup): boolean => g.id.startsWith(USER_GROUP_PREFIX);

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

interface SocialState {
  /** False until `persist` has read localStorage. Gate any saved-state UI. */
  hydrated: boolean;

  /** The signed-in member. Editable; persisted. */
  currentMember: Member;
  /** The user's own signals only. Peers live in the simulation. */
  interests: InterestSignal[];
  /** Simulated groups (with the user's joins applied) plus user-created ones. */
  groups: TravelGroup[];
  /** How many withheld peer signals the live drip has released this session. */
  dripRevealed: number;

  // ── Mutations ─────────────────────────────────────────────────────────
  setInterest: (eventId: string, level: InterestLevel, note?: string) => void;
  clearInterest: (eventId: string) => void;

  createGroup: (eventId: string, premise: string, capacity: number) => TravelGroup | null;
  joinGroup: (groupId: string) => void;
  leaveGroup: (groupId: string) => void;
  /** Selecting the aircraft is what moves a group to `chartered`. */
  chooseJet: (groupId: string, jet: JetOption | undefined) => void;

  updateProfile: (patch: Partial<Pick<Member, 'name' | 'homeBase' | 'interests' | 'bio'>>) => void;
  revealNextPeer: () => void;
  reset: () => void;

  // ── Derived ───────────────────────────────────────────────────────────
  interestFor: (eventId: string) => InterestLevel | null;
  peerCountFor: (eventId: string) => number;
  groupsFor: (eventId: string) => TravelGroup[];
  membersInterestedIn: (eventId: string) => Member[];
  peerSignalsFor: (eventId: string) => InterestSignal[];
  myGroupFor: (eventId: string) => TravelGroup | undefined;
  isInGroup: (groupId: string) => boolean;
  myItinerary: () => ScoredEventLite[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted shape
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'meridian.social';
const STORAGE_VERSION = 2;

interface PersistedV2 {
  currentMember: Member;
  interests: InterestSignal[];
  /** Only groups the user created — simulated ones are regenerated. */
  userGroups: TravelGroup[];
  /** Ids of simulated groups the user has joined. */
  joinedGroupIds: string[];
}

/** What actually goes to disk. */
type Persisted = PersistedV2;

/**
 * Rebuild the live `groups` array: the simulation, with the user grafted onto
 * whichever cabins they had joined, plus anything they created themselves.
 * Simulated group ids are stable across dataset edits only for events that
 * still exist, so a join pointing at a vanished group is silently dropped.
 */
function composeGroups(
  currentMember: Member,
  joinedGroupIds: readonly string[],
  userGroups: readonly TravelGroup[],
): TravelGroup[] {
  const joined = new Set(joinedGroupIds);
  const base = getSimulation().groups.map((g) => {
    if (!joined.has(g.id)) return { ...g, members: [...g.members] };
    if (g.members.some((m) => m.memberId === currentMember.id)) {
      return { ...g, members: [...g.members] };
    }
    const members = [
      ...g.members,
      { memberId: currentMember.id, role: 'member' as const, joinedAt: new Date(0).toISOString() },
    ].slice(0, g.capacity);
    const next = { ...g, members };
    return { ...next, status: deriveStatus(next) };
  });
  return [...base, ...userGroups.map((g) => ({ ...g, members: [...g.members] }))];
}

/** Peer signals released by the drip so far, grouped by event. */
function revealedDrip(count: number): Map<string, InterestSignal[]> {
  const out = new Map<string, InterestSignal[]>();
  if (count <= 0) return out;
  const queue = getSimulation().dripQueue;
  for (let i = 0; i < Math.min(count, queue.length); i++) {
    const s = queue[i]!;
    const list = out.get(s.eventId);
    if (list) list.push(s);
    else out.set(s.eventId, [s]);
  }
  return out;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const daysFromToday = (iso: string): number =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86_400_000);

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useSocialStore = create<SocialState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      currentMember: YOU,
      interests: [],
      // Built lazily on first read of the simulation. On the server this is the
      // same value the client computes, so the initial render matches.
      groups: composeGroups(YOU, [], []),
      dripRevealed: 0,

      // ── Interest ────────────────────────────────────────────────────────
      setInterest: (eventId, level, note) =>
        set((s) => {
          const now = new Date().toISOString();
          const existing = s.interests.find((i) => i.eventId === eventId);
          const signal: InterestSignal = {
            eventId,
            memberId: s.currentMember.id,
            level,
            createdAt: existing?.createdAt ?? now,
            ...(note ? { note } : existing?.note ? { note: existing.note } : {}),
          };
          return {
            interests: existing
              ? s.interests.map((i) => (i.eventId === eventId ? signal : i))
              : [...s.interests, signal],
          };
        }),

      clearInterest: (eventId) =>
        set((s) => ({ interests: s.interests.filter((i) => i.eventId !== eventId) })),

      // ── Groups ──────────────────────────────────────────────────────────
      createGroup: (eventId, premise, capacity) => {
        const me = get().currentMember;
        const event = EVENT_INDEX.get(eventId);
        if (!event) return null;

        const cap = clampInt(capacity, 2, 25);
        const group: TravelGroup = {
          id: `${USER_GROUP_PREFIX}${eventId}-${Date.now().toString(36)}`,
          eventId,
          name: `${me.homeBase.homeJetPort} Cabin`,
          premise: premise.trim().slice(0, 200),
          members: [
            { memberId: me.id, role: 'host', joinedAt: new Date().toISOString() },
          ],
          status: 'forming',
          capacity: cap,
          quorum: clampInt(Math.ceil(cap * 0.5), 2, Math.min(8, cap)),
          departureHub: me.homeBase.homeJetPort,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ groups: [...s.groups, group] }));
        // Hosting is a commitment. Say so.
        get().setInterest(eventId, 'committed');
        return group;
      },

      joinGroup: (groupId) =>
        set((s) => {
          const me = s.currentMember;
          const groups = s.groups.map((g) => {
            if (g.id !== groupId) return g;
            if (g.members.some((m) => m.memberId === me.id)) return g;
            if (g.members.length >= g.capacity || g.status === 'locked') return g;
            const next: TravelGroup = {
              ...g,
              members: [
                ...g.members,
                { memberId: me.id, role: 'member' as const, joinedAt: new Date().toISOString() },
              ],
            };
            return { ...next, status: deriveStatus(next) };
          });
          const target = groups.find((g) => g.id === groupId);
          if (!target || !target.members.some((m) => m.memberId === me.id)) {
            return { groups };
          }
          // Joining a cabin is committing to the event, by definition.
          const existing = s.interests.find((i) => i.eventId === target.eventId);
          const interests: InterestSignal[] = existing
            ? s.interests.map((i) =>
                i.eventId === target.eventId ? { ...i, level: 'committed' as const } : i,
              )
            : [
                ...s.interests,
                {
                  eventId: target.eventId,
                  memberId: me.id,
                  level: 'committed' as const,
                  createdAt: new Date().toISOString(),
                },
              ];
          return { groups, interests };
        }),

      leaveGroup: (groupId) =>
        set((s) => {
          const me = s.currentMember;
          const target = s.groups.find((g) => g.id === groupId);
          // Leaving a cabin you created dissolves it — there is no one to hand
          // it to and an empty group on the board is noise.
          if (target && isUserGroup(target) && target.members[0]?.memberId === me.id) {
            return { groups: s.groups.filter((g) => g.id !== groupId) };
          }
          return {
            groups: s.groups.map((g) => {
              if (g.id !== groupId) return g;
              const next: TravelGroup = {
                ...g,
                members: g.members.filter((m) => m.memberId !== me.id),
              };
              return { ...next, status: deriveStatus(next) };
            }),
          };
        }),

      chooseJet: (groupId, jet) =>
        set((s) => ({
          groups: s.groups.map((g) => {
            if (g.id !== groupId) return g;
            const next: TravelGroup = jet
              ? { ...g, jet, capacity: Math.min(g.capacity, jet.seats) }
              : { ...g, jet: undefined };
            return { ...next, status: deriveStatus(next) };
          }),
        })),

      // ── Profile ─────────────────────────────────────────────────────────
      updateProfile: (patch) =>
        set((s) => ({ currentMember: { ...s.currentMember, ...patch } })),

      revealNextPeer: () =>
        set((s) => ({
          dripRevealed: Math.min(s.dripRevealed + 1, getSimulation().dripQueue.length),
        })),

      reset: () =>
        set({
          currentMember: YOU,
          interests: [],
          groups: composeGroups(YOU, [], []),
          dripRevealed: 0,
        }),

      // ── Derived ─────────────────────────────────────────────────────────
      interestFor: (eventId) =>
        get().interests.find((i) => i.eventId === eventId)?.level ?? null,

      peerSignalsFor: (eventId) => {
        const base = getSimulation().signalsByEvent.get(eventId) ?? [];
        const extra = revealedDrip(get().dripRevealed).get(eventId) ?? [];
        return extra.length ? [...extra, ...base] : [...base];
      },

      peerCountFor: (eventId) => get().peerSignalsFor(eventId).length,

      membersInterestedIn: (eventId) => {
        const me = get().currentMember.id;
        const seen = new Set<string>();
        const out: Member[] = [];
        for (const s of get().peerSignalsFor(eventId)) {
          if (s.memberId === me || seen.has(s.memberId)) continue;
          seen.add(s.memberId);
          const m = MEMBER_INDEX.get(s.memberId);
          if (m) out.push(m);
        }
        return out;
      },

      groupsFor: (eventId) => get().groups.filter((g) => g.eventId === eventId),

      myGroupFor: (eventId) => {
        const me = get().currentMember.id;
        return get().groups.find(
          (g) => g.eventId === eventId && g.members.some((m) => m.memberId === me),
        );
      },

      isInGroup: (groupId) => {
        const me = get().currentMember.id;
        return Boolean(
          get()
            .groups.find((g) => g.id === groupId)
            ?.members.some((m) => m.memberId === me),
        );
      },

      myItinerary: () => {
        const { interests, groups, currentMember } = get();
        const byEvent = new Map<string, ScoredEventLite>();

        for (const i of interests) {
          const e = EVENT_INDEX.get(i.eventId);
          if (!e) continue;
          byEvent.set(e.id, {
            eventId: e.id,
            name: e.name,
            city: e.city,
            country: e.country,
            start: e.start,
            end: e.end,
            level: i.level,
            daysUntil: daysFromToday(e.start),
          });
        }

        for (const g of groups) {
          if (!g.members.some((m) => m.memberId === currentMember.id)) continue;
          const e = EVENT_INDEX.get(g.eventId);
          if (!e) continue;
          const existing = byEvent.get(e.id);
          byEvent.set(e.id, {
            ...(existing ?? {
              eventId: e.id,
              name: e.name,
              city: e.city,
              country: e.country,
              start: e.start,
              end: e.end,
              level: 'committed' as const,
              daysUntil: daysFromToday(e.start),
            }),
            level: 'committed',
            groupId: g.id,
          });
        }

        return [...byEvent.values()].sort((a, b) =>
          a.start === b.start ? a.name.localeCompare(b.name) : a.start < b.start ? -1 : 1,
        );
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Nothing touches storage until `useSocialHydration()` says so.
      skipHydration: true,

      partialize: (s): Persisted => ({
        currentMember: s.currentMember,
        interests: s.interests,
        userGroups: s.groups.filter(isUserGroup),
        joinedGroupIds: s.groups
          .filter((g) => !isUserGroup(g) && g.members.some((m) => m.memberId === s.currentMember.id))
          .map((g) => g.id),
      }),

      /**
       * v1 stored the whole `groups` array, simulated cabins included, which
       * meant a dataset change stranded people on flights to events that no
       * longer existed. v2 stores only what the user authored.
       */
      migrate: (persisted, version): Persisted => {
        const p = (persisted ?? {}) as Partial<PersistedV2> & { groups?: TravelGroup[] };
        if (version < 2) {
          const all = p.groups ?? [];
          return {
            currentMember: p.currentMember ?? YOU,
            interests: p.interests ?? [],
            userGroups: all.filter(isUserGroup),
            joinedGroupIds: all.filter((g) => !isUserGroup(g)).map((g) => g.id),
          };
        }
        return {
          currentMember: p.currentMember ?? YOU,
          interests: p.interests ?? [],
          userGroups: p.userGroups ?? [],
          joinedGroupIds: p.joinedGroupIds ?? [],
        };
      },

      /**
       * Rebuild the live state from the persisted deltas. The simulated world
       * is always regenerated, never restored.
       */
      merge: (persisted, current): SocialState => {
        const p = (persisted ?? {}) as Partial<PersistedV2>;
        const currentMember = p.currentMember ?? current.currentMember;
        return {
          ...current,
          currentMember,
          interests: p.interests ?? [],
          groups: composeGroups(currentMember, p.joinedGroupIds ?? [], p.userGroups ?? []),
        };
      },

      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('[meridian] social state failed to rehydrate', error);
        useSocialStore.setState({ hydrated: true });
      },
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Hydration
// ─────────────────────────────────────────────────────────────────────────────

let rehydrationStarted = false;

/**
 * Call from any client component that displays persisted state. Idempotent —
 * the first caller triggers the read, everyone else just subscribes to the
 * flag. Returns `false` until localStorage has been applied, which is the
 * signal to render the neutral, server-identical version of the UI.
 */
export function useSocialHydration(): boolean {
  const hydrated = useSocialStore((s) => s.hydrated);
  useEffect(() => {
    if (rehydrationStarted) return;
    rehydrationStarted = true;
    void useSocialStore.persist.rehydrate();
  }, []);
  return hydrated;
}

/** Non-reactive read, for anything outside React. */
export const socialSnapshot = (): SocialState => useSocialStore.getState();
