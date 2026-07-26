'use client';

/**
 * The body itself.
 *
 * Five layers, all sharing one sun:
 *
 *   1.0000  ocean sphere       — opaque, writes depth, occludes everything behind
 *   1.0020  landmass           — filled countries, one merged mesh
 *   1.0028  graticule          — 15° grid, barely there
 *   1.0032  coastline + borders — brass hairlines
 *
 * The lifts are tiny and deliberate: they have to clear the chord sag of the
 * geometry below them (≈6e-4 at our densification) without becoming visible as
 * altitude when you look at the limb edge-on.
 *
 * The day/night terminator is not a texture or an overlay — every layer shades
 * itself by dot(normal, sunDirection), so the line runs continuously across
 * ocean, land and borders with no seams to hide.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { GLOBE_RADIUS } from '@/lib/geo/projection';
import { buildLandGeometry, buildLineGeometry } from '@/lib/geo/geojson';
import { GEO_LAYERS, useGeoLayer } from './useGeoLayer';
import { useSunDirection } from './useSun';
import {
  DAYNIGHT_GLSL,
  OUTPUT_GLSL,
  SURFACE_VERTEX_GLSL,
  VALUE_NOISE_GLSL,
} from './shaderLib';

const R = GLOBE_RADIUS;

const LIFT_LAND = 0.002;
const LIFT_GRATICULE = 0.0028;
const LIFT_LINES = 0.0032;

/** Switch to the 1.6MB 50m country set once the camera is this close, in radii. */
const DETAIL_DISTANCE = 2.05;

// ─────────────────────────────────────────────────────────────────────────────
// Ocean
// ─────────────────────────────────────────────────────────────────────────────

const OCEAN_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uNight;
uniform vec3 uDeep;
uniform vec3 uLit;
uniform vec3 uRim;
uniform vec3 uDusk;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${DAYNIGHT_GLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  float sun = dot(N, uSunDir);
  float day = dayFactor(sun);

  // Soft lambert so the sub-solar point is the brightest water on the globe,
  // rather than the whole day side reading as one flat value.
  float lambert = pow(max(sun, 0.0), 0.8);

  vec3 col = mix(uNight, uDeep, day);
  col += uLit * lambert * 0.60;

  // Grazing light at the terminator. Narrow, warm, and the single most
  // important twelve pixels on the screen.
  col += uDusk * duskBand(sun, 0.15) * 0.30;

  // Fresnel limb — the edge catches light even where the surface does not.
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.4);
  col += uRim * fres * (0.22 + 0.90 * day);

  gl_FragColor = vec4(col, 1.0);
${OUTPUT_GLSL}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Land
// ─────────────────────────────────────────────────────────────────────────────

const LAND_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uDay;
uniform vec3 uNight;
uniform vec3 uGlow;
uniform vec3 uDusk;
uniform float uOpacity;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${DAYNIGHT_GLSL}
${VALUE_NOISE_GLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  float sun = dot(N, uSunDir);
  float day = dayFactor(sun);
  float lambert = pow(max(sun, 0.0), 0.9);

  vec3 col = mix(uNight, uDay, day);
  col += uDay * lambert * 0.35;

  // Night side: scattered warm settlement glow.
  //
  // Frequency is the whole game here. At 13 cycles across the globe each noise
  // cell is ~3000km, so the "lights" came out as continent-sized clouds that
  // read as a blurry heightmap rather than as inhabited land. 96 puts a cell at
  // roughly 400km — small enough to read as clusters at this camera distance,
  // and still far below the point where value noise starts to alias when the
  // globe is zoomed out. The threshold is tightened alongside it so only the
  // top of the noise range lifts and most of the night side stays genuinely
  // dark; without that, raising the frequency just produces uniform haze.
  float lights = valueNoise(N * 96.0) * 0.62 + valueNoise(N * 232.0) * 0.38;
  lights = smoothstep(0.60, 0.90, lights);
  col += uGlow * lights * (1.0 - day) * 0.5;

  col += uDusk * duskBand(sun, 0.13) * 0.22;

  // A dim rim so continents keep an edge against the ocean at the limb.
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 4.0);
  col += uDay * fres * 0.35;

  gl_FragColor = vec4(col, uOpacity);
${OUTPUT_GLSL}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Lines
// ─────────────────────────────────────────────────────────────────────────────

