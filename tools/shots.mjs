// tools/ — the 12-shot baseline set. ARCHITECTURE.md §9.
// Names are frozen. Camera values move only when the level moves, and a move
// invalidates the committed baseline, which must be recaptured in the same commit.

export const SHOT_WIDTH = 1280;
export const SHOT_HEIGHT = 720;
export const WARMUP_FRAMES = 90;

export const SHOTS = [
  // CDF outpost interior, looking in from the entrance.
  { name: 'int_corridor', pos: [0, 2.3, -36], yaw: 0.0, pitch: -0.04 },
  // Wrought courtyard — pale slabs, deep gaps, glowing seams.
  { name: 'int_hall_emissive', pos: [-46, 3.0, 8], yaw: -1.5708, pitch: 0.02 },
  // The money shot: open vista with the megastructure arc.
  { name: 'ext_vista', pos: [10, 6.0, 60], yaw: 0.18, pitch: 0.16 },
  // Mid-field, cascade 1->2 seam and terrain read.
  { name: 'ext_ground', pos: [34, 3.0, 30], yaw: 2.3, pitch: -0.06 },
  // First-person weapon filling the frame.
  { name: 'weapon_close', pos: [4, 2.0, 12], yaw: 0.25, pitch: -0.03 },
  { name: 'enemy_15m', pos: [0, 1.9, -18], yaw: 0.0, pitch: -0.01 },
  { name: 'enemy_60m_sil', pos: [0, 2.4, 26], yaw: 0.0, pitch: 0.02 },
  { name: 'vehicle_ext', pos: [22, 2.4, 26], yaw: 1.05, pitch: -0.08 },
  { name: 'night_emissive', pos: [44, 2.6, 6], yaw: 1.5708, pitch: 0.02, night: true },
  { name: 'shield_flare', pos: [0, 1.9, -14], yaw: 0.0, pitch: 0.0 },
  { name: 'firefight', pos: [6, 2.1, -6], yaw: -0.2, pitch: -0.02 },
  // Sky and ring only, no terrain — isolates the sky model.
  { name: 'sky_only', pos: [0, 40, 0], yaw: 0.5, pitch: 0.55 },
];
