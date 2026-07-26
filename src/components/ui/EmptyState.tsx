import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: string;
  /** Say what is actually true, and what would change it. Never apologise. */
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * The honest nothing. No illustration, no shrug — a rule, a line of type, and
 * the one action that would fix it.
 */
export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 px-4 py-8 text-left',
        className,
      )}
    >
      <span aria-hidden className="h-px w-8 bg-brass-deep" />
      <p className="font-display text-[15px] leading-5 text-ink">{title}</p>
      {body ? (
        <p className="max-w-64 text-[11px] leading-4 text-ink-muted">{body}</p>
      ) : null}
      {action}
    </div>
  );
}
