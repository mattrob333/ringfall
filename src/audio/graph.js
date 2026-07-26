// L3 audio — mixer graph: buses -> reverb sends -> master limiter -> destination.
// ARCHITECTURE.md §1 audio row: one procedural convolution reverb, master limiter.

import { BUS_NAMES } from './constants.js';
import { createImpulseResponse } from './noise.js';

/**
 * @param {AudioContext} ctx
 * @param {import('../core/rng.js').Rng} rngStream
 */
export function buildMixerGraph(ctx, rngStream) {
  const master = ctx.createGain();
  // 0.5, not 1.0. Every cue is synthesized and summed through one limiter, and
  // at unity a firefight rides the limiter continuously, which is what makes
  // procedural audio read as harsh rather than loud. This is a starting point
  // set without being able to hear it — see HONEST_ASSESSMENT.md.
  master.gain.value = 0.5;

  // Master limiter — a grenade must never clip the mix.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.22;
  master.connect(limiter);
  limiter.connect(ctx.destination);

  // Two procedurally generated impulse responses. No event currently selects
  // between them (see README limitations) so 'interior' is the default.
  const reverbBuffers = {
    interior: createImpulseResponse(ctx, rngStream, { duration: 0.85, decay: 5.5 }),
    exterior: createImpulseResponse(ctx, rngStream, { duration: 2.4, decay: 2.1 }),
  };
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = reverbBuffers.interior;
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.9;
  convolver.connect(reverbReturn);
  reverbReturn.connect(master);

  const buses = {};
  const sends = {};
  for (const name of BUS_NAMES) {
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(master);
    buses[name] = gain;

    // The 'ui' bus is non-diegetic — it never goes through the room reverb.
    if (name !== 'ui') {
      const send = ctx.createGain();
      send.gain.value = 0.16;
      gain.connect(send);
      send.connect(convolver);
      sends[name] = send;
    }
  }

  function setReverbPreset(name) {
    const buf = reverbBuffers[name];
    if (buf) convolver.buffer = buf;
  }

  return { master, limiter, buses, convolver, reverbBuffers, sends, setReverbPreset };
}
