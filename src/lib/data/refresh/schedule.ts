/**
 * MERIDIAN — proximity-tiered refresh scheduler.
 *
 * ── The problem this exists to solve ─────────────────────────────────────────
 *
 * The naive design polls every source for every event on one fixed interval.
 * At hourly, over the shipped calendar, that is:
 *
 *     241 events × 6 adapters × 24 sweeps/day  =  34,704 calls/day
 *
 * Almost all of it is waste. An event eight months out does not change hourly.
 * Its name has not changed since 1929, its dates were published a year ago, and
 * its demand signals move on a weekly clock at best — Google Trends is itself
 * weekly-smoothed (see `adapters/googleTrends.ts`), so polling it four times a
 * day buys four copies of the same number. We would be paying rate limit, and
 * spending the vendor quota we actually need in the two weeks when the numbers
 * genuinely move, in order to re-read constants.
 *
 * So: **one interval per event is the wrong shape.** Different facts about an
 * event decay at wildly different rates, and the rate at which the *volatile*
 * facts decay is itself a function of how close the event is. This module makes
 * both of those explicit.
 *
 * ── Three tiers, because there are three clocks ──────────────────────────────
 *
 *   identity   What the event *is*. Name, city, venue list, nearest jet port,
 *              category, description, tier, access note. These are close to
 *              immutable; the Monaco Grand Prix has run the same streets since
 *              1929. Quarterly.
 *
 *   schedule   *When* it is. `start`, `end`, cancellation, a venue move. Rare
 *              but consequential — a cancelled fixture that we still show as
 *              live is the single worst thing this product can do. Weekly.
 *
 *   demand     The six `BuzzSignals`. The only genuinely volatile thing about
 *              an event, and the only tier whose cadence varies. Everything
 *              below is about this tier.
 *
 * Splitting the tiers is most of the saving on its own: the two cheap-to-be-
 * wrong tiers stop riding along with the expensive one.
 *
 * ── Why cadence tracks proximity ─────────────────────────────────────────────
 *
 * `src/lib/buzz/scoring.ts` already encodes the shape of member attention as
 * `proximityMultiplier`: a plateau at 1.0 across 10–45 days out (the charter
 * booking window — the period in which aircraft, crew and accommodation can
 * still all be assembled), tapering below 10 days and decaying exponentially
 * beyond 45. That curve says where the score is *sensitive*. This scheduler is
 * its dual: refresh hardest exactly where a signal change would move a score a
 * member is about to act on, and coast where it would not.
 *
 * The band edges here are deliberately the same numbers — 10 and 45 — as
 * `PROXIMITY_PEAK_START` and `PROXIMITY_PEAK_END`. That is not decoration. If
 * the plateau moves, the daily band must move with it, or we will be sampling
 * at weekly resolution inside the window where the score is fully sensitive.
 *
 * ── Why the key is the *decision* horizon, not days-to-start ─────────────────
 *
 * The obvious key is "days until `start`". It is wrong, and `WorldEvent.
 * bookingLeadDays` is why.
 *
 * That field (and its category defaults in `src/lib/alerts/leadTimes.ts`)
 * records when the **scarce, non-scalable** part of a trip is gone: the eight
 * beds on the Sabi Sand, the balcony over the Piazza del Campo, the Debenture
 * on Centre Court. It ranges from 30 days (`culinary` — a three-star line that
 * opens at a fixed horizon and clears in seconds) to 330 days (`safari` — camps
 * rebooked by returning guests as they check out). An eleven-fold spread.
 *
 * Key on days-to-start and the scheduler is blind to that entire spread. A
 * Serengeti river-crossing camp 340 days out would be polled *weekly* — through
 * precisely the fortnight in which every bed on the river is taken. We would
 * have the demand spike in our data a month after the beds were gone, which is
 * worth nothing to a member and is exactly the failure this product exists to
 * prevent. Meanwhile a Michelin three-star 200 days out would be polled at the
 * same weekly rate as everything else, when nothing whatsoever will happen to
 * it for another five months.
 *
 * So the cadence key is the distance to the **next unpassed decision point**:
 *
 *     bookingCutoff = start − leadDaysFor(event)
 *     key = bookingCutoff is still ahead ? daysTo(bookingCutoff) : daysTo(start)
 *
 * Two milestones, taken in order. Before the cut-off, the live question is
 * "can I still get the good version of this?" — and the answer is changing.
 * After it, the good version is gone and the live question reverts to the
 * charter one, "can I still get *there*?", which is what days-to-start
 * measures. Once the cut-off has passed it is simply dropped; an event whose
 * booking window closed a month ago but which is still 300 days out is not
 * urgent, and re-triggering on a milestone already behind us would pin it at
 * six-hourly for the rest of the year.
 *
 * The band *edges* are as specified — 180 / 45 / 10 — and the plateau band is
 * still the 10–45 charter window. Only the axis changed, from "days until the
 * event" to "days until the next thing a member can no longer undo".
 *
 * Measured effect over the shipped 241-event calendar (reference 2026-07-27):
 * keying on the decision horizon moves 68 events into a faster band than
 * days-to-start would have given them, and costs about 30% more calls per day
 * than the naive key. It is worth every one of them — those are the events
 * where the interesting thing is happening now.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 *
 * Same contract as the buzz engine: nothing here reads the clock except through
 * a defaulted `now` parameter. `planSweep` over the same inputs yields the same
 * plan on every machine, which is what makes the cost figures in
 * `cadenceSummary` a claim rather than an anecdote.
 */

