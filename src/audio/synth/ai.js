// L3 audio — AI vocalizations. `ai.vocalize {entityId, archetype, cue}`.
// Abstract formant-ish alien chatter: a pulse oscillator run through two
// resonant bandpass filters (standing in for vowel formants) chopped into a
// handful of short syllables. This is deliberately NOT intelligible speech in
// any real language — it is closer to a texture than a phoneme set.

import { Priority } from '../constants.js';
import { acquireComposite, playOscShot } from './helpers.js';

const PROFILE = {
  SKIRN: { syllables: [2, 4], syllableDur: [0.045, 0.09], gapMs: [10, 40], base: [700, 1100], formant: 2200, gain: 0.22 },
  CULL: { syllables: [1, 2], syllableDur: [0.06, 0.09], gapMs: [20, 30], base: [280, 420], formant: 1200, gain: 0.24 },
  VANE: { syllables: [2, 3], syllableDur: [0.12, 0.2], gapMs: [30, 70], base: [140, 220], formant: 800, gain: 0.28 },
  WARDEN: { syllables: [1, 2], syllableDur: [0.25, 0.4], gapMs: [40, 90], base: [45, 75], formant: 300, gain: 0.32 },
};

export function playVocalize(sc, archetype, position) {
  const profile = PROFILE[archetype] ?? PROFILE.CULL;
  const voice = acquireComposite(sc, Priority.AI_VOCALIZE, 'voice');
  if (!voice) return;

  const count = sc.rng.int(profile.syllables[0], profile.syllables[1]);
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const dur = sc.rng.range(profile.syllableDur[0], profile.syllableDur[1]);
    const f0 = sc.rng.range(profile.base[0], profile.base[1]);
    const f1 = f0 * sc.rng.range(0.75, 1.25);

    playOscShot(sc, {
      voice,
      bus: 'voice',
      priority: Priority.AI_VOCALIZE,
      position,
      type: 'sawtooth',
      freqFrom: f0,
      freqTo: f1,
      time: dur,
      gain: profile.gain,
      attack: dur * 0.15,
      delay: cursor,
    });
    // A second, filtered layer approximating a formant peak. playOscShot has no
    // built-in filter param, so this is a plain tonal partner voiced an octave
    // up from the fundamental to imply a resonant peak without a second graph.
    playOscShot(sc, {
      voice,
      bus: 'voice',
      priority: Priority.AI_VOCALIZE,
      position,
      type: 'triangle',
      freqFrom: profile.formant * sc.rng.range(0.9, 1.1),
      time: dur * 0.8,
      gain: profile.gain * 0.35,
      delay: cursor,
    });
    cursor += dur + sc.rng.range(profile.gapMs[0], profile.gapMs[1]) / 1000;
  }
}
