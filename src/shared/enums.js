// L0 shared — pure data. No imports beyond three's math.
// Owner: orchestrator. Read-only for every other agent.

/** Drives impact FX, impact audio, decal family, footstep audio, material assignment. */
export const SurfaceId = Object.freeze({
  METAL_PAINTED: 0,
  METAL_BARE: 1,
  METAL_GRATE: 2,
  CONCRETE: 3,
  ROCK: 4,
  DIRT: 5,
  GRASS: 6,
  SAND: 7,
  GLASS: 8,
  ALLOY_SMOOTH: 9, // Vess
  ALLOY_HARD: 10, // Wrought
  ENERGY_BARRIER: 11,
  FLESH: 12,
  ARMOR_HARD: 13,
  SHIELD: 14,
  VEHICLE_HULL: 15,
  WATER: 16,
});

export const SurfaceName = Object.freeze(
  Object.fromEntries(Object.entries(SurfaceId).map(([k, v]) => [v, k])),
);

export const DamageType = Object.freeze({
  KINETIC: 0,
  PLASMA: 1,
  EXPLOSIVE: 2,
  MELEE: 3,
  EMP: 4,
  FALL: 5,
  VEHICLE: 6,
  ENVIRONMENT: 7,
});

export const HitRegion = Object.freeze({
  HEAD: 0,
  TORSO: 1,
  LIMB: 2,
  WEAKPOINT: 3,
});

export const Faction = Object.freeze({
  PLAYER: 0,
  CDF: 1,
  VESS: 2,
  WROUGHT: 3,
  NEUTRAL: 4,
});

export const Archetype = Object.freeze({
  PLAYER: 'PLAYER',
  SKIRN: 'SKIRN',
  CULL: 'CULL',
  VANE: 'VANE',
  WARDEN: 'WARDEN',
  RIDGEBACK: 'RIDGEBACK',
});

/** Which factions consider each other hostile. */
export function isHostile(a, b) {
  if (a === b) return false;
  if (a === Faction.NEUTRAL || b === Faction.NEUTRAL) return false;
  if (a === Faction.WROUGHT || b === Faction.WROUGHT) return true;
  const human = (f) => f === Faction.PLAYER || f === Faction.CDF;
  if (human(a) && human(b)) return false;
  return true;
}

/** Surfaces a plasma grenade will adhere to. */
export const STICKY_SURFACES = Object.freeze([
  SurfaceId.FLESH,
  SurfaceId.ARMOR_HARD,
  SurfaceId.VEHICLE_HULL,
]);

/** Physical response profile per surface, used by grenades and debris. */
export const SURFACE_PHYSICS = Object.freeze({
  [SurfaceId.METAL_PAINTED]: { restitution: 0.42, friction: 0.55, hardness: 0.9 },
  [SurfaceId.METAL_BARE]: { restitution: 0.45, friction: 0.5, hardness: 1.0 },
  [SurfaceId.METAL_GRATE]: { restitution: 0.34, friction: 0.7, hardness: 0.85 },
  [SurfaceId.CONCRETE]: { restitution: 0.32, friction: 0.72, hardness: 0.8 },
  [SurfaceId.ROCK]: { restitution: 0.3, friction: 0.78, hardness: 0.8 },
  [SurfaceId.DIRT]: { restitution: 0.16, friction: 0.9, hardness: 0.35 },
  [SurfaceId.GRASS]: { restitution: 0.14, friction: 0.92, hardness: 0.25 },
  [SurfaceId.SAND]: { restitution: 0.1, friction: 0.95, hardness: 0.2 },
  [SurfaceId.GLASS]: { restitution: 0.35, friction: 0.4, hardness: 0.6 },
  [SurfaceId.ALLOY_SMOOTH]: { restitution: 0.5, friction: 0.35, hardness: 0.95 },
  [SurfaceId.ALLOY_HARD]: { restitution: 0.48, friction: 0.45, hardness: 1.0 },
  [SurfaceId.ENERGY_BARRIER]: { restitution: 0.85, friction: 0.05, hardness: 1.0 },
  [SurfaceId.FLESH]: { restitution: 0.08, friction: 0.95, hardness: 0.15 },
  [SurfaceId.ARMOR_HARD]: { restitution: 0.4, friction: 0.6, hardness: 0.95 },
  [SurfaceId.SHIELD]: { restitution: 0.7, friction: 0.2, hardness: 1.0 },
  [SurfaceId.VEHICLE_HULL]: { restitution: 0.38, friction: 0.6, hardness: 0.9 },
  [SurfaceId.WATER]: { restitution: 0.05, friction: 0.99, hardness: 0.05 },
});
