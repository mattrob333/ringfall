'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';
import { withAppKeyGuard } from './keys';

export interface ChipProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'onChange' | 'children'> {
  children: ReactNode;
  /** Toggle state. Renders `aria-pressed`, so screen readers get the toggle. */
  active?: boolean;
  /** Leading mark — normally a `CategoryGlyph`. */
  icon?: ReactNode;
  /** Trailing figure, e.g. a count. Rendered in tabular figures. */
  count?: number;
  size?: 'sm' | 'md';
  /** Non-interactive: renders as a `<span>`-like read-only tag. */
  readOnly?: boolean;
}

/**
 * The filter atom. Off-state is a hairline outline with muted ink; on-state
 * lights the brass and nothing else — no fills, no colour, no scale change.
 * The whole filter bar should read as a set of engraved words that either
 * catch the light or don't.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    children,
    active = false,
    icon,
    count,
    size = 'sm',
    readOnly = false,
    className,
    type = 'button',
    onKeyDown,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      onKeyDown={withAppKeyGuard(onKeyDown)}
      aria-pressed={readOnly ? undefined : active}
      disabled={readOnly ? true : rest.disabled}
      className={cn(
        'group inline-flex select-none items-center gap-1.5 rounded-[2px] border',
        'transition-colors duration-[var(--duration-instant)] ease-[var(--ease-glide)]',
        size === 'sm' ? 'h-6 px-2' : 'h-7 px-2.5',
        active
          ? 'border-brass/70 bg-brass-wash text-brass'
          : 'border-ink/10 bg-transparent text-ink-muted',
        !readOnly && !active && 'hover:border-ink/25 hover:text-ink',
        !readOnly && active && 'hover:border-brass',
        readOnly && 'cursor-default disabled:opacity-100',
        'disabled:pointer-events-none',
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span
          className={cn(
            'shrink-0 transition-opacity duration-[var(--duration-instant)]',
            active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="label-sm">{children}</span>
      {count !== undefined ? (
        <span className={cn('tabular text-[10px]', active ? 'text-brass' : 'text-ink-muted')}>
          {count}
        </span>
      ) : null}
    </button>
  );
});
