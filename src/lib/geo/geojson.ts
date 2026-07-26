/**
 * MERIDIAN — GeoJSON → three.js geometry.
 *
 * Everything here works in the projection defined by `./projection.ts`:
 * coordinates arrive as [lon, lat] degrees and leave as points on a sphere.
 *
 * Two problems dominate this file, and both are about the difference between
 * a *map* and a *globe*:
 *
 * 1. DENSIFICATION. GeoJSON stores a coastline as a polyline. A polyline is a
 *    set of chords, and a chord between two points 20° apart on a unit sphere
 *    dips 0.015 units below the surface — fifteen times the height we lift the
 *    landmass by, so the line would visibly tunnel through the planet. We
 *    therefore subdivide every edge until no piece spans more than
 *    {@link MAX_SEGMENT_DEG}, interpolating in lon/lat space (not along a great
 *    circle) because that is the space the source data was authored in: a
 *    border drawn along a parallel must stay on that parallel.
 *
 * 2. THE ANTIMERIDIAN. Natural Earth clips polygons at ±180°, and does it
 *    inconsistently — Fiji, Russia and Antarctica all contain rings where a
 *    point at -180 sits next to a point at +179.4. Read naively, that ring
 *    sweeps all the way around the world in lon/lat space and triangulates into
 *    a garbage band across the Pacific. We fix it by *unwrapping* each ring
 *    sequentially: any step larger than 180° gets ±360 added so the path stays
 *    continuous. Longitude is periodic under projection, so a point at 185°
 *    lands in exactly the same place as one at -175° — unwrapping costs
 *    nothing and makes triangulation correct.
 */

import * as THREE from 'three';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeometryCollection,
  Position,
} from 'geojson';
import { GLOBE_RADIUS, angularDistanceRad } from './projection';

/**
 * Maximum angular span of a rendered edge, in degrees. Below this the chord
 * sag on a unit sphere is r·(1 − cos(θ/2)) ≈ 8.6e-5 — comfortably under the
 * 0.002 lift we give the landmass, so nothing pokes through the ocean.
 */
export const MAX_SEGMENT_DEG = 1.5;

/**
 * Maximum angular span of a *triangle* edge, in degrees.
 *
 * Densifying the rings is necessary but not sufficient: earcut is free to run a
 * diagonal straight across the interior of a polygon, and Antarctica's widest
 * diagonal in the 110m set spans 37°. That chord sinks 1 − cos(18.5°) = 0.052
 * below the surface — twenty-six times the landmass lift, so half a continent
 * would disappear inside the ocean sphere. We therefore refine the triangle
 * mesh after triangulation (see `refineTriangles`). At 4° the worst-case sag is
 * 1 − cos(2°) = 6.1e-4, comfortably inside the 0.002 lift.
 */
export const MAX_TRIANGLE_EDGE_DEG = 4;

/** Hard ceiling on subdivisions per source edge, so pathological data can't blow memory. */
const MAX_SUBDIVISIONS = 64;

/** Refinement passes; each halves the offending edges, so this is generous. */
const MAX_REFINE_PASSES = 8;

const DEG = Math.PI / 180;
const MAX_SEGMENT_RAD = MAX_SEGMENT_DEG * DEG;

/** Anything we know how to read. */
export type GeoSource = FeatureCollection | Feature | Geometry;

// ─────────────────────────────────────────────────────────────────────────────
// Caching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keyed on the identity of the parsed GeoJSON object, which the loader keeps in
 * its own module-level cache — so a React StrictMode double-mount, a fast
 * refresh, or two components asking for the same layer all hit this and never
 * re-triangulate. Geometries in here are deliberately never disposed; the set
 * is small, bounded, and lives as long as the page.
 */
const geometryCache = new WeakMap<object, Map<string, THREE.BufferGeometry>>();

