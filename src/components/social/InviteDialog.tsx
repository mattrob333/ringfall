'use client';

import { useMemo, useState } from 'react';

import {
  Button,
  cn,
  EmptyState,
  formatDateRange,
  Rule,
  ScrollArea,
  SearchField,
  Sheet,
} from '@/components/ui';
import { EVENT_INDEX } from '@/lib/data/events';
import { buildInviteEmail, isValidEmail, parseEmails } from '@/lib/social/invite';
import { MEMBERS, MEMBER_INDEX } from '@/lib/social/members';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import type { MemberDossier } from '@/lib/social/members';
import { Avatar } from './Avatar';
import { MemberTierMark } from './MemberTierMark';

export interface InviteDialogProps {
  eventId: string;
  /** The cabin being offered, if there is one. Changes the letter entirely. */
  groupId?: string;
  open: boolean;
  onClose: () => void;
  /** Members to arrive with already ticked — used from a member's profile. */
  preselectedMemberIds?: readonly string[];
}

/**
 * Ask people.
 *
 * Two distinct acts, deliberately not merged into one control:
 *
 *   • Bringing somebody in from OUTSIDE. That costs an invitation, of which a
 *     member has three a year, because the register is the product and a free
 *     invite button spends it. The letter is composed here and handed to their
 *     own mail client — nothing is sent by us and the UI says so plainly.
 *
 *   • Asking members already in the club onto a cabin. That is free, and it is
 *     recorded on this device, plus posted into the cabin's thread when there
 *     is one, because that is the only delivery mechanism that actually exists.
 */
