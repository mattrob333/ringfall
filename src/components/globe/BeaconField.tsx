'use client';

/**
 * The beacon field — cities burning on an obsidian planet.
 *
 * Four instanced meshes, four draw calls, regardless of how many beacons there
 * are. Nothing is a React component per beacon; nothing allocates a material
 * per beacon. At 250 beacons the per-frame cost is ~1000 matrix composes and
 * four small buffer uploads, which is nothing.
 *
 *   pillars  — vertical light shafts along the local normal, additive, fading
 *              out toward the top. Height and radius carry score; opacity and
 *              height carry relevance.
 *   discs    — a tangent glow puddle at the base, so the pillar looks like it
 *              is standing on something.
 *   rings    — expanding pulse rings, blazing/supernova only, phase-staggered
 *              from a hash of the event id.
 *   focus    — a locked brass reticle around the selected event.
 *
 * Occlusion: everything depth-tests against the ocean sphere, so a beacon on
 * the far side is simply behind the planet. The flat surface decals (discs,
 * rings, reticle) additionally fade out across the true horizon in the vertex
 * shader — depth alone would let a disc at the limb peek round the edge.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Beacon } from '@/lib/types';
import { GLOBE_RADIUS } from '@/lib/geo/projection';
import { HORIZON_GLSL, OUTPUT_GLSL } from './shaderLib';
import { useReducedMotion } from './useReducedMotion';
import { BeaconPicker } from './BeaconPicker';
import {
  BeaconRegistry,
  beaconIntensity,
  discRadius,
  focusRadius,
  pillarHeight,
  pillarRadius,
  ringRadius,
  type BeaconEntry,
} from './beaconState';

const R = GLOBE_RADIUS;

/** Surface offsets. Ordered so nothing z-fights with the lines at 0.0032. */
const LIFT_PILLAR = 0.0015;
const LIFT_RING = 0.0040;
const LIFT_DISC = 0.0045;
const LIFT_FOCUS = 0.0050;

const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_Z = new THREE.Vector3(0, 0, 1);

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

const PILLAR_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aIntensity;

varying vec3 vColor;
varying float vIntensity;
varying float vH;

