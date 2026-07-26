/**
 * MERIDIAN — spherical projection primitives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONVENTION (every other subsystem depends on this — do not change it)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Given latitude φ (degrees, +N) and longitude λ (degrees, +E) on a sphere of
 * radius r, we map to three.js world space as:
 *
 *     x =  r · cos φ · cos λ
 *     y =  r · sin φ
 *     z = -r · cos φ · sin λ
 *
 * Consequences, stated explicitly so beacons land on the right country:
 *
 *   • (0°N, 0°E)   — the Gulf of Guinea — sits at (+r, 0, 0).
 *   • (0°N, 90°E)  — Sumatra            — sits at (0, 0, -r).
 *   • (0°N, 90°W)  — the Galápagos      — sits at (0, 0, +r), i.e. facing a
 *     camera parked on the default +Z axis.
 *   • The north pole is +Y. The south pole is -Y.
 *
 * Handedness check (this is the part that gets mirrored if you are careless):
 * the local East and North tangents at (0,0) are
 *
 *     East  = ∂P/∂λ = (0, 0, -1)
 *     North = ∂P/∂φ = (0, 1, 0)
 *     East × North = (1, 0, 0) = the outward normal = Up
 *
 * East × North = Up is the ENU right-handed convention, so the globe reads
 * correctly rather than mirrored: viewed from above the north pole, longitude
 * increases counter-clockwise, exactly as the real Earth turns.
 *
 * The surface normal at any point is simply `position.normalize()` — we never
 * need a normal attribute for sphere-conforming geometry.
 */

import * as THREE from 'three';
import type { GeoPoint } from '@/lib/types';

/** The one true globe radius. Everything else is expressed in multiples. */
export const GLOBE_RADIUS = 1;

/** Mean Earth radius in nautical miles (WGS-84 mean, 6371.0088 km / 1.852). */
export const EARTH_RADIUS_NM = 3440.0647948;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Project a geographic coordinate onto the sphere.
 *
 * @param lat    Degrees, -90..90.
 * @param lon    Degrees, -180..180 (values outside wrap harmlessly).
 * @param radius Sphere radius; defaults to {@link GLOBE_RADIUS}.
 * @param target Optional Vector3 to write into, to avoid allocation in loops.
 */
export function latLonToVec3(
  lat: number,
  lon: number,
  radius: number = GLOBE_RADIUS,
  target?: THREE.Vector3,
): THREE.Vector3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);

  const x = radius * cosPhi * Math.cos(lambda);
  const y = radius * Math.sin(phi);
  const z = -radius * cosPhi * Math.sin(lambda);

  return target ? target.set(x, y, z) : new THREE.Vector3(x, y, z);
}

/** Convenience overload for the domain type. */
export function geoToVec3(
  p: GeoPoint,
  radius: number = GLOBE_RADIUS,
  target?: THREE.Vector3,
): THREE.Vector3 {
  return latLonToVec3(p.lat, p.lon, radius, target);
}

/**
 * Inverse of {@link latLonToVec3}. The vector need not be normalised; only its
 * direction is used.
 */
export function vec3ToLatLon(v: THREE.Vector3): GeoPoint {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return { lat: 0, lon: 0 };
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / len, -1, 1)) * RAD;
  const lon = Math.atan2(-v.z, v.x) * RAD;
  return { lat, lon };
}

/** Local outward normal (== unit position vector) for a geographic point. */
export function surfaceNormal(p: GeoPoint, target?: THREE.Vector3): THREE.Vector3 {
  return latLonToVec3(p.lat, p.lon, 1, target);
}

/**
 * Angular separation between two geographic points, in radians.
 * Haversine — numerically stable for the small separations that dominate
 * geometry densification.
 */
