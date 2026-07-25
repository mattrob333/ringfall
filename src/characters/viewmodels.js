// L4 characters — first-person weapon view models. OWNER: `charart` (S4).
//
// ART.md §6 is the spec and it is strict:
//   * Silhouette first. Every weapon has to be identifiable as a black shape.
//   * CHUNKY, OVERSIZED, READABLE. The reference era exaggerates receiver mass
//     and magazine size. These are deliberately not anatomically correct guns.
//   * Detail is GEOMETRY — rails, vents, bolts, ejection ports, carry handles,
//     hard bevels. Never a normal map and specifically never noise (§2).
//   * CDF weapons carry a small emissive ammo counter with LEGIBLE DIGITS. The
//     digits here are seven-segment displays built from 7 emissive boxes each
//     and driven by `setAmmoCounter()` — actual geometry, actually readable,
//     and a functional light source in the frame.
//   * Vess weapons show an internal plasma volume glowing through a shell.
//
// MATERIAL CHOICE — why Family.PLAIN and not Family.CDF / Family.VESS.
//   The shipped CDF and Wrought shaders evaluate their panel/bolt/stencil masks
//   from TRIPLANAR WORLD-SPACE COORDINATES (`vec3 P = vWorldPos * uPatternScale`
//   in src/materials/index.js). A view model is parented to the camera, so its
//   world position changes every time the player walks or turns, and the whole
//   panel lattice would swim across the receiver. Family.PLAIN has no
//   world-space term, so it holds still. That is exactly the right trade here,
//   because ART.md §6 requires this weapon's detail to be geometry anyway.
//   Logged for the materials owner as DEFECTS.md CHAR2.
//
//   Family.VESS is likewise avoided for the Vess shells (its `shade` term reads
//   the world normal against +Y, which drifts as the player looks around) —
//   except through createEmissiveMaterial(), where the surface is emissive-
//   dominated and the drift is invisible.
//
// LUMINANCE — ART.md §6 / P9 wants the view model's diffuse mean at L* 50-75
//   against a world mean of L* 58-72. The dominant tones here are therefore
//   `oliveLight` (#6B7350) and `deckGrey` (#767B78), NOT `oliveDrab` (#4A5138):
//   a drab-dominated weapon is the specific "30 L* darker than its world"
//   failure §6 calls out. This cannot be verified without a renderer; it is a
//   palette.mjs measurement and is flagged as unverified in the handover.

