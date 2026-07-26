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
  // Arrow keys look. Not in the reference control scheme, but they make the
  // game aimable in any environment, including ones that refuse pointer lock.
  ArrowLeft: 'lookLeft',
  ArrowRight: 'lookRight',
  ArrowUp: 'lookUp',
  ArrowDown: 'lookDown',
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
    // Engaged = the player has clicked into the game, whether or not pointer
    // lock was granted. Mouse input is accepted while engaged OR locked.
    //
    // These were previously gated on _locked alone, which meant that anywhere
    // pointer lock is unavailable — a sandboxed iframe, an embedded preview
    // pane — aiming, FIRING and weapon swap were all silently dead while
    // movement still worked. That is not a degraded experience, it is an
    // unplayable one, and it was entirely self-inflicted.
    this._engaged = false;
    // Cursor offset from the canvas centre, used by the no-pointer-lock
    // fallback in sample().
    this._cursor = { x: 0, y: 0, inside: false };
    this._install();
  }

  get pointerLocked() {
    return this._locked;
  }

  get engaged() {
    return this._engaged;
  }

  /** True when look is running on the rate-based fallback rather than raw deltas. */
  get usingFallbackLook() {
    return this._engaged && !this._locked;
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
      if (!this._engaged && !this._locked) return;
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
      // Track the cursor for the fallback regardless of engagement.
      const r = this.el.getBoundingClientRect();
      this._cursor.x = e.clientX - (r.left + r.width / 2);
      this._cursor.y = e.clientY - (r.top + r.height / 2);
      this._cursor.inside =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      this._cursor.halfW = r.width / 2;
      this._cursor.halfH = r.height / 2;

      // Locked: raw relative deltas, the correct FPS path.
      if (!this._locked) return;
      const s = this.sensitivity * (Math.PI / 180);
      this.state.lookYaw -= e.movementX * s;
      this.state.lookPitch -= e.movementY * s * (this.invertY ? -1 : 1);
      if (e.movementX !== 0 || e.movementY !== 0) this.state.hasLookInput = true;
    };
    b.wheel = (e) => {
      if (!this._engaged && !this._locked) return;
      e.preventDefault();
      this._press('swap');
    };
    b.lockchange = () => {
      this._locked = document.pointerLockElement === this.el;
      // Do NOT clear engagement when lock drops — that is exactly the state the
      // fallback exists to serve.
      if (!this._locked) this._keys.clear();
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
    // Engagement is unconditional: the player clicked, so the game takes input.
    // Whether pointer lock is granted only decides WHICH look path runs.
    this._engaged = true;

    // Chrome returns a Promise here and rejects it when the document is not a
    // valid pointer-lock root — the normal case inside a sandboxed iframe such
    // as an embedded preview pane. Routine and non-fatal, so it must not reach
    // the global error handler; unhandled, it papered the screen with
    // SecurityError text on every click.
    try {
      const r = this.el.requestPointerLock?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* fall through to the rate-based look in sample() */
    }
  }

  release() {
    this._engaged = false;
    this._keys.clear();
    this.state.reset();
    if (document.pointerLockElement === this.el) document.exitPointerLock?.();
  }

  /** True when mouse look is actually possible in this document. */
  get canLock() {
    return typeof this.el.requestPointerLock === 'function';
  }

  /** Fold held keys into the analogue axes. Call once per render frame. */
  sample(dt) {
    const k = this._keys;
    const s = this.state;

    // ---- look ------------------------------------------------------------
    // With pointer lock, mousemove already accumulated exact relative deltas.
    // Without it, relative deltas are useless: the cursor runs out of screen
    // and turning simply stops. So the fallback treats the cursor's offset
    // from the canvas centre as a RATE, with a dead zone — you push the mouse
    // toward the edge to keep turning, and it never runs out of room.
    if (this._engaged && !this._locked && this._cursor.inside) {
      const DEAD = 0.12;
      const RATE = 3.2; // radians/second at full deflection
      const nx = this._cursor.x / Math.max(this._cursor.halfW || 1, 1);
      const ny = this._cursor.y / Math.max(this._cursor.halfH || 1, 1);
      const shape = (v) => {
        const a = Math.abs(v);
        if (a <= DEAD) return 0;
        const t = (a - DEAD) / (1 - DEAD);
        return Math.sign(v) * t * t; // quadratic: precise near centre
      };
      const dx = shape(Math.max(-1, Math.min(1, nx)));
      const dy = shape(Math.max(-1, Math.min(1, ny)));
      if (dx !== 0 || dy !== 0) {
        s.lookYaw -= dx * RATE * dt;
        s.lookPitch -= dy * RATE * dt * (this.invertY ? -1 : 1);
        s.hasLookInput = true;
      }
    }

    // Arrow keys always look, in either mode. Guarantees the game is aimable
    // even where the mouse cannot be used at all.
    const KEY_RATE = 2.2;
    let ax = (k.has('lookRight') ? 1 : 0) - (k.has('lookLeft') ? 1 : 0);
    let ay = (k.has('lookDown') ? 1 : 0) - (k.has('lookUp') ? 1 : 0);
    if (ax !== 0 || ay !== 0) {
      s.lookYaw -= ax * KEY_RATE * dt;
      s.lookPitch -= ay * KEY_RATE * dt * (this.invertY ? -1 : 1);
      s.hasLookInput = true;
    }
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
