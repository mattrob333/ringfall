// L3 audio — shared synthesis helpers. Every sound family builds on these two
// primitives: a buffer-source one-shot (noise-based) and an oscillator one-shot
// (tone-based). Composite sounds acquire a single Voice up front and pass it
// into multiple layer calls so one audible "sound" costs one pool slot, not one
// per layer — see voicePool.js Voice.expectEnd/signalEnd.

import { createSpatialChain } from '../spatial.js';

/**
 * @param {object} sc synthesis context: {ctx, pool, buses, listener, bank, rng}
 */
export function playBufferShot(sc, opts) {
  const { ctx, pool, buses, listener } = sc;
  const {
    voice: existingVoice,
    buffer,
    bus = 'sfx',
    priority = 0,
    position = null,
    gain = 1,
    attack = 0.002,
    hold = 0,
    release = 0.08,
    playbackRate = 1,
    detune = 0,
    filter = null,
    delay = 0,
  } = opts;
  if (!buffer) return null;

  let voice = existingVoice;
  if (!voice) {
    voice = pool.acquire({ priority, bus });
    if (!voice) return null;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;
  if (src.detune) src.detune.value = detune;

  const env = ctx.createGain();
  const t0 = ctx.currentTime + Math.max(0, delay);
  const peak = Math.max(0.0001, gain);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.001, attack));
  env.gain.setValueAtTime(peak, t0 + attack + hold);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + Math.max(0.01, release));

  src.connect(env);
  let tail = env;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type ?? 'lowpass';
    f.frequency.value = filter.frequency ?? 8000;
    f.Q.value = filter.Q ?? 0.7;
    tail.connect(f);
    tail = f;
    voice.track(f);
  }

  const destBus = buses[bus] ?? buses.sfx;
  if (position) {
    const chain = createSpatialChain(ctx, listener, position);
    tail.connect(chain.input);
    chain.panner.connect(destBus);
    voice.track(chain.panner);
    voice.track(chain.input);
  } else {
    tail.connect(destBus);
  }

  voice.track(src);
  voice.track(env);

  const stopAt = t0 + attack + hold + release + 0.02;
  voice.expectEnd();
  src.onended = () => voice.signalEnd();
  try {
    src.start(t0);
    src.stop(stopAt);
  } catch {
    voice.signalEnd();
  }
  return voice;
}

export function playOscShot(sc, opts) {
  const { ctx, pool, buses, listener } = sc;
  const {
    voice: existingVoice,
    bus = 'sfx',
    priority = 0,
    position = null,
    type = 'sine',
    freqFrom,
    freqTo = freqFrom,
    time = 0.12,
    gain = 0.6,
    attack = 0.002,
    release = null,
    delay = 0,
  } = opts;

  let voice = existingVoice;
  if (!voice) {
    voice = pool.acquire({ priority, bus });
    if (!voice) return null;
  }

  const osc = ctx.createOscillator();
  osc.type = type;
  const t0 = ctx.currentTime + Math.max(0, delay);
  const f0 = Math.max(1, freqFrom);
  osc.frequency.setValueAtTime(f0, t0);
  if (freqTo !== freqFrom) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + time);
  }

  const env = ctx.createGain();
  const rel = release ?? time * 0.6;
  const peak = Math.max(0.0001, gain);
  const holdUntil = Math.max(attack, time - rel);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.001, attack));
  env.gain.setValueAtTime(peak, t0 + holdUntil);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + time);

  osc.connect(env);
  const destBus = buses[bus] ?? buses.sfx;
  if (position) {
    const chain = createSpatialChain(ctx, listener, position);
    env.connect(chain.input);
    chain.panner.connect(destBus);
    voice.track(chain.panner);
    voice.track(chain.input);
  } else {
    env.connect(destBus);
  }

  voice.track(osc);
  voice.track(env);

  voice.expectEnd();
  osc.onended = () => voice.signalEnd();
  try {
    osc.start(t0);
    osc.stop(t0 + time + 0.02);
  } catch {
    voice.signalEnd();
  }
  return voice;
}

/** Acquire a shared voice for a composite (multi-layer) sound. */
export function acquireComposite(sc, priority, bus) {
  return sc.pool.acquire({ priority, bus });
}
