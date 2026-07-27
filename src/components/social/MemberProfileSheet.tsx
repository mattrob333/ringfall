'use client';

import { useMemo, useState } from 'react';

import {
  Button,
  CategoryGlyph,
  CATEGORY_LABEL,
  cn,
  EmptyState,
  formatDateRange,
  Rule,
  ScrollArea,
  Sheet,
} from '@/components/ui';
import { EVENT_INDEX } from '@/lib/data/events';
import { MEMBER_INDEX, resolveVoucher, type MemberDossier } from '@/lib/social/members';
import { useProfileUiStore } from '@/lib/social/profileStore';
import { getSimulation } from '@/lib/social/simulation';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import type { EventCategory, InterestLevel, TravelGroup, WorldEvent } from '@/lib/types';
import { InviteDialog } from './InviteDialog';
import { MemberPortrait } from './MemberPortrait';
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
  const member = MEMBER_INDEX.get(memberId);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={member ? `${member.name} — member record` : 'Member record'}
      width="min(30rem, 94vw)"
      scrim
    >
      {member ? (
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
          {(member.age || member.pronouns) && (
            <Fact
              label="Age"
              value={
                <>
                  {member.age ?? '—'}
                  {member.pronouns && <span className="ml-2 text-ink-faint">{member.pronouns}</span>}
                </>
              }
            />
          )}
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