export function angularDistanceRad(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Great-circle distance in nautical miles. The social / charter layer sizes
 * aircraft against this, so it uses the mean-radius sphere rather than a
 * spherical-Earth shortcut: expect ≲0.3% error versus a proper geodesic
 * (Vincenty) solution, which is well inside charter-planning tolerance.
 */
export function greatCircleDistanceNm(a: GeoPoint, b: GeoPoint): number {
  return angularDistanceRad(a, b) * EARTH_RADIUS_NM;
}

/** Kilometres, for anything that would rather not think in nautical miles. */
export function greatCircleDistanceKm(a: GeoPoint, b: GeoPoint): number {
  return angularDistanceRad(a, b) * 6371.0088;
}

/**
 * Points along the great circle from `a` to `b`, bowed above the surface.
 *
 * The arc is a true slerp between the two surface normals, so it follows the
 * shortest path on the sphere. `lift` is the peak altitude at the midpoint,
 * expressed as a fraction of `radius`, tapering to zero at both endpoints with
 * a sine profile — so the arc leaves and meets the ground tangentially-ish
 * rather than spiking.
 *
 * Longer routes bow higher automatically? No — that is a policy decision, and
 * policy belongs to the caller. Scale `lift` yourself if you want it.
 *
 * @param segments Number of subdivisions; the returned array has segments + 1
 *                 points. Clamped to at least 1.
 */
export function greatCirclePoints(
  a: GeoPoint,
  b: GeoPoint,
  segments = 64,
  lift = 0.18,
  radius: number = GLOBE_RADIUS,
): THREE.Vector3[] {
  const n = Math.max(1, Math.floor(segments));
  const from = latLonToVec3(a.lat, a.lon, 1);
  const to = latLonToVec3(b.lat, b.lon, 1);

  const dot = THREE.MathUtils.clamp(from.dot(to), -1, 1);
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  const out: THREE.Vector3[] = new Array(n + 1);

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let dir: THREE.Vector3;

    if (sinOmega < 1e-6) {
      // Coincident or antipodal. Coincident: just hold. Antipodal: the great
      // circle is undefined, so pick any perpendicular and sweep through it.
      if (dot > 0) {
        dir = from.clone();
      } else {
        const axis = Math.abs(from.y) < 0.9
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
        const perp = new THREE.Vector3().crossVectors(from, axis).normalize();
        dir = from
          .clone()
          .multiplyScalar(Math.cos(Math.PI * t))
          .addScaledVector(perp, Math.sin(Math.PI * t));
      }
    } else {
      const s0 = Math.sin((1 - t) * omega) / sinOmega;
      const s1 = Math.sin(t * omega) / sinOmega;
      dir = from.clone().multiplyScalar(s0).addScaledVector(to, s1).normalize();
    }

    const altitude = radius * (1 + lift * Math.sin(Math.PI * t));
    out[i] = dir.multiplyScalar(altitude);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Solar geometry
// ─────────────────────────────────────────────────────────────────────────────

const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0); // 2000-01-01T12:00:00Z

/**
 * The point on the Earth where the sun is directly overhead at `date`.
 *
 * Uses the low-precision solar position algorithm from the Astronomical
 * Almanac (the same one NOAA's solar calculator is built on):
 *
 *   mean longitude   L = 280.460° + 0.9856474° · n
 *   mean anomaly     g = 357.528° + 0.9856003° · n
 *   ecliptic long.   λ = L + 1.915° sin g + 0.020° sin 2g
 *   obliquity        ε = 23.439° − 0.0000004° · n
 *   declination      δ = asin(sin ε · sin λ)
 *   right ascension  α = atan2(cos ε · sin λ, cos λ)
 *   equation of time E = L − α        (wrapped to ±180°)
 *   subsolar lon     λs = −15° · (UTC hours − 12) − E
 *
 * ACCURACY BOUND: the almanac's stated bound for this series is 0.01° in
 * ecliptic longitude over 1950–2050, which works out to better than ±0.02° in
 * declination and roughly ±0.1° (≈ 25 seconds of time) in the equation of
 * time. At globe scale one degree is about 1.7 screen pixels on a 1000px
 * sphere, so the terminator is exact for our purposes. It ignores nutation,
 * aberration, and the ~0.26° solar radius / atmospheric refraction that make
 * the *civil* terminator sit slightly on the night side of the geometric one —
 * we render a soft band anyway, which swallows all of it.
 */
export function subsolarPoint(date: Date): GeoPoint {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return { lat: 0, lon: 0 };

  /** Days (and fraction) since the J2000.0 epoch. */
  const n = (ms - J2000) / 86_400_000;

  const meanLongitude = 280.46 + 0.9856474 * n;
  const meanAnomaly = (357.528 + 0.9856003 * n) * DEG;

  const eclipticLongitude =
    (meanLongitude +
      1.915 * Math.sin(meanAnomaly) +
      0.02 * Math.sin(2 * meanAnomaly)) *
    DEG;

  const obliquity = (23.439 - 0.0000004 * n) * DEG;

  const sinDec = Math.sin(obliquity) * Math.sin(eclipticLongitude);
  const declination = Math.asin(THREE.MathUtils.clamp(sinDec, -1, 1)) * RAD;

  const rightAscension =
    Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLongitude),
      Math.cos(eclipticLongitude),
    ) * RAD;

  // Equation of time, in degrees, wrapped to ±180.
  const equationOfTime = wrapDegrees(normalizeDegrees(meanLongitude) - rightAscension);

  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3_600_000;

  const lon = wrapDegrees(-15 * (utcHours - 12) - equationOfTime);

  return { lat: declination, lon };
}

/** Unit vector pointing from the Earth's centre toward the sun. */
export function sunDirection(date: Date, target?: THREE.Vector3): THREE.Vector3 {
  const p = subsolarPoint(date);
  return latLonToVec3(p.lat, p.lon, 1, target);
}

/** Fold an angle into [0, 360). */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Fold an angle into [-180, 180). */
export function wrapDegrees(deg: number): number {
  return normalizeDegrees(deg + 180) - 180;
}

/**
 * The camera's orbital angles that put `p` dead centre in frame, given the
 * projection above. Returns spherical coordinates where
 *   position = (sin φ sin θ, cos φ, sin φ cos θ) · distance
 * matches three.js `Spherical(radius, phi, theta)`.
 */
export function geoToSpherical(p: GeoPoint, distance: number): THREE.Spherical {
  const v = latLonToVec3(p.lat, p.lon, distance);
  return new THREE.Spherical().setFromVector3(v);
}
