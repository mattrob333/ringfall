'use client';

/**
 * Post-processing.
 *
 * Wired directly against `postprocessing` — `@react-three/postprocessing` is
 * not a dependency of this project, so we own the composer and take over the
 * render loop with a priority-1 `useFrame`. R3F stops auto-rendering the moment
 * any subscriber claims a priority above zero, and resumes when this component
 * unmounts, which is exactly the behaviour the quality switch needs.
 *
 * Quality ladder (`useGlobeStore.quality`, floored by what the device can
 * actually do):
 *   high      bloom + vignette + chromatic aberration, 4× MSAA
 *   balanced  bloom only, 2× MSAA
 *   economy   nothing — R3F renders straight to the canvas
 *
 * ON "SELECTIVE" BLOOM: this uses a luminance-thresholded `BloomEffect` rather
 * than `SelectiveBloomEffect`, and the threshold does the selecting.
 *
 * The composer's buffers are linear (HalfFloat, no colour-space conversion
 * until the final pass), and every material tone-maps in its own fragment
 * shader, so the values bloom sees are ACES-mapped linear. In that space the
 * planet is very dark: land's day albedo `#2b3348` is ≈0.03 linear, the lit
 * ocean peaks near 0.07, the brass coastline hairline at 34% opacity lands
 * under 0.05. The beacons are additive and stack — a `hot` pillar core reaches
 * ≈0.45, `blazing` ≈0.7, `supernova` past 1.0. A threshold of 0.38 therefore
 * sits an order of magnitude above the planet and inside the beacon ramp, which
 * is exactly the separation `SelectiveBloomEffect` would have bought us, minus
 * a second scene render and a cross-component object registry.
 *
 * The cost of the shortcut, stated plainly: `smoldering` and `warm` beacons
 * fall below the threshold and do not bloom. That reads as intentional — cold
 * anticipation should not blaze — but it is a consequence, not a decision made
 * per-level. If you need per-object control, that is when to reach for
 * `SelectiveBloomEffect`.
 */

import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from 'postprocessing';
import { useGlobeStore, type GlobeQuality } from '@/lib/stores/useGlobeStore';

const LUMINANCE_THRESHOLD = 0.38;

const QUALITY_RANK: Record<GlobeQuality, number> = {
  economy: 0,
  balanced: 1,
  high: 2,
};
const RANK_QUALITY: GlobeQuality[] = ['economy', 'balanced', 'high'];

/**
 * What this machine can plausibly sustain, judged once at mount.
 *
 * Two cheap signals: core count (a four-core phone is not going to hold 60 with
 * a mipmap bloom chain) and device pixel ratio below 1, which in practice means
 * a downscaled or software context. Neither is a benchmark; both are enough to
 * avoid shipping a slideshow.
 */
export function detectQualityCeiling(): GlobeQuality {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return 'high';
  }

  const cores = navigator.hardwareConcurrency ?? 8;
  const dpr = window.devicePixelRatio || 1;

  if (cores <= 2 || dpr < 1) return 'economy';
  if (cores <= 4) return 'balanced';

  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) < 560;
  if (coarse && smallViewport) return 'balanced';

  return 'high';
}

export interface EffectsProps {
  /** Overrides the auto-detected ceiling. Mostly for debugging. */
  ceiling?: GlobeQuality;
}

function EffectsImpl({ ceiling }: EffectsProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const requested = useGlobeStore((s) => s.quality);

  const cap = useMemo(() => ceiling ?? detectQualityCeiling(), [ceiling]);

  const quality: GlobeQuality =
    RANK_QUALITY[Math.min(QUALITY_RANK[requested], QUALITY_RANK[cap])];

  const composer = useMemo(() => {
    if (quality === 'economy') return null;

    const c = new EffectComposer(gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: quality === 'high' ? 4 : 2,
    });

    c.addPass(new RenderPass(scene, camera));

    const bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: LUMINANCE_THRESHOLD,
      luminanceSmoothing: 0.28,
      intensity: quality === 'high' ? 1.25 : 1.0,
      radius: 0.72,
      levels: quality === 'high' ? 8 : 6,
    });

    if (quality === 'high') {
      const vignette = new VignetteEffect({
        blendFunction: BlendFunction.NORMAL,
        offset: 0.32,
        darkness: 0.62,
      });

      // Deliberately tiny, and radially modulated so the centre of the frame is
      // untouched — it should only ever be visible as a softness at the corners.
      const aberration = new ChromaticAberrationEffect({
        blendFunction: BlendFunction.NORMAL,
        offset: new THREE.Vector2(0.00055, 0.00055),
        radialModulation: true,
        modulationOffset: 0.42,
      });

      c.addPass(new EffectPass(camera, bloom, aberration, vignette));
    } else {
      c.addPass(new EffectPass(camera, bloom));
    }

    return c;
  }, [gl, scene, camera, quality]);

  useEffect(() => {
    if (!composer) return;
    composer.setSize(size.width, size.height);
  }, [composer, size.width, size.height]);

  useEffect(() => {
    if (!composer) return;
    return () => {
      composer.dispose();
    };
  }, [composer]);

  // The render loop must only be claimed when there is actually a composer to
  // drive: a priority-1 `useFrame` suppresses R3F's own render unconditionally,
  // so an early `return` inside the callback would paint a black screen on
  // 'economy'. Mounting the subscriber conditionally is the only correct shape.
  if (!composer) return null;
  return <ComposerLoop composer={composer} />;
}

function ComposerLoop({ composer }: { composer: EffectComposer }) {
  useFrame((_, delta) => {
    composer.render(Math.min(delta, 1 / 20));
  }, 1);
  return null;
}

export const Effects = memo(EffectsImpl);
export default Effects;
