'use client';

import { createElement, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/components/ui';
import {
  isUsablePhotoUrl,
  portraitDrawing,
  readImageAsPortrait,
  type PortraitNode,
  type PortraitOptions,
  type PortraitShape,
} from '@/lib/social/portrait';

/**
 * A member's face.
 *
 * If they have a photograph, that is what you see — cover-cropped, never
 * distorted, cross-fading in over the generated plate so a slow connection
 * shows something considered rather than a grey box. If the URL is broken or
 * the decode fails, the plate stays and nothing about the layout moves.
 *
 * If they do not — which is the entire simulated roster, because this product
 * ships no photography and will not fabricate faces for people who do not
 * exist — the plate is the portrait. See `lib/social/portrait.ts`.
 *
 * The plate is a pure function of the seed and renders identically on the
 * server and the client, so this is safe anywhere. Only the photo layer has
 * state, and a photo only ever arrives from persisted local storage, well
 * after hydration.
 */
export interface MemberPortraitProps {
  /** The member's `avatarSeed`. */
  seed: string;
  /** Used for the monogram and the accessible name. */
  name: string;
  /** Edge length in px. For `panel`, the width; height follows `ratio`. */
  size: number;
  /** A real photograph, if the record has one. */
  photoUrl?: string;
  shape?: PortraitShape;
  /** `panel` only. Height = size × ratio. Default 1.25. */
  ratio?: number;
  /** Second ring in the plate's accent colour — you, and your manifest. */
  accented?: boolean;
  /** Set when the portrait sits next to its own label and would be redundant. */
  decorative?: boolean;
  detail?: PortraitOptions['detail'];
  className?: string;
  /** Overlaid on top of the portrait, inside the frame. */
  children?: ReactNode;
}

export function MemberPortrait({
  seed,
  name,
  size,
  photoUrl,
  shape = 'circle',
  ratio = 1.25,
  accented = false,
  decorative = false,
  detail = 'auto',
  className,
  children,
}: MemberPortraitProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hasPhoto = isUsablePhotoUrl(photoUrl) && !failed;

  const width = size;
  const height = shape === 'panel' ? Math.round(size * ratio) : size;

  return (
    <span
      className={cn(
        'relative block shrink-0 select-none overflow-hidden',
        shape === 'circle' ? 'rounded-full' : 'rounded-[2px]',
        className,
      )}
      style={{ width, height }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      <PortraitPlate
        seed={seed}
        name={name}
        size={size}
        shape={shape}
        ratio={ratio}
        accented={accented}
        detail={detail}
        decorative
        className="absolute inset-0"
      />

      {hasPhoto && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URIs from
              the user's own device; the optimiser has nothing to fetch. */}
          <img
            src={photoUrl}
            alt=""
            aria-hidden
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              'absolute inset-0 h-full w-full object-cover',
              'transition-opacity duration-[var(--duration-considered)] ease-[var(--ease-settle)]',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
          {/* The frame lives in the plate's SVG, so a photo needs its own. */}
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 border border-brass/35',
              shape === 'circle' ? 'rounded-full' : 'rounded-[2px]',
            )}
          />
        </>
      )}

      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The generated plate
// ─────────────────────────────────────────────────────────────────────────────

export interface PortraitPlateProps {
  seed: string;
  name: string;
  size: number;
  shape?: PortraitShape;
  ratio?: number;
  accented?: boolean;
  detail?: PortraitOptions['detail'];
  decorative?: boolean;
  className?: string;
}

/**
 * The drawn plate on its own — no photo layer, no state, no client boundary
 * required. Rendered from the same node tree the string serializer uses, so
 * what a verification script writes to an `.svg` file is exactly what the DOM
 * gets.
 */
export function PortraitPlate({
  seed,
  name,
  size,
  shape = 'circle',
  ratio = 1.25,
  accented = false,
  detail = 'auto',
  decorative = false,
  className,
}: PortraitPlateProps) {
  const drawing = portraitDrawing(seed, size, name, { shape, ratio, accented, detail });

  return (
    <svg
      width={drawing.width}
      height={drawing.height}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      className={cn('block shrink-0 select-none', className)}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      {drawing.nodes.map((node, i) => renderNode(node, `n${i}`))}
    </svg>
  );
}

/**
 * Node tree → React elements.
 *
 * Attribute names are passed through exactly as written (`stop-color`,
 * `clip-path`), which React DOM sets verbatim on SVG elements. Doing it this
 * way rather than translating to camelCase is what keeps one description of the
 * drawing instead of two that can drift.
 */
function renderNode(node: PortraitNode, key: string): ReactElement {
  const children =
    node.text !== undefined
      ? node.text
      : (node.children ?? []).map((child, i) => renderNode(child, `${key}.${i}`));
  return createElement(node.tag, { key, ...node.attrs }, children);
}

// ─────────────────────────────────────────────────────────────────────────────
// Setting your own
// ─────────────────────────────────────────────────────────────────────────────

export interface PortraitFieldProps {
  seed: string;
  name: string;
  photoUrl?: string;
  onChange: (dataUri: string | null) => void;
  className?: string;
}

/**
 * The one place a photograph enters the product.
 *
 * The file is downscaled to 256px square in a canvas before it is handed
 * upward — the original is never stored — because localStorage is a five
 * megabyte budget shared with everything else the member has authored, and a
 * modern phone photograph would spend all of it on one face.
 */
export function PortraitField({
  seed,
  name,
  photoUrl,
  onChange,
  className,
}: PortraitFieldProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { dataUri } = await readImageAsPortrait(file);
      onChange(dataUri);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That image could not be used.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={cn('flex items-start gap-3.5', className)}>
      <MemberPortrait seed={seed} name={name} size={56} photoUrl={photoUrl} accented decorative />

      <div className="min-w-0 flex-1">
        <p className="label text-ink-muted">Your portrait</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className={cn(
              'label rounded-[2px] border border-ink/12 px-2 py-1.5 text-ink-muted',
              'transition-colors hover:border-ink/25 hover:text-ink disabled:opacity-40',
            )}
          >
            {busy ? 'Reading' : photoUrl ? 'Replace' : 'Choose a photograph'}
          </button>
          {photoUrl && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                onChange(null);
              }}
              className="label text-ink-faint transition-colors hover:text-ink"
            >
              Remove
            </button>
          )}
        </div>
        <p className="mt-2.5 text-[11px] leading-4 text-ink-faint">
          {error ??
            'Cropped square and reduced to 256px on this device. Held in local storage with the rest of your record — it is never uploaded.'}
        </p>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose a portrait photograph"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
