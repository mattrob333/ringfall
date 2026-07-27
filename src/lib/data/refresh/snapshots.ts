/**
 * MERIDIAN — signal history, and velocity computed rather than bought.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `BuzzSignals.socialVelocity` is defined in `types.ts` as "week-over-week
 * change in mention volume". Today it arrives from vendors — X's own delta,
 * Google Trends' slope — and it carries the third-largest weight in the buzz
 * model (0.18, see `buzz/scoring.ts`). We are therefore paying for, and ranking
 * on, a number somebody else computed, over a window we did not choose, with a
 * smoothing we cannot inspect. Trends in particular is weekly-smoothed and lags
 * by days, which is why the merge policy in `sources.ts` already ranks X's
 * daily buckets above it.
 *
 * But we do not need to buy it. `socialMentions` is an *absolute* count, and
 * the refresh scheduler next door is about to hand us that count on a known
 * cadence. Two counts and the gap between them is a velocity. Doing it
 * ourselves is:
 *
 *   • **Cheaper.** No incremental call — velocity falls out of a fetch we are
 *     already making for `socialMentions`.
 *   • **More accurate.** The window is exactly seven days from *our* samples,
 *     not a vendor's rolling smoothed one, and it is computed from the same
 *     series the score's magnitude term uses, so the two agree by construction.
 *   • **Ours.** Every competitor can buy the same vendor feed tomorrow. None of
 *     them can buy our stored history of it. This file is the only part of the
 *     data layer that compounds.
 *
 * ── Local-first, by product decision ─────────────────────────────────────────
 *
 * There is no backend. That is a deliberate product decision, not an
 * oversight — the app ships as a static client against curated data plus
 * optional live adapters, and adding a database to store six floats a day would
 * be the largest architectural commitment in the codebase, made for the
 * smallest feature in it.
 *
 * So history lives in `localStorage`, behind {@link SnapshotStore}. Every
 * exported function goes through that seam and none of them touch
 * `localStorage` directly, so a server implementation replaces the store via
 * {@link setSnapshotStore} and nothing else changes — no caller is aware of
 * where the bytes live. The one thing a server implementation will want that
 * this interface does not offer is asynchrony; the sync signatures are the
 * local-first constraint showing through, and moving to a real backend means
 * adding async variants alongside these rather than reshaping them.
 *
 * ── SSR safety ───────────────────────────────────────────────────────────────
 *
 * Nothing here touches storage at module scope or during render. Storage is
 * resolved lazily, inside the call, and resolves to `null` on the server —
 * where every read degrades to "no history" and every write is a no-op. That is
 * the correct behaviour for a per-device store: the server genuinely has no
 * history for this user, and any component rendering history must handle the
 * empty case regardless, since it is also the state of every first-time visitor.
 *
 * The parsed archive is memoised in module-scope `let`s, but they are only ever
 * *populated* from inside a call, never at import time.
 *
 * ── Write cost ───────────────────────────────────────────────────────────────
 *
 * `localStorage` has no partial write: persisting one new row means serialising
 * the entire archive. At the cap that is 1.5M characters, so a naive
 * write-through `recordSnapshot` called once per event would cost a 241×1.5M
 * character stringify per sweep — hundreds of megabytes of work on a phone, to
 * store six floats.
 *
 * Two things keep that honest. Size is tracked *incrementally* rather than by
 * re-serialising to check the cap, so the common path never measures. And
 * {@link recordSnapshots} exists: a sweep runner appends the whole batch and
 * pays exactly one serialisation. {@link recordSnapshot} is the single-item
 * convenience and still writes through, because a lost sample is worse than a
 * slow one — but a caller with a batch in hand should never use it in a loop.
 */

import type { BuzzSignals } from '@/lib/types';
import { clamp } from '@/lib/buzz/dates';

