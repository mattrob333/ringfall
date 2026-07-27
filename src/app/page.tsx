'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
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
import { useChromeStore } from '@/lib/stores/useChromeStore';

/**
 * MERIDIAN — the single surface.
 *
 * Composition rule: the globe is the room's only light source, so it occupies
 * the entire viewport and every other surface floats at the edges as black
 * glass. The centre stays clear. Nothing here owns state — the globe reads
 * beacons, the panels read selectors, and both are driven by the timeline.
 *
 * Layout rule: the top stack is the only thing with a fixed position. Its
 * height is *measured*, published as `--chrome-h`, and everything below hangs
 * off that. The previous version hard-coded the offset, which put the ranked
 * rail underneath the filter row with its top-ranked event unreadable — and
 * made a collapsible scrubber impossible, because the number would have been
 * wrong in one of the two states no matter what it was set to.
 */
export default function MeridianPage() {
  const beacons = useBeacons();
  const selectedEventId = useGlobeStore((s) => s.selectedEventId);
  const select = useGlobeStore((s) => s.select);
  const nudge = useTimelineStore((s) => s.nudge);
  const togglePlay = useTimelineStore((s) => s.togglePlay);
  const toggleTimeline = useChromeStore((s) => s.toggleTimeline);

  const chromeRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  // Publish the chrome height as a custom property rather than through React
  // state: this changes on every resize and on every collapse, and re-rendering
  // the globe's parent for a layout number would be wasteful.
  useLayoutEffect(() => {
    const el = chromeRef.current;
    const root = rootRef.current;
    if (!el || !root) return;

    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) root.style.setProperty('--chrome-h', `${h}px`);
    };

    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A 1200px-tall screen can afford the full scrubber; a 800px laptop cannot,
  // and on that machine the ranked rail is the thing being squeezed. Collapse
  // once on a short viewport — but never against an explicit preference, and
  // never again after the first decision.
  useEffect(() => {
    const { userSetTimeline, setTimelineCollapsed } = useChromeStore.getState();
    if (userSetTimeline) return;
    if (window.innerHeight < 820) {
      setTimelineCollapsed(true);
      // setTimelineCollapsed marks the preference as the member's, which is not
      // true here — reset it so their first real toggle still counts as theirs.
      useChromeStore.setState({ userSetTimeline: false });
    }
  }, []);

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
        case 't':
        case 'T':
          e.preventDefault();
          toggleTimeline();
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
  }, [selectedEventId, select, nudge, togglePlay, toggleTimeline]);

  return (
    <main
      ref={rootRef}
      className="relative h-dvh w-full overflow-hidden bg-void"
      style={{ ['--chrome-h' as string]: '15rem' }}
    >
      {/* ── The world ──────────────────────────────────────────────── */}
      <div className="absolute inset-0">
        <GlobeStage beacons={beacons} />
      </div>

      {/* ── Chrome: pinned top. Measured, not assumed. ─────────────── */}
      <div
        ref={chromeRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col"
      >
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
      {/* Hangs off the measured chrome and stops clear of the bottom
          instrumentation, so it can never be overlapped at either end. */}
      <div
        className="pointer-events-none absolute right-4 z-20 flex justify-end"
        style={{ top: 'calc(var(--chrome-h) + 0.75rem)', bottom: '5.5rem' }}
      >
        <div className="pointer-events-auto h-full">
          <EventRail />
        </div>
      </div>

      {/* ── Instrumentation, bottom edge ───────────────────────────── */}
      {/* The left cluster stands down while a dossier is open: they occupy the
          same corner, and the dossier is what the member is actually reading. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4">
        <div
          className={`pointer-events-auto flex flex-col gap-3 transition-opacity duration-[var(--duration-quick)] ${
            selectedEventId ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
          aria-hidden={selectedEventId ? true : undefined}
        >
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
