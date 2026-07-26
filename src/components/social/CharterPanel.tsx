'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { Button, Chip, cn, Rule, ScrollArea } from '@/components/ui';
import { EVENT_INDEX } from '@/lib/data/events';
import {
  candidateJets,
  formatHours,
  formatUsd,
  quoteCharter,
  usableRangeNm,
} from '@/lib/social/charter';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import type { JetOption } from '@/lib/types';
import { useMyGroupFor } from './hooks';

export interface CharterPanelProps {
  eventId: string;
  /** Override the party size. Defaults to the user's cabin, or eight. */
  seats?: number;
  className?: string;
}

const DEFAULT_CAPACITY = 8;

/**
 * The economic argument, made once, in numbers.
 *
 * Every other part of this product is about desire. This part is about
 * arithmetic — the reason a group exists at all is that the aircraft costs the
 * same whether one person is on it or twelve, and the per-seat figure is
 * therefore the only number on this panel that gets the display face.
 *
 * Everything here is indicative. `lib/social/charter.ts` documents exactly what
 * is modelled and what is not; the footnote links the reader to the short
 * version.
 */
export function CharterPanel({ eventId, seats, className }: CharterPanelProps) {
  const hydrated = useSocialHydration();
  const home = useSocialStore((s) => s.currentMember.homeBase);
  const group = useMyGroupFor(eventId);
  const event = EVENT_INDEX.get(eventId);

  const capacity = seats ?? group?.capacity ?? DEFAULT_CAPACITY;
  const filled = group?.members.length ?? 1;

  const [forcedJetId, setForcedJetId] = useState<string | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const model = useMemo(() => {
    if (!event) return null;
    const to = event.nearestJetPort.coords;

    // One quote decides the airframe for the whole panel, so the cost curve is
    // an honest comparison: the same aeroplane, split more ways.
    const recommended = quoteCharter(home.coords, to, capacity, undefined, { seatsFilled: 1 });
    const options = candidateJets(recommended.distanceNm, capacity);
    const forced = forcedJetId ? options.find((j) => j.id === forcedJetId) : undefined;
    const quote = quoteCharter(home.coords, to, capacity, forced, {
      seatsFilled: Math.max(1, Math.min(filled, capacity)),
    });

    const perSeatAt = (n: number): number => Math.round(quote.totalCost / Math.max(1, n));

    return { quote, options, recommendedJetId: recommended.jet.id, perSeatAt, to };
  }, [event, home.coords, capacity, filled, forcedJetId]);

  if (!event || !model) return null;
  const { quote, options, recommendedJetId, perSeatAt } = model;

  // Anchor the argument on a full cabin — that is the case the product makes.
  const full = Math.min(capacity, quote.jet.seats * quote.aircraftCount);
  const alone = perSeatAt(1);
  const shared = perSeatAt(full);

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Route */}
      <div className="flex items-baseline justify-between gap-4">
        <p className="label text-ink-muted">
          {home.homeJetPort}
          <span className="mx-2 text-ink-ghost">→</span>
          {event.nearestJetPort.code}
        </p>
        <p className="tabular text-[11px] text-ink-faint">
          {quote.distanceNm.toLocaleString('en-US')} nm
        </p>
      </div>
      <p className="label-sm mt-1.5 text-ink-ghost">
        {home.city} to {event.nearestJetPort.name}
      </p>

      <Rule variant="brass" className="my-3.5" />

      {/* The hero. One number, display face, nothing competing with it. */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label-sm text-ink-faint">
            Per seat at {hydrated ? Math.max(1, Math.min(filled, capacity)) : 1}
          </p>
          <motion.p
            key={quote.costPerSeat}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="font-display mt-1 text-[38px] leading-[42px] text-ink"
          >
            {formatUsd(quote.costPerSeat)}
          </motion.p>
        </div>
        <div className="text-right">
          <p className="label-sm text-ink-faint">Whole aircraft</p>
          <p className="tabular mt-1.5 text-[13px] text-ink-muted">{formatUsd(quote.totalCost)}</p>
        </div>
      </div>

      {/* The argument, in one sentence */}
      <p className="mt-3 text-[12px] leading-[18px] text-ink-muted">
        Alone, <span className="tabular text-ink">{formatUsd(alone)}</span>. With {full},{' '}
        <span className="tabular text-brass">{formatUsd(shared)}</span> each. The aeroplane costs
        the same either way.
      </p>

      {/* The curve */}
      <div className="mt-3.5">
        <ScrollArea className="max-w-full" contentClassName="flex items-end gap-[3px] pb-1">
          {Array.from({ length: full }, (_, i) => i + 1).map((n) => {
            const v = perSeatAt(n);
            const h = 4 + (v / alone) * 34;
            const isNow = n === Math.max(1, Math.min(filled, capacity));
            return (
              <span key={n} className="flex w-9 shrink-0 flex-col items-center gap-1.5">
                <span className="tabular text-[9px] leading-none text-ink-faint">
                  {v >= 1000 ? `${Math.round(v / 1000)}k` : v}
                </span>
                <span
                  className={cn('w-full', isNow ? 'bg-brass' : 'bg-ink/14')}
                  style={{ height: h }}
                />
                <span
                  className={cn(
                    'tabular text-[9px] leading-none',
                    isNow ? 'text-brass' : 'text-ink-ghost',
                  )}
                >
                  {n}
                </span>
              </span>
            );
          })}
        </ScrollArea>
        <p className="label-sm mt-1.5 text-ink-ghost">Cost per seat as the cabin fills</p>
      </div>

      <Rule variant="ghost" className="my-3.5" />

      {/* Specs */}
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
        <Spec label="Airframe" value={quote.jet.aircraft} face="plain" />
        <Spec label="Block time" value={formatHours(quote.legHours)} />
        <Spec label="Legs" value={quote.nonstop ? 'Nonstop' : `${quote.techStops + 1} each way`} />
      </dl>
      <p className="mt-2.5 text-[11px] leading-4 text-ink-faint">{quote.jet.note}</p>

      {!quote.nonstop && (
        <p className="mt-2.5 border-l border-alert/60 pl-2.5 text-[11px] leading-4 text-ink-muted">
          No airframe in the catalogue reaches {event.nearestJetPort.code} nonstop with{' '}
          {capacity} aboard — {quote.jet.aircraft} usable range is{' '}
          {usableRangeNm(quote.jet).toLocaleString('en-US')} nm. Quoted with{' '}
          {quote.techStops} technical stop{quote.techStops > 1 ? 's' : ''} each way.
        </p>
      )}
      {quote.aircraftCount > 1 && (
        <p className="mt-2.5 border-l border-alert/60 pl-2.5 text-[11px] leading-4 text-ink-muted">
          Quoted as {quote.aircraftCount} aircraft — {capacity} will not fit one cabin.
        </p>
      )}

      {/* Comparison */}
      <p className="label mt-4 text-ink-muted">Compare airframes</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {options.map((jet) => (
          <JetChip
            key={jet.id}
            jet={jet}
            active={quote.jet.id === jet.id}
            recommended={jet.id === recommendedJetId}
            perSeat={perSeatFor(jet)}
            onSelect={() => setForcedJetId(forcedJetId === jet.id ? null : jet.id)}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button variant="quiet" size="sm" onClick={() => setShowAssumptions((v) => !v)}>
          {showAssumptions ? 'Hide basis' : 'How this is calculated'}
        </Button>
        {group && (
          <Button
            variant={group.jet?.id === quote.jet.id ? 'brass' : 'ghost'}
            size="sm"
            selected={group.jet?.id === quote.jet.id}
            onClick={() => useSocialStore.getState().chooseJet(group.id, quote.jet)}
          >
            Hold this aircraft
          </Button>
        )}
      </div>

      {showAssumptions && (
        <motion.ul
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="mt-2.5 overflow-hidden text-[11px] leading-[17px] text-ink-faint"
        >
          {quote.assumptions.map((a) => (
            <li key={a} className="flex gap-2">
              <span className="text-ink-ghost">·</span>
              <span>{a}</span>
            </li>
          ))}
          <li className="mt-2 flex gap-2">
            <span className="text-ink-ghost">·</span>
            <span>
              Indicative only. Excludes winds aloft, peak-date surcharge, slot and ramp
              availability, de-icing and ground transfers.
            </span>
          </li>
        </motion.ul>
      )}
    </div>
  );

  function perSeatFor(jet: JetOption): number {
    const q = quoteCharter(home.coords, event!.nearestJetPort.coords, capacity, jet, {
      seatsFilled: full,
    });
    return q.costPerSeat;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function Spec({
  label,
  value,
  face = 'tabular',
}: {
  label: string;
  value: string;
  face?: 'tabular' | 'plain';
}) {
  return (
    <div className="min-w-0">
      <dt className="label-sm text-ink-faint">{label}</dt>
      <dd
        className={cn(
          'mt-1.5 truncate text-[12px] leading-4 text-ink',
          face === 'tabular' && 'tabular',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function JetChip({
  jet,
  active,
  recommended,
  perSeat,
  onSelect,
}: {
  jet: JetOption;
  active: boolean;
  recommended: boolean;
  perSeat: number;
  onSelect: () => void;
}) {
  return (
    <Chip
      active={active}
      size="sm"
      onClick={onSelect}
      title={`${jet.seats} seats · ${jet.rangeNm.toLocaleString('en-US')} nm · ${formatUsd(jet.hourlyRate)}/hr`}
    >
      <span className="flex items-baseline gap-2">
        <span className={cn(recommended && !active && 'text-ink')}>{shortName(jet)}</span>
        <span className="tabular text-[10px] text-ink-faint">
          {perSeat >= 1000 ? `${Math.round(perSeat / 1000)}k` : perSeat}
        </span>
      </span>
    </Chip>
  );
}

/** "Gulfstream G650ER" → "G650ER". The manufacturer is in the tooltip. */
function shortName(jet: JetOption): string {
  return jet.aircraft
    .replace(/^(Cessna|Bombardier|Embraer|Dassault|Gulfstream|Pilatus|Boeing)\s+/, '')
    .replace(/^Citation\s+/, '');
}
