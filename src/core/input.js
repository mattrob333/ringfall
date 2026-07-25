// L1 core — input capture and the synthetic-input path feeltest.mjs drives.
// The controller reads ONLY from an InputState. It never touches the DOM.

export class InputState {
  constructor() {
    this.moveX = 0; // -1 left .. +1 right
    this.moveZ = 0; // -1 back .. +1 forward
    this.lookYaw = 0; // radians accumulated this frame
    this.lookPitch = 0;
    this.jump = false;
    this.jumpPressed = false;
    this.crouch = false;
    this.fire = false;
    this.firePressed = false;
    this.melee = false;
    this.meleePressed = false;
    this.grenade = false;
    this.grenadePressed = false;
    this.reload = false;
    this.reloadPressed = false;
    this.swap = false;
    this.swapPressed = false;
    this.scope = false;
    this.scopePressed = false;
    this.interact = false;
    this.interactHeld = 0; // seconds
    this.switchGrenade = false;
    this.switchGrenadePressed = false;
    this.hasLookInput = false;
  }

  /** Clear per-frame edge flags and accumulated look. Call after the sim reads it. */
  endFrame() {
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.jumpPressed = false;
    this.firePressed = false;
    this.meleePressed = false;
    this.grenadePressed = false;
    this.reloadPressed = false;
    this.swapPressed = false;
    this.scopePressed = false;
    this.switchGrenadePressed = false;
    this.hasLookInput = false;
  }

  reset() {
    for (const k of Object.keys(this)) {
      this[k] = typeof this[k] === 'boolean' ? false : 0;
    }
  }
}

const KEYMAP = {
  KeyW: 'fwd',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ControlLeft: 'crouch',
  KeyC: 'crouch',
  KeyR: 'reload',
  KeyQ: 'swap',
  KeyF: 'melee',
  KeyG: 'grenade',
  KeyE: 'interact',
  KeyX: 'switchGrenade',
  ShiftLeft: null, // sprint deliberately unbound — FEEL.md F11
};

export class InputCapture {
  /**
   * @param {HTMLElement} element pointer-lock target
   * @param {InputState} state
   */
  constructor(element, state) {
    this.el = element;
    this.state = state;
    this.enabled = false;
    this.sensitivity = 0.022;
    this.invertY = false;
    this._keys = new Set();
    this._bound = {};
    this._locked = false;
    this._install();
  }

  get pointerLocked() {
    return this._locked;
  }

  _install() {
    const b = this._bound;
    b.keydown = (e) => {
      if (e.repeat) return;
      const a = KEYMAP[e.code];
      if (a === undefined) return;
      e.preventDefault();
      if (a === null) return;
      if (!this._keys.has(a)) this._press(a);
      this._keys.add(a);
    };
    b.keyup = (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      this._keys.delete(a);
      if (a === 'interact') this.state.interactHeld = 0;
    };
    b.mousedown = (e) => {
      if (!this._locked) return;
      if (e.button === 0) this._press('fire');
      if (e.button === 2) this._press('scope');
      if (e.button === 1) this._press('melee');
    };
    b.mouseup = (e) => {
      if (e.button === 0) this._keys.delete('fire');
      if (e.button === 2) this._keys.delete('scope');
      if (e.button === 1) this._keys.delete('melee');
    };
    b.mousemove = (e) => {
      if (!this._locked) return;
      const s = this.sensitivity * (Math.PI / 180);
      this.state.lookYaw -= e.movementX * s;
      this.state.lookPitch -= e.movementY * s * (this.invertY ? -1 : 1);
      if (e.movementX !== 0 || e.movementY !== 0) this.state.hasLookInput = true;
    };
    b.wheel = (e) => {
      if (!this._locked) return;
      e.preventDefault();
      this._press('swap');
    };
    b.lockchange = () => {
      this._locked = document.pointerLockElement === this.el;
      if (!this._locked) {
        this._keys.clear();
        this.state.reset();
      }
    };
    b.contextmenu = (e) => e.preventDefault();

    window.addEventListener('keydown', b.keydown);
    window.addEventListener('keyup', b.keyup);
    window.addEventListener('mousedown', b.mousedown);
    window.addEventListener('mouseup', b.mouseup);
    window.addEventListener('mousemove', b.mousemove);
    window.addEventListener('wheel', b.wheel, { passive: false });
    document.addEventListener('pointerlockchange', b.lockchange);
    this.el.addEventListener('contextmenu', b.contextmenu);
  }

  _press(action) {
    this._keys.add(action);
    const s = this.state;
    if (action === 'jump') s.jumpPressed = true;
    else if (action === 'fire') s.firePressed = true;
    else if (action === 'melee') s.meleePressed = true;
    else if (action === 'grenade') s.grenadePressed = true;
    else if (action === 'reload') s.reloadPressed = true;
    else if (action === 'swap') s.swapPressed = true;
    else if (action === 'scope') s.scopePressed = true;
    else if (action === 'switchGrenade') s.switchGrenadePressed = true;
  }

  requestLock() {
    this.el.requestPointerLock?.();
  }

  /** Fold held keys into the analogue axes. Call once per render frame. */
  sample(dt) {
    const k = this._keys;
    const s = this.state;
    s.moveX = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    s.moveZ = (k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0);
    s.jump = k.has('jump');
    s.crouch = k.has('crouch');
    s.fire = k.has('fire');
    s.melee = k.has('melee');
    s.grenade = k.has('grenade');
    s.reload = k.has('reload');
    s.swap = k.has('swap');
    s.scope = k.has('scope');
    s.interact = k.has('interact');
    s.switchGrenade = k.has('switchGrenade');
    if (s.interact) s.interactHeld += dt;
    else s.interactHeld = 0;
  }

  dispose() {
    const b = this._bound;
    window.removeEventListener('keydown', b.keydown);
    window.removeEventListener('keyup', b.keyup);
    window.removeEventListener('mousedown', b.mousedown);
    window.removeEventListener('mouseup', b.mouseup);
    window.removeEventListener('mousemove', b.mousemove);
    window.removeEventListener('wheel', b.wheel);
    document.removeEventListener('pointerlockchange', b.lockchange);
    this.el.removeEventListener('contextmenu', b.contextmenu);
  }
}

/**
 * Synthetic input driver. feeltest.mjs and playtest.mjs build scripts of these.
 * Same InputState the real capture writes, so the controller cannot tell them apart.
 */
export class SyntheticInput {
  constructor(state) {
    this.state = state;
    this._queue = [];
    this._time = 0;
  }

  /** @param {number} at seconds @param {Partial<InputState>} patch */
  at(time, patch) {
    this._queue.push({ time, patch });
    this._queue.sort((a, b) => a.time - b.time);
    return this;
  }

  hold(key, from, to) {
    return this.at(from, { [key]: true }).at(to, { [key]: false });
  }

  tap(key, time) {
    return this.at(time, { [key]: true, [`${key}Pressed`]: true }).at(time + 1 / 120, {
      [key]: false,
    });
  }

  step(dt) {
    this._time += dt;
    while (this._queue.length && this._queue[0].time <= this._time) {
      Object.assign(this.state, this._queue.shift().patch);
    }
  }

  get done() {
    return this._queue.length === 0;
  }
}
