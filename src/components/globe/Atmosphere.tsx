'use client';

/**
 * Atmosphere.
 *
 * Two back-faced shells, both additive, both writing no depth:
 *
 *   1.025  the atmosphere proper — a tight fresnel ring hugging the limb
 *   1.140  outer haze — a wide, very faint bloom that gives the planet mass
 *
 * Rendering the *back* faces is the trick. At the silhouette the view ray
 * grazes the shell and the fresnel term goes to one; anywhere in front of the
 * planet the ray hits the shell head-on and the term goes to zero, so the glow
 * never washes over the surface. The near hemisphere of the shell is discarded
 * by back-face culling and the far hemisphere is depth-rejected by the ocean
 * sphere, leaving exactly the ring around the edge.
 *
 * The glow is also sun-weighted: strongest where the atmosphere is actually
 * being lit, falling to a cold trace on the night limb. Without that it reads
 * as a decal.
 */

import { memo, useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLOBE_RADIUS } from '@/lib/geo/projection';
import { useSunDirection } from './useSun';
import { DAYNIGHT_GLSL, OUTPUT_GLSL } from './shaderLib';

const R = GLOBE_RADIUS;

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform vec3 uDuskColor;
uniform float uPower;
uniform float uIntensity;
uniform float uNightFloor;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${DAYNIGHT_GLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // On a back-faced shell this is ~1 at the silhouette and ~0 dead ahead.
  float rim = 1.0 - abs(dot(N, V));
  float glow = pow(clamp(rim, 0.0, 1.0), uPower);

  float sun = dot(N, uSunDir);
  float day = dayFactor(sun);
  float lit = mix(uNightFloor, 1.0, day);

  vec3 col = uColor * glow * lit;

  // Sunrise/sunset warms the limb where the light is grazing through the most
  // air. Same trick as the surface dusk band, one shell out.
  col += uDuskColor * glow * duskBand(sun, 0.22) * 0.55;

  gl_FragColor = vec4(col * uIntensity, glow * lit * uIntensity);
${OUTPUT_GLSL}
}
`;

interface ShellConfig {
  radius: number;
  color: string;
  duskColor: string;
  power: number;
  intensity: number;
  nightFloor: number;
  segments: number;
}

const SHELLS: ShellConfig[] = [
  {
    radius: R * 1.025,
    color: '#4d86d8',
    duskColor: '#e0904a',
    power: 3.0,
    intensity: 0.85,
    nightFloor: 0.16,
    segments: 96,
  },
  {
    radius: R * 1.14,
    color: '#2b5a9e',
    duskColor: '#8a5a30',
    power: 5.2,
    intensity: 0.32,
    nightFloor: 0.3,
    segments: 64,
  },
];

function AtmosphereImpl() {
  const sunDir = useSunDirection();

  const shells = useMemo(
    () =>
      SHELLS.map((cfg) => ({
        cfg,
        geometry: new THREE.SphereGeometry(cfg.radius, cfg.segments, cfg.segments / 2),
        material: new THREE.ShaderMaterial({
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          uniforms: {
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uColor: { value: new THREE.Color(cfg.color) },
            uDuskColor: { value: new THREE.Color(cfg.duskColor) },
            uPower: { value: cfg.power },
            uIntensity: { value: cfg.intensity },
            uNightFloor: { value: cfg.nightFloor },
          },
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      })),
    [],
  );

  useLayoutEffect(() => {
    for (const s of shells) {
      (s.material.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    }
  }, [shells, sunDir]);

  useEffect(
    () => () => {
      for (const s of shells) {
        s.geometry.dispose();
        s.material.dispose();
      }
    },
    [shells],
  );

  return (
    <group>
      {shells.map((s, i) => (
        <mesh
          key={i}
          geometry={s.geometry}
          material={s.material}
          renderOrder={20 + i}
        />
      ))}
    </group>
  );
}

export const Atmosphere = memo(AtmosphereImpl);
export default Atmosphere;
