'use client';

/**
 * MERIDIAN — the globe.
 *
 * An obsidian planet in the dark with cities burning on it. Everything on
 * screen is a pure function of two things: the `beacons` prop and the two
 * stores. The renderer holds no event data of its own, computes no relevance,
 * and decides no heat — if something looks wrong, the fix is upstream.
 *
 * Composition, back to front:
 *
 *   Starfield    a restrained sky, so the background is not flat black
 *   Earth        ocean, land, coastline, borders, graticule, terminator
 *   Atmosphere   two additive back-faced shells for the limb glow
 *   BeaconField  the point of the whole thing
 *   CameraRig    orbit + flight, driving the camera around a stationary globe
 *   Effects      bloom, vignette, aberration — quality-gated
 *
 * `Globe` is the default export and expects to be mounted client-side. If you
 * are importing this from a page shell, import `GlobeStage` instead — it does
 * the `ssr: false` dance for you.
 */

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import type { Beacon } from '@/lib/types';
import { useGlobeStore } from '@/lib/stores/useGlobeStore';
import { VOID } from '@/lib/geo/heat';
import { Earth } from './Earth';
import { Atmosphere } from './Atmosphere';
import { Starfield } from './Starfield';
import { BeaconField } from './BeaconField';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import { GlobeFallback } from './GlobeFallback';

export interface GlobeProps {
  beacons: Beacon[];
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────────────────────────────────────

interface SceneProps {
  beacons: Beacon[];
  onReady: () => void;
}

/**
 * Scene contents. Exported so a host that already owns a `<Canvas>` (a
 * storybook, a comparison harness) can drop the world into it directly.
 */
export function GlobeScene({ beacons, onReady }: SceneProps) {
  return (
    <>
      {/* The globe is lit entirely by its own shaders, so the only real light
          in the scene is a whisper of ambient to keep any future standard
          material from rendering pure black. */}
      <ambientLight intensity={0.15} />

      <Starfield />
      <Earth onLoaded={onReady} />
      <Atmosphere />
      <BeaconField beacons={beacons} />

      <CameraRig />
      <Effects />
    </>
  );
}

/** Watches for WebGL context loss and reports it upward. */
function ContextWatch({
  onLost,
  onRestored,
}: {
  onLost: () => void;
  onRestored: () => void;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;

    const handleLost = (e: Event) => {
      // Preventing the default is what makes restoration possible at all.
      e.preventDefault();
      onLost();
    };
    const handleRestored = () => onRestored();

    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', handleRestored);

    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
    };
  }, [gl, onLost, onRestored]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────────────────────────────────────────

export interface GlobeCanvasProps extends GlobeProps {
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

/**
 * The `<Canvas>` and nothing else. Split out from `Globe` so the error boundary
 * and the context-loss overlay can live in ordinary DOM above it.
 */
export function GlobeCanvas({
  beacons,
  className,
  onContextLost,
  onContextRestored,
}: GlobeCanvasProps) {
  const setReady = useGlobeStore((s) => s.setReady);

  const handleReady = useCallback(() => setReady(true), [setReady]);

  useEffect(() => () => setReady(false), [setReady]);

  const background = useMemo(() => new THREE.Color(VOID), []);

  return (
    <Canvas
      className={className}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
        depth: true,
        preserveDrawingBuffer: false,
      }}
      // Matches CameraRig's opening pose exactly — latLonToVec3(24°N, 8°E,
      // 3.9) — so frame zero is already the shot rather than a one-frame jump
      // to it.
      camera={{ fov: 34, near: 0.02, far: 400, position: [3.528, 1.586, -0.495] }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
        gl.setClearColor(background, 1);
        scene.background = background;
      }}
    >
      <ContextWatch
        onLost={onContextLost ?? noop}
        onRestored={onContextRestored ?? noop}
      />
      <GlobeScene beacons={beacons} onReady={handleReady} />
    </Canvas>
  );
}

function noop() {}

// ─────────────────────────────────────────────────────────────────────────────
// Error boundary
// ─────────────────────────────────────────────────────────────────────────────

interface BoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

/**
 * WebGL initialisation throws synchronously on machines that cannot provide a
 * context (locked-down enterprise images, some VMs, a browser that has run out
 * of contexts). Without this the whole page unmounts and the user gets a blank
 * document instead of a product with one missing panel.
 */
class GlobeErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[MERIDIAN] globe failed to initialise', error);
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function GlobeImpl({ beacons, className }: GlobeProps) {
  const [contextLost, setContextLost] = useState(false);
  const ready = useGlobeStore((s) => s.ready);
  const setReady = useGlobeStore((s) => s.setReady);

  const restoreTimer = useRef<number | null>(null);

  const handleLost = useCallback(() => {
    setContextLost(true);
    setReady(false);
  }, [setReady]);

  const handleRestored = useCallback(() => {
    // A restored context needs a beat before it is worth looking at again.
    if (restoreTimer.current) window.clearTimeout(restoreTimer.current);
    restoreTimer.current = window.setTimeout(() => setContextLost(false), 250);
  }, []);

  useEffect(
    () => () => {
      if (restoreTimer.current) window.clearTimeout(restoreTimer.current);
    },
    [],
  );

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <GlobeErrorBoundary fallback={<GlobeFallback kind="unsupported" />}>
        <GlobeCanvas
          beacons={beacons}
          onContextLost={handleLost}
          onContextRestored={handleRestored}
        />
      </GlobeErrorBoundary>

      {contextLost && <GlobeFallback kind="context-lost" overlay />}
      {!contextLost && !ready && <GlobeFallback kind="loading" overlay />}
    </div>
  );
}

export const Globe = memo(GlobeImpl);
export default Globe;
