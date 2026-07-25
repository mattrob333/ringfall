// L4 world — the shipping level. OWNER: `worldart` (S3).
//
// Every visual box also registers a physics OBB, so geometry and collision can
// never drift apart. There is no separate collision authoring step and no
// "collision mesh" to forget to update.

import * as THREE from 'three';
import { LAYER_WORLD } from '../render/index.js';
import { Materials } from '../materials/index.js';
import { SurfaceId } from '../shared/enums.js';
import { hexToLinear, CDF, VESS, WROUGHT, TERRAIN } from '../shared/palette.js';
import { buildTerrain } from './terrain.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Builder that keeps render geometry and physics colliders in lockstep.
 */
class Kit {
  constructor(root, physics) {
    this.root = root;
    this.physics = physics;
    this.geoCache = new Map();
    this.count = 0;
  }

  box(w, h, d) {
    const key = `b${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** A solid box: mesh + matching OBB collider. */
  solid(mat, surfaceId, x, y, z, w, h, d, ry = 0, rx = 0, rz = 0) {
    const mesh = new THREE.Mesh(this.box(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.layers.set(LAYER_WORLD);
    mesh.updateMatrixWorld(true);
    this.root.add(mesh);
    this.count++;

    if (this.physics) {
      _e.set(rx, ry, rz);
      _q.setFromEuler(_e);
      this.physics.addStaticBox(
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(w / 2, h / 2, d / 2),
        _q.clone(),
        surfaceId,
      );
    }
    return mesh;
  }

  /** Visual only — no collider. For trim, greebles, signage. */
  decor(geo, mat, x, y, z, ry = 0, rx = 0, rz = 0, scale = 1) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.setScalar(scale);
    mesh.layers.set(LAYER_WORLD);
    this.root.add(mesh);
    this.count++;
    return mesh;
  }
}

/**
 * @param {import('../render/index.js').RingfallRenderer} renderer
 * @param {object} physics PhysicsWorld or null
 */
export function buildLevel(renderer, physics) {
  const root = new THREE.Group();
  root.name = 'level';
  const kit = new Kit(root, physics);
  const clusters = renderer.clusters;

  const mats = {
    hull: Materials.cdfHull(),
    floor: Materials.cdfFloor(),
    gunmetal: Materials.cdfGunmetal(),
    light: Materials.cdfLight(),
    vess: Materials.vessShell(),
    vessDeep: Materials.vessDeep(),
    wrought: Materials.wroughtSlab(),
    rock: Materials.plain(TERRAIN.rock, { roughness: 0.92, surfaceId: SurfaceId.ROCK }),
  };

  // ---- Terrain ------------------------------------------------------------
  const terrain = buildTerrain(physics);
  root.add(terrain.mesh);

  // The megastructure is drawn analytically in the sky pass (src/render/ring.js)
  // because it is 3.5-24 km out and would be clipped by the far plane as mesh.

  // ---- CDF outpost (north) ------------------------------------------------
  // A real interior: two rooms, a doorway, a roof, and a catwalk you can walk.
  const OX = 0,
    OZ = -46;
  const wallH = 5.0;
  const t = 0.6;

  // Foundation slab
  kit.solid(mats.floor, SurfaceId.METAL_GRATE, OX, 0.3, OZ, 34, 0.6, 26);

  // Outer walls with a gap for the main entrance
  kit.solid(mats.hull, SurfaceId.METAL_PAINTED, OX - 12, wallH / 2 + 0.6, OZ + 13, 10, wallH, t);
  kit.solid(mats.hull, SurfaceId.METAL_PAINTED, OX + 12, wallH / 2 + 0.6, OZ + 13, 10, wallH, t);
  kit.solid(mats.hull, SurfaceId.METAL_PAINTED, OX, wallH / 2 + 3.4, OZ + 13, 14, wallH - 3.4, t); // lintel
  kit.solid(mats.hull, SurfaceId.METAL_PAINTED, OX, wallH / 2 + 0.6, OZ - 13, 34, wallH, t);
  kit.solid(mats.hull, SurfaceId.METAL_PAINTED, OX - 17, wallH / 2 + 0.6, OZ, t, wallH, 26);
  kit.solid(mats.hull, SurfaceId.METAL_PAINTED, OX + 17, wallH / 2 + 0.6, OZ, t, wallH, 26);

  // Interior divider with a doorway
  kit.solid(mats.light, SurfaceId.METAL_PAINTED, OX - 10, wallH / 2 + 0.6, OZ - 2, 14, wallH, t);
  kit.solid(mats.light, SurfaceId.METAL_PAINTED, OX + 10, wallH / 2 + 0.6, OZ - 2, 14, wallH, t);
  kit.solid(mats.light, SurfaceId.METAL_PAINTED, OX, wallH / 2 + 3.6, OZ - 2, 6, wallH - 3.6, t);

  // Roof
  kit.solid(mats.hull, SurfaceId.METAL_PAINTED, OX, wallH + 0.9, OZ, 34, 0.6, 26);

  // Catwalk along the back wall, reachable by a ramp
  kit.solid(mats.floor, SurfaceId.METAL_GRATE, OX, 2.9, OZ - 10.5, 30, 0.35, 4);
  for (let i = -2; i <= 2; i++) {
    kit.solid(mats.gunmetal, SurfaceId.METAL_BARE, OX + i * 7, 1.6, OZ - 12.2, 0.35, 2.6, 0.35);
  }
  // Ramp up to the catwalk (a rotated slab; the character controller walks it)
  kit.solid(mats.floor, SurfaceId.METAL_GRATE, OX + 13.5, 1.75, OZ - 4.5, 4, 0.35, 8.4, 0, -0.32, 0);

  // Crates for cover
  const cratePositions = [
    [-6, -6], [-4.2, -6.9], [-5.1, -8.2], [7, -5], [8.8, -6.4], [3, 6], [-9, 5.5], [11, 7.5],
  ];
  for (let i = 0; i < cratePositions.length; i++) {
    const [cx, cz] = cratePositions[i];
    const s = i % 3 === 0 ? 1.5 : 1.15;
    kit.solid(
      i % 2 ? mats.light : mats.gunmetal,
      SurfaceId.METAL_PAINTED,
      OX + cx,
      0.6 + s / 2,
      OZ + cz,
      s,
      s,
      s,
      (i * 0.37) % 1.2,
    );
  }

  // Interior lights — this is what makes the interior read as high-key.
  const cyan = new THREE.Color(...hexToLinear(CDF.opticCyan));
  const warm = new THREE.Color(...hexToLinear('#FFE2B0'));
  for (let i = -2; i <= 2; i++) {
    clusters.addPointLight(new THREE.Vector3(OX + i * 7, wallH + 0.2, OZ + 5), warm, 34, 14);
    clusters.addPointLight(new THREE.Vector3(OX + i * 7, wallH + 0.2, OZ - 7), cyan, 22, 12);
    // Emissive strip geometry under each light so the source is visible.
    kit.decor(kit.box(4.2, 0.16, 0.5), emissiveStrip(renderer, CDF.opticCyan, 2.0), OX + i * 7, wallH + 0.55, OZ - 7);
  }

  // ---- Wrought monolith complex (west) ------------------------------------
  const WX = -62,
    WZ = 8;
  kit.solid(mats.wrought, SurfaceId.ALLOY_HARD, WX, 6, WZ - 14, 26, 12, 3);
  kit.solid(mats.wrought, SurfaceId.ALLOY_HARD, WX - 12, 8, WZ, 3, 16, 26);
  kit.solid(mats.wrought, SurfaceId.ALLOY_HARD, WX, 5, WZ + 14, 26, 10, 3);
  kit.solid(mats.wrought, SurfaceId.ALLOY_HARD, WX + 6, 0.5, WZ, 22, 1, 25); // raised courtyard
  // Stepped approach so the courtyard is reachable on foot
  for (let i = 0; i < 3; i++) {
    kit.solid(mats.wrought, SurfaceId.ALLOY_HARD, WX + 18 + i * 1.6, 0.16 + i * 0.34, WZ, 1.6, 0.34, 12);
  }
  // Freestanding pylons
  for (let i = 0; i < 4; i++) {
    kit.solid(mats.wrought, SurfaceId.ALLOY_HARD, WX + 2 + i * 5, 4.5, WZ - 6 + (i % 2) * 12, 2.2, 8, 2.2);
  }
  const seamGlow = new THREE.Color(...hexToLinear(WROUGHT.seamEmissive));
  for (let i = 0; i < 5; i++) {
    clusters.addPointLight(new THREE.Vector3(WX + i * 5 - 6, 3.0, WZ), seamGlow, 26, 16);
  }

  // ---- Vess landing site (east) -------------------------------------------
  const VX = 58,
    VZ = -6;
  const dome = new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.5);
  kit.decor(dome, mats.vess, VX, 0.2, VZ, 0, 0, 0, 6.5);
  kit.decor(dome, mats.vessDeep, VX - 14, 0.2, VZ + 10, 0, 0, 0, 4.2);
  kit.decor(dome, mats.vess, VX + 11, 0.2, VZ - 12, 0, 0, 0, 3.4);
  // Physics for the domes: approximate with spheres.
  if (physics) {
    physics.addStaticSphere(new THREE.Vector3(VX, 0.2, VZ), 6.5, SurfaceId.ALLOY_SMOOTH);
    physics.addStaticSphere(new THREE.Vector3(VX - 14, 0.2, VZ + 10), 4.2, SurfaceId.ALLOY_SMOOTH);
    physics.addStaticSphere(new THREE.Vector3(VX + 11, 0.2, VZ - 12), 3.4, SurfaceId.ALLOY_SMOOTH);
  }
  // Emissive pylons
  const pylon = new THREE.CylinderGeometry(0.45, 0.75, 7, 10);
  const vessGlow = new THREE.Color(...hexToLinear(VESS.plasmaCyan));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = VX + Math.cos(a) * 19;
    const pz = VZ + Math.sin(a) * 19;
    kit.solid(mats.vessDeep, SurfaceId.ALLOY_SMOOTH, px, 3.5, pz, 1.2, 7, 1.2);
    kit.decor(kit.box(0.5, 5.4, 0.5), emissiveStrip(renderer, VESS.plasmaCyan, 2.4), px, 4.0, pz + 0.66);
    clusters.addPointLight(new THREE.Vector3(px, 4.5, pz), vessGlow, 30, 18);
  }

  // ---- Rocks and mid-field cover ------------------------------------------
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockSpots = [
    [-24, 22, 2.6], [-16, 34, 1.8], [18, 28, 3.2], [30, 14, 2.2], [-38, -20, 2.8],
    [26, -30, 2.4], [-8, 30, 1.6], [40, 30, 3.0], [-46, 34, 2.0], [12, -22, 1.9],
  ];
  for (let i = 0; i < rockSpots.length; i++) {
    const [rx, rz, rs] = rockSpots[i];
    const y = terrain.heightAt(rx, rz);
    kit.decor(rockGeo, mats.rock, rx, y + rs * 0.35, rz, i * 0.9, i * 0.31, i * 0.17, rs);
    if (physics) physics.addStaticSphere(new THREE.Vector3(rx, y + rs * 0.35, rz), rs * 0.82, SurfaceId.ROCK);
  }

  // Low walls the player can vault behind mid-field
  for (let i = 0; i < 6; i++) {
    const a = -0.6 + i * 0.42;
    kit.solid(
      mats.gunmetal,
      SurfaceId.METAL_PAINTED,
      Math.sin(a) * 30,
      terrain.heightAt(Math.sin(a) * 30, Math.cos(a) * 26) + 0.75,
      Math.cos(a) * 26,
      5.5,
      1.5,
      0.7,
      a,
    );
  }

  return {
    root,
    terrain,
    mats,
    meshCount: kit.count,
    spawns: {
      player: new THREE.Vector3(0, terrain.heightAt(0, 26) + 1.0, 26),
      vehicle: new THREE.Vector3(14, terrain.heightAt(14, 20) + 1.2, 20),
      enemies: [
        new THREE.Vector3(0, 0, -34),
        new THREE.Vector3(-6, 0, -40),
        new THREE.Vector3(7, 0, -39),
        new THREE.Vector3(-48, 1.2, 8),
        new THREE.Vector3(-40, 1.2, 14),
        new THREE.Vector3(52, 0, -4),
        new THREE.Vector3(60, 0, 6),
        new THREE.Vector3(46, 0, -14),
      ].map((v) => {
        v.y = terrain.heightAt(v.x, v.z) + 0.1;
        return v;
      }),
    },
  };
}

/** A small unlit emissive slab — the visible source under a cluster light. */
const _emissiveCache = new Map();
function emissiveStrip(renderer, hex, intensity) {
  const key = `${hex}_${intensity}`;
  let m = _emissiveCache.get(key);
  if (m) return m;
  const c = hexToLinear(hex);
  m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `
      void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      precision highp float;
      layout(location = 0) out vec4 fragColor;
      uniform vec3 uColor;
      void main() { fragColor = vec4(uColor, 1.0); }
    `,
    uniforms: { uColor: { value: new THREE.Vector3(c[0] * intensity, c[1] * intensity, c[2] * intensity) } },
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
  _emissiveCache.set(key, m);
  return m;
}
