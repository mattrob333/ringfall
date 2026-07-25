// L3 audio — vehicle engine loop, tyre skid, impact, rollover. setVehicleEngine
// is a direct (non event-driven) trigger per the public API, called every
// frame while a vehicle is live. Engine loops are persistent nodes managed
// outside the transient VoicePool — a handful of vehicles exist at once, and
// stealing an engine mid-loop to make room for a footstep would be wrong.
//
// LIMITATION: there is no event or field carrying lateral slip / wheel spin,
// so "tyre skid" is approximated from how fast `load01` changes frame to
// frame relative to `rpm01`. This is a heuristic, not ground truth — see
// src/audio/README.md.

import { clamp01, lerp } from '../../shared/math.js';
import { Priority } from '../constants.js';
import { createSpatialChain, updateChainPosition } from '../spatial.js';
import { acquireComposite, playBufferShot, playOscShot } from './helpers.js';

const IDLE_TIMEOUT = 1.5; // seconds inactive before an engine chain is fully torn down

class EngineChain {
  constructor(ctx, listener, destBus, noiseBank, position) {
    this.ctx = ctx;
    this.destBus = destBus;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 45;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 46;
    osc2.detune.value = 8;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 0.4;

    osc1.connect(engineGain);
    osc2.connect(engineGain);
    engineGain.connect(lp);

    const skidSrc = ctx.createBufferSource();
    skidSrc.buffer = noiseBank.get('whiteMed');
    skidSrc.loop = true;
    const skidGain = ctx.createGain();
    skidGain.gain.value = 0.0001;
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1800;
    skidFilter.Q.value = 0.8;
    skidSrc.connect(skidGain);
    skidGain.connect(skidFilter);

    const chain = createSpatialChain(ctx, listener, position);
    lp.connect(chain.input);
    skidFilter.connect(chain.input);
    chain.panner.connect(destBus);

    osc1.start();
    osc2.start();
    skidSrc.start();

    this.osc1 = osc1;
    this.osc2 = osc2;
    this.engineGain = engineGain;
    this.lp = lp;
    this.skidSrc = skidSrc;
    this.skidGain = skidGain;
    this.skidFilter = skidFilter;
    this.panner = chain.panner;
    this.lastLoad01 = 0;
    this.idleFor = 0;
    this.disposed = false;
  }

  update({ rpm01 = 0, load01 = 0, position, active = true }, dt) {
    const t = this.ctx.currentTime;
    const r = clamp01(rpm01);
    const l = clamp01(load01);

    const baseFreq = lerp(38, 190, r);
    this.osc1.frequency.setTargetAtTime(baseFreq, t, 0.05);
    this.osc2.frequency.setTargetAtTime(baseFreq * 1.02, t, 0.05);
    this.lp.frequency.setTargetAtTime(lerp(300, 3200, l), t, 0.08);

    const targetGain = active ? lerp(0.05, 0.32, r) * lerp(0.7, 1.0, l) : 0.0001;
    this.engineGain.gain.setTargetAtTime(Math.max(0.0001, targetGain), t, active ? 0.08 : 0.3);

    // Skid heuristic: a sudden load change without a matching rpm change reads
    // as the tyres losing grip rather than the engine actually revving.
    const loadDelta = Math.abs(l - this.lastLoad01) / Math.max(dt, 1 / 120);
    this.lastLoad01 = l;
    const skidIntensity = clamp01((loadDelta - 0.6) / 2.0) * (1 - Math.abs(r - 0.5) * 0.4);
    const skidTarget = active ? skidIntensity * 0.3 : 0.0001;
    this.skidGain.gain.setTargetAtTime(Math.max(0.0001, skidTarget), t, 0.05);

    if (position) updateChainPosition(this.panner, this.ctx, position);

    if (active) this.idleFor = 0;
    else this.idleFor += dt;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of [this.osc1, this.osc2, this.skidSrc]) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of [this.osc1, this.osc2, this.engineGain, this.lp, this.skidSrc, this.skidGain, this.skidFilter, this.panner]) {
      try {
        n.disconnect();
      } catch {
        /* fine */
      }
    }
  }
}

export class VehicleEngineManager {
  constructor(sc) {
    this.sc = sc;
    this.chains = new Map();
    this.positions = new Map();
  }

  set(vehicleId, params) {
    const { ctx, listener, buses, bank } = this.sc;
    if (params.position) this.positions.set(vehicleId, params.position);
    let chain = this.chains.get(vehicleId);
    if (!chain) {
      if (!params.active) return; // never create a chain just to immediately idle it out
      chain = new EngineChain(ctx, listener, buses.world, bank, params.position);
      this.chains.set(vehicleId, chain);
    }
    chain.update(params, this._lastDt ?? 1 / 60);
  }

  /** Housekeeping: tear down engines that have been inactive past IDLE_TIMEOUT. */
  update(dt) {
    this._lastDt = dt;
    for (const [id, chain] of this.chains) {
      if (chain.idleFor > IDLE_TIMEOUT) {
        chain.dispose();
        this.chains.delete(id);
      }
    }
  }

  /** Best-effort position for vehicle.impact/.rolled/.flipped, which carry no position of their own. */
  lastPosition(vehicleId) {
    return this.positions.get(vehicleId) ?? null;
  }

  dispose() {
    for (const chain of this.chains.values()) chain.dispose();
    this.chains.clear();
    this.positions.clear();
  }
}

export function playVehicleImpact(sc, relativeSpeed, position) {
  const t = clamp01((relativeSpeed ?? 4) / 18);
  const voice = acquireComposite(sc, Priority.VEHICLE_IMPACT, 'world');
  if (!voice) return;
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.VEHICLE_IMPACT,
    position,
    buffer: sc.bank.get('darkMed'),
    gain: lerp(0.3, 0.95, t),
    attack: 0.001,
    hold: 0.02,
    release: lerp(0.15, 0.4, t),
    filter: { type: 'lowpass', frequency: lerp(500, 200, t), Q: 0.5 },
  });
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.VEHICLE_IMPACT,
    position,
    type: 'square',
    freqFrom: lerp(180, 90, t),
    time: 0.12,
    gain: lerp(0.15, 0.4, t),
  });
}

export function playVehicleRollover(sc, position) {
  const voice = acquireComposite(sc, Priority.VEHICLE_ROLLOVER, 'world');
  if (!voice) return;
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.VEHICLE_ROLLOVER,
    position,
    buffer: sc.bank.get('darkLong'),
    gain: 0.6,
    attack: 0.02,
    hold: 0.2,
    release: 0.8,
    filter: { type: 'lowpass', frequency: 350, Q: 0.4 },
  });
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.VEHICLE_ROLLOVER,
    position,
    buffer: sc.bank.get('crackleLong'),
    gain: 0.3,
    attack: 0.01,
    hold: 0.1,
    release: 0.5,
    filter: { type: 'bandpass', frequency: 900, Q: 0.7 },
  });
}

export function playVehicleDestroyed(sc, position) {
  const voice = acquireComposite(sc, Priority.VEHICLE_ROLLOVER, 'world');
  if (!voice) return;
  playOscShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.VEHICLE_ROLLOVER,
    position,
    type: 'sine',
    freqFrom: 90,
    freqTo: 30,
    time: 0.8,
    gain: 0.9,
  });
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority: Priority.VEHICLE_ROLLOVER,
    position,
    buffer: sc.bank.get('whiteLong'),
    gain: 0.7,
    attack: 0.005,
    hold: 0.15,
    release: 1.2,
    filter: { type: 'lowpass', frequency: 700, Q: 0.5 },
  });
}
