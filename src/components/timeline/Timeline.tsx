'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Rule,
  Skeleton,
  cn,
  formatDate,
  formatDateFull,
  formatDateRange,
} from '@/components/ui';
import { useHeatByDay } from '@/lib/selectors';
import { addDays, useTimelineStore } from '@/lib/stores/useTimelineStore';
import { DensityRibbon } from './DensityRibbon';
import { MonthRail } from './MonthRail';
import { SpanControl } from './SpanControl';
import { TimelineMarkers } from './TimelineMarkers';
import { Transport } from './Transport';
import {
  clampIndex,
  dateForX,
  indexForDate,
  makeGeometry,
  xForColumn,
  xForIndex,
} from './geometry';

const RIBBON_H = 44;
const MARKERS_H = 20;

export interface TimelineProps {
  className?: string;
}

/**
 * MERIDIAN's primary navigation: fourteen months of the world on one rail.
 *
 * Three readings stacked on the same axis, all sharing one geometry so they
 * agree to the pixel:
 *   · markers  — the twenty events worth planning a year around
 *   · ribbon   — every day's aggregate demand, painted to canvas
 *   · rail     — the months, so the shape has names
 *
 * The handle is the only brass object of any size in the product. That is the
 * point: there is exactly one control here, and everything else on screen is
 * downstream of where it sits.
 */
