/**
 * MERIDIAN — timeline relevance.
 *
 * `relevance` answers a different question from `score`. Score asks "how hot is
 * this event, ever?". Relevance asks "how much does this event matter *at the
 * date the scrubber is currently sitting on*?". The globe multiplies the two:
 * a supernova six months away is a dim pinprick until you scrub to it, at which
 * point it becomes a pillar.
 *
 * Relevance is therefore the single value that makes the scrubber feel alive,
 * and it is recomputed on every frame of a drag — it has to be a handful of
 * float ops and nothing else. No allocation, no date parsing beyond two
 * `Date.parse` calls, no lookups.
 */

import type { WorldEvent } from '@/lib/types';
import { clamp01, daysBetween } from './dates';

/**
 * How far past `spanDays` relevance survives before reaching zero, as a
 * multiple of the span. At the default span of 10 days this puts the horizon at
 * 25 days either side of focus — wide enough that scrubbing feels continuous
 * (beacons fade in ahead of you rather than popping), tight enough that a
 * quiet week actually looks quiet.
 */
export const RELEVANCE_HORIZON_MULTIPLE = 2.5;

/**
 * Days from `focusISO` to the event's start.
 *
 * Negative once the event has begun, which is exactly the semantics `Beacon`
 * declares ("Negative if the event has already started"). Note this measures to
 * `start`, not to `end` — a member reading "in 12 days" wants the arrival date.
 */
export function daysUntil(event: WorldEvent, focusISO: string): number {
  return daysBetween(focusISO, event.start);
}

/**
 * Signed distance in whole days from `focusISO` to the nearest edge of the
 * event's run. Zero while the event is in progress on the focus date.
 */
export function daysToWindow(event: WorldEvent, focusISO: string): number {
  if (focusISO < event.start) return daysBetween(focusISO, event.start);
  if (focusISO > event.end) return daysBetween(event.end, focusISO);
  return 0;
}

/**
 * Relevance of `event` at `focusISO`, 0 .. 1.
 *
 *  • **1.0 for the entire run.** A five-day regatta is fully relevant on all
 *    five days, not just its first — the falloff is measured from the nearest
 *    edge of `[start, end]`, so multi-day events hold the plateau across their
 *    whole duration. This is why `daysToWindow` exists rather than reusing
 *    `daysUntil`.
 *
 *  • **Raised-cosine falloff** outside the run:
 *
 *        t = distance / (spanDays × 2.5)
 *        relevance = ½·(1 + cos(π·t))            for t < 1
 *                  = 0                            otherwise
 *
 *    Chosen over linear for two reasons. First, its derivative is zero at both
 *    ends, so a beacon eases out of full brightness and settles into darkness
 *    instead of snapping — with a linear ramp the corner at t=0 is plainly
 *    visible as a "click" in intensity while dragging. Second, it holds value
 *    near the window (0.65 at exactly `spanDays` away) and then drops away
 *    quickly, which matches how a member thinks about a trip: the shoulder days
 *    around an event are nearly as interesting as the event, three weeks either
 *    side is not.
 *
 *    Reference values at the default 10-day span (horizon 25 days):
 *      0d → 1.00   5d → 0.90   10d → 0.65   15d → 0.35   20d → 0.10   25d → 0
 */
export function computeRelevance(
  event: WorldEvent,
  focusISO: string,
  spanDays: number,
): number {
  const dist = Math.abs(daysToWindow(event, focusISO));
  if (dist === 0) return 1;

  const horizon = Math.max(1, spanDays) * RELEVANCE_HORIZON_MULTIPLE;
  if (dist >= horizon) return 0;

  const t = dist / horizon;
  return clamp01(0.5 * (1 + Math.cos(Math.PI * t)));
}

/** True when the event is actually in progress on the focus date. */
export function isLiveOn(event: WorldEvent, focusISO: string): boolean {
  return focusISO >= event.start && focusISO <= event.end;
}
