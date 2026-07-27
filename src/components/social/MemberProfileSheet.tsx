'use client';

import { useMemo, useState } from 'react';

import {
  Button,
  CategoryGlyph,
  CATEGORY_LABEL,
  cn,
  EmptyState,
  formatDateRange,
  formatDaysUntil,
  Rule,
  ScrollArea,
  Sheet,
  Toggle,
} from '@/components/ui';
import { EVENT_INDEX } from '@/lib/data/events';
import {
  distanceToGateway,
  gatewayFor,
  MEMBER_INDEX,
  nearestGateway,
  resolveVoucher,
  searchGateways,
  toHomeBase,
  type Gateway,
  type MemberDossier,
} from '@/lib/social/members';
import {
  describeNotification,
  useActivityFeed,
  type ActivityNotification,
} from '@/lib/social/notifications';
import { useProfileUiStore } from '@/lib/social/profileStore';
import { getSimulation } from '@/lib/social/simulation';
import {
  INVITE_ALLOWANCE,
  socialSnapshot,
  useSocialHydration,
  useSocialStore,
} from '@/lib/social/useSocialStore';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { EVENT_CATEGORIES } from '@/lib/types';
import type { EventCategory, InterestLevel, Member, TravelGroup, WorldEvent } from '@/lib/types';
import { InviteDialog } from './InviteDialog';
import { MemberPortrait, PortraitField } from './MemberPortrait';
import { MEMBER_TIER_LABEL, MemberTierMark } from './MemberTierMark';
import { TripLinkReader } from './ShareTrip';

export interface MemberProfileSheetProps {
  memberId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * A member, at length.
 *
 * The argument this product makes is that the people are the reason to get on
 * the aircraft, so this is the surface where that has to be true. It is a
 * dossier, not a social profile: what they do, where they keep the aeroplane,
 * where they turn up, who vouched for them, and — the part that actually
 * converts — what you and they already have in common.
 *
 * Everything below the fold is derived from the same simulation the globe
 * reads, so a member's calendar here is the calendar the beacons are drawn
 * from. Nothing is invented at the point of display.
 */
export function MemberProfileSheet({ memberId, open, onClose }: MemberProfileSheetProps) {
  const meId = useSocialStore((s) => s.currentMember.id);
  const isSelf = memberId === meId;
  const member = isSelf ? undefined : MEMBER_INDEX.get(memberId);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={isSelf ? 'Your record' : member ? `${member.name} — member record` : 'Member record'}
      width="min(30rem, 94vw)"
      scrim
    >
      {isSelf ? (
        <SelfProfileBody onClose={onClose} />
      ) : member ? (
        <ProfileBody member={member} onClose={onClose} />
      ) : (
        <EmptyState
          title="No such member"
          body="That record is not in the register. It may have been withdrawn."
          action={
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          }
        />
      )}
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ProfileBodyProps {
  member: MemberDossier;
  onClose: () => void;
}

const LEVEL_LABEL: Record<InterestLevel, string> = {
  watching: 'Watching',
  interested: 'Interested',
  committed: 'Going',
};

function ProfileBody({ member, onClose }: ProfileBodyProps) {
  const hydrated = useSocialHydration();
  const drip = useSocialStore((s) => s.dripRevealed);
  const myInterests = useSocialStore((s) => s.interests);
  const me = useSocialStore((s) => s.currentMember);
  const groups = useSocialStore((s) => s.groups);
  const select = useGlobeStore((s) => s.select);
  const flyTo = useGlobeStore((s) => s.flyTo);
  const [asking, setAsking] = useState<{ eventId: string; groupId?: string } | null>(null);

  const voucher = resolveVoucher(member.verifiedBy);
  const openProfile = useProfileUiStore((s) => s.openProfile);

  // Their public calendar: everything they have signalled on that has not
  // already happened, soonest first. Read from the simulation rather than any
  // per-event hook, because this is the one view that is by member.
  const theirEvents = useMemo(() => {
    const world = getSimulation();
    const released = world.dripQueue.slice(0, drip);
    const today = new Date().toISOString().slice(0, 10);
    const rows: Array<{ event: WorldEvent; level: InterestLevel }> = [];
    const seen = new Set<string>();
    for (const s of [...released, ...world.signals]) {
      if (s.memberId !== member.id || seen.has(s.eventId)) continue;
      const event = EVENT_INDEX.get(s.eventId);
      if (!event || event.end < today) continue;
      seen.add(s.eventId);
      rows.push({ event, level: s.level });
    }
    return rows.sort((a, b) => (a.event.start < b.event.start ? -1 : 1));
  }, [member.id, drip]);

  const theirGroups = useMemo(
    () => groups.filter((g) => g.members.some((m) => m.memberId === member.id)),
    [groups, member.id],
  );

  // ── Shared ground ────────────────────────────────────────────────────────
  // The whole social hook, in two lists: what you both like, and where you are
  // both already going. It is the difference between "a stranger" and "the
  // person you should be splitting a cabin with".
  const shared = useMemo(() => {
    const mine = new Set(me.interests);
    const categories = member.interests.filter((c) => mine.has(c));
    const myEventIds = new Set(myInterests.map((i) => i.eventId));
    const events = theirEvents.filter((r) => myEventIds.has(r.event.id));
    const cabins = theirGroups.filter((g) => g.members.some((m) => m.memberId === me.id));
    return { categories, events, cabins };
  }, [me.interests, me.id, member.interests, myInterests, theirEvents, theirGroups]);

  const openEvent = (event: WorldEvent): void => {
    select(event.id);
    flyTo(event.coords);
    onClose();
  };

  // My own calendar, for the "ask them along" list at the foot of the record.
  const myUpcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return myInterests
      .map((i) => EVENT_INDEX.get(i.eventId))
      .filter((e): e is WorldEvent => Boolean(e) && e!.end >= today)
      .sort((a, b) => (a.start < b.start ? -1 : 1))
      .slice(0, 4);
  }, [myInterests]);

