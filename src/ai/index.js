// L5 ai — AiDirector. ARCHITECTURE.md §2.2 (`ai` owns `src/ai/**`), §3 (L5:
// may import L0..L4 — here: `three`, `../shared/*`, `../core/*`, `../physics/*`
// and, optionally, `../weapons/targets.js`). NOTHING from `src/render`,
// `src/characters`, `src/world`, `src/ui`, `src/fx` or `src/game` is imported,
// and nothing here constructs a mesh: this module runs headless and produces
// transforms + state for the game layer to bind to a rig.
//
// See README.md for the behaviour model, the steering approach and its honest
// limits, and the determinism argument.

import { Vector3 } from 'three';
import { Archetype, Faction, DamageType, HitRegion } from '../shared/enums.js';
import { Ev } from '../shared/events.js';
import { ENEMY, AI } from '../shared/tuning.js';
import { allocId } from '../core/ids.js';
import { AiAgent, yawToForward } from './agent.js';
import { AiState, AnimState, SQUAD_ALERT_RADIUS_SQ, ARCHETYPE_AI } from './constants.js';
import { sampleCoverPoints } from './cover.js';

export { AiAgent, AiState, AnimState };

const _v = new Vector3();
const _deathPoint = new Vector3();

/** A squad. `members` is a stable array in spawn order. */
class Squad {
  constructor(id) {
    this.id = id;
    this.members = [];
    this.leaderId = 0;
    this.leaderDead = false;
    this.alerted = false;
    this.lastKnown = new Vector3();
    this.hasLastKnown = false;
  }

  livingLeader() {
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      if (m.alive && m.archetype === Archetype.VANE) return m;
    }
    return null;
  }
}

export class AiDirector {
  /**
   * @param {{physics:object, events:object, targets?:object}} deps
   *   `targets` is the optional `../weapons/targets.js` registry
   *   (`{registerTarget, unregisterTarget}`). It is INJECTED rather than
   *   statically imported so this module boots even before the weapons owner
   *   has landed that file; call `attachTargetRegistry()` later if it arrives
   *   after construction. See README.md "Integration contract".
   */
  constructor({ physics, events, targets = null }) {
    if (!physics) throw new Error('[ai] AiDirector requires a PhysicsWorld');
    if (!events) throw new Error('[ai] AiDirector requires an event bus');
    this.physics = physics;
    this.events = events;
    this.targets = targets;

    /** Stable array, spawn order. Never a Set, never a Map. */
    this.agents = [];
    /** Stable array, creation order. */
    this.squads = [];
    this._squadIndex = new Map(); // id -> Squad. Lookup only; never iterated.
    this._agentIndex = new Map(); // entityId -> AiAgent. Lookup only.

    this.coverPoints = [];
    this._coverBuilt = false;
    this._spawnCounter = 0;

    /** Deferred work, flushed at the top of update() to keep emit depth low. */
    this._pendingLeaderDeaths = [];
    this._pendingDetonations = [];
    this._despawnQueue = [];

    this.stats = { shotsFired: 0, gracedShots: 0, intendedHits: 0, kills: 0 };

    this._unsubDamage = events.on(Ev.DAMAGE_APPLIED, (p) => this._onDamageApplied(p));
  }

  /** Late-bind the weapons target registry. */
  attachTargetRegistry(targets) {
    this.targets = targets;
    if (!targets || typeof targets.registerTarget !== 'function') return;
    for (let i = 0; i < this.agents.length; i++) this._register(this.agents[i]);
  }

  dispose() {
    if (this._unsubDamage) this._unsubDamage();
    this._unsubDamage = null;
    for (let i = this.agents.length - 1; i >= 0; i--) this.despawn(this.agents[i].entityId);
  }

  // =======================================================================
  // Spawning
  // =======================================================================
  /**
   * @param {{archetype:string, position:Vector3, squadId?:string|number, faction?:number}} spec
   * @returns {AiAgent}
   */
  spawn({ archetype, position, squadId = null, faction = Faction.VESS }) {
    if (!ENEMY[archetype]) throw new Error(`[ai] cannot spawn unknown archetype "${archetype}"`);
    const entityId = allocId();
    const agent = new AiAgent(this, {
      entityId,
      archetype,
      position: position instanceof Vector3 ? position : new Vector3(position[0], position[1], position[2]),
      squadId,
      faction,
      spawnIndex: this._spawnCounter++,
    });
    this.agents.push(agent);
    this._agentIndex.set(entityId, agent);

    if (squadId !== null && squadId !== undefined) {
      let squad = this._squadIndex.get(squadId);
      if (!squad) {
        squad = new Squad(squadId);
        this.squads.push(squad);
        this._squadIndex.set(squadId, squad);
      }
      squad.members.push(agent);
      if (archetype === Archetype.VANE && squad.leaderId === 0) squad.leaderId = entityId;
    }

    // Cover points are sampled ONCE, from the first spawn position. This is
    // raycast sampling of the static level, not a navmesh — see README.
    if (!this._coverBuilt) {
      this._coverBuilt = true;
      this.coverPoints = sampleCoverPoints(this.physics, agent.position);
    }

    this._register(agent);
    this.events.emit(Ev.ENTITY_SPAWNED, {
      entityId,
      archetype,
      faction,
      position: [agent.position.x, agent.position.y, agent.position.z],
    });
    return agent;
  }