import type { WorldEvent } from '@/lib/types';
import { daysBetween, todayISO } from '@/lib/buzz/dates';
import { leadDaysFor } from '@/lib/alerts/leadTimes';

// ─────────────────────────────────────────────────────────────────────────────
// Tiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three refresh clocks. Ordered slowest to fastest, which is also the order
 * they are reported in — a summary table reads top-to-bottom from "never
 * changes" to "changes while you are looking at it".
 */
export type RefreshTier = 'identity' | 'schedule' | 'demand';

/** Canonical tier order. Iterate this rather than `Object.keys` anywhere. */
export const REFRESH_TIERS: readonly RefreshTier[] = ['identity', 'schedule', 'demand'] as const;

export interface RefreshPolicy {
  tier: RefreshTier;
  /** Hours between sweeps of this tier for this event. Always > 0. */
  intervalHours: number;
  /**
   * One line of *why*, naming the milestone that drove it. Written to be read
   * in an ops log or a diagnostics panel by someone deciding whether the
   * scheduler is behaving, not by an analyst.
   */
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intervals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identity: quarterly, 90 days.
 *
 * These fields are effectively frozen. In the curated calendar the only
 * realistic identity change is an editorial one we make ourselves — a rewritten
 * tagline, a corrected FBO rating — and those land by deploy, not by poll. The
 * poll exists to catch the genuinely rare upstream case: a promoter renames the
 * event, or moves it to a different city entirely (Formula E does this most
 * seasons). Quarterly means we are at most one season behind on a fact that
 * changes at most once a decade, at a cost of 11 sweeps/year/event.
 *
 * Not "never", because a scheduler with no floor is a scheduler that silently
 * stops working, and a quarterly heartbeat is also how we notice an adapter's
 * event-id mapping has rotted.
 */
export const IDENTITY_INTERVAL_HOURS = 90 * 24; // 2160

/**
 * Schedule: weekly, 168 hours.
 *
 * Dates for this calendar are published 6–18 months ahead and then essentially
 * never move — but "essentially" is doing real work. Cancellations, postponements
 * and venue moves do happen (weather, politics, a promoter losing a sanction),
 * and showing a member a cancelled fixture as live is the most damaging single
 * error available to us. Weekly is roughly 50× the true rate of change, which is
 * the margin that error justifies, and it costs one call per event per week.
 *
 * Deliberately **flat** — it does not tighten as the event approaches. Two
 * reasons. First, a date change inside the final fortnight is not news that
 * arrives via a signals API; it arrives as a press release, and any member close
 * enough to care is already in a group chat about it. Second, a tier that
 * varies is a tier whose staleness is hard to reason about; the value of
 * `schedule` is that "at most seven days old" is true of every event on the
 * globe without qualification.
 */
export const SCHEDULE_INTERVAL_HOURS = 7 * 24; // 168

/**
 * Demand cadence by distance to the next unpassed decision point.
 *
 * Four bands, ordered far → near. The edges are load-bearing:
 *
 *   > 180 days   weekly (168h)
 *                Beyond six months nothing is happening. Search interest for a
 *                fixture this far out is flat noise, and the vendor series that
 *                would show a change (Trends) is weekly-smoothed anyway, so a
 *                faster poll returns literally the same number. Weekly is the
 *                resolution floor of the underlying data, not a compromise.
 *
 *   45–180 days  every 48h
 *                The long approach. Real movement starts — a line-up
 *                announcement, a ballot opening, the first hotel blocks going —
 *                but on a scale of weeks, not hours. Two samples a week is
 *                enough to see the shape of a trend and to give
 *                `computeVelocity` (see `snapshots.ts`) the ≥3-day sample gap
 *                it needs to produce a meaningful week-over-week figure.
 *
 *   10–45 days   daily (24h)
 *                The plateau — the same 10..45 window as
 *                `PROXIMITY_PEAK_START`/`PROXIMITY_PEAK_END` in
 *                `buzz/scoring.ts`, where the proximity multiplier is pinned at
 *                1.0 and every point of signal movement lands on the score at
 *                full weight. It is also the window in which a member can still
 *                actually assemble the trip. Daily matches the finest genuine
 *                resolution we have: X's own buckets are daily, so this is the
 *                fastest cadence that is not oversampling.
 *
 *   < 10 days    every 6h
 *                Endgame. Inventory is being consumed hour by hour,
 *                `bookingPressure` is the signal that matters and it is the one
 *                that moves fastest, and a member deciding today is deciding on
 *                whatever we last showed them. Four sweeps a day is a
 *                deliberate ceiling rather than "as fast as possible": the
 *                fastest input still has a one-day floor resolution, so hourly
 *                here would buy noise at 4× the price. It also bounds the worst
 *                case — even if the entire calendar collapsed into this band it
 *                would cost 241 × 4 × 5 = 4,820 calls/day, still an 86%
 *                reduction on naive hourly.
 */
export const DEMAND_FAR_INTERVAL_HOURS = 7 * 24; // 168
export const DEMAND_APPROACH_INTERVAL_HOURS = 48;
export const DEMAND_WINDOW_INTERVAL_HOURS = 24;
export const DEMAND_IMMINENT_INTERVAL_HOURS = 6;

/** Above this many days to the decision point, weekly. Six months. */
export const DEMAND_FAR_DAYS = 180;
/**
 * Upper edge of the daily band. Same number as `PROXIMITY_PEAK_END` — the far
 * edge of the charter window. Keep them equal.
 */
export const DEMAND_WINDOW_END_DAYS = 45;
/**
 * Lower edge of the daily band; below it, six-hourly. Same number as
 * `PROXIMITY_PEAK_START` — the point at which the proximity multiplier starts
 * tapering because assembling the trip gets physically hard. Keep them equal.
 */
export const DEMAND_WINDOW_START_DAYS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Adapter fan-out
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upstream calls one sweep of a tier costs, per event.
 *
 * Grounded in the real registry in `src/lib/data/sources.ts`. **Must be kept in
 * sync with it** — these are hard-coded rather than derived because that module
 * is server-only (it reads `process.env`) and importing it here would drag API
 * keys into any client bundle that wants to render a cadence table.
 *
 *   identity  1  The record source. Curated is a local read and free; when a
 *                live record source is wired up it is one event lookup.
 *   schedule  1  Same source, dates only — the same lookup, so it is only ever
 *                one call even when both tiers come due together.
 *   demand    5  The five live signal adapters: ticketmaster, predicthq,
 *                google-trends, x, amadeus. Curated is excluded — it is an
 *                in-process array read, not a call.
 *
 * The three sum to 7, against the 6 adapters the naive baseline counts. That is
 * intentional and conservative: the comparison in `cadenceSummary` charges this
 * scheduler *more* fan-out per sweep than the thing it is being compared to, so
 * the reported multiple is a floor, not a flattering estimate.
 */
export const ADAPTERS_PER_TIER: Record<RefreshTier, number> = {
  identity: 1,
  schedule: 1,
  demand: 5,
};

/**
 * The straw man, for comparison: every adapter, every event, every hour.
 * 6 × 24 = 144 calls per event per day, 34,704 across the shipped calendar.
 */
export const NAIVE_ADAPTER_COUNT = 6;
export const NAIVE_SWEEPS_PER_DAY = 24;
export const NAIVE_CALLS_PER_EVENT_PER_DAY = NAIVE_ADAPTER_COUNT * NAIVE_SWEEPS_PER_DAY;

// ─────────────────────────────────────────────────────────────────────────────
// Horizons
// ─────────────────────────────────────────────────────────────────────────────

export interface RefreshHorizon {
  /** Whole days from `now` to `event.start`. Negative once it has begun. */
  daysToStart: number;
  /** Whole days from `now` to `event.end`. Negative once it is over. */
  daysToEnd: number;
  /** Resolved lead time in days — the per-event override or category default. */
  leadDays: number;
  /** Whole days to `start − leadDays`. Negative once the good version is gone. */
  daysToBookingCutoff: number;
  /**
   * The cadence key: distance in days to the next decision point that has not
   * already passed. See the file header for why this, and not `daysToStart`.
   * Never negative — a running event pins to 0, mirroring `proximityMultiplier`.
   */
  daysToDecision: number;
  /** Which milestone produced `daysToDecision`. Drives the `reason` copy. */
  driver: 'booking-cutoff' | 'event-start';
  /** True once `end` has passed. Such events get no policies at all. */
  finished: boolean;
  /**
   * False when `now`, `start` or `end` did not parse. Such events also get no
   * policies — see {@link policyFor}.
   */
  datesValid: boolean;
}

/**
 * Normalise `now` to the `YYYY-MM-DD` the rest of the engine speaks.
 *
 * Callers legitimately pass a full ISO 8601 timestamp — the cadence bands are
 * day-scale but the due check in {@link dueNow} is hour-scale, so a runner
 * sweeping four times a day has to be able to express the time of day. The date
 * helpers in `buzz/dates.ts` take bare dates only and build
 * `` `${iso}T00:00:00.000Z` `` internally, so handing them a timestamp produces
 * `…ZT00:00:00.000Z` and a silent `NaN`.
 *
 * That failure is not merely wrong, it is wrong in the expensive direction: a
 * `NaN` horizon falls through every band comparison to the six-hourly default,
 * so the whole calendar would quietly poll at the most aggressive cadence
 * available — the exact bill this module exists to avoid. Truncate here, and
 * let {@link RefreshHorizon.datesValid} carry anything still unparseable.
 */
const toDatePart = (now: string): string => (now.length > 10 ? now.slice(0, 10) : now);

/**
 * Resolve every date an event's cadence depends on. Exported because a
 * diagnostics panel wants to show the working, and because it is the one piece
 * of this module worth unit-testing directly.
 *
 * `now` may be `YYYY-MM-DD` or a full ISO 8601 timestamp.
 */
export function horizonFor(event: WorldEvent, now: string = todayISO()): RefreshHorizon {
  const today = toDatePart(now);
  const daysToStart = daysBetween(today, event.start);
  const daysToEnd = daysBetween(today, event.end);
  const leadDays = leadDaysFor(event);

  if (!Number.isFinite(daysToStart) || !Number.isFinite(daysToEnd)) {
    return {
      daysToStart,
      daysToEnd,
      leadDays,
      daysToBookingCutoff: NaN,
      daysToDecision: NaN,
      driver: 'event-start',
      finished: false,
      datesValid: false,
    };
  }

  const daysToBookingCutoff = daysToStart - leadDays;

  // Take the booking cut-off while it is still ahead of us; fall back to the
  // event itself once it is behind. Clamped at 0 so a running event reads as
  // maximally urgent rather than as negative-distance nonsense — the same
  // treatment `proximityMultiplier` gives it.
  const useCutoff = daysToBookingCutoff >= 0;
  const daysToDecision = Math.max(0, useCutoff ? daysToBookingCutoff : daysToStart);

  return {
    daysToStart,
    daysToEnd,
    leadDays,
    daysToBookingCutoff,
    daysToDecision,
    driver: useCutoff ? 'booking-cutoff' : 'event-start',
    finished: daysToEnd < 0,
    datesValid: true,
  };
}

/** The demand interval for a given decision-horizon distance, in hours. */
export function demandIntervalFor(daysToDecision: number): number {
  if (daysToDecision > DEMAND_FAR_DAYS) return DEMAND_FAR_INTERVAL_HOURS;
  if (daysToDecision > DEMAND_WINDOW_END_DAYS) return DEMAND_APPROACH_INTERVAL_HOURS;
  if (daysToDecision >= DEMAND_WINDOW_START_DAYS) return DEMAND_WINDOW_INTERVAL_HOURS;
  return DEMAND_IMMINENT_INTERVAL_HOURS;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function demandReason(h: RefreshHorizon): string {
  const interval = demandIntervalFor(h.daysToDecision);
  const when =
    h.driver === 'booking-cutoff'
      ? h.daysToDecision === 0
        ? 'booking cut-off is today'
        : `booking cut-off in ${plural(h.daysToDecision, 'day')} (${plural(h.leadDays, 'day')} lead)`
      : h.daysToStart <= 0
        ? 'event is running'
        : `starts in ${plural(h.daysToStart, 'day')}, booking cut-off already passed`;

  if (interval === DEMAND_IMMINENT_INTERVAL_HOURS) {
    return `Endgame — ${when}; inventory moves hourly, sample every 6h.`;
  }
  if (interval === DEMAND_WINDOW_INTERVAL_HOURS) {
    return `In the ${DEMAND_WINDOW_START_DAYS}–${DEMAND_WINDOW_END_DAYS}d plateau — ${when}; score is fully proximity-weighted, sample daily.`;
  }
  if (interval === DEMAND_APPROACH_INTERVAL_HOURS) {
    return `Long approach — ${when}; movement is weekly-scale, sample every 48h.`;
  }
  return `Dormant — ${when}; beyond ${DEMAND_FAR_DAYS}d the vendor series are flat, sample weekly.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The refresh policy for one event: one entry per tier, in
 * {@link REFRESH_TIERS} order.
 *
 * Returns an **empty array** in two cases, and callers must read `[]` as "never
 * poll", not as "poll immediately":
 *
 *  • The event's `end` has passed. That is not an omission — it is the same
 *    judgement `proximityMultiplier` makes when it returns 0 for a finished
 *    event: there is nothing left to sell, so there is nothing worth spending a
 *    call on. The record is frozen until the curated set publishes next year's
 *    edition, and that is a dataset change, not a refresh.
 *
 *  • The dates did not parse (`datesValid === false`). Failing to *cheapest*
 *    here is deliberate. An unparseable date is a data defect, and the
 *    alternative — letting a `NaN` horizon fall through the band comparisons —
 *    lands it in the six-hourly band, so one malformed record would cost more
 *    per day than forty correct ones. A defect should not be able to spend
 *    money. `horizonFor` reports the condition so a validator can surface it.
 */
export function policyFor(event: WorldEvent, now: string = todayISO()): RefreshPolicy[] {
  const h = horizonFor(event, now);
  if (!h.datesValid || h.finished) return [];

  return [
    {
      tier: 'identity',
      intervalHours: IDENTITY_INTERVAL_HOURS,
      reason:
        'Name, venues and jet port are effectively frozen; quarterly is a heartbeat that catches a renamed or relocated fixture and proves the id mapping still resolves.',
    },
    {
      tier: 'schedule',
      intervalHours: SCHEDULE_INTERVAL_HOURS,
      reason:
        'Dates are published months ahead and rarely move, but showing a cancelled fixture as live is the worst error available to us; weekly holds "at most 7 days stale" for every event on the globe.',
    },
    {
      tier: 'demand',
      intervalHours: demandIntervalFor(h.daysToDecision),
      reason: demandReason(h),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Due checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Last successful sync per tier, as ISO 8601 timestamps.
 *
 * `Partial` on purpose: a tier that has never been synced has no entry, and a
 * missing entry means **due now**. A caller that hands us a full
 * `Record<RefreshTier, string>` satisfies this type too, so the stricter shape
 * still works.
 */
export type LastSyncedByTier = Partial<Record<RefreshTier, string>>;

const MS_PER_HOUR = 3_600_000;

/**
 * Which tiers of an event are due for a refresh right now.
 *
 * `now` is accepted as either an ISO date (`YYYY-MM-DD`, matching the rest of
 * the engine) or a full ISO 8601 timestamp — the cadence bands are day-scale
 * but the due check is hour-scale, so a caller running four sweeps a day needs
 * to be able to express the time of day. A bare date is read as UTC midnight.
 *
 * A tier is due when it has never synced, when its stored timestamp is
 * unparseable (corrupt state must self-heal by refetching, not by going
 * permanently quiet), or when at least `intervalHours` have elapsed. A
 * timestamp in the future is treated as *not* due — a clock skew should not
 * cause a stampede.
 *
 * Returns tiers in {@link REFRESH_TIERS} order, and `[]` for a finished event.
 */
export function dueNow(
  event: WorldEvent,
  lastSyncedAt: LastSyncedByTier | undefined,
  now: string = todayISO(),
): RefreshTier[] {
  const nowMs = Date.parse(now.length === 10 ? `${now}T00:00:00.000Z` : now);
  if (Number.isNaN(nowMs)) return [];

  const out: RefreshTier[] = [];
  for (const policy of policyFor(event, now)) {
    const stamp = lastSyncedAt?.[policy.tier];
    if (!stamp) {
      out.push(policy.tier);
      continue;
    }
    const lastMs = Date.parse(stamp);
    if (Number.isNaN(lastMs)) {
      out.push(policy.tier);
      continue;
    }
    if (nowMs - lastMs >= policy.intervalHours * MS_PER_HOUR) out.push(policy.tier);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep planning
// ─────────────────────────────────────────────────────────────────────────────

export interface SweepPlan {
  /** Events with at least one due tier, in input order. */
  due: Array<{ eventId: string; tiers: RefreshTier[] }>;
  /**
   * Upstream calls this sweep will cost, using {@link ADAPTERS_PER_TIER}.
   *
   * `identity` and `schedule` both resolve from the same record lookup, so an
   * event with both due is charged **one** call for the pair rather than two —
   * anything else would over-report a cost we do not actually pay.
   */
  callsEstimate: number;
}

/**
 * Plan a single sweep over the whole calendar.
 *
 * Pure and order-stable: `due` follows the input array's order, and tiers
 * within an event follow {@link REFRESH_TIERS}. A worker can therefore diff two
 * consecutive plans and get a meaningful answer.
 *
 * The runner is expected to persist a fresh timestamp per tier it actually
 * completed — not per tier it attempted. A failed fetch must leave the old
 * timestamp standing so the tier comes up due again on the next tick, which is
 * the whole retry mechanism and is why there is no separate one.
 */
export function planSweep(
  events: WorldEvent[],
  lastSynced: Map<string, LastSyncedByTier>,
  now: string = todayISO(),
): SweepPlan {
  const due: SweepPlan['due'] = [];
  let callsEstimate = 0;

  for (const event of events) {
    const tiers = dueNow(event, lastSynced.get(event.id), now);
    if (!tiers.length) continue;
    due.push({ eventId: event.id, tiers });

    // identity + schedule share one record lookup — charge it once.
    const wantsRecord = tiers.includes('identity') || tiers.includes('schedule');
    if (wantsRecord) callsEstimate += ADAPTERS_PER_TIER.identity;
    if (tiers.includes('demand')) callsEstimate += ADAPTERS_PER_TIER.demand;
  }

  return { due, callsEstimate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost reporting
// ─────────────────────────────────────────────────────────────────────────────

export interface CadenceRow {
  tier: RefreshTier;
  /** Hours between sweeps for this bucket. */
  interval: number;
  /** Events currently in this bucket. */
  eventCount: number;
  /** Steady-state upstream calls per day this bucket costs. */
  callsPerDay: number;
}

/**
 * The cadence table: one row per distinct (tier, interval) bucket the current
 * calendar actually occupies, plus the steady-state cost of each.
 *
 * Rows are ordered by {@link REFRESH_TIERS} and then by interval ascending
 * (fastest first), so the table reads worst-cost-first within each tier.
 *
 * Finished events contribute no rows — see {@link policyFor}. `eventCount`
 * therefore sums to the number of *live* events, not to `events.length`, and a
 * caller printing this table should say so.
 *
 * `callsPerDay` charges `identity` and `schedule` their full fan-out
 * independently. That double-counts the shared record lookup relative to what
 * `planSweep` actually charges, and it is left that way on purpose: it is the
 * conservative direction, and it keeps each row a standalone figure rather than
 * one whose meaning depends on another row.
 */
export function cadenceSummary(events: WorldEvent[], now: string = todayISO()): CadenceRow[] {
  const buckets = new Map<string, CadenceRow>();

  for (const event of events) {
    for (const policy of policyFor(event, now)) {
      const key = `${policy.tier}:${policy.intervalHours}`;
      const row = buckets.get(key);
      if (row) {
        row.eventCount += 1;
      } else {
        buckets.set(key, {
          tier: policy.tier,
          interval: policy.intervalHours,
          eventCount: 1,
          callsPerDay: 0,
        });
      }
    }
  }

  const rows = [...buckets.values()];
  for (const row of rows) {
    const sweepsPerDay = 24 / row.interval;
    // Rounded to 2dp: these are fractional by nature (a quarterly tier costs
    // 0.01 calls/event/day) and printing 14 significant figures of float noise
    // in an ops table is worse than useless.
    row.callsPerDay =
      Math.round(row.eventCount * sweepsPerDay * ADAPTERS_PER_TIER[row.tier] * 100) / 100;
  }

  rows.sort((a, b) => {
    const t = REFRESH_TIERS.indexOf(a.tier) - REFRESH_TIERS.indexOf(b.tier);
    return t !== 0 ? t : a.interval - b.interval;
  });

  return rows;
}

export interface CostComparison {
  /** Events that still have a policy at `now`. */
  liveEventCount: number;
  /** Events whose `end` has passed — no longer polled at all. */
  finishedEventCount: number;
  /** Events with unparseable dates — also not polled. Should always be 0. */
  undatedEventCount: number;
  /** `events.length × 6 adapters × 24 sweeps`. */
  naiveCallsPerDay: number;
  /** Sum of {@link cadenceSummary}'s `callsPerDay`. */
  scheduledCallsPerDay: number;
  /** `naive / scheduled`, rounded to 1dp. The headline number. */
  reductionMultiple: number;
  /** Percentage of naive traffic eliminated, rounded to 1dp. */
  savedPercent: number;
}

/**
 * The scheduler's cost against the naive-hourly straw man. This is the number
 * the decision was made on, so it is computed rather than asserted, and it is
 * computed from the same `cadenceSummary` a diagnostics panel would render —
 * there is no second, friendlier arithmetic path.
 */
export function costComparison(events: WorldEvent[], now: string = todayISO()): CostComparison {
  const rows = cadenceSummary(events, now);
  const scheduled = rows.reduce((a, r) => a + r.callsPerDay, 0);

  let finished = 0;
  let undated = 0;
  for (const event of events) {
    const h = horizonFor(event, now);
    if (!h.datesValid) undated += 1;
    else if (h.finished) finished += 1;
  }

  const naive = events.length * NAIVE_CALLS_PER_EVENT_PER_DAY;
  const round1 = (n: number): number => Math.round(n * 10) / 10;

  return {
    liveEventCount: events.length - finished - undated,
    finishedEventCount: finished,
    undatedEventCount: undated,
    naiveCallsPerDay: naive,
    scheduledCallsPerDay: Math.round(scheduled * 100) / 100,
    reductionMultiple: scheduled > 0 ? round1(naive / scheduled) : Infinity,
    savedPercent: naive > 0 ? round1(100 * (1 - scheduled / naive)) : 0,
  };
}
