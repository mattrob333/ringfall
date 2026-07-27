/**
 * MERIDIAN — links and invitations.
 *
 * The growth loop, and the only part of the product that leaves the building.
 * Two rules govern everything here:
 *
 *   1. THE LINK IS REAL. `buildTripLink` produces `?event=…&group=…`, and
 *      `<TripLinkReader />` (in `components/social/ShareTrip.tsx`) reads those
 *      parameters on load and opens the event and the cabin. A share link that
 *      lands on a home screen is a broken promise, and people only forward a
 *      link once.
 *
 *   2. WE DO NOT SEND ANYTHING. There is no backend and no mail server. Every
 *      invitation is composed here and handed to the member's own mail client
 *      through `mailto:`. The UI says so in plain words. "Invitation sent" when
 *      nothing was sent is the kind of small lie that costs a product its
 *      credibility on the first bounce.
 *
 * The copy is written as one adult inviting another: what it is, when, where
 * from, what it costs, and an exit. No exclamation marks, no "Hey!", no
 * "Don't miss out". These people receive a great deal of mail and can smell
 * a template.
 */

import { quoteCharter } from './charter';
import type { Member, TravelGroup, WorldEvent } from '@/lib/types';
import { MEMBER_INDEX } from './members';
import { makeRng } from './rng';

// ─────────────────────────────────────────────────────────────────────────────
// Deep links
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_PARAM = 'event';
export const GROUP_PARAM = 'group';

export interface TripLinkTarget {
  eventId?: string;
  groupId?: string;
}

/**
 * A link into the app that opens this event, and this cabin if one is named.
 *
 * `origin` defaults to the current document, so the link a member copies is
 * always the deployment they are looking at. Outside a browser (a node script,
 * a server render) it falls back to a bare query string — honest about the fact
 * that it does not know the host rather than inventing one.
 */
export function buildTripLink(eventId: string, groupId?: string, origin?: string): string {
  const params = new URLSearchParams();
  params.set(EVENT_PARAM, eventId);
  if (groupId) params.set(GROUP_PARAM, groupId);
  const query = `?${params.toString()}`;

  const base =
    origin ??
    (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '');
  if (!base) return query;
  return `${base.replace(/[?#].*$/, '').replace(/\/$/, '')}/${query}`.replace('//?', '/?');
}

