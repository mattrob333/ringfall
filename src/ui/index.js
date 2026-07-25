// L4 src/ui — HUD entry point. ARCHITECTURE.md §2.2: pure event-bus consumer,
// zero coupling to the renderer. Own directory only: src/ui/**.
//
// The HUD is a Canvas2D overlay stacked above the WebGL canvas (frame graph
// pass 12, ARCHITECTURE.md §6 — never tonemapped, never bloomed, its own
// orthographic pass). Everything here works in sRGB CSS colour straight from
// `shared/palette.js`'s HUD swatch; there is no linear-light conversion because
// this pass never goes through the render pipeline's tonemap.

import { Ev } from '../shared/events.js';
import { events } from '../core/events.js';
import { HUD } from '../shared/palette.js';
import { withAlpha } from './chrome.js';
import { drawText, measureText } from './glyphs.js';

import { ShieldHealthPanel } from './panels/shieldHealth.js';
import { TrackerPanel } from './panels/tracker.js';
import { ReticlePanel } from './panels/reticle.js';
import { HitmarkerPanel } from './panels/hitmarker.js';
import { DamageDirectionPanel } from './panels/damageDirection.js';
import { AmmoPanel } from './panels/ammo.js';
import { ScopePanel } from './panels/scope.js';
import { VignettePanel } from './panels/vignette.js';
import { PromptPanel } from './panels/prompt.js';
import { DeathOverlayPanel } from './panels/deathOverlay.js';

const REFERENCE_HEIGHT = 1080;

/**
 * The mutable continuous-state object the game writes into every frame, then
 * passes to `hud.update(hudState, dt)`. Shape fixed by the brief — do not add
 * fields the orchestrator doesn't already populate without updating this
 * comment and the consumers below.
 */
export const hudState = {
  shield: 70, shieldMax: 70, health: 45, healthMax: 45,
  shieldRecharging: false,
  weapon: {
    id: '', name: '', ammo: 0, magSize: 0, reserve: 0,
    reloading: false, reloadProgress: 0, heat: 0, overheated: false,
    scoped: false, magnification: 1, charge: 0,
  },
  offhandWeapon: { id: '', name: '', ammo: 0, reserve: 0 },
  grenades: { frag: 0, plasma: 0, selected: 'frag' },
  reticle: { hot: false, spreadDeg: 0.6, kind: 'auto' },
  tracker: { entries: [], rangeM: 40 },
  prompt: null,
  objective: null,
  dead: false,
};

export class Hud {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width || 1;
    this.height = canvas.height || 1;
    this.dpr = 1;
    this.scale = 1;

    /** Set by the orchestrator once the player entity exists — see README.md
     * "Integration contract" for why this is necessary: SHIELD_BROKEN and the
     * recharge events carry an entityId and fire for every shielded entity
     * (VANE included), not just the player. Without this, the HUD would flare
     * on enemy shield breaks too. Filtering is skipped (permissive) while null. */
    this.playerId = null;

    this.shieldHealth = new ShieldHealthPanel();
    this.tracker = new TrackerPanel();
    this.reticle = new ReticlePanel();
    this.hitmarker = new HitmarkerPanel();
    this.damageDirection = new DamageDirectionPanel();
    this.ammo = new AmmoPanel();
    this.scope = new ScopePanel();
    this.vignette = new VignettePanel();
    this.prompt = new PromptPanel();
    this.deathOverlay = new DeathOverlayPanel();

    // Fallback stores for the `hud.pickupPrompt` / `hud.objective` events, used
    // only when the orchestrator hasn't also populated `state.prompt` /
    // `state.objective` for the current frame (state takes priority — see the
    // shape comment above).
    this._fallbackPrompt = null;
    this._fallbackObjective = null;

    this._lastState = hudState;