// ─────────────────────────────────────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalSnapshot {
  eventId: string;
  /** ISO 8601 timestamp of the *observation*, not of the write. */
  at: string;
  signals: BuzzSignals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard ceiling on the serialised archive, in JSON characters.
 *
 * `localStorage` quota is nominally ~5 MB per origin, but the unit is not
 * agreed: Chrome and Firefox count UTF-16 code units against roughly 5M of
 * them, while some engines account the underlying bytes, which halves the
 * effective budget for an ASCII-ish payload. 1.5M characters is safe under
 * either reading — at worst 3 MB — and leaves the majority of the origin's
 * quota to the things that were there first: the persisted social store, the
 * profile store, and whatever zustand adds next. A history feature that evicts
 * a member's own authored interest signals to make room for telemetry has its
 * priorities exactly backwards.
 *
 * This is the constraint that actually binds. See {@link RETENTION_DAYS}.
 */
export const MAX_STORED_CHARS = 1_500_000;

/**
 * Soft retention window, in days.
 *
 * Ninety days is chosen to *match* the cap rather than to be independent of it.
 * A row encodes to 58 characters at the shipped calendar's signal magnitudes
 * (measured, not estimated — see {@link encodeRow}), so 241 events sampled once
 * a day cost ≈14,050 characters/day and 90 days of it is ≈1.26M: 84% of
 * {@link MAX_STORED_CHARS}, with the remaining headroom absorbing longer event
 * ids and larger counts. The two numbers are deliberately consistent — a
 * retention window the cap could never honour would be a lie told in a constant.
 *
 * Ninety days is also more than the feature needs. `computeVelocity` looks back
 * at most {@link VELOCITY_MAX_GAP_DAYS}; the rest of the window exists so a
 * quarter-long sparkline is possible without a second store, and so an event in
 * the scheduler's weekly band still accumulates a dozen samples before anything
 * is dropped.
 *
 * Soft because the cap wins whenever sampling is denser than the once-a-day
 * this budget assumes — and it will be, since the demand tier runs six-hourly
 * inside ten days of a decision point. At that density oldest-first eviction
 * cuts well inside 90 days. Treat 90 as the ceiling on retention, never a floor,
 * and note that only {@link pruneHistory} applies the age window at all: the
 * write path enforces the caps, not the calendar.
 */
export const RETENTION_DAYS = 90;

/**
 * Per-event row ceiling — two samples a day across the retention window.
 *
 * The demand tier's fastest cadence is six-hourly, so a single event *can*
 * legitimately produce four rows a day for the fortnight before a decision
 * point. This cap does not stop that; it stops the pathological case, where a
 * caller wires `recordSnapshot` into a render or a tight poll and one event
 * quietly eats the archive, evicting 240 other events' history on the way. The
 * global cap alone cannot prevent that, because it is oldest-first and blind to
 * which event the rows belong to.
 */
export const MAX_ROWS_PER_EVENT = RETENTION_DAYS * 2;

// ─────────────────────────────────────────────────────────────────────────────
// Wire format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A snapshot on disk: timestamp first, then the six signals in a fixed order.
 *
 * A flat tuple rather than an object because the field names are the dominant
 * cost — `{"socialMentions":412000}` is 25 characters of which 17 are the same
 * key repeated in every row of every event. Positional encoding takes a
 * ~150-character object down to a measured 58 and roughly triples the retention
 * the cap can afford. The order is frozen by {@link SIGNAL_ORDER} and versioned by
 * {@link ARCHIVE_VERSION}; changing either without bumping the version corrupts
 * every stored history in the field.
 */
export type SnapshotRow = [
  at: string,
  socialMentions: number,
  socialVelocity: number,
  searchInterest: number,
  mediaMentions: number,
  bookingPressure: number,
  exclusivity: number,
];

export const SIGNAL_ORDER = [
  'socialMentions',
  'socialVelocity',
  'searchInterest',
  'mediaMentions',
  'bookingPressure',
  'exclusivity',
] as const;

export interface SnapshotArchive {
  v: number;
  /** eventId → rows, always ascending by `at`. */
  e: Record<string, SnapshotRow[]>;
}

/** Bump on any change to {@link SnapshotRow} or {@link SIGNAL_ORDER}. */
export const ARCHIVE_VERSION = 1;

