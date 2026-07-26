'use client';

import { useEffect, useState } from 'react';
import { Rule, cn, formatDateFull } from '@/components/ui';
import { CurrentMemberChip } from '@/components/social';
import { useTimelineStore } from '@/lib/stores/useTimelineStore';

export interface TopBarProps {
  className?: string;
}

const timeIn = (zone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

const utcFmt = timeIn('UTC');

/**
 * The masthead.
 *
 * A private bank's letterhead, not a product header: the name, two clocks, the
 * date you are currently looking at, and who you are. No navigation, because
 * there is nowhere else to go — the globe is the application.
 */
export function TopBar({ className }: TopBarProps) {
  const focus = useTimelineStore((s) => s.focus);
  const [clock, setClock] = useState<{ local: string; utc: string } | null>(null);

  // Mounted-only so the server and the client never disagree about the second.
  useEffect(() => {
    const localFmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const tick = () => {
      const now = new Date();
      setClock({ local: localFmt.format(now), utc: utcFmt.format(now) });
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      className={cn('glass flex h-12 w-full items-center gap-6 px-5', className)}
    >
      {/* ── Wordmark ────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-baseline gap-3">
        <span
          className="font-display text-[17px] leading-none text-ink"
          style={{ letterSpacing: '0.42em' }}
        >
          MERIDIAN
        </span>
        <span className="label-sm hidden text-ink-muted lg:inline">
          Private Travel Intelligence
        </span>
      </div>

      <Rule variant="brass" className="hidden max-w-40 flex-1 xl:block" />

      <div className="flex-1" />

      {/* ── Clocks ──────────────────────────────────────────────────── */}
      <div className="hidden items-center gap-5 md:flex">
        <Clock label="Local" value={clock?.local} />
        <Clock label="UTC" value={clock?.utc} />
      </div>

      <Rule orientation="vertical" className="hidden h-5 md:block" />

      {/* ── The date under the scrubber ─────────────────────────────── */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="label-sm text-ink-muted">In view</span>
        <span className="tabular text-[12px] leading-none text-ink">
          {formatDateFull(focus)}
        </span>
      </div>

      <Rule orientation="vertical" className="h-5" />

      <CurrentMemberChip />
    </header>
  );
}

function Clock({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="label-sm text-ink-muted">{label}</span>
      <span className="tabular text-[12px] leading-none text-ink">
        {value ?? '––:––'}
      </span>
    </div>
  );
}
