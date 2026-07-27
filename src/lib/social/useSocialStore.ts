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
import {
  countUnread,
  mergeThread,
  nextSentAt,
  readWatermark,
  type ChatMessage,
} from './chat';
import { MEMBER_INDEX, YOU, type MemberDossier } from './members';
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

/** An address the user has invited before. Offered back as a suggestion. */
export interface SavedContact {
  email: string;
  /** Whatever they typed alongside it, if anything. */
  label?: string;
  /** ISO 8601. Most recent first when suggested. */
  lastUsedAt: string;
}

/** A member the user has asked onto a specific trip. */
export interface MemberAsk {
  memberId: string;
  eventId: string;
  groupId?: string;
  /** ISO 8601. */
  at: string;
}

const USER_GROUP_PREFIX = 'usr-';

/** More than this and the suggestion list stops being a shortcut. */
const MAX_CONTACTS = 40;

/**
 * Read marks are kept per notification id. Bounded, because the drip runs for
 * as long as the tab is open and the feed itself only ever shows two dozen.
 */
const MAX_READ_MARKS = 300;

/**
 * Invitations a member may extend to people who are not in the club, per year.
 *
 * Three. This is the product: you are not signed up, you are vouched in, and
 * the person who vouches for you spends something they cannot get back until
 * next year. An unlimited invite button would make the register worthless
 * inside a season.
 */
export const INVITE_ALLOWANCE = 3;

const isUserGroup = (g: TravelGroup): boolean => g.id.startsWith(USER_GROUP_PREFIX);

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

/** Long enough for a real logistical paragraph, short enough not to be a memo. */
const MAX_MESSAGE_CHARS = 600;

/**
 * Disambiguates two messages sent inside the same millisecond. Session-local
 * and never persisted — ids only need to be unique within a thread.
 */
let outboundSeq = 0;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

interface SocialState {
  /** False until `persist` has read localStorage. Gate any saved-state UI. */
  hydrated: boolean;

  /** The signed-in member. Editable; persisted. Carries their own photograph. */
  currentMember: MemberDossier;
  /** The user's own signals only. Peers live in the simulation. */
  interests: InterestSignal[];
  /** Simulated groups (with the user's joins applied) plus user-created ones. */
  groups: TravelGroup[];
  /** How many withheld peer signals the live drip has released this session. */
  dripRevealed: number;

  /**
   * The user's own messages, every cabin, flat and persisted. The simulated
   * side of each thread is regenerated from `chat.ts` and never stored — same
   * rule as the peers themselves.
   */
  myMessages: ChatMessage[];
  /** groupId → `sentAt` of the newest message the user has seen. Persisted. */
  lastReadAt: Record<string, string>;

  /** Addresses this member has invited before. Never leaves the device. */
  contacts: SavedContact[];
  /**
   * Members the user has asked onto a trip. There is no server to deliver an
   * invitation, so this is exactly what it says it is: a note to themselves
   * about who they have already approached, and the UI describes it that way.
   */
  asks: MemberAsk[];
  /** Ids of activity notifications the member has already seen. */
  readActivityIds: string[];
  /**
   * Invitations left to extend to people outside the club this year. Asking an
   * existing member onto a cabin is free; bringing somebody new in is not.
   */
  invitesRemaining: number;
  /** The year `invitesRemaining` was last replenished for. */
  invitesYear: number;

  // ── Mutations ─────────────────────────────────────────────────────────
  setInterest: (eventId: string, level: InterestLevel, note?: string) => void;
  clearInterest: (eventId: string) => void;

  createGroup: (eventId: string, premise: string, capacity: number) => TravelGroup | null;
  joinGroup: (groupId: string) => void;
  leaveGroup: (groupId: string) => void;
  /** Selecting the aircraft is what moves a group to `chartered`. */
  chooseJet: (groupId: string, jet: JetOption | undefined) => void;

  updateProfile: (
    patch: Partial<Pick<MemberDossier, 'name' | 'homeBase' | 'interests' | 'bio' | 'photoUrl'>>,
  ) => void;
  /**
   * Set or clear the user's own portrait. Expects a `data:` URI already
   * downscaled by `readImageAsPortrait` — this does not resize, and a full-size
   * photograph here will exhaust the storage quota on the next write.
   */
  setPhoto: (dataUri: string | null) => void;

  /** Remember addresses the user has invited, so they need typing once. */
  rememberContacts: (emails: readonly string[]) => void;
  forgetContact: (email: string) => void;
  /** Note that the user asked specific members onto a trip. Local record only. */
  noteAsks: (memberIds: readonly string[], eventId: string, groupId?: string) => void;
  /** Mark specific notifications read. */
  markActivityRead: (ids: readonly string[]) => void;
  /**
   * Spend invitations on people outside the club. Returns how many were
   * actually spent — never more than remain, so the caller can tell the member
   * the truth rather than silently sending fewer.
   */
  spendInvites: (count: number) => number;
  revealNextPeer: () => void;
  reset: () => void;

