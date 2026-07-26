'use client';

import {
  Button,
  CategoryGlyph,
  Chip,
  PriceIndex,
  RangeField,
  Rule,
  TierMark,
  Toggle,
  cn,
  CATEGORY_LABEL,
  TIER_LABEL,
  TIER_NOTE,
} from '@/components/ui';
import { EVENT_CATEGORIES, type EventTier } from '@/lib/types';
import { useFilterStore } from '@/lib/stores/useFilterStore';
import { useCategoryBreakdown } from '@/lib/selectors';

const TIERS: EventTier[] = ['legendary', 'marquee', 'insider'];

export interface FilterPanelProps {
  className?: string;
}

/**
 * The full filter set.
 *
 * Everything here narrows; nothing here sorts. Sorting is the buzz engine's job
 * and taking it away from the user is deliberate — the ranking is the product's
 * opinion, and an opinion you can turn off is not one.
 *
 * Counts next to each category are the *unfiltered* totals, so the list does not
 * rearrange itself underneath the hand that is using it.
 */
export function FilterPanel({ className }: FilterPanelProps) {
  const categories = useFilterStore((s) => s.categories);
  const tiers = useFilterStore((s) => s.tiers);
  const maxPriceIndex = useFilterStore((s) => s.maxPriceIndex);
  const minScore = useFilterStore((s) => s.minScore);
  const peerActivityOnly = useFilterStore((s) => s.peerActivityOnly);
  const toggleCategory = useFilterStore((s) => s.toggleCategory);
  const toggleTier = useFilterStore((s) => s.toggleTier);
  const setMaxPriceIndex = useFilterStore((s) => s.setMaxPriceIndex);
  const setMinScore = useFilterStore((s) => s.setMinScore);
  const setPeerActivityOnly = useFilterStore((s) => s.setPeerActivityOnly);
  const clear = useFilterStore((s) => s.clear);

  const breakdown = useCategoryBreakdown();
  const counts = new Map(breakdown.map((b) => [b.category, b.count]));

  return (
    <div className={cn('flex w-full flex-col gap-5', className)}>
      {/* ── Categories ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h3 className="label text-ink-muted">Category</h3>
          {categories.length > 0 && (
            <Button
              variant="quiet"
              size="sm"
              className="h-4 px-0"
              onClick={() => categories.forEach((c) => toggleCategory(c))}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={categories.includes(c)}
              onClick={() => toggleCategory(c)}
              icon={<CategoryGlyph category={c} size={12} />}
              count={counts.get(c)}
            >
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
      </section>

      <Rule />

      {/* ── Tier ────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2.5">
        <h3 className="label text-ink-muted">Access</h3>
        <div className="flex flex-wrap gap-1.5">
          {TIERS.map((t) => (
            <Chip
              key={t}
              active={tiers.includes(t)}
              onClick={() => toggleTier(t)}
              icon={<TierMark tier={t} size={10} />}
              title={TIER_NOTE[t]}
            >
              {TIER_LABEL[t]}
            </Chip>
          ))}
        </div>
      </section>

      <Rule />

      {/* ── Thresholds ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-x-6 gap-y-5">
        <RangeField
          label="Spend ceiling"
          min={1}
          max={5}
          value={maxPriceIndex}
          onValueChange={setMaxPriceIndex}
          valueText={
            maxPriceIndex >= 5 ? 'No ceiling' : `Index ${maxPriceIndex} and below`
          }
          readout={
            maxPriceIndex >= 5 ? (
              <span className="label-sm text-ink-muted">No ceiling</span>
            ) : (
              <PriceIndex value={maxPriceIndex} />
            )
          }
        />
        <RangeField
          label="Minimum buzz"
          min={0}
          max={90}
          step={5}
          value={minScore}
          onValueChange={setMinScore}
          valueText={minScore === 0 ? 'Everything' : `${minScore} and above`}
          readout={minScore === 0 ? 'any' : `${minScore}+`}
        />
      </section>

      <Toggle
        checked={peerActivityOnly}
        onCheckedChange={setPeerActivityOnly}
        label="Peer activity only"
        hint="Show only events where a member has already signalled interest"
      />

      <Rule />

      <div className="flex items-center justify-between">
        <p className="text-[11px] leading-4 text-ink-muted">
          Filters narrow the index. Ranking stays with the buzz engine.
        </p>
        <Button variant="ghost" size="sm" onClick={clear}>
          Reset all
        </Button>
      </div>
    </div>
  );
}