function cached(
  source: GeoSource,
  key: string,
  build: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  let byKey = geometryCache.get(source);
  if (!byKey) {
    byKey = new Map();
    geometryCache.set(source, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;
  const built = build();
  byKey.set(key, built);
  return built;
}

/** Drop every cached geometry for one source (or all of them, if omitted). */
export function clearGeometryCache(source?: GeoSource): void {
  if (!source) return; // WeakMap has no clear(); callers hold the sources.
  const byKey = geometryCache.get(source);
  if (!byKey) return;
  for (const g of byKey.values()) g.dispose();
  geometryCache.delete(source);
}

// ─────────────────────────────────────────────────────────────────────────────
// Traversal
// ─────────────────────────────────────────────────────────────────────────────

function geometries(source: GeoSource): Geometry[] {
  const out: Geometry[] = [];

  const visit = (g: Geometry | null | undefined): void => {
    if (!g) return;
    if (g.type === 'GeometryCollection') {
      for (const child of (g as GeometryCollection).geometries) visit(child);
      return;
    }
    out.push(g);
  };

  if (source.type === 'FeatureCollection') {
    for (const f of (source as FeatureCollection).features) visit(f.geometry);
  } else if (source.type === 'Feature') {
    visit((source as Feature).geometry);
  } else {
    visit(source as Geometry);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Longitude unwrapping + densification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make a path's longitudes continuous by removing ±360° seam jumps.
 * Returns a fresh array; the input is never mutated.
 */
export function unwrapLongitudes(path: Position[]): [number, number][] {
  const out: [number, number][] = new Array(path.length);
  let offset = 0;
  let prevLon = 0;

  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const rawLon = p[0];
    const lat = p[1];

    if (i > 0) {
      const delta = rawLon + offset - prevLon;
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }

    const lon = rawLon + offset;
    out[i] = [lon, lat];
    prevLon = lon;
  }

  return out;
}

/**
 * Arc length, in radians, of the lon/lat-*linear* path between two points —
 * which is the curve we actually draw, and which is emphatically not the great
 * circle between them.
 *
 * This distinction bites near the poles. The edge from (117°E, 83°S) to
 * (55°W, 84°S) in Antarctica's outline has a great-circle separation of 13°,
 * but the path we render follows the parallel and is 22° long. Measuring with
 * haversine would under-subdivide it by a factor of two and leave a visible
 * chord cutting under the ice shelf.
 *
 * We take the equator-most endpoint's cosine, which makes the estimate
 * conservative (never short) for edges running toward a pole. Away from the
 * poles it degenerates to the ordinary angular distance.
 */
export function pathSpanRad(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const dLat = (latB - latA) * DEG;
  const dLon = (lonB - lonA) * DEG;
  const cosLat = Math.max(Math.cos(latA * DEG), Math.cos(latB * DEG));
  return Math.hypot(dLat, dLon * cosLat);
}

/**
 * Subdivide a path (already unwrapped) so no edge spans more than
 * {@link MAX_SEGMENT_DEG}. Interpolation is linear in lon/lat, which is the
 * space the source authored.
 *
 * Zero-length edges — common at the antimeridian seam after unwrapping, and at
 * the poles — are collapsed.
 */
export function densifyPath(
  path: readonly [number, number][],
  maxSegmentRad = MAX_SEGMENT_RAD,
): [number, number][] {
  if (path.length === 0) return [];

  const out: [number, number][] = [];
  out.push([path[0][0], path[0][1]]);

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];

    const dLon = b[0] - a[0];
    const dLat = b[1] - a[1];

    if (dLon === 0 && dLat === 0) continue; // collapse duplicates

    const span = pathSpanRad(a[0], a[1], b[0], b[1]);

    const steps = Math.min(
      MAX_SUBDIVISIONS,
      Math.max(1, Math.ceil(span / maxSegmentRad)),
    );

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([a[0] + dLon * t, a[1] + dLat * t]);
    }
  }

  return out;
}

