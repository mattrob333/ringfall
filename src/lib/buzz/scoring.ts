/**
 * MERIDIAN — the buzz model.
 *
 * This is the product's credibility surface. Every number a member sees on the
 * globe comes out of this file, so the model is deliberately transparent: six
 * named signals, six documented normalisations, six weights that sum to one,
 * then two explicitly-bounded modifiers (proximity, peer lift). No black boxes,
 * no magic constants without a stated rationale.
 *
 * ── Pipeline ────────────────────────────────────────────────────────────────
 *
 *   raw BuzzSignals
 *     → normalise()        each signal to 0..1 with a documented transform
 *     → weighted sum       Σ wᵢ·nᵢ  ∈ 0..1   ("intrinsic heat")
 *     → × proximity(d)     0..1, peaks in the 10–45 day charter window
 *     → × peerLift(p)      1.00..1.18, diminishing returns, multiplicative
 *     → × 100, clamp       final 0..100 score
 *
 * `components` are computed at the *end* of that chain — each is
 * `100 · wᵢ · nᵢ · proximity · peerFactor · clampScale` — so the invariant
 * declared in types.ts ("Sums to `score`") holds exactly rather than
 * approximately. See `assertComponentsSum` and scripts/validate-data.ts.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 *
 * Nothing here reads the clock. `scoreEvents` takes `now` as an ISO date
 * string, defaulted at the call boundary only. Same inputs → byte-identical
 * outputs, which is what makes the histogram in validate-data.ts meaningful and
 * what lets React memoise on `(events, peerCounts, todayISO)`.
 */

import type { BuzzScore, BuzzSignals, HeatLevel, WorldEvent } from '@/lib/types';
import { clamp, clamp01, daysBetween, smoothstep, todayISO } from './dates';

// ─────────────────────────────────────────────────────────────────────────────
// Weights
// ─────────────────────────────────────────────────────────────────────────────

export type SignalWeights = Record<keyof BuzzSignals, number>;

/**
 * Weights sum to exactly 1.0, so the pre-modifier score is a true 0..1 fraction
 * and every component is directly readable as "points of the 100".
 *
 * Rationale for the split — these are demand signals for a charter decision,
 * not for a media dashboard:
 *
 *  socialMentions   .24  Largest single input. Raw chatter volume is the best
 *                        available proxy for "is the world paying attention".
 *                        Heavy-tailed, so log-normalised (below) — otherwise a
 *                        World-Cup-scale outlier flattens everything else.
 *  searchInterest   .20  Second-largest. Search intent is closer to *purchase*
 *                        intent than social chatter is; someone typing
 *                        "Monaco GP paddock club" is further down the funnel
 *                        than someone retweeting a highlight. Already a bounded
 *                        0..100 relative index, so it needs no taming.
 *  socialVelocity   .18  Momentum, not magnitude. Weighted high because this
 *                        product's job is to surface a week *before* it is
 *                        obvious; an event accelerating from a small base is
 *                        more actionable than a large flat one.
 *  bookingPressure  .16  The hard, un-gameable signal — hotel and charter
 *                        scarcity is money already committed. Weighted below
 *                        the attention signals only because it saturates: a
 *                        small destination hits 1.0 easily (Courchevel in
 *                        February) without the event being globally hot.
 *  exclusivity      .12  Structural, not temporal — it barely moves year to
 *                        year. It earns its place because our members select
 *                        on it, but it must not dominate: a sealed guest list
 *                        with nobody talking about it is not a hot week.
 *  mediaMentions    .10  Smallest. Editorial coverage lags social by days and
 *                        correlates heavily with it, so a high weight would be
 *                        double-counting the same underlying attention.
 */
export const DEFAULT_WEIGHTS: SignalWeights = {
  socialMentions: 0.24,
  socialVelocity: 0.18,
  searchInterest: 0.2,
  mediaMentions: 0.1,
  bookingPressure: 0.16,
  exclusivity: 0.12,
};

