/**
 * The page installs window-level shortcuts (Space to play, ←/→ to scrub).
 * Any control that consumes those keys itself must stop them reaching the
 * window, or a Space press on a filter chip both toggles the chip and starts
 * the year turning. React dispatches from the root container, which sits below
 * `window`, so stopping propagation here genuinely prevents the global handler.
 */

const APP_KEYS = new Set([
  ' ',
  'Spacebar',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function guardAppKeys(e: React.KeyboardEvent): void {
  if (APP_KEYS.has(e.key)) e.stopPropagation();
}

/** Compose a consumer handler with the guard, guard first. */
export function withAppKeyGuard<E extends React.KeyboardEvent>(
  handler?: (e: E) => void,
): (e: E) => void {
  return (e: E) => {
    guardAppKeys(e);
    handler?.(e);
  };
}