/** Pull the trip target out of a query string. Tolerates a full URL. */
export function readTripLink(search: string): TripLinkTarget {
  const q = search.includes('?') ? search.slice(search.indexOf('?')) : search;
  const params = new URLSearchParams(q);
  const eventId = params.get(EVENT_PARAM)?.trim();
  const groupId = params.get(GROUP_PARAM)?.trim();
  return {
    ...(eventId ? { eventId } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Addresses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deliberately not RFC 5322. A full-grammar validator accepts things no mail
 * client will send and rejects nothing a person actually mistypes. This catches
 * the four real failures: no @, no domain, no dot, and stray whitespace.
 */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (v.length < 6 || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  return /^[^@,;]+@[^@,;.]+(\.[^@,;.]+)+$/.test(v);
}

export interface ParsedEmails {
  valid: string[];
  invalid: string[];
}

/** Split on commas, semicolons, spaces and newlines. Dedupes, preserves order. */
export function parseEmails(raw: string): ParsedEmails {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const t = token.trim().replace(/^<|>$/g, '');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isValidEmail(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid, invalid };
}

// ─────────────────────────────────────────────────────────────────────────────
// mailto
// ─────────────────────────────────────────────────────────────────────────────

export interface MailtoParts {
  to?: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  subject: string;
  body: string;
}

/**
 * A correctly encoded `mailto:`.
 *
 * Line breaks are normalised to CRLF before encoding — `%0D%0A` is what the
 * mail clients agree on, and a body encoded with bare `%0A` arrives as one
 * paragraph in Outlook. `encodeURIComponent` leaves `!'()*` alone, which is
 * legal in a query but confuses a couple of older handlers, so those are
 * escaped too.
 */
export function buildMailto(parts: MailtoParts): string {
  const to = (parts.to ?? []).map((a) => a.trim()).filter(Boolean);
  const query = new URLSearchParams();
  if (parts.cc?.length) query.set('cc', parts.cc.join(','));
  if (parts.bcc?.length) query.set('bcc', parts.bcc.join(','));

  const encoded = [
    `subject=${enc(parts.subject)}`,
    `body=${enc(parts.body.replace(/\r?\n/g, '\r\n'))}`,
    ...[...query.entries()].map(([k, v]) => `${k}=${enc(v)}`),
  ].join('&');

  return `mailto:${to.map(enc).join(',')}?${encoded}`;
}

const enc = (v: string): string =>
  encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// ─────────────────────────────────────────────────────────────────────────────
// Dates, in prose
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const utc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/** `Friday 22 May 2027` */
export const longDate = (iso: string): string => {
  const d = utc(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** How a person writes a run of days in a sentence: `22 to 24 May 2027`. */
export function proseDates(start: string, end: string): string {
  const a = utc(start);
  const b = utc(end);
  if (start === end) return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) {
    return `${a.getUTCDate()} to ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} to ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  return (
    `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()} to ` +
    `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`
  );
}

/** `22–24 May` — for a subject line, where every character is expensive. */
export function shortDates(start: string, end: string): string {
  const a = utc(start);
  const b = utc(end);
  const mA = MONTHS[a.getUTCMonth()]!.slice(0, 3);
  const mB = MONTHS[b.getUTCMonth()]!.slice(0, 3);
  if (start === end) return `${a.getUTCDate()} ${mA}`;
  if (mA === mB && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${mA}`;
  }
  return `${a.getUTCDate()} ${mA} – ${b.getUTCDate()} ${mB}`;
}

const weekdayOf = (iso: string): string => WEEKDAYS[utc(iso).getUTCDay()]!;

const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

// ─────────────────────────────────────────────────────────────────────────────
// The invitation
// ─────────────────────────────────────────────────────────────────────────────

export interface InviteEmail {
  subject: string;
  /** Plain text, `\n` separated. `buildMailto` handles the CRLF conversion. */
  body: string;
  /** The deep link embedded in the body. */
  link: string;
  /** Ready to assign to `window.location.href`. */
  mailto: string;
}

export interface InviteEmailOptions {
  /** Recipients. Omitted for a "copy the wording" preview. */
  to?: readonly string[];
  /** A line the member wrote themselves. Sits above the sign-off. */
  note?: string;
  /** Base URL for the deep link. Defaults to the current document. */
  origin?: string;
  /** Names the sender writes under. Defaults to their first name. */
  signature?: string;
}

/**
 * Compose the invitation.
 *
 * The wording varies with the event and the sender — a member who shares four
 * trips should not send four identical letters — but it varies *deterministically*,
 * seeded by the event and the sender, so pressing the button twice does not
 * rewrite the message under them.
 */
export function buildInviteEmail(
  event: WorldEvent,
  group: TravelGroup | undefined,
  from: Pick<Member, 'name' | 'homeBase' | 'handle'>,
  opts: InviteEmailOptions = {},
): InviteEmail {
  const rng = makeRng(`invite:${event.id}:${group?.id ?? 'solo'}:${from.handle}`);
  const link = buildTripLink(event.id, group?.id, opts.origin);
  const dates = proseDates(event.start, event.end);

  // A name that already contains a dash cannot take another one.
  const dashed = /[—–-]/.test(event.name);
  const short = shortDates(event.start, event.end);
  const subject = dashed
    ? `${event.name}, ${short}`
    : rng.pick([
        `${event.name} — ${short}`,
        `${event.name}, ${short}`,
        `${event.city}, ${short} — ${event.name}`,
      ]);

  const lines: string[] = [];

  // ── What, when, where ──────────────────────────────────────────────────
  lines.push(
    rng.pick([
      `${event.name} is ${dates}, in ${event.city}. I am going.`,
      `I am going to ${event.name} — ${dates}, ${event.city}.`,
      `${event.name}, ${event.city}, ${dates}. I will be there.`,
    ]),
  );
  lines.push('');

  if (group) {
    // ── The cabin ────────────────────────────────────────────────────────
    lines.push(...cabinParagraph(event, group, from, rng));
  } else {
    lines.push(
      rng.pick([
        `There is no cabin on it yet, which is why I am writing now and not the week before. If three or four of us go out of ${from.homeBase.homeJetPort} the aircraft stops being the expensive part — it is the same aeroplane whether I am in it alone or not.`,
        `Nobody has put a flight together for it. I would rather that were four of us than me and an empty cabin, so I am asking early. Nearest field is ${event.nearestJetPort.code}, ${event.nearestJetPort.name}.`,
        `No group on it so far. I am flying from ${from.homeBase.homeJetPort} either way and the seats behind me go at cost, which is the only sensible way to do this.`,
      ]),
    );
  }
  lines.push('');

  // ── The link ───────────────────────────────────────────────────────────
  lines.push(
    rng.pick([
      'Dates, the field, and who else has signalled on it:',
      'The listing, with everyone already watching it:',
      'Everything is here — dates, the airport, the manifest:',
    ]),
  );
  lines.push(link);
  lines.push('');

  // The door, but only when it can be said in a line. Most access notes in the
  // dataset are a paragraph of logistics, and a paragraph of logistics in an
  // invitation is how you get ignored.
  const door = event.accessNote.trim().replace(/\.$/, '');
  if (door && door.length <= 72 && !door.includes(';')) {
    lines.push(`Getting in: ${door}.`);
    lines.push('');
  }

  if (opts.note?.trim()) {
    lines.push(opts.note.trim());
    lines.push('');
  }

  // ── The exit ───────────────────────────────────────────────────────────
  lines.push(
    rng.pick([
      'Tell me either way and I will not raise it again.',
      'A no costs you nothing. I would just rather know before I hold the seats.',
      'If it is not for you, say so plainly and that is the end of it.',
      'Say yes and I will hold you to it.',
    ]),
  );
  lines.push('');
  lines.push(opts.signature?.trim() || firstName(from.name));

  const body = lines.join('\n');
  return {
    subject,
    body,
    link,
    mailto: buildMailto({ ...(opts.to?.length ? { to: opts.to } : {}), subject, body }),
  };
}

function cabinParagraph(
  event: WorldEvent,
  group: TravelGroup,
  from: Pick<Member, 'name' | 'homeBase' | 'handle'>,
  rng: ReturnType<typeof makeRng>,
): string[] {
  const filled = group.members.length;
  const seatsLeft = Math.max(0, group.capacity - filled);
  const host = group.members.find((m) => m.role === 'host');
  const hostMember = host ? MEMBER_INDEX.get(host.memberId) : undefined;
  const hosting = hostMember?.handle === from.handle;
  const out = weekdayOf(event.start);

  // Per seat at the current fill, from the host's own field. The number that
  // makes the argument, and the number that comes down as the cabin fills.
  let perSeat: number | null = null;
  if (hostMember) {
    const quote = quoteCharter(
      hostMember.homeBase.coords,
      event.nearestJetPort.coords,
      group.capacity,
      group.jet,
      { seatsFilled: Math.max(1, filled) },
    );
    perSeat = quote.costPerSeat;
  }

  // Only name the airframe when one is actually held. "In a chartered cabin"
  // is filler, and the absence of metal is itself the useful fact.
  const metal = group.jet?.aircraft ?? (group.jet ? undefined : hostMember?.aircraft);
  const inMetal = metal ? ` in a ${metal}` : '';
  const tail = metal ? '' : ' The aircraft is not held yet.';
  const lines: string[] = [];

  const opener = hosting
    ? [
        `I am putting the cabin together myself — ${group.name}, out of ${group.departureHub} on the ${out}${inMetal}. ${filled} of ${group.capacity} seats are taken.${tail}`,
        `The flight is mine: ${group.name}, out of ${group.departureHub} on the ${out}${inMetal}. ${filled} of ${group.capacity} in so far.${tail}`,
      ]
    : [
        `There is a cabin on it — ${group.name}, out of ${group.departureHub} on the ${out}${inMetal}. ${filled} of ${group.capacity} seats taken.${tail}`,
        `A group is already forming: ${group.name}, from ${group.departureHub} on the ${out}${inMetal}. ${filled} of ${group.capacity} taken.${tail}`,
        `${group.name} is the flight — ${group.departureHub} to ${event.nearestJetPort.code} on the ${out}${inMetal}, ${filled} of ${group.capacity} in.${tail}`,
      ];
  lines.push(rng.pick(opener));

  if (perSeat !== null) {
    lines.push('');
    lines.push(
      seatsLeft > 0
        ? `${usd(perSeat)} a seat at that count, and it falls with every person who joins. ${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left.`
        : `${usd(perSeat)} a seat. The manifest is full as it stands, but people drop and I would put you first.`,
    );
  }

  // The premise is the host's own pitch. Quote it when somebody else wrote it;
  // do not quote yourself back at your friends.
  if (group.premise && !hosting) {
    lines.push('');
    lines.push(
      `${hostMember ? `${firstName(hostMember.name)}’s` : 'The host’s'} words, not mine: ` +
        `“${group.premise.replace(/["“”]/g, '’')}”`,
    );
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Share sheet
// ─────────────────────────────────────────────────────────────────────────────

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

/** What goes into `navigator.share`. Short — this lands in a message, not an inbox. */
export function buildSharePayload(
  event: WorldEvent,
  group: TravelGroup | undefined,
  origin?: string,
): SharePayload {
  const url = buildTripLink(event.id, group?.id, origin);
  const dates = shortDates(event.start, event.end);
  const text = group
    ? `${event.name}, ${dates}. ${group.name} out of ${group.departureHub} — ${Math.max(0, group.capacity - group.members.length)} seats left.`
    : `${event.name}, ${dates}, ${event.city}.`;
  return { title: event.name, text, url };
}
