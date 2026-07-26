'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';
import { guardAppKeys } from './keys';

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: ReactNode;
  /** A quiet second line explaining what turning it on actually does. */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * A switch drawn as a 22×10 slot with a brass slug. No colour fill, no
 * animation beyond the slug sliding — it is a mechanical detent, not a toy.
 */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled = false,
  className,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      onKeyDown={guardAppKeys}
      className={cn(
        'group flex w-full items-start justify-between gap-4 text-left',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className={cn(
            'label-sm transition-colors duration-[var(--duration-instant)]',
            checked ? 'text-brass' : 'text-ink-muted group-hover:text-ink',
          )}
        >
          {label}
        </span>
        {hint ? (
          <span className="text-[11px] leading-4 text-ink-muted">{hint}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          'relative mt-px h-[10px] w-[22px] shrink-0 rounded-[1px] border',
          'transition-colors duration-[var(--duration-quick)] ease-[var(--ease-glide)]',
          checked ? 'border-brass/70 bg-brass-wash' : 'border-ink/15',
        )}
      >
        <span
          className={cn(
            'absolute top-[1px] h-[6px] w-[6px] rounded-[1px]',
            'transition-[left,background-color] duration-[var(--duration-quick)] ease-[var(--ease-glide)]',
            checked ? 'left-[13px] bg-brass' : 'left-[1px] bg-ink-faint',
          )}
        />
      </span>
    </button>
  );
}
