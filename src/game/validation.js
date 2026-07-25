// L6 game — a scene whose only job is to exercise every lighting and material
// path so S1/S2 can be validated before any real content exists.
// This is NOT the shipping level. src/world owns that.

import * as THREE from 'three';
import { Materials } from '../materials/index.js';
import { LAYER_WORLD } from '../render/index.js';
import { hexToLinear, VESS, WROUGHT, CDF } from '../shared/palette.js';
import { rng } from '../core/rng.js';

export function buildValidationScene(renderer) {
  const root = new THREE.Group();
  const r = rng('validation');

  const mats = {
    hull: Materials.cdfHull(),
    floor: Materials.cdfFloor(),
    gunmetal: Materials.cdfGunmetal(),
    light: Materials.cdfLight(),
    vess: Materials.vessShell(),
    vessDeep: Materials.vessDeep(),
    wrought: Materials.wroughtSlab(),
    terrain: Materials.terrain(),
  };

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.layers.set(LAYER_WORLD);
    root.add(m);
    return m;
  };

  // Ground
  const ground = new THREE.PlaneGeometry(400, 400, 1, 1);
  add(ground, mats.terrain, 0, 0, 0, -Math.PI / 2);

  // A CDF interior block: walls, a floor plate, and a doorway.
  const wall = new THREE.BoxGeometry(12, 5, 0.5);
  add(wall, mats.hull, 0, 2.5, -8);
  add(new THREE.BoxGeometry(0.5, 5, 16), mats.hull, -6, 2.5, 0);
  add(new THREE.BoxGeometry(0.5, 5, 16), mats.hull, 6, 2.5, 0);
  add(new THREE.BoxGeometry(12, 0.4, 16), mats.floor, 0, 0.2, 0);
  add(new THREE.BoxGeometry(12, 0.4, 16), mats.hull, 0, 5.2, 0);

  // Crates and a pillar — silhouette and AO check.
  for (let i = 0; i < 8; i++) {
    const s = 0.6 + r.next() * 0.7;
    add(
      new THREE.BoxGeometry(s, s, s),
      i % 2 ? mats.light : mats.gunmetal,
      -4 + r.next() * 8,
      0.4 + s / 2,
      -5 + r.next() * 10,
      0,
      r.next() * Math.PI,
      0,
    );
  }
  add(new THREE.CylinderGeometry(0.6, 0.7, 4.6, 12), mats.gunmetal, -3.4, 2.7, 2.0);

  // Vess shell forms — smooth, glossy, emissive seams.
  const shell = new THREE.CapsuleGeometry(1.1, 1.6, 8, 24);
  add(shell, mats.vess, 10, 1.9, -3);
  add(new THREE.SphereGeometry(1.4, 32, 20), mats.vessDeep, 13.5, 1.6, 1);
  add(new THREE.TorusGeometry(1.6, 0.42, 16, 40), mats.vess, 10.5, 2.0, 5, Math.PI / 2.6);

  // Wrought slabs — deep gaps, glowing seams, large motifs.
  add(new THREE.BoxGeometry(8, 9, 1.2), mats.wrought, -16, 4.5, -6);
  add(new THREE.BoxGeometry(1.2, 7, 8), mats.wrought, -21, 3.5, 0);
  add(new THREE.BoxGeometry(6, 0.8, 6), mats.wrought, -17, 0.4, 4);

  // Distance markers for the aerial-perspective gate (ART.md P5): neutral
  // 0.18-albedo slabs at 60 m, 200 m and 500 m.
  const testMat = Materials.plain('#7C7C7C', { roughness: 0.9 });
  for (const d of [60, 200, 500]) {
    const h = d * 0.05;
    add(new THREE.BoxGeometry(h, h, 1), testMat, 0, h / 2, -d);
  }

  // Local lights — exercises the cluster path.
  const clusters = renderer.clusters;
  const cyan = new THREE.Color(...hexToLinear(CDF.opticCyan));
  const warm = new THREE.Color(...hexToLinear(CDF.cautionYellow));
  const vessGlow = new THREE.Color(...hexToLinear(VESS.plasmaCyan));
  const wroughtGlow = new THREE.Color(...hexToLinear(WROUGHT.seamEmissive));

  for (let i = 0; i < 6; i++) {
    clusters.addPointLight(new THREE.Vector3(-4 + i * 1.8, 4.4, -6 + i * 2.2), cyan, 6.0, 9);
  }
  clusters.addPointLight(new THREE.Vector3(11, 2.5, 0), vessGlow, 14.0, 16);
  clusters.addPointLight(new THREE.Vector3(-18, 4.0, -2), wroughtGlow, 12.0, 18);
  clusters.addSpotLight(
    new THREE.Vector3(0, 5.0, 4),
    new THREE.Vector3(0, -1, -0.35),
    warm,
    26.0,
    22,
    38,
    16,
  );

  return { root, mats, clusters };
}
