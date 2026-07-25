// L0 shared — frozen event names. ARCHITECTURE.md §4.
// Emitting a name not in this list throws in dev builds.

export const Ev = Object.freeze({
  // 4.1 combat
  DAMAGE_APPLIED: 'damage.applied',
  DAMAGE_REJECTED: 'damage.rejected',
  SHIELD_BROKEN: 'shield.broken',
  SHIELD_RECHARGE_START: 'shield.recharge.start',
  SHIELD_RECHARGE_FULL: 'shield.recharge.full',
  HEALTH_CHANGED: 'health.changed',
  ENTITY_SPAWNED: 'entity.spawned',
  ENTITY_KILLED: 'entity.killed',
  ENTITY_DESPAWNED: 'entity.despawned',

  // 4.2 weapons
  WEAPON_FIRED: 'weapon.fired',
  WEAPON_DRYFIRE: 'weapon.dryfire',
  WEAPON_RELOAD_START: 'weapon.reload.start',
  WEAPON_RELOAD_END: 'weapon.reload.end',
  WEAPON_SWAP_START: 'weapon.swap.start',
  WEAPON_SWAP_END: 'weapon.swap.end',
  WEAPON_OVERHEAT: 'weapon.overheat',
  WEAPON_COOLED: 'weapon.cooled',
  WEAPON_CHARGE_START: 'weapon.charge.start',
  WEAPON_CHARGE_FULL: 'weapon.charge.full',
  WEAPON_CHARGE_RELEASED: 'weapon.charge.released',
  WEAPON_DROPPED: 'weapon.dropped',
  WEAPON_PICKEDUP: 'weapon.pickedup',
  SCOPE_ENTER: 'scope.enter',
  SCOPE_EXIT: 'scope.exit',
  SCOPE_DESCOPED: 'scope.descoped',

  // 4.3 grenades and melee
  GRENADE_THROWN: 'grenade.thrown',
  GRENADE_BOUNCED: 'grenade.bounced',
  GRENADE_STUCK: 'grenade.stuck',
  GRENADE_DETONATED: 'grenade.detonated',
  MELEE_SWING: 'melee.swing',
  MELEE_LANDED: 'melee.landed',
  MELEE_WHIFFED: 'melee.whiffed',

  // 4.4 world / feedback
  SURFACE_IMPACT: 'surface.impact',
  EXPLOSION_OCCURRED: 'explosion.occurred',
  PLAYER_JUMPED: 'player.jumped',
  PLAYER_LANDED: 'player.landed',
  PLAYER_FOOTSTEP: 'player.footstep',
  PLAYER_CROUCH_CHANGED: 'player.crouch.changed',

  // 4.5 ai
  AI_ALERTED: 'ai.alerted',
  AI_LOST_TARGET: 'ai.lostTarget',
  AI_LEADER_KILLED: 'ai.leaderKilled',
  AI_PANIC_START: 'ai.panic.start',
  AI_PANIC_END: 'ai.panic.end',
  AI_VOCALIZE: 'ai.vocalize',

  // 4.6 vehicles
  VEHICLE_ENTERED: 'vehicle.entered',
  VEHICLE_EXITED: 'vehicle.exited',
  VEHICLE_IMPACT: 'vehicle.impact',
  VEHICLE_ROLLED: 'vehicle.rolled',
  VEHICLE_FLIPPED: 'vehicle.flipped',
  VEHICLE_DESTROYED: 'vehicle.destroyed',

  // 4.7 hud-only
  HUD_HITMARKER: 'hud.hitmarker',
  HUD_DAMAGE_DIRECTION: 'hud.damageDirection',
  HUD_PICKUP_PROMPT: 'hud.pickupPrompt',
  HUD_OBJECTIVE: 'hud.objective',
});

export const EVENT_NAMES = Object.freeze(new Set(Object.values(Ev)));
