'use client';

/**
 * MERIDIAN — profile and deep-link UI state.
 *
 * Separate from `useSocialStore` on purpose. That store is the system of record
 * for what the member *authored* — signals, cabins, their own profile — and it
 * is persisted. This one holds three pieces of ephemeral interface state that
 * must be reachable from anywhere without prop-drilling and must never be
 * written to disk:
 *
 *   • which member's profile is open,
 *   • the trip a share link asked us to open,
 *   • whether that invitation banner has been dismissed.
 *
 * A store rather than a React context because `useOpenProfile()` has to work
 * from components that are not descendants of the sheet — a peer plate on the
 * globe's hover readout is not inside any provider we could reasonably mount.
 * zustand gives us that for free, and the actions are stable references, so
 * `useOpenProfile()` never causes a re-render of its caller.
 */

import { create } from 'zustand';

export interface TripInvitation {
  eventId: string;
  groupId?: string;
}

interface ProfileUiState {
  /** Member whose profile is open, or `null`. */
  profileMemberId: string | null;
  /** A trip a `?event=…&group=…` link asked for, once resolved against the data. */
  invitation: TripInvitation | null;
  /** Set once the banner for the current invitation has been dismissed or acted on. */
  invitationDismissed: boolean;

  openProfile: (memberId: string) => void;
  closeProfile: () => void;
  setInvitation: (invitation: TripInvitation | null) => void;
  dismissInvitation: () => void;
}

export const useProfileUiStore = create<ProfileUiState>()((set) => ({
  profileMemberId: null,
  invitation: null,
  invitationDismissed: false,

  openProfile: (memberId) => set({ profileMemberId: memberId }),
  closeProfile: () => set({ profileMemberId: null }),
  setInvitation: (invitation) => set({ invitation, invitationDismissed: false }),
  dismissInvitation: () => set({ invitationDismissed: true }),
}));

/**
 * Open a member's profile from anywhere.
 *
 * ```tsx
 * const openProfile = useOpenProfile();
 * <button onClick={() => openProfile(member.id)}>…</button>
 * ```
 *
 * The returned function is referentially stable for the life of the app, so it
 * is safe in a dependency array and safe to pass to a memoised child.
 */
export function useOpenProfile(): (memberId: string) => void {
  return useProfileUiStore((s) => s.openProfile);
}

/** The id of the profile currently open, or `null`. */
export function useOpenProfileId(): string | null {
  return useProfileUiStore((s) => s.profileMemberId);
}

/** Non-reactive open, for anything outside React. */
export const openProfile = (memberId: string): void =>
  useProfileUiStore.getState().openProfile(memberId);
