/**
 * MERIDIAN — the simulated club.
 *
 * A map with nobody on it is a mockup. This module is the difference between
 * MERIDIAN reading as a product and reading as a demo: it decides, for every
 * event in the dataset, which members are watching it, which are going, and who
 * has already put a cabin together.
 *
 * Three properties matter more than realism:
 *
 *   1. DETERMINISM. Everything is seeded from stable strings. The same member
 *      is interested in the same event on the server render, on hydration, and
 *      after a hard refresh next Tuesday. There is no `Math.random()` and no
 *      `Date.now()` on any path that feeds a render — timestamps are derived
 *      from the event's own start date, so they never drift between renders.
 *
 *   2. CORRELATION. Volume tracks the event's own buzz signals. A legendary
 *      fixture with two million mentions draws thirty members. A sealed insider
 *      festival draws three — and three is the *point*, not a failure. Members'
 *      declared interests bias which events they signal on, and their home base
 *      biases toward geographically sensible choices, with deliberate
 *      exceptions, because these people fly.
 *
 *   3. RESTRAINT. Nobody is interested in everything. The tail is long and most
 *      events have a handful of names on them, because that is what an
 *      exclusive membership actually looks like.
 */

import { EVENTS } from '@/lib/data/events';
import { greatCircleDistanceNm } from '@/lib/geo/projection';
import type {
  EventCategory,
  GroupMembership,
  GroupStatus,
  InterestLevel,
  InterestSignal,
  Member,
  TravelGroup,
  WorldEvent,
} from '@/lib/types';
import { JETS, JET_INDEX } from './charter';
import { MEMBERS } from './members';
import { clamp, makeRng, type Rng } from './rng';

// ─────────────────────────────────────────────────────────────────────────────
// Shape
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulatedWorld {
  /** Every baseline peer signal, flat. */
  signals: readonly InterestSignal[];
  signalsByEvent: ReadonlyMap<string, readonly InterestSignal[]>;
  /** eventId → number of distinct peers signalling. */
  peerCounts: Readonly<Record<string, number>>;
  groups: readonly TravelGroup[];
  groupsByEvent: ReadonlyMap<string, readonly TravelGroup[]>;
  /**
   * Signals held back from the baseline and released one at a time while the
   * app is open, so the club looks inhabited rather than photographed. Never
   * consumed automatically — the store owns the pointer.
   */
  dripQueue: readonly InterestSignal[];
}

/** The salt for the whole world. Change it and every peer moves. */
export const WORLD_SEED = 'meridian.social.v1';

// ─────────────────────────────────────────────────────────────────────────────
// Demand → volume
// ─────────────────────────────────────────────────────────────────────────────

/** Peer counts sit inside this band whatever the dataset does. */
const MIN_PEERS = 2;
const MAX_PEERS = 34;

const TIER_VOLUME: Record<WorldEvent['tier'], number> = {
  legendary: 1.15,
  marquee: 1.0,
  /** Not that nobody wants to go. That few people know. */
  insider: 0.62,
};

const TIER_RANK: Record<Member['tier'], number> = {
  founding: 1,
  signature: 0.6,
  charter: 0.3,
};

const log1p10 = (n: number): number => Math.log10(1 + Math.max(0, n));

/**
 * Composite demand, then percentile rank within the set.
 *
 * Ranking rather than absolute thresholds is deliberate: the curated dataset is
 * authored in parallel and we do not know what scale its `socialMentions` will
 * land on. A percentile is stable whether the biggest event has 40,000 mentions
 * or 4,000,000.
 */
function demandPercentiles(events: readonly WorldEvent[]): Map<string, number> {
  const raw = events.map((e) => {
    const s = e.signals;
    return {
      id: e.id,
      v:
        0.55 * log1p10(s.socialMentions) * 1.0 +
        0.27 * (clamp(s.searchInterest, 0, 100) / 100) * 6 +
        0.18 * log1p10(s.mediaMentions) * 1.3,
    };
  });
  const sorted = [...raw].sort((a, b) => a.v - b.v);
  const out = new Map<string, number>();
  const n = Math.max(1, sorted.length - 1);
  sorted.forEach((row, i) => out.set(row.id, i / n));
  return out;
}