export function InviteDialog({
  eventId,
  groupId,
  open,
  onClose,
  preselectedMemberIds,
}: InviteDialogProps) {
  const event = EVENT_INDEX.get(eventId);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={event ? `Invite to ${event.name}` : 'Invite'}
      width="min(30rem, 94vw)"
      scrim
    >
      {event ? (
        <InviteBody
          eventId={eventId}
          {...(groupId ? { groupId } : {})}
          {...(preselectedMemberIds ? { preselectedMemberIds } : {})}
          onClose={onClose}
        />
      ) : (
        <EmptyState
          title="No such event"
          body="That fixture is not on the calendar any more."
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

interface InviteBodyProps {
  eventId: string;
  groupId?: string;
  preselectedMemberIds?: readonly string[];
  onClose: () => void;
}

function InviteBody({ eventId, groupId, preselectedMemberIds, onClose }: InviteBodyProps) {
  const hydrated = useSocialHydration();
  const me = useSocialStore((s) => s.currentMember);
  const groups = useSocialStore((s) => s.groups);
  const contacts = useSocialStore((s) => s.contacts);
  const asks = useSocialStore((s) => s.asks);
  const invitesRemaining = useSocialStore((s) => s.invitesRemaining);
  const spendInvites = useSocialStore((s) => s.spendInvites);
  const rememberContacts = useSocialStore((s) => s.rememberContacts);
  const noteAsks = useSocialStore((s) => s.noteAsks);
  const sendMessage = useSocialStore((s) => s.sendMessage);

  const event = EVENT_INDEX.get(eventId)!;
  const group = groupId ? groups.find((g) => g.id === groupId) : undefined;

  const [draft, setDraft] = useState('');
  const [addresses, setAddresses] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(() => [...(preselectedMemberIds ?? [])]);
  const [asked, setAsked] = useState(false);

  const draftValid = draft.trim().length > 0 && isValidEmail(draft.trim());
  const pending = draftValid ? [...addresses, draft.trim()] : addresses;
  const overAllowance = pending.length > invitesRemaining;

  const commitDraft = (): void => {
    const { valid } = parseEmails(draft);
    if (valid.length === 0) return;
    setAddresses((prev) => [...new Set([...prev, ...valid])]);
    setDraft('');
  };

  const preview = useMemo(
    () => buildInviteEmail(event, group, me, { ...(note.trim() ? { note } : {}) }),
    [event, group, me, note],
  );

  const send = (): void => {
    const list = pending;
    if (list.length === 0 || list.length > invitesRemaining) return;
    const spent = spendInvites(list.length);
    if (spent < list.length) return;
    rememberContacts(list);
    const mail = buildInviteEmail(event, group, me, {
      to: list,
      ...(note.trim() ? { note } : {}),
    });
    // Hands off to their mail client. Nothing leaves this device by any other
    // route, which is exactly what the line under the button says.
    window.location.href = mail.mailto;
    onClose();
  };

  // ── Members ──────────────────────────────────────────────────────────────
  // Search is over name, city, country, home field and declared interests.
  // There is deliberately no way to browse the register by anything else: a
  // members' club is a room you walk into, not a catalogue you filter.
  const alreadyOn = useMemo(
    () => new Set(group?.members.map((m) => m.memberId) ?? []),
    [group],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = MEMBERS.filter((m) => !alreadyOn.has(m.id));
    if (!q) {
      // No query: the members most likely to say yes — open to sharing, and
      // already signalling on something in the same category.
      return pool
        .filter((m) => m.openToJetShare && m.interests.includes(event.category))
        .slice(0, 8);
    }
    return pool
      .filter((m) =>
        [m.name, m.homeBase.city, m.homeBase.country, m.homeBase.homeJetPort, ...m.interests]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 10);
  }, [query, alreadyOn, event.category]);

  const askMembers = (): void => {
    if (picked.length === 0) return;
    noteAsks(picked, eventId, groupId);
    if (groupId) {
      const names = picked
        .map((id) => MEMBER_INDEX.get(id)?.name)
        .filter((n): n is string => Boolean(n));
      if (names.length > 0) {
        try {
          sendMessage(groupId, `Asked ${joinNames(names)} to take a seat.`);
        } catch {
          // The thread is not essential to the record being kept.
        }
      }
    }
    setPicked([]);
    setAsked(true);
  };

  const askedIds = useMemo(
    () => new Set(asks.filter((a) => a.eventId === eventId).map((a) => a.memberId)),
    [asks, eventId],
  );

  return (
    <ScrollArea className="h-full" contentClassName="flex flex-col gap-5 p-5 pb-8">
      <header>
        <p className="label text-ink-muted">Invitation</p>
        <h2 className="font-display mt-2.5 text-[22px] leading-7 text-ink">{event.name}</h2>
        <p className="label-sm mt-2 text-ink-faint">
          {event.city} · {formatDateRange(event.start, event.end)}
          {group ? ` · ${group.name}` : ''}
        </p>
      </header>

      <Rule variant="brass" />

      {/* ── Outside the club ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <p className="label text-ink-muted">Bring someone in</p>
          {hydrated && (
            <p className="label-sm text-brass">
              {invitesRemaining} left this year
            </p>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-ink-faint">
          Membership is by referral. You have three invitations a year and this spends one for each
          address — they arrive as your guests, and that stays on your record.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {addresses.map((email) => (
            <span
              key={email}
              className="inline-flex h-6 items-center gap-1.5 rounded-[2px] border border-ink/12 px-2 text-[11px] text-ink-muted"
            >
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => setAddresses((prev) => prev.filter((e) => e !== email))}
                className="text-ink-faint transition-colors hover:text-ink"
              >
                <svg viewBox="0 0 16 16" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden>
                  <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
                </svg>
              </button>
            </span>
          ))}
        </div>

        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder="name@domain.com"
          aria-label="Email address"
          aria-invalid={draft.trim().length > 3 && !draftValid}
          className={cn(
            'mt-2.5 w-full rounded-[2px] border bg-void/60 px-2.5 py-2 text-[13px] text-ink',
            'placeholder:text-ink-ghost focus:outline-none',
            draft.trim().length > 3 && !draftValid
              ? 'border-alert/60 focus:border-alert'
              : 'border-ink/10 focus:border-brass-deep',
          )}
          list="meridian-known-contacts"
        />
        <datalist id="meridian-known-contacts">
          {contacts.map((c) => (
            <option key={c.email} value={c.email} />
          ))}
        </datalist>
        {draft.trim().length > 3 && !draftValid && (
          <p className="mt-1.5 text-[11px] leading-4 text-alert">
            That is not an address a mail client will accept.
          </p>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 240))}
          rows={3}
          placeholder="A line of your own. Optional, and it goes above your name."
          aria-label="Personal note"
          className={cn(
            'mt-2.5 w-full resize-none rounded-[2px] border border-ink/10 bg-void/60 p-2.5',
            'text-[12px] leading-[18px] text-ink placeholder:text-ink-ghost',
            'focus:border-brass-deep focus:outline-none',
          )}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-4 text-ink-faint">
            {overAllowance
              ? `That is ${pending.length} invitations and you have ${invitesRemaining}.`
              : 'Opens your mail client with the letter written. Nothing is sent from here.'}
          </p>
          <Button
            variant="brass"
            size="md"
            disabled={pending.length === 0 || overAllowance || invitesRemaining === 0}
            onClick={send}
          >
            {pending.length > 1 ? `Invite ${pending.length}` : 'Invite'}
          </Button>
        </div>

        <details className="mt-3 border-t border-ink/8 pt-3">
          <summary className="label cursor-pointer text-ink-faint transition-colors hover:text-ink">
            Read the letter first
          </summary>
          <p className="label-sm mt-3 text-ink-muted">Subject</p>
          <p className="mt-1.5 text-[12px] text-ink">{preview.subject}</p>
          <p className="label-sm mt-3 text-ink-muted">Body</p>
          <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[12px] leading-[18px] text-ink-muted">
            {preview.body}
          </pre>
        </details>
      </section>

      <Rule />

      {/* ── Inside the club ─────────────────────────────────────────────── */}
      <section>
        <p className="label text-ink-muted">Ask members</p>
        <p className="mt-2 text-[11px] leading-4 text-ink-faint">
          Free — they are already vouched for. Search by name, city or what they go for.
        </p>

        <SearchField
          value={query}
          onValueChange={setQuery}
          label="Search members"
          placeholder="Name, city, or an interest"
          className="mt-3"
        />

        <ul className="mt-3 flex flex-col">
          {matches.map((member, i) => (
            <li key={member.id}>
              {i > 0 && <Rule variant="ghost" />}
              <MemberRow
                member={member}
                picked={picked.includes(member.id)}
                alreadyAsked={askedIds.has(member.id)}
                onToggle={() =>
                  setPicked((prev) =>
                    prev.includes(member.id)
                      ? prev.filter((id) => id !== member.id)
                      : [...prev, member.id],
                  )
                }
              />
            </li>
          ))}
          {matches.length === 0 && (
            <li className="py-3 text-[11px] leading-4 text-ink-faint">
              Nobody in the register matches that.
            </li>
          )}
        </ul>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-4 text-ink-faint">
            {asked
              ? 'Noted on this device, and posted to the cabin thread if there is one. There is no server to deliver it for you.'
              : 'Kept as a note to yourself so you do not ask the same person twice.'}
          </p>
          <Button variant="ghost" size="sm" disabled={picked.length === 0} onClick={askMembers}>
            {picked.length > 0 ? `Ask ${picked.length}` : 'Ask'}
          </Button>
        </div>
      </section>

      <div className="mt-auto flex justify-end pt-2">
        <Button variant="quiet" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </ScrollArea>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  picked,
  alreadyAsked,
  onToggle,
}: {
  member: MemberDossier;
  picked: boolean;
  alreadyAsked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={picked}
      className="flex w-full items-center gap-3 py-2.5 text-left"
    >
      <Avatar
        seed={member.avatarSeed}
        size={28}
        name={member.name}
        {...(member.photoUrl ? { photoUrl: member.photoUrl } : {})}
        decorative
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'font-display truncate text-[13px] leading-4',
              picked ? 'text-brass' : 'text-ink',
            )}
          >
            {member.name}
          </span>
          <MemberTierMark tier={member.tier} />
        </span>
        <span className="label-sm truncate text-ink-faint">
          {member.homeBase.city}
          {member.aircraft ? ` · ${member.aircraft}` : ''}
          {alreadyAsked ? ' · already asked' : ''}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          'size-3.5 shrink-0 border',
          picked ? 'border-brass bg-brass-wash' : 'border-ink/20',
        )}
      />
    </button>
  );
}

function joinNames(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
