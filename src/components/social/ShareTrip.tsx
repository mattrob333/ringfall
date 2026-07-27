'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { Button, cn, formatDateRange, Rule } from '@/components/ui';
import { EVENT_INDEX } from '@/lib/data/events';
import { buildSharePayload, buildTripLink, readTripLink } from '@/lib/social/invite';
import { MEMBER_INDEX } from '@/lib/social/members';
import { useProfileUiStore } from '@/lib/social/profileStore';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { InviteDialog } from './InviteDialog';

export interface ShareTripProps {
  eventId: string;
  /** Share the cabin as well as the event. */
  groupId?: string;
  className?: string;
  /** Drop to a single row of quiet controls. */
  compact?: boolean;
}

/**
 * Send the trip to somebody.
 *
 * Three routes out, in the order people actually use them: the link, the
 * system share sheet where the platform has one, and a written invitation.
 * Every one of them produces a real deep link — `?event=…&group=…` — which
 * `<TripLinkReader />` below opens on arrival. A share control that produces a
 * link to the home screen is worse than no share control.
 */
export function ShareTrip({ eventId, groupId, className, compact = false }: ShareTripProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState('');

  // Both of these read browser APIs, so they resolve after mount rather than
  // during render — the server has no `navigator` and no origin to build a
  // link from, and a mismatch here would throw away the panel it sits in.
  useEffect(() => {
    setLink(buildTripLink(eventId, groupId));
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, [eventId, groupId]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = useCallback(async () => {
    const url = link || buildTripLink(eventId, groupId);
    setFailed(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        return;
      }
      throw new Error('no clipboard');
    } catch {
      // Permissions policy, an insecure origin, or an older engine. Rather than
      // claim a copy that did not happen, show the link and let them take it.
      setFailed(true);
    }
  }, [link, eventId, groupId]);

  const share = useCallback(async () => {
    const event = EVENT_INDEX.get(eventId);
    if (!event) return;
    const group = groupId
      ? useSocialStore.getState().groups.find((g) => g.id === groupId)
      : undefined;
    try {
      await navigator.share(buildSharePayload(event, group));
    } catch {
      // Cancelling the sheet rejects. That is not an error worth reporting.
    }
  }, [eventId, groupId]);

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={copied ? 'brass' : 'ghost'} size="sm" onClick={() => void copy()}>
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setInviting(true)}>
          Invite by email
        </Button>
        {canShare && (
          <Button variant="quiet" size="sm" onClick={() => void share()}>
            Share
          </Button>
        )}
      </div>

      {failed && (
        <label className="flex flex-col gap-1.5">
          <span className="label-sm text-ink-faint">
            Your browser would not let us reach the clipboard. Take it from here:
          </span>
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              'tabular w-full rounded-[2px] border border-ink/10 bg-void/60 px-2 py-1.5',
              'text-[11px] text-ink-muted focus:border-brass-deep focus:outline-none',
            )}
          />
        </label>
      )}

      {!compact && !failed && (
        <p className="text-[11px] leading-4 text-ink-faint">
          The link opens this {groupId ? 'cabin' : 'event'} directly. Email opens your own mail
          client — MERIDIAN sends nothing on your behalf.
        </p>
      )}

      {inviting && (
        <InviteDialog
          open
          eventId={eventId}
          {...(groupId ? { groupId } : {})}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrival
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads `?event=…&group=…` on load and opens what the link promised.
 *
 * Mounted once, by `SocialRoot`. It selects the event, flies the globe to it,
 * and — when the link named a cabin — raises the invitation strip below, which
 * is the only surface in the product that appears because somebody else asked
 * you to be somewhere.
 *
 * The parameters are stripped from the address bar afterwards so a refresh does
 * not re-open the dossier over whatever the member has moved on to, and so the
 * link they see is not one they might re-share with a stale group id.
 */
export function TripLinkReader() {
  const setInvitation = useProfileUiStore((s) => s.setInvitation);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = readTripLink(window.location.search);
    if (!target.eventId) return;

    const event = EVENT_INDEX.get(target.eventId);
    if (event) {
      useGlobeStore.getState().select(event.id);
      useGlobeStore.getState().flyTo(event.coords);
      setInvitation({
        eventId: event.id,
        ...(target.groupId ? { groupId: target.groupId } : {}),
      });
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('event');
    url.searchParams.delete('group');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [setInvitation]);

  return <InvitationStrip />;
}

/**
 * "You have been asked onto this." Appears only when a group link was followed,
 * sits low and centred so it never covers the dossier or the rail, and takes
 * one of two actions: get on the aircraft, or dismiss.
 */
function InvitationStrip() {
  const hydrated = useSocialHydration();
  const invitation = useProfileUiStore((s) => s.invitation);
  const dismissed = useProfileUiStore((s) => s.invitationDismissed);
  const dismiss = useProfileUiStore((s) => s.dismissInvitation);
  const groups = useSocialStore((s) => s.groups);
  const meId = useSocialStore((s) => s.currentMember.id);
  const joinGroup = useSocialStore((s) => s.joinGroup);

  const group = invitation?.groupId ? groups.find((g) => g.id === invitation.groupId) : undefined;
  const event = invitation ? EVENT_INDEX.get(invitation.eventId) : undefined;
  const show = hydrated && Boolean(invitation?.groupId) && !dismissed && Boolean(group && event);

  const host = group?.members.find((m) => m.role === 'host');
  const hostMember = host ? MEMBER_INDEX.get(host.memberId) : undefined;
  const aboard = Boolean(group?.members.some((m) => m.memberId === meId));
  const seatsLeft = group ? Math.max(0, group.capacity - group.members.length) : 0;

  return (
    <AnimatePresence>
      {show && group && event && (
        <motion.aside
          className={cn(
            'glass-deep fixed bottom-6 left-1/2 z-[55] w-[min(30rem,92vw)] -translate-x-1/2 p-4',
          )}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Trip invitation"
        >
          <p className="label text-brass">You were sent this</p>
          <h2 className="font-display mt-2.5 text-[19px] leading-6 text-ink">{group.name}</h2>
          <p className="label-sm mt-2 text-ink-faint">
            {event.name} · {event.city} · {formatDateRange(event.start, event.end)}
          </p>

          <Rule variant="ghost" className="my-3" />

          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[12px] leading-[18px] text-ink-muted">
                {hostMember ? `${hostMember.name} is hosting.` : 'Hosted cabin.'}{' '}
                {group.members.length}/{group.capacity} aboard
                {group.jet ? ` · ${group.jet.aircraft}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="quiet" size="sm" onClick={dismiss}>
                Not this time
              </Button>
              {aboard ? (
                <span className="label text-brass">You are on it</span>
              ) : (
                <Button
                  variant="brass"
                  size="md"
                  disabled={seatsLeft === 0}
                  onClick={() => {
                    joinGroup(group.id);
                    dismiss();
                  }}
                >
                  {seatsLeft === 0 ? 'Manifest closed' : `Take a seat — ${seatsLeft} left`}
                </Button>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
