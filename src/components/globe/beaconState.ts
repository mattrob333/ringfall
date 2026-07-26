'use client';

/**
 * Animated state for the beacon field.
 *
 * The renderer must stay a pure function of `Beacon[]` — it never derives
 * relevance, never decides heat, never remembers an event the selectors have
 * dropped. What it *does* own is the tween between one frame's truth and the
 * next: when the timeline scrubs, `relevance` moves from 0.2 to 0.9 in a single
 * prop update, and a beacon that snapped would read as a glitch rather than as
 * a city coming into season.
 *
 * So this module keeps one entry per event id, holding both the target values
 * from props and the damped values actually rendered. Entries persist briefly
 * after their beacon disappears so a filter change fades out instead of
 * blinking.
 */

import * as THREE from 'three';
import type { Beacon } from '@/lib/types';
import { GLOBE_RADIUS, latLonToVec3 } from '@/lib/geo/projection';
import { heatColor, heatIntensity, heatPulses } from '@/lib/geo/heat';

export interface BeaconEntry {
  id: string;
  beacon: Beacon;

  /** Unit surface normal — position, orientation and horizon test all use it. */
  normal: THREE.Vector3;
  /** Linear-space colour for this beacon's heat level. */
  color: THREE.Color;
  /** Emissive weight for this beacon's heat level. */
  emissive: number;
  /** Whether this beacon earns pulse rings. */
  pulses: boolean;
  /**
   * Stable animation offset in [0, 1), hashed from `eventId`.
   *
   * Deliberately NOT the array index: indices shift the moment a filter
   * changes, which would make every surviving beacon re-phase in unison — the
   * exact artefact the stagger exists to prevent.
   */
  phase: number;

  // Rendered (damped) values.
  relevance: number;
  score: number;
  focus: number;
  /** 1 while the beacon is in the incoming array, damping to 0 once it leaves. */
  presence: number;

  // Targets, straight from props.
  targetRelevance: number;
  targetScore: number;
  targetFocus: number;
  targetPresence: number;
}

/** FNV-1a over the id, mapped to [0, 1). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/** Damping rates, in inverse seconds. Higher = snappier. */
const LAMBDA = {
  relevance: 5.5,
  score: 4.5,
  focus: 9,
  presenceIn: 7,
  presenceOut: 4.5,
} as const;

/** Below this, a departed beacon is forgotten. */
const PRESENCE_FLOOR = 0.004;

export class BeaconRegistry {
  private readonly entries = new Map<string, BeaconEntry>();

  /** Dense, stable-order render list. Rebuilt only when membership changes. */
  order: BeaconEntry[] = [];

  /** Bumped whenever `order` is replaced, so consumers can react. */
  version = 0;

  /** Point targets at a new beacon array. Cheap; safe to call every render. */
  sync(beacons: readonly Beacon[]): void {
    let membershipChanged = false;

    for (const b of beacons) {
      let e = this.entries.get(b.eventId);

      if (!e) {
        e = {
          id: b.eventId,
          beacon: b,
          normal: latLonToVec3(b.coords.lat, b.coords.lon, 1),
          color: heatColor(b.heat).clone(),
          emissive: heatIntensity(b.heat),
          pulses: heatPulses(b.heat),
          phase: hash01(b.eventId),
          // New beacons grow in from nothing rather than appearing at size.
          relevance: 0,
          score: b.score * 0.35,
          focus: b.focused ? 1 : 0,
          presence: 0,
          targetRelevance: b.relevance,
          targetScore: b.score,
          targetFocus: b.focused ? 1 : 0,
          targetPresence: 1,
        };
        this.entries.set(b.eventId, e);
        membershipChanged = true;
      } else {
        if (e.beacon.heat !== b.heat) {
          e.color.copy(heatColor(b.heat));
          e.emissive = heatIntensity(b.heat);
          e.pulses = heatPulses(b.heat);
        }
        if (
          e.beacon.coords.lat !== b.coords.lat ||
          e.beacon.coords.lon !== b.coords.lon
        ) {
          latLonToVec3(b.coords.lat, b.coords.lon, 1, e.normal);
        }
        e.beacon = b;
        e.targetRelevance = b.relevance;
        e.targetScore = b.score;
        e.targetFocus = b.focused ? 1 : 0;
        if (e.targetPresence !== 1) membershipChanged = true;
        e.targetPresence = 1;
      }
    }

    // Anything not in the incoming array starts fading.
    if (beacons.length !== this.entries.size) {
      const live = new Set(beacons.map((b) => b.eventId));
      for (const e of this.entries.values()) {
        if (!live.has(e.id) && e.targetPresence !== 0) {
          e.targetPresence = 0;
          e.targetRelevance = 0;
          e.targetFocus = 0;
        }
      }
    }

    if (membershipChanged) this.rebuild();
  }

