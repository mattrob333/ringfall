// L3 audio — direct-trigger UI cues (not event-driven). AudioEngine.playUi(cue).

import { Priority } from '../constants.js';
import { acquireComposite, playOscShot } from './helpers.js';

export function playUiCue(sc, cue) {
  switch (cue) {
    case 'select':
      playOscShot(sc, { bus: 'ui', priority: Priority.UI, type: 'sine', freqFrom: 700, time: 0.05, gain: 0.2 });
      return;
    case 'confirm': {
      const voice = acquireComposite(sc, Priority.UI, 'ui');
      if (!voice) return;
      playOscShot(sc, { voice, bus: 'ui', priority: Priority.UI, type: 'sine', freqFrom: 620, time: 0.09, gain: 0.24 });
      playOscShot(sc, { voice, bus: 'ui', priority: Priority.UI, type: 'sine', freqFrom: 930, time: 0.12, gain: 0.24, attack: 0.06 });
      return;
    }
    case 'back':
      playOscShot(sc, { bus: 'ui', priority: Priority.UI, type: 'sine', freqFrom: 500, freqTo: 340, time: 0.08, gain: 0.2 });
      return;
    case 'pickup': {
      const voice = acquireComposite(sc, Priority.UI, 'ui');
      if (!voice) return;
      playOscShot(sc, { voice, bus: 'ui', priority: Priority.UI, type: 'triangle', freqFrom: 780, time: 0.06, gain: 0.22 });
      playOscShot(sc, { voice, bus: 'ui', priority: Priority.UI, type: 'triangle', freqFrom: 1040, time: 0.08, gain: 0.2, attack: 0.05 });
      return;
    }
    case 'lowAmmo':
      playOscShot(sc, { bus: 'ui', priority: Priority.UI, type: 'square', freqFrom: 340, time: 0.14, gain: 0.16 });
      return;
    default:
      // Unknown cue: a neutral blip rather than silence, so a typo is audible.
      playOscShot(sc, { bus: 'ui', priority: Priority.UI, type: 'sine', freqFrom: 440, time: 0.05, gain: 0.15 });
  }
}
