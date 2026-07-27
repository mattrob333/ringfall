'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Chrome layout state.
 *
 * Separate from the timeline store on purpose: this is about how much of the
 * screen the instrument panel is allowed to take, not about where in the year
 * you are looking. It persists, because a member who collapses the scrubber
 * wants it collapsed tomorrow too.
 */
interface ChromeState {
  /** Scrubber reduced to the handle, the date and a thin ribbon. */
  timelineCollapsed: boolean;
  /** Filter row hidden behind the Filters button. */
  filterBarOpen: boolean;
  /**
   * Measured height of the whole top stack, in pixels. Written by the shell on
   * every resize; read by the rail and the dossier so they sit *below* the
   * chrome instead of behind it.
   *
   * This exists because the alternative — a hard-coded `top-[17rem]` — was
   * already wrong at the first viewport it met, and silently wrong: the rail
   * rendered underneath the filter row with its top item unreadable.
   */
  chromeHeight: number;
  /**
   * True once the member has expressed a preference. Until then the shell is
   * free to collapse the scrubber on a short screen; afterwards it never
   * second-guesses them.
   */
  userSetTimeline: boolean;

  toggleTimeline: () => void;
  setTimelineCollapsed: (v: boolean) => void;
  toggleFilterBar: () => void;
  setChromeHeight: (px: number) => void;
}

export const useChromeStore = create<ChromeState>()(
  persist(
    (set) => ({
      timelineCollapsed: false,
      filterBarOpen: true,
      chromeHeight: 0,
      userSetTimeline: false,

      toggleTimeline: () =>
        set((s) => ({ timelineCollapsed: !s.timelineCollapsed, userSetTimeline: true })),
      setTimelineCollapsed: (timelineCollapsed) =>
        set({ timelineCollapsed, userSetTimeline: true }),
      toggleFilterBar: () => set((s) => ({ filterBarOpen: !s.filterBarOpen })),
      // Guard the write: an unmeasured element reports 0 and would slam every
      // dependent panel to the top of the screen for a frame.
      setChromeHeight: (px) => set((s) => (px > 0 && px !== s.chromeHeight ? { chromeHeight: px } : s)),
    }),
    {
      name: 'meridian.chrome.v1',
      storage: createJSONStorage(() => localStorage),
      // Never persist the measurement — it is a property of this viewport.
      partialize: (s) => ({
        timelineCollapsed: s.timelineCollapsed,
        filterBarOpen: s.filterBarOpen,
        userSetTimeline: s.userSetTimeline,
      }),
      skipHydration: false,
    },
  ),
);