export const STORAGE_KEY = 'meridian.signals.history.v1';

const MS_PER_DAY = 86_400_000;

const emptyArchive = (): SnapshotArchive => ({ v: ARCHIVE_VERSION, e: {} });

/**
 * Round before storing. Not cosmetic — a raw `0.12345678901234` costs 16
 * characters against the cap and claims fourteen digits of precision for a
 * number the vendor derived from a smoothed weekly series. Counts are integers,
 * bounded ratios keep 4dp (finer than any consumer renders), and
 * `searchInterest` keeps 2dp of its 0..100 index.
 */
const roundTo = (n: number, dp: number): number => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function encodeRow(at: string, s: BuzzSignals): SnapshotRow {
  return [
    at,
    Math.round(Number.isFinite(s.socialMentions) ? s.socialMentions : 0),
    roundTo(clamp(s.socialVelocity, -1, 1), 4),
    roundTo(s.searchInterest, 2),
    Math.round(Number.isFinite(s.mediaMentions) ? s.mediaMentions : 0),
    roundTo(clamp(s.bookingPressure, 0, 1), 4),
    roundTo(clamp(s.exclusivity, 0, 1), 4),
  ];
}

function decodeRow(eventId: string, row: SnapshotRow): SignalSnapshot {
  return {
    eventId,
    at: row[0],
    signals: {
      socialMentions: row[1],
      socialVelocity: row[2],
      searchInterest: row[3],
      mediaMentions: row[4],
      bookingPressure: row[5],
      exclusivity: row[6],
    },
  };
}

const isRow = (r: unknown): r is SnapshotRow =>
  Array.isArray(r) &&
  r.length === 7 &&
  typeof r[0] === 'string' &&
  !Number.isNaN(Date.parse(r[0])) &&
  r.slice(1).every((n) => typeof n === 'number' && Number.isFinite(n));

const byAt = (a: SnapshotRow, b: SnapshotRow): number =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

// ─────────────────────────────────────────────────────────────────────────────
// The storage seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything this module knows about persistence.
 *
 * Three synchronous operations over the whole archive. Whole-archive rather
 * than per-event because `localStorage` has no partial write — a key-per-event
 * scheme would turn one `setItem` into 241, and one prune into a scan of the
 * entire origin. A server implementation will want per-event reads, and should
 * add them as new methods rather than reshaping these; the exported functions
 * are the contract callers depend on, not this.
 *
 * `save` may throw (quota); callers here handle it.
 */
export interface SnapshotStore {
  load(): SnapshotArchive | null;
  save(archive: SnapshotArchive): void;
  clear(): void;
}

/**
 * Resolve `localStorage`, or `null` when it is unavailable.
 *
 * Null on the server (no global), null in Safari private browsing (where the
 * property exists but throws on access or on write), and null when an extension
 * or a strict storage policy has disabled it. Every call site treats null as
 * "no history", never as an error — telemetry must not be able to break a
 * render.
 *
 * Read through `globalThis` rather than `window` so this also resolves inside a
 * worker, and so a harness can install a shim without inventing a `window`.
 */
function resolveLocalStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') return null;
    return ls;
  } catch {
    return null;
  }
}

/**
 * The default store. Parses defensively: any malformed or wrong-version payload
 * is discarded rather than repaired. History is a nice-to-have derived from
 * data we can refetch, so dropping a corrupt archive costs at most a week of
 * velocity precision, while attempting to salvage it risks feeding garbage into
 * a ranking model.
 */
