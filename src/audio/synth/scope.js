// L3 audio — scope zoom cues. FEEL.md §4.4 requires enter/exit to be distinct
// zoom sounds, plus a separate descope cue for the forced-on-damage case.

import { Priority } from '../constants.js';
import { acquireComposite, playBufferShot, playOscShot } from './helpers.js';

export function playScopeEnter(sc, magnification) {
  const high = (magnification ?? 2) >= 6;
  playOscShot(sc, {
    bus: 'weapons',
    priority: Priority.SCOPE,
    type: 'sine',
    freqFrom: high ? 500 : 380,
    freqTo: high ? 1400 : 820,
    time: high ? 0.14 : 0.1,
    gain: 0.28,
  });
}

export function playScopeExit(sc, magnification) {
  const high = (magnification ?? 2) >= 6;
  playOscShot(sc, {
    bus: 'weapons',
    priority: Priority.SCOPE,
    type: 'sine',
    freqFrom: high ? 1400 : 820,
    freqTo: high ? 500 : 380,
    time: 0.09,
    gain: 0.24,
  });
}

/** scope.descoped — forced off by taking damage. Sharper and more abrupt than a manual exit. */
export function playDescoped(sc) {
  const voice = acquireComposite(sc, Priority.SCOPE, 'weapons');
  if (!voice) return;
  playBufferShot(sc, {
    voice,
    bus: 'weapons',
    priority: Priority.SCOPE,
    buffer: sc.bank.get('whiteShort'),
    gain: 0.3,
    attack: 0.001,
    release: 0.03,
    filter: { type: 'highpass', frequency: 3000, Q: 0.7 },
  });
  playOscShot(sc, {
    voice,
    bus: 'weapons',
    priority: Priority.SCOPE,
    type: 'square',
    freqFrom: 1100,
    freqTo: 300,
    time: 0.05,
    gain: 0.22,
  });
}
