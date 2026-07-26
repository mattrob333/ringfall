'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';
import { withAppKeyGuard } from './keys';

export type ButtonVariant = 'brass' | 'ghost' | 'quiet';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading mark. Keep it to a 12–14px line glyph. */
  icon?: ReactNode;
  /** Renders the label in `.label` small caps. On by default — it is the house voice. */
  caps?: boolean;
  /** Persistent on-state, for buttons that are really toggles. */
  selected?: boolean;
}

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-[2px] ' +
  'whitespace-nowrap border transition-colors ' +
  'duration-[var(--duration-instant)] ease-[var(--ease-glide)] ' +
  'disabled:pointer-events-none disabled:opacity-35';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2.5',
  md: 'h-8 px-3.5',
};

/**
 * Brass is the only chrome colour in the product and this is the only place it
 * fills a surface — and then only as a 10% wash, never a solid. A solid brass
 * button would read as a call to action; nothing here is calling.
 */
const VARIANTS: Record<ButtonVariant, { off: string; on: string }> = {
  brass: {
    off: 'border-brass-deep/60 bg-brass-wash text-brass hover:border-brass hover:text-brass-bright',
    on: 'border-brass bg-brass-wash text-brass-bright',
  },
  ghost: {
    off: 'border-ink/10 bg-transparent text-ink-muted hover:border-ink/20 hover:text-ink',
    on: 'border-brass/70 bg-brass-wash text-brass',
  },
  quiet: {
    off: 'border-transparent bg-transparent text-ink-muted hover:text-ink',
    on: 'border-transparent bg-transparent text-brass',
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'ghost',
    size = 'sm',
    icon,
    caps = true,
    selected = false,
    className,
    children,
    type = 'button',
    onKeyDown,
    ...rest
  },
  ref,
) {
  const v = VARIANTS[variant];
  return (
    <button
      ref={ref}
      type={type}
      onKeyDown={withAppKeyGuard(onKeyDown)}
      data-selected={selected || undefined}
      className={cn(
        BASE,
        SIZES[size],
        selected ? v.on : v.off,
        caps ? 'label' : 'text-[12px] leading-none',
        className,
      )}
      {...rest}
    >
      {icon ? <span className="shrink-0 [&>svg]:block">{icon}</span> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'caps'> {
  /** Required — an icon-only control is invisible to assistive tech without it. */
  label: string;
  children: ReactNode;
}

/** Square variant of `Button`. The accessible name is mandatory. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      variant = 'quiet',
      size = 'sm',
      selected = false,
      className,
      children,
      type = 'button',
      onKeyDown,
      ...rest
    },
    ref,
  ) {
    const v = VARIANTS[variant];
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        onKeyDown={withAppKeyGuard(onKeyDown)}
        data-selected={selected || undefined}
        className={cn(
          BASE,
          size === 'sm' ? 'size-6' : 'size-8',
          'px-0',
          selected ? v.on : v.off,
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