export const localStorageSnapshotStore: SnapshotStore = {
  load(): SnapshotArchive | null {
    const ls = resolveLocalStorage();
    if (!ls) return null;

    let raw: string | null;
    try {
      raw = ls.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
    if (!raw) return emptyArchive();

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyArchive();
      const candidate = parsed as Partial<SnapshotArchive>;
      if (candidate.v !== ARCHIVE_VERSION || !candidate.e || typeof candidate.e !== 'object') {
        return emptyArchive();
      }
      const archive = emptyArchive();
      for (const [eventId, rows] of Object.entries(candidate.e)) {
        if (!Array.isArray(rows)) continue;
        const kept = (rows as unknown[]).filter(isRow);
        if (kept.length) archive.e[eventId] = kept.sort(byAt);
      }
      return archive;
    } catch {
      return emptyArchive();
    }
  },

  save(archive: SnapshotArchive): void {
    const ls = resolveLocalStorage();
    if (!ls) return;
    ls.setItem(STORAGE_KEY, JSON.stringify(archive));
  },

  clear(): void {
    const ls = resolveLocalStorage();
    if (!ls) return;
    try {
      ls.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to do — the next save overwrites */
    }
  },
};

let store: SnapshotStore = localStorageSnapshotStore;

/**
 * Swap the persistence backend. Pass `null` to restore the `localStorage`
 * default. This is the seam a server implementation replaces, and the seam a
 * harness uses; no other part of this module knows where bytes go.
 *
 * Drops the in-memory cache, so the next read comes from the new backend.
 */
