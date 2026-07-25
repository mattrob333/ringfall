// L3 audio — public entry point. ARCHITECTURE.md §2.2: `audio` is a pure,
// listen-only consumer of the event bus (src/core/events.js); it emits
// nothing. Every sound is synthesized at runtime from WebAudio primitives —
// zero audio files, enforced by tools/assetguard.mjs.
//
// Imports are restricted to ../shared/* and ../core/* (ARCHITECTURE.md §3 L3).

import { events } from '../core/events.js';
import { Ev } from '../shared/events.js';
import { rng } from '../core/rng.js';
import { Archetype, HitRegion } from '../shared/enums.js';

import { BUS_NAMES } from './constants.js';
import { createAudioContext } from './context.js';
import { buildMixerGraph } from './graph.js';
import { VoicePool } from './voicePool.js';
import { NoiseBank } from './noise.js';
import { ListenerState, toXYZ } from './spatial.js';
import { GrenadeTracker } from './grenadeTracker.js';

import { playSurfaceImpact } from './synth/impacts.js';
import {
  playWeaponFire,
  playDryfire,
  startCharge,
  chargeFull,
  releaseCharge,
  cancelChargesFor,
} from './synth/weapons.js';
import {
  playShieldBroken,
  playShieldRechargeStart,
  playShieldRechargeFull,
  playMeleeSwing,
  playMeleeLanded,
  playHitConfirm,
  playKillConfirm,
} from './synth/combat.js';
import { playFootstep, playPlayerLanded, playJumpExertion } from './synth/player.js';
import {
  playReloadStart,
  playReloadEnd,
  playSwapStart,
  playSwapEnd,
  playOverheat,
  playCooled,
} from './synth/handling.js';
import { playScopeEnter, playScopeExit, playDescoped } from './synth/scope.js';
import { playVocalize } from './synth/ai.js';
import {
  playGrenadeBounced,
  playGrenadeStuck,
  playGrenadeTick,
  playGrenadeDetonated,
} from './synth/grenades.js';
import {
  VehicleEngineManager,
  playVehicleImpact,
  playVehicleRollover,
  playVehicleDestroyed,
} from './synth/vehicle.js';
import { playUiCue } from './synth/ui.js';

const TICK_RANGE = 12; // metres within which an enemy grenade starts ticking

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._ready = false;
    this._masterVolume = 1;
    this._busVolume = Object.fromEntries(BUS_NAMES.map((b) => [b, 1]));
    this._playerId = 0;
    this._grenades = new GrenadeTracker();
  }

  get ready() {
    return this._ready;
  }

  /** Must be called from a user gesture. Resolves even if WebAudio is unavailable. */
  async init() {
    if (this._ready || this._ctx) return;
    const ctx = createAudioContext();
    if (!ctx) {
      this._ready = false;
      return;
    }
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        await ctx.resume().catch(() => {});
      }
    } catch {
      /* some environments reject resume(); proceed regardless */
    }

    this._ctx = ctx;
    this._rng = rng('audio');
    this._graph = buildMixerGraph(ctx, this._rng);
    this._pool = new VoicePool(ctx);
    this._bank = new NoiseBank(ctx, this._rng);
    this._listener = new ListenerState(ctx);

    // The synthesis context threaded through every synth/*.js function.
    this._sc = {
      ctx,
      pool: this._pool,
      buses: this._graph.buses,
      listener: this._listener,
      bank: this._bank,
      rng: this._rng,
    };

    this._vehicles = new VehicleEngineManager(this._sc);
    this._ready = true;
  }

  setListener(position, forward, up) {
    if (!this._ready) return;
    this._listener.set(position, forward, up);
  }

  setMasterVolume(v) {
    this._masterVolume = v;
    if (!this._ready) return;
    this._graph.master.gain.setTargetAtTime(Math.max(0, v), this._ctx.currentTime, 0.02);
  }

  setBusVolume(bus, v) {
    if (!(bus in this._busVolume)) return;
    this._busVolume[bus] = v;
    if (!this._ready) return;
    const gainNode = this._graph.buses[bus];
    if (gainNode) gainNode.gain.setTargetAtTime(Math.max(0, v), this._ctx.currentTime, 0.02);
  }

  /** Per-frame housekeeping: vehicle engine loops, grenade proximity ticking. */
  update(dt) {
    if (!this._ready) return;
    this._vehicles.update(dt);

    this._grenades.update(dt);
    const listenerPos = this._listener.position;
    for (const item of this._grenades.items) {
      if (item.ownerId === this._playerId) continue; // only enemy grenades warn the player
      const dx = item.pos.x - listenerPos.x;
      const dy = item.pos.y - listenerPos.y;
      const dz = item.pos.z - listenerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > TICK_RANGE) continue;
      if (item.tickTimer > 0) continue;
      const urgency = 1 - Math.min(1, dist / TICK_RANGE);
      playGrenadeTick(this._sc, item.pos, urgency);
      item.tickTimer = 0.9 - urgency * 0.75; // faster ticks as it gets closer
    }
  }

  suspend() {
    if (!this._ready) return;
    this._ctx.suspend?.().catch(() => {});
  }

  resume() {
    if (!this._ready) return;
    this._ctx.resume?.().catch(() => {});
  }

  dispose() {
    if (!this._ready) {
      this._ctx = null;
      return;
    }
    this._pool.panic();
    this._vehicles.dispose();
    this._grenades.clear();
    try {
      this._ctx.close?.();
    } catch {
      /* already closed */
    }
    this._ready = false;
    this._ctx = null;
  }

  playUi(cue) {
    if (!this._ready) return;
    playUiCue(this._sc, cue);
  }

  setVehicleEngine(vehicleId, params) {
    if (!this._ready) return;
    this._vehicles.set(vehicleId, params);
  }

  panic() {
    if (!this._ready) return;
    this._pool.panic();
  }

  // -- internal: used by wireAudioEvents to record which entityId is local player.
  _setPlayerId(id) {
    this._playerId = id;
  }
  _isPlayer(id) {
    return id !== 0 && id === this._playerId;
  }
}

