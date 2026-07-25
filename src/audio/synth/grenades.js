// L3 audio — grenade bounce/stick/tick/detonation. FEEL.md §7: "the player MUST
// know they have been stuck" and "enemy grenades emit a distinct proximity
// tick audible before detonation."

import { clamp01, lerp } from '../../shared/math.js';
import { Priority } from '../constants.js';
import { acquireComposite, playBufferShot, playOscShot } from './helpers.js';

export function playGrenadeBounced(sc, impactSpeed, position) {
  const t = clamp01((impactSpeed ?? 3) / 15);
  const voice = acquireComposite(sc, Priority.GRENADE_BOUNCE, 'world');
  if (!voice) return;
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.GRENADE_BOUNCE,
    position,
    buffer: sc.bank.get('whiteShort'),
    gain: lerp(0.1, 0.4, t),
    attack: 0.001,
    hold: 0,
    release: 0.05,
    filter: { type: 'bandpass', frequency: lerp(900, 2200, t), Q: 1.2 },
  });
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.GRENADE_BOUNCE,
    position,
    type: 'sine',
    freqFrom: lerp(500, 1300, t),
    time: 0.08,
    gain: lerp(0.08, 0.25, t),
  });
}

/** grenade.stuck — the "you have been marked" cue. Must be unmistakable. */
export function playGrenadeStuck(sc, position) {
  const voice = acquireComposite(sc, Priority.GRENADE_STUCK, 'world');
  if (!voice) return;
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.GRENADE_STUCK,
    position,
    buffer: sc.bank.get('crackleLong'),
    gain: 0.55,
    attack: 0.001,
    hold: 0.05,
    release: 0.35,
    filter: { type: 'bandpass', frequency: 2000, Q: 1.0 },
  });
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.GRENADE_STUCK,
    position,
    type: 'sawtooth',
    freqFrom: 1800,
    freqTo: 200,
    time: 0.4,
    gain: 0.4,
  });
}

/** A single proximity tick. index.js schedules the interval based on distance. */
export function playGrenadeTick(sc, position, urgency01 = 0) {
  playOscShot(sc, {
    bus: 'world',
    priority: Priority.GRENADE_TICK,
    position,
    type: 'square',
    freqFrom: lerp(1400, 2000, urgency01),
    time: 0.045,
    gain: lerp(0.12, 0.28, urgency01),
  });
}

export function playGrenadeDetonated(sc, grenadeType, position) {
  const isPlasma = grenadeType === 'plasma';
  const voice = acquireComposite(sc, Priority.GRENADE_DETONATED, 'world');
  if (!voice) return;

  // Low body common to both.
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.GRENADE_DETONATED,
    position,
    type: 'sine',
    freqFrom: isPlasma ? 110 : 75,
    freqTo: isPlasma ? 45 : 28,
    time: isPlasma ? 0.5 : 0.7,
    gain: 0.9,
  });
  // The crack.
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.GRENADE_DETONATED,
    position,
    buffer: sc.bank.get('whiteMed'),
    gain: 0.95,
    attack: 0.001,
    hold: 0.02,
    release: isPlasma ? 0.18 : 0.24,
    filter: { type: isPlasma ? 'bandpass' : 'lowpass', frequency: isPlasma ? 2400 : 550, Q: isPlasma ? 1.3 : 0.5 },
  });
  // The tail — dirty broadband rumble for frag, an electric ring-down for plasma.
  if (isPlasma) {
    playOscShot(sc, {
      voice,
      bus: 'world',
      priority: Priority.GRENADE_DETONATED,
      position,
      type: 'sawtooth',
      freqFrom: 900,
      freqTo: 200,
      time: 0.9,
      gain: 0.35,
    });
  } else {
    playBufferShot(sc, {
      voice,
      bus: 'world',
      priority: Priority.GRENADE_DETONATED,
      position,
      buffer: sc.bank.get('darkLong'),
      gain: 0.4,
      attack: 0.02,
      hold: 0.3,
      release: 1.4,
      filter: { type: 'lowpass', frequency: 400, Q: 0.4 },
    });
  }
}
