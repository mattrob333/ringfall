import { cn } from '@/components/ui';
import { MemberPortrait, PortraitPlate } from './MemberPortrait';

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
  /**
   * A real photograph, when the record has one. Optional and usually absent —
   * pass `member.photoUrl` and the same call site works for both.
   */
  photoUrl?: string;
}

/**
 * A member's face at small sizes: their photograph if there is one, the
 * generated plate if not.
 *
 * The props here have not changed — every existing call site draws the same
 * thing, better. The generator moved to `lib/social/portrait.ts`, which layers
 * a duotone plate, a soft form under a single key light, engine-turned
 * hairlines and the brass frame; below ~56px it drops to the plate, the frame
 * and the monogram, because detail at 24px is mud.
 *
 * Deterministic and dependency-free when there is no photograph, so this stays
 * safe on both sides of the hydration boundary.
 */
export function Avatar({
  seed,
  size,
  name,
  className,
  accented = false,
  decorative = false,
  photoUrl,
}: AvatarProps) {
  if (photoUrl) {
    return (
      <MemberPortrait
        seed={seed}
        size={size}
        name={name}
        photoUrl={photoUrl}
        accented={accented}
        decorative={decorative}
        className={className}
      />
    );
  }

  return (
    <PortraitPlate
      seed={seed}
      size={size}
      name={name}
      accented={accented}
      decorative={decorative}
      className={cn('shrink-0', className)}
    />
  );
}
