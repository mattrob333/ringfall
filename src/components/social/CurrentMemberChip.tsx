'use client';

import { useState } from 'react';

import { Button, cn, Rule, ScrollArea, Sheet, Toggle } from '@/components/ui';
import { HOME_BASE_OPTIONS } from '@/lib/social/members';
import { useSocialHydration, useSocialStore } from '@/lib/social/useSocialStore';
import { EVENT_CATEGORIES, type EventCategory } from '@/lib/types';
import { Avatar } from './Avatar';
import { MEMBER_TIER_LABEL, MemberTierMark } from './MemberTierMark';

export interface CurrentMemberChipProps {
  className?: string;
}

/**
 * The signed-in member, and the door to their record.
 *
 * Reads as a name plate rather than an account button — no chevron, no
 * gravatar, no "signed in as". The plate, the name, the rank mark.
 */
export function CurrentMemberChip({ className }: CurrentMemberChipProps) {
  const hydrated = useSocialHydration();
  const me = useSocialStore((s) => s.currentMember);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Your member record"
        className={cn(
          'group flex items-center gap-2.5 rounded-[2px] border border-transparent px-1.5 py-1',
          'transition-colors duration-[var(--duration-instant)]',
          'hover:border-ink/10 hover:bg-obsidian/60',
          className,
        )}
      >
        <Avatar seed={me.avatarSeed} size={24} name={me.name} accented decorative />
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="font-display truncate text-[13px] leading-4 text-ink">
            {hydrated ? me.name : ' '}
          </span>
          <span className="flex items-center gap-1.5">
            <MemberTierMark tier={me.tier} />
            <span className="label-sm text-ink-faint">{me.homeBase.homeJetPort}</span>
          </span>
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} label="Your member record" width="min(26rem, 92vw)">
        <ProfileSheet onClose={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ProfileSheet({ onClose }: { onClose: () => void }) {
  const me = useSocialStore((s) => s.currentMember);
  const updateProfile = useSocialStore((s) => s.updateProfile);
  const itinerary = useSocialStore((s) => s.interests);

  const toggleCategory = (c: EventCategory): void => {
    const next = me.interests.includes(c)
      ? me.interests.filter((x) => x !== c)
      : [...me.interests, c];
    updateProfile({ interests: next });
  };

  return (
    <ScrollArea className="h-full" contentClassName="flex flex-col gap-5 p-5">
      <header className="flex items-center gap-3.5">
        <Avatar seed={me.avatarSeed} size={48} name={me.name} accented decorative />
        <div className="min-w-0">
          <input
            value={me.name}
            onChange={(e) => updateProfile({ name: e.target.value.slice(0, 48) })}
            aria-label="Your name"
            className={cn(
              'font-display w-full border-b border-transparent bg-transparent text-[20px] leading-6 text-ink',
              'focus:border-brass-deep focus:outline-none',
            )}
          />
          <p className="label-sm mt-2 text-ink-faint">
            {MEMBER_TIER_LABEL[me.tier]} · since {me.memberSince.slice(0, 4)}
          </p>
        </div>
      </header>

      <Rule variant="brass" />

      {/* Home base — this is the number that changes every charter quote in the
          product, so it sits first. */}
      <section>
        <p className="label text-ink-muted">Home base</p>
        <p className="mt-2 text-[11px] leading-4 text-ink-faint">
          Every charter quote is priced from here. Changing it re-prices the entire calendar.
        </p>
        <div className="mt-3 flex flex-col">
          {HOME_BASE_OPTIONS.map((hb, i) => {
            const active = hb.homeJetPort === me.homeBase.homeJetPort;
            return (
              <div key={hb.homeJetPort}>
                {i > 0 && <Rule variant="ghost" />}
                <button
                  type="button"
                  onClick={() => updateProfile({ homeBase: hb })}
                  aria-pressed={active}
                  className="flex w-full items-baseline justify-between gap-4 py-2 text-left"
                >
                  <span
                    className={cn(
                      'text-[13px] leading-4',
                      active ? 'text-brass' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {hb.city}
                    <span className="ml-2 text-ink-ghost">{hb.country}</span>
                  </span>
                  <span
                    className={cn(
                      'tabular text-[11px]',
                      active ? 'text-brass' : 'text-ink-ghost',
                    )}
                  >
                    {hb.homeJetPort}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <Rule />

      <section>
        <p className="label text-ink-muted">Interests</p>
        <p className="mt-2 text-[11px] leading-4 text-ink-faint">
          Used to rank the calendar. Not shown to other members.
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
                  'label rounded-[2px] border px-2 py-1.5 transition-colors',
                  active
                    ? 'border-brass bg-brass-wash text-brass'
                    : 'border-ink/10 text-ink-faint hover:border-ink/20 hover:text-ink',
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
      </section>

      <Rule />

      <section>
        <p className="label text-ink-muted">Sharing</p>
        <div className="mt-3">
          <Toggle
            checked={me.openToJetShare}
            onCheckedChange={(v) =>
              useSocialStore.setState((s) => ({
                currentMember: { ...s.currentMember, openToJetShare: v },
              }))
            }
            label="Open to sharing a cabin"
            hint="Members you have not met can see your signals and invite you onto a manifest."
          />
        </div>
      </section>

      <Rule />

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <p className="label text-ink-muted">Your record</p>
          <p className="tabular text-[11px] text-ink-faint">
            {itinerary.length} signal{itinerary.length === 1 ? '' : 's'}
          </p>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-ink-faint">
          Held on this device only. MERIDIAN keeps no account and no server copy.
        </p>
      </section>

      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            useSocialStore.getState().reset();
            onClose();
          }}
        >
          Erase local record
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </ScrollArea>
  );
}
