/**
 * MERIDIAN — curated source adapter.
 *
 * ── What it is ───────────────────────────────────────────────────────────────
 * The hand-built calendar in `@/lib/data/events`: ~200 events researched and
 * written by hand, each shipping a realistic `BuzzSignals` baseline.
 *
 * ── Why it implements EventSource ────────────────────────────────────────────
 * Because the alternative is a `if (demoMode)` branch threaded through the
 * whole app, and that branch always rots. The curated set is a first-class
 * source: it is the only one that implements `fetchEvents()`, it is always
 * `isConfigured()`, and it always reports `live`. Every live adapter's job is
 * to *sharpen* these numbers, never to replace the records.
 *
 * ── Signals contributed ──────────────────────────────────────────────────────
 * All six fields of BuzzSignals, as the baseline that live patches overwrite
 * field-by-field.
 */

import type { EventSource, SourceHealth, WorldEvent } from '@/lib/types';
import { EVENTS, EVENT_INDEX } from '@/lib/data/events';

const bootedAt = new Date().toISOString();

export const curatedSource: EventSource = {
  id: 'curated',
  label: 'MERIDIAN curated calendar',

  /** Static import — there is nothing to configure and nothing that can fail. */
  isConfigured: () => true,

  async fetchEvents(): Promise<WorldEvent[]> {
    return EVENTS;
  },

  health(): SourceHealth {
    return {
      id: 'curated',
      label: 'MERIDIAN curated calendar',
      status: 'live',
      lastSyncedAt: bootedAt,
      detail: `${EVENTS.length} events, hand-verified`,
    };
  },
};

/** Direct accessors — used by the API layer and by validate-data.ts. */
export const curatedEvents = (): WorldEvent[] => EVENTS;
export const curatedEventById = (id: string): WorldEvent | undefined =>
  EVENT_INDEX.get(id);