/** Unwrap + densify in one go. */
function prepare(path: Position[]): [number, number][] {
  return densifyPath(unwrapLongitudes(path));
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection helper (inlined for hot loops)
// ─────────────────────────────────────────────────────────────────────────────

function project(
  lon: number,
  lat: number,
  radius: number,
  out: Float32Array,
  at: number,
): void {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  out[at] = radius * cosPhi * Math.cos(lambda);
  out[at + 1] = radius * Math.sin(phi);
  out[at + 2] = -radius * cosPhi * Math.sin(lambda);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an indexed `LineSegments`-compatible geometry from any GeoJSON source.
 *
 * Polygons contribute their rings as closed outlines, so this doubles as a
 * country-outline builder if you ever want one.
 *
 * @param radius Sphere radius the line sits on.
 * @param lift   Absolute offset added to `radius`, in world units. Positive
 *               values push the line off the surface so it wins the depth test
 *               against the ocean sphere.
 */
export function buildLineGeometry(
  source: GeoSource,
  radius: number = GLOBE_RADIUS,
  lift = 0.0025,
): THREE.BufferGeometry {
  return cached(source, `line:${radius}:${lift}`, () =>
    buildLineGeometryUncached(source, radius, lift),
  );
}

export function buildLineGeometryUncached(
  source: GeoSource,
  radius: number = GLOBE_RADIUS,
  lift = 0.0025,
): THREE.BufferGeometry {
  const r = radius + lift;
  const paths: [number, number][][] = [];

  for (const g of geometries(source)) {
    switch (g.type) {
      case 'LineString':
        paths.push(prepare(g.coordinates));
        break;
      case 'MultiLineString':
        for (const line of g.coordinates) paths.push(prepare(line));
        break;
      case 'Polygon':
        for (const ring of g.coordinates) paths.push(prepare(closeRing(ring)));
        break;
      case 'MultiPolygon':
        for (const poly of g.coordinates) {
          for (const ring of poly) paths.push(prepare(closeRing(ring)));
        }
        break;
      default:
        break; // Points carry no line information.
    }
  }

  let vertexCount = 0;
  let segmentCount = 0;
  for (const p of paths) {
    if (p.length < 2) continue;
    vertexCount += p.length;
    segmentCount += p.length - 1;
  }

  const positions = new Float32Array(vertexCount * 3);
  const indices =
    vertexCount > 65_535
      ? new Uint32Array(segmentCount * 2)
      : new Uint16Array(segmentCount * 2);

  let v = 0;
  let ix = 0;

  for (const p of paths) {
    if (p.length < 2) continue;
    const base = v;
    for (let i = 0; i < p.length; i++) {
      project(p[i][0], p[i][1], r, positions, v * 3);
      v++;
    }
    for (let i = 0; i < p.length - 1; i++) {
      indices[ix++] = base + i;
      indices[ix++] = base + i + 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** GeoJSON rings are meant to be closed; a few sources forget. */
function closeRing(ring: Position[]): Position[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

// ─────────────────────────────────────────────────────────────────────────────
// Land
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conforming adaptive refinement, in lon/lat space.
 *
 * This is textbook red–green refinement. Marking happens per *edge*, not per
 * triangle, and midpoints live in a map keyed on the (sorted) vertex-index
 * pair — so two triangles sharing an edge always agree on whether it splits
 * and where. That is what keeps the mesh watertight: no T-junctions, no
 * hairline cracks showing the ocean through the land.
 *
 * Per pass, a triangle with 1 / 2 / 3 marked edges becomes 2 / 3 / 4
 * triangles. Winding is preserved in every case (verified against a CCW
 * reference triangle), so front faces stay front faces after projection.
 *
 * @param verts Flat [lon, lat, lon, lat, …]. Mutated — midpoints are appended.
 * @param faces Flat index triples. Not mutated; a new array is returned.
 */
function refineTriangles(
  verts: number[],
  faces: number[],
  maxEdgeRad: number,
): number[] {
  let current = faces;

  for (let pass = 0; pass < MAX_REFINE_PASSES; pass++) {
    const midpoints = new Map<number, number>();
    let marked = 0;

    const key = (a: number, b: number): number =>
      a < b ? a * 16_777_216 + b : b * 16_777_216 + a;

    const tooLong = (a: number, b: number): boolean =>
      pathSpanRad(
        verts[a * 2],
        verts[a * 2 + 1],
        verts[b * 2],
        verts[b * 2 + 1],
      ) > maxEdgeRad;

    // Pass 1 — mark.
    for (let f = 0; f < current.length; f += 3) {
      const v = [current[f], current[f + 1], current[f + 2]];
      for (let e = 0; e < 3; e++) {
        const a = v[e];
        const b = v[(e + 1) % 3];
        const k = key(a, b);
        if (midpoints.has(k)) continue;
        if (tooLong(a, b)) {
          midpoints.set(k, -1);
          marked++;
        }
      }
    }

    if (marked === 0) break;

    // Pass 2 — materialise the midpoints (linear in lon/lat, matching the
    // space the source data was authored in).
    for (const k of midpoints.keys()) {
      const a = Math.floor(k / 16_777_216);
      const b = k % 16_777_216;
      const index = verts.length / 2;
      verts.push(
        (verts[a * 2] + verts[b * 2]) / 2,
        (verts[a * 2 + 1] + verts[b * 2 + 1]) / 2,
      );
      midpoints.set(k, index);
    }

    // Pass 3 — rebuild.
    const next: number[] = [];
    for (let f = 0; f < current.length; f += 3) {
      const v = [current[f], current[f + 1], current[f + 2]];
      const m = [
        midpoints.get(key(v[0], v[1])) ?? -1,
        midpoints.get(key(v[1], v[2])) ?? -1,
        midpoints.get(key(v[2], v[0])) ?? -1,
      ];
      const count = (m[0] >= 0 ? 1 : 0) + (m[1] >= 0 ? 1 : 0) + (m[2] >= 0 ? 1 : 0);

      if (count === 0) {
        next.push(v[0], v[1], v[2]);
        continue;
      }

      if (count === 1) {
        // Rotate so the split edge is (A, B).
        const i = m[0] >= 0 ? 0 : m[1] >= 0 ? 1 : 2;
        const A = v[i];
        const B = v[(i + 1) % 3];
        const C = v[(i + 2) % 3];
        const p = m[i];
        next.push(A, p, C, p, B, C);
        continue;
      }

      if (count === 2) {
        // Rotate so the *un*split edge is (A, B); q splits BC, r splits CA.
        const i = m[0] < 0 ? 0 : m[1] < 0 ? 1 : 2;
        const A = v[i];
        const B = v[(i + 1) % 3];
        const C = v[(i + 2) % 3];
        const q = m[(i + 1) % 3];
        const r = m[(i + 2) % 3];
        next.push(A, B, q, A, q, r, r, q, C);
        continue;
      }

      // count === 3 — the full red split.
      const [a, b, c] = v;
      const [p, q, r] = m;
      next.push(a, p, r, p, b, q, r, q, c, p, q, r);
    }

    current = next;
  }

  return current;
}

/** Signed area of a ring in lon/lat space. Positive = counter-clockwise. */
function signedArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/**
 * Triangulate every polygon in `source` and project the result onto the sphere.
 *
 * Approach, in order:
 *   1. Unwrap the ring's longitudes (see the antimeridian note at the top).
 *   2. Drop GeoJSON's repeated closing vertex — `ShapeUtils.triangulateShape`
 *      strips it destructively and we need our vertex array to match its index
 *      space exactly, so we do it first and deterministically.
 *   3. Densify every edge, so the triangle mesh curves with the sphere instead
 *      of chording through it.
 *   4. Normalise winding — exterior ring counter-clockwise, holes clockwise.
 *      CCW in (lon, lat) maps to outward-facing on the sphere, because
 *      East × North = Up in this projection; that gives correct front faces
 *      with no need for `DoubleSide`.
 *   5. Triangulate in 2D, then project each vertex. Normals are exact — on a
 *      sphere the normal *is* the normalised position — so we set them
 *      analytically rather than averaging face normals.
 *
 * Everything merges into one BufferGeometry: one draw call for all land.
 *
 * @param lift Absolute offset added to `radius`, in world units.
 */
export function buildLandGeometry(
  source: GeoSource,
  radius: number = GLOBE_RADIUS,
  lift = 0.002,
  maxEdgeDeg: number = MAX_TRIANGLE_EDGE_DEG,
): THREE.BufferGeometry {
  return cached(source, `land:${radius}:${lift}:${maxEdgeDeg}`, () =>
    buildLandGeometryUncached(source, radius, lift, maxEdgeDeg),
  );
}

export function buildLandGeometryUncached(
  source: GeoSource,
  radius: number = GLOBE_RADIUS,
  lift = 0.002,
  maxEdgeDeg: number = MAX_TRIANGLE_EDGE_DEG,
): THREE.BufferGeometry {
  const r = radius + lift;
  const maxEdgeRad = maxEdgeDeg * DEG;

  const positions: number[] = [];
  const indices: number[] = [];

  const emitPolygon = (rings: Position[][]): void => {
    if (rings.length === 0) return;

    // 1–3: unwrap, strip the closing vertex, densify.
    const prepared: [number, number][][] = [];
    for (const ring of rings) {
      const unwrapped = unwrapLongitudes(ring);
      const open = stripClosingVertex(unwrapped);
      if (open.length < 3) continue;
      // Densify the closed loop, then drop the duplicated final point again.
      const loop = densifyPath([...open, open[0]]);
      const dense = stripClosingVertex(loop);
      if (dense.length >= 3) prepared.push(dense);
    }

    if (prepared.length === 0) return;

    // 4: winding.
    const contour = prepared[0];
    if (signedArea(contour) < 0) contour.reverse();

    const holes = prepared.slice(1);
    for (const hole of holes) {
      if (signedArea(hole) > 0) hole.reverse();
    }

    // 5: triangulate in lon/lat, then project.
    const contourV2 = contour.map((p) => new THREE.Vector2(p[0], p[1]));
    const holesV2 = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));

    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(contourV2, holesV2);
    } catch {
      return; // A ring earcut cannot handle is a ring we skip, not a crash.
    }
    if (faces.length === 0) return;

    // 6: refine. Earcut's diagonals ignore the sphere entirely; this is where
    // the flat triangulation is bent back onto it.
    const localVerts: number[] = [];
    for (const p of contour) localVerts.push(p[0], p[1]);
    for (const hole of holes) {
      for (const p of hole) localVerts.push(p[0], p[1]);
    }

    const flatFaces: number[] = [];
    for (const f of faces) flatFaces.push(f[0], f[1], f[2]);

    const refined = refineTriangles(localVerts, flatFaces, maxEdgeRad);

    const base = positions.length / 3;
    for (let i = 0; i < localVerts.length; i += 2) {
      pushProjected(positions, localVerts[i], localVerts[i + 1], r);
    }
    for (const idx of refined) indices.push(base + idx);
  };

  for (const g of geometries(source)) {
    if (g.type === 'Polygon') {
      emitPolygon(g.coordinates);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) emitPolygon(poly);
    }
  }

  const positionArray = new Float32Array(positions);

  // Exact analytic normals: on a sphere, normal === normalised position.
  const normals = new Float32Array(positionArray.length);
  for (let i = 0; i < positionArray.length; i += 3) {
    const x = positionArray[i];
    const y = positionArray[i + 1];
    const z = positionArray[i + 2];
    const inv = 1 / (Math.hypot(x, y, z) || 1);
    normals[i] = x * inv;
    normals[i + 1] = y * inv;
    normals[i + 2] = z * inv;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(
    positionArray.length / 3 > 65_535
      ? new THREE.BufferAttribute(new Uint32Array(indices), 1)
      : new THREE.BufferAttribute(new Uint16Array(indices), 1),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

function stripClosingVertex(ring: [number, number][]): [number, number][] {
  if (ring.length > 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  }
  return ring;
}

function pushProjected(
  out: number[],
  lon: number,
  lat: number,
  radius: number,
): void {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  out.push(
    radius * cosPhi * Math.cos(lambda),
    radius * Math.sin(phi),
    -radius * cosPhi * Math.sin(lambda),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Introspection (used by the build-time sanity checks)
// ─────────────────────────────────────────────────────────────────────────────

export interface GeometryStats {
  vertices: number;
  indices: number;
  /** Triangles for land, segments for lines. */
  primitives: number;
  minRadius: number;
  maxRadius: number;
}

export function geometryStats(
  geometry: THREE.BufferGeometry,
  primitiveSize: 2 | 3,
): GeometryStats {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();

  let minRadius = Infinity;
  let maxRadius = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (d < minRadius) minRadius = d;
    if (d > maxRadius) maxRadius = d;
  }

  const indices = index ? index.count : 0;
  return {
    vertices: pos.count,
    indices,
    primitives: indices / primitiveSize,
    minRadius: pos.count ? minRadius : 0,
    maxRadius,
  };
}
