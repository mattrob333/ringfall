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

// ── The cabin, opened ───────────────────────────────────────────────────────
export { GroupCard } from './GroupCard';
export type { GroupCardProps } from './GroupCard';

export { GroupChat, useThread, useUnreadFor } from './GroupChat';
export type { GroupChatProps } from './GroupChat';

export { GroupRoster } from './GroupRoster';
export type { GroupRosterProps } from './GroupRoster';

export { TypingDots } from './TypingDots';
export type { TypingDotsProps } from './TypingDots';

export { CharterPanel } from './CharterPanel';
export type { CharterPanelProps } from './CharterPanel';

export { MemberBadge } from './MemberBadge';
export type { MemberBadgeProps } from './MemberBadge';

export { CurrentMemberChip } from './CurrentMemberChip';
export type { CurrentMemberChipProps } from './CurrentMemberChip';

export { Avatar } from './Avatar';
export type { AvatarProps } from './Avatar';

// ── Faces, profiles and invitations ─────────────────────────────────────────
export { MemberPortrait, PortraitPlate, PortraitField } from './MemberPortrait';
export type {
  MemberPortraitProps,
  PortraitPlateProps,
  PortraitFieldProps,
} from './MemberPortrait';

export { MemberProfileSheet, SocialRoot } from './MemberProfileSheet';
export type { MemberProfileSheetProps } from './MemberProfileSheet';

/**
 * Open any member's record from anywhere — no prop drilling, no provider, and
 * no requirement to be a descendant of the sheet. The sheet itself is mounted
 * once by `CurrentMemberChip`.
 */
export { useOpenProfile, useOpenProfileId, openProfile } from '@/lib/social/profileStore';

export { ShareTrip, TripLinkReader } from './ShareTrip';
export type { ShareTripProps } from './ShareTrip';

export { InviteDialog } from './InviteDialog';
export type { InviteDialogProps } from './InviteDialog';

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