import * as THREE from 'three';
import { LAYER_VIEWMODEL } from '../render/index.js';
import { createMaterial, Family } from '../materials/index.js';
import { CDF, VESS } from '../shared/palette.js';
import { SurfaceId } from '../shared/enums.js';
import { createEmissiveMaterial } from './index.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Geometry cache (shared with nothing else; view models are small and few)
// ---------------------------------------------------------------------------
const _geo = new Map();
const cached = (k, make) => {
  let g = _geo.get(k);
  if (!g) {
    g = make();
    _geo.set(k, g);
  }
  return g;
};
const boxGeo = (w, h, d) =>
  cached(`b${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => new THREE.BoxGeometry(w, h, d));
const cylGeo = (rt, rb, h, seg) =>
  cached(`c${rt.toFixed(4)}|${rb.toFixed(4)}|${h.toFixed(4)}|${seg}`, () =>
    new THREE.CylinderGeometry(rt, rb, h, seg, 1),
  );
const triCount = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
let _m = null;
function mats() {
  if (_m) return _m;
  const plain = (color, o = {}) =>
    createMaterial(Family.PLAIN, {
      baseColor: color,
      roughness: 0.6,
      metalness: 0.15,
      surfaceId: SurfaceId.METAL_PAINTED,
      ...o,
    });
  _m = {
    olive: plain(CDF.oliveLight, { roughness: 0.64, metalness: 0.16 }),
    oliveDark: plain(CDF.oliveDrab, { roughness: 0.68, metalness: 0.14 }),
    deck: plain(CDF.deckGrey, { roughness: 0.54, metalness: 0.3, surfaceId: SurfaceId.METAL_BARE }),
    gunmetal: plain(CDF.gunmetal, { roughness: 0.42, metalness: 0.8, surfaceId: SurfaceId.METAL_BARE }),
    yellow: plain(CDF.cautionYellow, { roughness: 0.6, metalness: 0.08 }),
    orange: plain(CDF.hazardOrange, { roughness: 0.62, metalness: 0.08 }),
    // Optic glass: dark, very smooth, heavy clearcoat. No refraction — ART.md
    // §10 puts anything like that out of scope.
    glass: plain('#16262B', { roughness: 0.06, metalness: 0.0, clearcoat: 1.0, surfaceId: SurfaceId.GLASS }),
    // CDF ammo counter segments. opticCyan is the ART.md §3.2 emissive.
    counterLit: createEmissiveMaterial(CDF.opticCyan, 2.4),
    counterBack: plain('#0B0E10', { roughness: 0.5, metalness: 0.2 }),

    vessShell: plain(VESS.shellBase, { roughness: 0.18, metalness: 0.1, clearcoat: 0.85, surfaceId: SurfaceId.ALLOY_SMOOTH }),
    vessLight: plain(VESS.shellLight, { roughness: 0.15, metalness: 0.08, clearcoat: 0.9, surfaceId: SurfaceId.ALLOY_SMOOTH }),
    vessDeep: plain(VESS.shellDeep, { roughness: 0.22, metalness: 0.16, clearcoat: 0.7, surfaceId: SurfaceId.ALLOY_SMOOTH }),
  };
  return _m;
}

/** Per-weapon plasma materials, so heat/charge can drive them per instance. */
function plasmaMaterials(colorHex, baseIntensity) {
  const core = createEmissiveMaterial(colorHex, baseIntensity, { surfaceId: SurfaceId.ENERGY_BARRIER });
  const halo = createEmissiveMaterial(colorHex, baseIntensity * 0.42, {
    side: THREE.FrontSide,
    surfaceId: SurfaceId.ENERGY_BARRIER,
  });
  halo.transparent = true;
  halo.blending = THREE.AdditiveBlending;
  halo.depthWrite = false;
  return { core, halo, baseIntensity };
}

// ---------------------------------------------------------------------------
// Build kit — everything lands on LAYER_VIEWMODEL
// ---------------------------------------------------------------------------
class VmKit {
  constructor() {
    this.tris = 0;
  }
  _add(mesh, parent, pos, rot) {
    if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    mesh.layers.set(LAYER_VIEWMODEL);
    mesh.frustumCulled = false; // camera-parented; its bounds are meaningless
    parent.add(mesh);
    this.tris += triCount(mesh.geometry);
    return mesh;
  }
  box(parent, mat, pos, size, rot) {
    return this._add(new THREE.Mesh(boxGeo(size[0], size[1], size[2]), mat), parent, pos, rot);
  }
  /** Cylinder along local +Y unless `axis` says otherwise ('z' is the common one). */
  cyl(parent, mat, pos, r, len, seg = 10, axis = 'z', rot) {
    const m = new THREE.Mesh(cylGeo(r, r, len, seg), mat);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    else if (axis === 'x') m.rotation.z = Math.PI / 2;
    const g = new THREE.Group();
    g.add(m);
    m.layers.set(LAYER_VIEWMODEL);
    m.frustumCulled = false;
    this.tris += triCount(m.geometry);
    return this._addGroup(g, parent, pos, rot);
  }
  cone(parent, mat, pos, rTop, rBot, len, seg = 8, rot) {
    const m = new THREE.Mesh(cylGeo(rTop, rBot, len, seg), mat);
    m.rotation.x = Math.PI / 2;
    m.layers.set(LAYER_VIEWMODEL);
    m.frustumCulled = false;
    this.tris += triCount(m.geometry);
    const g = new THREE.Group();
    g.add(m);
    return this._addGroup(g, parent, pos, rot);
  }
  _addGroup(g, parent, pos, rot) {
    if (pos) g.position.set(pos[0], pos[1], pos[2]);
    if (rot) g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    parent.add(g);
    return g;
  }
  group(parent, pos, rot, name) {
    const g = new THREE.Group();
    if (name) g.name = name;
    return this._addGroup(g, parent, pos, rot);
  }
  _spread(axis, t) {
    if (axis === 'x') return [t, 0, 0];
    if (axis === 'y') return [0, t, 0];
    return [0, 0, t];
  }
  /** A run of thin ribs with gaps between them — a vent, made of geometry. */
  vents(parent, mat, pos, count, pitch, size, axis = 'z') {
    const g = this.group(parent, pos);
    const span = (count - 1) * pitch;
    for (let i = 0; i < count; i++) this.box(g, mat, this._spread(axis, -span * 0.5 + i * pitch), size);
    return g;
  }
  /** Bolt heads / rivet rows as real geometry (ART.md §2, §6). */
  boltRow(parent, mat, pos, count, pitch, r, axis = 'z') {
    const g = this.group(parent, pos);
    const span = (count - 1) * pitch;
    for (let i = 0; i < count; i++) {
      this.box(g, mat, this._spread(axis, -span * 0.5 + i * pitch), [r * 2, r * 2, r * 2]);
    }
    return g;
  }
}

// ---------------------------------------------------------------------------
// Seven-segment ammo counter — ART.md §6 "legible digits"
// ---------------------------------------------------------------------------
const SEG_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const SEG_PATTERNS = [
  0b0111111, // 0  a b c d e f
  0b0000110, // 1  b c
  0b1011011, // 2  a b d e g
  0b1001111, // 3  a b c d g
  0b1100110, // 4  b c f g
  0b1101101, // 5  a c d f g
  0b1111101, // 6  a c d e f g
  0b0000111, // 7  a b c
  0b1111111, // 8  all
  0b1101111, // 9  a b c d f g
];

/**
 * A digit as seven emissive boxes. 84 triangles, and it is actually a display:
 * `setAmmoCounter()` toggles `visible` per segment.
 */
function buildDigit(kit, parent, mat, w, h, t, d) {
  const g = kit.group(parent, [0, 0, 0], null, 'digit');
  const q = h * 0.25;
  const segs = {
    a: kit.box(g, mat, [0, h * 0.5, 0], [w, t, d]),
    b: kit.box(g, mat, [w * 0.5, q, 0], [t, h * 0.5 - t, d]),
    c: kit.box(g, mat, [w * 0.5, -q, 0], [t, h * 0.5 - t, d]),
    d: kit.box(g, mat, [0, -h * 0.5, 0], [w, t, d]),
    e: kit.box(g, mat, [-w * 0.5, -q, 0], [t, h * 0.5 - t, d]),
    f: kit.box(g, mat, [-w * 0.5, q, 0], [t, h * 0.5 - t, d]),
    g: kit.box(g, mat, [0, 0, 0], [w, t, d]),
  };
  g.userData.segments = segs;
  return g;
}

/**
 * CDF ammo counter: a small housing with an emissive two-digit display on the
 * face the player actually sees (the weapon's -X side).
 */
function buildCounter(kit, parent, pos, rot, digits = 2) {
  const M = mats();
  const counter = kit.group(parent, pos, rot, 'counter');
  const dw = 0.019;
  const dh = 0.03;
  const t = 0.0042;
  const pitch = dw + 0.011;
  const boardW = pitch * digits + 0.012;
  kit.box(counter, M.gunmetal, [0, 0, 0], [boardW, dh + 0.016, 0.008]);
  kit.box(counter, M.counterBack, [0, 0, 0.005], [boardW - 0.007, dh + 0.009, 0.003]);
  // hard-edged bezel, four bars, not a bevel shader
  kit.box(counter, M.deck, [0, (dh + 0.016) * 0.5, 0.004], [boardW, 0.004, 0.011]);
  kit.box(counter, M.deck, [0, -(dh + 0.016) * 0.5, 0.004], [boardW, 0.004, 0.011]);
  const list = [];
  for (let i = 0; i < digits; i++) {
    const d = buildDigit(kit, counter, M.counterLit, dw, dh, t, 0.004);
    d.position.set(-((digits - 1) * pitch) * 0.5 + i * pitch, 0, 0.009);
    list.push(d);
  }
  counter.userData.digits = list;
  counter.userData.kind = 'digits';
  return counter;
}

/**
 * Vess "counter": a vertical stack of emissive segments used as a heat or
 * battery bar. Same `counter` slot in the parts table so callers do not branch.
 */
function buildBar(kit, parent, pos, rot, segments, colorHex) {
  const M = mats();
  const bar = kit.group(parent, pos, rot, 'counter');
  const litMat = createEmissiveMaterial(colorHex, 2.4, { surfaceId: SurfaceId.ENERGY_BARRIER });
  kit.box(bar, M.vessDeep, [0, 0, 0], [0.018, segments * 0.0105 + 0.008, 0.008]);
  const list = [];
  for (let i = 0; i < segments; i++) {
    const y = -((segments - 1) * 0.0105) * 0.5 + i * 0.0105;
    list.push(kit.box(bar, litMat, [0, y, 0.005], [0.011, 0.0062, 0.004]));
  }
  bar.userData.segments = list;
  bar.userData.material = litMat;
  bar.userData.kind = 'bar';
  return bar;
}

// ===========================================================================
// CDF: Cadence AR — 32-round magazine, 600 RPM, no optic.
// Silhouette key: full-length CARRY HANDLE over a deep slab receiver, with a
// long ribbed handguard. It is the only CDF weapon with no optic on top.
// ===========================================================================
function buildCadenceAr(kit, root, parts) {
  const M = mats();
  const body = kit.group(root, [0, 0, 0], null, 'body');
  parts.body = body;

  // receiver — one deep chunky slab, hard bevels as separate chamfer strips
  kit.box(body, M.olive, [0, 0.075, -0.2], [0.086, 0.115, 0.44]);
  kit.box(body, M.oliveDark, [0, 0.138, -0.2], [0.092, 0.016, 0.44]);
  kit.box(body, M.oliveDark, [0, 0.014, -0.2], [0.092, 0.014, 0.44]);
  kit.box(body, M.deck, [0.045, 0.075, -0.2], [0.006, 0.09, 0.45]);
  kit.box(body, M.deck, [-0.045, 0.075, -0.2], [0.006, 0.09, 0.45]);
  kit.boltRow(body, M.deck, [0.046, 0.11, -0.2], 5, 0.075, 0.006);

  // ejection port — a real recess wall + a hinged dust cover
  kit.box(body, M.gunmetal, [0.047, 0.098, -0.13], [0.008, 0.038, 0.1]);
  kit.box(body, M.deck, [0.054, 0.115, -0.13], [0.006, 0.01, 0.11], [0, 0, -0.12]);

  // CARRY HANDLE: two posts and a bar. This is the silhouette.
  kit.box(body, M.oliveDark, [0, 0.168, -0.06], [0.05, 0.05, 0.028]);
  kit.box(body, M.oliveDark, [0, 0.168, -0.34], [0.05, 0.05, 0.028]);
  kit.box(body, M.olive, [0, 0.192, -0.2], [0.056, 0.022, 0.31]);
  kit.box(body, M.deck, [0, 0.205, -0.2], [0.03, 0.006, 0.28]);
  // iron sights, front and rear, inside the handle
  kit.box(body, M.gunmetal, [0, 0.176, -0.325], [0.022, 0.014, 0.008]);
  kit.box(body, M.gunmetal, [0, 0.176, -0.075], [0.014, 0.018, 0.008]);

  // handguard: ribs with real gaps = vents made of geometry
  kit.box(body, M.oliveDark, [0, 0.072, -0.5], [0.078, 0.086, 0.24]);
  kit.vents(body, M.deck, [0.041, 0.072, -0.5], 5, 0.045, [0.006, 0.06, 0.018]);
  kit.vents(body, M.deck, [-0.041, 0.072, -0.5], 5, 0.045, [0.006, 0.06, 0.018]);
  kit.box(body, M.deck, [0, 0.118, -0.5], [0.05, 0.008, 0.23]); // top rail

  // barrel + muzzle
  const muzzle = kit.group(body, [0, 0.075, -0.68], null, 'muzzle');
  parts.muzzle = muzzle;
  kit.cyl(muzzle, M.gunmetal, [0, 0, 0.04], 0.016, 0.16, 10);
  kit.box(muzzle, M.deck, [0, 0, -0.075], [0.05, 0.05, 0.075]);
  kit.vents(muzzle, M.gunmetal, [0, 0.027, -0.075], 3, 0.022, [0.052, 0.008, 0.008]);
  kit.box(muzzle, M.gunmetal, [0, 0, -0.115], [0.038, 0.038, 0.012]);

  // grip + trigger group
  kit.box(body, M.oliveDark, [0, -0.075, -0.02], [0.05, 0.16, 0.07], [0.28, 0, 0]);
  kit.box(body, M.deck, [0, -0.14, 0.0], [0.052, 0.02, 0.06], [0.28, 0, 0]);
  kit.box(body, M.gunmetal, [0, -0.02, -0.09], [0.014, 0.032, 0.014], [0.2, 0, 0]);
  kit.box(body, M.oliveDark, [0, -0.038, -0.075], [0.044, 0.008, 0.075]);

  // stock: chunky, with a cheek rest step
  kit.box(body, M.olive, [0, 0.06, 0.09], [0.072, 0.1, 0.16]);
  kit.box(body, M.oliveDark, [0, 0.118, 0.07], [0.05, 0.024, 0.12]);
  kit.box(body, M.deck, [0, 0.05, 0.175], [0.078, 0.13, 0.02]);
  kit.box(body, M.orange, [0, 0.108, 0.175], [0.04, 0.012, 0.022]);

  // OVERSIZED magazine — era signature, and the reload read
  const magazine = kit.group(body, [0, -0.1, -0.17], [0.1, 0, 0], 'magazine');
  parts.magazine = magazine;
  kit.box(magazine, M.oliveDark, [0, 0, 0], [0.058, 0.2, 0.1]);
  kit.box(magazine, M.deck, [0, 0.095, 0], [0.064, 0.02, 0.106]);
  kit.box(magazine, M.deck, [0, -0.098, 0], [0.064, 0.022, 0.106]);
  kit.vents(magazine, M.olive, [0, -0.02, 0.052], 3, 0.045, [0.046, 0.008, 0.006], 'y');
  kit.box(magazine, M.yellow, [0, 0.05, 0.052], [0.03, 0.012, 0.006]);

  // charging handle — cycles on fire
  const bolt = kit.group(body, [0.052, 0.115, -0.1], null, 'bolt');
  parts.bolt = bolt;
  kit.box(bolt, M.gunmetal, [0, 0, 0], [0.018, 0.03, 0.09]);
  kit.box(bolt, M.deck, [0.01, 0, 0.04], [0.016, 0.036, 0.016]);

  parts.counter = buildCounter(kit, body, [-0.05, 0.098, -0.12], [0, -Math.PI / 2, 0.18], 2);

  return { muzzleTipLocal: [0, 0.075, -0.8], recoil: { back: 0.05, pitch: 0.09, roll: 0.02 } };
}

// ===========================================================================
// CDF: Vector BR — 3-round burst, 36-round magazine, 2x optic.
// Silhouette key: a FAT SQUARE OPTIC BLOCK sitting proud on a boxier receiver,
// and a straight blade magazine. Reads as "rifle with a brick on it".
// ===========================================================================
function buildVectorBr(kit, root, parts) {
  const M = mats();
  const body = kit.group(root, [0, 0, 0], null, 'body');
  parts.body = body;

  kit.box(body, M.olive, [0, 0.082, -0.22], [0.092, 0.128, 0.46]);
  kit.box(body, M.oliveDark, [0, 0.152, -0.22], [0.098, 0.018, 0.46]);
  kit.box(body, M.oliveDark, [0, 0.016, -0.22], [0.098, 0.016, 0.46]);
  kit.box(body, M.deck, [0.048, 0.082, -0.22], [0.007, 0.1, 0.47]);
  kit.box(body, M.deck, [-0.048, 0.082, -0.22], [0.007, 0.1, 0.47]);
  kit.boltRow(body, M.deck, [0.05, 0.125, -0.22], 6, 0.07, 0.0065);
  kit.box(body, M.gunmetal, [0.05, 0.105, -0.16], [0.008, 0.04, 0.11]);
  kit.box(body, M.yellow, [0.052, 0.045, -0.3], [0.004, 0.012, 0.075]);

  // OPTIC: a chunky square block, not a tube. Rings, hood, lens.
  const optic = kit.group(body, [0, 0.196, -0.26], null, 'optic');
  kit.box(optic, M.oliveDark, [0, 0, 0], [0.072, 0.078, 0.26]);
  kit.box(optic, M.deck, [0, 0.043, 0], [0.078, 0.012, 0.24]);
  kit.box(optic, M.gunmetal, [0, -0.048, 0.08], [0.05, 0.03, 0.05]);
  kit.box(optic, M.gunmetal, [0, -0.048, -0.08], [0.05, 0.03, 0.05]);
  kit.box(optic, M.deck, [0, 0, -0.145], [0.084, 0.09, 0.03]); // objective hood
  kit.cyl(optic, M.glass, [0, 0, -0.158], 0.03, 0.006, 12);
  kit.cyl(optic, M.glass, [0, 0, 0.132], 0.022, 0.006, 12);
  kit.vents(optic, M.deck, [0.037, 0, 0], 4, 0.05, [0.006, 0.05, 0.014]);
  kit.vents(optic, M.deck, [-0.037, 0, 0], 4, 0.05, [0.006, 0.05, 0.014]);

  // handguard
  kit.box(body, M.oliveDark, [0, 0.078, -0.53], [0.08, 0.088, 0.22]);
  kit.vents(body, M.deck, [0, 0.126, -0.53], 4, 0.05, [0.06, 0.008, 0.016]);
  kit.vents(body, M.deck, [0.042, 0.078, -0.53], 4, 0.05, [0.006, 0.062, 0.016]);
  kit.vents(body, M.deck, [-0.042, 0.078, -0.53], 4, 0.05, [0.006, 0.062, 0.016]);

  const muzzle = kit.group(body, [0, 0.082, -0.7], null, 'muzzle');
  parts.muzzle = muzzle;
  kit.cyl(muzzle, M.gunmetal, [0, 0, 0.04], 0.018, 0.14, 10);
  kit.box(muzzle, M.deck, [0, 0, -0.06], [0.054, 0.054, 0.09]);
  kit.vents(muzzle, M.gunmetal, [0, 0, -0.06], 3, 0.026, [0.058, 0.03, 0.008]);
  kit.box(muzzle, M.gunmetal, [0, 0, -0.11], [0.042, 0.042, 0.014]);

  kit.box(body, M.oliveDark, [0, -0.076, -0.03], [0.052, 0.165, 0.072], [0.3, 0, 0]);
  kit.box(body, M.deck, [0, -0.144, -0.01], [0.054, 0.02, 0.062], [0.3, 0, 0]);
  kit.box(body, M.gunmetal, [0, -0.022, -0.1], [0.014, 0.034, 0.014], [0.2, 0, 0]);
  kit.box(body, M.oliveDark, [0, -0.042, -0.085], [0.046, 0.008, 0.08]);

  // skeleton stock: two rails and a butt plate — negative space in the read
  kit.box(body, M.deck, [0, 0.128, 0.1], [0.05, 0.018, 0.19]);
  kit.box(body, M.deck, [0, 0.032, 0.1], [0.05, 0.018, 0.19]);
  kit.box(body, M.olive, [0, 0.08, 0.185], [0.076, 0.14, 0.024]);
  kit.box(body, M.orange, [0, 0.14, 0.185], [0.04, 0.014, 0.026]);

  const magazine = kit.group(body, [0, -0.115, -0.19], [0.04, 0, 0], 'magazine');
  parts.magazine = magazine;
  kit.box(magazine, M.oliveDark, [0, 0, 0], [0.062, 0.23, 0.098]);
  kit.box(magazine, M.deck, [0, 0.11, 0], [0.068, 0.022, 0.104]);
  kit.box(magazine, M.deck, [0, -0.113, 0], [0.068, 0.024, 0.104]);
  kit.vents(magazine, M.olive, [0, -0.02, 0.051], 4, 0.048, [0.05, 0.008, 0.006], 'y');
  kit.box(magazine, M.yellow, [0, 0.062, 0.051], [0.032, 0.012, 0.006]);

  const bolt = kit.group(body, [0.055, 0.122, -0.12], null, 'bolt');
  parts.bolt = bolt;
  kit.box(bolt, M.gunmetal, [0, 0, 0], [0.02, 0.032, 0.1]);
  kit.box(bolt, M.deck, [0.012, 0, 0.045], [0.018, 0.038, 0.018]);

  parts.counter = buildCounter(kit, body, [-0.053, 0.1, -0.14], [0, -Math.PI / 2, 0.18], 2);

  return { muzzleTipLocal: [0, 0.082, -0.82], recoil: { back: 0.062, pitch: 0.12, roll: 0.025 } };
}

// ===========================================================================
// CDF: Longbow — 4-round magazine, 1.5 s refire, 2x/8x optic.
// Silhouette key: LENGTH, plus a big round scope tube with a bell objective and
// a folded bipod. The only round optic in the CDF set.
// ===========================================================================
function buildLongbow(kit, root, parts) {
  const M = mats();
  const body = kit.group(root, [0, 0, 0], null, 'body');
  parts.body = body;

  kit.box(body, M.olive, [0, 0.078, -0.2], [0.086, 0.122, 0.46]);
  kit.box(body, M.oliveDark, [0, 0.145, -0.2], [0.092, 0.018, 0.46]);
  kit.box(body, M.deck, [0.045, 0.078, -0.2], [0.007, 0.095, 0.47]);
  kit.box(body, M.deck, [-0.045, 0.078, -0.2], [0.007, 0.095, 0.47]);
  kit.boltRow(body, M.deck, [0.047, 0.118, -0.2], 6, 0.07, 0.0065);
  kit.box(body, M.gunmetal, [0.047, 0.098, -0.1], [0.008, 0.042, 0.12]);

  // ROUND optic: tube + turrets + bell. Distinct from the BR's square block.
  const optic = kit.group(body, [0, 0.2, -0.3], null, 'optic');
  kit.cyl(optic, M.oliveDark, [0, 0, 0], 0.036, 0.3, 12);
  kit.cyl(optic, M.oliveDark, [0, 0, -0.185], 0.05, 0.09, 12);
  kit.cyl(optic, M.glass, [0, 0, -0.232], 0.045, 0.008, 12);
  kit.cyl(optic, M.glass, [0, 0, 0.153], 0.028, 0.008, 12);
  kit.cyl(optic, M.deck, [0, 0.042, 0.02], 0.02, 0.03, 8, 'y');
  kit.cyl(optic, M.deck, [0.042, 0, 0.02], 0.02, 0.03, 8, 'x');
  kit.box(optic, M.deck, [0, -0.044, 0.09], [0.05, 0.036, 0.036]);
  kit.box(optic, M.deck, [0, -0.044, -0.09], [0.05, 0.036, 0.036]);

  // long heavy fluted barrel
  kit.box(body, M.oliveDark, [0, 0.075, -0.5], [0.072, 0.082, 0.16]);
  kit.cyl(body, M.gunmetal, [0, 0.075, -0.76], 0.021, 0.42, 10);
  kit.vents(body, M.deck, [0, 0.098, -0.76], 5, 0.075, [0.03, 0.008, 0.018]);

  // folded bipod: two legs clamped under the barrel
  kit.box(body, M.deck, [0, 0.042, -0.62], [0.05, 0.024, 0.05]);
  kit.box(body, M.gunmetal, [0.02, 0.026, -0.7], [0.011, 0.011, 0.17], [0, 0.06, 0]);
  kit.box(body, M.gunmetal, [-0.02, 0.026, -0.7], [0.011, 0.011, 0.17], [0, -0.06, 0]);

  const muzzle = kit.group(body, [0, 0.075, -1.0], null, 'muzzle');
  parts.muzzle = muzzle;
  kit.box(muzzle, M.deck, [0, 0, -0.02], [0.058, 0.058, 0.12]);
  kit.vents(muzzle, M.gunmetal, [0, 0, -0.02], 4, 0.026, [0.062, 0.034, 0.008]);
  kit.box(muzzle, M.gunmetal, [0, 0, -0.09], [0.046, 0.046, 0.016]);

  kit.box(body, M.oliveDark, [0, -0.07, -0.01], [0.05, 0.16, 0.07], [0.24, 0, 0]);
  kit.box(body, M.gunmetal, [0, -0.018, -0.08], [0.014, 0.032, 0.014], [0.2, 0, 0]);
  kit.box(body, M.oliveDark, [0, -0.036, -0.065], [0.044, 0.008, 0.075]);

  // thumbhole stock with a raised cheek riser — a hole is a silhouette feature
  kit.box(body, M.olive, [0, 0.128, 0.11], [0.07, 0.05, 0.22]);
  kit.box(body, M.olive, [0, 0.014, 0.11], [0.07, 0.05, 0.22]);
  kit.box(body, M.olive, [0, 0.07, 0.21], [0.07, 0.16, 0.04]);
  kit.box(body, M.deck, [0, 0.16, 0.09], [0.05, 0.02, 0.15]);
  kit.box(body, M.orange, [0, 0.07, 0.232], [0.05, 0.05, 0.014]);

  // 4-round magazine — short and fat
  const magazine = kit.group(body, [0, -0.062, -0.16], [0.06, 0, 0], 'magazine');
  parts.magazine = magazine;
  kit.box(magazine, M.oliveDark, [0, 0, 0], [0.06, 0.12, 0.11]);
  kit.box(magazine, M.deck, [0, -0.058, 0], [0.066, 0.022, 0.116]);
  kit.box(magazine, M.yellow, [0, 0.02, 0.057], [0.03, 0.012, 0.006]);

  // straight-pull bolt: big handle, long throw
  const bolt = kit.group(body, [0.052, 0.108, -0.06], null, 'bolt');
  parts.bolt = bolt;
  kit.box(bolt, M.gunmetal, [0, 0, 0], [0.022, 0.026, 0.11]);
  kit.box(bolt, M.deck, [0.026, 0, 0.05], [0.04, 0.022, 0.022]);
  kit.box(bolt, M.deck, [0.046, 0, 0.05], [0.026, 0.026, 0.026]);

  parts.counter = buildCounter(kit, body, [-0.05, 0.09, -0.06], [0, -Math.PI / 2, 0.16], 1);

  return { muzzleTipLocal: [0, 0.075, -1.07], recoil: { back: 0.11, pitch: 0.2, roll: 0.03 } };
}

// ===========================================================================
// CDF: Breaker — 6-shell tube, 12 pellets, 0.85 s refire.
// Silhouette key: TWIN TUBES (barrel over magazine tube) with a fat pump
// sleeve. Widest, shortest CDF receiver; no optic at all.
// ===========================================================================
function buildBreaker(kit, root, parts) {
  const M = mats();
  const body = kit.group(root, [0, 0, 0], null, 'body');
  parts.body = body;

  kit.box(body, M.olive, [0, 0.085, -0.17], [0.108, 0.13, 0.36]);
  kit.box(body, M.oliveDark, [0, 0.155, -0.17], [0.114, 0.02, 0.36]);
  kit.box(body, M.deck, [0.056, 0.085, -0.17], [0.008, 0.1, 0.37]);
  kit.box(body, M.deck, [-0.056, 0.085, -0.17], [0.008, 0.1, 0.37]);
  kit.boltRow(body, M.deck, [0.058, 0.13, -0.17], 4, 0.08, 0.007);
  // loading port + shell lifter, and three visible brass shells in the carrier
  kit.box(body, M.gunmetal, [0, 0.024, -0.16], [0.06, 0.014, 0.2]);
  kit.box(body, M.gunmetal, [0.058, 0.11, -0.12], [0.008, 0.044, 0.1]);
  for (let i = 0; i < 3; i++) {
    kit.cyl(body, M.orange, [0, 0.028, -0.1 - i * 0.062], 0.019, 0.052, 8);
  }

  // twin tubes
  kit.cyl(body, M.gunmetal, [0, 0.115, -0.53], 0.026, 0.4, 10);
  const magazine = kit.group(body, [0, 0.05, -0.5], null, 'magazine');
  parts.magazine = magazine; // tube magazine; no detachable box on this weapon
  kit.cyl(magazine, M.oliveDark, [0, 0, 0], 0.022, 0.34, 10);
  kit.box(magazine, M.deck, [0, 0, -0.17], [0.05, 0.05, 0.024]);
  kit.box(body, M.deck, [0, 0.082, -0.71], [0.03, 0.09, 0.03]); // tube-to-barrel yoke
  kit.box(body, M.deck, [0, 0.082, -0.4], [0.03, 0.09, 0.03]);

  // PUMP: this weapon's `bolt`. It rides on the tube and racks on refire.
  const bolt = kit.group(body, [0, 0.05, -0.44], null, 'bolt');
  parts.bolt = bolt;
  kit.box(bolt, M.oliveDark, [0, 0, 0], [0.08, 0.078, 0.15]);
  kit.vents(bolt, M.deck, [0, 0, 0], 5, 0.028, [0.084, 0.012, 0.012]);
  kit.box(bolt, M.yellow, [0, -0.042, 0], [0.05, 0.008, 0.1]);

  const muzzle = kit.group(body, [0, 0.115, -0.74], null, 'muzzle');
  parts.muzzle = muzzle;
  kit.cyl(muzzle, M.deck, [0, 0, -0.02], 0.033, 0.07, 10);
  kit.box(muzzle, M.gunmetal, [0, 0, -0.055], [0.066, 0.066, 0.014]);

  kit.box(body, M.oliveDark, [0, -0.07, -0.01], [0.054, 0.16, 0.074], [0.3, 0, 0]);
  kit.box(body, M.gunmetal, [0, -0.018, -0.075], [0.014, 0.034, 0.014], [0.2, 0, 0]);
  kit.box(body, M.oliveDark, [0, -0.038, -0.06], [0.048, 0.008, 0.08]);

  // heavy shoulder stock with a shell holder on the comb
  kit.box(body, M.olive, [0, 0.062, 0.1], [0.084, 0.115, 0.19]);
  kit.box(body, M.oliveDark, [0, 0.128, 0.09], [0.056, 0.028, 0.15]);
  kit.box(body, M.deck, [0, 0.05, 0.2], [0.09, 0.15, 0.024]);
  kit.box(body, M.orange, [0, 0.115, 0.2], [0.05, 0.016, 0.026]);
  for (let i = 0; i < 3; i++) {
    kit.cyl(body, M.orange, [0.05, 0.108, 0.05 + i * 0.05], 0.016, 0.04, 8, 'x');
  }

  parts.counter = buildCounter(kit, body, [-0.06, 0.108, -0.1], [0, -Math.PI / 2, 0.2], 1);

  return { muzzleTipLocal: [0, 0.115, -0.81], recoil: { back: 0.13, pitch: 0.24, roll: 0.05 } };
}

// ===========================================================================
// Vess: Ember Repeater — heat-driven, no reload, no ammo pickup.
// Silhouette key: a smooth organic sheath with FOUR SPLAYED VENT FINS that
// open as heat rises, over a visible plasma channel. No stock, no magazine.
// ===========================================================================
function buildEmberRepeater(kit, root, parts) {
  const M = mats();
  const P = plasmaMaterials(VESS.plasmaCyan, 2.6);
  const body = kit.group(root, [0, 0, 0], null, 'body');
  parts.body = body;

  // internal plasma channel — the thing that glows through the shell
  const core = kit.group(body, [0, 0.086, -0.3], null, 'core');
  kit.box(core, P.core, [0, 0, 0], [0.03, 0.03, 0.46]);
  kit.cyl(core, P.halo, [0, 0, 0], 0.042, 0.44, 10);
  kit.box(core, P.core, [0, 0.028, 0.16], [0.05, 0.026, 0.09]);

  // shell: four plates around the channel with real gaps between them, so the
  // core is genuinely seen through the geometry rather than through a shader.
  kit.box(body, M.vessShell, [0, 0.14, -0.28], [0.09, 0.045, 0.4], [0, 0, 0]);
  kit.box(body, M.vessShell, [0, 0.03, -0.28], [0.09, 0.045, 0.4]);
  kit.box(body, M.vessDeep, [0.056, 0.086, -0.28], [0.028, 0.075, 0.38]);
  kit.box(body, M.vessDeep, [-0.056, 0.086, -0.28], [0.028, 0.075, 0.38]);
  kit.box(body, M.vessLight, [0, 0.16, -0.42], [0.07, 0.03, 0.14], [0.12, 0, 0]);
  kit.box(body, M.vessLight, [0, 0.15, -0.13], [0.076, 0.032, 0.14], [-0.1, 0, 0]);

  // breech mass and the grip spur
  kit.box(body, M.vessShell, [0, 0.09, 0.02], [0.1, 0.13, 0.19]);
  kit.box(body, M.vessDeep, [0, 0.155, 0.02], [0.084, 0.026, 0.17]);
  kit.box(body, M.vessDeep, [0, -0.06, -0.01], [0.05, 0.17, 0.075], [0.34, 0, 0]);
  kit.box(body, M.vessLight, [0, -0.135, 0.015], [0.054, 0.024, 0.07], [0.34, 0, 0]);
  kit.box(body, P.core, [0, -0.02, -0.055], [0.014, 0.03, 0.014]);

  // VENT FINS — animated by heat01. Four blades, hinged at the breech.
  const fins = kit.group(body, [0, 0.13, -0.06], null, 'fins');
  parts.fins = fins;
  const finPivots = [];
  for (const s of [1, -1]) {
    const upper = kit.group(fins, [0.03 * s, 0.02, 0], [0, 0, -0.12 * s]);
    kit.box(upper, M.vessLight, [0.02 * s, 0.03, -0.06], [0.026, 0.075, 0.2]);
    kit.box(upper, P.core, [0.034 * s, 0.03, -0.06], [0.005, 0.05, 0.16]);
    finPivots.push({ node: upper, restZ: -0.12 * s, open: 0.55 * s });
    const lower = kit.group(fins, [0.05 * s, -0.06, 0], [0, 0, -0.05 * s]);
    kit.box(lower, M.vessDeep, [0.012 * s, -0.02, -0.06], [0.022, 0.06, 0.18]);
    kit.box(lower, P.core, [0.024 * s, -0.02, -0.06], [0.005, 0.04, 0.14]);
    finPivots.push({ node: lower, restZ: -0.05 * s, open: 0.42 * s });
  }

  // emitter: three prongs around the plasma exit
  const muzzle = kit.group(body, [0, 0.086, -0.53], null, 'muzzle');
  parts.muzzle = muzzle;
  kit.box(muzzle, M.vessShell, [0, 0.036, -0.02], [0.05, 0.024, 0.11], [-0.2, 0, 0]);
  kit.box(muzzle, M.vessShell, [0.036, -0.02, -0.02], [0.024, 0.05, 0.11], [0, 0.2, 0]);
  kit.box(muzzle, M.vessShell, [-0.036, -0.02, -0.02], [0.024, 0.05, 0.11], [0, -0.2, 0]);
  kit.cyl(muzzle, P.core, [0, 0, -0.05], 0.017, 0.03, 10);
  kit.cyl(muzzle, P.halo, [0, 0, -0.05], 0.03, 0.024, 10);

  // The Ember has no magazine. The slot is filled with the heat-sink block so
  // callers do not have to branch on weapon id; it never detaches (reload01 is
  // ignored for this weapon — see animateViewModel).
  const magazine = kit.group(body, [0, 0.02, 0.06], null, 'magazine');
  parts.magazine = magazine;
  kit.box(magazine, M.vessDeep, [0, 0, 0], [0.085, 0.06, 0.14]);
  kit.vents(magazine, M.vessLight, [0, 0.032, 0], 4, 0.03, [0.07, 0.008, 0.012]);

  // plasma shuttle, cycles on fire
  const bolt = kit.group(body, [0, 0.086, -0.08], null, 'bolt');
  parts.bolt = bolt;
  kit.box(bolt, M.vessLight, [0, 0, 0], [0.07, 0.05, 0.06]);
  kit.box(bolt, P.core, [0, 0.03, 0], [0.04, 0.008, 0.05]);

  parts.counter = buildBar(kit, body, [-0.056, 0.11, 0.02], [0, -Math.PI / 2, 0], 8, VESS.plasmaCyan);

  return {
    muzzleTipLocal: [0, 0.086, -0.6],
    recoil: { back: 0.028, pitch: 0.05, roll: 0.012 },
    plasma: P,
    finPivots,
  };
}

// ===========================================================================
// Vess: Vess Sidearm — 100-cell battery, 1.2 s charge for the EMP bolt.
// Silhouette key: SMALL and BULBOUS, with three charge coil rings stacked down
// the barrel. The only weapon in the set with no stock and no straight lines.
// ===========================================================================
function buildVessSidearm(kit, root, parts) {
  const M = mats();
  const P = plasmaMaterials(VESS.plasmaViolet, 2.4);
  const body = kit.group(root, [0, 0, 0], null, 'body');
  parts.body = body;

  // battery cell, visible through a cut-out in the shell
  const core = kit.group(body, [0, 0.075, -0.11], null, 'core');
  kit.box(core, P.core, [0, 0, 0], [0.036, 0.05, 0.15]);
  kit.cyl(core, P.halo, [0, 0, 0], 0.045, 0.15, 10);

  kit.box(body, M.vessShell, [0, 0.128, -0.11], [0.082, 0.058, 0.2]);
  kit.box(body, M.vessShell, [0, 0.026, -0.11], [0.082, 0.05, 0.2]);
  kit.box(body, M.vessDeep, [0.05, 0.075, -0.11], [0.024, 0.07, 0.19]);
  kit.box(body, M.vessDeep, [-0.05, 0.075, -0.11], [0.024, 0.07, 0.19]);
  kit.box(body, M.vessLight, [0, 0.152, -0.15], [0.06, 0.024, 0.11], [0.1, 0, 0]);

  // grip: a fat organic spur
  kit.box(body, M.vessShell, [0, -0.05, 0.01], [0.056, 0.17, 0.085], [0.36, 0, 0]);
  kit.box(body, M.vessDeep, [0, -0.128, 0.04], [0.06, 0.03, 0.08], [0.36, 0, 0]);
  kit.box(body, P.core, [0, -0.05, -0.03], [0.012, 0.09, 0.012], [0.36, 0, 0]);
  kit.box(body, M.vessLight, [0, -0.012, -0.055], [0.014, 0.03, 0.014], [0.2, 0, 0]);

  // CHARGE COILS — three rings down the barrel; they close and brighten as the
  // charge builds, which is the whole read for the golden combination.
  const coils = [];
  const barrel = kit.group(body, [0, 0.075, -0.27], null, 'barrel');
  kit.cyl(barrel, P.core, [0, 0, 0], 0.014, 0.22, 10);
  for (let i = 0; i < 3; i++) {
    const c = kit.group(barrel, [0, 0, -0.02 - i * 0.055], null, 'coil');
    kit.cyl(c, M.vessLight, [0, 0, 0], 0.036, 0.018, 10);
    kit.cyl(c, P.halo, [0, 0, 0], 0.042, 0.012, 10);
    coils.push(c);
  }

  const muzzle = kit.group(body, [0, 0.075, -0.4], null, 'muzzle');
  parts.muzzle = muzzle;
  kit.box(muzzle, M.vessShell, [0.024, 0, 0], [0.02, 0.05, 0.07], [0, 0.22, 0]);
  kit.box(muzzle, M.vessShell, [-0.024, 0, 0], [0.02, 0.05, 0.07], [0, -0.22, 0]);
  kit.cyl(muzzle, P.core, [0, 0, -0.03], 0.015, 0.028, 10);
  kit.cyl(muzzle, P.halo, [0, 0, -0.03], 0.028, 0.02, 10);

  // battery pack: this one DOES detach — the Vess Sidearm has a swappable cell
  const magazine = kit.group(body, [0, -0.02, -0.05], [0.2, 0, 0], 'magazine');
  parts.magazine = magazine;
  kit.box(magazine, M.vessDeep, [0, 0, 0], [0.062, 0.075, 0.09]);
  kit.box(magazine, M.vessLight, [0, -0.04, 0], [0.068, 0.014, 0.096]);
  kit.box(magazine, P.core, [0.032, 0, 0], [0.005, 0.05, 0.06]);
  kit.box(magazine, P.core, [-0.032, 0, 0], [0.005, 0.05, 0.06]);

  const bolt = kit.group(body, [0, 0.152, -0.03], null, 'bolt');
  parts.bolt = bolt;
  kit.box(bolt, M.vessLight, [0, 0, 0], [0.05, 0.026, 0.07]);
  kit.box(bolt, P.core, [0, 0.016, 0], [0.03, 0.006, 0.05]);

  parts.counter = buildBar(kit, body, [-0.05, 0.1, -0.05], [0, -Math.PI / 2, 0], 6, VESS.plasmaViolet);

  return {
    muzzleTipLocal: [0, 0.075, -0.45],
    recoil: { back: 0.034, pitch: 0.07, roll: 0.016 },
    plasma: P,
    coils,
  };
}

// ---------------------------------------------------------------------------
const VM_BUILDERS = {
  cadence_ar: buildCadenceAr,
  vector_br: buildVectorBr,
  longbow: buildLongbow,
  breaker: buildBreaker,
  ember_repeater: buildEmberRepeater,
  vess_sidearm: buildVessSidearm,
};

/**
 * Default hand pose. The root is meant to be added straight to the view-model
 * camera: `vmCamera.add(handle.root)`. Local space is
 *   -Z forward, +Y up, origin at the shooting hand.
 */
const REST_POSE = {
  cadence_ar: { pos: [0.135, -0.145, -0.3], rot: [0.02, 0.055, 0] },
  vector_br: { pos: [0.138, -0.15, -0.3], rot: [0.02, 0.05, 0] },
  longbow: { pos: [0.13, -0.15, -0.26], rot: [0.02, 0.045, 0] },
  breaker: { pos: [0.14, -0.15, -0.28], rot: [0.02, 0.06, 0] },
  ember_repeater: { pos: [0.145, -0.14, -0.3], rot: [0.02, 0.07, 0] },
  vess_sidearm: { pos: [0.15, -0.135, -0.24], rot: [0.02, 0.09, 0] },
};

/** Magazine capacities, so the ammo counter can be seeded sensibly. */
const CAPACITY = {
  cadence_ar: 32,
  vector_br: 36,
  longbow: 4,
  breaker: 6,
  ember_repeater: 8,
  vess_sidearm: 6,
};

/**
 * Build a first-person weapon view model.
 *
 * @param {string} weaponId one of the keys of VM_BUILDERS
 * @returns {{
 *   weaponId: string,
 *   root: THREE.Group,
 *   parts: {body, magazine, bolt, counter, muzzle, ...},
 *   muzzleTip: THREE.Object3D,
 *   triangles: number,
 *   rest: Object,
 *   anim: Object,
 * }}
 *
 * `muzzleTip` is an Object3D sitting exactly at the emitter mouth. `fx` and
 * `weapons` should parent flashes / tracer origins to it, or read
 * `muzzleTip.matrixWorld` after `root.updateMatrixWorld()`.
 */
export function buildViewModel(weaponId) {
  const build = VM_BUILDERS[weaponId];
  if (!build) throw new Error(`[viewmodels] unknown weapon "${weaponId}"`);

  const root = new THREE.Group();
  root.name = `vm_${weaponId}`;
  const parts = { body: null, magazine: null, bolt: null, counter: null, muzzle: null };
  const kit = new VmKit();

  const extra = build(kit, root, parts) || {};

  const muzzleTip = new THREE.Object3D();
  muzzleTip.name = 'muzzleTip';
  const mt = extra.muzzleTipLocal || [0, 0, -0.5];
  muzzleTip.position.set(mt[0], mt[1], mt[2]);
  parts.body.add(muzzleTip);

  const pose = REST_POSE[weaponId];
  root.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  root.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
  root.layers.set(LAYER_VIEWMODEL);
  root.frustumCulled = false;

  const handle = {
    weaponId,
    root,
    parts,
    muzzleTip,
    triangles: kit.tris,
    capacity: CAPACITY[weaponId],
    plasma: extra.plasma || null,
    finPivots: extra.finPivots || null,
    coils: extra.coils || null,
    recoilSpec: extra.recoil || { back: 0.05, pitch: 0.1, roll: 0.02 },
    // Materials this instance owns outright (the shared library in mats() is
    // NOT in here). disposeViewModel() frees exactly these.
    ownMaterials: [
      extra.plasma && extra.plasma.core,
      extra.plasma && extra.plasma.halo,
      parts.counter && parts.counter.userData.material,
    ].filter(Boolean),
    isVess: weaponId === 'ember_repeater' || weaponId === 'vess_sidearm',
    hasDetachableMag: weaponId !== 'ember_repeater' && weaponId !== 'breaker',
    rest: {
      root: { pos: pose.pos.slice(), rot: pose.rot.slice() },
      magazine: snap(parts.magazine),
      bolt: snap(parts.bolt),
      body: snap(parts.body),
    },
    anim: {
      time: 0,
      cyclePhase: 0,
      recoil: 0,
      heat: 0,
      charge: 0,
      firing: 0,
      ammo: CAPACITY[weaponId],
    },
  };

  setAmmoCounter(handle, handle.capacity);
  root.updateMatrixWorld(true);
  return handle;
}

function snap(n) {
  if (!n) return null;
  return {
    px: n.position.x,
    py: n.position.y,
    pz: n.position.z,
    rx: n.rotation.x,
    ry: n.rotation.y,
    rz: n.rotation.z,
  };
}

// ---------------------------------------------------------------------------
// Ammo counter
// ---------------------------------------------------------------------------

/**
 * Set the value shown on the weapon's counter.
 * CDF weapons render `value` as decimal digits; Vess weapons fill a segment bar
 * with `value / capacity`. FEEL.md §7 requires reload state to be readable from
 * the view model with the HUD hidden — this is half of that (the magazine
 * animation is the other half).
 */
export function setAmmoCounter(handle, value) {
  const c = handle && handle.parts && handle.parts.counter;
  if (!c) return handle;
  const v = Math.max(0, Math.round(value));
  handle.anim.ammo = v;

  if (c.userData.kind === 'digits') {
    const digits = c.userData.digits;
    const n = digits.length;
    const shown = Math.min(v, Math.pow(10, n) - 1);
    const text = String(shown).padStart(n, ' ');
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      const pattern = ch === ' ' ? 0 : SEG_PATTERNS[ch.charCodeAt(0) - 48];
      const segs = digits[i].userData.segments;
      for (let s = 0; s < 7; s++) segs[SEG_ORDER[s]].visible = (pattern & (1 << s)) !== 0;
    }
  } else {
    const list = c.userData.segments;
    const lit = Math.round((v / Math.max(1, handle.capacity)) * list.length);
    for (let i = 0; i < list.length; i++) list[i].visible = i < lit;
  }
  return handle;
}

// ---------------------------------------------------------------------------
// Procedural animation
// ---------------------------------------------------------------------------

/**
 * @param {object} handle from buildViewModel()
 * @param {object} o
 * @param {number} [o.firing01]  1 while the trigger is producing shots, 0 idle.
 *                               Drives bolt cycling rate and the muzzle glow.
 * @param {number} [o.recoil01]  current recoil level 0..1 (an impulse the
 *                               weapons owner decays, or a step this module
 *                               springs down if left at 0).
 * @param {number} [o.reload01]  reload progress 0..1. 0-0.42 drops the old mag,
 *                               0.42-0.58 is the hand travel, 0.58-1.0 seats
 *                               the new one and the bolt runs forward.
 * @param {number} [o.swap01]    1 = fully raised and ready, 0 = fully lowered
 *                               out of frame. FEEL.md §4 weapon swap is 0.7 s.
 * @param {number} [o.heat01]    Ember Repeater vent fins + plasma intensity.
 * @param {number} [o.charge01]  Vess Sidearm coil convergence + glow ramp.
 * @param {number} [o.dt]        seconds.
 */
export function animateViewModel(handle, o = {}) {
  const a = handle.anim;
  const R = handle.rest;
  const P = handle.parts;
  const dt = Math.max(0, o.dt ?? 0);
  a.time += dt;

  const firing = clamp(o.firing01 ?? 0, 0, 1);
  const reload = clamp(o.reload01 ?? 0, 0, 1);
  const swap = o.swap01 === undefined ? 1 : clamp(o.swap01, 0, 1);
  const heatIn = clamp(o.heat01 ?? 0, 0, 1);
  const chargeIn = clamp(o.charge01 ?? 0, 0, 1);

  // Recoil: take the caller's value as a floor and spring the rest down, so
  // this reads correctly whether the caller sends a per-shot impulse or a
  // continuously-decaying level.
  const rIn = clamp(o.recoil01 ?? 0, 0, 1);
  a.recoil = Math.max(rIn, a.recoil);
  a.recoil = damp(a.recoil, rIn, 13, dt);
  a.firing = damp(a.firing, firing, 18, dt);
  a.heat = damp(a.heat, heatIn, 6, dt);
  a.charge = damp(a.charge, chargeIn, 12, dt);

  const rec = a.recoil;
  const spec = handle.recoilSpec;

  // ---- root: recoil kick, idle sway, reload dip, swap raise ---------------
  const rr = R.root;
  const sway = Math.sin(a.time * 0.9) * 0.0022;
  const sway2 = Math.sin(a.time * 0.62 + 1.3) * 0.0028;
  // reload dip: the weapon tips toward the player while the hand works
  const dipT = reload > 0 ? Math.sin(reload * Math.PI) : 0;
  // swap: lowered means down and rotated out of frame
  const down = 1 - swap;

  handle.root.position.set(
    rr.pos[0] + sway2 + rec * 0.006,
    rr.pos[1] + sway - rec * spec.back * 0.28 - dipT * 0.045 - down * 0.34,
    rr.pos[2] + rec * spec.back,
  );
  handle.root.rotation.set(
    rr.rot[0] - rec * spec.pitch - dipT * 0.26 + down * 0.55,
    rr.rot[1] + rec * spec.roll * 0.4 + dipT * 0.3 + down * 0.42,
    rr.rot[2] + rec * spec.roll + dipT * 0.22 + down * 0.3,
  );

  // ---- bolt / pump cycling ------------------------------------------------
  if (P.bolt && R.bolt) {
    const b = R.bolt;
    // Cycle phase runs while firing, and once through on the last third of a
    // reload so the weapon visibly chambers a round.
    if (a.firing > 0.02) a.cyclePhase = (a.cyclePhase + dt * 11.0) % 1;
    else a.cyclePhase = 0;
    const fireCycle = a.firing > 0.02 ? Math.sin(a.cyclePhase * TAU) * 0.5 + 0.5 : 0;
    const reloadCycle = reload > 0.72 ? Math.sin(((reload - 0.72) / 0.28) * Math.PI) : 0;
    const throwLen = handle.weaponId === 'breaker' ? 0.075 : handle.weaponId === 'longbow' ? 0.09 : 0.04;
    const t = Math.max(fireCycle * a.firing, reloadCycle);
    P.bolt.position.set(b.px, b.py, b.pz + t * throwLen);
    // recoil also drags the reciprocating mass back a little
    P.bolt.position.z += rec * throwLen * 0.35;
  }

  // ---- magazine: drop and insert -----------------------------------------
  if (P.magazine && R.magazine) {
    const m = R.magazine;
    let dy = 0;
    let dz = 0;
    let rx = 0;
    let rz = 0;
    let visible = true;
    if (handle.hasDetachableMag && reload > 0) {
      if (reload < 0.42) {
        // fall away and tumble
        const t = reload / 0.42;
        dy = -t * t * 0.42;
        dz = t * 0.06;
        rx = t * 0.9;
        rz = t * 0.5;
        if (t > 0.85) visible = false;
      } else if (reload < 0.58) {
        visible = false;
      } else {
        // rise back in, overshoot slightly, then seat
        const t = (reload - 0.58) / 0.42;
        const e = 1 - Math.pow(1 - t, 3);
        dy = -(1 - e) * 0.3;
        dz = (1 - e) * 0.03;
        rx = (1 - e) * 0.35;
        rz = -(1 - e) * 0.2;
      }
    }
    P.magazine.visible = visible;
    P.magazine.position.set(m.px, m.py + dy, m.pz + dz);
    P.magazine.rotation.set(m.rx + rx, m.ry, m.rz + rz);
  }

  // ---- Vess: heat vents, plasma intensity, charge coils -------------------
  if (handle.plasma) {
    const p = handle.plasma;
    // Plasma brightens with heat AND with charge; the Ember uses heat, the
    // sidearm uses charge, and each leaves the other at 0.
    const drive = 1 + 2.2 * a.heat + 3.0 * a.charge + 0.5 * a.firing;
    p.core.uniforms.uEmissiveIntensity.value = p.baseIntensity * drive;
    p.halo.uniforms.uEmissiveIntensity.value = p.baseIntensity * 0.42 * drive;
  }

  if (handle.finPivots) {
    // Vent fins splay open with heat, plus a fast flutter at the top of the
    // range so an overheat lockout is unmistakable. FEEL.md §4.5: the caller
    // owns the 0.55 s vent delay and the 2.6 s empty; this only poses.
    const flutter = a.heat > 0.8 ? Math.sin(a.time * 26) * 0.05 * (a.heat - 0.8) * 5 : 0;
    for (const f of handle.finPivots) {
      f.node.rotation.z = f.restZ + f.open * (a.heat + flutter);
    }
  }

  if (handle.coils) {
    // Coils converge toward the muzzle and spin up as the charge builds.
    for (let i = 0; i < handle.coils.length; i++) {
      const c = handle.coils[i];
      c.position.z = -0.02 - i * (0.055 - a.charge * 0.014);
      c.rotation.z = a.time * (2 + 14 * a.charge) * (i % 2 === 0 ? 1 : -1);
      const s = 1 + a.charge * 0.16 * Math.sin(a.time * 30 + i);
      c.scale.set(s, s, 1);
    }
  }

  // ---- Vess bar: the Ember has no ammo, so its bar shows HEAT (and empties
  // ---- as it vents); the sidearm's shows remaining battery from setAmmoCounter.
  if (P.counter && P.counter.userData.kind === 'bar' && handle.weaponId === 'ember_repeater') {
    const list = P.counter.userData.segments;
    const lit = Math.round(a.heat * list.length);
    for (let i = 0; i < list.length; i++) list[i].visible = i < lit;
  }

  handle.root.updateMatrixWorld(true);
  return handle;
}

/** Free the per-instance materials one view model owns. Geometry is shared. */
export function disposeViewModel(handle) {
  if (!handle) return;
  for (const m of handle.ownMaterials) m.dispose();
  handle.ownMaterials.length = 0;
}

/** Free the shared geometry cache and material library. Call on teardown. */
export function disposeViewModels() {
  for (const g of _geo.values()) g.dispose();
  _geo.clear();
  if (_m) {
    for (const m of Object.values(_m)) m.dispose();
    _m = null;
  }
}

export const VIEWMODEL_IDS = Object.freeze(Object.keys(VM_BUILDERS));
