/**
 * MERIDIAN — the cabin thread.
 *
 * A group card that lists five faces and a price is a spreadsheet row. The
 * thread is what turns it into a room. This module fabricates the conversation
 * that would already be happening on any cabin that has been open for a few
 * weeks, and it obeys the same three rules as `simulation.ts`:
 *
 *   1. DETERMINISM. Everything is seeded off the group id and the world seed.
 *      No `Math.random()`, and no wall clock — message timestamps are derived
 *      from the group's `createdAt` and the event's `start`, exactly as peer
 *      signals are, so the thread is byte-identical on the server, on
 *      hydration, and on a hard refresh next Tuesday. (`new Date(ms)` with an
 *      explicit argument appears here and in `tokens.ts`; it is a pure
 *      arithmetic conversion and cannot drift.)
 *
 *   2. SPECIFICITY. Every line resolves against the real manifest: the actual
 *      host, the actual departure hub, the actual airframe, the actual venue
 *      list on the actual event. A thread that could belong to any group is
 *      worse than no thread, because it tells the reader the people are props.
 *
 *   3. VOICE. Dry, brief, logistical, confident. These are adults with staff.
 *      They do not gush, they do not use exclamation marks, and they are
 *      mildly irritated by anyone who does. Volume scales with `status` — a
 *      forming cabin has a handful of lines, a locked one has a proper thread,
 *      because that is what commitment looks like in a message list.
 */

import { EVENT_INDEX } from '@/lib/data/events';
import { greatCircleDistanceNm } from '@/lib/geo/projection';
import type { GroupStatus, Member, TravelGroup, WorldEvent } from '@/lib/types';
import { MEMBER_INDEX } from './members';
import { clamp, makeRng, type Rng } from './rng';
import { getSimulation, WORLD_SEED } from './simulation';

// ─────────────────────────────────────────────────────────────────────────────
// Shape
// ─────────────────────────────────────────────────────────────────────────────

export type ChatMessageKind = 'message' | 'system';

export interface ChatMessage {
  /** Stable within a thread. `${groupId}:${n}` for seeded, `${groupId}:u${n}` for the user's. */
  id: string;
  groupId: string;
  /** Always a real member id — system lines carry the member they are about. */
  memberId: string;
  body: string;
  /** ISO 8601 */
  sentAt: string;
  kind: ChatMessageKind;
}

/** The salt for every thread. Change it and every cabin has a different week. */
export const CHAT_SEED = `${WORLD_SEED}.chat.v1`;

// ─────────────────────────────────────────────────────────────────────────────
// Volume
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much conversation a cabin at each stage has generated.
 *
 * `mid` is the logistics round (rooms, tables, who is arriving when), `late`
 * is the tightening-up round (aircraft, bags, ramp, timings). A forming group
 * has not had the second conversation yet — that is the point of the ladder.
 */