  return (
    <>
      <ScrollArea className="h-full" contentClassName="flex flex-col gap-5 p-5 pb-8">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <header className="flex gap-4">
          <MemberPortrait
            seed={member.avatarSeed}
            name={member.name}
            size={124}
            shape="panel"
            {...(member.photoUrl ? { photoUrl: member.photoUrl } : {})}
            decorative
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="font-display text-[24px] leading-7 text-ink">{member.name}</h2>
            <p className="label-sm mt-2 text-ink-faint">@{member.handle}</p>

            <div className="mt-3 flex items-center gap-2">
              <MemberTierMark tier={member.tier} />
              <span className="label-sm text-ink-muted">
                {MEMBER_TIER_LABEL[member.tier]} · {member.memberSince.slice(0, 4)}
              </span>
            </div>

            {member.verifiedBy && (
              <p className="mt-3 text-[11px] leading-4 text-ink-faint">
                Vouched in by{' '}
                {voucher ? (
                  <button
                    type="button"
                    onClick={() => openProfile(voucher.id)}
                    className="text-brass underline-offset-2 transition-colors hover:text-brass-bright hover:underline"
                  >
                    {voucher.name}
                  </button>
                ) : (
                  <span className="text-ink-muted">{member.verifiedBy}</span>
                )}
              </p>
            )}

            {member.lastSeenAt && (
              <p className="label-sm mt-auto pt-3 text-ink-ghost">
                Seen {relativeTime(member.lastSeenAt)}
              </p>
            )}
          </div>
        </header>

        <p className="text-[13px] leading-[20px] text-ink-muted">{member.bio}</p>

        <Rule variant="brass" />

        {/* ── The facts ─────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          {member.profession && <Fact label="Does" value={member.profession} />}
          <Fact
            label="Based"
            value={
              <>
                {member.homeBase.city}, {member.homeBase.country}
                <span className="tabular ml-2 text-ink-faint">{member.homeBase.homeJetPort}</span>
              </>
            }
          />
          {member.age ? <Fact label="Age" value={member.age} /> : null}
          {member.languages?.length ? (
            <Fact label="Speaks" value={member.languages.join(', ')} />
          ) : null}
          <Fact
            label="Aircraft"
            value={
              member.aircraft ? (
                <>
                  {member.aircraft}
                  <span
                    className={cn('ml-2 text-[11px]', member.openToJetShare ? 'text-brass' : 'text-ink-faint')}
                  >
                    {member.openToJetShare ? 'offering seats' : 'not offering seats'}
                  </span>
                </>
              ) : member.openToJetShare ? (
                <span className="text-ink-muted">None — will take a seat on yours</span>
              ) : (
                <span className="text-ink-muted">None</span>
              )
            }
          />
        </section>

        <Rule />

        {/* ── Interests ─────────────────────────────────────────────────── */}
        <section>
          <p className="label text-ink-muted">Goes for</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {member.interests.map((c) => (
              <CategoryTag key={c} category={c} shared={shared.categories.includes(c)} />
            ))}
          </div>
        </section>

        {member.signatureSpots?.length ? (
          <>
            <Rule variant="ghost" />
            <section>
              <p className="label text-ink-muted">Found at</p>
              <ul className="mt-3 flex flex-col">
                {member.signatureSpots.map((spot, i) => (
                  <li key={spot} className="text-[13px] leading-5 text-ink-muted">
                    {i > 0 && <Rule variant="ghost" className="my-2" />}
                    {spot}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {/* ── Shared ground ─────────────────────────────────────────────── */}
        {hydrated &&
          (shared.categories.length > 0 || shared.events.length > 0 || shared.cabins.length > 0) && (
            <section className="border border-brass-deep/60 bg-brass-wash p-3.5">
              <p className="label text-brass">Shared ground</p>
              <div className="mt-3 flex flex-col gap-2.5">
                {shared.categories.length > 0 && (
                  <p className="text-[12px] leading-[18px] text-ink-muted">
                    You both go for{' '}
                    <span className="text-ink">
                      {joinWords(shared.categories.map((c) => CATEGORY_LABEL[c].toLowerCase()))}
                    </span>
                    .
                  </p>
                )}
                {shared.events.map((row) => (
                  <button
                    key={row.event.id}
                    type="button"
                    onClick={() => openEvent(row.event)}
                    className="flex w-full items-baseline justify-between gap-4 text-left"
                  >
                    <span className="font-display truncate text-[14px] text-ink">
                      {row.event.name}
                    </span>
                    <span className="label-sm shrink-0 text-brass">
                      Both {row.level === 'committed' ? 'going' : 'watching'}
                    </span>
                  </button>
                ))}
                {shared.cabins.map((g) => (
                  <p key={g.id} className="text-[12px] leading-[18px] text-ink-muted">
                    On your manifest for <span className="text-ink">{g.name}</span>.
                  </p>
                ))}
              </div>
            </section>
          )}

        <Rule />

        {/* ── Their calendar ────────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between gap-4">
            <p className="label text-ink-muted">On their calendar</p>
            <p className="tabular text-[11px] text-ink-faint">{theirEvents.length}</p>
          </div>
          {theirEvents.length === 0 ? (
            <p className="mt-3 text-[11px] leading-4 text-ink-faint">
              Nothing signalled publicly. Members at this rank often do not.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col">
              {theirEvents.slice(0, 7).map((row, i) => (
                <li key={row.event.id}>
                  {i > 0 && <Rule variant="ghost" />}
                  <button
                    type="button"
                    onClick={() => openEvent(row.event)}
                    className="group flex w-full items-baseline justify-between gap-4 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="font-display block truncate text-[14px] leading-5 text-ink-muted transition-colors group-hover:text-ink">
                        {row.event.name}
                      </span>
                      <span className="label-sm mt-1.5 block text-ink-ghost">
                        {row.event.city} · {formatDateRange(row.event.start, row.event.end)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'label-sm shrink-0',
                        row.level === 'committed' ? 'text-brass' : 'text-ink-faint',
                      )}
                    >
                      {LEVEL_LABEL[row.level]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {theirGroups.length > 0 && (
          <>
            <Rule />
            <section>
              <p className="label text-ink-muted">Cabins</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {theirGroups.map((g) => (
                  <CabinLine key={g.id} group={g} memberId={member.id} onOpen={openEvent} />
                ))}
              </ul>
            </section>
          </>
        )}

        <Rule />

        {/* ── The record ────────────────────────────────────────────────── */}
        <section className="grid grid-cols-3 gap-4">
          <Figure label="Member since" value={member.memberSince.slice(0, 4)} />
          <Figure label="Trips this year" value={member.tripsThisYear ?? '—'} />
          <Figure label="Events attended" value={member.eventsAttended ?? '—'} />
        </section>

        {/* ── Ask them along ────────────────────────────────────────────── */}
        {hydrated && myUpcoming.length > 0 && (
          <>
            <Rule variant="brass" />
            <section>
              <p className="label text-ink-muted">Ask them along</p>
              <p className="mt-2 text-[11px] leading-4 text-ink-faint">
                Opens an invitation in your own mail client. MERIDIAN sends nothing on your behalf.
              </p>
              <div className="mt-3 flex flex-col">
                {myUpcoming.map((event, i) => {
                  const cabin = groups.find(
                    (g) => g.eventId === event.id && g.members.some((m) => m.memberId === me.id),
                  );
                  return (
                    <div key={event.id}>
                      {i > 0 && <Rule variant="ghost" />}
                      <button
                        type="button"
                        onClick={() =>
                          setAsking({ eventId: event.id, ...(cabin ? { groupId: cabin.id } : {}) })
                        }
                        className="group flex w-full items-baseline justify-between gap-4 py-2.5 text-left"
                      >
                        <span className="font-display truncate text-[14px] text-ink-muted transition-colors group-hover:text-ink">
                          {event.name}
                        </span>
                        <span className="label-sm shrink-0 text-brass">Ask</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        <div className="mt-auto flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </ScrollArea>

      {asking && (
        <InviteDialog
          open
          eventId={asking.eventId}
          {...(asking.groupId ? { groupId: asking.groupId } : {})}
          preselectedMemberIds={[member.id]}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parts
// ─────────────────────────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="label-sm w-20 shrink-0 text-ink-faint">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{value}</span>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-sm text-ink-faint">{label}</span>
      <span className="font-display text-[19px] leading-6 text-ink">{value}</span>
    </div>
  );
}

function CategoryTag({ category, shared }: { category: EventCategory; shared: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-[2px] border px-2',
        shared ? 'border-brass/70 bg-brass-wash text-brass' : 'border-ink/10 text-ink-muted',
      )}
      title={shared ? `${CATEGORY_LABEL[category]} — you too` : CATEGORY_LABEL[category]}
    >
      <CategoryGlyph category={category} size={12} />
      <span className="label-sm">{CATEGORY_LABEL[category]}</span>
    </span>
  );
}

function CabinLine({
  group,
  memberId,
  onOpen,
}: {
  group: TravelGroup;
  memberId: string;
  onOpen: (event: WorldEvent) => void;
}) {
  const event = EVENT_INDEX.get(group.eventId);
  const role = group.members.find((m) => m.memberId === memberId)?.role;
  if (!event) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(event)}
        className="group flex w-full items-baseline justify-between gap-4 text-left"
      >
        <span className="min-w-0">
          <span className="font-display block truncate text-[14px] leading-5 text-ink-muted transition-colors group-hover:text-ink">
            {group.name}
          </span>
          <span className="label-sm mt-1.5 block text-ink-ghost">
            {event.name} · {group.members.length}/{group.capacity}
          </span>
        </span>
        <span className="label-sm shrink-0 text-ink-faint">
          {role === 'host' ? 'Hosting' : 'Aboard'}
        </span>
      </button>
    </li>
  );
}

/**
 * Presence, in words. Only ever rendered inside an open sheet — which is to
 * say, only after a click — so reading the wall clock here cannot desynchronise
 * a server render.
 */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'recently';
  const mins = Math.max(1, Math.round((Date.now() - then) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Your own record
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_ORDER: readonly InterestLevel[] = ['committed', 'interested', 'watching'];

const LEVEL_HEADING: Record<InterestLevel, string> = {
  committed: 'Going',
  interested: 'Interested',
  watching: 'Watching',
};

interface TripRow {
  event: WorldEvent;
  level: InterestLevel;
  group: TravelGroup | undefined;
  peers: number;
  daysUntil: number;
}

/**
 * The member's own record.
 *
 * Ordered the way he actually uses it: what has happened since he last looked,
 * then where he is going, and only then the settings. The old version led with
 * a scrolling list of airports, which is a configuration screen wearing a
 * profile's clothes — everything to do with identity is now folded into one
 * disclosure at the foot.
 */
function SelfProfileBody({ onClose }: { onClose: () => void }) {
  const hydrated = useSocialHydration();
  const me = useSocialStore((s) => s.currentMember);
  const interests = useSocialStore((s) => s.interests);
  const groups = useSocialStore((s) => s.groups);
  const drip = useSocialStore((s) => s.dripRevealed);
  const invitesRemaining = useSocialStore((s) => s.invitesRemaining);
  const select = useGlobeStore((s) => s.select);
  const flyTo = useGlobeStore((s) => s.flyTo);
  const openProfile = useProfileUiStore((s) => s.openProfile);
  const voucher = resolveVoucher(me.verifiedBy);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openEvent = (event: WorldEvent): void => {
    select(event.id);
    flyTo(event.coords);
    onClose();
  };

  // ── The itinerary ────────────────────────────────────────────────────────
  // Everything he has signalled on that has not finished, with the cabin he is
  // on and how many members are on the same fixture. Peer counts come off the
  // snapshot rather than a per-row hook — one row per event, and hooks cannot
  // live in a loop.
  const trips = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const snap = socialSnapshot();
    const rows: TripRow[] = [];
    for (const signal of interests) {
      const event = EVENT_INDEX.get(signal.eventId);
      if (!event || event.end < today) continue;
      rows.push({
        event,
        level: signal.level,
        group: groups.find(
          (g) => g.eventId === event.id && g.members.some((m) => m.memberId === me.id),
        ),
        peers: snap.peerCountFor(event.id),
        daysUntil: Math.round(
          (Date.parse(`${event.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
        ),
      });
    }
    rows.sort((a, b) => (a.event.start < b.event.start ? -1 : 1));
    return rows;
    // `drip` is in the dependency list because `peerCountFor` reads it off the
    // snapshot — the count has to move when the club does.
  }, [interests, groups, me.id, drip]);

  const grouped = useMemo(
    () => LEVEL_ORDER.map((level) => ({ level, rows: trips.filter((t) => t.level === level) })),
    [trips],
  );

  const gateway = gatewayFor(me.homeBase.homeJetPort);

  return (
    <ScrollArea className="h-full" contentClassName="flex flex-col gap-5 p-5 pb-8">
      {/* ── Who you are, in three lines ───────────────────────────────── */}
      <header className="flex items-center gap-3.5">
        <MemberPortrait
          seed={me.avatarSeed}
          name={me.name}
          size={56}
          accented
          {...(hydrated && me.photoUrl ? { photoUrl: me.photoUrl } : {})}
          decorative
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-display truncate text-[22px] leading-7 text-ink">
            {hydrated ? me.name : ' '}
          </h2>
          <div className="mt-2 flex items-center gap-2">
            <MemberTierMark tier={me.tier} />
            <span className="label-sm text-ink-muted">
              {MEMBER_TIER_LABEL[me.tier]} · {me.homeBase.city} · {me.homeBase.homeJetPort}
            </span>
          </div>
          {me.verifiedBy && (
            <p className="mt-2 text-[11px] leading-4 text-ink-faint">
              Vouched in by{' '}
              {voucher ? (
                <button
                  type="button"
                  onClick={() => openProfile(voucher.id)}
                  className="text-brass underline-offset-2 transition-colors hover:text-brass-bright hover:underline"
                >
                  {voucher.name}
                </button>
              ) : (
                <span className="text-ink-muted">{me.verifiedBy}</span>
              )}
            </p>
          )}
        </div>
      </header>

      <Rule variant="brass" />

      {/* ── What happened while you were away ─────────────────────────── */}
      <ActivitySection onOpenEvent={openEvent} onClose={onClose} />

      {/* ── The itinerary ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <p className="label text-ink-muted">My trips</p>
          <p className="tabular text-[11px] text-ink-faint">
            {hydrated ? `${trips.length} on the calendar` : ''}
          </p>
        </div>

        {!hydrated ? (
          <div className="h-24" aria-hidden />
        ) : trips.length === 0 ? (
          <EmptyState
            className="px-0"
            title="Nothing on your calendar yet"
            body="Signal on anything from the globe or the index — watching, interested, going — and it lands here with the cabins forming around it."
            action={
              <Button variant="ghost" size="sm" onClick={onClose}>
                Back to the globe
              </Button>
            }
          />
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {grouped.map(({ level, rows }) =>
              rows.length === 0 ? null : (
                <div key={level}>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'label',
                        level === 'committed' ? 'text-brass' : 'text-ink-faint',
                      )}
                    >
                      {LEVEL_HEADING[level]}
                    </span>
                    <span className="tabular text-[11px] text-ink-ghost">{rows.length}</span>
                  </div>
                  <ul className="mt-2 flex flex-col">
                    {rows.map((row, i) => (
                      <li key={row.event.id}>
                        {i > 0 && <Rule variant="ghost" />}
                        <TripRowButton row={row} onOpen={openEvent} />
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      <Rule />

      {/* ── Identity and settings, folded away ────────────────────────── */}
      <section>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          className="flex w-full items-baseline justify-between gap-4 text-left"
        >
          <span className="label text-ink-muted">Your record</span>
          <span className="label-sm text-ink-faint">{settingsOpen ? 'Hide' : 'Edit'}</span>
        </button>

        {!settingsOpen ? (
          <p className="mt-2.5 text-[11px] leading-4 text-ink-faint">
            {me.homeBase.city} · {me.homeBase.homeJetPort}
            {gateway ? ` · ${gateway.fboQuality} FBO` : ''} · {me.interests.length} interests ·{' '}
            {hydrated ? `${invitesRemaining} of ${INVITE_ALLOWANCE} invitations left` : ''}
          </p>
        ) : (
          <SelfSettings />
        )}
      </section>

      <div className="mt-auto flex justify-end pt-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </ScrollArea>
  );
}

function TripRowButton({ row, onOpen }: { row: TripRow; onOpen: (e: WorldEvent) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.event)}
      className="group flex w-full items-start justify-between gap-4 py-2.5 text-left"
    >
      <span className="min-w-0">
        <span className="font-display block truncate text-[15px] leading-5 text-ink-muted transition-colors group-hover:text-ink">
          {row.event.name}
        </span>
        <span className="label-sm mt-1.5 block truncate text-ink-ghost">
          {row.event.city} · {formatDateRange(row.event.start, row.event.end)}
          {row.group ? ` · ${row.group.name}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <span
          className={cn(
            'tabular text-[12px]',
            row.daysUntil <= 21 ? 'text-brass' : 'text-ink-muted',
          )}
        >
          {formatDaysUntil(row.daysUntil)}
        </span>
        <span className="label-sm text-ink-ghost">
          {row.peers} {row.peers === 1 ? 'member' : 'members'}
        </span>
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity
// ─────────────────────────────────────────────────────────────────────────────

function ActivitySection({
  onOpenEvent,
  onClose,
}: {
  onOpenEvent: (event: WorldEvent) => void;
  onClose: () => void;
}) {
  const hydrated = useSocialHydration();
  const feed = useActivityFeed();
  const markActivityRead = useSocialStore((s) => s.markActivityRead);
  const openProfile = useProfileUiStore((s) => s.openProfile);
  const unread = feed.filter((n) => !n.read).length;

  if (!hydrated || feed.length === 0) return null;

  const act = (n: ActivityNotification): void => {
    markActivityRead([n.id]);
    if (n.kind === 'peer-interest' && n.memberId) {
      openProfile(n.memberId);
      return;
    }
    const event = EVENT_INDEX.get(n.eventId);
    if (event) onOpenEvent(event);
    else onClose();
  };

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <p className="label text-ink-muted">
          Recent activity
          {unread > 0 && <span className="ml-2 text-brass">{unread} new</span>}
        </p>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => markActivityRead(feed.map((n) => n.id))}
            className="label-sm text-ink-faint transition-colors hover:text-ink"
          >
            Mark all read
          </button>
        )}
      </div>

      <ul className="mt-3 flex flex-col">
        {feed.slice(0, 8).map((n, i) => {
          const copy = describeNotification(n);
          const member = n.memberId ? MEMBER_INDEX.get(n.memberId) : undefined;
          return (
            <li key={n.id}>
              {i > 0 && <Rule variant="ghost" />}
              <button
                type="button"
                onClick={() => act(n)}
                className="group flex w-full items-center gap-3 py-2.5 text-left"
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    n.read ? 'bg-transparent' : 'bg-brass',
                  )}
                />
                {member ? (
                  <MemberPortrait
                    seed={member.avatarSeed}
                    name={member.name}
                    size={26}
                    {...(member.photoUrl ? { photoUrl: member.photoUrl } : {})}
                    decorative
                  />
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={cn(
                      'truncate text-[12px] leading-4',
                      n.read ? 'text-ink-muted' : 'text-ink',
                    )}
                  >
                    {copy.title}
                  </span>
                  <span className="label-sm truncate text-ink-ghost">{copy.detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

function SelfSettings() {
  const me = useSocialStore((s) => s.currentMember);
  const updateProfile = useSocialStore((s) => s.updateProfile);
  const setPhoto = useSocialStore((s) => s.setPhoto);
  const invitesRemaining = useSocialStore((s) => s.invitesRemaining);
  const reset = useSocialStore((s) => s.reset);

  const toggleCategory = (c: EventCategory): void => {
    const next = me.interests.includes(c)
      ? me.interests.filter((x) => x !== c)
      : [...me.interests, c];
    updateProfile({ interests: next });
  };

  return (
    <div className="mt-4 flex flex-col gap-5">
      <PortraitField
        seed={me.avatarSeed}
        name={me.name}
        {...(me.photoUrl ? { photoUrl: me.photoUrl } : {})}
        onChange={setPhoto}
      />

      <label className="flex flex-col gap-2">
        <span className="label text-ink-muted">Name</span>
        <input
          value={me.name}
          onChange={(e) => updateProfile({ name: e.target.value.slice(0, 48) })}
          className={cn(
            'font-display w-full rounded-[2px] border border-ink/10 bg-void/60 px-2.5 py-2',
            'text-[15px] text-ink focus:border-brass-deep focus:outline-none',
          )}
        />
      </label>

      <HomeBaseField
        homeBase={me.homeBase}
        onChange={(homeBase) => updateProfile({ homeBase })}
      />

      <section>
        <p className="label text-ink-muted">Interests</p>
        <p className="mt-2 text-[11px] leading-4 text-ink-faint">
          Ranks the calendar, and decides who shows up in your shared ground.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EVENT_CATEGORIES.map((c) => {
            const active = me.interests.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCategory(c)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-[2px] border px-2 transition-colors',
                  active
                    ? 'border-brass bg-brass-wash text-brass'
                    : 'border-ink/10 text-ink-faint hover:border-ink/25 hover:text-ink',
                )}
              >
                <CategoryGlyph category={c} size={12} />
                <span className="label-sm">{CATEGORY_LABEL[c]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <Toggle
        checked={me.openToJetShare}
        onCheckedChange={(v) =>
          useSocialStore.setState((s) => ({
            currentMember: { ...s.currentMember, openToJetShare: v },
          }))
        }
        label="Open to sharing a cabin"
        hint="Members you have not met can see your signals and ask you onto a manifest."
      />

      <section className="border border-brass-deep/60 bg-brass-wash p-3.5">
        <p className="label text-brass">Invitations</p>
        <p className="font-display mt-2 text-[22px] leading-7 text-ink">
          {invitesRemaining} of {INVITE_ALLOWANCE}
        </p>
        <p className="mt-2 text-[11px] leading-4 text-ink-muted">
          Left this year. You cannot join MERIDIAN — you are vouched in by a member, and each
          person you bring in spends one of these. Asking members already on the register costs
          nothing.
        </p>
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-ink-faint">
          Held on this device only. No account, no server copy.
        </p>
        <Button variant="quiet" size="sm" onClick={reset}>
          Erase local record
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Home base
// ─────────────────────────────────────────────────────────────────────────────

type GeoState = 'idle' | 'locating' | 'denied' | 'unavailable' | 'far';

/**
 * Where the aircraft lives, as a question rather than a list.
 *
 * He types a place — a city, a region, a field, an ICAO — and it resolves to
 * the gateway a private aircraft would actually use: "Miami" lands on
 * Opa-locka, "Côte d'Azur" on Nice, "KTEB" on Teterboro. The alternative, and
 * what this replaced, was a scrolling index of airports that ate the panel.
 *
 * Geolocation is offered but never taken: the browser prompt only ever fires
 * from a click, and refusing it costs nothing but a quiet line of text.
 */
function HomeBaseField({
  homeBase,
  onChange,
}: {
  homeBase: Member['homeBase'];
  onChange: (homeBase: Member['homeBase']) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [geo, setGeo] = useState<GeoState>('idle');
  const [detected, setDetected] = useState<{ gateway: Gateway; nm: number } | null>(null);

  const results = useMemo(() => (query.trim() ? searchGateways(query, 5) : []), [query]);
  const current = gatewayFor(homeBase.homeJetPort);

  const choose = (gateway: Gateway): void => {
    onChange(toHomeBase(gateway));
    setQuery('');
    setEditing(false);
    setGeo('idle');
    setDetected(null);
  };

  const locate = (): void => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo('unavailable');
      return;
    }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const gateway = nearestGateway({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
        const nm = distanceToGateway(
          { lat: pos.coords.latitude, lon: pos.coords.longitude },
          gateway,
        );
        setDetected({ gateway, nm });
        // A long way from anything on the register is a real answer, not an
        // error — offer it, say how far, and let him decide.
        setGeo(nm > 400 ? 'far' : 'idle');
      },
      (err) => setGeo(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <p className="label text-ink-muted">Home base</p>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="label-sm text-ink-faint transition-colors hover:text-ink"
        >
          {editing ? 'Cancel' : 'Change'}
        </button>
      </div>

      <p className="mt-2.5 text-[13px] leading-5 text-ink">
        {homeBase.city}
        <span className="tabular ml-2 text-ink-faint">{homeBase.homeJetPort}</span>
        {current && <span className="ml-2 text-[11px] text-ink-ghost">{current.name}</span>}
      </p>
      <p className="mt-1.5 text-[11px] leading-4 text-ink-faint">
        {current ? `${current.fboQuality} FBO · ` : ''}
        Every charter quote in the product is priced from here.
      </p>

      {editing && (
        <div className="mt-3">
          <div className="relative">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={(e) => {
                if (results.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight((h) => (h + 1) % results.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight((h) => (h - 1 + results.length) % results.length);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const hit = results[highlight];
                  if (hit) choose(hit.gateway);
                } else if (e.key === 'Escape') {
                  // The sheet also closes on Escape. Clearing the suggestions
                  // first is what the member means by it here.
                  e.stopPropagation();
                  setQuery('');
                }
              }}
              placeholder="City, region, airport or ICAO — “Miami”, “Côte d’Azur”, “KTEB”"
              aria-label="Search for your home gateway"
              aria-autocomplete="list"
              aria-expanded={results.length > 0}
              role="combobox"
              aria-controls="meridian-gateway-list"
              className={cn(
                'w-full rounded-[2px] border border-ink/10 bg-void/60 px-2.5 py-2',
                'text-[13px] text-ink placeholder:text-ink-ghost',
                'focus:border-brass-deep focus:outline-none',
              )}
            />
          </div>

          {results.length > 0 && (
            <ul
              id="meridian-gateway-list"
              role="listbox"
              className="mt-2 flex flex-col border border-ink/10 bg-obsidian/70"
            >
              {results.map((match, i) => (
                <li key={match.gateway.code} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(match.gateway)}
                    className={cn(
                      'flex w-full items-baseline justify-between gap-3 px-2.5 py-2 text-left',
                      i === highlight ? 'bg-brass-wash' : '',
                    )}
                  >
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block truncate text-[13px] leading-4',
                          i === highlight ? 'text-brass' : 'text-ink',
                        )}
                      >
                        {match.gateway.city}
                        <span className="ml-2 text-ink-faint">{match.gateway.country}</span>
                      </span>
                      <span className="label-sm mt-1.5 block truncate text-ink-ghost">
                        {match.gateway.name} · {match.gateway.fboQuality}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-[11px] text-ink-muted">
                      {match.gateway.code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={locate}
              disabled={geo === 'locating'}
              className="label-sm text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
            >
              {geo === 'locating' ? 'Locating' : 'Detect my location'}
            </button>
            {geo === 'denied' && (
              <span className="text-[11px] leading-4 text-ink-faint">
                Location is off for this site. Type a city instead.
              </span>
            )}
            {geo === 'unavailable' && (
              <span className="text-[11px] leading-4 text-ink-faint">
                Your browser would not give us a position.
              </span>
            )}
          </div>

          {detected && (
            <button
              type="button"
              onClick={() => choose(detected.gateway)}
              className="mt-2 flex w-full items-baseline justify-between gap-3 border border-brass-deep/60 bg-brass-wash px-2.5 py-2 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] leading-4 text-brass">
                  {detected.gateway.city} · {detected.gateway.name}
                </span>
                <span className="label-sm mt-1.5 block text-ink-ghost">
                  {detected.nm} nm from you{geo === 'far' ? ' — the nearest we cover' : ''}
                </span>
              </span>
              <span className="tabular shrink-0 text-[11px] text-brass">
                {detected.gateway.code}
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The host
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mounts the profile sheet and the deep-link reader once, near the root of the
 * social tree.
 *
 * `useOpenProfile()` has to work from a peer plate on the globe, a name in a
 * cabin roster, or a line in a chat thread — none of which share an ancestor
 * with the sheet. So the open state lives in `profileStore` and the sheet
 * itself is mounted here, exactly once, by `CurrentMemberChip`, which is in the
 * masthead on every screen.
 */
export function SocialRoot() {
  const memberId = useProfileUiStore((s) => s.profileMemberId);
  const closeProfile = useProfileUiStore((s) => s.closeProfile);

  return (
    <>
      <TripLinkReader />
      <MemberProfileSheet
        memberId={memberId ?? ''}
        open={memberId !== null}
        onClose={closeProfile}
      />
    </>
  );
}
