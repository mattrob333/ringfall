/**
 * MERIDIAN — shared adapter plumbing.
 *
 * Server-only. Every live adapter goes through here so that timeout, error
 * shaping and health bookkeeping are identical across sources and a misbehaving
 * upstream can never take the app down.
 *
 * Design rule for this whole directory: **an adapter may fail, but it may never
 * throw into the app.** Every public method returns a value; failures are
 * recorded on the adapter's health record and the curated baseline stands.
 */

import type { SourceHealth } from '@/lib/types';

/** Hard ceiling on any single upstream call. */
export const ADAPTER_TIMEOUT_MS = 8_000;

/** Read an env var, treating empty/whitespace as absent. */
export function env(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

/**
 * `fetch` + timeout + JSON parse + non-2xx → throw.
 *
 * `cache: 'no-store'` because Next 16 would otherwise be free to cache these at
 * the fetch layer; signal freshness is managed one level up by the source
 * registry's TTL cache, and having two caches with different lifetimes is how
 * you end up debugging phantom staleness at 2am.
 */
export async function getJSON<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init?.timeoutMs ?? ADAPTER_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpError(res.status, url, body.slice(0, 300));
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Mutable health bookkeeping shared by the live adapters.
 *
 * `status` semantics, matching the SourceHealth contract in types.ts:
 *   unconfigured — required env vars absent. The normal state out of the box.
 *   live         — credentials present and the last fetch succeeded.
 *   error        — credentials present but the last fetch failed.
 *   stale        — credentials present, a previous fetch succeeded, but the
 *                  data is older than STALE_AFTER_MS.
 */
export const STALE_AFTER_MS = 60 * 60 * 1000;

export class HealthTracker {
  private lastSyncedAt?: string;
  private lastError?: string;
  private successDetail?: string;
  private everSucceeded = false;

  constructor(
    readonly id: string,
    readonly label: string,
    /** Env var names this adapter needs. Used for the `unconfigured` detail. */
    readonly requiredEnv: string[],
  ) {}

  isConfigured(): boolean {
    return this.requiredEnv.every((k) => env(k) !== undefined);
  }

  markSuccess(detail?: string): void {
    this.lastSyncedAt = new Date().toISOString();
    this.lastError = undefined;
    this.everSucceeded = true;
    this.successDetail = detail;
  }

  markError(err: unknown): void {
    this.lastError =
      err instanceof HttpError
        ? `${err.message}${err.body ? ` — ${err.body}` : ''}`
        : err instanceof Error
          ? err.message
          : String(err);
  }

  health(): SourceHealth {
    if (!this.isConfigured()) {
      return {
        id: this.id,
        label: this.label,
        status: 'unconfigured',
        detail: `Set ${this.requiredEnv.join(' and ')} to enable`,
      };
    }
    if (this.lastError) {
      return {
        id: this.id,
        label: this.label,
        status: 'error',
        lastSyncedAt: this.lastSyncedAt,
        detail: this.lastError,
      };
    }
    if (!this.everSucceeded) {
      return {
        id: this.id,
        label: this.label,
        status: 'stale',
        detail: 'Configured, awaiting first sync',
      };
    }
    const age = Date.now() - Date.parse(this.lastSyncedAt ?? '');
    return {
      id: this.id,
      label: this.label,
      status: age > STALE_AFTER_MS ? 'stale' : 'live',
      lastSyncedAt: this.lastSyncedAt,
      detail: this.successDetail,
    };
  }
}

/** Merge a partial signal patch into an accumulator map, last write wins. */
export function mergePatch(
  into: Map<string, Partial<import('@/lib/types').BuzzSignals>>,
  id: string,
  patch: Partial<import('@/lib/types').BuzzSignals>,
): void {
  const existing = into.get(id);
  into.set(id, existing ? { ...existing, ...patch } : patch);
}

/**
 * Run promises with bounded concurrency. Live adapters fan out one request per
 * event; without a limit, 200 events would open 200 sockets and trip every
 * upstream rate limiter we have.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** ISO date `YYYY-MM-DD` → RFC3339 instant at UTC midnight. */
export const isoDateToInstant = (iso: string, endOfDay = false): string =>
  `${iso}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
