// L3 audio — shields, melee, hit/kill confirmation. FEEL.md §3 and §7:
// "shield.broken" is called out as the single most important cue in the game,
// and the kill cue must never be confused with the hitmarker cue.

import { Priority } from '../constants.js';
import { createSpatialChain } from '../spatial.js';
import { acquireComposite, playBufferShot, playOscShot } from './helpers.js';

/**
 * shield.broken — rising tone then a HARD cut (gain snapped to zero, not
 * ramped) so it reads as a pop, not a fade. Player break is pitched an octave
 * lower and gets an extra low body hit so the player can tell the difference
 * between "my shield popped" and "their shield popped" without looking at the
 * HUD, per FEEL.md §3/§7.
 */
export function playShieldBroken(sc, payload, isPlayer, position) {
  const { ctx, buses, listener } = sc;
  const priority = isPlayer ? Priority.SHIELD_BROKEN_PLAYER : Priority.SHIELD_BROKEN_ENEMY;
  const voice = sc.pool.acquire({ priority, bus: 'sfx' });
  if (!voice) return;

  const t0 = ctx.currentTime;
  const rise = isPlayer ? 0.28 : 0.2;
  const f0 = isPlayer ? 180 : 420;
  const f1 = isPlayer ? 900 : 2200;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t0 + rise);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(isPlayer ? 0.6 : 0.5, t0 + rise * 0.9);
  // The hard cut: hold, then snap to (near) zero in one sample-scale step.
  env.gain.setValueAtTime(isPlayer ? 0.6 : 0.5, t0 + rise);
  env.gain.setValueAtTime(0.0001, t0 + rise + 0.008);

  osc.connect(env);
  const destBus = buses.sfx;
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
  osc.start(t0);
  osc.stop(t0 + rise + 0.02);

  // Crackle burst right at the cut point, plus a low body thump for the player.
  playBufferShot(sc, {
    voice,
    bus: 'sfx',
    priority,
    position,
    buffer: sc.bank.get('crackleShort'),
    gain: 0.55,
    attack: 0.001,
    hold: 0.02,
    release: 0.15,
    filter: { type: 'bandpass', frequency: isPlayer ? 1400 : 2600, Q: 1.1 },
  });
  if (isPlayer) {
    playOscShot(sc, {
      voice,
      bus: 'sfx',
      priority,
      position,
      type: 'sine',
      freqFrom: 90,
      freqTo: 35,
      time: 0.3,
      gain: 0.6,
    });
  }
}

/** shield.recharge.start — the audible charge-up ramp beginning at t+4.0s (FEEL.md §3). */
export function playShieldRechargeStart(sc, isPlayer, position) {
  playOscShot(sc, {
    bus: 'sfx',
    priority: Priority.SCOPE,
    position,
    type: 'sine',
    freqFrom: isPlayer ? 240 : 500,
    freqTo: isPlayer ? 520 : 900,
    time: 1.1,
    gain: 0.22,
    attack: 0.15,
    release: 0.6,
  });
}

/** shield.recharge.full — a resolving chime. */
export function playShieldRechargeFull(sc, isPlayer, position) {
  const voice = acquireComposite(sc, Priority.SCOPE, 'sfx');
  if (!voice) return;
  playOscShot(sc, {
    voice,
    bus: 'sfx',
    priority: Priority.SCOPE,
    position,
    type: 'sine',
    freqFrom: isPlayer ? 660 : 900,
    time: 0.16,
    gain: 0.3,
  });
  playOscShot(sc, {
    voice,
    bus: 'sfx',
    priority: Priority.SCOPE,
    position,
    type: 'sine',
    freqFrom: isPlayer ? 990 : 1350,
    time: 0.22,
    gain: 0.22,
    attack: 0.08,
  });
}

export function playMeleeSwing(sc, durationMs, position) {
  const time = Math.max(0.08, (durationMs ?? 120) / 1000);
  playBufferShot(sc, {
    bus: 'world',
    priority: Priority.MELEE_SWING,
    position,
    buffer: sc.bank.get('whiteMed'),
    gain: 0.3,
    attack: time * 0.15,
    hold: time * 0.3,
    release: time * 0.5,
    filter: { type: 'bandpass', frequency: 700, Q: 0.6 },
  });
}

export function playMeleeLanded(sc, fromBehind, position) {
  const priority = fromBehind ? Priority.ASSASSINATION : Priority.MELEE_LANDED;
  const voice = acquireComposite(sc, priority, 'world');
  if (!voice) return;
  playBufferShot(sc, {
    voice,
    bus: 'world',
    priority,
    position,
    buffer: sc.bank.get('darkShort'),
    gain: 0.75,
    attack: 0.001,
    hold: 0.01,
    release: 0.12,
    filter: { type: 'lowpass', frequency: fromBehind ? 260 : 380, Q: 0.5 },
  });
  if (fromBehind) {
    // Assassination: an extra ominous low tone plus a sharp final snap so it
    // reads as unmistakably different from a routine melee hit.
    playOscShot(sc, {
      voice,
      bus: 'world',
      priority,
      position,
      type: 'sine',
      freqFrom: 130,
      freqTo: 55,
      time: 0.4,
      gain: 0.5,
    });
    playBufferShot(sc, {
      voice,
      bus: 'world',
      priority,
      position,
      buffer: sc.bank.get('whiteShort'),
      gain: 0.4,
      attack: 0.001,
      hold: 0,
      release: 0.03,
      filter: { type: 'highpass', frequency: 3500, Q: 0.8 },
    });
  } else {
    playOscShot(sc, {
      voice,
      bus: 'world',
      priority,
      position,
      type: 'triangle',
      freqFrom: 220,
      freqTo: 90,
      time: 0.14,
      gain: 0.35,
    });
  }
}

/**
 * Hit confirmation, derived from damage.applied for shots the local player
 * fired. Deliberately short and click-like — the two-note kill cue below must
 * never be confused with it.
 */
export function playHitConfirm(sc, { absorbedByShield, isHeadshot }) {
  if (isHeadshot) {
    playOscShot(sc, { bus: 'ui', priority: Priority.HIT_CONFIRM, type: 'square', freqFrom: 1600, time: 0.035, gain: 0.3 });
    playOscShot(sc, { bus: 'ui', priority: Priority.HIT_CONFIRM, type: 'square', freqFrom: 2000, time: 0.035, gain: 0.3, attack: 0.045 });
    return;
  }
  if (absorbedByShield) {
    playOscShot(sc, { bus: 'ui', priority: Priority.HIT_CONFIRM, type: 'sine', freqFrom: 2200, time: 0.05, gain: 0.22 });
    return;
  }
  playOscShot(sc, { bus: 'ui', priority: Priority.HIT_CONFIRM, type: 'triangle', freqFrom: 1200, time: 0.045, gain: 0.22 });
}

/** entity.killed, for kills the local player scored. Two-note descending, FEEL.md §7. */
export function playKillConfirm(sc) {
  const voice = acquireComposite(sc, Priority.KILL_CONFIRM, 'ui');
  if (!voice) return;
  playOscShot(sc, {
    voice,
    bus: 'ui',
    priority: Priority.KILL_CONFIRM,
    type: 'sine',
    freqFrom: 980,
    time: 0.16,
    gain: 0.4,
  });
  playOscShot(sc, {
    voice,
    bus: 'ui',
    priority: Priority.KILL_CONFIRM,
    type: 'sine',
    freqFrom: 640,
    time: 0.22,
    gain: 0.4,
    attack: 0.14,
  });
}
