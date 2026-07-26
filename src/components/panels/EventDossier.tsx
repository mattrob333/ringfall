'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  CategoryGlyph,
  DURATION,
  EASE_SETTLE,
  HeatDot,
  IconButton,
  PriceIndex,
  Rule,
  ScrollArea,
  Stat,
  TierMark,
  cn,
  CATEGORY_LABEL,
  HEAT_LABEL,
  HEAT_NOTE,
  TIER_NOTE,
  formatDateRange,
  formatDaysUntil,
  formatMoney,
  formatScore,
  formatTrend,
} from '@/components/ui';
import {
  CharterPanel,
  GroupList,
  InterestControl,
  PeerStack,
} from '@/components/social';
import { useEventById } from '@/lib/selectors';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import type { BuzzSignals } from '@/lib/types';

/** Plain English for the six raw signals. The engine's field names are not copy. */
const SIGNAL_LABEL: Record<keyof BuzzSignals, string> = {
  socialMentions: 'Social volume',
  socialVelocity: 'Velocity',
  searchInterest: 'Search interest',
  mediaMentions: 'Press',
  bookingPressure: 'Booking pressure',
  exclusivity: 'Exclusivity',
};

const SIGNAL_ORDER: (keyof BuzzSignals)[] = [
  'bookingPressure',
  'exclusivity',
  'socialMentions',
  'socialVelocity',
  'searchInterest',
  'mediaMentions',
];

export interface EventDossierProps {
  className?: string;
}

/**
 * The briefing.
 *
 * Laid out as a document, not a card: a masthead, a rule, then sections in the
 * order a decision actually gets made — when, why, what it is, how you get in,
 * what it costs, where you land, why the index rates it, and only then who else
 * is going.
 *
 * It occupies the left edge and stops well short of the middle. The globe is
 * still turning behind the reader and that is deliberate — this is a window
 * onto a place, not a page about one.
 */
