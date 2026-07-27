/**
 * MERIDIAN — booking alerts engine.
 *
 * The globe answers "where should I go". This module answers the harder and
 * more expensive question: **"when must I move"**.
 *
 * Everything here is pure. `now` is always a parameter with a default of
 * `todayISO()`, and no computation reads the clock for itself — the default is
 * resolved once, at the call boundary, and then threaded through. That is what
 * makes the whole engine testable against a fixed date and safe to run inside a
 * `useMemo` keyed on a day string.
 *
 * ── THE MODEL ────────────────────────────────────────────────────────────────
 *
 * Every event has a **deadline**: the last day on which committing still buys
 * the good version of the trip.
 *
 *     deadline       = start − leadDaysFor(event)
 *     daysUntil      = now → start           (negative once the event begins)
 *     daysToDeadline = now → deadline        (negative once the deadline is gone)
 *                    = daysUntil − leadDays
 *
 * `leadDaysFor()` resolves the per-event `bookingLeadDays` override, falling
 * back to the category default. See `leadTimes.ts` for what that number means —
 * and, just as importantly, what it does not mean. It is not a sell-out date.
 *
 * ── THE BANDS ────────────────────────────────────────────────────────────────
 *
 * The **lead window** is the run-up to the deadline, and it is one lead-period
 * long. It therefore opens at `start − 2·leadDays` and shuts at the deadline:
 *
 *      start−2L            start−L (deadline)              start
 *   ──────┼────────────────────┼─────────────────────────────┼──────────▶
 *    open │      closing       │           passed            │ underway
 *         │        …then       │
 *         │   critical (last   │
 *         │    quarter of it)  │
 *
 * Reading it as "you enter the lead window when you have exactly one lead
 * period left to decide" is the point. A safari at 330 days of lead starts
 * nagging 660 days out, because that is genuinely when the good camps begin to
 * go; a three-star at 30 days of lead says nothing until 60 days out, because
 * before that there is literally nothing you can do.
 *
 *   underway  daysUntil ≤ 0                     the event has started
 *   passed    daysToDeadline < 0                the deadline is gone
 *   critical  0 ≤ daysToDeadline ≤ 0.25·L       final quarter of the window
 *   closing   0 ≤ daysToDeadline ≤ L            inside the window
 *   open      daysToDeadline > L                the window has not opened
 *
 * Tested in that order, so `critical` shadows `closing` and `underway` shadows
 * everything. The five bands partition the line with no gaps and no overlap.
 *
 * Two degenerate cases the shipped calendar actually contains:
 *
 *   • **The deadline is already in the past on load.** The dataset opens on
 *     today's date and runs 425 days forward, so an August safari or a Wimbledon
 *     fortnight with 450 days of lead is `passed` from the first paint. That is
 *     correct and it is the most valuable thing the engine says: the trip is
 *     still possible, it is just the degraded version, and the copy names which
 *     degraded version.
 *
 *   • **`leadDays` exceeds `daysUntil` at time zero.** Same arithmetic, and it
 *     is why `passed` is the largest band on day one rather than a rare edge.
 *     Nothing special-cases it; `daysToDeadline` simply comes out negative.
 *
 *   • **`leadDays === 0`** — a curated "walk up, this one is genuinely open".
 *     Then `deadline === start`, the lead window has zero width, and the event
 *     reads `open` right up until it begins. Correct: a walk-up event should
 *     never raise an alert.
 *
 * ── THE COPY ─────────────────────────────────────────────────────────────────
 *
 * A headline is only worth writing if it names the *right scarce thing*. "Book
 * soon" is worthless; "Balconies over the Campo are let by the families who own
 * them" tells a member what they are about to lose and why no amount of money
 * fixes it late.
 *
 * So the generator does not template off the category. It reads the event's own
 * `accessNote` — the curated line describing how you actually get in — and pulls
 * the scarce noun out of it, weighted by category so that Monaco resolves to a
 * terrace and Porto Cervo to a berth even though both notes mention both. The
 * category default is the last resort, not the first move.
 *
 * Voice rules, enforced by construction: no exclamation marks, no emoji, no
 * imperatives at the reader, no scarcity theatre. Sentence shape rotates on a
 * hash of the event id — deterministic, but enough variety that fifteen alerts
 * in a column do not rhyme.
 */

import type { EventCategory, WorldEvent } from '@/lib/types';
import { addDays, daysBetween, isValidISODate, parseISODate, todayISO } from '@/lib/buzz/dates';
import { LEAD_TIME_NOTES, leadDaysFor } from './leadTimes';

// ─────────────────────────────────────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────────────────────────────────────

export type BookingUrgency = 'open' | 'closing' | 'critical' | 'passed' | 'underway';

