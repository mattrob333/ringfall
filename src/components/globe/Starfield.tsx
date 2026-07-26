'use client';

/**
 * Stars.
 *
 * Restraint is the entire brief here. This is not a space scene; it is a dark
 * room with one lit object in it, and the stars exist only so the background
 * is not a flat void. Rules:
 *
 *   - No twinkling. Ever. Motion in the background steals attention from the
 *     beacons, which is the one thing on screen that is allowed to move.
 *   - Brightness follows a steep power curve, so the overwhelming majority sit
 *     just above black and a handful read as actual points of light.
 *   - Colour varies over a narrow band from cold blue-white to a faint warm
 *     white. Anything more saturated looks like confetti.
 *   - Distributed by the standard inverse-CDF method (uniform in cos φ), not by
 *     uniform lat/lon, which would clump visibly at the poles.
 *
 * One draw call, one Points object, no per-frame work at all.
 */

import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OUTPUT_GLSL } from './shaderLib';

const VERTEX = /* glsl */ `
attribute float aSize;
attribute float aBrightness;
attribute vec3 aTint;

uniform float uPixelRatio;
uniform float uScale;

varying float vBrightness;
varying vec3 vTint;

void main() {
  vBrightness = aBrightness;
  vTint = aTint;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  // Fixed screen size: stars are infinitely far away, so perspective
  // attenuation would be a lie and, worse, would make them swell on zoom.
  gl_PointSize = aSize * uPixelRatio * uScale;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;

varying float vBrightness;
varying vec3 vTint;

void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  // Soft core with a long tail — a hard disc reads as a dot of paint.
  float a = pow(1.0 - r, 2.4);

  gl_FragColor = vec4(vTint * vBrightness, a * vBrightness * uOpacity);
${OUTPUT_GLSL}
}
`;

export interface StarfieldProps {
  count?: number;
  radius?: number;
  /** Overall gain. Lower it if the panels ever start competing with the sky. */
  opacity?: number;
  /** Deterministic layout — the same sky every session. */
  seed?: number;
}

/** Mulberry32. Deterministic, tiny, good enough for scattering points. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLD = new THREE.Color('#aec6f0');
const WARM = new THREE.Color('#f6ead2');

function StarfieldImpl({
  count = 3200,
  radius = 90,
  opacity = 0.85,
  seed = 0x4d45524944,
}: StarfieldProps) {
  const { geometry, material } = useMemo(() => {
    const rand = rng(seed);

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const brightness = new Float32Array(count);
    const tints = new Float32Array(count * 3);

    const c = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Uniform on the sphere: cos φ uniform in [-1, 1].
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));

      positions[i * 3] = radius * s * Math.cos(theta);
      positions[i * 3 + 1] = radius * u;
      positions[i * 3 + 2] = radius * s * Math.sin(theta);

      // Steep curve: pow(x, 4) puts ~94% of stars below half brightness.
      const b = Math.pow(rand(), 4);
      brightness[i] = 0.12 + b * 0.88;
      sizes[i] = 0.9 + b * 2.6;

      c.copy(COLD).lerp(WARM, Math.pow(rand(), 1.6));
      tints[i * 3] = c.r;
      tints[i * 3 + 1] = c.g;
      tints[i * 3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    g.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.01);

    const m = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uPixelRatio: {
          value:
            typeof window !== 'undefined'
              ? Math.min(window.devicePixelRatio || 1, 2)
              : 1,
        },
        uScale: { value: 1 },
        uOpacity: { value: opacity },
      },
      transparent: true,
      depthWrite: false,
      // Must depth-TEST even though it writes nothing: this material is
      // transparent, so it renders in the transparent pass *after* the opaque
      // planet. Without the test, the sky would draw straight over the globe.
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    return { geometry: g, material: m };
  }, [count, radius, opacity, seed]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-10}
    />
  );
}

export const Starfield = memo(StarfieldImpl);
export default Starfield;
