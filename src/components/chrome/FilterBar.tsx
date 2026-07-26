'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Button,
  CategoryGlyph,
  Chip,
  DURATION,
  EASE_SETTLE,
  Rule,
  SearchField,
  TierMark,
  cn,
  CATEGORY_LABEL,
  TIER_LABEL,
} from '@/components/ui';
import { useFilterStore } from '@/lib/stores/useFilterStore';
import { useAllScoredEvents, useScoredEvents } from '@/lib/selectors';
import type { EventTier } from '@/lib/types';
import { FilterPanel } from './FilterPanel';

const TIERS: EventTier[] = ['legendary', 'marquee', 'insider'];

export interface FilterBarProps {
  className?: string;
}

/**
 * The narrow bar; `FilterPanel` is the full set behind it.
 *
 * What sits on the bar is what gets changed twenty times an hour — search, the
 * three access tiers, and whichever categories are already on. Everything else
 * lives one press away, because a permanent seventeen-chip category row is a
 * wall, and this product does not do walls.
 */
export function FilterBar({ className }: FilterBarProps) {
  const query = useFilterStore((s) => s.query);
  const setQuery = useFilterStore((s) => s.setQuery);
  const categories = useFilterStore((s) => s.categories);
  const toggleCategory = useFilterStore((s) => s.toggleCategory);
  const tiers = useFilterStore((s) => s.tiers);
  const toggleTier = useFilterStore((s) => s.toggleTier);
  const clear = useFilterStore((s) => s.clear);
  const activeCount = useFilterStore((s) => s.activeCount());

  const inWindow = useScoredEvents().length;
  const total = useAllScoredEvents().length;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  // Dismiss on Escape or on a press anywhere outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      <div className="glass flex h-10 w-full items-center gap-4 px-5">
        <SearchField
          label="Search events"
          value={query}
          onValueChange={setQuery}
          className="w-44 shrink-0 lg:w-60"
        />

        <Rule orientation="vertical" className="h-4" />

        <div className="flex shrink-0 items-center gap-1.5">
          {TIERS.map((t) => (
            <Chip
              key={t}
              active={tiers.includes(t)}
              onClick={() => toggleTier(t)}
              icon={<TierMark tier={t} size={9} />}
            >
              {TIER_LABEL[t]}
            </Chip>
          ))}
        </div>

        {/* Active categories stay on the bar so nothing is filtering invisibly. */}
        {categories.length > 0 && (
          <>
            <Rule orientation="vertical" className="h-4" />
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
              {categories.slice(0, 5).map((c) => (
                <Chip
                  key={c}
                  active
                  onClick={() => toggleCategory(c)}
                  icon={<CategoryGlyph category={c} size={11} />}
                  aria-label={`Remove ${CATEGORY_LABEL[c]} filter`}
                >
                  {CATEGORY_LABEL[c]}
                </Chip>
              ))}
              {categories.length > 5 && (
                <span className="tabular text-[10px] text-ink-muted">
                  +{categories.length - 5}
                </span>
              )}
            </div>
          </>
        )}

        <div className="flex-1" />

        <span className="tabular hidden shrink-0 text-[11px] leading-none text-ink-muted md:block">
          <span className="text-ink">{inWindow}</span> in view
          <span className="mx-1.5 text-ink-muted">/</span>
          {total} indexed
        </span>

        <Rule orientation="vertical" className="h-4" />

        <Button
          variant={open || activeCount > 0 ? 'brass' : 'ghost'}
          size="sm"
          selected={open}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0"
        >
          Filters
          {activeCount > 0 && (
            <span className="tabular text-[10px] text-brass-bright">{activeCount}</span>
          )}
        </Button>

        {activeCount > 0 && (
          <Button variant="quiet" size="sm" onClick={clear} className="shrink-0 px-1">
            Clear
          </Button>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Filters"
            className="glass-deep absolute left-5 top-full z-40 mt-2 w-[min(38rem,calc(100vw-2.5rem))] rounded-[3px] p-5"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{
              duration: reduced ? 0 : DURATION.quick,
              ease: EASE_SETTLE,
            }}
          >
            <FilterPanel />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
