// tools/ — the 12-shot baseline set. ARCHITECTURE.md §9.
// Names are frozen. Camera values move only when the level moves, and a move
// invalidates the committed baseline, which must be recaptured in the same commit.

export const SHOT_WIDTH = 1280;
export const SHOT_HEIGHT = 720;
export const WARMUP_FRAMES = 90;

export const SHOTS = [
  { name: 'int_corridor', pos: [0, 1.62, 6.5], yaw: 0.0, pitch: -0.02 },
  { name: 'int_hall_emissive', pos: [-13.5, 2.4, 1.5], yaw: -1.25, pitch: 0.05 },
  { name: 'ext_vista', pos: [4, 3.2, 24], yaw: 0.12, pitch: 0.05 },
  { name: 'ext_ground', pos: [22, 2.0, 18], yaw: 0.9, pitch: -0.12 },
  { name: 'weapon_close', pos: [0, 1.62, 2.0], yaw: 0.0, pitch: -0.05 },
  { name: 'enemy_15m', pos: [10.5, 1.62, 11], yaw: 0.02, pitch: -0.02 },
  { name: 'enemy_60m_sil', pos: [0, 1.62, 55], yaw: 0.0, pitch: 0.0 },
  { name: 'vehicle_ext', pos: [16, 2.2, 10], yaw: 0.55, pitch: -0.08 },
  { name: 'night_emissive', pos: [-16, 2.2, 6], yaw: -0.7, pitch: 0.0, night: true },
  { name: 'shield_flare', pos: [10, 1.9, 4], yaw: 0.25, pitch: 0.0 },
  { name: 'firefight', pos: [2, 1.62, 9], yaw: -0.15, pitch: -0.03 },
  { name: 'sky_only', pos: [0, 60, 120], yaw: 0.4, pitch: 0.28 },
];