const LINE_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uNightFloor;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${DAYNIGHT_GLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  float sun = dot(N, uSunDir);
  float day = dayFactor(sun);

  // Lines dim into the dark side rather than vanishing — a border you can just
  // make out at night is atmosphere; one that disappears is a bug report.
  float a = uOpacity * mix(uNightFloor, 1.0, day);
  a += uOpacity * duskBand(sun, 0.12) * 0.5;

  gl_FragColor = vec4(uColor, a);
${OUTPUT_GLSL}
}
`;

// ─────────────────────────────────────────────────────────────────────────────

interface SunUniform {
  value: THREE.Vector3;
}

function makeLineMaterial(color: string, opacity: number, nightFloor: number) {
  return new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERTEX_GLSL,
    fragmentShader: LINE_FRAGMENT,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) } satisfies SunUniform,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uNightFloor: { value: nightFloor },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

export interface EarthProps {
  /** Fired once the ocean, land and coastline are all up. */
  onLoaded?: () => void;
}

function EarthImpl({ onLoaded }: EarthProps) {
  const showLandmass = useGlobeStore((s) => s.showLandmass);
  const showGraticule = useGlobeStore((s) => s.showGraticule);
  const quality = useGlobeStore((s) => s.quality);

  const sunDir = useSunDirection();

  // ── Detail escalation ─────────────────────────────────────────────────────
  // The 50m set is 1.6MB. We only ask for it once the camera has committed to
  // being close, and we never drop back — re-parsing on every zoom out would be
  // worse than the memory.
  const wantsDetail = useRef(false);
  const [detailUrl, setDetailUrl] = useState<string | null>(null);

  useFrame(({ camera }) => {
    if (wantsDetail.current || quality === 'economy') return;
    if (camera.position.length() < DETAIL_DISTANCE) {
      wantsDetail.current = true;
      setDetailUrl(GEO_LAYERS.countries50m);
    }
  });

  const countries110 = useGeoLayer(GEO_LAYERS.countries110m);
  const countries50 = useGeoLayer(detailUrl);
  const coastline = useGeoLayer(GEO_LAYERS.coastline110m);
  const borders = useGeoLayer(GEO_LAYERS.borders110m);
  const graticule = useGeoLayer(showGraticule ? GEO_LAYERS.graticule : null);

  // ── Geometry ──────────────────────────────────────────────────────────────
  const oceanGeometry = useMemo(() => new THREE.SphereGeometry(R, 128, 96), []);

  const baseLand = useMemo(
    () => (countries110 ? buildLandGeometry(countries110, R, LIFT_LAND) : null),
    [countries110],
  );

  // Triangulating the 50m set costs ~200ms on the main thread. Doing it inside
  // a render — which is where a plain `useMemo` would put it — freezes the
  // frame at precisely the moment the user is zooming in, which is the worst
  // possible moment. Build it during idle time and swap only once it is ready;
  // until then the 110m mesh carries on, and the transition is invisible.
  const [detailLand, setDetailLand] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (!countries50) return;

    let cancelled = false;
    const build = () => {
      if (cancelled) return;
      setDetailLand(buildLandGeometry(countries50, R, LIFT_LAND));
    };

    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(build, { timeout: 3000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(build, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [countries50]);

  const landGeometry = detailLand ?? baseLand;
  const coastGeometry = useMemo(
    () => (coastline ? buildLineGeometry(coastline, R, LIFT_LINES) : null),
    [coastline],
  );
  const borderGeometry = useMemo(
    () => (borders ? buildLineGeometry(borders, R, LIFT_LINES) : null),
    [borders],
  );
  const graticuleGeometry = useMemo(
    () => (graticule ? buildLineGeometry(graticule, R, LIFT_GRATICULE) : null),
    [graticule],
  );

  // ── Materials ─────────────────────────────────────────────────────────────
  const oceanMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SURFACE_VERTEX_GLSL,
        fragmentShader: OCEAN_FRAGMENT,
        uniforms: {
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uNight: { value: new THREE.Color('#02040a') },
          uDeep: { value: new THREE.Color('#0a1220') },
          uLit: { value: new THREE.Color('#16304d') },
          uRim: { value: new THREE.Color('#4b86c8') },
          uDusk: { value: new THREE.Color('#c8a866') },
        },
      }),
    [],
  );

  const landMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SURFACE_VERTEX_GLSL,
        fragmentShader: LAND_FRAGMENT,
        uniforms: {
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uDay: { value: new THREE.Color('#2b3348') },
          uNight: { value: new THREE.Color('#0c1120') },
          uGlow: { value: new THREE.Color('#8a6a34') },
          uDusk: { value: new THREE.Color('#d8a862') },
          uOpacity: { value: 1 },
        },
        transparent: false,
        // 0.5% of the triangulated area comes out inward-facing — degenerate
        // slivers at the poles where the lon/lat plane collapses, mostly in
        // Antarctica. DoubleSide costs nothing here (the far hemisphere is
        // occluded by the opaque ocean sphere) and guarantees no holes.
        side: THREE.DoubleSide,
      }),
    [],
  );

  const coastMaterial = useMemo(() => makeLineMaterial('#c8a866', 0.34, 0.22), []);
  const borderMaterial = useMemo(() => makeLineMaterial('#8a7038', 0.26, 0.18), []);
  const graticuleMaterial = useMemo(
    () => makeLineMaterial('#4b86c8', 0.075, 0.45),
    [],
  );

  // ── Sun plumbing ──────────────────────────────────────────────────────────
  const materials = useMemo(
    () => [
      oceanMaterial,
      landMaterial,
      coastMaterial,
      borderMaterial,
      graticuleMaterial,
    ],
    [oceanMaterial, landMaterial, coastMaterial, borderMaterial, graticuleMaterial],
  );

  useLayoutEffect(() => {
    for (const m of materials) {
      (m.uniforms.uSunDir as SunUniform).value.copy(sunDir);
    }
  }, [materials, sunDir]);

  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
      oceanGeometry.dispose();
    },
    [materials, oceanGeometry],
  );

  // ── Readiness ─────────────────────────────────────────────────────────────
  const loaded = Boolean(landGeometry && coastGeometry);
  const announced = useRef(false);
  useEffect(() => {
    if (loaded && !announced.current) {
      announced.current = true;
      onLoaded?.();
    }
  }, [loaded, onLoaded]);

  return (
    <group>
      <mesh geometry={oceanGeometry} material={oceanMaterial} renderOrder={0} />

      {showLandmass && landGeometry && (
        <mesh geometry={landGeometry} material={landMaterial} renderOrder={1} />
      )}

      {showGraticule && graticuleGeometry && (
        <lineSegments
          geometry={graticuleGeometry}
          material={graticuleMaterial}
          renderOrder={2}
        />
      )}

      {borderGeometry && (
        <lineSegments
          geometry={borderGeometry}
          material={borderMaterial}
          renderOrder={3}
        />
      )}

      {coastGeometry && (
        <lineSegments
          geometry={coastGeometry}
          material={coastMaterial}
          renderOrder={4}
        />
      )}
    </group>
  );
}

export const Earth = memo(EarthImpl);
export default Earth;