/**
 * How many members signal on this event.
 *
 * The floor is additive, not multiplicative: `MIN_PEERS` is added *before* the
 * tier and exclusivity damping rather than clamped afterwards. Damping a whole
 * curve down onto a floor makes every insider event look identical — two peers,
 * always — which is worse than a small number, it is a flat number. Adding the
 * floor and scaling only the variable part gives insiders a real 2–7 spread
 * while still keeping them an order of magnitude below the legendary fixtures.
 */
function targetPeerCount(event: WorldEvent, pct: number, rng: Rng): number {
  const variable = 31 * Math.pow(pct, 1.75);
  // A sealed guest list suppresses public signalling — you do not announce that
  // you are going to something you had to be asked to.
  const exclusivityDamp = 1 - 0.5 * clamp(event.signals.exclusivity, 0, 1);
  const jitter = 0.85 + rng.bell() * 0.34;
  const n = MIN_PEERS + variable * exclusivityDamp * TIER_VOLUME[event.tier] * jitter;
  return Math.round(clamp(n, MIN_PEERS, MAX_PEERS));
}

// ─────────────────────────────────────────────────────────────────────────────
// Member ↔ event affinity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much this member wants to be at this event.
 *
 * Declared interests dominate; proximity is a real but secondary pull — the
 * whole premise of the product is that distance is a cost, not a barrier. The
 * noise term is wide on purpose, and a small wildcard bonus makes sure the
 * Tokyo member sometimes turns up at a Patagonia gala, because they do.
 */
function affinity(member: Member, event: WorldEvent, rng: Rng): number {
  let score = 0.6; // baseline: everyone here travels

  const interests = member.interests;
  if (interests.includes(event.category)) score += 3.2;
  for (const c of event.secondaryCategories ?? []) {
    if (interests.includes(c)) score += 1.05;
  }

  const distance = greatCircleDistanceNm(member.homeBase.coords, event.coords);
  // 2,600 nm is roughly "same continent". Decays smoothly rather than cutting.
  score += 2.1 * Math.exp(-distance / 2600);

  // Owning the aircraft materially changes how far you will go for a weekend.
  if (member.aircraft && distance > 1800) score += 0.6;
  if (member.openToJetShare) score += 0.3;

  // Founding members skew toward the sealed end of the calendar.
  score += TIER_RANK[member.tier] * clamp(event.signals.exclusivity, 0, 1) * 1.1;

  // Price tolerance. Charter-tier members thin out at priceIndex 5.
  score -= (event.priceIndex - 3) * (1 - TIER_RANK[member.tier]) * 0.35;

  // Wildcards: one in eight signals is somebody flying a very long way for
  // something that is not obviously "theirs".
  if (rng.chance(0.12)) score += 2.4;

  return score + (rng.bell() - 0.4) * 2.6;
}

// ─────────────────────────────────────────────────────────────────────────────
// Levels, notes, timestamps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escalation is rare. Most signals are "watching", because most of the time
 * that is the truth — the ladder only means something if the top rung is thin.
 */
function levelFor(rank: number, total: number, event: WorldEvent, rng: Rng): InterestLevel {
  const pressure = clamp(event.signals.bookingPressure, 0, 1);
  const committedShare = 0.08 + 0.16 * pressure;
  const interestedShare = committedShare + 0.28;
  const p = total <= 1 ? 0 : rank / (total - 1);
  const wobble = (rng.float() - 0.5) * 0.14;
  if (p + wobble < committedShare) return 'committed';
  if (p + wobble < interestedShare) return 'interested';
  return 'watching';
}

