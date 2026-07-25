// L4 characters — OWNER: `charart` (S4). ARCHITECTURE.md §2.1, §3.
//
// Everything here is procedurally constructed THREE.Group hierarchies of
// primitive geometry. No external models, no textures, no animation data.
//
// DESIGN PRIORITY (ART.md §5, §8): SILHOUETTE FIRST. The four Vess archetypes
// are laid out so their thresholded, bounding-box-normalised masks are pairwise
// distinct. `selftest.js` measures the §8 gate without a GPU; every dimension
// below was iterated against that measurement, not against taste.
//
// The four silhouette keys, and the geometric decision that carries each:
//
//   SKIRN   — the widest thing on the model is the DORSAL TANK CLUSTER, and it
//             sits in the top 20% of the bbox. The head hangs forward and low,
//             well under the shoulder line. Legs are spindly, so the bottom
//             45% of the mask is mostly empty. Reads as a top-heavy comma.
//   CULL    — a flat vertical BARRIER SLAB occupies one whole side of the bbox
//             for ~70% of its height, separated from the slim body by a real
//             vertical slot of negative space. Nothing else in the roster is
//             asymmetric, and nothing else has an interior void.
//   VANE    — inverted-triangle torso: full shoulder width at ~82% height
//             narrowing to a 0.26 m waist, on long thin legs. The top 11% of
//             the bbox is a FORKED CREST — two 4.5 cm blades — so the mask
//             comes to a split point. Lowest fill of the four.
//   WARDEN  — wider than tall. Pauldrons define both the bbox width AND the
//             bbox top, so the head (sunk 0.30 m below them) never reaches the
//             top of the mask. Highest fill of the four, and the only one whose
//             widest point is also its highest point.
//
// Materials come from src/materials (frozen, ART.md §3.3 Vess palette). This
// file writes no shader code. The one non-obvious trick is `emissiveMat()`:
// setting `patternScale: 0, patternRotation: 0` on Family.VESS collapses the
// analytic seam mask to a constant 1.0, which turns the shipped Vess shader
// into a uniform emissive surface. That is how glow panels, tank cores, plasma
// windows and the VANE shield shell are made without adding a shader.

import * as THREE from 'three';
import { LAYER_WORLD, LAYER_TRANSPARENT } from '../render/index.js';
import { createMaterial, Family } from '../materials/index.js';
import { VESS } from '../shared/palette.js';
import { HitRegion, SurfaceId, Archetype } from '../shared/enums.js';
import { ENEMY } from '../shared/tuning.js';

// ---------------------------------------------------------------------------
// Small math helpers (kept local so this file has no L0 name coupling beyond
// the enums/tuning tables it genuinely needs).
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Geometry cache. Characters are spawned by the dozen; every archetype of a
// given kind shares one BufferGeometry per distinct primitive size.
// ---------------------------------------------------------------------------
const _geoCache = new Map();

function cached(key, make) {
  let g = _geoCache.get(key);
  if (!g) {
    g = make();
    _geoCache.set(key, g);
  }
  return g;
}

