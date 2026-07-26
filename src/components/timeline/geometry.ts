/**
 * The one place that converts between dates and pixels.
 *
 * Every layer of the scrubber — the density ribbon in canvas, the SVG-free
 * month rail, the event markers, the drag handle — has to agree on where a
 * given day sits, to the pixel. They agree because they all call this.
 *
 * The track is divided into `totalDays + 1` equal columns, one per selectable
 * day. A day's *centre* is what the handle and markers snap to; the ribbon
 * paints the full column. Any other convention leaves the handle sitting half
 * a column off the bar it is pointing at, which is visible and maddening.
 */

import { addDays, daysBetween } from '@/lib/stores/useTimelineStore';

export interface Geometry {
  rangeStart: string;
  rangeEnd: string;
  /** Index of the last selectable day. Day count is `totalDays + 1`. */
  totalDays: number;
  width: number;
  /** Width of one day's column, px. */
  colWidth: number;
}

export function makeGeometry(
  rangeStart: string,
  rangeEnd: string,
  width: number,
): Geometry {
  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));
  return {
    rangeStart,
    rangeEnd,
    totalDays,
    width,
    colWidth: width / (totalDays + 1),
  };
}

export const clampIndex = (g: Geometry, i: number): number =>
  i < 0 ? 0 : i > g.totalDays ? g.totalDays : i;

/** Day index → x of the column's centre. */
export const xForIndex = (g: Geometry, i: number): number =>
  (clampIndex(g, i) + 0.5) * g.colWidth;

/** Day index → x of the column's left edge. Ribbon painting only. */
export const xForColumn = (g: Geometry, i: number): number => i * g.colWidth;

export const indexForDate = (g: Geometry, iso: string): number =>
  daysBetween(g.rangeStart, iso);

export const xForDate = (g: Geometry, iso: string): number =>
  xForIndex(g, indexForDate(g, iso));

export const indexForX = (g: Geometry, x: number): number =>
  clampIndex(g, Math.floor(x / g.colWidth));

export const dateForIndex = (g: Geometry, i: number): string =>
  addDays(g.rangeStart, clampIndex(g, i));

export const dateForX = (g: Geometry, x: number): string =>
  dateForIndex(g, indexForX(g, x));

/** True when the date falls inside the scrubber's range at all. */
export const inRange = (g: Geometry, iso: string): boolean =>
  iso >= g.rangeStart && iso <= g.rangeEnd;

export interface MonthTick {
  /** ISO date of the first day of the month that is inside the range. */
  iso: string;
  index: number;
  /** `Jan`, `Feb`, … */
  label: string;
  year: number;
  /** True for January — gets the year printed and a brighter tick. */
  isYearBoundary: boolean;
}

/**
 * One tick per month boundary inside the range. The range starts on an
 * arbitrary day, so the first partial month is skipped rather than drawn at
 * x=0 where it would collide with the rail's left edge.
 */
export function monthTicks(g: Geometry): MonthTick[] {
  const out: MonthTick[] = [];
  const start = new Date(`${g.rangeStart}T00:00:00Z`);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();

  // Advance to the first day-1 at or after rangeStart.
  if (start.getUTCDate() !== 1) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  for (;;) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    if (iso > g.rangeEnd) break;
    out.push({
      iso,
      index: daysBetween(g.rangeStart, iso),
      label: MONTHS[m] ?? '',
      year: y,
      isYearBoundary: m === 0,
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
