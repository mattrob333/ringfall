'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface TooltipProps {
  /** The text. Keep it to a phrase — a tooltip is a footnote, not a paragraph. */
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  /** Delay before showing, ms. Nothing in this product appears instantly. */
  delay?: number;
  className?: string;
  /** Applied to the inline wrapper around `children`. */
  triggerClassName?: string;
  disabled?: boolean;
}

interface Pos {
  x: number;
  y: number;
  side: 'top' | 'bottom';
}

/**
 * Hover/focus tooltip, portalled to `document.body` and positioned with fixed
 * coordinates so it is never clipped by a panel's overflow. Opens on focus as
 * well as hover, and closes on Escape — a tooltip that only responds to a mouse
 * is decoration, not information.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 220,
  className,
  triggerClassName,
  disabled = false,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip below when there is no room above.
    const resolved: 'top' | 'bottom' = side === 'top' && r.top > 56 ? 'top' : 'bottom';
    setPos({
      x: Math.round(r.left + r.width / 2),
      y: Math.round(resolved === 'top' ? r.top - 8 : r.bottom + 8),
      side: resolved,
    });
  }, [side]);

  const open = useCallback(() => {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(place, delay);
  }, [delay, disabled, place]);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  }, []);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos, close]);

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('inline-flex', triggerClassName)}
        onPointerEnter={open}
        onPointerLeave={close}
        onFocusCapture={() => {
          if (!disabled) place();
        }}
        onBlurCapture={close}
        aria-describedby={pos ? id : undefined}
      >
        {children}
      </span>
      {mounted && pos
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className={cn(
                'pointer-events-none fixed z-[80] max-w-56 -translate-x-1/2 rounded-[2px]',
                'glass-deep px-2.5 py-1.5 text-[11px] leading-4 text-ink',
                pos.side === 'top' ? '-translate-y-full' : '',
                className,
              )}
              style={{ left: pos.x, top: pos.y }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
