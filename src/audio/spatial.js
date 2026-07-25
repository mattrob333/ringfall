// L3 audio — 3D positioning. ARCHITECTURE.md §3: audio does not import three
// beyond simple Vector3-shaped math, and does not import src/render. Positions
// arriving from events are plain [x,y,z] arrays or {x,y,z} objects; both are
// normalized to {x,y,z} here.

import { clamp01, lerp } from '../shared/math.js';

export function toXYZ(p) {
  if (!p) return { x: 0, y: 0, z: 0 };
  if (Array.isArray(p)) return { x: p[0] ?? 0, y: p[1] ?? 0, z: p[2] ?? 0 };
  return { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 };
}

/** Thin wrapper around the AudioContext's AudioListener. */
export class ListenerState {
  constructor(ctx) {
    this.ctx = ctx;
    this.listener = ctx.listener;
    this.position = { x: 0, y: 0, z: 0 };
    this.forward = { x: 0, y: 0, z: -1 };
    this.up = { x: 0, y: 1, z: 0 };
  }

  set(position, forward, up) {
    this.position = toXYZ(position);
    this.forward = toXYZ(forward);
    this.up = toXYZ(up);
    const L = this.listener;
    const t = this.ctx.currentTime;
    try {
      if (L.positionX && typeof L.positionX.setValueAtTime === 'function') {
        L.positionX.setValueAtTime(this.position.x, t);
        L.positionY.setValueAtTime(this.position.y, t);
        L.positionZ.setValueAtTime(this.position.z, t);
        L.forwardX.setValueAtTime(this.forward.x, t);
        L.forwardY.setValueAtTime(this.forward.y, t);
        L.forwardZ.setValueAtTime(this.forward.z, t);
        L.upX.setValueAtTime(this.up.x, t);
        L.upY.setValueAtTime(this.up.y, t);
        L.upZ.setValueAtTime(this.up.z, t);
      } else if (typeof L.setPosition === 'function') {
        L.setPosition(this.position.x, this.position.y, this.position.z);
        L.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
      }
    } catch {
      /* some headless/mock contexts expose neither API; positioning is best-effort */
    }
  }

  distanceTo(pos) {
    const p = toXYZ(pos);
    const dx = p.x - this.position.x;
    const dy = p.y - this.position.y;
    const dz = p.z - this.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

/**
 * Build a PannerNode + air-absorption lowpass for a one-shot or loop at a
 * world position. HRTF is too expensive at 48-voice budgets, so this always
 * uses 'equalpower' per ARCHITECTURE.md's audio brief. Returns {input, panner,
 * distance} — connect upstream synthesis into `input`, and `panner` into a bus.
 */
export function createSpatialChain(ctx, listenerState, position) {
  const pos = toXYZ(position);
  const panner = ctx.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = 2;
  panner.maxDistance = 180;
  panner.rolloffFactor = 1.0;
  try {
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else if (typeof panner.setPosition === 'function') {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
  } catch {
    /* best-effort */
  }

  const distance = listenerState.distanceTo(pos);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  const t = clamp01(distance / 90);
  lowpass.frequency.value = lerp(18000, 900, t);
  lowpass.Q.value = 0.3;

  lowpass.connect(panner);
  return { input: lowpass, panner, distance };
}

/** Move a PannerNode's position (used by continuous loops like vehicle engines). */
export function updateChainPosition(panner, ctx, position) {
  const pos = toXYZ(position);
  try {
    if (panner.positionX) {
      const t = ctx.currentTime;
      panner.positionX.setValueAtTime(pos.x, t);
      panner.positionY.setValueAtTime(pos.y, t);
      panner.positionZ.setValueAtTime(pos.z, t);
    } else if (typeof panner.setPosition === 'function') {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
  } catch {
    /* best-effort */
  }
}