const VOLUME: Record<GroupStatus, { mid: number; late: number }> = {
  forming: { mid: 2, late: 0 },
  quorum: { mid: 3, late: 2 },
  chartered: { mid: 4, late: 4 },
  locked: { mid: 4, late: 6 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const firstName = (name: string): string => name.split(' ')[0] ?? name;

interface ThreadCtx {
  group: TravelGroup;
  event: WorldEvent;
  host: Member;
  /** Everyone on the manifest we can resolve, host first. */
  cast: Member[];
  hub: string;
  port: string;
  city: string;
  eventName: string;
  /** The airframe if one is held, otherwise the honest generic. */
  jetName: string;
  jetHeld: boolean;
  day: string;
  dayBack: string;
  month: string;
  capacity: number;
  quorum: number;
  filled: number;
  seatsLeft: number;
  venue: string;
  venue2: string;
  /** Block hours, hub to jet port, rounded. Used where somebody mentions the leg. */
  hours: number;
}

interface Turn {
  c: ThreadCtx;
  /** Who is speaking. */
  me: Member;
  /** Somebody else on the manifest, for the lines that name a name. */
  other: Member;
  meFirst: string;
  otherFirst: string;
  rng: Rng;
}

// ─────────────────────────────────────────────────────────────────────────────
// The lines
//
// Each pool is a list of closures over the turn. They are written to be read
// aloud: if a line would sound odd said by a fifty-year-old who owns a Falcon,
// it does not belong here.
// ─────────────────────────────────────────────────────────────────────────────

type Topic =
  | 'open'
  | 'confirm'
  | 'offer'
  | 'stay'
  | 'table'
  | 'timing'
  | 'ground'
  | 'seats'
  | 'aside'
  | 'close';

const LINES: Record<Topic, readonly ((t: Turn) => string)[]> = {
  // ── The host sets it out ────────────────────────────────────────────────
  open: [
    (t) =>
      `${t.c.day} morning out of ${t.c.hub}, back on the ${t.c.dayBack}. The slot is provisional until the week before and I will post it here when it firms up.`,
    (t) =>
      `Thread for ${t.c.eventName}. ${t.c.hub} out, ${t.c.port} in, and the ground at the other end is handled. Ask here rather than texting me separately.`,
    (t) =>
      `Cabin is ${t.c.capacity}. ${t.c.city} by early afternoon on the ${t.c.day}, and nothing that happens after that is my responsibility.`,
    (t) =>
      `Right. ${t.c.hub}, ${t.c.day}, customs from an hour before. I have flown this route enough times to know the only thing that ever goes wrong is the ramp at ${t.c.port}.`,
    (t) =>
      `Putting the ${t.c.city} week together properly this year. Out on the ${t.c.day}, back on the ${t.c.dayBack}, and I am not moving either date.`,
    (t) =>
      `${t.c.hub} on the ${t.c.day}. Everything else is negotiable and those two things are not.`,
  ],

  // ── Confirmations ───────────────────────────────────────────────────────
  confirm: [
    (t) =>
      `In. I will come up from ${t.me.homeBase.city} the night before rather than trust a morning connection.`,
    () => `Yes. I will be at the FBO from eight.`,
    () =>
      `Down for it. Same as last year, assuming last year is the benchmark and not the warning.`,
    (t) => `Confirmed. The ${t.c.dayBack} return suits me, I have nothing on the Monday.`,
    () => `In, and I am bringing nobody. Learned that lesson.`,
    (t) =>
      `Yes to all of it. ${t.otherFirst}, are you coming, or is this another year of watching you decide.`,
    (t) =>
      `Booked out of ${t.me.homeBase.homeJetPort} already, so consider me committed whether or not the slot moves.`,
  ],

  // ── Somebody with the metal offers seats ────────────────────────────────
  offer: [
    (t) =>
      `If ${t.c.hub} is awkward for anyone, I am taking the ${t.me.aircraft} out of ${t.me.homeBase.homeJetPort} on the ${t.c.day} and there are ${t.rng.int(2, 4)} seats in the back.`,
    (t) =>
      `The ${t.me.aircraft} is positioning that morning anyway. Two seats going if somebody is coming from ${t.me.homeBase.city} or anywhere near it.`,
    (t) =>
      `${t.otherFirst} — you are in ${t.other.homeBase.city}. I route through there. Say the word and I will pick you up.`,
    (t) =>
      `I can put three on the ${t.me.aircraft} if the ${t.c.hub} timing does not work. Not a favour, the seats are empty either way.`,
  ],

  // ── Where everyone is sleeping ──────────────────────────────────────────
  stay: [
    () =>
      `Who is staying where. I would rather settle it now than negotiate it in a car at eleven at night.`,
    () =>
      `I have the same house as last year and two rooms nobody has claimed. Speak up before I give them back.`,
    (t) =>
      `Taken a villa twenty minutes out of ${t.c.city}. Quieter, and there is a cook. Four of you would fit.`,
    (t) => `Do not book the place on the water in ${t.c.city}. It was a mistake and I made it twice.`,
    (t) =>
      `Rooms in ${t.c.city} are gone from the ${t.c.day} — I checked this morning. If you have not booked, tell me and I will make a call.`,
    (t) =>
      `${t.otherFirst} and I are at the same address again. There is a third room and it is better than the second.`,
  ],

  // ── Tables, passes, the reason anyone is going ──────────────────────────
  table: [
    (t) =>
      `Table on the ${t.c.day} at nine, eight covers. Tell me by the Friday or I give the seats back.`,
    (t) =>
      `I have four passes for ${t.c.venue} and I am not going to use all of them. First to ask.`,
    (t) =>
      `Dinner is arranged for the ${t.c.dayBack}. Nobody has to come, and I will notice who does not.`,
    (t) =>
      `${t.c.venue2} on the ${t.c.day} — worth doing properly rather than at the end of a long lunch.`,
    (t) =>
      `Booked the usual place in ${t.c.city} for the first night. Six of us. It is not a discussion, it is a booking.`,
    () =>
      `Whoever handled the table last year should handle it again, because I did and it was not a success.`,
  ],

  // ── Arriving early, leaving late, not on the aircraft at all ────────────
  timing: [
    (t) =>
      `I am in a day early for ${t.c.venue}. Do not hold the aircraft for me on the way out.`,
    (t) =>
      `Coming separately — I am in ${t.me.homeBase.city} until the Wednesday and the backtrack is not worth it. I will meet everyone at the house.`,
    (t) =>
      `Take me off the return. I am going on to ${t.other.homeBase.city} from ${t.c.port}, so somebody can have the seat back.`,
    (t) =>
      `Landing ${t.c.port} the night before. Happy to meet the aircraft if that is useful to anyone.`,
    (t) =>
      `I need to be back in ${t.me.homeBase.city} by the Monday morning. If the ${t.c.dayBack} slips I will go commercial and say nothing about it.`,
    () =>
      `Two of us are staying on for the week afterwards, so the return is lighter than the outbound. Worth knowing when the numbers are done.`,
  ],

  // ── Ground, bags, ramp, the unglamorous half ────────────────────────────
  ground: [
    (t) =>
      `Cars are arranged at ${t.c.port}. Two of them, and one takes cases properly.`,
    (t) =>
      `Bags — the hold on a ${t.c.jetName} is smaller than people think. One case each and nothing rigid.`,
    (t) =>
      `What is the ramp situation at ${t.c.port} that week. Last time we parked at the far end and walked, in the wrong shoes.`,
    (t) =>
      `I will do the ground at the other end. It is the one part of this I am reliably good at.`,
    (t) =>
      `Handling at ${t.c.hub} have the manifest. Passports to me by the Friday before or you are explaining yourself at the desk.`,
    (t) =>
      `Catering — nothing hot. Nobody has ever thanked me for a hot meal on a ${t.c.hours} hour leg and two people have complained.`,
  ],

  // ── The economics, discussed the way these people discuss them ──────────
  seats: [
    () =>
      `Per seat looks right for the metal. I have paid a great deal more for a great deal less.`,
    (t) =>
      `${t.c.seatsLeft} seats still open. If you know somebody, ask them properly rather than posting it about.`,
    (t) =>
      `We are ${t.c.filled} of ${t.c.capacity}. One more and the number per seat stops being irritating.`,
    (t) =>
      `Is the ${t.c.jetName} actually held, or are we still hoping. I ask because I have been caught before.`,
    () =>
      `Splitting it this way is the only sane version of this trip. The alternative is four separate aircraft and everyone pretending that is normal.`,
  ],

  // ── Warmth. The reason the club is the product. ─────────────────────────
  aside: [
    (t) => `Somebody remind me why we do this in ${t.c.month}.`,
    (t) =>
      `${t.otherFirst} arrived with a dog last year. I want it on the record that I said nothing at the time.`,
    () =>
      `Good group. That is most of the reason I go, and I have stopped pretending otherwise.`,
    (t) =>
      `${t.otherFirst}, are you still not speaking to the people at ${t.c.venue}, or has that been resolved.`,
    (t) =>
      `Last time this cabin flew, three of us ended up in ${t.other.homeBase.city} for reasons nobody has explained since.`,
    (t) =>
      `I have been going to ${t.c.eventName} since before it was worth going to, and it is still worth going to.`,
  ],

  // ── The host closes it out ──────────────────────────────────────────────
  close: [
    (t) => `Manifest is what it is. See everyone at ${t.c.hub} on the ${t.c.day}.`,
    (t) =>
      `Ground schedule goes out tonight. Read it or do not, but do not ask me on the ${t.c.day}.`,
    (t) =>
      `Everything is booked. I am not answering anything else until we are airborne.`,
    (t) =>
      `That is us. ${t.c.hub}, ${t.c.day}, and the aircraft leaves whether or not you are on it.`,
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// System lines
// ─────────────────────────────────────────────────────────────────────────────

const systemJoin = (m: Member): string => `${m.name} joined the manifest`;
const systemQuorum = (c: ThreadCtx): string =>
  `Quorum reached — ${c.quorum} of ${c.capacity} seats committed`;
const systemJet = (c: ThreadCtx): string => `${c.jetName} held out of ${c.hub}`;
const systemClosed = (c: ThreadCtx): string =>
  `Manifest closed at ${c.capacity} of ${c.capacity}`;

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/**
 * Message times, derived entirely from the group and the event.
 *
 * Real threads are not evenly spaced — they happen in sittings. So the window
 * between the cabin opening and two days before the event is divided into a
 * handful of sessions, biased toward the end (conversation intensifies as the
 * date approaches), and the messages are dealt into them a few minutes apart.
 */
function timeline(n: number, group: TravelGroup, event: WorldEvent, rng: Rng): string[] {
  if (n <= 0) return [];

  const openedAt = Date.parse(group.createdAt);
  const eventAt = Date.parse(`${event.start}T00:00:00.000Z`);
  const start = Number.isFinite(openedAt) ? openedAt : eventAt - 60 * DAY_MS;
  let end = eventAt - 2 * DAY_MS;
  if (!(end - start > 3 * DAY_MS)) end = start + 9 * DAY_MS;
  const span = end - start;

  const sessionCount = Math.max(2, Math.min(7, Math.round(n / 2.4)));
  const anchors: number[] = [];
  for (let i = 0; i < sessionCount; i++) anchors.push(Math.pow(rng.float(), 0.75));
  anchors.sort((a, b) => a - b);

  // Deal n messages across the sessions, every session getting at least one.
  const sizes = new Array<number>(sessionCount).fill(1);
  for (let i = sessionCount; i < n; i++) sizes[rng.int(0, sessionCount - 1)]! += 1;

  const out: number[] = [];
  for (let s = 0; s < sessionCount; s++) {
    const raw = start + anchors[s]! * span;
    // Snap to a civil hour without touching the wall clock or a locale.
    const dayStart = Math.floor(raw / DAY_MS) * DAY_MS;
    let t = dayStart + rng.int(8, 21) * 3_600_000 + rng.int(0, 59) * MIN_MS;
    for (let j = 0; j < sizes[s]!; j++) {
      out.push(t);
      t += rng.int(2, 74) * MIN_MS;
    }
  }

  // Sessions can overlap after the jitter. Force strict order — a thread that
  // goes backwards in time is the one bug nobody forgives.
  for (let i = 1; i < out.length; i++) {
    if (out[i]! <= out[i - 1]!) out[i] = out[i - 1]! + rng.int(3, 40) * MIN_MS;
  }

  return out.slice(0, n).map((ms) => new Date(ms).toISOString());
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

interface Beat {
  kind: ChatMessageKind;
  topic?: Topic;
  /** Set for system beats. */
  system?: 'join' | 'quorum' | 'jet' | 'closed';
}

function plan(status: GroupStatus, castSize: number, jetHeld: boolean, rng: Rng): Beat[] {
  const vol = VOLUME[status];
  const mid = Math.max(1, vol.mid + (rng.chance(0.35) ? 1 : 0));
  const late = vol.late > 0 ? vol.late + (rng.chance(0.3) ? 1 : 0) : 0;

  const beats: Beat[] = [{ kind: 'message', topic: 'open' }];
  beats.push({ kind: 'message', topic: 'confirm' });
  if (castSize > 2) beats.push({ kind: 'system', system: 'join' });
  beats.push({ kind: 'message', topic: 'confirm' });

  const midTopics: Topic[] = ['stay', 'table', 'timing', 'offer', 'aside'];
  for (let i = 0; i < mid; i++) beats.push({ kind: 'message', topic: rng.pick(midTopics) });

  if (status !== 'forming') beats.push({ kind: 'system', system: 'quorum' });

  const lateTopics: Topic[] = ['ground', 'seats', 'timing', 'table', 'aside', 'stay'];
  const half = Math.ceil(late / 2);
  for (let i = 0; i < half; i++) beats.push({ kind: 'message', topic: rng.pick(lateTopics) });
  if (jetHeld) beats.push({ kind: 'system', system: 'jet' });
  for (let i = half; i < late; i++) beats.push({ kind: 'message', topic: rng.pick(lateTopics) });

  if (status === 'locked') beats.push({ kind: 'system', system: 'closed' });
  if (status !== 'forming') beats.push({ kind: 'message', topic: 'close' });

  return beats;
}

/**
 * Generate the whole conversation for one cabin. Pure: same group and same
 * event in, same thread out, on any machine and in any process.
 */
export function buildThread(group: TravelGroup, event: WorldEvent): ChatMessage[] {
  const cast = group.members
    .map((m) => MEMBER_INDEX.get(m.memberId))
    .filter((m): m is Member => m !== undefined);
  const hostId = group.members.find((m) => m.role === 'host')?.memberId;
  const host = (hostId ? MEMBER_INDEX.get(hostId) : undefined) ?? cast[0];
  if (!host || cast.length === 0) return [];

  const rng = makeRng(`${CHAT_SEED}:${group.id}`);
  const startDate = new Date(`${event.start}T00:00:00Z`);
  const filled = group.members.length;

  const c: ThreadCtx = {
    group,
    event,
    host,
    cast: [host, ...cast.filter((m) => m.id !== host.id)],
    hub: group.departureHub,
    port: event.nearestJetPort.code,
    city: event.city,
    eventName: event.name,
    jetName: group.jet?.aircraft ?? host.aircraft ?? 'the aircraft',
    jetHeld: Boolean(group.jet),
    day: DAYS[startDate.getUTCDay()]!,
    dayBack: DAYS[(startDate.getUTCDay() + 3) % 7]!,
    month: MONTHS[startDate.getUTCMonth()]!,
    capacity: group.capacity,
    quorum: group.quorum,
    filled,
    seatsLeft: Math.max(0, group.capacity - filled),
    venue: event.venues[0] ?? event.name,
    venue2: event.venues[1] ?? event.venues[0] ?? event.name,
    hours: Math.max(
      1,
      Math.round(greatCircleDistanceNm(host.homeBase.coords, event.coords) / 460),
    ),
  };

  const beats = plan(group.status, c.cast.length, c.jetHeld, rng);

  // ── Voices ──────────────────────────────────────────────────────────────
  // The host talks about twice as much as anyone else, nobody speaks twice in
  // a row if there is an alternative, and everyone who is on the manifest gets
  // at least a chance to appear before anyone repeats.
  const spoken = new Map<string, number>();
  let last: string | null = null;
  const speaker = (eligible: Member[]): Member => {
    const pool = eligible.length > 1 ? eligible.filter((m) => m.id !== last) : eligible;
    const options = pool.length > 0 ? pool : eligible;
    const weights = options.map((m) => {
      const said = spoken.get(m.id) ?? 0;
      const base = m.id === host.id ? 2.2 : 1;
      return base / (1 + said * 1.4);
    });
    const chosen = rng.weighted(options, weights);
    spoken.set(chosen.id, (spoken.get(chosen.id) ?? 0) + 1);
    last = chosen.id;
    return chosen;
  };

  // Template reuse is what makes generated copy smell. Nothing repeats inside
  // a thread until the pool is genuinely exhausted.
  const used = new Set<string>();
  const line = (topic: Topic, turn: Turn): string => {
    const pool = LINES[topic];
    const fresh = pool.filter((_, i) => !used.has(`${topic}:${i}`));
    const from = fresh.length > 0 ? fresh : pool;
    const fn = rng.pick(from);
    used.add(`${topic}:${pool.indexOf(fn)}`);
    return fn(turn);
  };

  const joiners = c.cast.filter((m) => m.id !== host.id);
  let joinCursor = 0;

  const drafted: Array<Omit<ChatMessage, 'sentAt' | 'id'>> = [];

  for (const beat of beats) {
    if (beat.kind === 'system') {
      if (beat.system === 'join') {
        const who = joiners[joinCursor % Math.max(1, joiners.length)] ?? host;
        joinCursor += 1;
        drafted.push({ groupId: group.id, memberId: who.id, body: systemJoin(who), kind: 'system' });
      } else if (beat.system === 'quorum') {
        drafted.push({ groupId: group.id, memberId: host.id, body: systemQuorum(c), kind: 'system' });
      } else if (beat.system === 'jet') {
        drafted.push({ groupId: group.id, memberId: host.id, body: systemJet(c), kind: 'system' });
      } else {
        drafted.push({ groupId: group.id, memberId: host.id, body: systemClosed(c), kind: 'system' });
      }
      continue;
    }

    let topic = beat.topic ?? 'aside';

    // Who is allowed to say this? The host opens and closes; only somebody who
    // actually owns metal offers seats on it.
    let eligible: Member[];
    if (topic === 'open' || topic === 'close') {
      eligible = [host];
    } else if (topic === 'offer') {
      eligible = c.cast.filter((m) => Boolean(m.aircraft));
      if (eligible.length === 0) {
        topic = 'stay';
        eligible = c.cast;
      }
    } else {
      eligible = c.cast.length > 1 ? c.cast : [host];
    }

    const me = speaker(eligible);
    const others = c.cast.filter((m) => m.id !== me.id);
    const other = others.length > 0 ? rng.pick(others) : me;
    const turn: Turn = {
      c,
      me,
      other,
      meFirst: firstName(me.name),
      otherFirst: firstName(other.name),
      rng,
    };

    drafted.push({
      groupId: group.id,
      memberId: me.id,
      body: line(topic, turn),
      kind: 'message',
    });
  }

  const times = timeline(drafted.length, group, event, rng);

  return drafted.map((d, i) => ({
    ...d,
    id: `${group.id}:${i}`,
    sentAt: times[i] ?? times[times.length - 1] ?? group.createdAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The singleton
// ─────────────────────────────────────────────────────────────────────────────

let threadCache: Map<string, readonly ChatMessage[]> | null = null;

/** Every seeded thread in the world, built once per process. */
export function getThreads(): ReadonlyMap<string, readonly ChatMessage[]> {
  if (threadCache) return threadCache;
  const out = new Map<string, readonly ChatMessage[]>();
  for (const group of getSimulation().groups) {
    const event = EVENT_INDEX.get(group.eventId);
    if (!event) continue;
    out.set(group.id, Object.freeze(buildThread(group, event)));
  }
  threadCache = out;
  return out;
}

/**
 * The seeded thread for one cabin. Empty for a cabin the user created — a
 * conversation the user has not had is a lie, and the empty state is better.
 */
export function getThread(groupId: string): readonly ChatMessage[] {
  return getThreads().get(groupId) ?? EMPTY;
}

const EMPTY: readonly ChatMessage[] = Object.freeze([]);

/** Drop the memo. Only the verification script has a reason to call this. */
export function resetThreads(): void {
  threadCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge helpers — shared by the store and anything else that needs the thread
// ─────────────────────────────────────────────────────────────────────────────

const byTime = (a: ChatMessage, b: ChatMessage): number =>
  a.sentAt === b.sentAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.sentAt < b.sentAt ? -1 : 1;

/** Seeded thread + the user's own messages, in time order. */
export function mergeThread(
  groupId: string,
  own: readonly ChatMessage[],
): ChatMessage[] {
  const mine = own.filter((m) => m.groupId === groupId);
  const seeded = getThread(groupId);
  if (mine.length === 0) return [...seeded];
  return [...seeded, ...mine].sort(byTime);
}

/**
 * When the user's next message should be stamped.
 *
 * Seeded timestamps run on the *event's* clock, not the wall clock, so for a
 * fixture eight months out the whole thread is in the future. Stamping a reply
 * with `Date.now()` would drop it into the middle of the scrollback. The user's
 * message always lands after the last thing said.
 */
export function nextSentAt(groupId: string, own: readonly ChatMessage[], now: number): string {
  const all = mergeThread(groupId, own);
  const lastAt = all.length > 0 ? Date.parse(all[all.length - 1]!.sentAt) : Number.NaN;
  const floor = Number.isFinite(lastAt) ? lastAt + MIN_MS : now;
  return new Date(Math.max(now, floor)).toISOString();
}

/** Messages in a merged thread newer than `since`, excluding the reader's own. */
export function countUnread(
  messages: readonly ChatMessage[],
  since: string | undefined,
  meId: string,
): number {
  let n = 0;
  for (const m of messages) {
    if (m.memberId === meId && m.kind === 'message') continue;
    if (since !== undefined && m.sentAt <= since) continue;
    n += 1;
  }
  return n;
}

/** The timestamp `markRead` should store — never behind the newest message. */
export function readWatermark(messages: readonly ChatMessage[], now: number): string {
  const last = messages.length > 0 ? Date.parse(messages[messages.length - 1]!.sentAt) : Number.NaN;
  const floor = Number.isFinite(last) ? last : now;
  return new Date(Math.max(now, floor)).toISOString();
}

/** Clamp used by the group card's badge. Exported so the copy stays in one place. */
export const formatUnread = (n: number): string => (n > 9 ? '9+' : String(clamp(n, 0, 9)));
