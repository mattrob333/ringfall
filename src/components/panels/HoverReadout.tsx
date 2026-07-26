'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  CategoryGlyph,
  DURATION,
  EASE_GLIDE,
  HeatDot,
  cn,
  formatDateRange,
  formatDaysUntil,
  formatScore,
} from '@/components/ui';
import { useEventById } from '@/lib/selectors';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';

const OFFSET = 18;
const CARD_W = 236;
const CARD_H = 96;
/** Hold the card briefly when the hover clears, so brushing between two
 *  beacons does not strobe it in and out. */
const HIDE_DELAY = 90;

export interface HoverReadoutProps {
  className?: string;
}

/**
 * The cursor's footnote.
 *
 * Four facts and nothing else: what it is, where, how hot, how far off. It
 * never appears while a dossier is open — one reading surface at a time — and
 * it never intercepts the pointer, because it is sitting directly on top of the
 * thing you are trying to click.
 */
export function HoverReadout({ className }: HoverReadoutProps) {
  const hoveredEventId = useGlobeStore((s) => s.hoveredEventId);
  const selectedEventId = useGlobeStore((s) => s.selectedEventId);

  // Latch the id so the exit animation still has something to render.
  const [shownId, setShownId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [overSurface, setOverSurface] = useState(false);
  const frame = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();

  const event = useEventById(shownId);
  const visible = Boolean(
    shownId && hoveredEventId && !selectedEventId && pos && !overSurface,
  );

  useEffect(() => {
    if (hoveredEventId) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setShownId(hoveredEventId);
      return;
    }
    hideTimer.current = setTimeout(() => setShownId(null), HIDE_DELAY);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [hoveredEventId]);

  // One rAF-coalesced listener for the whole app. Reading `clientX` on every
  // pointermove and setting state directly would re-render faster than the
  // compositor can use.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const { clientX, clientY } = e;
      const target = e.target as Element | null;
      // Rows in the ranked rail also set `hoveredEventId` — they light the
      // matching beacon. But the row already carries every fact this card
      // would, so the card stands down over any tagged surface.
      const onSurface = Boolean(target?.closest?.('[data-meridian-surface]'));
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setPos({ x: clientX, y: clientY });
        setOverSurface(onSurface);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  if (!event || !pos) return null;

  // Flip rather than clamp: a card that slides along the edge loses its
  // association with the cursor.
  const flipX = pos.x + OFFSET + CARD_W > window.innerWidth;
  const flipY = pos.y + OFFSET + CARD_H > window.innerHeight;
  const left = flipX ? pos.x - OFFSET - CARD_W : pos.x + OFFSET;
  const top = flipY ? pos.y - OFFSET - CARD_H : pos.y + OFFSET;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="hover-readout"
          aria-hidden
          className={cn(
            'glass-deep pointer-events-none fixed z-50 rounded-[2px] px-3 py-2.5',
            className,
          )}
          style={{ left, top, width: CARD_W }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: reduced ? 0 : DURATION.instant,
            ease: EASE_GLIDE,
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <CategoryGlyph category={event.category} size={11} className="text-brass" />
            <span className="font-display truncate text-[13px] leading-tight text-ink">
              {event.name}
            </span>
          </div>
          <div className="mt-1.5 truncate text-[11px] leading-4 text-ink-muted">
            {event.city}, {event.country}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <HeatDot heat={event.buzz.heat} />
              <span className="tabular text-[11px] leading-none text-ink">
                {formatScore(event.buzz.score)}
              </span>
            </span>
            <span className="tabular text-[11px] leading-none text-ink-muted">
              {formatDaysUntil(event.daysUntil)}
            </span>
          </div>
          <div className="tabular mt-1.5 text-[10px] leading-none text-ink-muted">
            {formatDateRange(event.start, event.end)}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
