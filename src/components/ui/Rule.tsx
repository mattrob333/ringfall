import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export interface RuleProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /**
   * `hairline` — the default structural divider, 8% ink.
   * `brass`    — the house rule. Used once or twice per surface, never more.
   * `ghost`    — barely there; for dividing items inside an already-ruled block.
   */
  variant?: 'hairline' | 'brass' | 'ghost';
  orientation?: 'horizontal' | 'vertical';
  /** Inset from both ends, in px. Gives rules room to breathe. */
  inset?: number;
}

/**
 * A single hairline. Rules are how MERIDIAN separates things — not borders on
 * boxes, not shadows. The brass variant is a deliberate, rationed accent.
 */
export function Rule({
  variant = 'hairline',
  orientation = 'horizontal',
  inset = 0,
  className,
  style,
  ...rest
}: RuleProps) {
  const horizontal = orientation === 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 pointer-events-none',
        // Vertical rules take their height from the flex line unless the
        // caller sets one explicitly — no `h-full` to collide with an `h-4`.
        horizontal ? 'h-px w-full' : 'w-px self-stretch',
        variant === 'brass' && horizontal && 'brass-rule',
        variant === 'brass' && !horizontal && 'bg-brass-deep',
        variant === 'hairline' && 'bg-ink/8',
        variant === 'ghost' && 'bg-ink/5',
        className,
      )}
      style={{
        ...(horizontal
          ? { marginLeft: inset, marginRight: inset }
          : { marginTop: inset, marginBottom: inset }),
        ...style,
      }}
      {...rest}
    />
  );
}