  // ── Conversation ──────────────────────────────────────────────────────
  /** Append the user's own message to a cabin thread. Returns what was sent. */
  sendMessage: (groupId: string, body: string) => ChatMessage | null;
  /** Clear the unread count for a cabin. Idempotent. */
  markRead: (groupId: string) => void;

  // ── Derived ───────────────────────────────────────────────────────────
  interestFor: (eventId: string) => InterestLevel | null;
  peerCountFor: (eventId: string) => number;
  groupsFor: (eventId: string) => TravelGroup[];
  membersInterestedIn: (eventId: string) => Member[];
  peerSignalsFor: (eventId: string) => InterestSignal[];
  myGroupFor: (eventId: string) => TravelGroup | undefined;
  isInGroup: (groupId: string) => boolean;
  myItinerary: () => ScoredEventLite[];
  /** Seeded thread plus the user's own messages, merged in time order. */
  messagesFor: (groupId: string) => ChatMessage[];
  /** Messages newer than the user's last read, excluding their own. */
  unreadFor: (groupId: string) => number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted shape
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'meridian.social';
const STORAGE_VERSION = 4;

interface PersistedV2 {
  currentMember: MemberDossier;
  interests: InterestSignal[];
  /** Only groups the user created — simulated ones are regenerated. */
  userGroups: TravelGroup[];
  /** Ids of simulated groups the user has joined. */
  joinedGroupIds: string[];
}

/** v3 adds the conversation. Still only ever the user's own authorship. */
interface PersistedV3 extends PersistedV2 {
  myMessages: ChatMessage[];
  lastReadAt: Record<string, string>;
}

/**
 * v4 adds the member's own photograph — it rides along inside `currentMember`,
 * so nothing new is needed for it here — plus the two things invitations
 * generate: addresses they have written to, and members they have asked.
 */
interface PersistedV4 extends PersistedV3 {
  contacts: SavedContact[];
  asks: MemberAsk[];
  readActivityIds: string[];
  invitesRemaining: number;
  invitesYear: number;
}

/** What actually goes to disk. */
type Persisted = PersistedV4;

/**
 * A stored photo is a `data:` URI the user chose, but localStorage is editable
 * by anyone with a console, and `photoUrl` goes straight into an `<img src>`.
 * Anything that is not a data image URI or an https URL is dropped on the way
 * back in — this is the one field in the persisted shape that becomes markup.
 */
function sanitizePhoto(member: MemberDossier): MemberDossier {
  const url = member.photoUrl;
  if (!url) return member;
  if (/^(data:image\/(png|jpeg|webp|gif|avif);|https:\/\/)/.test(url)) return member;
  const { photoUrl: _dropped, ...rest } = member;
  return rest;
}

function sanitizeContacts(raw: unknown): SavedContact[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedContact[] = [];
  for (const r of raw as unknown[]) {
    if (!r || typeof r !== 'object') continue;
    const c = r as Partial<SavedContact>;
    if (typeof c.email !== 'string' || !c.email.includes('@')) continue;
    out.push({
      email: c.email,
      ...(typeof c.label === 'string' ? { label: c.label } : {}),
      lastUsedAt: typeof c.lastUsedAt === 'string' ? c.lastUsedAt : new Date(0).toISOString(),
    });
  }
  return out.slice(0, MAX_CONTACTS);
}

/**
 * The allowance as of right now. Called only from `merge`, which runs inside
 * the rehydration effect — never during a server render.
 */
function resolveAllowance(
  remaining: unknown,
  year: unknown,
): { invitesRemaining: number; invitesYear: number } {
  const now = new Date().getUTCFullYear();
  if (typeof remaining !== 'number' || year !== now) {
    return { invitesRemaining: INVITE_ALLOWANCE, invitesYear: now };
  }
  return { invitesRemaining: clampInt(remaining, 0, INVITE_ALLOWANCE), invitesYear: now };
}

function sanitizeAsks(raw: unknown): MemberAsk[] {
  if (!Array.isArray(raw)) return [];
  const out: MemberAsk[] = [];
  for (const r of raw as unknown[]) {
    if (!r || typeof r !== 'object') continue;
    const a = r as Partial<MemberAsk>;
    if (typeof a.memberId !== 'string' || typeof a.eventId !== 'string') continue;
    out.push({
      memberId: a.memberId,
      eventId: a.eventId,
      ...(typeof a.groupId === 'string' ? { groupId: a.groupId } : {}),
      at: typeof a.at === 'string' ? a.at : new Date(0).toISOString(),
    });
  }
  return out;
}

/**
 * Anything read back off disk is untrusted — a half-written record, a shape
 * from a future build, a user who edited localStorage for fun. A malformed
 * message would render as an empty row forever, so drop it here instead.
 */
function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const r of raw as unknown[]) {
    if (!r || typeof r !== 'object') continue;
    const m = r as Partial<ChatMessage>;
    if (
      typeof m.id !== 'string' ||
      typeof m.groupId !== 'string' ||
      typeof m.memberId !== 'string' ||
      typeof m.body !== 'string' ||
      typeof m.sentAt !== 'string' ||
      m.body.trim().length === 0
    ) {
      continue;
    }
    out.push({
      id: m.id,
      groupId: m.groupId,
      memberId: m.memberId,
      body: m.body,
      sentAt: m.sentAt,
      kind: m.kind === 'system' ? 'system' : 'message',
    });
  }
  return out;
}

