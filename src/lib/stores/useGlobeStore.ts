'use client';

import { create } from 'zustand';
import type { GeoPoint } from '@/lib/types';

export type GlobeQuality = 'high' | 'balanced' | 'economy';

interface FlightRequest {
  target: GeoPoint;
  /** Camera distance in globe radii. 1.0 sits on the surface. */
  distance: number;
  /** Monotonic counter so repeat requests to the same point still fire */
  nonce: number;
}

interface GlobeState {
  /** Event the user has committed attention to — opens the dossier */
  selectedEventId: string | null;
  /** Event under the cursor — drives the hover readout, never the dossier */
  hoveredEventId: string | null;
  /** Pending camera move, consumed by the globe's flight controller */
  flight: FlightRequest | null;
  autoRotate: boolean;
  /** True once the globe has finished its opening move and geometry is up */
  ready: boolean;
  quality: GlobeQuality;
  /** Draw country fills as well as outlines */
  showLandmass: boolean;
  showGraticule: boolean;

  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  flyTo: (target: GeoPoint, distance?: number) => void;
  consumeFlight: () => void;
  setAutoRotate: (v: boolean) => void;
  setReady: (v: boolean) => void;
  setQuality: (q: GlobeQuality) => void;
  toggleLandmass: () => void;
  toggleGraticule: () => void;
}

export const useGlobeStore = create<GlobeState>((set, get) => ({
  selectedEventId: null,
  hoveredEventId: null,
  flight: null,
  autoRotate: true,
  ready: false,
  quality: 'high',
  showLandmass: true,
  showGraticule: true,

  select: (id) => set({ selectedEventId: id, autoRotate: id ? false : get().autoRotate }),
  hover: (id) => set({ hoveredEventId: id }),
  // 3.5 subtends ~33 degrees against the Canvas's 34 degree vertical FOV, so a
  // focused event fills the frame without the limb spilling off screen.
  flyTo: (target, distance = 3.5) =>
    set((s) => ({
      flight: { target, distance, nonce: (s.flight?.nonce ?? 0) + 1 },
      autoRotate: false,
    })),
  consumeFlight: () => set({ flight: null }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setReady: (ready) => set({ ready }),
  setQuality: (quality) => set({ quality }),
  toggleLandmass: () => set((s) => ({ showLandmass: !s.showLandmass })),
  toggleGraticule: () => set((s) => ({ showGraticule: !s.showGraticule })),
}));
