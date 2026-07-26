'use client';

/**
 * Picking.
 *
 * A beacon at score 20 is about four pixels wide at default zoom. Nobody is
 * hitting that. So picking runs against its own invisible instanced mesh of
 * spheres, sized in *screen* terms rather than world terms — the pick target
 * grows as you pull the camera back, so a beacon is always about the same
 * number of pixels to aim at no matter the zoom.
 *
 * The spheres are real geometry (the raycaster needs something to hit) drawn
 * with `colorWrite: false` and `depthWrite: false`, so the draw call exists but
 * paints nothing.
 *
 * Raycasting does not consult the depth buffer, so a beacon on the far side of
 * the planet is a perfectly good hit as far as three is concerned. We reject
 * those explicitly with the horizon test rather than trusting sort order.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { GLOBE_RADIUS } from '@/lib/geo/projection';
import { setCursor } from './cursor';
import {
  facesCamera,
  pillarRadius,
  type BeaconEntry,
  type BeaconRegistry,
} from './beaconState';

const R = GLOBE_RADIUS;

/** Angular size of the pick target, in radians of arc at the surface. */
const PICK_ANGULAR = 0.0115;
const PICK_MIN = 0.014;
const PICK_MAX = 0.05;

export interface BeaconPickerProps {
  registry: BeaconRegistry;
  capacity: number;
}

function BeaconPickerImpl({ registry, capacity }: BeaconPickerProps) {
  const camera = useThree((s) => s.camera);

  const hover = useGlobeStore((s) => s.hover);
  const select = useGlobeStore((s) => s.select);
  const flyTo = useGlobeStore((s) => s.flyTo);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  /** Pick slot → entry. Rebuilt every frame alongside the matrices. */
  const slots = useRef<BeaconEntry[]>([]);
  const hovered = useRef<string | null>(null);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        transparent: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(
    () => () => {
      setCursor('hover', '');
    },
    [],
  );

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    }),
    [],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { matrix, position, quaternion, scale } = scratch;
    const dist = camera.position.length();

    // Constant apparent size: scale the target with camera distance, clamped so
    // it never becomes either a pinprick or a continent.
    const base = THREE.MathUtils.clamp(
      PICK_ANGULAR * dist,
      PICK_MIN,
      PICK_MAX,
    );

    const order = registry.order;
    const list = slots.current;
    list.length = 0;

    let n = 0;
    for (let i = 0; i < order.length && n < capacity; i++) {
      const e = order[i];
      if (e.presence < 0.25) continue; // fading out — not clickable any more

      const r = Math.max(base, pillarRadius(e) * 5);
      position.copy(e.normal).multiplyScalar(R + r * 0.55);
      scale.set(r, r, r);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(n, matrix);
      list.push(e);
      n++;
    }

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });

  /** First hit that is actually on the near side of the planet. */
  const resolve = useCallback(
    (event: ThreeEvent<PointerEvent | MouseEvent>): BeaconEntry | null => {
      const camPos = camera.position;
      for (const hit of event.intersections) {
        const id = hit.instanceId;
        if (id === undefined) continue;
        const entry = slots.current[id];
        if (!entry) continue;
        if (!facesCamera(entry.normal, camPos, R)) continue;
        return entry;
      }
      return null;
    },
    [camera],
  );

  const setHover = useCallback(
    (id: string | null) => {
      if (hovered.current === id) return;
      hovered.current = id;
      hover(id);
      setCursor('hover', id ? 'pointer' : '');
    },
    [hover],
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const entry = resolve(event);
      if (!entry) {
        setHover(null);
        return;
      }
      event.stopPropagation();
      setHover(entry.id);
    },
    [resolve, setHover],
  );

  const onPointerOut = useCallback(() => setHover(null), [setHover]);

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      const entry = resolve(event);
      if (!entry) return;
      event.stopPropagation();
      select(entry.id);
      flyTo(entry.beacon.coords);
    },
    [resolve, select, flyTo],
  );

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
      renderOrder={-1}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onClick={onClick}
    />
  );
}

export const BeaconPicker = memo(BeaconPickerImpl);
export default BeaconPicker;
