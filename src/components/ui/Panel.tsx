import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './cn';
import { Rule } from './Rule';

export interface PanelProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** Rendered as a small-caps label, not a heading shout. */
  title?: ReactNode;
  /** Sits opposite the title on the header row — counts, toggles, actions. */
  actions?: ReactNode;
  /** A line under the title, before the rule. Optional and usually unused. */
  subtitle?: ReactNode;
  /**
   * `glass` — the standard floating surface.
   * `deep`  — for text-heavy reading surfaces (dossier, rail): more opaque so
   *           long-form copy never has to fight the globe behind it.
   * `bare`  — no surface at all; for nesting inside another panel.
   */
  surface?: 'glass' | 'deep' | 'bare';
  /** Draw the brass rule under the header instead of a hairline. */
  accent?: boolean;
  /** Removes the default padding — for panels that own their own scroll area. */
  flush?: boolean;
  children?: ReactNode;
}

/**
 * The house surface. Black glass, one-pixel edge, tight corners.
 *
 * Panels are always translucent: the globe is the light in this room and must
 * read through every surface sitting on it.
 */
export function Panel({
  title,
  actions,
  subtitle,
  surface = 'glass',
  accent = false,
  flush = false,
  className,
  children,
  ...rest
}: PanelProps) {
  const hasHeader = Boolean(title || actions || subtitle);
  return (
    <section
      className={cn(
        'relative flex min-h-0 flex-col rounded-[3px]',
        surface === 'glass' && 'glass',
        surface === 'deep' && 'glass-deep',
        className,
      )}
      {...rest}
    >
      {hasHeader && (
        <header className="shrink-0 px-4 pt-3.5">
          <div className="flex min-h-4 items-baseline justify-between gap-4">
            {title ? (
              <h2 className="label text-ink-muted truncate">{title}</h2>
            ) : (
              <span />
            )}
            {actions ? (
              <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-1.5 text-[11px] leading-4 text-ink-muted">{subtitle}</p>
          ) : null}
          <Rule variant={accent ? 'brass' : 'hairline'} className="mt-3" />
        </header>
      )}
      <div className={cn('flex min-h-0 flex-1 flex-col', !flush && 'p-4')}>
        {children}
      </div>
    </section>
  );
}
