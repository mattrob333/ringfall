/**
 * MERIDIAN — social layer components.
 *
 * The seven named below are the contract the panels agent imports against.
 * Everything else in this directory is an internal of one of them.
 */

export { InterestControl } from './InterestControl';
export type { InterestControlProps } from './InterestControl';

export { PeerStack } from './PeerStack';
export type { PeerStackProps } from './PeerStack';

export { GroupList } from './GroupList';
export type { GroupListProps } from './GroupList';

export { CharterPanel } from './CharterPanel';
export type { CharterPanelProps } from './CharterPanel';

export { MemberBadge } from './MemberBadge';
export type { MemberBadgeProps } from './MemberBadge';

export { CurrentMemberChip } from './CurrentMemberChip';
export type { CurrentMemberChipProps } from './CurrentMemberChip';

export { Avatar } from './Avatar';
export type { AvatarProps } from './Avatar';

// ── Supporting pieces, exported because they are useful elsewhere ───────────
export { MemberTierMark, MEMBER_TIER_LABEL } from './MemberTierMark';
export type { MemberTierMarkProps } from './MemberTierMark';

export { SocialLive } from './SocialLive';
export type { SocialLiveProps } from './SocialLive';

export {
  useGroupsFor,
  useInterestLevel,
  useMyGroupFor,
  usePeerCount,
  usePeers,
} from './hooks';
