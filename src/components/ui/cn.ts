/**
 * Minimal class joiner. No dependency, no merge semantics — the primitives in
 * this directory are written so that consumer classes always come last in the
 * emitted string, which is enough for the small, disciplined class surface
 * MERIDIAN uses.
 */

export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[];

export function cn(...parts: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v && v !== 0) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    out.push(String(v));
  };
  for (const p of parts) walk(p);
  return out.join(' ');
}