export const SIGNAL_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof BuzzSignals)[];

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log-normalisation floors and saturations.
 *
 * Both `socialMentions` and `mediaMentions` are power-law distributed: across
 * the curated calendar the top event carries ~2 orders of magnitude more
 * chatter than the median. A linear normalisation (`x / max`) would push the
 * entire middle of the calendar below 0.05 and the globe would show one bright
 * dot and 199 dead ones.
 *
 * So both use a *floored* log transform:
 *
 *     n = (ln(1+x) − ln(1+FLOOR)) / (ln(1+SAT) − ln(1+FLOOR))     clamped 0..1
 *
 * The floor matters as much as the log. A plain `ln(1+x)/ln(1+SAT)` compresses
 * so hard at the bottom that 1k and 10k mentions both land near 0.5 — the log
 * "solves" the outlier problem by destroying all discrimination. Subtracting
 * the floor re-expands the working range: everything at or below FLOOR reads 0,
 * everything at or above SAT reads 1, and the decades in between get the full
 * 0..1 span.
 *
 * FLOOR is set at roughly the 5th percentile of the curated dataset and SAT at
 * roughly the observed maximum, which is why they are stated as absolute counts
 * rather than derived from the data at runtime — deriving them would make an
 * event's score depend on which *other* events happen to be loaded, and two
 * users with different filters would see different numbers for the same event.
 */
export const SOCIAL_MENTIONS_FLOOR = 2_000;
export const SOCIAL_MENTIONS_SAT = 1_500_000;
export const MEDIA_MENTIONS_FLOOR = 10;
export const MEDIA_MENTIONS_SAT = 20_000;

const logNorm = (x: number, floor: number, sat: number): number => {
  const lo = Math.log1p(floor);
  const hi = Math.log1p(sat);
  return clamp01((Math.log1p(Math.max(0, x)) - lo) / (hi - lo));
};

/**
 * Normalise every raw signal to 0..1.
 *
 *  socialMentions   floored log (see above)
 *  mediaMentions    floored log (see above)
 *  searchInterest   linear /100 — it is already a bounded relative index and
 *                   Google's own normalisation has done the taming
 *  socialVelocity   affine  (v+1)/2  from the declared −1..1 range. A flat
 *                   event therefore reads 0.5 and carries *half* the velocity
 *                   weight (9 of 100 points). Deliberate: velocity is a
 *                   modifier on attention, not a magnitude, and zeroing flat
 *                   events would let a single noisy week outrank a fixture.
 *  bookingPressure  identity — already declared 0..1, just clamped
 *  exclusivity      identity — already declared 0..1, just clamped
 */
