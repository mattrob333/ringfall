'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from './cn';

// ─────────────────────────────────────────────────────────────────────────────
// SearchField
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchFieldProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'onChange' | 'value' | 'type'> {
  value: string;
  onValueChange: (v: string) => void;
  label: string;
  /** Hide the visible label and rely on the accessible name only. */
  hideLabel?: boolean;
}

/**
 * A search field with no box around it. Underlined instead: a rule that turns
 * brass on focus. A bordered input would read as a form; this reads as a line
 * in a ledger.
 */
export function SearchField({
  value,
  onValueChange,
  label,
  hideLabel = true,
  className,
  placeholder = 'Search events, cities, tags',
  ...rest
}: SearchFieldProps) {
  const id = useId();
  return (
    <div className={cn('group relative flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cn('label-sm text-ink-muted', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <svg
          viewBox="0 0 16 16"
          width={12}
          height={12}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          aria-hidden
          className="pointer-events-none absolute left-0 text-ink-muted"
        >
          <circle cx="7" cy="7" r="4.6" />
          <path d="m10.4 10.4 3.2 3.2" strokeLinecap="round" />
        </svg>
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn(
            'h-7 w-full min-w-0 bg-transparent pl-5 pr-6 text-[12px] text-ink',
            'placeholder:text-ink-muted focus:outline-none',
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
          {...rest}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onValueChange('')}
            aria-label="Clear search"
            className="absolute right-0 text-ink-muted transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" aria-hidden>
              <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        ) : null}
      </div>
      <span
        aria-hidden
        className="h-px w-full bg-ink/12 transition-colors duration-[var(--duration-quick)] group-focus-within:bg-brass"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RangeField
// ─────────────────────────────────────────────────────────────────────────────

export interface RangeFieldProps {
  label: ReactNode;
  /** Rendered at the right of the label row, usually the current value. */
  readout?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (v: number) => void;
  className?: string;
  /** Extra text appended to the accessible value. */
  valueText?: string;
}

/**
 * A single-thumb range on a hairline track, with a brass thumb. Native
 * `input[type=range]` so keyboard and touch semantics come for free.
 */
export function RangeField({
  label,
  readout,
  value,
  min,
  max,
  step = 1,
  onValueChange,
  className,
  valueText,
}: RangeFieldProps) {
  const id = useId();
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label-sm text-ink-muted">
          {label}
        </label>
        {readout ? (
          <span className="tabular text-[11px] leading-none text-ink">{readout}</span>
        ) : null}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onValueChange(Number(e.target.value))}
        className={cn(
          'h-4 w-full cursor-pointer appearance-none bg-transparent',
          // Track
          '[&::-webkit-slider-runnable-track]:h-px [&::-webkit-slider-runnable-track]:rounded-none',
          '[&::-moz-range-track]:h-px',
          // Thumb — a 2px brass bar, not a knob.
          '[&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-[11px]',
          '[&::-webkit-slider-thumb]:w-[3px] [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-[1px] [&::-webkit-slider-thumb]:bg-brass',
          '[&::-moz-range-thumb]:h-[11px] [&::-moz-range-thumb]:w-[3px]',
          '[&::-moz-range-thumb]:rounded-[1px] [&::-moz-range-thumb]:border-0',
          '[&::-moz-range-thumb]:bg-brass',
        )}
        style={
          {
            // Filled portion in brass, remainder as a hairline.
            '--fill': `${pct}%`,
            backgroundImage: `linear-gradient(to right, var(--color-brass) 0 ${pct}%, color-mix(in oklab, var(--color-ink) 12%, transparent) ${pct}% 100%)`,
            backgroundSize: '100% 1px',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          } as React.CSSProperties
        }
      />
    </div>
  );
}
