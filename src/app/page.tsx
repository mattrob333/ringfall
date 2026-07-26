'use client';

import { useEffect } from 'react';
import { GlobeStage } from '@/components/globe';
import {
  TopBar,
  FilterBar,
  SignalPanel,
  Legend,
  GlobeControls,
  CommandHint,
} from '@/components/chrome';
import { Timeline } from '@/components/timeline';
import { EventRail, EventDossier, HoverReadout } from '@/components/panels';
import { SocialLive } from '@/components/social';
import { useBeacons } from '@/lib/selectors';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { useTimelineStore } from '@/lib/stores/useTimelineStore';

/**
 * MERIDIAN — the single surface.
 *
 * Composition rule: the globe is the room's only light source, so it occupies
 * the entire viewport and every other surface floats at the edges as black
 * glass. The centre stays clear. Nothing here owns state — the globe reads
 * beacons, the panels read selectors, and both are driven by the timeline.
 */
export default function MeridianPage() {
  const beacons = useBeacons();
  const selectedEventId = useGlobeStore((s) => s.selectedEventId);
  const select = useGlobeStore((s) => s.select);
  const nudge = useTimelineStore((s) => s.nudge);
  const togglePlay = useTimelineStore((s) => s.togglePlay);

  // Global keyboard control. The scrubber owns arrow keys while focused; these
  // are the app-level fallbacks that work from anywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;

      switch (e.key) {
        case 'Escape':
          if (selectedEventId) {
            e.preventDefault();
            select(null);
          }
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          nudge(e.shiftKey ? -7 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          nudge(e.shiftKey ? 7 : 1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEventId, select, nudge, togglePlay]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-void">
      {/* ── The world ──────────────────────────────────────────────── */}
      <div className="absolute inset-0">
        <GlobeStage beacons={beacons} />
      </div>

      {/* ── Chrome: pinned top ─────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col">
        <div className="pointer-events-auto">
          <TopBar />
        </div>
        <div className="pointer-events-auto">
          <Timeline />
        </div>
        <div className="pointer-events-auto">
          <FilterBar />
        </div>
      </div>

      {/* ── The ranked index, right edge ───────────────────────────── */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center pr-4">
        <div className="pointer-events-auto">
          <EventRail />
        </div>
      </div>

      {/* ── Instrumentation, bottom edge ───────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4">
        <div className="pointer-events-auto flex flex-col gap-3">
          <SignalPanel />
          <Legend />
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-3">
          <CommandHint />
          <GlobeControls />
        </div>
      </div>

      {/* ── The dossier, over everything ───────────────────────────── */}
      <EventDossier />

      {/* ── Cursor-follow readout ──────────────────────────────────── */}
      <HoverReadout />

      {/* Peer interest drips in slowly while the app is open, so the club
          reads as inhabited rather than as a static seed. Renders nothing. */}
      <SocialLive />
    </main>
  );
}