export function EventDossier({ className }: EventDossierProps) {
  const selectedEventId = useGlobeStore((s) => s.selectedEventId);
  const select = useGlobeStore((s) => s.select);
  const event = useEventById(selectedEventId);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);

  const close = useCallback(() => select(null), [select]);

  // The page also listens for Escape; this handles the case where focus has
  // moved inside the dossier, and stops the two from fighting.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    },
    [close],
  );

  useEffect(() => {
    if (!event) return;
    ref.current?.focus({ preventScroll: true });
  }, [event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const components = useMemo(() => {
    if (!event) return [];
    const c = event.buzz.components;
    const rows = SIGNAL_ORDER.map((k) => ({ key: k, value: c[k] ?? 0 }));
    const max = Math.max(...rows.map((r) => r.value), 0.001);
    return rows.map((r) => ({ ...r, ratio: r.value / max }));
  }, [event]);

  return (
    <AnimatePresence>
      {event && (
        <motion.article
          ref={ref}
          key={event.id}
          role="dialog"
          aria-label={`${event.name} — briefing`}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn(
            // Anchored below the top chrome stack (masthead + scrubber + filters)
            // and clear of the ranked rail on the right. The centre stays open.
            'glass-deep fixed bottom-4 left-4 top-[17rem] z-40 flex w-[min(30rem,36vw)]',
            'flex-col rounded-[3px] outline-none',
            className,
          )}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, x: -20 }}
          transition={{ duration: reduced ? 0 : DURATION.considered, ease: EASE_SETTLE }}
        >
          {/* ── Masthead ─────────────────────────────────────────────── */}
          <header className="shrink-0 px-5 pb-4 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="tabular text-[11px] leading-none text-brass">
                    {String(event.buzz.rank).padStart(2, '0')}
                  </span>
                  <span className="h-2.5 w-px bg-ink/15" aria-hidden />
                  <TierMark tier={event.tier} withLabel size={9} />
                  <span className="h-2.5 w-px bg-ink/15" aria-hidden />
                  <span className="flex items-center gap-1.5">
                    <CategoryGlyph category={event.category} size={11} className="text-ink-muted" />
                    <span className="label-sm text-ink-muted">
                      {CATEGORY_LABEL[event.category]}
                    </span>
                  </span>
                </div>

                <h1 className="font-display text-[27px] leading-[1.1] text-ink">
                  {event.name}
                </h1>
                <p className="text-[12px] leading-4 text-ink-muted">{event.tagline}</p>
              </div>

              <IconButton label="Close briefing" variant="ghost" onClick={close}>
                <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" aria-hidden>
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </IconButton>
            </div>
            <Rule variant="brass" className="mt-4" />
          </header>

          <ScrollArea contentClassName="flex flex-col gap-6 px-5 pb-6">
            {/* ── When and where ─────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <Stat
                label="Dates"
                value={formatDateRange(event.start, event.end)}
                note={`${event.recurrence} · ${event.timezone}`}
                size="sm"
              />
              <Stat
                label="Lead time"
                value={formatDaysUntil(event.daysUntil)}
                note={event.daysUntil < 0 ? 'Already under way' : 'from the focused date'}
                size="sm"
                align="end"
              />
              <Stat
                label="Where"
                value={`${event.city}, ${event.country}`}
                face="plain"
                size="sm"
              />
              <Stat
                label="Spend, per person"
                value={`${formatMoney(event.estimatedSpend.min)} – ${formatMoney(event.estimatedSpend.max)}`}
                note="excluding charter"
                size="sm"
                align="end"
              />
            </div>

            {/* ── Access: the thing that actually decides it ──────────── */}
            <Section label="Access">
              <div className="border-l border-brass py-0.5 pl-4">
                <p className="font-display text-[15px] leading-[1.45] text-ink">
                  {event.accessNote}
                </p>
                <p className="mt-2 text-[11px] leading-4 text-ink-muted">
                  {TIER_NOTE[event.tier]}
                </p>
              </div>
            </Section>

            {/* ── Why go ─────────────────────────────────────────────── */}
            <Section label="Why go">
              <ul className="flex flex-col gap-2.5">
                {event.whyGo.map((line) => (
                  <li key={line} className="flex gap-3">
                    <span aria-hidden className="mt-2 h-px w-3 shrink-0 bg-brass-deep" />
                    <span className="text-[12.5px] leading-[1.55] text-ink">{line}</span>
                  </li>
                ))}
              </ul>
            </Section>

            {/* ── The read ───────────────────────────────────────────── */}
            <Section label="The read">
              <p className="text-[12.5px] leading-[1.65] text-ink-muted">
                {event.description}
              </p>
            </Section>

            {/* ── Ground ─────────────────────────────────────────────── */}
            <Section label="Venues">
              <ul className="flex flex-col gap-1.5">
                {event.venues.map((v) => (
                  <li key={v} className="text-[12px] leading-4 text-ink">
                    {v}
                  </li>
                ))}
              </ul>
            </Section>

            <Section label="Nearest jet port">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="tabular text-[13px] leading-none text-ink">
                    {event.nearestJetPort.code}
                  </span>
                  <span className="truncate text-[11px] leading-4 text-ink-muted">
                    {event.nearestJetPort.name}
                  </span>
                </div>
                <span className="label-sm shrink-0 text-ink-muted">
                  FBO {event.nearestJetPort.fboQuality}
                </span>
              </div>
            </Section>

            <Section label="Spend index">
              <PriceIndex value={event.priceIndex} size={12} withLabel />
            </Section>

            {/* ── Why the index rates it ─────────────────────────────── */}
            <Section label="Signal">
              <div className="flex items-end justify-between gap-4 pb-3">
                <div className="flex items-baseline gap-2.5">
                  <HeatDot heat={event.buzz.heat} size="md" glow />
                  <span className="tabular text-[24px] leading-none text-ink">
                    {formatScore(event.buzz.score)}
                  </span>
                  <span className="label-sm text-ink-muted">
                    {HEAT_LABEL[event.buzz.heat]}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="label-sm text-ink-muted">Momentum</span>
                  <span className="tabular text-[12px] leading-none text-ink">
                    {formatTrend(event.buzz.trend)}
                  </span>
                </div>
              </div>

              <p className="pb-3 text-[11px] leading-4 text-ink-muted">
                {HEAT_NOTE[event.buzz.heat]}. Bars are each signal&rsquo;s weighted
                contribution to the score — the components sum to it.
              </p>

              <ul className="flex flex-col gap-2">
                {components.map(({ key, value, ratio }) => (
                  <li key={key} className="flex items-center gap-3">
                    <span className="label-sm w-28 shrink-0 text-ink-muted">
                      {SIGNAL_LABEL[key]}
                    </span>
                    <span
                      className="h-px min-w-0 flex-1 bg-ink/10"
                      role="img"
                      aria-label={`${SIGNAL_LABEL[key]} contributes ${value.toFixed(1)} points`}
                    >
                      <span
                        className="block h-px bg-brass"
                        style={{ width: `${Math.max(1, ratio * 100)}%` }}
                      />
                    </span>
                    <span className="tabular w-9 shrink-0 text-right text-[11px] leading-none text-ink">
                      {value.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>

              {event.buzz.peerLift !== undefined && (
                <p className="mt-3 text-[11px] leading-4 text-signal">
                  Peer interest lifted this score by {event.buzz.peerLift.toFixed(1)}.
                </p>
              )}
            </Section>

            {event.tags.length > 0 && (
              <Section label="Tags">
                <p className="text-[11px] leading-5 text-ink-muted">
                  {event.tags.join(' · ')}
                </p>
              </Section>
            )}

            {/* ── Who else ───────────────────────────────────────────── */}
            <Rule variant="brass" />

            <Section label="Your position">
              <InterestControl eventId={event.id} />
            </Section>

            <Section label="Members overlapping">
              <PeerStack eventId={event.id} limit={12} />
            </Section>

            <Section label="Groups forming">
              <GroupList eventId={event.id} />
            </Section>

            <Section label="Charter">
              <CharterPanel eventId={event.id} />
            </Section>
          </ScrollArea>
        </motion.article>
      )}
    </AnimatePresence>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="label shrink-0 text-ink-muted">{label}</h2>
        <Rule variant="ghost" />
      </div>
      {children}
    </section>
  );
}
