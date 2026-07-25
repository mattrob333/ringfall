// L3 audio — weapon handling: reload, swap, overheat/cooled. These bookend a
// duration (reload.start/.end, swap.start/.end) with two discrete mechanical
// cues rather than trying to synchronize a single sound to `durationMs`.

import { Priority } from '../constants.js';
import { playBufferShot, playOscShot } from './helpers.js';

export function playReloadStart(sc, fromEmpty, position) {
  playBufferShot(sc, {
    bus: 'weapons',
    priority: Priority.WEAPON_HANDLING,
    position,
    buffer: sc.bank.get('whiteShort'),
    gain: fromEmpty ? 0.3 : 0.22,
    attack: 0.002,
    hold: 0.02,
    release: 0.06,
    filter: { type: 'bandpass', frequency: 1100, Q: 1.0 },
  });
}

export function playReloadEnd(sc, position) {
  playBufferShot(sc, {
    bus: 'weapons',
    priority: Priority.WEAPON_HANDLING,
    position,
    buffer: sc.bank.get('darkShort'),
    gain: 0.32,
    attack: 0.001,
    hold: 0.01,
    release: 0.05,
    filter: { type: 'lowpass', frequency: 700, Q: 0.6 },
  });
}

export function playSwapStart(sc, position) {
  playBufferShot(sc, {
    bus: 'weapons',
    priority: Priority.WEAPON_HANDLING,
    position,
    buffer: sc.bank.get('whiteShort'),
    gain: 0.2,
    attack: 0.002,
    hold: 0.01,
    release: 0.05,
    filter: { type: 'highpass', frequency: 900, Q: 0.7 },
  });
}

export function playSwapEnd(sc, position) {
  playBufferShot(sc, {
    bus: 'weapons',
    priority: Priority.WEAPON_HANDLING,
    position,
    buffer: sc.bank.get('darkShort'),
    gain: 0.26,
    attack: 0.001,
    hold: 0.01,
    release: 0.06,
    filter: { type: 'lowpass', frequency: 550, Q: 0.6 },
  });
}

export function playOverheat(sc, position) {
  playBufferShot(sc, {
    bus: 'weapons',
    priority: Priority.WEAPON_HANDLING,
    position,
    buffer: sc.bank.get('whiteLong'),
    gain: 0.3,
    attack: 0.05,
    hold: 0.3,
    release: 0.5,
    filter: { type: 'highpass', frequency: 2500, Q: 0.5 },
  });
}

export function playCooled(sc, position) {
  playOscShot(sc, {
    bus: 'weapons',
    priority: Priority.WEAPON_HANDLING,
    position,
    type: 'sine',
    freqFrom: 500,
    freqTo: 720,
    time: 0.12,
    gain: 0.25,
  });
}
