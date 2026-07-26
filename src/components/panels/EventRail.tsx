'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  CategoryGlyph,
  EmptyState,
  HeatDot,
  Rule,
  TierMark,
  cn,
  formatDaysUntil,
  formatScore,
} from '@/components/ui';
import { PeerStack } from '@/components/social';
import { useScoredEvents, type ScoredEvent } from '@/lib/selectors';
import { usePeerCounts } from '@/lib/social';
import { useFilterStore } from '@/lib/stores/useFilterStore';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { useTimelineStore } from '@/lib/stores/useTimelineStore';

/** Fixed, so the list can be windowed exactly rather than measured. */
const ROW_H = 88;
const OVERSCAN = 4;

export interface EventRailProps {
  className?: string;
}

/**
 * The ranked index for the current window.
 *
 * Windowed, not paged: the rail keeps roughly a screen and a half of rows in
 * the DOM and moves them as you scroll. Two hundred rows each carrying a peer
 * stack would cost more than the globe does, and the globe is the product.
 *
 * Rank is printed because the ordering is an assertion, and an assertion should
 * be legible. Position in a list is not a number.
 */
export function EventRail({ className }: EventRailProps) {
  const events = useScoredEvents();
  const peerCounts = usePeerCounts();
  const hoveredEventId = useGlobeStore((s) => s.hoveredEventId);
  const selectedEventId = useGlobeStore((s) => s.selectedEventId);
  const hover = useGlobeStore((s) => s.hover);
  const select = useGlobeStore((s) => s.select);
  const flyTo = useGlobeStore((s) => s.flyTo);
  const spanDays = useTimelineStore((s) => s.spanDays);
  const activeCount = useFilterStore((s) => s.activeCount());
  const clearFilters = useFilterStore((s) => s.clear);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const read = () => setViewport(el.clientHeight);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The window resets to the top whenever the underlying set changes — landing
  // mid-list after a filter change would be disorienting.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [events.length, spanDays]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const [first, last] = useMemo(() => {
    if (viewport <= 0) return [0, Math.min(events.length, 12)];
    const a = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const b = Math.min(events.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);
    return [a, b];
  }, [scrollTop, viewport, events.length]);

  const visible = events.slice(first, last);

  // Total peer signals across everything in the window — the one number that
  // says whether this week is a social event or a solitary one.
  const peersInView = useMemo(
    () => events.reduce((n, e) => n + (peerCounts[e.id] ?? 0), 0),
    [events, peerCounts],
  );

  return (
    // `data-meridian-surface` tells the cursor-follow readout to stand down
    // while the pointer is over the rail — the row already says everything it
    // would, and a card chasing the cursor across a list is noise.
    <section
      className={cn(
        'glass-deep flex h-[min(66vh,42rem)] w-[19rem] flex-col rounded-[3px] xl:w-[22rem]',
        className,
      )}
      data-meridian-surface=""
      aria-label="Events in view, ranked"
    >
      <header className="shrink-0 px-4 pb-3 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="label text-ink-muted">In view</h2>
          <span className="tabular text-[11px] leading-none text-ink">
            {events.length}
            <span className="text-ink-muted"> ranked</span>
          </span>
        </div>
        {peersInView > 0 && (
          <p className="mt-2 text-[11px] leading-4 text-ink-muted">
            <span className="tabular text-ink">{peersInView}</span> member signals
            across this window
          </p>
        )}
        <Rule variant="brass" className="mt-3" />
      </header>

      {events.length === 0 ? (
        <EmptyState
          title="Nothing in this window"
          body={
            activeCount > 0
              ? 'The filters exclude every event inside the current date window. Widen the window with the ± control, move the scrubber, or reset the filters.'
              : 'No indexed event falls inside the current date window. Widen the window with the ± control, or move the scrubber to a busier week.'
          }
          action={
            activeCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Reset filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          onPointerLeave={() => hover(null)}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div style={{ height: events.length * ROW_H }} className="relative">
            {visible.map((event, i) => (
              <RailRow
                key={event.id}
                event={event}
                top={(first + i) * ROW_H}
                hovered={hoveredEventId === event.id}
                selected={selectedEventId === event.id}
                onHover={hover}
                onSelect={(id) => {
                  select(id);
                  flyTo(event.coords);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface RailRowProps {
  event: ScoredEvent;
  top: number;
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

function RailRow({
  event,
  top,
  hovered,
  selected,
  onHover,
  onSelect,
}: RailRowProps) {
  return (
    <button
      type="button"
      style={{ top, height: ROW_H }}
      onPointerEnter={() => onHover(event.id)}
      onFocus={() => onHover(event.id)}
      onClick={() => onSelect(event.id)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group absolute inset-x-0 flex w-full items-center gap-3 border-l-2 px-4 text-left',
        'transition-colors duration-[var(--duration-instant)] ease-[var(--ease-glide)]',
        selected
          ? 'border-l-brass bg-brass-wash'
          : hovered
            ? 'border-l-brass-deep bg-ink/[0.03]'
            : 'border-l-transparent',
      )}
    >
      <span
        className={cn(
          'tabular w-6 shrink-0 self-start pt-1 text-[11px] leading-none',
          event.buzz.rank <= 3 ? 'text-brass' : 'text-ink-muted',
        )}
        aria-hidden
      >
        {String(event.buzz.rank).padStart(2, '0')}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <CategoryGlyph
            category={event.category}
            size={12}
            className={cn(
              'transition-colors duration-[var(--duration-instant)]',
              selected || hovered ? 'text-brass' : 'text-ink-muted',
            )}
          />
          <span className="font-display truncate text-[14px] leading-tight text-ink">
            {event.name}
          </span>
        </span>
        <span className="truncate text-[11px] leading-4 text-ink-muted">
          {event.city}, {event.country}
        </span>
        <span className="flex min-h-[18px] items-center">
          {/* Plates only: the row is a fixed 88px and the explanatory line
              underneath a stack belongs in the dossier, not here. */}
          <PeerStack eventId={event.id} limit={4} size={18} bare />
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="flex items-center gap-1.5">
          <HeatDot heat={event.buzz.heat} glow={selected || hovered} />
          <span className="tabular text-[12px] leading-none text-ink">
            {formatScore(event.buzz.score)}
          </span>
        </span>
        <span className="tabular text-[11px] leading-none text-ink-muted">
          {formatDaysUntil(event.daysUntil)}
        </span>
        <TierMark tier={event.tier} size={9} />
      </span>
    </button>
  );
}
