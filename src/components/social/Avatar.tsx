import { cn } from '@/components/ui';
import { avatarSpec, initialsFrom } from '@/lib/social/avatar';

export interface AvatarProps {
  /** The member's `avatarSeed`. Same seed always draws the same plate. */
  seed: string;
  /** Edge length in px. */
  size: number;
  /** Used for the monogram and the accessible label. */
  name: string;
  className?: string;
  /**
   * Draw a second, offset ring in the plate's accent colour. Used to mark the
   * signed-in member and members who are on your manifest.
   */
  accented?: boolean;
  /** Set when the avatar sits next to its own label and would be redundant. */
  decorative?: boolean;
}

/**
 * A generated plate, not a photograph.
 *
 * Deterministic and dependency-free — the same markup renders on the server and
 * on the client, so this is safe above the hydration boundary and inside it.
 * See `lib/social/avatar.ts` for the generator.
 */
export function Avatar({
  seed,
  size,
  name,
  className,
  accented = false,
  decorative = false,
}: AvatarProps) {
  const spec = avatarSpec(seed);
  const initials = initialsFrom(name);
  const id = `av${spec.key}`;
  const r = size / 2;
  const ringR = r - 0.5;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0 select-none', className)}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      <defs>
        <linearGradient id={`${id}p`} gradientTransform={`rotate(${spec.angle} 0.5 0.5)`}>
          <stop offset="0%" stopColor={spec.plateTop} />
          <stop offset="100%" stopColor={spec.plateBottom} />
        </linearGradient>
        <radialGradient id={`${id}s`} cx="28%" cy="20%" r="72%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>

      {/* The plate */}
      <circle cx={r} cy={r} r={r} fill={`url(#${id}p)`} />
      {/* Light from the top-left, matching the product's single-source lighting */}
      <circle cx={r} cy={r} r={r} fill={`url(#${id}s)`} />
      {/* Brass hairline — the house metal, at one pixel, always */}
      <circle
        cx={r}
        cy={r}
        r={ringR}
        fill="none"
        stroke={`rgba(200,168,102,${spec.ringAlpha})`}
        strokeWidth={1}
      />
      {/* Inner engraving */}
      <circle
        cx={r}
        cy={r}
        r={Math.max(0, ringR - 2.5)}
        fill="none"
        stroke="rgba(244,241,234,0.05)"
        strokeWidth={1}
      />
      {accented && (
        <circle
          cx={r}
          cy={r}
          r={Math.max(0, ringR - 1.5)}
          fill="none"
          stroke={spec.accent}
          strokeOpacity={0.55}
          strokeWidth={1}
        />
      )}

      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill={spec.monogram}
        fontSize={Math.round(size * 0.34 * 10) / 10}
        letterSpacing={Math.round(size * 0.012 * 10) / 10}
        style={{
          fontFamily:
            "Didot, 'Bodoni MT', 'Playfair Display', 'Hoefler Text', Garamond, 'Times New Roman', serif",
        }}
      >
        {initials}
      </text>
    </svg>
  );
}
