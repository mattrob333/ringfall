import type { SVGProps } from 'react';
import type { EventCategory } from '@/lib/types';
import { CATEGORY_LABEL } from './tokens';
import { cn } from './cn';

/**
 * Seventeen line marks, one per `EventCategory`.
 *
 * Drawn on a 16×16 grid at a constant 1px stroke so they sit on the same
 * optical weight as the hairlines and the small-caps labels around them. They
 * are engraved marks, not icons: no fills, no rounded "app" shapes, and
 * absolutely no emoji. Every one uses `currentColor`, so a glyph inherits
 * whatever the surrounding text is doing — including the brass of an active
 * filter chip.
 */

const P: Record<EventCategory, React.ReactNode> = {
  // A canvas on its stretcher, seen slightly from the side.
  art: (
    <>
      <rect x="2.5" y="2.5" width="11" height="9" />
      <path d="M2.5 9.2 6 6.4l2.4 2 2.6-2.6 2.5 2.2" />
      <path d="M8 11.5v2M5.6 13.5h4.8" />
    </>
  ),
  // A quaver: head, stem, flag.
  music: (
    <>
      <ellipse cx="5.4" cy="11.4" rx="2.6" ry="2" transform="rotate(-18 5.4 11.4)" />
      <path d="M7.9 10.6V3.1l5.6 1.9" />
      <path d="M13.5 5v3.1" />
    </>
  ),
  // The racing line through a corner — entry, apex, exit.
  motorsport: (
    <>
      <path d="M1.5 12.2c3.6 0 5.4-1.4 6.6-4C9.4 5.4 11.2 4 14.5 4" />
      <path d="M1.5 14.3c4.6 0 6.8-1.9 8.2-5" />
      <circle cx="8.1" cy="8.2" r="1" />
    </>
  ),
  // Mainsail and jib over a waterline.
  sailing: (
    <>
      <path d="M8.3 1.8v9.2" />
      <path d="M8.3 2.6 13 11h-4.7" />
      <path d="M7.3 4.2 3.6 11h3.7" />
      <path d="M1.5 13.2c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1" />
    </>
  ),
  // Two crossed skis with turned-up tips.
  ski: (
    <>
      <path d="M4.6 14.2 9.8 3.6c.4-.9 1.2-1.4 2-1.1" />
      <path d="M11.4 14.2 6.2 3.6c-.4-.9-1.2-1.4-2-1.1" />
      <path d="M5.6 11.4h4.8" />
    </>
  ),
  // A cloche, lifted a hair off the pass.
  culinary: (
    <>
      <path d="M2.4 11.2a5.6 5.6 0 0 1 11.2 0" />
      <path d="M1.4 11.4h13.2" />
      <path d="M8 5.6V3.9" />
      <path d="M4.4 13.7h7.2" />
    </>
  ),
  // A hanger.
  fashion: (
    <>
      <path d="M8 6.2V5a1.8 1.8 0 1 1 3.6 0" />
      <path d="M8 6.2 1.8 10.6c-.7.5-.4 1.6.5 1.6h11.4c.9 0 1.2-1.1.5-1.6L8 6.2Z" />
    </>
  ),
  // A droplet with its ripple.
  wellness: (
    <>
      <path d="M8 2.2c2.4 2.7 3.6 4.6 3.6 6.2a3.6 3.6 0 1 1-7.2 0c0-1.6 1.2-3.5 3.6-6.2Z" />
      <path d="M1.6 13.6c1.4 0 1.4.9 2.8.9s1.4-.9 2.8-.9 1.4.9 2.8.9 1.4-.9 2.8-.9" />
    </>
  ),
  // An acacia against the flat.
  safari: (
    <>
      <path d="M2 6.4c1.8-1.9 4.2-2 6-2s4.2.1 6 2" />
      <path d="M4.2 6.4c1-.9 2.4-1 3.8-1s2.8.1 3.8 1" />
      <path d="M8 6.4v7.4" />
      <path d="M8 9.4 5.6 7.6M8 11 10.6 9" />
      <path d="M1.6 13.8h12.8" />
    </>
  ),
  // A horseshoe with its nails.
  equestrian: (
    <>
      <path d="M4.4 13.6V9a3.6 3.6 0 1 1 7.2 0v4.6" />
      <path d="M4.4 13.6h1.8M9.8 13.6h1.8" />
      <path d="M4.9 8.2h.9M10.2 8.2h.9M5.4 10.6h.9M9.7 10.6h.9" />
    </>
  ),
  // A strip of film.
  film: (
    <>
      <rect x="2.5" y="3" width="11" height="10" />
      <path d="M5.4 3v10M10.6 3v10" />
      <path d="M3.4 5.3h1.1M3.4 8h1.1M3.4 10.7h1.1M11.5 5.3h1.1M11.5 8h1.1M11.5 10.7h1.1" />
    </>
  ),
  // Draughtsman's compass over a baseline.
  design: (
    <>
      <path d="M8 2.2v1.6" />
      <path d="M8 3.8 4.4 12.4M8 3.8l3.6 8.6" />
      <path d="M5.5 8.4a5 5 0 0 0 5 0" />
      <path d="M1.6 13.9h12.8" />
    </>
  ),
  // The pin on the green.
  golf: (
    <>
      <path d="M5.6 2.2v11.6" />
      <path d="M5.6 2.6 12 5.1 5.6 7.6" />
      <path d="M2.4 13.8c1.4-.7 2.2-1 3.2-1s1.8.3 3.2 1" />
      <circle cx="11.6" cy="13" r="1" />
    </>
  ),
  // The seam of a ball.
  tennis: (
    <>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M3.3 4.8c2.4 1.4 3.4 3.6 3 6.6" />
      <path d="M12.7 4.8c-2.4 1.4-3.4 3.6-3 6.6" />
    </>
  ),
  // A single leaf with its midrib.
  nature: (
    <>
      <path d="M13.4 2.6c0 6-3.4 9.6-8 9.6-1 0-1.8-.2-2.4-.5.8-5.6 4.4-8.7 10.4-9.1Z" />
      <path d="M13 3 4.2 12.9" />
    </>
  ),
  // A portico: pediment, columns, stylobate.
  cultural: (
    <>
      <path d="M1.6 5.6 8 2.2l6.4 3.4H1.6Z" />
      <path d="M3.6 5.6v6.6M6.5 5.6v6.6M9.5 5.6v6.6M12.4 5.6v6.6" />
      <path d="M2.2 12.2h11.6M1.6 13.9h12.8" />
    </>
  ),
  // A coupe.
  gala: (
    <>
      <path d="M3.4 2.6h9.2l-3.1 5a2 2 0 0 1-3 0l-3.1-5Z" />
      <path d="M8 9.2v3.4" />
      <path d="M5.4 13.8h5.2" />
    </>
  ),
};

export interface CategoryGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  category: EventCategory;
  /** Edge length in px. 14 is the inline default; 16–20 reads as a mark. */
  size?: number;
  /**
   * When true the glyph is announced ("Motorsport"). Leave false wherever the
   * category is already written next to it — the default, since a duplicated
   * label is noise in a screen reader.
   */
  labelled?: boolean;
}

export function CategoryGlyph({
  category,
  size = 14,
  labelled = false,
  className,
  ...rest
}: CategoryGlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      role={labelled ? 'img' : 'presentation'}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? CATEGORY_LABEL[category] : undefined}
      className={cn('shrink-0', className)}
      {...rest}
    >
      {P[category]}
    </svg>
  );
}