    this.resize(this.width, this.height, 1);
  }

  setPlayerId(id) {
    this.playerId = id;
  }

  /** @param {number} width @param {number} height css pixels @param {number} dpr */
  resize(width, height, dpr = 1) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.dpr = Math.max(1, dpr);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // Clamped so extreme resolutions don't produce a microscopic or gigantic HUD.
    this.scale = Math.min(2.2, Math.max(0.55, this.height / REFERENCE_HEIGHT));

    const w = this.width, h = this.height, s = this.scale;
    this.shieldHealth.resize(w, h, s);
    this.tracker.resize(w, h, s);
    this.reticle.resize(w, h, s);
    this.hitmarker.resize(w, h, s);
    this.damageDirection.resize(w, h, s);
    this.ammo.resize(w, h, s);
    this.scope.resize(w, h, s);
    this.vignette.resize(w, h, s);
    this.prompt.resize(w, h, s);
    this.deathOverlay.resize(w, h, s);
  }

  /**
   * Continuous per-frame state. `dt` in seconds — the only time source this
   * module ever touches (ARCHITECTURE.md §7.2: no Date.now()/performance.now()
   * under src/ outside core/clock.js and core/rng.js; every animation here is
   * dt-accumulated, never wall-clock read).
   */
  update(state, dt) {
    this._lastState = state;
    const shieldFrac = state.shieldMax > 0 ? state.shield / state.shieldMax : 0;
    const healthFrac = state.healthMax > 0 ? state.health / state.healthMax : 0;

    this.shieldHealth.update(dt, state.shieldRecharging, shieldFrac);
    this.tracker.update(dt);
    this.reticle.update(dt, state.reticle?.spreadDeg);
    this.hitmarker.update(dt);
    this.damageDirection.update(dt);
    this.ammo.update(dt);
    this.vignette.update(dt, healthFrac);
    this.deathOverlay.update(dt, !!state.dead);
  }

  render() {
    const ctx = this.ctx;
    const state = this._lastState;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // Screen-edge feedback first, so all chrome reads on top of it.
    this.vignette.renderShieldFlare(ctx, this.shieldHealth.flareIntensity());
    const healthFrac = state.healthMax > 0 ? state.health / state.healthMax : 0;
    this.vignette.render(ctx, healthFrac);

    // Scope mask early: everything drawn after it remains legible over the
    // black aperture mask (brief: "must not kill readability").
    this.scope.render(ctx, state.weapon);

    this.tracker.render(ctx, state.tracker);
    this.shieldHealth.render(ctx, state);
    this.ammo.render(ctx, state.weapon, state.offhandWeapon, state.grenades);

    if (!state.weapon?.scoped) this.reticle.render(ctx, state.reticle);
    this.hitmarker.render(ctx);
    this.damageDirection.render(ctx);

    this._renderObjective(ctx, state);
    this.prompt.render(ctx, state.prompt ?? this._fallbackPrompt);

    this.deathOverlay.render(ctx);
  }

  _renderObjective(ctx, state) {
    const text = state.objective ?? this._fallbackObjective;
    if (!text) return;
    const size = 12 * this.scale;
    const str = String(text).toUpperCase();
    const w = measureText(str, size);
    const x = this.width / 2;
    const y = 22 * this.scale;
    ctx.fillStyle = 'rgba(6,20,18,0.4)';
    ctx.fillRect(x - w / 2 - 10 * this.scale, y - 4 * this.scale, w + 20 * this.scale, size + 10 * this.scale);
    drawText(ctx, str, x, y, size, { color: withAlpha(HUD.primary, 0.9), align: 'center' });
  }

  dispose() {
    this._lastState = hudState;
    this._fallbackPrompt = null;
    this._fallbackObjective = null;
    // Nothing else owns timers/rAF/listeners at the Hud-instance level — this
    // class never subscribes to the bus itself, so there is nothing to unwind
    // beyond releasing references for GC. Bus subscriptions belong to whatever
    // called wireHudEvents(); call its returned unsubscribe function too.
    this.canvas = null;
    this.ctx = null;
  }
}

/**
 * Subscribe a Hud instance to every event it needs to react to. Pure
 * consumer — never calls back into gameplay, ARCHITECTURE.md §2.2.
 * @param {Hud} hud
 * @returns {() => void} unsubscribe
 */
export function wireHudEvents(hud) {
  const unsubs = [];
  const isPlayerEvent = (payload) => hud.playerId == null || payload.entityId === hud.playerId;

  unsubs.push(events.on(Ev.SHIELD_BROKEN, (payload) => {
    if (!isPlayerEvent(payload)) return;
    hud.shieldHealth.triggerBreak();
  }));

  unsubs.push(events.on(Ev.SHIELD_RECHARGE_START, (payload) => {
    if (!isPlayerEvent(payload)) return;
    hud.shieldHealth.chargeScan = 0;
  }));

  unsubs.push(events.on(Ev.SHIELD_RECHARGE_FULL, (payload) => {
    if (!isPlayerEvent(payload)) return;
    hud.shieldHealth.chargeScan = 0;
  }));

  unsubs.push(events.on(Ev.HUD_HITMARKER, (payload) => {
    hud.hitmarker.spawn(payload);
  }));

  unsubs.push(events.on(Ev.HUD_DAMAGE_DIRECTION, (payload) => {
    hud.damageDirection.spawn(payload);
  }));

  unsubs.push(events.on(Ev.HUD_PICKUP_PROMPT, (payload) => {
    hud._fallbackPrompt = payload?.show ? { label: payload.label, holdProgress: 0 } : null;
  }));

  unsubs.push(events.on(Ev.HUD_OBJECTIVE, (payload) => {
    hud._fallbackObjective = payload?.text ?? null;
  }));

  return () => {
    for (const un of unsubs) un();
  };
}