void main() {
  vColor = aColor;
  vIntensity = aIntensity;
  vH = uv.y; // 0 at the base of the cylinder, 1 at the tip

  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif

  vec4 world = modelMatrix * im * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PILLAR_FRAGMENT = /* glsl */ `
uniform float uGain;

varying vec3 vColor;
varying float vIntensity;
varying float vH;

void main() {
  // Dense at the ground, gone by the top. The shaft should look like it is
  // dissipating into the air, not like a cylinder someone forgot to cap.
  float h = clamp(vH, 0.0, 1.0);
  float fall = pow(1.0 - h, 1.8);
  float core = pow(1.0 - h, 5.0);

  float a = fall * vIntensity * uGain;
  vec3 col = vColor * (0.75 + 1.6 * core) * vIntensity;

  gl_FragColor = vec4(col, a);
${OUTPUT_GLSL}
}
`;

/** Shared by every flat surface decal. */
const DECAL_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aIntensity;
attribute float aPhase;

uniform float uGlobeRadius;

varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;
varying float vPhase;
varying float vFacing;

${HORIZON_GLSL}

void main() {
  vUv = uv;
  vColor = aColor;
  vIntensity = aIntensity;
  vPhase = aPhase;

  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif

  mat4 m = modelMatrix * im;
  vec4 world = m * vec4(position, 1.0);
  vec3 centre = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

  vFacing = horizonVisibility(normalize(centre), cameraPosition, uGlobeRadius, 0.05);

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const DISC_FRAGMENT = /* glsl */ `
uniform float uGain;

varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;
varying float vFacing;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;

  float falloff = pow(1.0 - d, 2.8);
  float hotspot = pow(1.0 - d, 12.0);

  float a = (falloff * 0.85 + hotspot) * vIntensity * vFacing * uGain;
  vec3 col = vColor * (1.0 + 1.8 * hotspot) * vIntensity;

  gl_FragColor = vec4(col, a);
${OUTPUT_GLSL}
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uGain;

varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;
varying float vPhase;
varying float vFacing;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;

  float a = 0.0;
  // Two rings in flight at a time, half a cycle apart. More than that and it
  // stops reading as a heartbeat and starts reading as a target lock.
  //
  // Note the squared local rather than pow(x, 2.0): pow() is undefined for a
  // negative base in GLSL, and (d - t) is negative for every fragment inside
  // the ring. Some drivers return NaN there, which shows up as black confetti.
  for (int i = 0; i < 2; i++) {
    float t = fract(uTime * uSpeed + vPhase + float(i) * 0.5);
    float w = 0.075 + 0.06 * t;
    float u = (d - t) / w;
    float band = exp(-u * u);
    a += band * (1.0 - t) * (1.0 - t);
  }

  a *= vIntensity * vFacing * uGain;
  gl_FragColor = vec4(vColor * 1.25 * vIntensity, a);
${OUTPUT_GLSL}
}
`;

const FOCUS_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uGain;

varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;
varying float vFacing;

void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  if (d > 1.0) discard;

  float ang = atan(p.y, p.x);

  // A sustained inner ring — this one does not expand, it holds. That is the
  // whole difference between "this is hot" and "this is the one you picked".
  float breathe = 0.008 * sin(uTime * 1.4);
  float ui = (d - (0.62 + breathe)) / 0.028;
  float inner = exp(-ui * ui);

  // Four ticks on an outer arc.
  float ticks = smoothstep(0.82, 0.94, abs(cos(ang * 2.0)));
  float uo = (d - 0.93) / 0.030;
  float outer = exp(-uo * uo) * ticks;

  float a = (inner * 0.85 + outer) * vIntensity * vFacing * uGain;
  gl_FragColor = vec4(vColor * vIntensity * 1.15, a);
${OUTPUT_GLSL}
}
`;

// ─────────────────────────────────────────────────────────────────────────────

interface InstancedLayer {
  geometry: THREE.BufferGeometry;
  color: THREE.InstancedBufferAttribute;
  intensity: THREE.InstancedBufferAttribute;
  phase: THREE.InstancedBufferAttribute;
}

function makeLayer(base: THREE.BufferGeometry, capacity: number): InstancedLayer {
  const geometry = base.clone();

  const color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const intensity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);

  color.setUsage(THREE.DynamicDrawUsage);
  intensity.setUsage(THREE.DynamicDrawUsage);
  phase.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('aColor', color);
  geometry.setAttribute('aIntensity', intensity);
  geometry.setAttribute('aPhase', phase);

  return { geometry, color, intensity, phase };
}

/** Round up to the next power of two, floored at 64. */
function capacityFor(n: number): number {
  if (n <= 64) return 64;
  return 1 << Math.ceil(Math.log2(n));
}

export interface BeaconFieldProps {
  beacons: Beacon[];
}

function BeaconFieldImpl({ beacons }: BeaconFieldProps) {
  const reducedMotion = useReducedMotion();

  const registry = useMemo(() => new BeaconRegistry(), []);
  // Derived-during-render, deliberately: the registry must see a new beacon
  // array before the frame that draws it, and an effect would be one frame late.
  useMemo(() => registry.sync(beacons), [registry, beacons]);

  const [capacity, setCapacity] = useState(() => capacityFor(beacons.length));
  useEffect(() => {
    const needed = capacityFor(Math.max(beacons.length, registry.size));
    if (needed > capacity) setCapacity(needed);
  }, [beacons.length, capacity, registry]);

  // ── Base geometries ───────────────────────────────────────────────────────
  const bases = useMemo(() => {
    // Tapered, open-ended tube: reads as a shaft of light rather than a rod.
    const pillar = new THREE.CylinderGeometry(0.26, 1, 1, 12, 1, true);
    pillar.translate(0, 0.5, 0);
    const disc = new THREE.CircleGeometry(1, 40);
    return { pillar, disc };
  }, []);

  const layers = useMemo(
    () => ({
      pillar: makeLayer(bases.pillar, capacity),
      disc: makeLayer(bases.disc, capacity),
      ring: makeLayer(bases.disc, capacity),
      focus: makeLayer(bases.disc, 16),
    }),
    [bases, capacity],
  );

  // ── Materials ─────────────────────────────────────────────────────────────
  const materials = useMemo(() => {
    const common = {
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: true,
    } as const;

    return {
      pillar: new THREE.ShaderMaterial({
        ...common,
        vertexShader: PILLAR_VERTEX,
        fragmentShader: PILLAR_FRAGMENT,
        uniforms: { uGain: { value: 0.85 } },
      }),
      disc: new THREE.ShaderMaterial({
        ...common,
        vertexShader: DECAL_VERTEX,
        fragmentShader: DISC_FRAGMENT,
        uniforms: { uGain: { value: 0.9 }, uGlobeRadius: { value: R } },
      }),
      ring: new THREE.ShaderMaterial({
        ...common,
        vertexShader: DECAL_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms: {
          uGain: { value: 0.75 },
          uGlobeRadius: { value: R },
          uTime: { value: 0 },
          uSpeed: { value: 0.3 },
        },
      }),
      focus: new THREE.ShaderMaterial({
        ...common,
        vertexShader: DECAL_VERTEX,
        fragmentShader: FOCUS_FRAGMENT,
        uniforms: {
          uGain: { value: 1.0 },
          uGlobeRadius: { value: R },
          uTime: { value: 0 },
        },
      }),
    };
  }, []);

  useEffect(
    () => () => {
      for (const m of Object.values(materials)) m.dispose();
    },
    [materials],
  );

  useEffect(
    () => () => {
      for (const l of Object.values(layers)) l.geometry.dispose();
    },
    [layers],
  );

  useEffect(
    () => () => {
      bases.pillar.dispose();
      bases.disc.dispose();
    },
    [bases],
  );

  // ── Refs ──────────────────────────────────────────────────────────────────
  const pillarRef = useRef<THREE.InstancedMesh>(null);
  const discRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const focusRef = useRef<THREE.InstancedMesh>(null);

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quatY: new THREE.Quaternion(),
      quatZ: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    }),
    [],
  );

  const settled = useRef(false);
  useEffect(() => {
    if (reducedMotion && !settled.current) {
      registry.settle();
      settled.current = true;
    }
  }, [reducedMotion, registry]);

  // ── The loop ──────────────────────────────────────────────────────────────
  useFrame((state, rawDelta) => {
    // A tab that has been backgrounded hands back a huge delta; clamping keeps
    // the damping from overshooting into a visible jump.
    const dt = Math.min(rawDelta, 1 / 20);
    registry.step(dt);

    const t = state.clock.elapsedTime;
    materials.ring.uniforms.uTime.value = t;
    materials.focus.uniforms.uTime.value = t;

    const pillars = pillarRef.current;
    const discs = discRef.current;
    const rings = ringRef.current;
    const focus = focusRef.current;
    if (!pillars || !discs || !rings || !focus) return;

    const { matrix, position, quatY, quatZ, scale } = scratch;
    const order = registry.order;

    let nPillar = 0;
    let nDisc = 0;
    let nRing = 0;
    let nFocus = 0;

    const cap = capacity;

    for (let i = 0; i < order.length; i++) {
      const e = order[i];
      if (e.presence <= 0.002) continue;

      const intensity = beaconIntensity(e);
      if (intensity <= 0.0015) continue;

      const n = e.normal;
      quatY.setFromUnitVectors(UP_Y, n);
      quatZ.setFromUnitVectors(UP_Z, n);

      // ── Pillar ──
      if (nPillar < cap) {
        const rad = pillarRadius(e);
        const h = pillarHeight(e);
        position.copy(n).multiplyScalar(R + LIFT_PILLAR);
        scale.set(rad, Math.max(h, 1e-4), rad);
        matrix.compose(position, quatY, scale);
        pillars.setMatrixAt(nPillar, matrix);
        writeInstance(layers.pillar, nPillar, e, intensity);
        nPillar++;
      }

      // ── Ground disc ──
      if (nDisc < cap) {
        const dr = discRadius(e);
        position.copy(n).multiplyScalar(R + LIFT_DISC);
        scale.set(dr, dr, 1);
        matrix.compose(position, quatZ, scale);
        discs.setMatrixAt(nDisc, matrix);
        writeInstance(layers.disc, nDisc, e, intensity * 0.95);
        nDisc++;
      }

      // ── Pulse ring ──
      if (e.pulses && !reducedMotion && nRing < cap) {
        const rr = ringRadius(e);
        position.copy(n).multiplyScalar(R + LIFT_RING);
        scale.set(rr, rr, 1);
        matrix.compose(position, quatZ, scale);
        rings.setMatrixAt(nRing, matrix);
        writeInstance(layers.ring, nRing, e, intensity * 0.8);
        nRing++;
      }

      // ── Focus reticle ──
      if (e.focus > 0.01 && nFocus < 16) {
        const fr = focusRadius(e);
        position.copy(n).multiplyScalar(R + LIFT_FOCUS);
        scale.set(fr, fr, 1);
        matrix.compose(position, quatZ, scale);
        focus.setMatrixAt(nFocus, matrix);
        // The reticle is brass, not heat — it is chrome, and chrome is
        // monochrome in this product.
        layers.focus.color.setXYZ(nFocus, BRASS_LINEAR.r, BRASS_LINEAR.g, BRASS_LINEAR.b);
        layers.focus.intensity.setX(nFocus, e.focus * (0.6 + 0.4 * e.presence));
        layers.focus.phase.setX(nFocus, e.phase);
        nFocus++;
      }
    }

    commit(pillars, layers.pillar, nPillar);
    commit(discs, layers.disc, nDisc);
    commit(rings, layers.ring, nRing);
    commit(focus, layers.focus, nFocus);
  });

  return (
    <group renderOrder={30}>
      <instancedMesh
        ref={ringRef}
        args={[layers.ring.geometry, materials.ring, capacity]}
        frustumCulled={false}
        renderOrder={30}
      />
      <instancedMesh
        ref={discRef}
        args={[layers.disc.geometry, materials.disc, capacity]}
        frustumCulled={false}
        renderOrder={31}
      />
      <instancedMesh
        ref={focusRef}
        args={[layers.focus.geometry, materials.focus, 16]}
        frustumCulled={false}
        renderOrder={32}
      />
      <instancedMesh
        ref={pillarRef}
        args={[layers.pillar.geometry, materials.pillar, capacity]}
        frustumCulled={false}
        renderOrder={33}
      />

      <BeaconPicker registry={registry} capacity={capacity} />
    </group>
  );
}

const BRASS_LINEAR = new THREE.Color('#e6cf9b');

function writeInstance(
  layer: InstancedLayer,
  slot: number,
  e: BeaconEntry,
  intensity: number,
): void {
  layer.color.setXYZ(slot, e.color.r, e.color.g, e.color.b);
  layer.intensity.setX(slot, intensity);
  layer.phase.setX(slot, e.phase);
}

function commit(
  mesh: THREE.InstancedMesh,
  layer: InstancedLayer,
  count: number,
): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  layer.color.needsUpdate = true;
  layer.intensity.needsUpdate = true;
  layer.phase.needsUpdate = true;
}

export const BeaconField = memo(BeaconFieldImpl);
export default BeaconField;