  /** Advance every tween. Returns true if the render list changed. */
  step(dt: number): boolean {
    const d = THREE.MathUtils.damp;
    let dropped = false;

    for (const e of this.order) {
      e.relevance = d(e.relevance, e.targetRelevance, LAMBDA.relevance, dt);
      e.score = d(e.score, e.targetScore, LAMBDA.score, dt);
      e.focus = d(e.focus, e.targetFocus, LAMBDA.focus, dt);
      e.presence = d(
        e.presence,
        e.targetPresence,
        e.targetPresence > e.presence ? LAMBDA.presenceIn : LAMBDA.presenceOut,
        dt,
      );

      if (e.targetPresence === 0 && e.presence < PRESENCE_FLOOR) {
        this.entries.delete(e.id);
        dropped = true;
      }
    }

    if (dropped) {
      this.rebuild();
      return true;
    }
    return false;
  }

  /** Snap every tween to its target — for `prefers-reduced-motion` cold starts. */
  settle(): void {
    for (const e of this.order) {
      e.relevance = e.targetRelevance;
      e.score = e.targetScore;
      e.focus = e.targetFocus;
      e.presence = e.targetPresence;
    }
  }

  get size(): number {
    return this.order.length;
  }

  private rebuild(): void {
    this.order = Array.from(this.entries.values());
    this.version++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sizing — the one place beacon scale is decided
// ─────────────────────────────────────────────────────────────────────────────

const R = GLOBE_RADIUS;

/** Pillar radius, in globe radii. */
export function pillarRadius(e: BeaconEntry): number {
  const s = clamp01(e.score / 100);
  return (
    (0.0032 + 0.0082 * s) *
    (0.55 + 0.45 * clamp01(e.relevance)) *
    (1 + 0.4 * e.focus) *
    (0.65 + 0.35 * e.presence)
  );
}

/**
 * Pillar height, in globe radii.
 *
 * The ceiling is not a taste decision. Zoom clamps at 1.35 radii, so a pillar
 * whose tip passes 0.35 puts the camera *inside* an additive tube at maximum
 * zoom — which looks like a rendering fault, not a bright city. The curve below
 * tops out at 0.200, times the 1.5× focus bonus, giving 0.300 and a comfortable
 * 0.05 of clearance. If you retune this, keep
 *
 *     max(pillarHeight) * (1 + focus bonus) < MIN_DISTANCE - GLOBE_RADIUS
 *
 * true, or the payoff shot breaks.
 */
export const MAX_PILLAR_HEIGHT = 0.3;

export function pillarHeight(e: BeaconEntry): number {
  const s = clamp01(e.score / 100);
  return (
    (0.026 + 0.09 * s * s + 0.084 * s) *
    (0.26 + 0.74 * clamp01(e.relevance)) *
    (1 + 0.5 * e.focus) *
    e.presence
  );
}

/** Emissive weight fed to every beacon shader. */
export function beaconIntensity(e: BeaconEntry): number {
  return (
    e.emissive *
    (0.28 + 0.72 * clamp01(e.relevance)) *
    (1 + 0.65 * e.focus) *
    e.presence
  );
}

/** Ground glow radius. */
export function discRadius(e: BeaconEntry): number {
  return pillarRadius(e) * 4.6 + 0.005;
}

/** Outer radius the pulse ring expands to. */
export function ringRadius(e: BeaconEntry): number {
  const s = clamp01(e.score / 100);
  return (0.026 + 0.062 * s) * (0.5 + 0.5 * clamp01(e.relevance)) * e.presence;
}

/**
 * Radius of the locked focus reticle. Sized so the visible ring sits around 5°
 * of arc and the outer ticks around 8° — big enough to find at a glance, small
 * enough not to annex a neighbouring country.
 */
export function focusRadius(e: BeaconEntry): number {
  return discRadius(e) * 1.8 + 0.009;
}

/**
 * Exact horizon test: a surface point with unit normal `n` is visible from
 * `camPos` iff dot(n, camPos) > radius. (Divide both sides of the tangent
 * condition by |camPos| and it falls out.)
 */
export function facesCamera(
  normal: THREE.Vector3,
  camPos: THREE.Vector3,
  radius: number = R,
): boolean {
  return normal.dot(camPos) > radius;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
