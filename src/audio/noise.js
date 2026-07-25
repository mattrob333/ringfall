// L3 audio — procedural noise/impulse buffer generation. Zero audio files.
// ARCHITECTURE.md §1: every sample originates from a runtime-filled AudioBuffer.
// Every random draw here comes from the caller's rng('audio') stream, never
// Math.random() (ARCHITECTURE.md §7.2 bans it under src/).

/**
 * Fill a mono AudioBuffer with noise run through a one-pole lowpass so it can
 * read as "filtered noise" rather than harsh full-band hiss. alpha = 1 means
 * unfiltered white noise; smaller alpha darkens it (good for thuds/bodies).
 */
export function createFilteredNoiseBuffer(ctx, rngStream, durationSec, alpha = 1) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * durationSec));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < length; i++) {
    const n = rngStream.next() * 2 - 1;
    lp += (n - lp) * alpha;
    data[i] = alpha >= 1 ? n : lp;
  }
  return buffer;
}

/**
 * Noise gated into random on/off chunks — the sputtering, crackly texture used
 * for shield break/recharge and electrical impacts. gateChance is the odds a
 * given chunk is silenced; chunkLen is samples per gate decision.
 */
export function createCrackleBuffer(ctx, rngStream, durationSec, { gateChance = 0.35, chunkLen = 24, alpha = 0.5 } = {}) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * durationSec));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let lp = 0;
  let gate = 1;
  for (let i = 0; i < length; i++) {
    if (i % chunkLen === 0) gate = rngStream.next() < gateChance ? 0 : 1;
    const n = rngStream.next() * 2 - 1;
    lp += (n - lp) * alpha;
    data[i] = lp * gate;
  }
  return buffer;
}

/**
 * Two-channel decaying filtered-noise impulse response for ConvolverNode.
 * Channels use slightly different filter coefficients so the tail is not
 * mono-collapsed in the stereo field.
 */
export function createImpulseResponse(ctx, rngStream, { duration = 1.6, decay = 3.0 } = {}) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const alpha = ch === 0 ? 0.22 : 0.19;
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      const n = rngStream.next() * 2 - 1;
      lp += (n - lp) * alpha;
      data[i] = lp * env;
    }
  }
  return buffer;
}

/**
 * A small library of pre-generated noise buffers, built once at init() so
 * hot paths (weapon fire at 600 RPM) never allocate+fill a fresh Float32Array
 * per shot. Individual synths still get per-shot variation from playbackRate/
 * detune randomization, seeded by rng('audio').
 */
export class NoiseBank {
  constructor(ctx, rngStream) {
    this.buffers = {
      whiteShort: createFilteredNoiseBuffer(ctx, rngStream, 0.18, 1.0),
      whiteMed: createFilteredNoiseBuffer(ctx, rngStream, 0.5, 1.0),
      whiteLong: createFilteredNoiseBuffer(ctx, rngStream, 1.6, 1.0),
      darkShort: createFilteredNoiseBuffer(ctx, rngStream, 0.22, 0.1),
      darkMed: createFilteredNoiseBuffer(ctx, rngStream, 0.6, 0.08),
      darkLong: createFilteredNoiseBuffer(ctx, rngStream, 2.2, 0.05),
      crackleShort: createCrackleBuffer(ctx, rngStream, 0.35, { gateChance: 0.4, chunkLen: 20 }),
      crackleLong: createCrackleBuffer(ctx, rngStream, 1.1, { gateChance: 0.45, chunkLen: 28 }),
    };
  }

  get(name) {
    return this.buffers[name];
  }
}
