/**
 * MERIDIAN — core domain contract.
 *
 * This file is the single source of truth shared by every subsystem:
 * the globe renderer, the buzz engine, the curated dataset, the UI shell,
 * and the social layer. Treat it as frozen. If a subsystem needs a new
 * field, it belongs here first.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Geography
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoPoint {
  /** Degrees, -90 (south) .. 90 (north) */
  lat: number;
  /** Degrees, -180 (west) .. 180 (east) */
  lon: number;
}

export interface Airport {
  /** ICAO or IATA identifier, e.g. "LFMN" / "NCE" */
  code: string;
  name: string;
  coords: GeoPoint;
  /** Whether the field routinely handles heavy private traffic */
  fboQuality: 'exceptional' | 'excellent' | 'adequate';
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_CATEGORIES = [
  'art',
  'music',
  'motorsport',
  'sailing',
  'ski',
  'culinary',
  'fashion',
  'wellness',
  'safari',
  'equestrian',
  'film',
  'design',
  'golf',
  'tennis',
  'nature',
  'cultural',
  'gala',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** How hard the door is to get through. Drives visual weight and copy. */
export type EventTier =
  /** Globally famous, defines its week on the calendar */
  | 'legendary'
  /** Major fixture, widely known inside the circuit */
  | 'marquee'
  /** Known to the people who actually go; not yet crowded */
  | 'insider';

export type Recurrence = 'annual' | 'seasonal' | 'biennial' | 'one-off';

/**
 * Raw, un-normalized demand signals for an event. Adapters populate these
 * from live sources; the curated dataset ships realistic baselines.
 * The buzz engine is the only consumer.
 */
export interface BuzzSignals {
  /** Absolute social post volume over the trailing 7 days */
  socialMentions: number;
  /** Week-over-week change in mention volume, -1 .. 1 (clamped) */
  socialVelocity: number;
  /** Google-Trends style relative search interest, 0 .. 100 */
  searchInterest: number;
  /** Trailing-30d press/editorial hits */
  mediaMentions: number;
  /** Hotel + charter scarcity in the destination, 0 .. 1 */
  bookingPressure: number;
  /** How closed the guest list is, 0 (open) .. 1 (sealed) */
  exclusivity: number;
}

export interface SpendEstimate {
  /** Per-person, all-in for the stay excluding charter */
  min: number;
  max: number;
  currency: 'USD';
}

export interface WorldEvent {
  /** Stable slug, e.g. "monaco-grand-prix" */
  id: string;
  name: string;
  /** One line, ≤ 90 chars, no trailing period */
  tagline: string;
  category: EventCategory;
  secondaryCategories?: EventCategory[];

  city: string;
  country: string;
  /** ISO 3166-1 alpha-2, uppercase */
  countryCode: string;
  coords: GeoPoint;
  /** IANA zone, e.g. "Europe/Monaco" */
  timezone: string;

  /** Inclusive ISO date, YYYY-MM-DD */
  start: string;
  /** Inclusive ISO date, YYYY-MM-DD. Equal to `start` for single-day events. */
  end: string;
  recurrence: Recurrence;

  tier: EventTier;
  /** 1 (accessible) .. 5 (ruinous) */
  priceIndex: 1 | 2 | 3 | 4 | 5;
  estimatedSpend: SpendEstimate;
  /** How you actually get in, e.g. "Invitation only — via member house" */
  accessNote: string;

  venues: string[];
  nearestJetPort: Airport;

  /** 2–4 sentences. Written for someone deciding, not searching. */
  description: string;
  /** 3–5 short reasons, each ≤ 80 chars, no trailing period */
  whyGo: string[];
  tags: string[];

  signals: BuzzSignals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Buzz
// ─────────────────────────────────────────────────────────────────────────────

export type HeatLevel = 'smoldering' | 'warm' | 'hot' | 'blazing' | 'supernova';

/** Ordered coldest → hottest. Index is usable as a numeric rank. */
export const HEAT_LEVELS: readonly HeatLevel[] = [
  'smoldering',
  'warm',
  'hot',
  'blazing',
  'supernova',
] as const;

export interface BuzzScore {
  eventId: string;
  /** 0 .. 100 */
  score: number;
  heat: HeatLevel;
  /** 1-based rank within the scored set, 1 = hottest */
  rank: number;
  /** Per-signal contribution to `score`, already weighted. Sums to `score`. */
  components: Record<keyof BuzzSignals, number>;
  /** Momentum, -1 (cooling) .. 1 (surging) */
  trend: number;
  /** Set when peer interest measurably moved the score */
  peerLift?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Globe rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The globe renderer's only input. Produced by selectors, never by the
 * renderer itself — the renderer must stay a pure function of this array.
 */
export interface Beacon {
  eventId: string;
  coords: GeoPoint;
  /** 0 .. 100 */
  score: number;
  heat: HeatLevel;
  category: EventCategory;
  label: string;
  /** City, used for the de-cluttered label at low zoom */
  city: string;
  /**
   * 0 .. 1 — how "live" this beacon is at the current timeline position.
   * 1 = event is happening on the selected date, falling off either side
   * of the window. Renderer maps this to intensity and pillar height.
   */
  relevance: number;
  /** Negative if the event has already started */
  daysUntil: number;
  /** True when this is the user's focused/selected event */
  focused: boolean;
  /** Number of peers signalling interest — drives the ring count */
  peerCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Members & social
// ─────────────────────────────────────────────────────────────────────────────

export type MemberTier = 'founding' | 'signature' | 'charter';

export interface Member {
  id: string;
  /** Without the @ */
  handle: string;
  name: string;
  /** Deterministic seed for the generated avatar — no binary assets */
  avatarSeed: string;
  homeBase: {
    city: string;
    country: string;
    coords: GeoPoint;
    /** Where their aircraft actually sits */
    homeJetPort: string;
  };
  tier: MemberTier;
  memberSince: string;
  verified: boolean;
  /** ≤ 140 chars */
  bio: string;
  interests: EventCategory[];
  /** Willing to share a cabin with members they haven't met */
  openToJetShare: boolean;
  /** Aircraft they can offer seats on, if any */
  aircraft?: string;
}

export type InterestLevel =
  /** Keeping an eye on it */
  | 'watching'
  /** Would go with the right group */
  | 'interested'
  /** Going. Book it. */
  | 'committed';

export interface InterestSignal {
  eventId: string;
  memberId: string;
  level: InterestLevel;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** Optional public note, ≤ 160 chars */
  note?: string;
}

export type GroupStatus =
  /** Below quorum, open to anyone */
  | 'forming'
  /** Enough committed members to justify a charter */
  | 'quorum'
  /** Aircraft selected, holding */
  | 'chartered'
  /** Manifest closed */
  | 'locked';

export interface GroupMembership {
  memberId: string;
  role: 'host' | 'member';
  joinedAt: string;
}

export interface JetOption {
  id: string;
  aircraft: string;
  category: 'light' | 'midsize' | 'super-midsize' | 'heavy' | 'ultra-long-range';
  seats: number;
  /** Nautical miles */
  rangeNm: number;
  cruiseKts: number;
  /** USD per flight hour, all-in */
  hourlyRate: number;
  /** One line of why you'd pick this airframe */
  note: string;
}

export interface TravelGroup {
  id: string;
  eventId: string;
  name: string;
  /** Short pitch from the host, ≤ 200 chars */
  premise: string;
  members: GroupMembership[];
  status: GroupStatus;
  /** Seats available on the intended aircraft */
  capacity: number;
  /** Committed members needed before the charter is viable */
  quorum: number;
  /** Airport code the group departs from */
  departureHub: string;
  jet?: JetOption;
  createdAt: string;
}

/** A computed charter quote for a specific group + aircraft + route. */
export interface CharterQuote {
  jet: JetOption;
  distanceNm: number;
  flightHours: number;
  /** Round trip, includes repositioning and crew duty */
  totalCost: number;
  costPerSeat: number;
  seatsFilled: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────

export interface TimelineWindow {
  /** ISO date, YYYY-MM-DD — the scrubber's current position */
  focus: string;
  /**
   * Days either side of `focus` considered "in view". Events outside the
   * window still render, but with `relevance` falling toward 0.
   */
  spanDays: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtering
// ─────────────────────────────────────────────────────────────────────────────

export interface EventFilters {
  categories: EventCategory[];
  tiers: EventTier[];
  /** Inclusive upper bound on priceIndex; 5 = no limit */
  maxPriceIndex: number;
  /** Only events with at least this buzz score */
  minScore: number;
  /** Only events where at least one peer has signalled interest */
  peerActivityOnly: boolean;
  /** Free-text over name, city, country, tags */
  query: string;
}

export const DEFAULT_FILTERS: EventFilters = {
  categories: [],
  tiers: [],
  maxPriceIndex: 5,
  minScore: 0,
  peerActivityOnly: false,
  query: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Data sources
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceHealth {
  id: string;
  label: string;
  /** `live` only when credentials are present and the last fetch succeeded */
  status: 'live' | 'unconfigured' | 'error' | 'stale';
  /** ISO 8601 */
  lastSyncedAt?: string;
  detail?: string;
}

/**
 * Every live feed implements this. The curated dataset implements it too,
 * so the app has no special-case path for "demo mode".
 */
export interface EventSource {
  id: string;
  label: string;
  /** False when required env credentials are absent */
  isConfigured(): boolean;
  /** Full event records. Curated source only. */
  fetchEvents?(): Promise<WorldEvent[]>;
  /**
   * Signal enrichment for events we already know about. Live sources
   * implement this — they sharpen the curated baseline rather than
   * replacing it.
   */
  fetchSignals?(events: WorldEvent[]): Promise<Map<string, Partial<BuzzSignals>>>;
  health(): SourceHealth;
}