export function Timeline({ className }: TimelineProps) {
  const focus = useTimelineStore((s) => s.focus);
  const spanDays = useTimelineStore((s) => s.spanDays);
  const rangeStart = useTimelineStore((s) => s.rangeStart);
  const rangeEnd = useTimelineStore((s) => s.rangeEnd);
  const scrubbing = useTimelineStore((s) => s.scrubbing);
  const playing = useTimelineStore((s) => s.playing);
  const setFocus = useTimelineStore((s) => s.setFocus);
  const setScrubbing = useTimelineStore((s) => s.setScrubbing);

  const days = useHeatByDay();

  const trackRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);

  // ── Measurement ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geometry = useMemo(
    () => makeGeometry(rangeStart, rangeEnd, width),
    [rangeStart, rangeEnd, width],
  );

  const focusIndex = clampIndex(geometry, indexForDate(geometry, focus));
  const handleX = width > 0 ? xForIndex(geometry, focusIndex) : 0;

  const windowStart = clampIndex(geometry, focusIndex - spanDays);
  const windowEnd = clampIndex(geometry, focusIndex + spanDays);
  const bandLeft = xForColumn(geometry, windowStart);
  const bandWidth = Math.max(
    geometry.colWidth,
    xForColumn(geometry, windowEnd + 1) - bandLeft,
  );

  // ── Dragging ──────────────────────────────────────────────────────────
  // Pointer events with capture, so the drag keeps tracking when the cursor
  // leaves the bar — off the top of the window, over the globe, anywhere. The
  // same path handles touch and pen without a second code path.
  const applyFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setFocus(dateForX(geometry, clientX - rect.left));
    },
    [geometry, setFocus],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = trackRef.current;
      if (!el) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      dragging.current = true;
      // Grabbing the scrubber takes over from playback — you cannot fight it.
      if (useTimelineStore.getState().playing) useTimelineStore.getState().togglePlay();
      setScrubbing(true);
      handleRef.current?.focus({ preventScroll: true });
      applyFromClientX(e.clientX);
    },
    [applyFromClientX, setScrubbing],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      applyFromClientX(e.clientX);
    },
    [applyFromClientX],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      setScrubbing(false);
      trackRef.current?.releasePointerCapture?.(e.pointerId);
    },
    [setScrubbing],
  );

  // Belt and braces: if the pointer is lost (window blur, context menu) the
  // store must not be left stuck in `scrubbing`, or the globe never flies again.
  useEffect(() => {
    const release = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setScrubbing(false);
    };
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [setScrubbing]);

  // ── Keyboard ──────────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next: string | null = null;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          next = addDays(focus, e.shiftKey ? -7 : -1);
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          next = addDays(focus, e.shiftKey ? 7 : 1);
          break;
        case 'PageDown':
          next = addMonths(focus, -1);
          break;
        case 'PageUp':
          next = addMonths(focus, 1);
          break;
        case 'Home':
          next = rangeStart;
          break;
        case 'End':
          next = rangeEnd;
          break;
        default:
          return;
      }
      // The page installs window-level ←/→ handlers; without this the scrubber
      // would move two days for every key press.
      e.preventDefault();
      e.stopPropagation();
      setFocus(next);
    },
    [focus, rangeStart, rangeEnd, setFocus],
  );

  const ready = width > 0;
  const compact = width > 0 && width < 1040;

  return (
    <div
      className={cn(
        'glass w-full px-5 pb-2.5 pt-3',
        className,
      )}
    >
      {/* ── Header: transport · the date · the window ──────────────── */}
      <div className="flex items-end justify-between gap-6 pb-2.5">
        <Transport compact={compact} />

        <div className="flex min-w-0 flex-col items-center gap-1">
          <span className="label-sm text-ink-muted">
            {formatDateRange(
              addDays(focus, -spanDays) < rangeStart ? rangeStart : addDays(focus, -spanDays),
              addDays(focus, spanDays) > rangeEnd ? rangeEnd : addDays(focus, spanDays),
            )}
          </span>
          <span
            className="font-display whitespace-nowrap text-[19px] leading-none text-ink"
            aria-hidden
          >
            {formatDateFull(focus)}
          </span>
        </div>

        <SpanControl />
      </div>

      {/* ── Markers ─────────────────────────────────────────────────── */}
      <div style={{ height: MARKERS_H }}>
        {ready ? <TimelineMarkers geometry={geometry} /> : null}
      </div>

      {/* ── The track ───────────────────────────────────────────────── */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative w-full cursor-ew-resize touch-none select-none"
        style={{ height: RIBBON_H }}
      >
        {ready ? (
          <>
            <DensityRibbon
              days={days}
              geometry={geometry}
              height={RIBBON_H}
              className="absolute inset-0"
            />

            {/* The in-view window: what the globe is currently lit for. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 border-x border-brass-deep/50 bg-brass-wash"
              style={{ left: bandLeft, width: bandWidth }}
            />

            {/* The indicator, running up through the markers. */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute w-px bg-brass',
                !scrubbing && 'transition-[left] duration-[var(--duration-instant)] ease-[var(--ease-glide)]',
              )}
              style={{ left: handleX, top: -MARKERS_H, height: RIBBON_H + MARKERS_H }}
            />

            {/* The grip. Also the slider for assistive tech and the keyboard. */}
            <div
              ref={handleRef}
              role="slider"
              tabIndex={0}
              aria-label="Timeline date"
              aria-valuemin={0}
              aria-valuemax={geometry.totalDays}
              aria-valuenow={focusIndex}
              aria-valuetext={formatDateFull(focus)}
              aria-orientation="horizontal"
              onKeyDown={onKeyDown}
              className={cn(
                'absolute inset-y-0 flex w-5 -translate-x-1/2 flex-col items-center justify-between',
                !scrubbing && 'transition-[left] duration-[var(--duration-instant)] ease-[var(--ease-glide)]',
              )}
              style={{ left: handleX }}
            >
              <span className="mt-[-3px] size-[7px] rotate-45 border border-brass bg-obsidian" />
              <span className="mb-[-3px] size-[7px] rotate-45 border border-brass bg-obsidian" />
            </div>
          </>
        ) : (
          <Skeleton className="absolute inset-x-0 bottom-0" height={RIBBON_H - 8} />
        )}
      </div>

      {/* ── The axis, with the exact date riding it ─────────────────── */}
      <div className="relative mt-1.5 w-full">
        {ready ? <MonthRail geometry={geometry} /> : null}
        {ready ? (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute -top-0.5 -translate-x-1/2',
              !scrubbing && 'transition-[left] duration-[var(--duration-instant)] ease-[var(--ease-glide)]',
            )}
            style={{
              left: Math.min(Math.max(handleX, 40), Math.max(40, width - 40)),
            }}
          >
            <span className="tabular glass-deep block rounded-[2px] px-1.5 py-[3px] text-[10px] leading-none text-brass">
              {formatDate(focus)}
            </span>
          </div>
        ) : null}
      </div>

      <Rule variant="hairline" className="mt-2" />
      <span className="sr-only" aria-live="polite">
        {playing ? `Playing. ${formatDateFull(focus)}` : ''}
      </span>
    </div>
  );
}

/** Calendar-correct month step, clamped to the end of shorter months. */
function addMonths(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + delta);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}