const NOTES_BY_LEVEL: Record<InterestLevel, readonly string[]> = {
  watching: [
    'Depends entirely on whether the boat is out of the yard in time',
    'Third year of saying maybe',
    'Watching the ramp situation before anyone gets excited',
    'Will decide when I see who else is going',
    'Only if I can be back by Monday',
    'Told myself I would skip a year. We shall see',
  ],
  interested: [
    'In, if there is a cabin going from this side of the Atlantic',
    'Have the house from the Wednesday — happy to put people in it',
    'Would go for the Thursday and the Sunday, nothing in between',
    'Looking for four seats, not eight. Ask me',
    'Yes, provided nobody organises a dinner',
    'Keen. Less keen on the hotel situation',
  ],
  committed: [
    'Booked. Two seats spare if the timing suits anyone',
    'Going regardless. Cabin has room',
    'Confirmed — same arrangement as last year',
    'In. Bringing the same three people and no others',
    'Done. Wheels up Thursday morning',
  ],
};

/**
 * Timestamps are derived from the event's own start date, never from the wall
 * clock. That keeps them stable across renders and reads correctly — people
 * signal interest in the months before a fixture, not at a random moment in
 * history.
 */
function signalTimestamp(event: WorldEvent, level: InterestLevel, rng: Rng): string {
  const lead =
    level === 'committed'
      ? rng.int(20, 120)
      : level === 'interested'
        ? rng.int(30, 200)
        : rng.int(45, 300);
  const t = Date.parse(`${event.start}T00:00:00.000Z`) - lead * 86_400_000;
  const hour = rng.int(7, 22);
  const minute = rng.int(0, 59);
  const d = new Date(t);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Groups
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_NAME_FORMS: readonly ((ctx: NameCtx) => string)[] = [
  (c) => `${c.hub} Cabin`,
  (c) => `The ${c.day} Manifest`,
  (c) => `${c.seats} Seats to ${c.city}`,
  (c) => `Long Weekend — ${c.city}`,
  (c) => `${c.hub} → ${c.port}`,
  (c) => `The ${c.city} Party`,
  (c) => `${c.day} Out, ${c.dayBack} Back`,
  (c) => `Manifest ${c.seats}`,
];

interface NameCtx {
  hub: string;
  port: string;
  city: string;
  seats: number;
  day: string;
  dayBack: string;
}

const PREMISES: readonly ((c: PremiseCtx) => string)[] = [
  (c) => `Wheels up ${c.day} from ${c.hub}, back ${c.dayBack}. I have the house for the week and there are rooms going.`,
  (c) => `Flying anyway. I would rather split the cabin than look at empty seats for ${c.hours} hours.`,
  (c) => `${c.jet} out of ${c.hub}. Three nights, no schedule beyond ${c.event} itself. That is the entire pitch.`,
  (c) => `Same crowd as last year, minus the two who wanted photographs. ${c.hub} ${c.day}.`,
  (c) => `In ${c.day}, out ${c.dayBack}, and I am not moving either date. ${c.seats} seats from ${c.hub}.`,
  (c) => `Taking the aircraft empty otherwise. ${c.seats} seats, and frankly I would like the conversation.`,
  (c) => `Direct ${c.hub} to ${c.port}. If you need to be at a desk on Monday this is the wrong group.`,
  (c) => `Fourth year running. The group is half the reason I go and I will not pretend otherwise.`,
  (c) => `Ground arrangements are handled from the Tuesday before. The flight is the only part left to organise.`,
  (c) => `Splitting a ${c.jet} from ${c.hub}. Bring nothing that needs its own seat.`,
  (c) => `${c.event} and nothing else. No dinners, no introductions, no one taking meetings.`,
  (c) => `Booked the ramp slot already, which was the hard part. ${c.seats} seats out of ${c.hub}.`,
];

interface PremiseCtx {
  hub: string;
  port: string;
  city: string;
  event: string;
  jet: string;
  seats: number;
  hours: number;
  day: string;
  dayBack: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Airframe a member's aircraft string maps onto, if we carry one. */
function jetForAircraft(aircraft: string | undefined) {
  if (!aircraft) return undefined;
  const needle = aircraft.toLowerCase();
  return JETS.find(
    (j) => j.aircraft.toLowerCase().includes(needle) || needle.includes(j.id),
  );
}

/**
 * Group status is a pure function of the manifest — never stored independently,
 * so it cannot drift out of sync with the members list. `locked` is the one
 * exception: it is a host decision, so once set it is respected.
 */
export function deriveStatus(
  group: Pick<TravelGroup, 'members' | 'quorum' | 'capacity' | 'jet' | 'status'>,
): GroupStatus {
  if (group.status === 'locked') return 'locked';
  const filled = group.members.length;
  if (filled >= group.capacity) return 'locked';
  if (group.jet) return 'chartered';
  if (filled >= group.quorum) return 'quorum';
  return 'forming';
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the whole social world for a set of events. Pure: same events and
 * same seed in, same world out, on any machine.
 */
export function buildSimulation(
  events: readonly WorldEvent[],
  seed: string = WORLD_SEED,
  roster: readonly Member[] = MEMBERS,
): SimulatedWorld {
  const percentiles = demandPercentiles(events);

  const signals: InterestSignal[] = [];
  const dripQueue: InterestSignal[] = [];
  const groups: TravelGroup[] = [];
  const signalsByEvent = new Map<string, InterestSignal[]>();
  const groupsByEvent = new Map<string, TravelGroup[]>();
  const peerCounts: Record<string, number> = {};

  for (const event of events) {
    const rng = makeRng(`${seed}:event:${event.id}`);
    const pct = percentiles.get(event.id) ?? 0;
    const target = targetPeerCount(event, pct, rng);

    // Score the whole roster, take the top N. Scoring everyone every time is
    // 72 × ~120 events of arithmetic — trivial, and it means the selection is
    // a real ranking rather than a sampling artefact.
    const ranked = roster
      .map((m) => ({ m, s: affinity(m, event, rng) }))
      .sort((a, b) => b.s - a.s || (a.m.id < b.m.id ? -1 : 1));

    // A few extra names are generated but withheld: those are the drip.
    const withheld = Math.min(3, Math.max(0, Math.round(target * 0.18)));
    const take = Math.min(ranked.length, target + withheld);

    const eventSignals: InterestSignal[] = [];
    for (let i = 0; i < take; i++) {
      const member = ranked[i]!.m;
      const level = levelFor(i, take, event, rng);
      const note =
        rng.chance(level === 'committed' ? 0.3 : 0.16)
          ? rng.pick(NOTES_BY_LEVEL[level])
          : undefined;
      const signal: InterestSignal = {
        eventId: event.id,
        memberId: member.id,
        level,
        createdAt: signalTimestamp(event, level, rng),
        ...(note ? { note } : {}),
      };
      if (i < target) {
        eventSignals.push(signal);
        signals.push(signal);
      } else {
        dripQueue.push(signal);
      }
    }

    eventSignals.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    signalsByEvent.set(event.id, eventSignals);
    peerCounts[event.id] = eventSignals.length;

    // ── Groups ───────────────────────────────────────────────────────────
    // Only events with real traction get a cabin put together, and even then
    // not always. Two groups on one event is rare and reads as a hot ticket.
    const committed = eventSignals.filter((s) => s.level === 'committed');
    const interested = eventSignals.filter((s) => s.level === 'interested');
    const groupChance = clamp(0.12 + pct * 0.72, 0, 0.86);
    const groupCount =
      committed.length < 1 || eventSignals.length < 4
        ? 0
        : rng.chance(groupChance)
          ? rng.chance(0.18 + pct * 0.2)
            ? 2
            : 1
          : 0;

    const eventGroups: TravelGroup[] = [];
    const usedHosts = new Set<string>();
    for (let g = 0; g < groupCount; g++) {
      const group = buildGroup({
        event,
        rng,
        roster,
        committed,
        interested,
        usedHosts,
        index: g,
      });
      if (group) {
        eventGroups.push(group);
        groups.push(group);
      }
    }
    if (eventGroups.length) groupsByEvent.set(event.id, eventGroups);
  }

  // The drip is shuffled globally so consecutive reveals land on different
  // events — otherwise it reads as one event suddenly becoming popular.
  const dripRng = makeRng(`${seed}:drip`);
  const shuffledDrip = dripRng.shuffle(dripQueue);

  return {
    signals,
    signalsByEvent,
    peerCounts,
    groups,
    groupsByEvent,
    dripQueue: shuffledDrip,
  };
}

interface GroupBuildArgs {
  event: WorldEvent;
  rng: Rng;
  roster: readonly Member[];
  committed: readonly InterestSignal[];
  interested: readonly InterestSignal[];
  usedHosts: Set<string>;
  index: number;
}

function buildGroup(args: GroupBuildArgs): TravelGroup | null {
  const { event, rng, roster, committed, interested, usedHosts, index } = args;
  const byId = new Map(roster.map((m) => [m.id, m]));

  // A host is somebody who has actually committed, prefers to have the metal,
  // and is willing to sit next to a stranger.
  const hostPool = committed
    .map((s) => byId.get(s.memberId))
    .filter((m): m is Member => m !== undefined && !usedHosts.has(m.id));
  if (hostPool.length === 0) return null;

  const host = rng.weighted(
    hostPool,
    hostPool.map((m) => (m.aircraft ? 3 : 1) * (m.openToJetShare ? 2 : 1)),
  );
  usedHosts.add(host.id);

  // Capacity follows the metal. If the host owns something we know, that is the
  // cabin. Otherwise they are chartering, and they charter something sensible.
  const hostJet = jetForAircraft(host.aircraft);
  const capacity = hostJet
    ? hostJet.seats
    : rng.weighted([6, 8, 9, 10, 13], [2, 4, 4, 3, 1]);
  const quorum = clamp(Math.ceil(capacity * 0.5), 3, 8);

  // The manifest: committed members first, then interested, biased toward
  // people who could plausibly reach the departure hub.
  const hub = host.homeBase.homeJetPort;
  const hubCoords = host.homeBase.coords;
  const pool = [...committed, ...interested]
    .map((s) => byId.get(s.memberId))
    .filter((m): m is Member => m !== undefined && m.id !== host.id);

  const weighted = pool
    .map((m) => {
      const d = greatCircleDistanceNm(m.homeBase.coords, hubCoords);
      return { m, w: Math.exp(-d / 1500) * (m.openToJetShare ? 2 : 0.6) + 0.08 };
    })
    .sort((a, b) => b.w - a.w);

  // How full it already is. Most groups are genuinely forming; a minority have
  // hit quorum, and a few are done — that spread is what makes quorum feel like
  // a moment rather than a state.
  const fillRoll = rng.float();
  const targetFill =
    fillRoll < 0.5
      ? rng.int(2, Math.max(2, quorum - 1)) // forming
      : fillRoll < 0.82
        ? rng.int(quorum, Math.max(quorum, capacity - 2)) // quorum / chartered
        : capacity; // locked

  const members: GroupMembership[] = [
    {
      memberId: host.id,
      role: 'host',
      joinedAt: signalTimestamp(event, 'committed', rng),
    },
  ];
  for (const { m } of weighted) {
    if (members.length >= Math.min(targetFill, capacity)) break;
    if (rng.chance(0.72)) {
      members.push({
        memberId: m.id,
        role: 'member',
        joinedAt: signalTimestamp(event, 'interested', rng),
      });
    }
  }

  // A group that has reached quorum usually has the aircraft held.
  const jet =
    members.length >= quorum && rng.chance(0.45)
      ? (hostJet ?? JET_INDEX.get(capacity >= 13 ? 'f8x' : capacity >= 9 ? 'praetor600' : 'cj3plus'))
      : undefined;

  // DAYS runs Monday-first; getUTCDay() is Sunday-first.
  const startIdx = (new Date(`${event.start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const startDay = DAYS[startIdx]!;
  const backDay = DAYS[(startIdx + 3) % 7]!;
  const hours = Math.max(
    1,
    Math.round(greatCircleDistanceNm(hubCoords, event.coords) / 460),
  );

  const nameCtx: NameCtx = {
    hub,
    port: event.nearestJetPort.code,
    city: event.city,
    seats: capacity,
    day: startDay,
    dayBack: backDay,
  };
  const premiseCtx: PremiseCtx = {
    ...nameCtx,
    event: event.name,
    jet: hostJet?.aircraft ?? host.aircraft ?? 'chartered cabin',
    hours,
  };

  const base: Omit<TravelGroup, 'status'> = {
    id: `grp-${event.id}-${index + 1}`,
    eventId: event.id,
    name: rng.pick(GROUP_NAME_FORMS)(nameCtx),
    premise: rng.pick(PREMISES)(premiseCtx).slice(0, 200),
    members,
    capacity,
    quorum,
    departureHub: hub,
    ...(jet ? { jet } : {}),
    createdAt: signalTimestamp(event, 'committed', rng),
  };

  return { ...base, status: deriveStatus({ ...base, status: 'forming' }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The live drip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A very slow release of withheld signals, so the club looks like it is being
 * used rather than photographed. Deliberately subtle: one every 20–45 seconds,
 * pausable, and it never touches the event the user is reading.
 *
 * The interval is randomised at call time — this runs only in a client effect,
 * long after hydration, so `Math.random` here cannot cause a mismatch.
 */
export interface DripController {
  stop(): void;
}

export function startDrip(
  onTick: () => void,
  opts: { minMs?: number; maxMs?: number } = {},
): DripController {
  const minMs = opts.minMs ?? 20_000;
  const maxMs = opts.maxMs ?? 45_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    const delay = minMs + Math.random() * (maxMs - minMs);
    timer = setTimeout(() => {
      if (stopped) return;
      // Never advance while the tab is hidden — coming back to twenty new
      // signals at once is exactly the jarring thing we are avoiding.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        onTick();
      }
      schedule();
    }, delay);
  };

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The singleton
// ─────────────────────────────────────────────────────────────────────────────

let cached: SimulatedWorld | null = null;

/**
 * The world, built once per process, over the real dataset.
 *
 * Lazy so that importing this module costs nothing until something actually
 * asks for a peer count — the store module is evaluated at import time on the
 * client and should not be doing a hundred-event simulation to do so.
 */
export function getSimulation(): SimulatedWorld {
  if (!cached) cached = buildSimulation(EVENTS);
  return cached;
}

/** Drop the memo. Only the verification script has a reason to call this. */
export function resetSimulation(): void {
  cached = null;
  countsCache.clear();
}

const countsCache = new Map<number, Readonly<Record<string, number>>>();

/**
 * `eventId → peer count`, including however many drip signals have been
 * released. Memoised per drip position because the globe asks for this on
 * every beacon rebuild.
 */
export function computePeerCounts(dripRevealed = 0): Readonly<Record<string, number>> {
  const hit = countsCache.get(dripRevealed);
  if (hit) return hit;

  const world = getSimulation();
  const out: Record<string, number> = { ...world.peerCounts };
  const n = Math.min(dripRevealed, world.dripQueue.length);
  for (let i = 0; i < n; i++) {
    const s = world.dripQueue[i]!;
    out[s.eventId] = (out[s.eventId] ?? 0) + 1;
  }

  const frozen = Object.freeze(out);
  countsCache.set(dripRevealed, frozen);
  return frozen;
}

/**
 * Non-reactive peer counts at the baseline (no drip applied). Safe to call
 * during a server render — it touches no store and no browser API.
 */
export function getPeerCounts(): Record<string, number> {
  return { ...computePeerCounts(0) };
}