  _register(agent) {
    const t = this.targets;
    if (!t || typeof t.registerTarget !== 'function') return;
    t.registerTarget({
      entityId: agent.entityId,
      faction: agent.faction,
      getCapsule: () => agent.getCapsule(),
      getForward: () => agent.getForward(),
      archetype: agent.archetype,
      state: agent,
    });
  }

  despawn(entityId) {
    const agent = this._agentIndex.get(entityId);
    if (!agent) return false;
    this._agentIndex.delete(entityId);

    const i = this.agents.indexOf(agent);
    if (i >= 0) this.agents.splice(i, 1); // splice preserves order — stable
    if (agent.squadId !== null && agent.squadId !== undefined) {
      const squad = this._squadIndex.get(agent.squadId);
      if (squad) {
        const j = squad.members.indexOf(agent);
        if (j >= 0) squad.members.splice(j, 1);
      }
    }
    this.physics.remove(agent.body);
    if (this.targets && typeof this.targets.unregisterTarget === 'function') {
      this.targets.unregisterTarget(entityId);
    }
    this.events.emit(Ev.ENTITY_DESPAWNED, { entityId });
    return true;
  }

  getAgent(entityId) {
    return this._agentIndex.get(entityId) ?? null;
  }

  getSquad(squadId) {
    return this._squadIndex.get(squadId) ?? null;
  }

  squadHasLivingLeader(squadId) {
    const squad = this._squadIndex.get(squadId);
    return !!(squad && squad.livingLeader());
  }

  // =======================================================================
  // Damage plumbing
  // =======================================================================
  /**
   * `damage.applied` carries `{amount, rawAmount, ...}`. We are the resolver
   * for OUR entities' two-layer state, so we re-run the raw weapon damage
   * through `resolveDamage()` after our own archetype mitigation (CULL
   * barrier, WARDEN plates). `rawAmount` is preferred when present because
   * `amount` may already be post-mitigation on the emitter's side.
   */
  _onDamageApplied(p) {
    const agent = this._agentIndex.get(p.targetId);
    if (!agent) return;
    agent.applyDamage({
      amount: p.rawAmount ?? p.amount,
      damageType: p.damageType,
      hitRegion: p.hitRegion,
      sourceId: p.sourceId,
      weaponId: p.weaponId,
      point: p.point,
      normal: p.normal,
      headMult: p.headMult,
    });
  }

  /** Direct entry point for the weapons owner (no event round-trip). */
  applyDamage(entityId, spec) {
    const agent = this._agentIndex.get(entityId);
    if (!agent) return null;
    return agent.applyDamage(spec);
  }

  /** Called by AiAgent when it dies. Queues the cascade, never nests emits. */
  _onAgentKilled(agent) {
    this.stats.kills++;
    if (agent.archetype === Archetype.VANE && agent.squadId !== null && agent.squadId !== undefined) {
      const squad = this._squadIndex.get(agent.squadId);
      if (squad && squad.leaderId === agent.entityId) {
        this._pendingLeaderDeaths.push(agent);
      }
    }
  }

  _queueTankDetonation(agent) {
    this._pendingDetonations.push({
      x: agent.position.x,
      y: agent.position.y + agent.height * 0.6,
      z: agent.position.z,
    });
  }

  /** Emit `ai.alerted` and propagate to squad-mates within AI.squadAlertRadius. */
  alert(agent, cause, targetId) {
    agent.alerted = true;
    this.events.emit(Ev.AI_ALERTED, {
      entityId: agent.entityId,
      squadId: agent.squadId,
      cause,
      targetId,
    });
    const squad = agent.squadId !== null ? this._squadIndex.get(agent.squadId) : null;
    if (!squad) return;
    squad.alerted = true;
    squad.lastKnown.copy(agent.lastKnown);
    squad.hasLastKnown = true;
    for (let i = 0; i < squad.members.length; i++) {
      const m = squad.members[i];
      if (m === agent || !m.alive || m.alerted) continue;
      const dx = m.position.x - agent.position.x;
      const dy = m.position.y - agent.position.y;
      const dz = m.position.z - agent.position.z;
      if (dx * dx + dy * dy + dz * dz > SQUAD_ALERT_RADIUS_SQ) continue;
      m.receiveSquadAlert(agent.lastKnown, targetId);
      this.events.emit(Ev.AI_ALERTED, {
        entityId: m.entityId,
        squadId: m.squadId,
        cause: 'squad',
        targetId,
      });
    }
  }

