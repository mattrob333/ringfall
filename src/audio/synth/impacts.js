// L3 audio — impact synthesis for every SurfaceId. Driven by `surface.impact`
// {point, normal, surfaceId, energy, damageType, sourceId} — ARCHITECTURE.md §4.4:
// "the single hook for impact decals, sparks, dust, and impact audio."
//
// Every SurfaceId in shared/enums.js maps to one of nine audible families named
// in the brief. `energy` (arbitrary positive units from the emitter) drives
// gain and brightness; it is normalized against a nominal reference so a
// pistol tap and a Longbow round don't sound identical.

import { SurfaceId } from '../../shared/enums.js';
import { Priority } from '../constants.js';
import { acquireComposite, playBufferShot, playOscShot } from './helpers.js';
import { clamp01 } from '../../shared/math.js';

const ENERGY_REF = 22; // rough normalization point; most kinetic rounds land near here

function energyNorm(energy) {
  return clamp01((energy ?? ENERGY_REF) / ENERGY_REF);
}

function metalPing(sc, voice, e, position, priority, rattly = false) {
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('whiteShort'),
    gain: 0.35 + 0.5 * e,
    attack: 0.001,
    hold: 0,
    release: 0.05 + 0.02 * e,
    filter: { type: 'bandpass', frequency: 2600 + 800 * e, Q: 1.8 },
  });
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    type: 'sine',
    freqFrom: (rattly ? 1400 : 2200) * (1 + sc.rng.range(-0.05, 0.05)),
    freqTo: (rattly ? 900 : 1400),
    time: 0.09 + 0.05 * e,
    gain: 0.25 + 0.25 * e,
  });
}

function concreteCrack(sc, voice, e, position, priority) {
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('crackleShort'),
    gain: 0.4 + 0.5 * e,
    attack: 0.001,
    hold: 0.01,
    release: 0.09,
    filter: { type: 'bandpass', frequency: 1400, Q: 0.9 },
  });
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('darkMed'),
    gain: 0.12 + 0.1 * e,
    attack: 0.01,
    hold: 0.05,
    release: 0.4, // the "dust" tail
    filter: { type: 'lowpass', frequency: 900, Q: 0.4 },
  });
}

function softThud(sc, voice, e, position, priority) {
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('darkShort'),
    gain: 0.25 + 0.35 * e,
    attack: 0.003,
    hold: 0.01,
    release: 0.1,
    filter: { type: 'lowpass', frequency: 500, Q: 0.5 },
  });
}

function glassShatter(sc, voice, e, position, priority) {
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('whiteMed'),
    gain: 0.4 + 0.4 * e,
    attack: 0.001,
    hold: 0.02,
    release: 0.3,
    filter: { type: 'highpass', frequency: 2200, Q: 0.6 },
  });
  const shards = 4;
  for (let i = 0; i < shards; i++) {
    playOscShot(sc, {
      voice,
      bus: 'world',
      priority,
      position,
      type: 'sine',
      freqFrom: 2800 + sc.rng.range(-600, 1400),
      time: 0.12 + sc.rng.range(0, 0.1),
      gain: 0.12,
      attack: 0.001 + i * 0.01,
    });
  }
}

function alloySmoothRing(sc, voice, e, position, priority) {
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    type: 'sine',
    freqFrom: 1600,
    freqTo: 1550,
    time: 0.6 + 0.3 * e,
    gain: 0.35 + 0.3 * e,
    release: 0.55,
  });
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('whiteShort'),
    gain: 0.3,
    release: 0.04,
    filter: { type: 'bandpass', frequency: 3200, Q: 2.0 },
  });
}

function alloyHardBell(sc, voice, e, position, priority) {
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    type: 'triangle',
    freqFrom: 380,
    freqTo: 360,
    time: 0.9 + 0.4 * e,
    gain: 0.4 + 0.3 * e,
    release: 0.8,
  });
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    type: 'sine',
    freqFrom: 640, // inharmonic partial for a bell-like beat
    time: 0.5,
    gain: 0.18,
  });
}

function fleshThud(sc, voice, e, position, priority) {
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('darkShort'),
    gain: 0.3 + 0.35 * e,
    attack: 0.004,
    hold: 0.01,
    release: 0.09,
    filter: { type: 'lowpass', frequency: 340, Q: 0.4 },
    playbackRate: 0.8 + sc.rng.range(0, 0.3),
  });
}

function shieldCrackle(sc, voice, e, position, priority) {
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('crackleShort'),
    gain: 0.4 + 0.4 * e,
    attack: 0.001,
    hold: 0.03,
    release: 0.12,
    filter: { type: 'bandpass', frequency: 2200, Q: 1.4 },
  });
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    type: 'square',
    freqFrom: 1900,
    freqTo: 700,
    time: 0.08,
    gain: 0.2,
  });
}

function waterSplash(sc, voice, e, position, priority) {
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('whiteMed'),
    gain: 0.3 + 0.3 * e,
    attack: 0.002,
    hold: 0.02,
    release: 0.22,
    filter: { type: 'bandpass', frequency: 1800, Q: 0.5 },
  });
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('darkMed'),
    gain: 0.15,
    attack: 0.01,
    hold: 0.02,
    release: 0.25,
    filter: { type: 'lowpass', frequency: 350, Q: 0.4 },
  });
}

const FAMILY = {
  [SurfaceId.METAL_PAINTED]: (sc, v, e, p, pr) => metalPing(sc, v, e, p, pr, false),
  [SurfaceId.METAL_BARE]: (sc, v, e, p, pr) => metalPing(sc, v, e, p, pr, false),
  [SurfaceId.METAL_GRATE]: (sc, v, e, p, pr) => metalPing(sc, v, e, p, pr, true),
  [SurfaceId.VEHICLE_HULL]: (sc, v, e, p, pr) => metalPing(sc, v, e, p, pr, false),
  [SurfaceId.ARMOR_HARD]: (sc, v, e, p, pr) => metalPing(sc, v, e, p, pr, false),
  [SurfaceId.CONCRETE]: concreteCrack,
  [SurfaceId.ROCK]: concreteCrack,
  [SurfaceId.DIRT]: softThud,
  [SurfaceId.GRASS]: softThud,
  [SurfaceId.SAND]: softThud,
  [SurfaceId.GLASS]: glassShatter,
  [SurfaceId.ALLOY_SMOOTH]: alloySmoothRing,
  [SurfaceId.ALLOY_HARD]: alloyHardBell,
  [SurfaceId.ENERGY_BARRIER]: shieldCrackle,
  [SurfaceId.FLESH]: fleshThud,
  [SurfaceId.SHIELD]: shieldCrackle,
  [SurfaceId.WATER]: waterSplash,
};

export function playSurfaceImpact(sc, payload, position) {
  const fn = FAMILY[payload.surfaceId] ?? softThud;
  const e = energyNorm(payload.energy);
  const priority = Priority.IMPACT + Math.round(e * 10);
  const voice = acquireComposite(sc, priority, 'world');
  if (!voice) return;
  fn(sc, voice, e, position, priority);
}