export interface BookingAlert {
  eventId: string;
  urgency: BookingUrgency;
  /** From `leadDaysFor()` — the per-event override, else the category default. */
  leadDays: number;
  daysUntil: number;
  /** days remaining before the booking window shuts; negative once past */
  daysToDeadline: number;
  /** ISO date by which to commit */
  deadline: string;
  /** One line, written to be read by a person deciding. No exclamation marks. */
  headline: string;
  detail: string;
}

/**
 * The last fraction of the lead window that counts as `critical`.
 *
 * A quarter is the right size because the lead window is itself one lead period
 * long: a quarter of eleven months is ten weeks, which is about how long it
 * takes to actually assemble a safari, and a quarter of a thirty-day culinary
 * window is a week, which is about how long a three-star release stays live.
 * The band scales with the market rather than imposing a fixed "7 days left".
 */
export const CRITICAL_FRACTION = 0.25;

/**
 * Sort rank, most decision-urgent first.
 *
 * `passed` outranks `open` deliberately: a passed deadline is a live decision
 * (take the degraded version, or drop the trip), whereas an open one requires
 * nothing from anybody yet. `underway` is last because there is nothing to do.
 */
export const URGENCY_ORDER: readonly BookingUrgency[] = [
  'critical',
  'closing',
  'passed',
  'open',
  'underway',
] as const;

