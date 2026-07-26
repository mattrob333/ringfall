'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DURATION, EASE_SETTLE } from './tokens';
import { cn } from './cn';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Which edge it slides from. The globe stays visible on the other side. */
  side?: 'right' | 'left';
  /** Any CSS width. Kept off `100vw` on purpose — never cover the globe. */
  width?: string;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
  className?: string;
  /**
   * Dim the rest of the screen. Off by default: MERIDIAN's surfaces float over
   * a live globe and a scrim would put the light out.
   */
  scrim?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Slide-over container. Escape closes, focus moves in on open and returns to
 * whatever had it on close, and Tab is contained while it is up.
 */
export function Sheet({
  open,
  onClose,
  side = 'right',
  width = 'min(30rem, 42vw)',
  label,
  children,
  className,
  scrim = false,
}: SheetProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });
    return () => {
      restoreTo.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = ref.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const offset = side === 'right' ? 28 : -28;

  return (
    <AnimatePresence>
      {open && (
        <>
          {scrim && (
            <motion.div
              className="fixed inset-0 z-[60] bg-void/45"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : DURATION.quick }}
              onClick={onClose}
              aria-hidden
            />
          )}
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal={scrim ? true : undefined}
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className={cn(
              'glass-deep fixed top-0 z-[65] flex h-dvh flex-col outline-none',
              side === 'right' ? 'right-0' : 'left-0',
              className,
            )}
            style={{ width }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: offset }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: offset }}
            transition={{
              duration: reduced ? 0 : DURATION.considered,
              ease: EASE_SETTLE,
            }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
