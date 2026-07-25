// L4 world — terrain heightfield. OWNER: `worldart` (S3).
//
// ART.md §2 caps noise at 4 cycles/m. Terrain is authored from a handful of
// explicit low-frequency shapes rather than FBM so the silhouette is designed
// rather than emergent, and so it is trivially reproducible in the physics
// heightfield (the mesh and the collider evaluate the SAME function).

import * as THREE from 'three';
import { LAYER_WORLD } from '../render/index.js';
import { Materials } from '../materials/index.js';
import { SurfaceId } from '../shared/enums.js';

export const TERRAIN_SIZE = 420;
export const TERRAIN_RES = 168; // 2.5 m cells
const CELL = TERRAIN_SIZE / TERRAIN_RES;

/**
 * The single authoritative height function. Render mesh and physics collider
 * both call this; they cannot disagree.
 */
export function heightAt(x, z) {
  // A broad basin so the arena drains toward the middle.
  const r = Math.hypot(x, z);
  let h = -3.2 * Math.exp(-(r * r) / (2 * 120 * 120));

  // Ridges framing the playable space.
  h += 5.5 * Math.exp(-Math.pow((x + 96) / 42, 2)) * (1 + 0.3 * Math.sin(z * 0.021));
  h += 6.2 * Math.exp(-Math.pow((x - 104) / 46, 2)) * (1 + 0.3 * Math.cos(z * 0.018));
  h += 7.0 * Math.exp(-Math.pow((z + 118) / 50, 2));
  h += 4.4 * Math.exp(-Math.pow((z - 112) / 44, 2));

  // Two gentle rolls across the field. Wavelengths ~90 m and ~55 m.
  h += 1.35 * Math.sin(x * 0.070) * Math.cos(z * 0.055);
  h += 0.55 * Math.sin(x * 0.114 + 1.7) * Math.sin(z * 0.098 - 0.4);

  // Flatten the building pads so structures sit level.
  h *= 1 - 0.92 * pad(x, z, 0, -46, 22, 18);
  h *= 1 - 0.92 * pad(x, z, -62, 8, 26, 22);
  h *= 1 - 0.88 * pad(x, z, 58, -6, 26, 24);
  return h;
}

/** Smooth 0..1 plateau mask, 1 inside the pad. */
function pad(x, z, cx, cz, hw, hd) {
  const dx = Math.abs(x - cx) / hw;
  const dz = Math.abs(z - cz) / hd;
  const d = Math.max(dx, dz);
  return 1 - Math.min(1, Math.max(0, (d - 0.75) / 0.55));
}

export function buildTerrain(physics) {
  const n = TERRAIN_RES + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const heights = new Float32Array(n * n);
  const half = TERRAIN_SIZE / 2;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const x = -half + i * CELL;
      const z = -half + j * CELL;
      const y = heightAt(x, z);
      heights[idx] = y;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
      uvs[idx * 2] = i / TERRAIN_RES;
      uvs[idx * 2 + 1] = j / TERRAIN_RES;
    }
  }

  // Analytic-ish normals from central differences on the real height function,
  // which gives smoother shading than face normals at this cell size.
  const e = CELL * 0.5;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const x = -half + i * CELL;
      const z = -half + j * CELL;
      const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const len = Math.hypot(-dx, 1, -dz);
      normals[idx * 3] = -dx / len;
      normals[idx * 3 + 1] = 1 / len;
      normals[idx * 3 + 2] = -dz / len;
    }
  }

  const indices = new Uint32Array(TERRAIN_RES * TERRAIN_RES * 6);
  let k = 0;
  for (let j = 0; j < TERRAIN_RES; j++) {
    for (let i = 0; i < TERRAIN_RES; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, Materials.terrain());
  mesh.layers.set(LAYER_WORLD);
  mesh.name = 'terrain';

  if (physics?.setHeightfield) {
    physics.setHeightfield({
      origin: new THREE.Vector3(-half, 0, -half),
      cellSize: CELL,
      width: n,
      depth: n,
      heights,
      surfaceId: SurfaceId.GRASS,
    });
  }

  return { mesh, heights, heightAt, cellSize: CELL, size: TERRAIN_SIZE };
}