export function normaliseSignals(s: BuzzSignals): Record<keyof BuzzSignals, number> {
  return {
    socialMentions: logNorm(s.socialMentions, SOCIAL_MENTIONS_FLOOR, SOCIAL_MENTIONS_SAT),
    socialVelocity: clamp01((clamp(s.socialVelocity, -1, 1) + 1) / 2),
    searchInterest: clamp01(s.searchInterest / 100),
    mediaMentions: logNorm(s.mediaMentions, MEDIA_MENTIONS_FLOOR, MEDIA_MENTIONS_SAT),
    bookingPressure: clamp01(s.bookingPressure),
    exclusivity: clamp01(s.exclusivity),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Proximity
// ─────────────────────────────────────────────────────────────────────────────

/** Start of the plateau: below this, booking gets physically hard. */
export const PROXIMITY_PEAK_START = 10;
/** End of the plateau: beyond this, the decision is not yet live. */
export const PROXIMITY_PEAK_END = 45;
/** Multiplier at d = 0 (event starts tomorrow-ish). */
export const PROXIMITY_IMMINENT = 0.8;
/** Asymptotic floor for very distant events — never quite zero. */
export const PROXIMITY_FAR_FLOOR = 0.15;
/** e-folding length of the far-side decay, in days. */
export const PROXIMITY_FAR_TAU = 130;

/**
 * Proximity multiplier, 0 .. 1.
 *
 * The brief: "an event 300 days out should not out-rank one happening next week
 * at similar signal levels". More precisely, the curve encodes the *charter
 * booking window* — the period in which a member can still act on what they
 * see:
 *
 *   d < 0 and already ended → 0.00   nothing to sell
 *   event currently running → 1.00   maximum urgency
 *   0 ≤ d < 10             → 0.80 → 1.00, smoothstepped
 *                                    Tapers *down* toward the event: at four
 *                                    days out the villa is gone, the tail
 *                                    number is spoken for, and surfacing it
 *                                    hard is a worse experience than surfacing
 *                                    something the member can actually book.
 *   10 ≤ d ≤ 45            → 1.00   the plateau. This is the window where a
 *                                    charter, crew and accommodation can all
 *                                    still be assembled without heroics.
 *   d > 45                 → 0.15 + 0.85·e^(−(d−45)/130)
 *                                    Exponential decay to a floor. Sample
 *                                    values: d=90 → 0.75, d=180 → 0.45,
 *                                    d=300 → 0.27, d=425 → 0.20.
 *
 * The 300-vs-7 ratio is therefore ≈ 0.27 : 0.96 — a 3.5× handicap, enough that
 * next week wins at comparable signal levels but not so much that a genuine
 * supernova a year out (Olympics, a Ryder Cup) vanishes from the globe.
 */
export function proximityMultiplier(daysToStart: number, daysToEnd: number): number {
  if (daysToEnd < 0) return 0; // finished
  if (daysToStart <= 0) return 1; // running right now
  if (daysToStart < PROXIMITY_PEAK_START) {
    const t = daysToStart / PROXIMITY_PEAK_START;
    return PROXIMITY_IMMINENT + (1 - PROXIMITY_IMMINENT) * smoothstep(t);
  }
  if (daysToStart <= PROXIMITY_PEAK_END) return 1;
  const over = daysToStart - PROXIMITY_PEAK_END;
  return PROXIMITY_FAR_FLOOR + (1 - PROXIMITY_FAR_FLOOR) * Math.exp(-over / PROXIMITY_FAR_TAU);
}

// ─────────────────────────────────────────────────────────────────────────────
// Peer lift
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum fractional uplift from peer interest. */
export const PEER_LIFT_MAX = 0.18;
/** Peer count at which the uplift is fully saturated. */
export const PEER_LIFT_SAT = 40;
/** Minimum score movement before `peerLift` is reported at all. */
export const PEER_LIFT_REPORT_EPS = 0.25;

/**
 * Peer lift factor, 1.00 .. 1.18.
 *
 * Two deliberate design choices:
 *
 *  1. **Multiplicative, not additive.** Peer interest scales what is already
 *     there. Eight members watching a dead event still yields a dead event —
 *     social pressure cannot manufacture a supernova out of nothing, which is
 *     the stated requirement and also the honest model: our members noticing
 *     something is evidence about *that* something, not a substitute for it.
 *
 *  2. **Log-saturating.** `ln(1+p)/ln(1+40)`. The 1st peer is worth far more
 *     than the 30th — going from 0 to 1 interested member is a real signal,
 *     going from 30 to 31 is noise. Caps at +18%, chosen so peer lift can move
 *     an event across at most one heat band, never two.
 */
export function peerLiftFactor(peerCount: number): number {
  if (!peerCount || peerCount <= 0) return 1;
  const t = clamp01(Math.log1p(peerCount) / Math.log1p(PEER_LIFT_SAT));
  return 1 + PEER_LIFT_MAX * t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Heat thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Heat band lower bounds, measured against the real curated calendar.
 *
 * Target distribution (from the brief): ~3–5% supernova, ~10% blazing,
 * ~20% hot, ~30% warm, remainder smoldering. These thresholds are not
 * theoretical — they were fitted to the actual score histogram produced by this
 * model over the shipped dataset, and `scripts/validate-data.ts` prints that
 * histogram on every run so drift is caught immediately.
 *
 * Measured result over the 237-event shipped calendar (reference date
 * 2026-07-26): supernova 4.6%, blazing 10.1%, hot 19.8%, warm 30.0%,
 * smoldering 35.4%. The bands are *not* evenly spaced — they narrow toward the
 * top, because the score distribution is right-skewed (median ≈ 25, p95 ≈ 62)
 * and equal-width bands would put four fifths of the calendar in smoldering.
 *
 * Absolute rather than percentile-based on purpose: a member who filters to
 * "ski only" must not see the top three ski weeks promoted to supernova. Heat
 * is a property of the event, not of the current view.
 *
 * A consequence worth knowing: because proximity is baked into `score`, the
 * *population* distribution drifts slowly as the calendar rolls forward — an
 * event is smoldering in December and blazing in April. That is the intended
 * behaviour, not threshold drift, and it is why the validator reprints the
 * histogram on every run rather than asserting fixed counts.
 */
export const HEAT_THRESHOLDS = {
  supernova: 62,
  blazing: 50.5,
  hot: 34.5,
  warm: 21,
} as const;

/** Map a 0..100 score to its heat band. */
export function scoreToHeat(score: number): HeatLevel {
  if (score >= HEAT_THRESHOLDS.supernova) return 'supernova';
  if (score >= HEAT_THRESHOLDS.blazing) return 'blazing';
  if (score >= HEAT_THRESHOLDS.hot) return 'hot';
  if (score >= HEAT_THRESHOLDS.warm) return 'warm';
  return 'smoldering';
}

// ─────────────────────────────────────────────────────────────────────────────
// Trend
// ─────────────────────────────────────────────────────────────────────────────

/** How much of `trend` comes from raw social velocity vs. proximity motion. */
export const TREND_VELOCITY_SHARE = 0.68;
/** Gain applied to the 7-day proximity delta before blending. */
export const TREND_PROXIMITY_GAIN = 6;

/**
 * Momentum, −1 (cooling) .. 1 (surging).
 *
 * Social velocity alone is wrong for this product: an event can have perfectly
 * flat chatter and still be "heating up" simply because it is sliding into the
 * bookable window — that is exactly the moment we want the globe to brighten.
 * So trend blends the measured velocity with the *derivative of the proximity
 * curve*: where will this event's proximity multiplier be one week from now?
 *
 * The proximity term goes negative on the near side of the plateau (inside 10
 * days the multiplier is falling), which correctly reads an event as cooling
 * once it is effectively unbookable, and negative again for anything already
 * finished.
 */
export function computeTrend(
  socialVelocity: number,
  daysToStart: number,
  daysToEnd: number,
): number {
  const nowProx = proximityMultiplier(daysToStart, daysToEnd);
  const nextProx = proximityMultiplier(daysToStart - 7, daysToEnd - 7);
  const proxTerm = clamp((nextProx - nowProx) * TREND_PROXIMITY_GAIN, -1, 1);
  return clamp(
    TREND_VELOCITY_SHARE * clamp(socialVelocity, -1, 1) +
      (1 - TREND_VELOCITY_SHARE) * proxTerm,
    -1,
    1,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreOptions {
  /**
   * Reference date, `YYYY-MM-DD`. Defaults to today in UTC — the *only* place
   * the clock is read. Pass it explicitly in tests and in cached server work so
   * results are reproducible.
   */
  now?: string;
  /** eventId → number of peers signalling interest. */
  peerCounts?: Record<string, number>;
  /** Override individual weights. Rescaled to sum to 1 if they do not. */
  weights?: Partial<SignalWeights>;
  /** Per-event signal patches, applied over `event.signals` field-by-field. */
  signalOverrides?: Map<string, Partial<BuzzSignals>>;
}

const EMPTY_COMPONENTS = (): Record<keyof BuzzSignals, number> => ({
  socialMentions: 0,
  socialVelocity: 0,
  searchInterest: 0,
  mediaMentions: 0,
  bookingPressure: 0,
  exclusivity: 0,
});

function resolveWeights(partial?: Partial<SignalWeights>): SignalWeights {
  if (!partial) return DEFAULT_WEIGHTS;
  const merged = { ...DEFAULT_WEIGHTS, ...partial };
  const total = SIGNAL_KEYS.reduce((a, k) => a + merged[k], 0);
  if (total <= 0) return DEFAULT_WEIGHTS;
  if (Math.abs(total - 1) < 1e-9) return merged;
  const scaled = EMPTY_COMPONENTS();
  for (const k of SIGNAL_KEYS) scaled[k] = merged[k] / total;
  return scaled;
}

/**
 * Round to 4 decimal places. Applied to components before they are summed, so
 * the reported `score` is *by construction* the sum of the reported components
 * — no epsilon drift between what we display and what we claim.
 */
const q = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Score a single event. Exported mainly for tests and for the API layer; the
 * app should go through `scoreEvents` so ranks are populated.
 *
 * `rank` is returned as 0 here and filled in by `scoreEvents`.
 */
export function scoreEvent(
  event: WorldEvent,
  opts: ScoreOptions = {},
): BuzzScore {
  const now = opts.now ?? todayISO();
  const weights = resolveWeights(opts.weights);

  const patch = opts.signalOverrides?.get(event.id);
  const signals: BuzzSignals = patch ? { ...event.signals, ...patch } : event.signals;

  const daysToStart = daysBetween(now, event.start);
  const daysToEnd = daysBetween(now, event.end);

  const prox = proximityMultiplier(daysToStart, daysToEnd);
  const peers = opts.peerCounts?.[event.id] ?? 0;
  const peerFactor = peerLiftFactor(peers);

  const trend = computeTrend(signals.socialVelocity, daysToStart, daysToEnd);

  // Past events score exactly 0 with zeroed components — the invariant still
  // holds trivially, and the globe shows them as burnt out rather than absent.
  if (prox === 0) {
    return {
      eventId: event.id,
      score: 0,
      heat: scoreToHeat(0),
      rank: 0,
      components: EMPTY_COMPONENTS(),
      trend,
    };
  }

  const norm = normaliseSignals(signals);

  // Raw (unclamped) weighted contributions after both modifiers.
  const raw = EMPTY_COMPONENTS();
  let rawTotal = 0;
  for (const k of SIGNAL_KEYS) {
    const v = 100 * weights[k] * norm[k] * prox * peerFactor;
    raw[k] = v;
    rawTotal += v;
  }

  // Peer lift can push past 100 only when the intrinsic score is already ≥ 85,
  // but clamp defensively and rescale every component by the same factor so the
  // sum invariant survives the clamp.
  const clampScale = rawTotal > 100 ? 100 / rawTotal : 1;

  const components = EMPTY_COMPONENTS();
  let score = 0;
  for (const k of SIGNAL_KEYS) {
    const v = q(raw[k] * clampScale);
    components[k] = v;
    score += v;
  }
  // `score` is now literally Σ components. Round the sum itself to kill the
  // accumulated binary-float tail, then push the residual into the largest
  // component so equality is exact at display precision.
  const rounded = Math.round(score * 1e4) / 1e4;
  const residual = rounded - score;
  if (residual !== 0) {
    let biggest: keyof BuzzSignals = 'socialMentions';
    for (const k of SIGNAL_KEYS) if (components[k] > components[biggest]) biggest = k;
    components[biggest] = q(components[biggest] + residual);
  }
  score = SIGNAL_KEYS.reduce((a, k) => a + components[k], 0);

  const result: BuzzScore = {
    eventId: event.id,
    score,
    heat: scoreToHeat(score),
    rank: 0,
    components,
    trend,
  };

  if (peers > 0) {
    // What would the score have been with no peers at all? Same arithmetic
    // path, peerFactor = 1.
    const withoutPeers = clampScale === 1 ? score / peerFactor : score;
    const lift = score - withoutPeers;
    if (Math.abs(lift) >= PEER_LIFT_REPORT_EPS) {
      result.peerLift = Math.round(lift * 100) / 100;
    }
  }

  return result;
}

/**
 * Score a set of events and assign 1-based ranks.
 *
 * Returns **sorted by rank** (hottest first). Ties break on `eventId` ascending
 * so the ordering is stable and reproducible across runs and machines — without
 * that, two events with identical signals would swap places between renders and
 * the globe's label de-cluttering would flicker.
 *
 * Pure: no clock access, no mutation of the input array.
 */
export function scoreEvents(events: WorldEvent[], opts: ScoreOptions = {}): BuzzScore[] {
  const now = opts.now ?? todayISO();
  const resolved: ScoreOptions = { ...opts, now };

  const scored = events.map((e) => scoreEvent(e, resolved));

  scored.sort((a, b) => (b.score - a.score) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));

  for (let i = 0; i < scored.length; i++) scored[i].rank = i + 1;
  return scored;
}

/** Convenience: `scoreEvents` keyed by event id. */
export function scoreEventsById(
  events: WorldEvent[],
  opts: ScoreOptions = {},
): Map<string, BuzzScore> {
  const out = new Map<string, BuzzScore>();
  for (const s of scoreEvents(events, opts)) out.set(s.eventId, s);
  return out;
}

/**
 * The invariant from types.ts, as an executable assertion. Used by
 * scripts/validate-data.ts; cheap enough to call in dev if ever needed.
 */
export function assertComponentsSum(score: BuzzScore, epsilon = 1e-6): boolean {
  const sum = SIGNAL_KEYS.reduce((a, k) => a + score.components[k], 0);
  return Math.abs(sum - score.score) <= epsilon;
}
