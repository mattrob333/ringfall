'use client';

import { motion, useReducedMotion } from 'motion/react';

import { cn } from '@/components/ui';

export interface TypingDotsProps {
  /** Rendered as the accessible text. Keep it to a name and a verb. */
  label?: string;
  className?: string;
}

const DOTS = [0, 1, 2];

/**
 * Somebody is composing.
 *
 * Three brass marks, not a speech bubble. The animation is a slow lift rather
 * than a bounce — nothing in this product bounces — and under
 * `prefers-reduced-motion` it holds still at three different opacities, which
 * still reads as an indicator without moving a pixel.
 */
export function TypingDots({ label, className }: TypingDotsProps) {
  const reduced = useReducedMotion();

  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)}>
      <span className="sr-only">{label ?? 'Someone is typing'}</span>
      {DOTS.map((i) => {
        const rest = 0.28 + i * 0.16;
        return reduced ? (
          <span
            key={i}
            aria-hidden
            className="block size-[3px] rounded-full bg-brass"
            style={{ opacity: rest }}
          />
        ) : (
          <motion.span
            key={i}
            aria-hidden
            className="block size-[3px] rounded-full bg-brass"
            initial={{ opacity: 0.22, y: 0 }}
            animate={{ opacity: [0.22, 0.9, 0.22], y: [0, -2, 0] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: [0.22, 1, 0.36, 1],
              delay: i * 0.18,
            }}
          />
        );
      })}
    </span>
  );
}
