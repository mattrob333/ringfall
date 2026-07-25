// L3 audio — weapon fire synthesis. One distinct voice per weapon id, per the
// SOUNDS brief. Every shot gets micro pitch/gain jitter from rng('audio') so a
// sustained-fire weapon doesn't machine-gun the exact same sample.

import { Priority } from '../constants.js';
import { createSpatialChain } from '../spatial.js';
import { acquireComposite, playBufferShot, playOscShot } from './helpers.js';

function jitter(sc, spread = 0.04) {
  return 1 + (sc.rng.next() * 2 - 1) * spread;
}

// Charge-whine state lives on the synthesis context (sc.chargeState), NOT at
// module scope — a module-level Map would leak across separate AudioEngine
// instances (e.g. two engines constructed in a test).
function chargeMap(sc) {
  if (!sc.chargeState) sc.chargeState = new Map();
  return sc.chargeState;
}

function chargeKey(ownerId, weaponId) {
  return `${ownerId}:${weaponId}`;
}

/** weapon.fired dispatch. `position` is null for the local player (dry, unspatialized). */
export function playWeaponFire(sc, payload, position) {
  const { weaponId } = payload;
  const bus = 'weapons';
  const priority = position ? Priority.WEAPON_AI : Priority.WEAPON_PLAYER;
  const bank = sc.bank;

  switch (weaponId) {
    case 'cadence_ar': {
      const voice = acquireComposite(sc, priority, bus);
      if (!voice) return;
      playBufferShot(sc, {
        voice,
        bus,
        priority,
        position,
        buffer: bank.get('darkShort'),
        gain: 0.85,
        attack: 0.001,
        hold: 0.008,
        release: 0.055,
        playbackRate: jitter(sc),
        filter: { type: 'bandpass', frequency: 950, Q: 1.0 },
      });
      playOscShot(sc, {
        voice,
        bus,
        priority,
        position,
        type: 'square',
        freqFrom: 260 * jitter(sc, 0.02),
        freqTo: 130,
        time: 0.05,
        gain: 0.28,
      });
      return;
    }

    case 'vector_br': {
      const voice = acquireComposite(sc, priority, bus);
      if (!voice) return;
      playBufferShot(sc, {
        voice,
        bus,
        priority,
        position,
        buffer: bank.get('whiteShort'),
        gain: 0.95,
        attack: 0.0008,
        hold: 0.004,
        release: 0.04,
        playbackRate: jitter(sc, 0.05),
        filter: { type: 'bandpass', frequency: 2200, Q: 1.5 },
      });
      playOscShot(sc, {
        voice,
        bus,
        priority,
        position,
        type: 'sawtooth',
        freqFrom: 520 * jitter(sc, 0.02),
        freqTo: 240,
        time: 0.035,
        gain: 0.22,
      });
      return;
    }

    case 'longbow': {
      const voice = acquireComposite(sc, priority, bus);
      if (!voice) return;
      playBufferShot(sc, {
        voice,
        bus,
        priority,
        position,
        buffer: bank.get('darkLong'),
        gain: 1.0,
        attack: 0.001,
        hold: 0.03,
        release: 1.1,
        playbackRate: jitter(sc, 0.02),
        filter: { type: 'lowpass', frequency: 320, Q: 0.6 },
      });
      playOscShot(sc, {
        voice,
        bus,
        priority,
        position,
        type: 'sine',
        freqFrom: 92,
        freqTo: 42,
        time: 0.85,
        gain: 0.55,
        release: 0.75,
      });
      return;
    }

    case 'breaker': {
      const voice = acquireComposite(sc, priority, bus);
      if (!voice) return;
      playBufferShot(sc, {
        voice,
        bus,
        priority,
        position,
        buffer: bank.get('whiteMed'),
        gain: 1.0,
        attack: 0.001,
        hold: 0.012,
        release: 0.13,
        playbackRate: jitter(sc, 0.03),
        filter: { type: 'lowpass', frequency: 480, Q: 0.5 },
      });
      playOscShot(sc, {
        voice,
        bus,
        priority,
        position,
        type: 'sine',
        freqFrom: 68,
        time: 0.16,
        gain: 0.4,
      });
      return;
    }

    case 'ember_repeater': {
      const voice = acquireComposite(sc, priority, bus);
      if (!voice) return;
      playOscShot(sc, {
        voice,
        bus,
        priority,
        position,
        type: 'sawtooth',
        freqFrom: 950 * jitter(sc, 0.04),
        freqTo: 480,
        time: 0.1,
        gain: 0.5,
      });
      playBufferShot(sc, {
        voice,
        bus,
        priority,
        position,
        buffer: bank.get('whiteShort'),
        gain: 0.22,
        attack: 0.001,
        hold: 0.002,
        release: 0.03,
        filter: { type: 'bandpass', frequency: 3100, Q: 2.2 },
      });
      return;
    }

    case 'vess_sidearm': {
      const voice = acquireComposite(sc, priority, bus);
      if (!voice) return;
      playOscShot(sc, {
        voice,
        bus,
        priority,
        position,
        type: 'triangle',
        freqFrom: 1100 * jitter(sc, 0.03),
        freqTo: 1750,
        time: 0.06,
        gain: 0.45,
      });
      playBufferShot(sc, {
        voice,
        bus,
        priority,
        position,
        buffer: bank.get('whiteShort'),
        gain: 0.15,
        attack: 0.001,
        hold: 0.001,
        release: 0.02,
        filter: { type: 'highpass', frequency: 4000, Q: 0.7 },
      });
      return;
    }

    case 'ridgeback_turret': {
      const voice = acquireComposite(sc, priority, bus);
      if (!voice) return;
      playBufferShot(sc, {
        voice,
        bus,
        priority,
        position,
        buffer: bank.get('whiteMed'),
        gain: 0.85,
        attack: 0.001,
        hold: 0.01,
        release: 0.075,
        playbackRate: jitter(sc, 0.03),
        filter: { type: 'bandpass', frequency: 650, Q: 0.9 },
      });
      playOscShot(sc, {
        voice,
        bus,
        priority,
        position,
        type: 'square',
        freqFrom: 220,
        freqTo: 170,
        time: 0.045,
        gain: 0.3,
      });
      return;
    }

    default: {
      // Unknown weapon id — still make *some* sound rather than silently drop it,
      // so a newly added weapon is audible (if wrong-sounding) instead of mute.
      playBufferShot(sc, {
        bus,
        priority,
        position,
        buffer: bank.get('whiteShort'),
        gain: 0.7,
        release: 0.06,
        filter: { type: 'bandpass', frequency: 1200, Q: 1.0 },
      });
    }
  }
}