export function setSnapshotStore(next: SnapshotStore | null): void {
  store = next ?? localStorageSnapshotStore;
  cache = null;
  cacheChars = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache and size accounting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parsed archive, memoised. Declared at module scope but never *populated*
 * there — it stays `null` until the first call, which is what keeps this module
 * import-safe on the server and during render.
 *
 * Memoising matters: without it, every write would `JSON.parse` up to 1.5M
 * characters, and a sweep writes 241 times.
 */
let cache: SnapshotArchive | null = null;

/**
 * Running estimate of `JSON.stringify(cache).length`.
 *
 * Exact after any load, prune or explicit measurement; maintained by addition
 * on each appended row in between. The estimate can only drift *upward* from
 * truth — it charges every new event key in full and never credits back the
 * separators saved when an event empties out — so treating it as the cap check
 * is conservative: we can prune slightly early, never late.
 *
 * The point of it is that the common path (append a row, still far from the
 * cap) never serialises the archive just to ask how big it is.
 */
let cacheChars = 0;

/** Exact serialised length. Only called when the estimate says it matters. */
const measure = (archive: SnapshotArchive): number => JSON.stringify(archive).length;

/**
 * Characters a row adds. `,` separator plus the row's own JSON. A new event key
 * additionally costs `"id":[]` and its separator.
 */
const rowChars = (row: SnapshotRow): number => JSON.stringify(row).length + 1;
const eventKeyChars = (eventId: string): number => eventId.length + 2 + 1 + 2 + 1;

/**
 * Above this fraction of the cap, stop trusting the running estimate and
 * measure exactly before deciding to prune. Below it the estimate's upward
 * drift cannot possibly have crossed the cap, so the check is free.
 */
const EXACT_MEASURE_THRESHOLD = 0.9;

function readArchive(): SnapshotArchive | null {
  if (cache) return cache;
  const loaded = store.load();
  if (!loaded) return null; // storage unavailable — server, or blocked
  cache = loaded;
  cacheChars = measure(loaded);
  return cache;
}

function persist(archive: SnapshotArchive): void {
  cache = archive;
  try {
    store.save(archive);
  } catch {
    // Almost always QuotaExceededError, and usually because something *else* on
    // the origin grew. Shed a quarter of the oldest history and try once more;
    // if that still fails, keep the in-memory copy and stay quiet. A failed
    // telemetry write must never surface to a member.
    const total = countRows(archive);
    if (total > 0) {
      dropOldest(archive, Math.max(1, Math.ceil(total * 0.25)));
      cacheChars = measure(archive);
      try {
        store.save(archive);
      } catch {
        /* give up until the next write */
      }
    }
  }
}

/** Diagnostics: drop everything, including the memoised copy. */
export function clearHistory(): void {
  cache = null;
  cacheChars = 0;
  store.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruning
// ─────────────────────────────────────────────────────────────────────────────

function countRows(archive: SnapshotArchive): number {
  let n = 0;
  for (const rows of Object.values(archive.e)) n += rows.length;
  return n;
}

/**
 * Drop the `n` globally oldest rows, across all events. Returns the number
 * actually removed. Mutates.
 *
 * Oldest-first *globally* rather than per-event: an event that stopped being
 * sampled six weeks ago should lose its history before a live one loses this
 * morning's sample, and a per-event policy cannot see that.
 */
function dropOldest(archive: SnapshotArchive, n: number): number {
  if (n <= 0) return 0;

  const stamps: string[] = [];
  for (const rows of Object.values(archive.e)) for (const r of rows) stamps.push(r[0]);
  if (!stamps.length) return 0;
  if (n >= stamps.length) {
    archive.e = {};
    return stamps.length;
  }
  stamps.sort();

  // Cut strictly below the boundary stamp, then take whatever ties remain from
  // the front, so an exact `n` is honoured even when many rows share a stamp —
  // which they routinely do, because a sweep writes one timestamp across the
  // entire calendar.
  const boundary = stamps[n];
  let removed = 0;
  for (const [eventId, rows] of Object.entries(archive.e)) {
    const kept = rows.filter((r) => r[0] >= boundary);
    if (kept.length === rows.length) continue;
    removed += rows.length - kept.length;
    if (kept.length) archive.e[eventId] = kept;
    else delete archive.e[eventId];
  }

  let stillNeeded = n - removed;
  if (stillNeeded > 0) {
    for (const [eventId, rows] of Object.entries(archive.e)) {
      if (stillNeeded <= 0) break;
      let i = 0;
      while (i < rows.length && stillNeeded > 0 && rows[i][0] === boundary) {
        i += 1;
        stillNeeded -= 1;
      }
      if (i === 0) continue;
      removed += i;
      const kept = rows.slice(i);
      if (kept.length) archive.e[eventId] = kept;
      else delete archive.e[eventId];
    }
  }

  return removed;
}

/** Trim any event over {@link MAX_ROWS_PER_EVENT}, oldest first. */
function enforcePerEventCap(archive: SnapshotArchive): number {
  let removed = 0;
  for (const [eventId, rows] of Object.entries(archive.e)) {
    if (rows.length <= MAX_ROWS_PER_EVENT) continue;
    const excess = rows.length - MAX_ROWS_PER_EVENT;
    archive.e[eventId] = rows.slice(excess);
    removed += excess;
  }
  return removed;
}

/**
 * Bring the archive under {@link MAX_STORED_CHARS}, oldest first. Leaves
 * `cacheChars` exact.
 *
 * Iterative rather than analytic because encoded size is not exactly linear in
 * row count — per-event key overhead disappears in steps as events empty out.
 * Each pass estimates the rows to shed from the current average row cost,
 * overshoots by 5% so it converges from above, and re-measures. In practice it
 * settles in one or two passes; the loop bound is defensive.
 */
function enforceSizeCap(archive: SnapshotArchive): number {
  let removed = 0;
  let size = measure(archive);
  for (let pass = 0; pass < 8 && size > MAX_STORED_CHARS; pass += 1) {
    const rows = countRows(archive);
    if (!rows) break;
    const avg = size / rows;
    const over = size - MAX_STORED_CHARS;
    removed += dropOldest(archive, Math.max(1, Math.ceil((over / avg) * 1.05)));
    size = measure(archive);
  }
  cacheChars = size;
  return removed;
}

/**
 * Drop everything older than `maxAgeDays`, then enforce the per-event and
 * global size caps. Returns the total number of snapshots removed.
 *
 * All three matter and they bind under different conditions: the age window is
 * what runs in normal operation, the per-event cap catches a runaway caller,
 * and the size cap is what saves us when sampling turns out denser than the
 * 90-day budget assumed — six-hourly sampling of a calendar deep in the endgame
 * band would cross the cap in about three weeks. Age first, then size, so a
 * prune never evicts recent history while stale history is still sitting there.
 *
 * A no-op returning 0 when storage is unavailable (server, blocked).
 */
export function pruneHistory(maxAgeDays: number): number {
  const archive = readArchive();
  if (!archive) return 0;

  let removed = 0;

  if (Number.isFinite(maxAgeDays) && maxAgeDays >= 0) {
    const cutoff = new Date(Date.now() - maxAgeDays * MS_PER_DAY).toISOString();
    for (const [eventId, rows] of Object.entries(archive.e)) {
      const kept = rows.filter((r) => r[0] >= cutoff);
      if (kept.length === rows.length) continue;
      removed += rows.length - kept.length;
      if (kept.length) archive.e[eventId] = kept;
      else delete archive.e[eventId];
    }
  }

  removed += enforcePerEventCap(archive);
  removed += enforceSizeCap(archive); // leaves cacheChars exact

  if (removed) persist(archive);
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert one row into the in-memory archive and update the size estimate.
 * Does not persist. Returns false when the snapshot was unusable.
 *
 * Rows are kept ascending by `at`. An out-of-order write (a backfill, a
 * clock-skewed device) is inserted in position rather than appended, because
 * every read below assumes the ordering and re-sorting on read would cost far
 * more than the rare insert does.
 *
 * A duplicate `at` for the same event **replaces** the existing row rather than
 * appending beside it. Two observations bearing the same timestamp are the same
 * observation written twice — a re-run, a double-mounted effect — and letting
 * both stand would put a zero-gap pair into the series that `computeVelocity`
 * would then have to defend against.
 */
function insert(archive: SnapshotArchive, s: SignalSnapshot): boolean {
  if (!s || !s.eventId || !s.at || Number.isNaN(Date.parse(s.at))) return false;

  const row = encodeRow(s.at, s.signals);
  const existingRows = archive.e[s.eventId];
  const rows = existingRows ?? [];
  if (!existingRows) {
    archive.e[s.eventId] = rows;
    cacheChars += eventKeyChars(s.eventId);
  }

  const dupe = rows.findIndex((r) => r[0] === row[0]);
  if (dupe >= 0) {
    cacheChars += rowChars(row) - rowChars(rows[dupe]);
    rows[dupe] = row;
    return true;
  }

  if (!rows.length || rows[rows.length - 1][0] <= row[0]) {
    rows.push(row);
  } else {
    let i = rows.length;
    while (i > 0 && rows[i - 1][0] > row[0]) i -= 1;
    rows.splice(i, 0, row);
  }
  cacheChars += rowChars(row);

  if (rows.length > MAX_ROWS_PER_EVENT) {
    const excess = rows.splice(0, rows.length - MAX_ROWS_PER_EVENT);
    for (const r of excess) cacheChars -= rowChars(r);
  }
  return true;
}

/**
 * Append a whole batch, then persist once. **The API a sweep runner should
 * use** — see the write-cost note in the file header.
 *
 * Order within the batch does not matter; each row is placed by timestamp.
 * Silently does nothing when storage is unavailable.
 */
export function recordSnapshots(batch: readonly SignalSnapshot[]): void {
  if (!batch || !batch.length) return;
  const archive = readArchive();
  if (!archive) return;

  let inserted = 0;
  for (const s of batch) if (insert(archive, s)) inserted += 1;
  if (!inserted) return;

  if (cacheChars > MAX_STORED_CHARS * EXACT_MEASURE_THRESHOLD) {
    cacheChars = measure(archive);
    if (cacheChars > MAX_STORED_CHARS) enforceSizeCap(archive);
  }
  persist(archive);
}

/**
 * Append one observation and persist.
 *
 * Write-through rather than debounced: a lost sample is worse than a slow one,
 * and a deferred flush would need unload listeners this module has no business
 * registering. The cost is one serialisation of the archive, so a caller with
 * many snapshots in hand must use {@link recordSnapshots} instead of calling
 * this in a loop.
 *
 * Silently does nothing when storage is unavailable.
 */
export function recordSnapshot(s: SignalSnapshot): void {
  recordSnapshots([s]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An event's stored history, oldest first.
 *
 * `sinceDays` filters relative to the wall clock at call time; omit it for
 * everything retained. Returns `[]` — never null, never throws — when storage
 * is unavailable or the event has never been sampled, which is also the
 * server-render answer and the first-visit answer.
 */
export function historyFor(eventId: string, sinceDays?: number): SignalSnapshot[] {
  const archive = readArchive();
  if (!archive) return [];
  const rows = archive.e[eventId];
  if (!rows || !rows.length) return [];

  let selected = rows;
  if (typeof sinceDays === 'number' && Number.isFinite(sinceDays) && sinceDays >= 0) {
    const cutoff = new Date(Date.now() - sinceDays * MS_PER_DAY).toISOString();
    selected = rows.filter((r) => r[0] >= cutoff);
  }
  return selected.map((r) => decodeRow(eventId, r));
}

// ─────────────────────────────────────────────────────────────────────────────
// Velocity
// ─────────────────────────────────────────────────────────────────────────────

/** The window `socialVelocity` is defined over in `types.ts`. */
export const VELOCITY_WINDOW_DAYS = 7;

/**
 * Minimum usable gap between the two compared samples.
 *
 * Below three days the pair is essentially one measurement read twice, and the
 * ratio is dominated by whatever diurnal or sampling noise sits on top of the
 * count. Extrapolating a twelve-hour wobble out to a weekly rate would
 * manufacture a surge out of nothing — precisely the failure that would make a
 * computed signal worse than a bought one.
 */
export const VELOCITY_MIN_GAP_DAYS = 3;

/**
 * Maximum usable gap.
 *
 * Beyond three weeks the pair describes a monthly trend, not a weekly one, and
 * compressing it back to a week both understates a real move and dresses up a
 * stale sample as current. Three weeks also covers the worst legitimate case:
 * an event in the scheduler's weekly band still leaves a usable 14-day pair
 * after a missed sweep.
 */
export const VELOCITY_MAX_GAP_DAYS = 21;

/**
 * Week-over-week change in mention volume, −1 .. 1, computed from our own
 * stored history.
 *
 * Drop-in for `BuzzSignals.socialVelocity`: same definition, same range, same
 * base series (`socialMentions`, the absolute count the vendor derives its own
 * delta from). Computing it here rather than reading the vendor's means the
 * window is exactly ours and agrees by construction with the magnitude term in
 * the same score.
 *
 * ── Honest degradation — read this before wiring it in ───────────────────────
 *
 * **Returns exactly `0` whenever it cannot measure**, and `0` is also a real
 * value in this range ("flat"), so a caller cannot distinguish "we measured no
 * change" from "we have nothing to measure with". That is deliberate — the
 * range is fixed by `types.ts` and there is no sentinel available inside it —
 * and it makes the rule for callers:
 *
 *     **`0` means keep using the vendor-supplied
 *     `event.signals.socialVelocity`. Only override the vendor value when this
 *     returns non-zero.**
 *
 * Do not read a `0` as "the event is flat". Under the buzz model a flat event
 * still earns half the velocity weight (9 of 100 points, see
 * `normaliseSignals`), so writing a spurious `0` over a vendor `+0.4` is not a
 * neutral act — it silently takes points off a genuinely accelerating event.
 *
 * It returns `0` when:
 *   • storage is unavailable (server render, blocked, first visit);
 *   • the event has fewer than two samples at or before `now` — the stated
 *     floor, and the reason for it is that one point is a level, never a rate;
 *   • no sample sits {@link VELOCITY_MIN_GAP_DAYS}..{@link VELOCITY_MAX_GAP_DAYS}
 *     days before the latest one, so nothing honestly describable as
 *     week-over-week exists;
 *   • both compared samples recorded zero mentions.
 *
 * ── The arithmetic ───────────────────────────────────────────────────────────
 *
 * Anchor on the newest sample at or before `now`; pick as comparison the sample
 * closest to seven days before it, among those inside the usable gap band. Then
 * normalise the observed change to a seven-day rate *geometrically*:
 *
 *     velocity = clamp( (recent / prior) ^ (7 / gapDays) − 1, −1, 1 )
 *
 * Compounding rather than linear scaling, because mention volume grows
 * multiplicatively. A five-day 20% rise is a weekly 29% rise, not 28%; more to
 * the point, a 14-day doubling is a weekly 41% rise, where linear halving would
 * claim 50%. With `gapDays` bounded to 3..21 the exponent is bounded to
 * 1/3..7/3, so the extrapolation can never run away.
 *
 * A prior of zero has no ratio. Rather than return `0` — which would read as
 * "flat" for what is in fact the largest possible move — a rise from nothing to
 * something returns `1`, a fall to nothing returns `−1`, and nothing-to-nothing
 * returns `0`.
 */
export function computeVelocity(eventId: string, now?: string): number {
  const archive = readArchive();
  if (!archive) return 0;
  const rows = archive.e[eventId];
  if (!rows || rows.length < 2) return 0;

  const nowMs = now ? Date.parse(now.length === 10 ? `${now}T00:00:00.000Z` : now) : Date.now();
  if (Number.isNaN(nowMs)) return 0;

  // Newest sample at or before `now`. Rows are ascending, so scan from the end.
  let recentIdx = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (Date.parse(rows[i][0]) <= nowMs) {
      recentIdx = i;
      break;
    }
  }
  if (recentIdx < 1) return 0; // no anchor, or nothing before it

  const recent = rows[recentIdx];
  const recentMs = Date.parse(recent[0]);
  const targetMs = recentMs - VELOCITY_WINDOW_DAYS * MS_PER_DAY;

  let prior: SnapshotRow | null = null;
  let bestDistance = Infinity;
  for (let i = recentIdx - 1; i >= 0; i -= 1) {
    const ms = Date.parse(rows[i][0]);
    const gapDays = (recentMs - ms) / MS_PER_DAY;
    if (gapDays < VELOCITY_MIN_GAP_DAYS) continue;
    if (gapDays > VELOCITY_MAX_GAP_DAYS) break; // ascending — everything earlier is worse
    const distance = Math.abs(ms - targetMs);
    if (distance >= bestDistance) break; // distance is unimodal in i; past the minimum
    bestDistance = distance;
    prior = rows[i];
  }
  if (!prior) return 0;

  const recentMentions = recent[1];
  const priorMentions = prior[1];
  if (priorMentions <= 0) return recentMentions > 0 ? 1 : 0;
  if (recentMentions <= 0) return -1;

  const gapDays = (recentMs - Date.parse(prior[0])) / MS_PER_DAY;
  const weekly = (recentMentions / priorMentions) ** (VELOCITY_WINDOW_DAYS / gapDays);
  return clamp(Math.round((weekly - 1) * 1e4) / 1e4, -1, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapshotStats {
  /** False when storage is unavailable — server, blocked, or private mode. */
  available: boolean;
  eventCount: number;
  snapshotCount: number;
  /** Exact serialised length, in JSON characters. */
  storedChars: number;
  /** `storedChars / MAX_STORED_CHARS`, 0..1+. */
  capUsed: number;
  oldest?: string;
  newest?: string;
}

/**
 * Cheap enough for a diagnostics panel, but it does serialise the archive once
 * to report an exact size — do not call it per frame.
 */
export function snapshotStats(): SnapshotStats {
  const archive = readArchive();
  if (!archive) {
    return { available: false, eventCount: 0, snapshotCount: 0, storedChars: 0, capUsed: 0 };
  }
  let oldest: string | undefined;
  let newest: string | undefined;
  for (const rows of Object.values(archive.e)) {
    if (!rows.length) continue;
    const first = rows[0][0];
    const last = rows[rows.length - 1][0];
    if (!oldest || first < oldest) oldest = first;
    if (!newest || last > newest) newest = last;
  }
  const storedChars = measure(archive);
  cacheChars = storedChars;
  return {
    available: true,
    eventCount: Object.keys(archive.e).length,
    snapshotCount: countRows(archive),
    storedChars,
    capUsed: Math.round((storedChars / MAX_STORED_CHARS) * 1e4) / 1e4,
    oldest,
    newest,
  };
}
