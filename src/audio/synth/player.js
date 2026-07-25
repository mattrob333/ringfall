// L3 audio — footsteps, landing, and jump exertion. Driven by player.footstep,
// player.landed, player.jumped. These payloads carry no world position (see
// DEFECTS.md), so they always play dry/centered rather than spatialized.

import { SURFACE_PHYSICS } from '../../shared/enums.js';
import { clamp01, lerp } from '../../shared/math.js';
import { Priority } from '../constants.js';
import { playBufferShot, playOscShot } from './helpers.js';

export function playFootstep(sc, surfaceId, speed) {
  const phys = SURFACE_PHYSICS[surfaceId] ?? { hardness: 0.7 };
  const hardness = phys.hardness ?? 0.7;
  const speedNorm = clamp01((speed ?? 2) / 4.4);
  const gain = lerp(0.08, 0.22, speedNorm);
  playBufferShot(sc, {
    bus: 'world',
    priority: Priority.FOOTSTEP,
    buffer: hardness > 0.6 ? sc.bank.get('whiteShort') : sc.bank.get('darkShort'),
    gain,
    attack: 0.002,
    hold: 0.004,
    release: lerp(0.09, 0.05, hardness),
    playbackRate: 0.9 + sc.rng.range(0, 0.25),
    filter: { type: hardness > 0.6 ? 'bandpass' : 'lowpass', frequency: lerp(280, 1400, hardness), Q: 0.5 },
  });
}

export function playPlayerLanded(sc, impactSpeed) {
  const t = clamp01((impactSpeed ?? 0) / 12);
  playBufferShot(sc, {
    bus: 'world',
    priority: Priority.PLAYER_LANDED,
    buffer: sc.bank.get('darkMed'),
    gain: lerp(0.15, 0.7, t),
    attack: 0.003,
    hold: 0.01,
    release: lerp(0.08, 0.22, t),
    filter: { type: 'lowpass', frequency: lerp(600, 220, t), Q: 0.5 },
  });
}

export function playJumpExertion(sc) {
  playBufferShot(sc, {
    bus: 'world',
    priority: Priority.PLAYER_JUMPED,
    buffer: sc.bank.get('whiteShort'),
    gain: 0.1,
    attack: 0.01,
    hold: 0.02,
    release: 0.08,
    filter: { type: 'bandpass', frequency: 900, Q: 0.7 },
  });
}