export function playDryfire(sc, position) {
  playBufferShot(sc, {
    bus: 'weapons',
    priority: Priority.WEAPON_HANDLING,
    position,
    buffer: sc.bank.get('whiteShort'),
    gain: 0.3,
    attack: 0.001,
    hold: 0,
    release: 0.02,
    filter: { type: 'highpass', frequency: 4500, Q: 0.8 },
  });
}

/** weapon.charge.start — begins a rising whine that tracks toward "full". */
export function startCharge(sc, payload, position) {
  const key = chargeKey(payload.ownerId, payload.weaponId);
  stopCharge(sc, payload.ownerId, payload.weaponId, true);

  const { ctx, pool, buses, listener } = sc;
  const voice = pool.acquire({ priority: Priority.SCOPE, bus: 'weapons' });
  if (!voice) return;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const t0 = ctx.currentTime;
  const chargeDuration = 1.2; // FEEL.md 4.2 — nominal; charge.full may arrive earlier/later.
  osc.frequency.setValueAtTime(260, t0);
  osc.frequency.exponentialRampToValueAtTime(1500, t0 + chargeDuration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(0.35, t0 + 0.08);

  osc.connect(env);
  let destBus = buses.weapons;
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
  osc.start(t0);

  chargeMap(sc).set(key, { osc, env, voice, startedAt: t0 });
}

export function chargeFull(sc, payload) {
  const key = chargeKey(payload.ownerId, payload.weaponId);
  const st = chargeMap(sc).get(key);
  if (!st) return;
  // A short resolving tick so the player knows it's ready, layered on top.
  playOscShot(sc, {
    bus: 'weapons',
    priority: Priority.SCOPE,
    type: 'sine',
    freqFrom: 1800,
    time: 0.05,
    gain: 0.3,
  });
}

/** weapon.charge.released — cut the whine, trigger the heavy release burst. */
export function releaseCharge(sc, payload, position) {
  stopCharge(sc, payload.ownerId, payload.weaponId, false);
  const voice = acquireComposite(sc, Priority.WEAPON_PLAYER, 'weapons');
  if (!voice) return;
  playOscShot(sc, {
    voice,
    bus: 'weapons',
    priority: Priority.WEAPON_PLAYER,
    position,
    type: 'sine',
    freqFrom: 160,
    freqTo: 38,
    time: 0.32,
    gain: 0.85,
  });
  playBufferShot(sc, {
    voice,
    bus: 'weapons',
    priority: Priority.WEAPON_PLAYER,
    position,
    buffer: sc.bank.get('crackleShort'),
    gain: 0.5,
    attack: 0.001,
    hold: 0.02,
    release: 0.2,
    filter: { type: 'bandpass', frequency: 2600, Q: 1.2 },
  });
}

function stopCharge(sc, ownerId, weaponId, silent) {
  const key = chargeKey(ownerId, weaponId);
  const map = chargeMap(sc);
  const st = map.get(key);
  if (!st) return;
  map.delete(key);
  const t = sc.ctx.currentTime;
  try {
    st.env.gain.cancelScheduledValues(t);
    st.env.gain.setValueAtTime(Math.max(st.env.gain.value, 0.0001), t);
    st.env.gain.exponentialRampToValueAtTime(0.0001, t + (silent ? 0.03 : 0.06));
    st.osc.stop(t + (silent ? 0.04 : 0.08));
  } catch {
    /* already stopped */
  }
  st.osc.onended = () => st.voice.signalEnd();
}

/**
 * Safety net: if an entity despawns/dies mid-charge (weapon.charge.full/
 * .released never arrives for it), its whine would otherwise hold a pool slot
 * forever. Called from index.js on entity.killed / entity.despawned.
 */
export function cancelChargesFor(sc, ownerId) {
  const map = chargeMap(sc);
  for (const key of Array.from(map.keys())) {
    if (key.startsWith(`${ownerId}:`)) {
      const weaponId = key.slice(String(ownerId).length + 1);
      stopCharge(sc, ownerId, weaponId, true);
    }
  }
}