  // =======================================================================
  // Update
  // =======================================================================
  /**
   * @param {number} dt seconds
   * @param {{entityId:number, position:Vector3, velocity:Vector3, forward:Vector3,
   *          faction:number, alive:boolean, height?:number, radius?:number}} playerState
   */
  update(dt, playerState) {
    this._flushDeferred();

    const ctx = {
      physics: this.physics,
      events: this.events,
      director: this,
      threat: playerState && playerState.alive ? playerState : null,
      coverPoints: this.coverPoints,
      squadMembers: null,
    };

    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];
      const squad =
        agent.squadId !== null && agent.squadId !== undefined
          ? this._squadIndex.get(agent.squadId)
          : null;
      ctx.squadMembers = squad ? squad.members : this.agents;
      const shotsBefore = agent.lastShot;
      agent.update(dt, ctx);
      if (agent.lastShot && agent.lastShot !== shotsBefore) {
        this.stats.shotsFired++;
        if (agent.lastShot.graced) this.stats.gracedShots++;
        if (agent.lastShot.intendHit) this.stats.intendedHits++;
      }
    }
  }

  /**
   * Deferred cascade processing. Doing this at the TOP of update() rather than
   * inside the damage handler keeps the event bus's re-entrancy depth at 1
   * (`ARCHITECTURE.md` §4: handlers may not emit more than 2 levels deep) and
   * makes the ordering independent of who happened to call applyDamage.
   */
  _flushDeferred() {
    while (this._pendingLeaderDeaths.length) {
      const leader = this._pendingLeaderDeaths.shift();
      this._runPanicCascade(leader);
    }
    while (this._pendingDetonations.length) {
      const d = this._pendingDetonations.shift();
      this._detonateTank(d);
    }
    while (this._despawnQueue.length) {
      this.despawn(this._despawnQueue.shift());
    }
  }

  /**
   * FEEL.md §6 / F47 — the signature behaviour of the whole game.
   * `ai.leaderKilled` first, then every SKIRN in the squad freezes for
   * `ENEMY.SKIRN.panicFreeze` (0.8 s) before `ai.panic.start` fires and it
   * breaks formation. The per-agent timing lives in `AiAgent._tickPanic`.
   */
  _runPanicCascade(leader) {
    const squad = this._squadIndex.get(leader.squadId);
    if (!squad) return;
    squad.leaderDead = true;
    _deathPoint.copy(leader.position);

    this.events.emit(Ev.AI_LEADER_KILLED, { squadId: squad.id, leaderId: leader.entityId });

    for (let i = 0; i < squad.members.length; i++) {
      const m = squad.members[i];
      if (!m.alive || m.archetype !== Archetype.SKIRN) continue;
      // A SKIRN that never saw anything still knows where its leader fell —
      // that is what it runs away from.
      if (!m.hasLastKnown) {
        m.lastKnown.copy(_deathPoint);
        m.hasLastKnown = true;
      }
      m.beginPanic();
    }

    // Promote the next VANE, if any, so the squad can rally at 12 s.
    const next = squad.livingLeader();
    squad.leaderId = next ? next.entityId : 0;
  }

  /** SKIRN dorsal methane tank — 45 EXPLOSIVE in 2.2 m (FEEL.md §6). */
  _detonateTank(d) {
    const t = ENEMY.SKIRN;
    this.events.emit(Ev.EXPLOSION_OCCURRED, {
      point: [d.x, d.y, d.z],
      radius: t.weakpointRadius,
      energy: t.weakpointBlast,
      damageType: DamageType.EXPLOSIVE,
    });
    // Apply to our OWN entities here; anything else in radius is the concern
    // of whoever owns that entity (they consume `explosion.occurred`).
    _v.set(d.x, d.y, d.z);
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive) continue;
      const dx = a.position.x - d.x;
      const dy = a.position.y + a.height * 0.5 - d.y;
      const dz = a.position.z - d.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist >= t.weakpointRadius) continue;
      const falloff = 1 - dist / t.weakpointRadius;
      a.applyDamage({
        amount: t.weakpointBlast * falloff,
        damageType: DamageType.EXPLOSIVE,
        hitRegion: HitRegion.TORSO,
        sourceId: 0,
        sourcePosition: [d.x, d.y, d.z],
      });
    }
  }

  // =======================================================================
  // Introspection helpers (headless tools, the game layer, the self-test)
  // =======================================================================
  /** Writes a compact pose record for the rig binder. Allocation-free. */
  readPose(agent, out) {
    out.entityId = agent.entityId;
    out.archetype = agent.archetype;
    out.x = agent.position.x;
    out.y = agent.position.y;
    out.z = agent.position.z;
    out.yaw = agent.yaw;
    out.aimYaw = agent.aimYaw;
    out.aimPitch = agent.aimPitch;
    out.animState = agent.animState;
    out.speed01 = agent.speed01;
    out.state = agent.state;
    return out;
  }

  /** Unit forward for an agent, our yaw convention. */
  forwardOf(agent, out) {
    return yawToForward(agent.yaw, out ?? _v);
  }

  /** Diagnostic: how many sampled cover points the level produced. */
  get coverPointCount() {
    return this.coverPoints.length;
  }
}

export { ARCHETYPE_AI, AI, Squad };