function boxGeo(w, h, d) {
  return cached(`b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d));
}

/** Unit sphere, r = 1. Scaled per-instance — 100 tris, smooth enough for a Vess shell. */
function sphereGeo(seg = 10, rings = 6) {
  return cached(`s${seg}|${rings}`, () => new THREE.SphereGeometry(1, seg, rings));
}

function cylGeo(rTop, rBot, h, seg = 8) {
  return cached(`c${rTop.toFixed(3)}|${rBot.toFixed(3)}|${h.toFixed(3)}|${seg}`, () =>
    new THREE.CylinderGeometry(rTop, rBot, h, seg, 1),
  );
}

/** Triangle count of a geometry. */
function triCount(g) {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

/** Total triangles reachable from a node (visible meshes only). */
export function countTriangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh && o.visible) n += triCount(o.geometry);
  });
  return n;
}

// ---------------------------------------------------------------------------
// Materials. Built once, lazily, and shared by every character. `materials`
// (S2) owns the shader; this file only chooses parameters from the ART.md §3.3
// Vess palette.
// ---------------------------------------------------------------------------
let _mats = null;

/**
 * A uniformly emissive Vess surface.
 *
 * Family.VESS computes its emissive term as
 *   gridLine(vObjPos.y * uPatternScale + uPatternRotation, 1.6, 0.035)
 * With uPatternScale = 0 and uPatternRotation = 0 the argument is the constant
 * 0.0, gridLine() returns 1.0 everywhere, and the whole surface emits. That
 * gives a flat emissive panel out of the shipped material library with no new
 * shader and no new material family.
 */
function emissiveMat(colorHex, intensity, opts = {}) {
  return createMaterial(Family.VESS, {
    baseColor: '#0E1016',
    accentColor: '#141824',
    emissiveColor: colorHex,
    emissiveIntensity: intensity,
    emissiveSeams: 1.0,
    patternScale: 0.0,
    patternRotation: 0.0,
    roughness: 0.28,
    metalness: 0.0,
    clearcoat: 0.4,
    surfaceId: SurfaceId.ALLOY_SMOOTH,
    ...opts,
  });
}

function materials() {
  if (_mats) return _mats;
  _mats = {
    // Main shell. emissiveSeams 0: the seam period is 1.6 m in OBJECT space and
    // every part here is a sub-0.5 m primitive, so the seam line would land on
    // the centre of every single box. Character glow is authored as explicit
    // emissive parts instead, which is also what makes weak points readable.
    shell: createMaterial(Family.VESS, {
      baseColor: VESS.shellBase,
      accentColor: VESS.shellLight,
      roughness: 0.18,
      metalness: 0.1,
      clearcoat: 0.85,
      emissiveSeams: 0.0,
      surfaceId: SurfaceId.ARMOR_HARD,
    }),
    shellLight: createMaterial(Family.VESS, {
      baseColor: VESS.shellLight,
      accentColor: '#CFC4F2',
      roughness: 0.15,
      metalness: 0.08,
      clearcoat: 0.9,
      emissiveSeams: 0.0,
      surfaceId: SurfaceId.ARMOR_HARD,
    }),
    shellDeep: createMaterial(Family.VESS, {
      baseColor: VESS.shellDeep,
      accentColor: VESS.shellBase,
      roughness: 0.22,
      metalness: 0.15,
      clearcoat: 0.7,
      emissiveSeams: 0.0,
      surfaceId: SurfaceId.ARMOR_HARD,
    }),
    // Joints / soft tissue. Plasma grenades stick to FLESH (FEEL.md §4.6).
    joint: createMaterial(Family.VESS, {
      baseColor: '#2A2450',
      accentColor: VESS.shellDeep,
      roughness: 0.42,
      metalness: 0.0,
      clearcoat: 0.2,
      emissiveSeams: 0.0,
      surfaceId: SurfaceId.FLESH,
    }),
    glowCyan: emissiveMat(VESS.plasmaCyan, 2.6),
    glowViolet: emissiveMat(VESS.plasmaViolet, 2.4),
    // SKIRN methane tank: hot, and a ×3 WEAKPOINT, so it is the brightest thing
    // on the model. It must be the first thing the eye lands on.
    glowTank: emissiveMat('#FFB454', 3.4),
  };
  return _mats;
}

// ---------------------------------------------------------------------------
// Build kit
// ---------------------------------------------------------------------------
class Kit {
  constructor(layer = LAYER_WORLD) {
    this.tris = 0;
    this.layer = layer;
  }

  _place(mesh, parent, pos, rot) {
    if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    mesh.layers.set(this.layer);
    mesh.castShadow = false; // CSM is driven by layer, not per-object flags
    parent.add(mesh);
    this.tris += triCount(mesh.geometry);
    return mesh;
  }

  /** Axis-aligned box (before rot). The workhorse: 12 tris, hard bevelled read. */
  box(parent, mat, pos, size, rot) {
    return this._place(new THREE.Mesh(boxGeo(size[0], size[1], size[2]), mat), parent, pos, rot);
  }

  /** Ellipsoid from a shared unit sphere. 100 tris. */
  blob(parent, mat, pos, size, rot, seg = 10, rings = 6) {
    const m = new THREE.Mesh(sphereGeo(seg, rings), mat);
    m.scale.set(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5);
    return this._place(m, parent, pos, rot);
  }

  /** Cylinder along local +Y. */
  cyl(parent, mat, pos, rTop, rBot, h, rot, seg = 8) {
    return this._place(new THREE.Mesh(cylGeo(rTop, rBot, h, seg), mat), parent, pos, rot);
  }

  group(parent, pos, rot, name) {
    const g = new THREE.Group();
    if (name) g.name = name;
    if (pos) g.position.set(pos[0], pos[1], pos[2]);
    if (rot) g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    parent.add(g);
    return g;
  }
}

// ---------------------------------------------------------------------------
// Hitbox helper. Every hitbox owns an Object3D parented into the rig, so its
// world transform follows the animation for free — `physics` and `weapons` read
// `hb.node.matrixWorld` after `root.updateMatrixWorld()`.
// ---------------------------------------------------------------------------
function hitbox(list, parent, spec) {
  const node = new THREE.Object3D();
  node.name = `hit_${spec.name}`;
  const p = spec.offset || [0, 0, 0];
  node.position.set(p[0], p[1], p[2]);
  if (spec.rot) node.rotation.set(spec.rot[0] || 0, spec.rot[1] || 0, spec.rot[2] || 0);
  parent.add(node);
  const hb = {
    name: spec.name,
    region: spec.region,
    kind: spec.kind, // 'capsule' | 'box' | 'sphere'
    node,
    // capsule / sphere
    radius: spec.radius ?? 0,
    // capsule: half-length of the cylindrical section along the node's local +Y
    halfHeight: spec.halfHeight ?? 0,
    // box
    halfExtents: spec.halfExtents ? spec.halfExtents.slice() : [0, 0, 0],
    surfaceId: spec.surfaceId ?? SurfaceId.ARMOR_HARD,
    // Extra per-archetype damage rules (FEEL.md §6). The damage resolver owns
    // the arithmetic; these are the flags it needs to apply it.
    damageScale: spec.damageScale ?? 1.0,
    frontPlate: !!spec.frontPlate,
    barrier: !!spec.barrier,
    detonates: !!spec.detonates,
  };
  list.push(hb);
  return hb;
}

// ---------------------------------------------------------------------------
// Gait / pose tuning per archetype. Drives animateCharacter().
// ---------------------------------------------------------------------------
const GAIT = {
  SKIRN: { strideHz: 1.55, refSpeed: 3.4, legSwing: 0.72, armSwing: 0.34, bob: 0.035, lean: 0.10, sway: 0.055, idleHz: 0.62 },
  CULL: { strideHz: 1.25, refSpeed: 4.0, legSwing: 0.60, armSwing: 0.26, bob: 0.042, lean: 0.07, sway: 0.040, idleHz: 0.5 },
  VANE: { strideHz: 1.05, refSpeed: 4.6, legSwing: 0.55, armSwing: 0.30, bob: 0.055, lean: 0.05, sway: 0.030, idleHz: 0.42 },
  WARDEN: { strideHz: 0.62, refSpeed: 2.2, legSwing: 0.38, armSwing: 0.16, bob: 0.075, lean: 0.03, sway: 0.070, idleHz: 0.3 },
};

const DEATH_TIME = 1.05;
const STAGGER_TIME = 0.46;

// ===========================================================================
// SKIRN — 1.42 m, shoulder 0.52 m.
// Silhouette: the dorsal tank cluster is the widest AND highest mass. Head is
// slung forward at 0.86 m, 0.25 m under the shoulder line. Legs are 0.13 m
// wide digitigrade sticks, so the bottom 44% of the mask is mostly sky.
// ===========================================================================
function buildSkirn(kit, root, parts, hitboxes) {
  const M = materials();
  const HIP_Y = 0.62;
  const LEAN = 0.42; // rad, torso pitched forward — this is the hunch

  const pelvis = kit.group(root, [0, HIP_Y, 0], null, 'pelvis');
  parts.pelvis = pelvis;
  kit.box(pelvis, M.shellDeep, [0, 0.02, -0.01], [0.30, 0.16, 0.22]);

  // --- legs: digitigrade, short, thin -------------------------------------
  for (const s of [1, -1]) {
    const leg = kit.group(pelvis, [0.145 * s, -0.02, -0.02], null, s > 0 ? 'legL' : 'legR');
    kit.blob(leg, M.joint, [0, 0, 0], [0.15, 0.15, 0.15], null, 8, 5);
    kit.box(leg, M.shellDeep, [0, -0.17, -0.06], [0.13, 0.36, 0.15], [0.36, 0, 0]);
    const knee = kit.group(leg, [0, -0.2586, -0.11], null);
    kit.box(knee, M.shell, [0, -0.16, 0.06], [0.115, 0.34, 0.13], [-0.45, 0, 0]);
    kit.box(knee, M.shellDeep, [0, -0.298, 0.19], [0.13, 0.085, 0.26]);
    if (s > 0) parts.legL = leg;
    else parts.legR = leg;
    hitbox(hitboxes, leg, {
      name: s > 0 ? 'legL' : 'legR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.30, 0.0],
      radius: 0.10,
      halfHeight: 0.22,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }

  // --- torso: hunched oval ------------------------------------------------
  const torso = kit.group(pelvis, [0, 0.04, 0], [LEAN, 0, 0], 'torso');
  parts.torso = torso;
  kit.blob(torso, M.shellDeep, [0, 0.10, 0.0], [0.36, 0.30, 0.38]);
  kit.blob(torso, M.shell, [0, 0.32, -0.02], [0.50, 0.42, 0.46]);
  // shoulder yoke: 0.52 m exactly (ENEMY.SKIRN.shoulderWidth)
  kit.box(torso, M.shellDeep, [0, 0.42, -0.02], [0.52, 0.11, 0.26]);
  // chest window — plasma glow, hard-edged, reads at range
  kit.box(torso, M.glowCyan, [0, 0.28, 0.21], [0.16, 0.10, 0.03]);

  hitbox(hitboxes, torso, {
    name: 'torso',
    region: HitRegion.TORSO,
    kind: 'capsule',
    offset: [0, 0.24, 0],
    radius: 0.23,
    halfHeight: 0.13,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  // --- head: slung forward and LOW ---------------------------------------
  const head = kit.group(torso, [0, 0.36, 0.24], null, 'head');
  parts.head = head;
  kit.box(head, M.joint, [0, 0.02, -0.10], [0.13, 0.13, 0.13]); // neck stub
  kit.blob(head, M.shell, [0, 0, 0.03], [0.21, 0.19, 0.26]);
  kit.box(head, M.glowViolet, [0, 0.01, 0.13], [0.13, 0.045, 0.03]); // visor slit
  hitbox(hitboxes, head, {
    name: 'head',
    region: HitRegion.HEAD,
    kind: 'sphere',
    offset: [0, 0.0, 0.02],
    radius: 0.135,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  // --- DORSAL TANK CLUSTER: the silhouette key and the ×3 WEAKPOINT -------
  // Outer pair sets the bbox width (±0.415). Inner pair sets the bbox top.
  const tanks = kit.group(torso, [0, 0, 0], null, 'tanks');
  parts.tanks = tanks;
  for (const s of [1, -1]) {
    kit.cyl(tanks, M.shellDeep, [0.30 * s, 0.46, -0.18], 0.115, 0.115, 0.40, null, 8);
    kit.cyl(tanks, M.glowTank, [0.30 * s, 0.46, -0.18], 0.088, 0.088, 0.43, null, 8);
    kit.cyl(tanks, M.shellDeep, [0.135 * s, 0.468, -0.26], 0.10, 0.10, 0.40, null, 8);
    kit.cyl(tanks, M.glowTank, [0.135 * s, 0.468, -0.26], 0.074, 0.074, 0.43, null, 8);
  }
  // manifold plate tying the cluster together — geometry, not noise
  kit.box(tanks, M.shellDeep, [0, 0.30, -0.22], [0.84, 0.09, 0.20]);
  kit.box(tanks, M.shell, [0, 0.63, -0.22], [0.40, 0.07, 0.16]);
  kit.box(tanks, M.glowTank, [0, 0.30, -0.33], [0.60, 0.035, 0.03]);

  hitbox(hitboxes, tanks, {
    name: 'dorsalTank',
    region: HitRegion.WEAKPOINT,
    kind: 'box',
    offset: [0, 0.50, -0.22],
    halfExtents: [0.42, 0.24, 0.13],
    surfaceId: SurfaceId.ALLOY_SMOOTH,
    detonates: true, // 45 EXPLOSIVE in 2.2 m — FEEL.md §6
  });

  // --- arms: short, forward, holding a repeater ---------------------------
  for (const s of [1, -1]) {
    const arm = kit.group(torso, [0.255 * s, 0.40, -0.02], [0.55, 0, -0.18 * s], s > 0 ? 'armL' : 'armR');
    kit.blob(arm, M.joint, [0, 0, 0], [0.14, 0.14, 0.14], null, 8, 5);
    kit.box(arm, M.shell, [0, -0.13, 0.01], [0.105, 0.24, 0.115]);
    const elbow = kit.group(arm, [0, -0.25, 0.01], [-0.95, 0, 0]);
    kit.box(elbow, M.shellDeep, [0, -0.10, 0.0], [0.09, 0.22, 0.10]);
    kit.box(elbow, M.joint, [0, -0.21, 0.02], [0.09, 0.08, 0.11]);
    if (s > 0) parts.armL = arm;
    else parts.armR = arm;
    hitbox(hitboxes, arm, {
      name: s > 0 ? 'armL' : 'armR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.16, 0.0],
      radius: 0.085,
      halfHeight: 0.14,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }
}

// ===========================================================================
// CULL — 1.78 m, shoulder 0.61 m.
// Silhouette: a 0.44 × 1.28 m barrier slab on the character's LEFT (+X),
// separated from the body by an 0.09 m vertical slot of sky. Nothing else in
// the roster is asymmetric and nothing else has an interior void.
// ===========================================================================
function buildCull(kit, root, parts, hitboxes) {
  const M = materials();
  const C = ENEMY.CULL;
  const HIP_Y = 0.94;

  const pelvis = kit.group(root, [0, HIP_Y, 0], null, 'pelvis');
  parts.pelvis = pelvis;
  kit.box(pelvis, M.shellDeep, [0, 0.0, -0.01], [0.34, 0.20, 0.26]);

  // --- legs: upright, moderate, deliberately slim so the mask stays open --
  for (const s of [1, -1]) {
    const leg = kit.group(pelvis, [0.15 * s, -0.06, 0], null, s > 0 ? 'legL' : 'legR');
    kit.blob(leg, M.joint, [0, 0, 0], [0.17, 0.17, 0.17], null, 8, 5);
    kit.box(leg, M.shell, [0, -0.24, -0.01], [0.145, 0.46, 0.17]);
    const knee = kit.group(leg, [0, -0.412, 0], null);
    kit.box(knee, M.shellDeep, [0, -0.20, 0.01], [0.125, 0.40, 0.155]);
    kit.box(knee, M.shellDeep, [0, -0.43, 0.07], [0.14, 0.075, 0.27]);
    if (s > 0) parts.legL = leg;
    else parts.legR = leg;
    hitbox(hitboxes, leg, {
      name: s > 0 ? 'legL' : 'legR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.42, 0],
      radius: 0.105,
      halfHeight: 0.32,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }

  // --- torso: slim, slightly twisted behind the barrier -------------------
  const torso = kit.group(pelvis, [0, 0.02, 0], [0.09, 0, 0], 'torso');
  parts.torso = torso;
  kit.box(torso, M.shellDeep, [0, 0.13, 0], [0.28, 0.24, 0.24]);
  kit.blob(torso, M.shell, [0, 0.40, -0.01], [0.42, 0.36, 0.32]);
  // shoulder yoke: 0.61 m exactly (ENEMY.CULL.shoulderWidth)
  kit.box(torso, M.shellDeep, [0, 0.56, -0.02], [0.61, 0.12, 0.26]);
  kit.box(torso, M.glowCyan, [0, 0.38, 0.155], [0.10, 0.14, 0.03]);
  hitbox(hitboxes, torso, {
    name: 'torso',
    region: HitRegion.TORSO,
    kind: 'capsule',
    offset: [0, 0.34, 0],
    radius: 0.20,
    halfHeight: 0.20,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  // --- head: small, offset to +X, tops out the figure at 1.78 m ----------
  const head = kit.group(torso, [0.045, 0.668, 0.02], null, 'head');
  parts.head = head;
  kit.box(head, M.joint, [0, -0.10, 0], [0.10, 0.10, 0.10]);
  kit.box(head, M.shell, [0, 0, 0], [0.19, 0.21, 0.25]);
  kit.box(head, M.shell, [0, 0.10, -0.05], [0.15, 0.05, 0.20], [0.20, 0, 0]);
  kit.box(head, M.glowViolet, [0, 0.01, 0.128], [0.125, 0.035, 0.025]);
  hitbox(hitboxes, head, {
    name: 'head',
    region: HitRegion.HEAD,
    kind: 'sphere',
    offset: [0, 0.0, 0],
    radius: 0.125,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  // --- armR: weapon arm, tucked, sets the +X... (character's right, -X) ---
  {
    const arm = kit.group(torso, [-0.29, 0.50, 0], [-0.32, 0, 0.10], 'armR');
    parts.armR = arm;
    kit.blob(arm, M.joint, [0, 0, 0], [0.16, 0.16, 0.16], null, 8, 5);
    kit.box(arm, M.shell, [0, -0.16, 0], [0.125, 0.30, 0.135]);
    const elbow = kit.group(arm, [0, -0.31, 0], [-0.85, 0, 0]);
    kit.box(elbow, M.shellDeep, [0, -0.13, 0], [0.11, 0.28, 0.12]);
    kit.box(elbow, M.joint, [0, -0.27, 0.03], [0.10, 0.09, 0.13]);
    // side-arm held at the hip, canted forward
    kit.box(elbow, M.shellDeep, [0, -0.30, 0.20], [0.09, 0.11, 0.34]);
    kit.box(elbow, M.glowViolet, [0, -0.30, 0.37], [0.05, 0.05, 0.04]);
    hitbox(hitboxes, arm, {
      name: 'armR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.22, 0],
      radius: 0.10,
      halfHeight: 0.18,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }

  // --- armL: the barrier arm ---------------------------------------------
  // The upper arm goes OUT, the forearm is a thin bar, and the slab hangs off
  // it well outboard of the body. The 0.09 m gap between the slab's inner edge
  // (+0.40) and the shoulder yoke's outer edge (+0.305) is the interior void
  // that makes this mask unique.
  // rz = +1.30 rad swings the upper arm nearly horizontal, out to x = +0.62;
  // the forearm group cancels the rotation so the slab hangs plumb.
  const armL = kit.group(torso, [0.30, 0.52, 0.02], [0, 0, 1.3], 'armL');
  parts.armL = armL;
  kit.blob(armL, M.joint, [0, 0, 0], [0.18, 0.18, 0.18], null, 8, 5);
  kit.box(armL, M.shell, [0, -0.17, 0.02], [0.15, 0.34, 0.16]);
  const forearm = kit.group(armL, [0, -0.33, 0.02], [0, 0, -1.3]);
  kit.box(forearm, M.shellDeep, [0, -0.14, 0.08], [0.12, 0.30, 0.13]);

  // Barrier: its own group with its own transform, so `weapons` can test the
  // frontal block arc against `parts.barrier.matrixWorld` directly. Its inner
  // edge sits 0.18 m outboard of the shoulder yoke — that gap is the interior
  // void that no other archetype's mask has.
  const barrier = kit.group(forearm, [0.1, -0.3, 0.26], [0, 0, 0], 'barrier');
  parts.barrier = barrier;
  kit.box(barrier, M.shell, [0, 0, 0], [0.44, 1.28, 0.075]);
  // hard-bevelled rim + rib, all geometry (ART.md §2)
  kit.box(barrier, M.shellDeep, [0, 0.655, 0.01], [0.46, 0.07, 0.105]);
  kit.box(barrier, M.shellDeep, [0, -0.655, 0.01], [0.46, 0.07, 0.105]);
  kit.box(barrier, M.shellDeep, [0.225, 0, 0.01], [0.055, 1.30, 0.105]);
  kit.box(barrier, M.shellDeep, [-0.225, 0, 0.01], [0.055, 1.30, 0.105]);
  kit.box(barrier, M.shellDeep, [0, 0, 0.055], [0.12, 1.16, 0.05]);
  // emissive edge strip: the tell that says "this side is armoured"
  kit.box(barrier, M.glowCyan, [0.10, 0, 0.075], [0.035, 1.10, 0.02]);
  kit.box(barrier, M.glowCyan, [-0.10, 0, 0.075], [0.035, 1.10, 0.02]);

  hitbox(hitboxes, barrier, {
    name: 'barrier',
    region: HitRegion.LIMB,
    kind: 'box',
    offset: [0, 0, 0.02],
    halfExtents: [0.23, 0.65, 0.06],
    surfaceId: SurfaceId.ENERGY_BARRIER,
    barrier: true,
  });
  hitbox(hitboxes, armL, {
    name: 'armL',
    region: HitRegion.LIMB,
    kind: 'capsule',
    offset: [0, -0.22, 0.02],
    radius: 0.10,
    halfHeight: 0.18,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  return {
    node: barrier,
    arcDeg: C.barrierArcDeg,
    health: C.barrierHealth,
    kineticMult: C.barrierKineticMult,
    plasmaMult: C.barrierPlasmaMult,
    halfExtents: [0.23, 0.65, 0.06],
  };
}

// ===========================================================================
// VANE — 2.34 m, shoulder 0.78 m.
// Silhouette: inverted triangle. 0.78 m yoke at y 1.96 tapering to a 0.26 m
// waist at y 1.33, on 0.16 m legs. The top 0.26 m is a FORKED CREST of two
// 4.5 cm blades, so the mask comes to a split point over a narrow head.
// ===========================================================================
function buildVane(kit, root, parts, hitboxes) {
  const M = materials();
  const HIP_Y = 1.28;

  const pelvis = kit.group(root, [0, HIP_Y, 0], null, 'pelvis');
  parts.pelvis = pelvis;
  kit.box(pelvis, M.shellDeep, [0, 0.0, -0.01], [0.30, 0.20, 0.26]);

  // --- legs: long, digitigrade, thin -------------------------------------
  for (const s of [1, -1]) {
    const leg = kit.group(pelvis, [0.155 * s, -0.06, 0], null, s > 0 ? 'legL' : 'legR');
    kit.blob(leg, M.joint, [0, 0, 0], [0.17, 0.17, 0.17], null, 8, 5);
    kit.box(leg, M.shell, [0, -0.34, -0.05], [0.155, 0.66, 0.18], [0.22, 0, 0]);
    const knee = kit.group(leg, [0, -0.667, -0.17], null);
    kit.box(knee, M.shellDeep, [0, -0.25, 0.10], [0.12, 0.50, 0.15], [-0.28, 0, 0]);
    kit.box(knee, M.shellDeep, [0, -0.51, 0.24], [0.135, 0.085, 0.30]);
    if (s > 0) parts.legL = leg;
    else parts.legR = leg;
    hitbox(hitboxes, leg, {
      name: s > 0 ? 'legL' : 'legR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.52, -0.02],
      radius: 0.11,
      halfHeight: 0.40,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }

  // --- torso: inverted triangle, built as a widening stack ---------------
  const torso = kit.group(pelvis, [0, 0.02, 0], [0.03, 0, 0], 'torso');
  parts.torso = torso;
  kit.box(torso, M.joint, [0, 0.05, 0], [0.26, 0.20, 0.22]);
  kit.box(torso, M.shellDeep, [0, 0.22, -0.01], [0.40, 0.24, 0.26]);
  kit.blob(torso, M.shell, [0, 0.45, -0.02], [0.58, 0.30, 0.30]);
  // shoulder yoke: 0.78 m exactly (ENEMY.VANE.shoulderWidth)
  kit.box(torso, M.shell, [0, 0.60, -0.02], [0.78, 0.16, 0.28]);
  kit.box(torso, M.glowCyan, [0, 0.42, 0.15], [0.09, 0.20, 0.03]);
  kit.box(torso, M.glowCyan, [0, 0.60, 0.135], [0.56, 0.03, 0.02]);
  hitbox(hitboxes, torso, {
    name: 'torso',
    region: HitRegion.TORSO,
    kind: 'capsule',
    offset: [0, 0.36, -0.01],
    radius: 0.24,
    halfHeight: 0.22,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  // --- pauldrons: flare UP, not out. Outer edge held to ±0.49 so the mask
  // --- aspect stays at ~0.42 and A4's 0.55 spread against WARDEN survives.
  for (const s of [1, -1]) {
    const p = kit.group(torso, [0.335 * s, 0.6, -0.02], [0, 0, -0.34 * s], 'pauldron');
    kit.box(p, M.shellLight, [0.015 * s, 0.13, 0], [0.15, 0.4, 0.3]);
    kit.box(p, M.shellDeep, [0.015 * s, 0.31, 0], [0.11, 0.1, 0.24]);
    kit.box(p, M.glowViolet, [0.085 * s, 0.13, 0], [0.02, 0.32, 0.16]);
  }

  // --- head: tall, narrow, forked crest ----------------------------------
  const head = kit.group(torso, [0, 0.67, 0.03], null, 'head');
  parts.head = head;
  kit.box(head, M.joint, [0, -0.13, -0.01], [0.11, 0.13, 0.13]);
  kit.box(head, M.shell, [0, 0, 0], [0.17, 0.26, 0.27]);
  kit.box(head, M.shellDeep, [0, 0.09, 0.02], [0.185, 0.07, 0.28]);
  kit.box(head, M.glowViolet, [0, -0.02, 0.14], [0.10, 0.10, 0.025]);
  // forked crest: two blades, 4.5 cm wide, 5.5 cm apart. Top of the figure.
  for (const s of [1, -1]) {
    kit.box(head, M.shellLight, [0.055 * s, 0.238, -0.02], [0.045, 0.26, 0.11], [0, 0, -0.1 * s]);
    kit.box(head, M.glowCyan, [0.055 * s, 0.288, 0.035], [0.02, 0.14, 0.02]);
  }
  hitbox(hitboxes, head, {
    name: 'head',
    region: HitRegion.HEAD,
    kind: 'capsule',
    offset: [0, 0.02, 0],
    radius: 0.115,
    halfHeight: 0.07,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  // --- arms: slim, held close so they never define the bbox width --------
  for (const s of [1, -1]) {
    const arm = kit.group(torso, [0.375 * s, 0.58, 0], [-0.14, 0, 0.05 * s], s > 0 ? 'armL' : 'armR');
    kit.blob(arm, M.joint, [0, 0, 0], [0.16, 0.16, 0.16], null, 8, 5);
    kit.box(arm, M.shell, [0, -0.19, 0], [0.13, 0.36, 0.14]);
    const elbow = kit.group(arm, [0, -0.37, 0], [-0.55, 0, 0]);
    kit.box(elbow, M.shellDeep, [0, -0.16, 0], [0.115, 0.34, 0.125]);
    kit.box(elbow, M.joint, [0, -0.34, 0.02], [0.10, 0.09, 0.13]);
    if (s > 0) parts.armL = arm;
    else parts.armR = arm;
    hitbox(hitboxes, arm, {
      name: s > 0 ? 'armL' : 'armR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.26, 0],
      radius: 0.095,
      halfHeight: 0.22,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }

  // --- shield shell (FEEL.md §7, ART.md §8) ------------------------------
  // CONFORMAL, not a bubble. A sphere big enough to swallow the whole model
  // would erase the inverted-triangle read at 60 m and blow the A4 aspect
  // spread; this hugs the torso/head at +4 cm so the silhouette survives and
  // legibility comes from emissive intensity, which is what bloom rewards.
  const shieldMat = emissiveMat(VESS.plasmaCyan, 1.9, {
    side: THREE.DoubleSide,
    baseColor: '#1A2E4A',
    accentColor: '#1A2E4A',
  });
  shieldMat.transparent = true;
  shieldMat.blending = THREE.AdditiveBlending;
  shieldMat.depthWrite = false;

  const shield = kit.group(torso, [0, 0, 0], null, 'shield');
  parts.shield = shield;
  const shieldKit = new Kit(LAYER_TRANSPARENT);
  shieldKit.blob(shield, shieldMat, [0, 0.40, -0.01], [0.90, 0.86, 0.50], null, 12, 8);
  shieldKit.blob(shield, shieldMat, [0, 0.68, 0.02], [0.30, 0.42, 0.36], null, 10, 6);
  kit.tris += shieldKit.tris;

  hitbox(hitboxes, shield, {
    name: 'shield',
    region: HitRegion.TORSO,
    kind: 'capsule',
    offset: [0, 0.42, 0],
    radius: 0.45,
    halfHeight: 0.20,
    surfaceId: SurfaceId.SHIELD,
  });

  return { group: shield, material: shieldMat, baseIntensity: 1.9 };
}

// ===========================================================================
// WARDEN — 2.85 m, shoulder yoke 1.42 m, overall span 3.02 m.
// Silhouette: WIDER THAN TALL. The pauldrons define both the width AND the top
// of the bounding box; the head at 2.20–2.52 m never reaches it. Highest fill
// of the four, and the only archetype whose widest point is also its highest.
// ===========================================================================
function buildWarden(kit, root, parts, hitboxes) {
  const M = materials();
  const HIP_Y = 1.12;

  const pelvis = kit.group(root, [0, HIP_Y, 0], null, 'pelvis');
  parts.pelvis = pelvis;
  kit.box(pelvis, M.shellDeep, [0, 0.0, -0.01], [0.86, 0.30, 0.52]);

  // --- legs: short, massive, splayed -------------------------------------
  for (const s of [1, -1]) {
    const leg = kit.group(pelvis, [0.40 * s, -0.10, 0], null, s > 0 ? 'legL' : 'legR');
    kit.blob(leg, M.joint, [0, 0, 0], [0.40, 0.40, 0.40], null, 8, 5);
    kit.box(leg, M.shell, [0, -0.28, -0.02], [0.40, 0.56, 0.42]);
    kit.box(leg, M.shellLight, [0.16 * s, -0.24, 0.0], [0.09, 0.46, 0.36]);
    const knee = kit.group(leg, [0, -0.505, 0], null);
    kit.box(knee, M.shellDeep, [0, -0.22, 0.02], [0.34, 0.44, 0.38]);
    kit.box(knee, M.shellDeep, [0, -0.46, 0.09], [0.38, 0.11, 0.50]);
    kit.box(knee, M.glowViolet, [0, -0.20, 0.20], [0.16, 0.03, 0.02]);
    if (s > 0) parts.legL = leg;
    else parts.legR = leg;
    hitbox(hitboxes, leg, {
      name: s > 0 ? 'legL' : 'legR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.42, 0],
      radius: 0.21,
      halfHeight: 0.30,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }

  // --- torso -------------------------------------------------------------
  const torso = kit.group(pelvis, [0, 0.05, 0], [0.04, 0, 0], 'torso');
  parts.torso = torso;
  kit.box(torso, M.shellDeep, [0, 0.18, 0], [0.92, 0.36, 0.56]);
  kit.box(torso, M.shell, [0, 0.64, -0.02], [1.24, 0.62, 0.64]);
  // shoulder yoke: 1.42 m exactly (ENEMY.WARDEN.shoulderWidth)
  kit.box(torso, M.shell, [0, 1.06, -0.02], [1.42, 0.28, 0.60]);
  // FRONT PLATES: ×0.35 KINETIC (FEEL.md §6). Angled slabs, hard bevels.
  kit.box(torso, M.shellLight, [0.34, 0.62, 0.30], [0.50, 0.62, 0.10], [0, -0.22, 0]);
  kit.box(torso, M.shellLight, [-0.34, 0.62, 0.30], [0.50, 0.62, 0.10], [0, 0.22, 0]);
  kit.box(torso, M.glowViolet, [0, 0.62, 0.33], [0.05, 0.46, 0.03]);
  hitbox(hitboxes, torso, {
    name: 'torso',
    region: HitRegion.TORSO,
    kind: 'capsule',
    offset: [0, 0.60, -0.02],
    radius: 0.44,
    halfHeight: 0.34,
    surfaceId: SurfaceId.ARMOR_HARD,
  });
  hitbox(hitboxes, torso, {
    name: 'frontPlate',
    region: HitRegion.TORSO,
    kind: 'box',
    offset: [0, 0.62, 0.30],
    halfExtents: [0.60, 0.32, 0.09],
    surfaceId: SurfaceId.ARMOR_HARD,
    frontPlate: true,
    damageScale: ENEMY.WARDEN.frontPlateMult,
  });

  // --- BACK PLATE: the ×3 WEAKPOINT --------------------------------------
  const backPlate = kit.group(torso, [0, 0.70, -0.36], null, 'backPlate');
  parts.backPlate = backPlate;
  kit.box(backPlate, M.shellDeep, [0, 0, 0], [0.86, 0.66, 0.14]);
  kit.box(backPlate, M.glowTank, [0, 0, -0.045], [0.62, 0.44, 0.06]);
  kit.box(backPlate, M.shellDeep, [0, 0, -0.08], [0.30, 0.50, 0.06]);
  hitbox(hitboxes, backPlate, {
    name: 'backPlate',
    region: HitRegion.WEAKPOINT,
    kind: 'box',
    offset: [0, 0, -0.04],
    halfExtents: [0.43, 0.33, 0.10],
    surfaceId: SurfaceId.ALLOY_SMOOTH,
  });

  // --- PAULDRONS: define the bbox width (±1.51) AND the bbox top (2.85) ---
  for (const s of [1, -1]) {
    const p = kit.group(torso, [1.13 * s, 0.99, -0.02], null, 'pauldron');
    kit.box(p, M.shell, [0, 0.10, 0], [0.76, 1.14, 0.66]);
    kit.box(p, M.shellDeep, [0, 0.64, 0], [0.80, 0.10, 0.70]);
    kit.box(p, M.shellDeep, [0, 0.24, 0], [0.80, 0.09, 0.70]);
    kit.box(p, M.shellLight, [0.34 * s, 0.20, 0], [0.10, 0.86, 0.56]);
    kit.box(p, M.glowViolet, [0.39 * s, 0.20, 0], [0.02, 0.60, 0.30]);
    kit.blob(p, M.joint, [-0.36 * s, -0.30, 0], [0.44, 0.44, 0.44], null, 8, 5);
  }

  // --- head: sunk between the shoulders, top at 2.52 vs pauldron top 2.85 -
  const head = kit.group(torso, [0, 1.18, 0.04], null, 'head');
  parts.head = head;
  kit.box(head, M.shellDeep, [0, 0, 0], [0.40, 0.30, 0.42]);
  kit.box(head, M.shell, [0, 0.15, -0.04], [0.34, 0.08, 0.34]);
  kit.box(head, M.glowCyan, [0, -0.02, 0.20], [0.24, 0.05, 0.03]);
  hitbox(hitboxes, head, {
    name: 'head',
    region: HitRegion.HEAD,
    kind: 'sphere',
    offset: [0, 0.0, 0.0],
    radius: 0.21,
    surfaceId: SurfaceId.ARMOR_HARD,
  });

  // --- arms: heavy, hanging low and outboard, inside the pauldron span ---
  for (const s of [1, -1]) {
    const arm = kit.group(torso, [1.14 * s, 0.86, 0], [-0.10, 0, 0.02 * s], s > 0 ? 'armL' : 'armR');
    kit.box(arm, M.shell, [0, -0.32, 0], [0.36, 0.66, 0.40]);
    const elbow = kit.group(arm, [0, -0.64, 0], [-0.22, 0, 0]);
    kit.box(elbow, M.shellDeep, [0, -0.28, 0.02], [0.42, 0.58, 0.44]);
    kit.box(elbow, M.shellLight, [0.20 * s, -0.28, 0.02], [0.06, 0.46, 0.36]);
    kit.box(elbow, M.joint, [0, -0.62, 0.04], [0.36, 0.28, 0.40]);
    if (s > 0) parts.armL = arm;
    else parts.armR = arm;
    hitbox(hitboxes, arm, {
      name: s > 0 ? 'armL' : 'armR',
      region: HitRegion.LIMB,
      kind: 'capsule',
      offset: [0, -0.48, 0.01],
      radius: 0.20,
      halfHeight: 0.42,
      surfaceId: SurfaceId.ARMOR_HARD,
    });
  }
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------
const BUILDERS = {
  SKIRN: buildSkirn,
  CULL: buildCull,
  VANE: buildVane,
  WARDEN: buildWarden,
};

/**
 * Build one Vess archetype.
 *
 * @param {string} archetype one of 'SKIRN' | 'CULL' | 'VANE' | 'WARDEN'
 * @returns {{
 *   archetype: string,
 *   root: THREE.Group,
 *   parts: Object,
 *   hitboxes: Array,
 *   height: number,
 *   radius: number,
 *   shoulderWidth: number,
 *   triangles: number,
 *   barrier: Object|null,
 *   shield: Object|null,
 *   anim: Object,
 * }}
 *
 * The root's origin is at the FEET, on the ground plane, and the character
 * faces +Z. `radius` / `height` mirror the `ENEMY` table so the caller can
 * build a matching physics capsule without a second source of truth.
 */
export function buildCharacter(archetype) {
  const key = String(archetype).toUpperCase();
  const build = BUILDERS[key];
  if (!build) throw new Error(`[characters] unknown archetype "${archetype}"`);
  const spec = ENEMY[key];

  const root = new THREE.Group();
  root.name = `char_${key}`;
  const parts = {
    torso: null,
    head: null,
    armL: null,
    armR: null,
    legL: null,
    legR: null,
    barrier: null,
  };
  const hitboxes = [];
  const kit = new Kit(LAYER_WORLD);

  const extra = build(kit, root, parts, hitboxes) || {};

  const handle = {
    archetype: key,
    root,
    parts,
    hitboxes,
    height: spec.height,
    radius: spec.radius,
    shoulderWidth: spec.shoulderWidth,
    triangles: kit.tris,
    barrier: key === 'CULL' ? extra : null,
    shield: key === 'VANE' ? extra : null,
    gait: GAIT[key],
    anim: {
      time: 0,
      phase: 0,
      state: 'idle',
      prevState: 'idle',
      staggerT: 0,
      deathT: 0,
      speedSmooth: 0,
      aimYaw: 0,
      aimPitch: 0,
      shieldFraction: key === 'VANE' ? 1 : 0,
      shieldFlash: 0,
    },
    rest: null,
  };

  handle.rest = captureRest(parts);
  root.updateMatrixWorld(true);
  return handle;
}

/** Snapshot every animated group's authored local transform. */
function captureRest(parts) {
  const rest = {};
  for (const name of ['pelvis', 'torso', 'head', 'armL', 'armR', 'legL', 'legR', 'barrier']) {
    const n = parts[name];
    if (!n) continue;
    rest[name] = {
      px: n.position.x,
      py: n.position.y,
      pz: n.position.z,
      rx: n.rotation.x,
      ry: n.rotation.y,
      rz: n.rotation.z,
    };
  }
  return rest;
}

// ---------------------------------------------------------------------------
// Procedural animation. No keyframes, no clips, no data files: every pose is
// evaluated from (time, speed, aim, state) with trig and exponential damping.
// ---------------------------------------------------------------------------

/**
 * @param {object} handle from buildCharacter()
 * @param {object} o
 * @param {string} [o.state]  'idle' | 'walk' | 'run' | 'stagger' | 'death'
 * @param {number} [o.dt]     seconds
 * @param {number} [o.speed]  horizontal ground speed, m/s
 * @param {number} [o.aimYaw]   radians, target bearing relative to the body's facing
 * @param {number} [o.aimPitch] radians, positive = looking up
 */
export function animateCharacter(handle, o = {}) {
  const a = handle.anim;
  const g = handle.gait;
  const rest = handle.rest;
  const P = handle.parts;
  const dt = Math.max(0, o.dt ?? 0);
  const state = o.state || a.state || 'idle';
  const speed = Math.max(0, o.speed ?? 0);

  if (state !== a.prevState) {
    if (state === 'stagger') a.staggerT = STAGGER_TIME;
    if (state === 'death' && a.prevState !== 'death') a.deathT = 0;
    if (state !== 'death') a.deathT = 0;
    a.prevState = state;
  }
  a.state = state;
  a.time += dt;
  a.speedSmooth = damp(a.speedSmooth, speed, 9, dt);
  a.aimYaw = damp(a.aimYaw, clamp(o.aimYaw ?? 0, -1.4, 1.4), 7, dt);
  a.aimPitch = damp(a.aimPitch, clamp(o.aimPitch ?? 0, -0.9, 0.9), 7, dt);
  if (a.staggerT > 0) a.staggerT = Math.max(0, a.staggerT - dt);
  if (state === 'death') a.deathT = Math.min(DEATH_TIME, a.deathT + dt);

  // Gait phase advances with distance travelled, not with wall time, so a slow
  // walk never looks like a fast one played back slowly.
  const gaitAmt = clamp(a.speedSmooth / g.refSpeed, 0, 1.5);
  a.phase = (a.phase + dt * g.strideHz * TAU * (0.35 + 0.65 * gaitAmt)) % TAU;

  const walking = gaitAmt > 0.02 && state !== 'death';
  const ph = a.phase;
  const idle = Math.sin(a.time * g.idleHz * TAU);
  const idle2 = Math.sin(a.time * g.idleHz * TAU * 0.61 + 1.1);

  // stagger: a decaying 14 Hz oscillation, hard-hit on the first 120 ms
  const st = a.staggerT / STAGGER_TIME;
  const stagger = st > 0 ? Math.sin(st * 34) * st * st : 0;

  // death: 0 -> 1 over DEATH_TIME, eased so the knees give first
  const dth = a.deathT / DEATH_TIME;
  const dying = dth > 0;
  const fall = dth * dth * (3 - 2 * dth); // smoothstep

  // ---- root ---------------------------------------------------------------
  const bob = walking ? Math.abs(Math.sin(ph)) * g.bob * gaitAmt : idle * g.bob * 0.16;
  handle.root.position.y = dying ? -fall * handle.height * 0.34 : 0;
  handle.root.rotation.z = dying ? fall * 0.32 : 0;

  // ---- pelvis -------------------------------------------------------------
  if (P.pelvis && rest.pelvis) {
    const r = rest.pelvis;
    P.pelvis.position.y = r.py + bob - fall * handle.height * 0.16;
    P.pelvis.position.x = r.px + (walking ? Math.sin(ph) * g.sway * 0.5 * gaitAmt : idle2 * 0.006);
    P.pelvis.rotation.z = r.rz + (walking ? Math.sin(ph) * g.sway * 0.5 * gaitAmt : 0);
    P.pelvis.rotation.y = r.ry + (walking ? -Math.sin(ph) * 0.10 * gaitAmt : 0);
  }

  // ---- torso: aim tracking + lean + breathing ----------------------------
  if (P.torso && rest.torso) {
    const r = rest.torso;
    const aimTwist = a.aimYaw * 0.45;
    P.torso.rotation.y = r.ry + aimTwist + (walking ? Math.sin(ph) * 0.07 * gaitAmt : idle2 * 0.012);
    P.torso.rotation.x =
      r.rx +
      (walking ? g.lean * gaitAmt : 0) +
      idle * 0.018 +
      stagger * 0.16 +
      fall * 1.15;
    P.torso.rotation.z = r.rz + stagger * 0.10 + idle2 * 0.010 - fall * 0.18;
  }

  // ---- head: counter-rotates so the eye line stays on target -------------
  if (P.head && rest.head) {
    const r = rest.head;
    P.head.rotation.y = r.ry + a.aimYaw * 0.55;
    P.head.rotation.x = r.rx - a.aimPitch * 0.75 + stagger * 0.24 + fall * 0.5;
    P.head.rotation.z = r.rz + (walking ? -Math.sin(ph) * 0.03 * gaitAmt : idle * 0.02);
  }

  // ---- legs ---------------------------------------------------------------
  const legAmp = g.legSwing * gaitAmt;
  for (const [name, sign] of [
    ['legL', 1],
    ['legR', -1],
  ]) {
    const n = P[name];
    const r = rest[name];
    if (!n || !r) continue;
    const s = Math.sin(ph + (sign > 0 ? 0 : Math.PI));
    n.rotation.x = r.rx + (walking ? s * legAmp : 0) - fall * (sign > 0 ? 1.35 : 1.05);
    n.rotation.z = r.rz + (walking ? Math.cos(ph) * 0.05 * gaitAmt * sign : 0) + fall * 0.18 * sign;
  }

  // ---- arms: counter-swing, plus the aim offset on the weapon arm --------
  const armAmp = g.armSwing * gaitAmt;
  for (const [name, sign] of [
    ['armL', 1],
    ['armR', -1],
  ]) {
    const n = P[name];
    const r = rest[name];
    if (!n || !r) continue;
    const s = Math.sin(ph + (sign > 0 ? Math.PI : 0));
    // CULL's barrier arm does NOT swing: the slab is braced, which is what
    // sells "this side is covered" and keeps the silhouette stable at range.
    const braced = handle.archetype === 'CULL' && name === 'armL';
    const swing = braced ? s * armAmp * 0.12 : s * armAmp;
    n.rotation.x = r.rx + (walking ? swing : idle * 0.02) - a.aimPitch * (braced ? 0.1 : 0.35) + fall * 0.9;
    n.rotation.z = r.rz + stagger * 0.12 * sign - fall * 0.30 * sign;
  }

  // ---- barrier: braced against the aim direction -------------------------
  if (P.barrier && rest.barrier) {
    const r = rest.barrier;
    P.barrier.rotation.y = r.ry + a.aimYaw * 0.5;
    P.barrier.rotation.z = r.rz + stagger * 0.20;
    P.barrier.rotation.x = r.rx - a.aimPitch * 0.30 + fall * 0.6;
  }

  // ---- shield shell ------------------------------------------------------
  if (handle.shield) {
    a.shieldFlash = Math.max(0, a.shieldFlash - dt * 4.0);
    applyShieldUniforms(handle);
  }

  handle.root.updateMatrixWorld(true);
  return handle;
}

// ---------------------------------------------------------------------------
// VANE shield shell — FEEL.md §7 "legible at 60 m", ART.md §3.3 emissive band.
// ---------------------------------------------------------------------------
function applyShieldUniforms(handle) {
  const sh = handle.shield;
  if (!sh) return;
  const a = handle.anim;
  const f = clamp(a.shieldFraction, 0, 1);
  const flash = clamp(a.shieldFlash, 0, 1);
  sh.group.visible = f > 0.001 || flash > 0.001;
  // Base glow tracks remaining shield; a hit adds a 4x flare that decays at
  // 4/s. 1.9 base -> 9.5 at full flare, which is well over the post-exposure
  // bloom threshold of 1.0 (ART.md §7.2) so the flare blooms hard and wide.
  const intensity = sh.baseIntensity * (0.35 + 0.65 * f) * (1 + 4.0 * flash);
  sh.material.uniforms.uEmissiveIntensity.value = intensity;
  const s = 1 + 0.05 * flash;
  sh.group.scale.setScalar(s);
}

/**
 * Drive the VANE shield shell.
 * @param {object} handle
 * @param {{fraction?: number, flash01?: number}} s
 *   fraction — remaining shield 0..1, drives the steady glow and visibility.
 *   flash01  — a hit impulse 0..1; set it to 1 on `damage.applied` and this
 *              module decays it at 4/s.
 */
export function setShieldState(handle, s = {}) {
  if (!handle || !handle.shield) return handle;
  const a = handle.anim;
  if (s.fraction !== undefined) a.shieldFraction = clamp(s.fraction, 0, 1);
  if (s.flash01 !== undefined) a.shieldFlash = Math.max(a.shieldFlash, clamp(s.flash01, 0, 1));
  applyShieldUniforms(handle);
  return handle;
}

// ---------------------------------------------------------------------------
// CULL barrier arc — FEEL.md §6 / §8 F48. The weapons owner calls this to
// decide whether a KINETIC round is stopped dead.
// ---------------------------------------------------------------------------
const _bwd = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * Does the CULL barrier cover this incoming shot?
 *
 * @param {object} handle    a CULL handle
 * @param {THREE.Vector3} travelDir  the projectile's world-space direction of
 *                                   travel (pointing AWAY from the shooter).
 * @returns {boolean} true if the shot arrives inside the barrier's frontal arc.
 *
 * The arc is ENEMY.CULL.barrierArcDeg (62°) TOTAL, i.e. ±31° about the
 * barrier's world +Z face normal. Call after root.updateMatrixWorld().
 */
export function barrierBlocks(handle, travelDir) {
  if (!handle || !handle.barrier) return false;
  const node = handle.barrier.node;
  node.getWorldDirection(_bwd); // barrier's local +Z in world space
  _tmp.copy(travelDir).normalize().negate(); // direction back toward the shooter
  const cosHalf = Math.cos((handle.barrier.arcDeg * 0.5 * Math.PI) / 180);
  return _bwd.dot(_tmp) >= cosHalf;
}

/** Free every GPU resource this module allocated. Call on level teardown. */
export function disposeCharacters() {
  for (const g of _geoCache.values()) g.dispose();
  _geoCache.clear();
  if (_mats) {
    for (const m of Object.values(_mats)) m.dispose();
    _mats = null;
  }
}

export { Archetype };