export const audio = new AudioEngine();

/**
 * Subscribe `engine` to the real event bus. Pure consumption — audio never
 * calls events.emit(). Returns an unsubscribe function that tears down every
 * handler registered here.
 */
export function wireAudioEvents(audioEngine) {
  const unsubs = [];
  const on = (name, fn) => unsubs.push(events.on(name, fn));

  const sc = () => audioEngine._sc;
  const ready = () => audioEngine.ready;
  const posFor = (ownerId, arr) => (audioEngine._isPlayer(ownerId) ? null : toXYZ(arr));

  on(Ev.ENTITY_SPAWNED, (p) => {
    if (p.archetype === Archetype.PLAYER) audioEngine._setPlayerId(p.entityId);
  });

  on(Ev.SURFACE_IMPACT, (p) => {
    if (!ready()) return;
    playSurfaceImpact(sc(), p, toXYZ(p.point));
  });

  on(Ev.WEAPON_FIRED, (p) => {
    if (!ready()) return;
    playWeaponFire(sc(), p, posFor(p.ownerId, p.muzzle));
  });
  on(Ev.WEAPON_DRYFIRE, () => {
    if (!ready()) return;
    // No position on this payload — always plays dry/centered.
    playDryfire(sc(), null);
  });
  on(Ev.WEAPON_RELOAD_START, (p) => {
    if (!ready()) return;
    playReloadStart(sc(), p.fromEmpty, null);
  });
  on(Ev.WEAPON_RELOAD_END, () => {
    if (!ready()) return;
    playReloadEnd(sc(), null);
  });
  on(Ev.WEAPON_SWAP_START, () => {
    if (!ready()) return;
    playSwapStart(sc(), null);
  });
  on(Ev.WEAPON_SWAP_END, () => {
    if (!ready()) return;
    playSwapEnd(sc(), null);
  });
  on(Ev.WEAPON_OVERHEAT, () => {
    if (!ready()) return;
    playOverheat(sc(), null);
  });
  on(Ev.WEAPON_COOLED, () => {
    if (!ready()) return;
    playCooled(sc(), null);
  });
  on(Ev.WEAPON_CHARGE_START, (p) => {
    if (!ready()) return;
    // No position on this payload — always plays dry/centered.
    startCharge(sc(), p, null);
  });
  on(Ev.WEAPON_CHARGE_FULL, (p) => {
    if (!ready()) return;
    chargeFull(sc(), p);
  });
  on(Ev.WEAPON_CHARGE_RELEASED, (p) => {
    if (!ready()) return;
    releaseCharge(sc(), p, null);
  });
  on(Ev.WEAPON_PICKEDUP, () => {
    if (!ready()) return;
    playUiCue(sc(), 'pickup');
  });

  on(Ev.SCOPE_ENTER, (p) => {
    if (!ready()) return;
    playScopeEnter(sc(), p.magnification);
  });
  on(Ev.SCOPE_EXIT, (p) => {
    if (!ready()) return;
    playScopeExit(sc(), p.magnification);
  });
  on(Ev.SCOPE_DESCOPED, () => {
    if (!ready()) return;
    playDescoped(sc());
  });

  on(Ev.GRENADE_THROWN, (p) => {
    if (!ready()) return;
    audioEngine._grenades.track(p);
  });
  on(Ev.GRENADE_BOUNCED, (p) => {
    if (!ready()) return;
    playGrenadeBounced(sc(), p.impactSpeed, toXYZ(p.point));
  });
  on(Ev.GRENADE_STUCK, () => {
    if (!ready()) return;
    // grenade.stuck carries a target-local point, not a world position (see
    // DEFECTS.md) — this is deliberately unspatialized so it always reads as
    // "you", matching FEEL.md's "the player MUST know they have been stuck".
    playGrenadeStuck(sc(), null);
  });
  on(Ev.GRENADE_DETONATED, (p) => {
    if (!ready()) return;
    playGrenadeDetonated(sc(), p.grenadeType, toXYZ(p.point));
  });

  on(Ev.MELEE_SWING, (p) => {
    if (!ready()) return;
    playMeleeSwing(sc(), p.durationMs, null);
  });
  on(Ev.MELEE_LANDED, (p) => {
    if (!ready()) return;
    playMeleeLanded(sc(), !!p.fromBehind, toXYZ(p.point));
  });

  on(Ev.PLAYER_FOOTSTEP, (p) => {
    if (!ready()) return;
    if (audioEngine._playerId !== 0 && p.entityId !== audioEngine._playerId) return;
    playFootstep(sc(), p.surfaceId, p.speed);
  });
  on(Ev.PLAYER_LANDED, (p) => {
    if (!ready()) return;
    if (audioEngine._playerId !== 0 && p.entityId !== audioEngine._playerId) return;
    playPlayerLanded(sc(), p.impactSpeed);
  });
  on(Ev.PLAYER_JUMPED, (p) => {
    if (!ready()) return;
    if (audioEngine._playerId !== 0 && p.entityId !== audioEngine._playerId) return;
    playJumpExertion(sc());
  });

  on(Ev.AI_VOCALIZE, (p) => {
    if (!ready()) return;
    // No position on this payload (see DEFECTS.md) — plays centered.
    playVocalize(sc(), p.archetype, null);
  });

  on(Ev.ENTITY_KILLED, (p) => {
    if (!ready()) return;
    if (audioEngine._isPlayer(p.killerId)) playKillConfirm(sc());
    cancelChargesFor(sc(), p.entityId); // safety net: don't leak a mid-charge whine
  });
  on(Ev.ENTITY_DESPAWNED, (p) => {
    if (!ready()) return;
    cancelChargesFor(sc(), p.entityId);
  });
  on(Ev.DAMAGE_APPLIED, (p) => {
    if (!ready()) return;
    if (!audioEngine._isPlayer(p.sourceId)) return;
    playHitConfirm(sc(), {
      absorbedByShield: !!p.absorbedByShield,
      isHeadshot: p.hitRegion === HitRegion.HEAD && !p.absorbedByShield,
    });
  });

  on(Ev.SHIELD_BROKEN, (p) => {
    if (!ready()) return;
    playShieldBroken(sc(), p, audioEngine._isPlayer(p.entityId), toXYZ(p.point));
  });
  on(Ev.SHIELD_RECHARGE_START, (p) => {
    if (!ready()) return;
    playShieldRechargeStart(sc(), audioEngine._isPlayer(p.entityId), null);
  });
  on(Ev.SHIELD_RECHARGE_FULL, (p) => {
    if (!ready()) return;
    playShieldRechargeFull(sc(), audioEngine._isPlayer(p.entityId), null);
  });

  on(Ev.VEHICLE_IMPACT, (p) => {
    if (!ready()) return;
    playVehicleImpact(sc(), p.relativeSpeed, audioEngine._vehicles.lastPosition(p.vehicleId));
  });
  on(Ev.VEHICLE_ROLLED, (p) => {
    if (!ready()) return;
    playVehicleRollover(sc(), audioEngine._vehicles.lastPosition(p.vehicleId));
  });
  on(Ev.VEHICLE_FLIPPED, (p) => {
    if (!ready()) return;
    playVehicleRollover(sc(), audioEngine._vehicles.lastPosition(p.vehicleId));
  });
  on(Ev.VEHICLE_DESTROYED, (p) => {
    if (!ready()) return;
    playVehicleDestroyed(sc(), toXYZ(p.position));
  });

  return () => {
    for (const un of unsubs) un();
    unsubs.length = 0;
  };
}