const URGENCY_RANK: Record<BookingUrgency, number> = {
  critical: 0,
  closing: 1,
  passed: 2,
  open: 3,
  underway: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The booking alert for one event, evaluated at `now`.
 *
 * Pure: given the same event and the same `now`, the headline is byte-identical.
 * `now` defaults to today only so that call sites that genuinely mean "today"
 * do not have to say it; nothing downstream of this line reads a clock.
 */
export function bookingAlertFor(event: WorldEvent, now: string = todayISO()): BookingAlert {
  const leadDays = leadDaysFor(event);

  // Malformed dates would otherwise poison every field with NaN and render as
  // "NaN days". Live adapters populate `start`; the curated set is validated,
  // adapters are not. Degrade to a coherent, obviously-inert alert instead.
  if (!isValidISODate(event.start) || !isValidISODate(now)) {
    return {
      eventId: event.id,
      urgency: 'open',
      leadDays,
      daysUntil: 0,
      daysToDeadline: 0,
      deadline: event.start,
      headline: `Dates for ${event.name} are not confirmed`,
      detail: `No usable start date, so there is no deadline to work back from. ${LEAD_TIME_NOTES[event.category]}`,
    };
  }

  const deadline = addDays(event.start, -leadDays);
  const daysUntil = daysBetween(now, event.start);
  const daysToDeadline = daysBetween(now, deadline);
  const urgency = classify(daysUntil, daysToDeadline, leadDays);

  const ctx = buildContext(event, now, {
    leadDays,
    daysUntil,
    daysToDeadline,
    deadline,
    urgency,
  });

  return {
    eventId: event.id,
    urgency,
    leadDays,
    daysUntil,
    daysToDeadline,
    deadline,
    headline: writeHeadline(ctx),
    detail: writeDetail(ctx),
  };
}

/**
 * Alerts for a whole calendar, in **input order**.
 *
 * Deliberately not sorted: callers zip this against their own event list, and a
 * silent reorder would be a nasty surprise. Use `sortByUrgency()` — or the
 * `useBookingAlerts()` hook, which composes the two — when you want a ranked
 * column.
 */
export function bookingAlerts(events: WorldEvent[], now: string = todayISO()): BookingAlert[] {
  const out: BookingAlert[] = new Array(events.length);
  for (let i = 0; i < events.length; i++) out[i] = bookingAlertFor(events[i], now);
  return out;
}

/** `closing` and `critical` — the two bands where acting today changes the outcome. */
export function isActionable(a: BookingAlert): boolean {
  return a.urgency === 'closing' || a.urgency === 'critical';
}

/**
 * Ordering comparator: urgency band first, then deadline ascending, then event
 * id so the sort is total and stable across runs.
 */
export function compareAlerts(a: BookingAlert, b: BookingAlert): number {
  const byBand = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (byBand !== 0) return byBand;
  if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/** A ranked copy. Does not mutate the input. */
export function sortByUrgency(alerts: BookingAlert[]): BookingAlert[] {
  return [...alerts].sort(compareAlerts);
}

/**
 * Band assignment. See the file header for the geometry; this is that diagram
 * expressed once, in order of decreasing severity so each test can assume the
 * ones above it failed.
 */
function classify(daysUntil: number, daysToDeadline: number, leadDays: number): BookingUrgency {
  if (daysUntil <= 0) return 'underway';
  if (daysToDeadline < 0) return 'passed';
  if (daysToDeadline <= leadDays * CRITICAL_FRACTION) return 'critical';
  if (daysToDeadline <= leadDays) return 'closing';
  return 'open';
}

// ─────────────────────────────────────────────────────────────────────────────
// Scarcity — what is it that actually runs out?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The vocabulary of scarce things. `label` is sentence-initial, `lower` is
 * mid-sentence (kept separate because "Debentures" is a proper instrument and
 * must not be lowercased into a common noun), and `fallback` is the honest
 * answer to "and if I miss it?" — the degraded trip, named concretely.
 */
interface ScarceThing {
  label: string;
  lower: string;
  plural: boolean;
  fallback: string;
  /** False for mass nouns that read badly with "for that week" appended. */
  qualifiable: boolean;
}

const THINGS = {
  debenture: {
    label: 'Debentures',
    lower: 'Debentures',
    plural: true,
    fallback: 'a ground pass and the big screen',
    qualifiable: true,
  },
  permit: {
    label: 'Permits',
    lower: 'permits',
    plural: true,
    fallback: 'a later date and a fuller group',
    qualifiable: true,
  },
  camp: {
    label: 'Camps',
    lower: 'camps',
    plural: true,
    fallback: 'a lodge two hours from the water',
    qualifiable: true,
  },
  chalet: {
    label: 'Chalets',
    lower: 'chalets',
    plural: true,
    fallback: 'a hotel room and the lift queue',
    qualifiable: true,
  },
  cabin: {
    label: 'Cabins',
    lower: 'cabins',
    plural: true,
    fallback: 'an inside cabin low in the ship',
    qualifiable: true,
  },
  berth: {
    label: 'Berths',
    lower: 'berths',
    plural: true,
    fallback: 'a mooring outside the harbour',
    qualifiable: true,
  },
  // A berth in a marina and a berth on an expedition ship are the same word and
  // completely different failure modes. Split, and let the category choose.
  shipBerth: {
    label: 'Berths',
    lower: 'berths',
    plural: true,
    fallback: 'a bigger ship and fewer landings',
    qualifiable: true,
  },
  ryokan: {
    label: 'Ryokan rooms',
    lower: 'ryokan rooms',
    plural: true,
    fallback: 'a business hotel down the valley',
    qualifiable: true,
  },
  villa: {
    label: 'Villas',
    lower: 'villas',
    plural: true,
    fallback: 'a hotel room and a car each evening',
    qualifiable: true,
  },
  house: {
    label: 'Houses',
    lower: 'houses',
    plural: true,
    fallback: 'a hotel forty minutes out',
    qualifiable: true,
  },
  lodge: {
    label: 'Lodges',
    lower: 'lodges',
    plural: true,
    fallback: 'a room in town and a drive each way',
    qualifiable: true,
  },
  terrace: {
    label: 'Terraces',
    lower: 'terraces',
    plural: true,
    fallback: 'a grandstand seat and a screen',
    qualifiable: true,
  },
  balcony: {
    label: 'Balconies',
    lower: 'balconies',
    plural: true,
    fallback: 'the crowd in the middle of the square',
    qualifiable: true,
  },
  box: {
    label: 'Boxes',
    lower: 'boxes',
    plural: true,
    fallback: 'the public enclosure',
    qualifiable: true,
  },
  tentTable: {
    label: 'Tent tables',
    lower: 'tent tables',
    plural: true,
    fallback: 'a bench outside, if you queue',
    qualifiable: true,
  },
  table: {
    label: 'Tables',
    lower: 'tables',
    plural: true,
    fallback: 'the bar, or lunch instead of dinner',
    qualifiable: true,
  },
  suite: {
    label: 'Suites',
    lower: 'suites',
    plural: true,
    fallback: 'a standard room on a low floor',
    qualifiable: true,
  },
  room: {
    label: 'Rooms',
    lower: 'rooms',
    plural: true,
    fallback: 'a hotel in the next town',
    qualifiable: true,
  },
  enclosure: {
    label: 'Enclosure badges',
    lower: 'enclosure badges',
    plural: true,
    fallback: 'the public lawn',
    qualifiable: true,
  },
  badge: {
    label: 'Badges',
    lower: 'badges',
    plural: true,
    fallback: 'a grounds ticket and the outer course',
    qualifiable: true,
  },
  ballot: {
    label: 'The ballot',
    lower: 'the ballot',
    plural: false,
    fallback: 'the resale queue',
    qualifiable: true,
  },
  hospitality: {
    label: 'Hospitality packages',
    lower: 'hospitality packages',
    plural: true,
    fallback: 'a grounds ticket and a long walk',
    qualifiable: true,
  },
  pass: {
    label: 'Passes',
    lower: 'passes',
    plural: true,
    fallback: 'single sessions and the overflow screen',
    qualifiable: true,
  },
  card: {
    label: 'Preview cards',
    lower: 'preview cards',
    plural: true,
    fallback: 'the public days',
    qualifiable: true,
  },
  yacht: {
    label: 'Charter yachts',
    lower: 'charter yachts',
    plural: true,
    fallback: 'a hotel ashore and a day boat',
    qualifiable: true,
  },
  boat: {
    label: 'Boats',
    lower: 'boats',
    plural: true,
    fallback: 'a crowded launch and a shorter window',
    qualifiable: true,
  },
  bed: {
    label: 'Beds in the intake',
    lower: 'beds in the intake',
    plural: true,
    fallback: 'a shoulder-season week elsewhere',
    qualifiable: true,
  },
  programme: {
    label: 'Programme places',
    lower: 'programme places',
    plural: true,
    fallback: 'a shorter stay in a quieter month',
    qualifiable: true,
  },
  list: {
    label: 'The list',
    lower: 'the list',
    plural: false,
    fallback: 'the party afterwards, not the dinner',
    qualifiable: true,
  },
  seat: {
    label: 'Seats',
    lower: 'seats',
    plural: true,
    fallback: 'standing room at the back',
    qualifiable: true,
  },
  ticket: {
    label: 'Tickets',
    lower: 'tickets',
    plural: true,
    fallback: 'the resale market',
    qualifiable: true,
  },
} as const satisfies Record<string, ScarceThing>;

type ThingKey = keyof typeof THINGS;

/**
 * Ordered matchers over the event's `accessNote`.
 *
 * Base priority is position in this list, so the specific ("Debenture",
 * "gorilla permit") beats the generic ("seat", "ticket") — the last two entries
 * exist only because thirty of the notes say nothing more precise.
 *
 * `favours` is the important part. Several notes name three scarce things at
 * once: Monaco's says terrace apartments *and* harbour berths *and* Amber
 * Lounge tables. A flat list would give Monaco a berth. Matching the event's
 * category promotes a matcher past everything above it, so motorsport takes the
 * terrace and sailing takes the berth from the same shape of sentence.
 */
interface Matcher {
  key: ThingKey;
  re: RegExp;
  /** Promotes this matcher above everything else when the category agrees. */
  favours?: readonly EventCategory[];
  /** Hard restriction. "Programme" means a wellness intake, or a race card. */
  only?: readonly EventCategory[];
  /**
   * Hard exclusion. A fashion note's "houses" are Chanel and Prada, not
   * something you rent for the week; the word is a trap in exactly one category.
   */
  avoids?: readonly EventCategory[];
}

const CATEGORY_BOOST = 1000;

const MATCHERS: readonly Matcher[] = [
  { key: 'debenture', re: /debenture/ },
  { key: 'permit', re: /\bpermits?\b/, favours: ['nature', 'safari'] },
  { key: 'balcony', re: /balcon/, only: ['cultural', 'music', 'gala'], favours: ['cultural'] },
  { key: 'tentTable', re: /tent[^.;]*\b(table|reservation)/, only: ['cultural'] },
  { key: 'chalet', re: /\bchalets?\b/, favours: ['ski'] },
  { key: 'camp', re: /\bcamps?\b/, favours: ['safari', 'nature'] },
  { key: 'cabin', re: /\b(cabins?|flotel)\b/, only: ['nature', 'safari', 'sailing'] },
  { key: 'terrace', re: /\bterrace/, favours: ['motorsport', 'sailing', 'cultural'] },
  { key: 'berth', re: /\bberths?\b/, favours: ['sailing'], avoids: ['nature', 'safari'] },
  { key: 'shipBerth', re: /\bberths?\b/, only: ['nature', 'safari'] },
  { key: 'lodge', re: /\blodges?\b/, favours: ['safari'] },
  { key: 'enclosure', re: /\benclosure/, favours: ['equestrian'] },
  { key: 'box', re: /\bbox(es)?\b/, favours: ['equestrian', 'gala', 'music'] },
  { key: 'villa', re: /\bvillas?\b/, favours: ['film', 'sailing'] },
  { key: 'house', re: /\bhouses?\b/, favours: ['film', 'golf'], avoids: ['fashion'] },
  { key: 'suite', re: /\bsuites?\b/ },
  { key: 'yacht', re: /charter(ed)?\s+(fleet|whole|yacht)|\byachts?\b/, only: ['sailing', 'nature'] },
  { key: 'boat', re: /\bboats?\b/, only: ['nature', 'safari', 'sailing'] },
  { key: 'ryokan', re: /\bryokan\b/ },
  { key: 'table', re: /\btables?\b|ryotei|counter seats/, favours: ['culinary', 'gala'] },
  { key: 'bed', re: /\bintakes?\b|\bbeds\b/, only: ['wellness'] },
  { key: 'programme', re: /\bprogrammes?\b|\bcure weeks?\b/, only: ['wellness'] },
  { key: 'ballot', re: /\bballot\b|\blottery\b|random selection/, favours: ['golf', 'tennis', 'music'] },
  {
    key: 'card',
    re: /vip card|collector card|first choice card|collectors’ committee|vip preview|preview (day|card|numbers|is by)/,
    only: ['art', 'design'],
  },
  { key: 'hospitality', re: /hospitality/, favours: ['golf', 'tennis', 'motorsport'] },
  { key: 'room', re: /\brooms?\b|\bhotels?\b/, favours: ['art', 'film', 'fashion', 'wellness'] },
  { key: 'badge', re: /\bbadges?\b/ },
  { key: 'list', re: /invitation|invited|invite/, favours: ['gala', 'fashion', 'design'] },
  { key: 'pass', re: /\bpass(es)?\b/ },
  { key: 'seat', re: /\bseats?\b/ },
  { key: 'ticket', re: /\btickets?\b/ },
];

/** Last resort, when a note names nothing concrete at all. */
const CATEGORY_FALLBACK: Record<EventCategory, ThingKey> = {
  safari: 'camp',
  nature: 'permit',
  golf: 'badge',
  ski: 'chalet',
  tennis: 'debenture',
  cultural: 'balcony',
  film: 'room',
  gala: 'table',
  sailing: 'berth',
  equestrian: 'box',
  music: 'ballot',
  wellness: 'bed',
  art: 'room',
  motorsport: 'terrace',
  design: 'card',
  fashion: 'list',
  culinary: 'table',
};

function resolveThing(event: WorldEvent): ScarceThing {
  const note = event.accessNote.toLowerCase();
  let best: ThingKey | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < MATCHERS.length; i++) {
    const m = MATCHERS[i];
    if (m.only && !m.only.includes(event.category)) continue;
    if (m.avoids?.includes(event.category)) continue;
    if (!m.re.test(note)) continue;
    const score = m.favours?.includes(event.category) ? i - CATEGORY_BOOST : i;
    if (score < bestScore) {
      bestScore = score;
      best = m.key;
    }
  }

  return THINGS[best ?? CATEGORY_FALLBACK[event.category]];
}

// ─────────────────────────────────────────────────────────────────────────────
// Market behaviour — *how* the scarce thing goes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The verb of the sentence. Read off the note's own language rather than the
 * category, because the same category clears in genuinely different ways: the
 * Wimbledon ballot and a Debenture are both tennis, and only one of them is a
 * lottery.
 */
type Mode = 'relet' | 'ballot' | 'capped' | 'allocated' | 'invited' | 'released' | 'contracted';

const MODE_TESTS: readonly { mode: Mode; re: RegExp }[] = [
  {
    mode: 'relet',
    re: /re-?let|rebooked|returning guests|prior guests|repeat guests|same famil|previous winter|renewed annually|renewed by/,
  },
  { mode: 'ballot', re: /\bballot\b|\blottery\b|random selection|public draw/ },
  { mode: 'capped', re: /capped|\bquota\b|licen[cs]|fixed number|limited number|only around/ },
  { mode: 'allocated', re: /allocat/ },
  { mode: 'invited', re: /invitation-only|by invitation|nothing is sold|no ticket|selected by|is invited/ },
  { mode: 'released', re: /goes? on sale|go on sale|released|release[sd]?\b|opens? in|on sale/ },
];

function resolveMode(event: WorldEvent): Mode {
  const note = event.accessNote.toLowerCase();
  for (const t of MODE_TESTS) if (t.re.test(note)) return t.mode;
  return 'contracted';
}

function verbPhrase(mode: Mode, plural: boolean, lead: string, leadDays: number): string {
  // A curated lead of 0 says "walk up, this one is genuinely open". Every verb
  // below ends in "<lead> out", which would render as "contracted on the day
  // out"; there is also nothing to describe, because no market is clearing.
  if (leadDays <= 0) return plural ? 'can be taken on the day' : 'can be taken on the day';

  switch (mode) {
    case 'relet':
      return plural
        ? `are re-let before they reach the market`
        : `is re-let before it reaches the market`;
    case 'ballot':
      return plural
        ? `close by ballot ${lead} before the first day`
        : `closes ${lead} before the first day`;
    case 'capped':
      return plural
        ? `are capped by quota and released ${lead} out`
        : `is capped by quota and released ${lead} out`;
    case 'allocated':
      return plural ? `are allocated, not sold, ${lead} out` : `is allocated, not sold, ${lead} out`;
    case 'invited':
      return plural ? `are filled by invitation ${lead} out` : `is filled by invitation ${lead} out`;
    case 'released':
      return plural
        ? `are released ${lead} out and taken quickly`
        : `is released ${lead} out and taken quickly`;
    case 'contracted':
    default:
      return plural ? `are contracted ${lead} out` : `is contracted ${lead} out`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Qualifiers — which chalets? whose berths?
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Subjects that belong to a place, and so read well with "in Courchevel". */
const PLACE_BOUND: ReadonlySet<string> = new Set([
  'Camps',
  'Chalets',
  'Lodges',
  'Villas',
  'Houses',
  'Berths',
  'Terraces',
  'Rooms',
  'Cabins',
  'Balconies',
  'Boxes',
  'Suites',
  'Tables',
]);

/**
 * A phrase that pins the scarce thing to *this* trip rather than to the
 * category in general — either where it is or when it is.
 *
 * Geography is used when the thing is place-bound and the city name is short
 * enough to sit inside a headline; otherwise the event's own shape supplies the
 * qualifier, which is why a one-day gala gets "for 21 November" and a
 * four-month wellness season gets "for the season". Alternating between the two
 * on a hash is what stops a column of ski weeks all reading "for that week".
 */
function qualifierFor(event: WorldEvent, thing: ScarceThing, seed: number): string {
  if (!thing.qualifiable) return '';

  const geoOk =
    PLACE_BOUND.has(thing.label) &&
    !event.city.includes(',') &&
    event.city.length <= 15 &&
    !/\d/.test(event.city);

  if (geoOk && seed % 2 === 0) return `in ${event.city}`;

  const days = daysBetween(event.start, event.end) + 1;
  // A weekday rather than a date: a headline that already carries a deadline
  // date must not carry a second one, or the reader has to work out which is
  // which. "The list for that Sunday" cannot be confused with "16 August".
  if (days <= 1) return `for that ${WEEKDAYS[weekdayOf(event.start)]}`;
  if (days <= 4) return spansWeekend(event) ? 'for that weekend' : 'for those days';
  if (days <= 10) return 'for that week';
  if (days <= 24) return 'for the fortnight';
  // Midpoint, not start: a season running 26 July to 30 September is an August
  // trip, and naming it "for July" would send a member to the wrong end of it.
  if (days <= 75) return `for ${MONTHS[monthIndex(midpoint(event))]}`;
  return 'for the season';
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

/** The middle day of the run, as `YYYY-MM-DD`. */
function midpoint(event: WorldEvent): string {
  const half = Math.floor(daysBetween(event.start, event.end) / 2);
  return addDays(event.start, half);
}

function weekdayOf(iso: string): number {
  return new Date(parseISODate(iso)).getUTCDay();
}

function spansWeekend(event: WorldEvent): boolean {
  const from = parseISODate(event.start);
  const to = parseISODate(event.end);
  for (let t = from; t <= to; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d === 0 || d === 6) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers as a person would say them
// ─────────────────────────────────────────────────────────────────────────────

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

/**
 * Lead times are a property of the market, so they are spoken, not counted:
 * "camps are contracted ten months out", never "camps are contracted 330 days
 * out". Nobody describes a market in days.
 */
function leadPhrase(days: number): string {
  if (days <= 0) return 'on the day';
  if (days <= 3) return `${WORDS[days]} days`;
  if (days <= 10) return 'a week';
  if (days <= 18) return 'a fortnight';
  if (days <= 45) return 'a month';
  if (days >= 350 && days <= 400) return 'a year';
  if (days <= 349) return `${WORDS[Math.round(days / 30.4)]} months`;
  if (days <= 500) return 'fifteen months';
  if (days <= 590) return 'eighteen months';
  if (days <= 700) return 'twenty months';
  return 'two years';
}

/**
 * Time *you* have left is counted, because you are going to check it against a
 * calendar: "3 weeks", "9 days". Digits here and words above is the difference
 * between describing a market and describing a decision.
 */
function remainingPhrase(days: number): string {
  const n = Math.abs(days);
  if (n === 0) return 'today';
  if (n === 1) return '1 day';
  if (n <= 13) return `${n} days`;
  if (n <= 70) return `${Math.round(n / 7)} weeks`;
  return `${Math.round(n / 30.4)} months`;
}

/** "4 March" — the year appears only when it is not the current one. */
function dayAndMonth(iso: string, nowISO?: string): string {
  const day = Number(iso.slice(8, 10));
  const base = `${day} ${MONTHS[monthIndex(iso)]}`;
  if (!nowISO || iso.slice(0, 4) === nowISO.slice(0, 4)) return base;
  return `${base} ${iso.slice(0, 4)}`;
}

/** "March", or "March 2027" when that is a different year from now. */
function monthAndYear(iso: string, nowISO: string): string {
  const m = MONTHS[monthIndex(iso)];
  return iso.slice(0, 4) === nowISO.slice(0, 4) ? m : `${m} ${iso.slice(0, 4)}`;
}

/** FNV-1a. Deterministic sentence-shape selection, stable across runs. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 997;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentence construction
// ─────────────────────────────────────────────────────────────────────────────

interface Facts {
  leadDays: number;
  daysUntil: number;
  daysToDeadline: number;
  deadline: string;
  urgency: BookingUrgency;
}

interface Ctx extends Facts {
  event: WorldEvent;
  now: string;
  seed: number;
  thing: ScarceThing;
  /** "Chalets for that week" */
  subject: string;
  /** "chalets for that week" */
  subjectLower: string;
  plural: boolean;
  fallback: string;
  /** "are contracted eight months out" */
  verb: string;
  /** "eight months" */
  lead: string;
  /** "3 weeks" */
  left: string;
  /** "4 March" */
  deadlineDay: string;
  /** "March" */
  deadlineMonth: string;
  startDay: string;
  endDay: string;
  finished: boolean;
  /** `leadDays === 0` — nothing is scarce, so nothing should sound scarce. */
  walkUp: boolean;
}

function buildContext(event: WorldEvent, now: string, facts: Facts): Ctx {
  const seed = hash(event.id);
  const thing = resolveThing(event);
  // A *separate* hash. Deriving the qualifier from `seed` would lock it to the
  // sentence shape — every "in Basel" would land in the same two templates, and
  // a column of alerts would visibly rhyme even though each line is different.
  const qualifier = qualifierFor(event, thing, hash(`${event.id}:where`));
  const lead = leadPhrase(facts.leadDays);

  return {
    ...facts,
    event,
    now,
    seed,
    thing,
    subject: qualifier ? `${thing.label} ${qualifier}` : thing.label,
    subjectLower: qualifier ? `${thing.lower} ${qualifier}` : thing.lower,
    plural: thing.plural,
    fallback: thing.fallback,
    verb: verbPhrase(resolveMode(event), thing.plural, lead, facts.leadDays),
    walkUp: facts.leadDays <= 0,
    lead,
    left: remainingPhrase(facts.daysToDeadline),
    deadlineDay: dayAndMonth(facts.deadline, now),
    deadlineMonth: monthAndYear(facts.deadline, now),
    startDay: dayAndMonth(event.start, now),
    endDay: dayAndMonth(event.end, now),
    finished: now > event.end,
  };
}

/**
 * Four shapes per band, chosen on the event-id hash.
 *
 * Every shape is grammatical for every subject — plural agreement is carried on
 * the `ScarceThing`, not guessed, and no shape ever asks a mass noun ("the
 * ballot", "the list") to behave like a countable one. The rotation is
 * therefore free variety rather than a source of bugs.
 *
 * None of them addresses the reader as "you should". The alert states what the
 * market is doing and leaves the decision where it belongs.
 */
const SHAPES: Record<BookingUrgency, readonly ((c: Ctx) => string)[]> = {
  critical: [
    (c) => `${c.subject} ${c.verb}; ${c.left} left on this one`,
    (c) => `${c.left} left on ${c.subjectLower}, and then it is ${c.fallback}`,
    (c) => `${c.subject} shut on ${c.deadlineDay}, ${c.left} from now`,
    (c) =>
      `${c.subject} ${c.plural ? 'go' : 'goes'} on ${c.deadlineDay}; miss it and it is ${c.fallback}`,
    (c) => `${c.left} to ${c.deadlineDay} on ${c.subjectLower}; after that, ${c.fallback}`,
    (c) => `Inside the last stretch on ${c.subjectLower}: ${c.left} to ${c.deadlineDay}`,
  ],
  closing: [
    (c) => `${c.subject} ${c.verb}; this one closes in ${c.left}`,
    (c) => `${c.subject} ${c.plural ? 'are' : 'is'} gone by ${c.deadlineDay}, so ${c.left} to decide`,
    (c) => `The window on ${c.subjectLower} runs to ${c.deadlineDay}, ${c.left} from here`,
    (c) => `${c.left} before ${c.subjectLower} ${c.plural ? 'are' : 'is'} spoken for`,
    (c) => `${c.subject} ${c.verb}, which puts the decision at ${c.deadlineDay}`,
    (c) => `${c.left} of usable time on ${c.subjectLower}, and then ${c.fallback}`,
  ],
  open: [
    (c) => `${c.subject} ${c.verb}; nothing is contested until ${c.deadlineMonth}`,
    (c) => `${c.subject} hold until ${c.deadlineDay}, so this one can wait`,
    (c) => `${c.left} of clear air before ${c.subjectLower} start${c.plural ? '' : 's'} to move`,
    (c) => `Not yet — ${c.subjectLower} ${c.verb}, and that clock starts in ${c.deadlineMonth}`,
    (c) => `Worth watching from ${c.deadlineMonth}, when ${c.subjectLower} ${c.verb}`,
  ],
  passed: [
    (c) => `${c.subject} — the mark was ${c.deadlineDay}, and what is left is ${c.fallback}`,
    (c) =>
      `${c.subject} ${c.plural ? 'were' : 'was'} spoken for by ${c.deadlineDay}, so expect ${c.fallback}`,
    (c) => `Past the window on ${c.subjectLower}: ${c.fallback}, or another year`,
    (c) => `${c.subject} closed ${c.deadlineDay} — worth going anyway, on ${c.fallback}`,
    (c) => `${c.left} late on ${c.subjectLower}, which leaves ${c.fallback}`,
  ],
  underway: [
    (c) =>
      c.finished
        ? c.walkUp
          ? `Finished on ${c.endDay}`
          : `Finished on ${c.endDay}; ${c.subjectLower} went ${c.lead} before that`
        : `Running now through ${c.endDay}, with ${c.subjectLower} long settled`,
    (c) =>
      c.finished
        ? `Over — it ran to ${c.endDay}`
        : `Underway, and ${c.subjectLower} ${c.plural ? 'were' : 'was'} settled ${c.lead} before it began`,
    (c) =>
      c.finished
        ? `Closed on ${c.endDay}; the next running is the one to work on`
        : `In progress to ${c.endDay}, and ${c.subjectLower} ${c.plural ? 'are' : 'is'} long gone`,
    (c) =>
      c.finished
        ? `Ended ${c.endDay}, with nothing left to decide`
        : `Started ${c.startDay} and running to ${c.endDay}`,
  ],
};

/**
 * The deadline is *today*. Every shape above wants to say "0 days left", which
 * is both ugly and weaker than the plain fact, so this day gets its own copy.
 */
const TODAY_SHAPES: readonly ((c: Ctx) => string)[] = [
  (c) => `Today is the last day that holds ${c.subjectLower}`,
  (c) => `${c.subject} ${c.verb}, and today is the end of it`,
  (c) => `Decide today, or it becomes ${c.fallback}`,
  (c) => `Today closes the window on ${c.subjectLower}`,
];

/**
 * A headline has to fit on one line in a panel, so shapes carry a length
 * budget. The hash picks a starting shape and we walk forward until one fits —
 * still deterministic, still varied, but a long scarce noun and a long fallback
 * can never combine into something that wraps to three lines. If nothing fits,
 * the shortest wins on the grounds that truncation is worse than sameness.
 */
const MAX_HEADLINE = 104;

function writeHeadline(c: Ctx): string {
  const shapes =
    c.urgency === 'critical' && c.daysToDeadline === 0 ? TODAY_SHAPES : SHAPES[c.urgency];

  let shortest = '';
  for (let i = 0; i < shapes.length; i++) {
    const line = shapes[(c.seed + i) % shapes.length](c);
    if (line.length <= MAX_HEADLINE) return line;
    if (!shortest || line.length < shortest.length) shortest = line;
  }
  return shortest;
}

/**
 * The *why* line.
 *
 * Two wrong answers were tried before this one, and both are worth recording.
 *
 * The notes originally argued each category by naming its most famous member,
 * so the London Design Festival alert explained itself with "Salone puts three
 * hundred thousand people into Milan", Tokyo was called a small town, and a golf
 * tournament in Miyazaki cited the Masters ballot. Every one of those is a
 * sentence a member would know to be false, sitting under a number we are asking
 * them to trust.
 *
 * The obvious fix — use the event's own `accessNote` — is worse. Access notes
 * describe how you get a TICKET, and for most of these events the ticket is the
 * easy part: it produced "Commit by 16 September… Tromsø is the most open aurora
 * destination there is", an alert arguing against itself. The alert is about the
 * room, never the ticket.
 *
 * So the category note is the right content after all; it just had to stop
 * naming other events. It now states the category's scarcity in terms true of
 * every member of it.
 */
function whyLine(event: Ctx['event']): string {
  return LEAD_TIME_NOTES[event.category];
}

/** The second line carries the arithmetic and the why. */
function writeDetail(c: Ctx): string {
  const note = whyLine(c.event);

  switch (c.urgency) {
    case 'critical':
    case 'closing': {
      // `left` is "today" on the last day, and "today from now" is not English.
      const when = c.daysToDeadline === 0 ? 'which is today' : `${c.left} from now`;
      return `Commit by ${dayAndMonth(c.deadline, c.now)} — ${c.lead} before the first day, ${when}. ${note}`;
    }
    case 'open':
      return `The deadline is ${dayAndMonth(c.deadline, c.now)}, ${c.left} away, and the event runs from ${c.startDay}. ${note}`;
    case 'passed':
      return `The deadline was ${dayAndMonth(c.deadline, c.now)}, ${remainingPhrase(c.daysToDeadline)} ago, with ${remainingPhrase(c.daysUntil)} still to go before it starts. Going is not off the table; the good version of it is. ${note}`;
    case 'underway':
    default:
      return c.finished
        ? `Ran ${c.startDay} to ${c.endDay}. ${note}`
        : `Started ${c.startDay} and runs to ${c.endDay}. ${note}`;
  }
}
