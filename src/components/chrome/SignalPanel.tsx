'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DURATION, EASE_SETTLE, Rule, Skeleton, cn } from '@/components/ui';
import type { SourceHealth } from '@/lib/types';

type Status = SourceHealth['status'];

const DOT: Record<Status, string> = {
  live: 'bg-signal',
  stale: 'bg-heat-hot',
  error: 'bg-alert',
  unconfigured: 'bg-ink-faint',
};

const WORD: Record<Status, string> = {
  live: 'Live',
  stale: 'Stale',
  error: 'Error',
  unconfigured: 'Off',
};

/** Said plainly, once, per state. No apologising and no marketing. */
const EXPLAIN: Record<Status, string> = {
  live: 'Reporting normally',
  stale: 'Last fetch is older than its refresh window',
  error: 'Configured, but the last fetch failed',
  unconfigured: 'No credentials present. Add the key and this source switches on',
};

export interface SignalPanelProps {
  className?: string;
  /** Start expanded. Collapsed by default — it is instrumentation, not content. */
  defaultOpen?: boolean;
}

/**
 * Data-source health.
 *
 * MERIDIAN runs on a curated baseline that live feeds sharpen rather than
 * replace, so a source being off is a normal operating state, not a failure.
 * This panel says which is which without dressing it up: an unconfigured source
 * is described as exactly what it is — a key that has not been added yet.
 */
export function SignalPanel({ className, defaultOpen = false }: SignalPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [sources, setSources] = useState<SourceHealth[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/sources', { signal: ac.signal });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          // The route hands back `{ sources: [], error }` on failure — say what
          // it said rather than inventing a status code.
          const detail = (body as { error?: string } | null)?.error;
          throw new Error(detail ?? `${res.status} ${res.statusText}`);
        }
        if (cancelled) return;
        // Be forgiving about the envelope: an array, or `{ sources: [...] }`.
        const list = Array.isArray(body)
          ? body
          : Array.isArray((body as { sources?: unknown })?.sources)
            ? ((body as { sources: SourceHealth[] }).sources)
            : null;
        if (!list) throw new Error('Unexpected response shape');
        setSources(list as SourceHealth[]);
        setFailed(null);
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        setSources(null);
        setFailed((err as Error)?.message ?? 'Unreachable');
      }
    };

    void load();
    // Health is slow-moving. Once a minute is attentive enough.
    const id = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(id);
    };
  }, []);

  const live = sources?.filter((s) => s.status === 'live').length ?? 0;
  const count = sources?.length ?? 0;

  return (
    <div className={cn('glass w-64 rounded-[3px]', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="label text-ink-muted">Sources</span>
        <span className="flex items-center gap-2">
          {failed ? (
            <span className="label-sm text-alert">Unreachable</span>
          ) : sources ? (
            <span className="tabular text-[11px] leading-none text-ink">
              {live}
              <span className="text-ink-muted">/{count} live</span>
            </span>
          ) : (
            <Skeleton className="w-12" height={8} />
          )}
          <svg
            viewBox="0 0 12 12"
            width={9}
            height={9}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinecap="round"
            aria-hidden
            className={cn(
              'text-ink-muted transition-transform duration-[var(--duration-quick)] ease-[var(--ease-glide)]',
              open && 'rotate-180',
            )}
          >
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : DURATION.quick, ease: EASE_SETTLE }}
            className="overflow-hidden"
          >
            <Rule className="mx-3.5 w-auto" />
            <ul className="flex flex-col gap-3 px-3.5 py-3">
              {failed && (
                <li className="flex flex-col gap-1">
                  <span className="text-[12px] leading-4 text-ink">
                    Health endpoint unreachable
                  </span>
                  <span className="text-[11px] leading-4 text-ink-muted">
                    {failed}. The curated index is unaffected — it ships with the
                    application and does not need the network.
                  </span>
                </li>
              )}

              {!failed && !sources && <Skeleton lines={3} height={9} />}

              {!failed &&
                sources?.map((s) => (
                  <li key={s.id} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={cn('mt-1 size-1.5 shrink-0 rounded-full', DOT[s.status])}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] leading-4 text-ink">
                          {s.label}
                        </span>
                        <span className="label-sm shrink-0 text-ink-muted">
                          {WORD[s.status]}
                        </span>
                      </span>
                      <span className="text-[11px] leading-4 text-ink-muted">
                        {s.detail ?? EXPLAIN[s.status]}
                      </span>
                      {s.lastSyncedAt && (
                        <span className="tabular text-[10px] leading-3 text-ink-muted">
                          {relative(s.lastSyncedAt)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}

              {!failed && sources?.length === 0 && (
                <li className="text-[11px] leading-4 text-ink-muted">
                  No sources registered.
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function relative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'synced just now';
  if (mins < 60) return `synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `synced ${hrs}h ago`;
  return `synced ${Math.round(hrs / 24)}d ago`;
}