function sanitizeReads(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

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
      myMessages: [],
      lastReadAt: {},
      contacts: [],
      asks: [],
      readActivityIds: [],
      invitesRemaining: INVITE_ALLOWANCE,
      // Seeded from the initial state, replaced on rehydrate. Never read during
      // a server render, so the wall clock here cannot cause a mismatch.
      invitesYear: 0,

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

      setPhoto: (dataUri) =>
        set((s) => {
          const next = { ...s.currentMember };
          if (dataUri) next.photoUrl = dataUri;
          else delete next.photoUrl;
          return { currentMember: next };
        }),

      rememberContacts: (emails) =>
        set((s) => {
          const now = new Date().toISOString();
          const byEmail = new Map(s.contacts.map((c) => [c.email.toLowerCase(), c]));
          for (const raw of emails) {
            const email = raw.trim();
            if (!email) continue;
            const key = email.toLowerCase();
            const existing = byEmail.get(key);
            byEmail.set(key, { ...(existing ?? { email }), email, lastUsedAt: now });
          }
          const contacts = [...byEmail.values()]
            .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1))
            .slice(0, MAX_CONTACTS);
          return { contacts };
        }),

      forgetContact: (email) =>
        set((s) => ({
          contacts: s.contacts.filter((c) => c.email.toLowerCase() !== email.trim().toLowerCase()),
        })),

      noteAsks: (memberIds, eventId, groupId) =>
        set((s) => {
          const at = new Date().toISOString();
          const seen = new Set(s.asks.map((a) => `${a.memberId}:${a.eventId}`));
          const added: MemberAsk[] = [];
          for (const memberId of memberIds) {
            const key = `${memberId}:${eventId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            added.push({ memberId, eventId, ...(groupId ? { groupId } : {}), at });
          }
          return added.length ? { asks: [...s.asks, ...added] } : {};
        }),

      markActivityRead: (ids) =>
        set((s) => {
          if (ids.length === 0) return {};
          const next = new Set(s.readActivityIds);
          let changed = false;
          for (const id of ids) {
            if (!next.has(id)) {
              next.add(id);
              changed = true;
            }
          }
          if (!changed) return {};
          // Newest marks are the ones worth keeping when we trim.
          return { readActivityIds: [...next].slice(-MAX_READ_MARKS) };
        }),

      spendInvites: (count) => {
        const wanted = Math.max(0, Math.floor(count));
        if (wanted === 0) return 0;
        const year = new Date().getUTCFullYear();
        const s = get();
        // The allowance replenishes on the calendar year, checked lazily —
        // there is no server to run a job, so the first spend of a new year
        // is what notices.
        const available = s.invitesYear === year ? s.invitesRemaining : INVITE_ALLOWANCE;
        const spent = Math.min(wanted, available);
        set({ invitesRemaining: available - spent, invitesYear: year });
        return spent;
      },

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
          myMessages: [],
          lastReadAt: {},
          contacts: [],
          asks: [],
          readActivityIds: [],
          invitesRemaining: INVITE_ALLOWANCE,
          invitesYear: new Date().getUTCFullYear(),
        }),

      // ── Conversation ────────────────────────────────────────────────────
      sendMessage: (groupId, body) => {
        const text = body.trim().replace(/\s+\n/g, '\n').slice(0, MAX_MESSAGE_CHARS);
        if (text.length === 0) return null;
        const s = get();
        // Seeded threads run on the *event's* clock, so for a fixture eight
        // months out the whole conversation is in the future. `nextSentAt`
        // stamps the reply after the last thing said rather than dropping it
        // into the middle of the scrollback.
        const sentAt = nextSentAt(groupId, s.myMessages, Date.now());
        const message: ChatMessage = {
          id: `${groupId}:u${Date.now().toString(36)}${(outboundSeq++).toString(36)}`,
          groupId,
          memberId: s.currentMember.id,
          body: text,
          sentAt,
          kind: 'message',
        };
        set((prev) => ({
          myMessages: [...prev.myMessages, message],
          // You have, by definition, read the thread you just replied to.
          lastReadAt: { ...prev.lastReadAt, [groupId]: sentAt },
        }));
        return message;
      },

      markRead: (groupId) =>
        set((s) => {
          const at = readWatermark(mergeThread(groupId, s.myMessages), Date.now());
          // Returning the state object itself is the one way to make zustand
          // skip the notification entirely — an empty partial still allocates a
          // new state and wakes every subscriber for nothing.
          if (s.lastReadAt[groupId] === at) return s;
          return { lastReadAt: { ...s.lastReadAt, [groupId]: at } };
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

      messagesFor: (groupId) => mergeThread(groupId, get().myMessages),

      unreadFor: (groupId) => {
        const s = get();
        return countUnread(
          mergeThread(groupId, s.myMessages),
          s.lastReadAt[groupId],
          s.currentMember.id,
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
        myMessages: s.myMessages,
        lastReadAt: s.lastReadAt,
        contacts: s.contacts,
        asks: s.asks,
        readActivityIds: s.readActivityIds,
        invitesRemaining: s.invitesRemaining,
        invitesYear: s.invitesYear,
      }),

      /**
       * v1 stored the whole `groups` array, simulated cabins included, which
       * meant a dataset change stranded people on flights to events that no
       * longer existed. v2 stores only what the user authored.
       *
       * v3 adds the conversation — again, only the user's own messages and
       * their last-read marks. Every simulated line is regenerated. Both older
       * shapes forward-fill to empty, so an existing localStorage from either
       * survives the upgrade with the user's interests and cabins intact.
       */
      migrate: (persisted, version): Persisted => {
        const p = (persisted ?? {}) as Partial<PersistedV4> & { groups?: TravelGroup[] };

        const base: PersistedV2 =
          version < 2
            ? (() => {
                const all = p.groups ?? [];
                return {
                  currentMember: p.currentMember ?? YOU,
                  interests: p.interests ?? [],
                  userGroups: all.filter(isUserGroup),
                  joinedGroupIds: all.filter((g) => !isUserGroup(g)).map((g) => g.id),
                };
              })()
            : {
                currentMember: p.currentMember ?? YOU,
                interests: p.interests ?? [],
                userGroups: p.userGroups ?? [],
                joinedGroupIds: p.joinedGroupIds ?? [],
              };

        return {
          ...base,
          currentMember: sanitizePhoto(base.currentMember),
          // v2 and older simply had no conversation. Empty is correct, not a
          // loss — the seeded side of every thread comes back regardless.
          myMessages: version < 3 ? [] : sanitizeMessages(p.myMessages),
          lastReadAt: version < 3 ? {} : sanitizeReads(p.lastReadAt),
          // v3 and older had no invitations. Nothing to carry forward; the
          // member keeps their photograph, which lives inside `currentMember`.
          contacts: version < 4 ? [] : sanitizeContacts(p.contacts),
          asks: version < 4 ? [] : sanitizeAsks(p.asks),
          readActivityIds:
            version < 4 || !Array.isArray(p.readActivityIds)
              ? []
              : p.readActivityIds.filter((id): id is string => typeof id === 'string'),
          // A pre-v4 member has spent nothing, so they arrive with the full
          // allowance rather than being penalised by the upgrade.
          invitesRemaining:
            version < 4 || typeof p.invitesRemaining !== 'number'
              ? INVITE_ALLOWANCE
              : clampInt(p.invitesRemaining, 0, INVITE_ALLOWANCE),
          invitesYear: typeof p.invitesYear === 'number' ? p.invitesYear : 0,
        };
      },

      /**
       * Rebuild the live state from the persisted deltas. The simulated world
       * is always regenerated, never restored.
       */
      merge: (persisted, current): SocialState => {
        const p = (persisted ?? {}) as Partial<PersistedV4>;
        const currentMember = sanitizePhoto(p.currentMember ?? current.currentMember);
        return {
          ...current,
          currentMember,
          interests: p.interests ?? [],
          groups: composeGroups(currentMember, p.joinedGroupIds ?? [], p.userGroups ?? []),
          myMessages: sanitizeMessages(p.myMessages),
          lastReadAt: sanitizeReads(p.lastReadAt),
          contacts: sanitizeContacts(p.contacts),
          asks: sanitizeAsks(p.asks),
          readActivityIds: Array.isArray(p.readActivityIds)
            ? p.readActivityIds.filter((id): id is string => typeof id === 'string')
            : [],
          // A stored allowance from a previous calendar year is stale: the
          // member gets their three back, and `spendInvites` re-stamps the year.
          ...resolveAllowance(p.invitesRemaining, p.invitesYear),
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
