'use client';

import type { ReactNode, UIEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './cn';

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  /** Inner padding classes, applied to the content wrapper. */
  contentClassName?: string;
  /** Size of the edge fade, px. */
  fade?: number;
  /**
   * Make the scroller itself keyboard-focusable. Off by default: rails and
   * lists in this product contain focusable rows, so arrow-key scrolling
   * already follows focus and an extra tab stop is just noise. Turn it on for
   * regions of static prose that overflow.
   */
  focusable?: boolean;
  'aria-label'?: string;
}

/**
 * Overflow with a soft edge. The fade is a *mask*, not a gradient overlay —
 * an overlay would need an opaque colour and every surface here is glass.
 * Edges are only masked when there is actually something in that direction.
 */
export function ScrollArea({
  children,
  className,
  contentClassName,
  fade = 20,
  focusable = false,
  'aria-label': ariaLabel,
}: ScrollAreaProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<{ top: boolean; bottom: boolean }>({
    top: false,
    bottom: false,
  });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setEdges((p) => (p.top === top && p.bottom === bottom ? p : { top, bottom }));
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  const onScroll = useCallback(
    (_e: UIEvent<HTMLDivElement>) => measure(),
    [measure],
  );

  const maskStops = [
    edges.top ? `transparent 0, #000 ${fade}px` : '#000 0',
    edges.bottom ? `#000 calc(100% - ${fade}px), transparent 100%` : '#000 100%',
  ].join(', ');

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      tabIndex={focusable ? 0 : undefined}
      role={focusable ? 'group' : undefined}
      aria-label={ariaLabel}
      className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', className)}
      style={{
        maskImage: `linear-gradient(to bottom, ${maskStops})`,
        WebkitMaskImage: `linear-gradient(to bottom, ${maskStops})`,
      }}
    >
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
