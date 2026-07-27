/**
 * MERIDIAN — the social layer's public surface.
 *
 * The five exports at the top of this file are a contract with the data engine,
 * the globe and the panels. Renaming any of them breaks the build; add here,
 * never subtract.
 *
 * `getPeerCounts` is deliberately non-reactive and free of browser APIs so it
 * can run inside a server render or a plain node script. `usePeerCounts` is the
 * hook form and follows the live drip.
 */

// ── The contract ────────────────────────────────────────────────────────────
export { getPeerCounts } from './simulation';
export { usePeerCounts } from './peerCounts';
export { useSocialStore } from './useSocialStore';
export { MEMBERS, MEMBER_INDEX } from './members';
export { quoteCharter, JETS } from './charter';

// ── The rest of the layer, for anyone who wants it ──────────────────────────
export { getMember, MEMBER_BY_HANDLE, JET_OWNERS, YOU, HOME_BASE_OPTIONS } from './members';
export {
  JET_INDEX,
  candidateJets,
  costCurve,
  formatHours,
  formatUsd,
  selectJet,
  usableRangeNm,
} from './charter';
export type { CharterBreakdown, CharterQuoteDetail, QuoteOptions } from './charter';

export {
  buildSimulation,
  computePeerCounts,
  deriveStatus,
  getSimulation,
  resetSimulation,
  startDrip,
  WORLD_SEED,
} from './simulation';
export type { DripController, SimulatedWorld } from './simulation';

export { useSocialHydration, socialSnapshot } from './useSocialStore';
export type { ScoredEventLite } from './useSocialStore';

export { avatarSpec, avatarSvg, avatarDataUri, avatarAccent, initialsFrom } from './avatar';
export type { AvatarSpec } from './avatar';

export { makeRng, hashSeed } from './rng';
export type { Rng } from './rng';

// ── Conversation ────────────────────────────────────────────────────────────
export {
  buildThread,
  countUnread,
  formatUnread,
  getThread,
  getThreads,
  mergeThread,
  nextSentAt,
  readWatermark,
  resetThreads,
  CHAT_SEED,
} from './chat';
export type { ChatMessage, ChatMessageKind } from './chat';

// ── Presence ────────────────────────────────────────────────────────────────
export {
  getPresenceTick,
  isOnline,
  isPresencePaused,
  resetPresence,
  setPresencePaused,
  subscribePresence,
  typingIn,
  useGroupPresence,
  useIsOnline,
  usePresenceTick,
} from './presence';
export type { GroupPresence } from './presence';
