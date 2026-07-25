// L3 audio — AudioContext creation with a hard requirement: never throw.
// ARCHITECTURE.md audio brief: "Graceful no-op if AudioContext is unavailable
// (headless test runs) ... This is REQUIRED — tools/feeltest.mjs runs headless
// and must not crash."

export function createAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}
