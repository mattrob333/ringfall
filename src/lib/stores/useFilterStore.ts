'use client';

import { create } from 'zustand';
import {
  DEFAULT_FILTERS,
  type EventCategory,
  type EventFilters,
  type EventTier,
} from '@/lib/types';

interface FilterState extends EventFilters {
  toggleCategory: (c: EventCategory) => void;
  toggleTier: (t: EventTier) => void;
  setMaxPriceIndex: (n: number) => void;
  setMinScore: (n: number) => void;
  setPeerActivityOnly: (v: boolean) => void;
  setQuery: (q: string) => void;
  clear: () => void;
  /** Number of filters deviating from default — drives the "N active" badge */
  activeCount: () => number;
}

const toggle = <T>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export const useFilterStore = create<FilterState>((set, get) => ({
  ...DEFAULT_FILTERS,

  toggleCategory: (c) => set((s) => ({ categories: toggle(s.categories, c) })),
  toggleTier: (t) => set((s) => ({ tiers: toggle(s.tiers, t) })),
  setMaxPriceIndex: (maxPriceIndex) => set({ maxPriceIndex }),
  setMinScore: (minScore) => set({ minScore }),
  setPeerActivityOnly: (peerActivityOnly) => set({ peerActivityOnly }),
  setQuery: (query) => set({ query }),
  clear: () => set({ ...DEFAULT_FILTERS }),

  activeCount: () => {
    const s = get();
    let n = 0;
    if (s.categories.length) n++;
    if (s.tiers.length) n++;
    if (s.maxPriceIndex < 5) n++;
    if (s.minScore > 0) n++;
    if (s.peerActivityOnly) n++;
    if (s.query.trim()) n++;
    return n;
  },
}));
