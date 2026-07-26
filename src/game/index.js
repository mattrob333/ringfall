// L6 game — wiring and boot. OWNER: orchestrator.
// This is the ONLY file allowed to know about every subsystem at once.
// Subsystems below L6 talk to each other through the event bus, never directly.

import * as THREE from 'three';
import { RingfallRenderer, LAYER_WORLD, LAYER_VIEWMODEL } from '../render/index.js';
import { bindGlobals } from '../materials/index.js';
import { clock } from '../core/clock.js';
import { events } from '../core/events.js';
import { setSessionSeed } from '../core/rng.js';
import { allocId } from '../core/ids.js';
import { InputState, InputCapture } from '../core/input.js';
import {
  CAMERA, SIM_DT, PLAYER, MELEE, ENEMY_WEAPONS, GRENADE, RESPAWN_GRACE,
} from '../shared/tuning.js';
import { Archetype, Faction, HitRegion, DamageType } from '../shared/enums.js';
import { Ev } from '../shared/events.js';
import { DEG, smoothstep } from '../shared/math.js';

import { PhysicsWorld } from '../physics/index.js';
import { buildLevel } from '../world/index.js';
import { PlayerController } from '../player/index.js';
import { WeaponSystem, targets, AmmoKind } from '../weapons/index.js';
import { AiDirector } from '../ai/index.js';
import { buildCharacter, animateCharacter, setShieldState } from '../characters/index.js';
import { VehicleSystem } from '../vehicles/index.js';
import { FxSystem, wireFxEvents } from '../fx/index.js';
import { Hud, wireHudEvents, hudState } from '../ui/index.js';
import { audio, wireAudioEvents } from '../audio/index.js';

const params = new URLSearchParams(location.search);
const DETERMINISTIC = params.get('det') === '1';
const PROFILE = params.get('profile') === '1';
const SEED = parseInt(params.get('seed') ?? '1337', 10);
const FORCE_DPR = params.get('dpr') ? parseFloat(params.get('dpr')) : null;

const SQUADS = [
  { id: 'north', archetypes: ['VANE', 'SKIRN', 'SKIRN', 'CULL'] },
  { id: 'west', archetypes: ['VANE', 'SKIRN'] },
  { id: 'east', archetypes: ['WARDEN', 'CULL'] },
];

export async function boot({ glCanvas, hudCanvas, bootEl }) {
  const bootStart = clock._now();
  setSessionSeed(SEED);

  const dpr = FORCE_DPR ?? (DETERMINISTIC ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  const renderer = new RingfallRenderer(glCanvas, { dpr });
  bindGlobals(renderer.globals);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, CAMERA.near, CAMERA.far);
  const vmCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 12);
  camera.layers.set(LAYER_WORLD);
  vmCamera.layers.set(LAYER_VIEWMODEL);

  function applyFov() {
    const aspect = renderer._w / renderer._h;
    camera.aspect = aspect;
    vmCamera.aspect = aspect;
    // FEEL.md §2.2 specifies HORIZONTAL fov; three wants vertical.
    const vert = (h) => 2 * Math.atan(Math.tan((h * DEG) / 2) / aspect) * (180 / Math.PI);
    camera.fov = vert(CAMERA.fovHorizontal);
    vmCamera.fov = vert(CAMERA.viewModelFovHorizontal);
    camera.updateProjectionMatrix();
    vmCamera.updateProjectionMatrix();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, dpr);
    if (hudCanvas) hud?.resize(w, h, dpr);
    applyFov();
  }

  // ---- simulation ---------------------------------------------------------
  const physics = new PhysicsWorld({ cellSize: 8 });
  const level = buildLevel(renderer, physics);
  renderer.scene.add(level.root);

  const playerId = allocId();
  const player = new PlayerController({
    physics,
    events,
    entityId: playerId,
    position: level.spawns.player,
  });

  const weapons = new WeaponSystem({
    physics,
    targets,
    bus: events,
    ownerId: playerId,
    faction: Faction.PLAYER,
    loadout: ['vector_br', 'cadence_ar'],
  });

  const ai = new AiDirector({ physics, events, targets });
  const vehicles = new VehicleSystem({ physics, events });
  const fx = new FxSystem({
    scene: renderer.scene,
    globals: renderer.globals,
    camera,
    clusters: renderer.clusters,
    renderer,
  });
  const unwireFx = wireFxEvents(fx);

  // ---- enemies + their meshes --------------------------------------------
  /** @type {Array<{agent:object, handle:object}>} */
  const bodies = [];
  let spawnIndex = 0;
  for (const squad of SQUADS) {
    for (const archetype of squad.archetypes) {
      const pos = level.spawns.enemies[spawnIndex % level.spawns.enemies.length];
      spawnIndex++;
      const agent = ai.spawn({
        archetype,
        position: pos.clone(),
        squadId: squad.id,
        faction: Faction.VESS,
      });
      if (!agent) continue;
      const handle = buildCharacter(archetype);
      // Do NOT force every descendant onto LAYER_WORLD: src/characters assigns
      // its own layers, and the VANE's translucent shield shell belongs to
      // LAYER_TRANSPARENT. Overriding it rendered the shell as an opaque cyan
      // billboard in the opaque pass.
      //
      // The character goes under a HOLDER group that this layer owns. Placement
      // is written to the holder, never to handle.root, because
      // animateCharacter() drives root.position.y itself (its root origin is at
      // the feet). Writing placement to root meant the animation overwrote it
      // every frame and every enemy rendered at world y = 0 — floating 2-3 m
      // above terrain that sits at y = -2 to -3.
      const holder = new THREE.Group();
      holder.add(handle.root);
      renderer.scene.add(holder);
      bodies.push({ agent, handle, holder });
    }
  }

  // ---- enemy fire -> player damage ---------------------------------------
  //
  // src/ai resolves whether each shot HITS (it stores the angular error and the
  // target's angular radius on agent.lastShot) but deliberately does not emit
  // damage.applied, because src/weapons is the damage resolver and the AI has
  // no WeaponSystem. Nothing bridged the two, so enemies shot at the player for
  // the entire build and the player was invulnerable. That bridge is this
  // layer's job — it is the only layer allowed to know about both.
  const agentById = new Map();
  for (const b of bodies) agentById.set(b.agent.entityId, b.agent);

  const _hitPoint = new THREE.Vector3();
  const _hitNormal = new THREE.Vector3();

  let respawnGrace = 0;

  events.on(Ev.WEAPON_FIRED, (p) => {
    if (p.ownerId === playerId || respawnGrace > 0) return;
    const a = agentById.get(p.ownerId);
    const shot = a?.lastShot;
    if (!a || !a.alive || !shot) return;
    // Geometric hit test, matching how src/ai's own self-test scores hits:
    // the shot lands if its angular error is inside the target's angular radius.
    if (!(shot.errRad <= shot.targetAngRad)) return;

    // Enemy weapon ids (vess_carbine/needler/repeater) are NOT in the player's
    // WEAPONS table, so looking them up there silently returned undefined and
    // every enemy round was discarded. Their damage lives in ENEMY_WEAPONS.
    const def = ENEMY_WEAPONS[p.weaponId] ?? ENEMY_WEAPONS.default;
    _hitPoint.copy(player.eyePosition);
    _hitNormal.set(p.muzzle[0] - _hitPoint.x, 0, p.muzzle[2] - _hitPoint.z).normalize();
    player.applyDamage(
      def.damage,
      def.damageType ?? DamageType.KINETIC,
      HitRegion.TORSO,
      p.ownerId,
      p.weaponId,
      1,
      _hitPoint,
      _hitNormal,
    );
  });

  events.on(Ev.MELEE_LANDED, (p) => {
    if (p.ownerId === playerId || p.targetId !== playerId || respawnGrace > 0) return;
    player.applyDamage(
      p.fromBehind ? 1e6 : MELEE.damage,
      DamageType.MELEE,
      HitRegion.TORSO,
      p.ownerId,
      null,
      1,
    );
  });

  // ---- vehicle ------------------------------------------------------------
  const ridgeback = vehicles.spawn({ type: 'ridgeback', position: level.spawns.vehicle, yaw: 0.6 });

  // ---- HUD ----------------------------------------------------------------
  const hud = hudCanvas ? new Hud(hudCanvas) : null;
  let unwireHud = null;
  if (hud) {
    // Resolves DEFECTS.md UI1: shield events carry an entityId but nothing told
    // the HUD which one is the player, so an enemy VANE popping its shield
    // would have fired the player's screen-edge flare.
    hud.setPlayerId?.(playerId);
    unwireHud = wireHudEvents(hud);
  }

  window.addEventListener('resize', resize);
  resize();

  // ---- audio (needs a user gesture) --------------------------------------
  let unwireAudio = null;
  const startAudio = async () => {
    if (unwireAudio) return;
    await audio.init();
    unwireAudio = wireAudioEvents(audio);
  };

  // ---- input --------------------------------------------------------------
  const input = new InputState();
  const capture = new InputCapture(glCanvas, input);
  capture.sensitivity = CAMERA.sensitivity;
  glCanvas.addEventListener('click', () => {
    capture.requestLock();
    startAudio();
  });

  // M mutes. Escape releases the mouse so the page is usable again.
  let muted = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') {
      muted = !muted;
      audio.setMasterVolume?.(muted ? 0 : 0.5);
    } else if (e.code === 'Escape') {
      capture.release();
    }
  });

  // ---- camera binding -----------------------------------------------------
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  // Capture-only free camera. Without it every baseline shot renders from the
  // player's eye, because present() re-syncs the camera to the controller after
  // the harness has positioned it.
  let camOverride = null;

  function syncCamera() {
    if (camOverride) {
      camera.position.set(camOverride.pos[0], camOverride.pos[1], camOverride.pos[2]);
      _euler.set(camOverride.pitch, camOverride.yaw, 0);
      camera.quaternion.setFromEuler(_euler);
      vmCamera.position.copy(camera.position);
      vmCamera.quaternion.copy(camera.quaternion);
      return;
    }
    const inVehicle = ridgeback && ridgeback.seats?.driver === playerId;
    if (inVehicle && ridgeback.getChaseCameraTarget) {
      const t = ridgeback.getChaseCameraTarget();
      camera.position.set(t.position.x, t.position.y, t.position.z);
      camera.lookAt(t.lookAt.x, t.lookAt.y, t.lookAt.z);
      if (t.fov && Math.abs(camera.fov - t.fov) > 0.01) {
        camera.fov = t.fov;
        camera.updateProjectionMatrix();
      }
    } else {
      camera.position.copy(player.eyePosition);
      _euler.set(player.pitch, player.yaw, 0);
      camera.quaternion.setFromEuler(_euler);
    }
    vmCamera.position.copy(camera.position);
    vmCamera.quaternion.copy(camera.quaternion);
  }

  const _playerState = {
    entityId: playerId,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    faction: Faction.PLAYER,
    alive: true,
  };

  // Death was terminal: the HUD said "AWAITING RESPAWN" and nothing ever
  // respawned, so the first mistake ended the session. Respawn at the spawn
  // point after a short beat, with a fresh magazine and grenades.
  const RESPAWN_DELAY = 3.0;
  let deadTimer = 0;

  const _lunge = new THREE.Vector3();
  function step(dt) {
    if (respawnGrace > 0) respawnGrace -= dt;
    if (!player.alive) {
      deadTimer += dt;
      if (deadTimer >= RESPAWN_DELAY) {
        deadTimer = 0;
        player.respawn(level.spawns.player);
        respawnGrace = RESPAWN_GRACE;
        for (const s of weapons.slots) {
          // AmmoKind values are STRINGS; the previous `=== 2` never matched,
          // so a heat weapon would respawn with a meaningless full magazine.
          s.ammo = s.def.ammo === AmmoKind.HEAT ? 0 : s.def.mag;
          s.reserve = s.def.reserve;
          s.heat = 0;
          s.overheated = false;
          s.bloom = 0;
        }
        weapons.grenades.frag = GRENADE.frag.maxCarried;
        weapons.grenades.plasma = GRENADE.plasma.maxCarried;
        renderer.taa.reset();
      }
      // Still tick the world so enemies keep behaving while you are down.
      ai.update(dt, _playerState);
      vehicles.update(dt);
      physics.step(dt);
      return;
    }

    // Aim-assist turn friction (FEEL.md §4.8) scales look input before the
    // controller consumes it. Uses last frame's aim state, which is one frame
    // of latency the player cannot perceive at 120 Hz.
    const ls = weapons.getLookScale();
    if (ls !== 1) {
      input.lookYaw *= ls;
      input.lookPitch *= ls;
    }

    player.update(dt, input);
    weapons.update(dt, input, player);
    if (weapons.consumeLunge(_lunge)) player.applyImpulse?.(_lunge);

    _playerState.position.copy(player.position);
    _playerState.velocity.copy(player.velocity ?? _playerState.velocity);
    _playerState.forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    _playerState.alive = player.alive;

    ai.update(dt, _playerState);
    vehicles.update(dt);
    physics.step(dt);
  }

  // ---- per-frame presentation --------------------------------------------
  const _tmp = new THREE.Vector3();
  function present(dt) {
    syncCamera();

    for (const b of bodies) {
      const { agent, handle, holder } = b;
      holder.position.set(agent.position.x, agent.position.y, agent.position.z);
      holder.rotation.y = agent.yaw ?? 0;
      holder.rotation.x = 0;
      holder.rotation.z = 0;

      // Death: TOPPLE, then sink, then despawn. A corpse that simply stops
      // animating is indistinguishable from one that is still fighting, and
      // the player keeps dumping ammo into it.
      if (!agent.alive) {
        b.deadFor = (b.deadFor ?? 0) + dt;
        const t = b.deadFor;
        // 0.00-0.75s  fall onto its side, with a slight yaw twist
        const fall = smoothstep(Math.min(1, t / 0.75));
        holder.rotation.x = fall * 1.45;
        holder.rotation.y += fall * (b.fallTwist ?? (b.fallTwist = agent.entityId % 2 ? 0.5 : -0.5));
        holder.position.y -= fall * 0.12;
        // 1.90-3.10s  sink into the ground and disappear
        if (t > 1.9) {
          const sink = smoothstep(Math.min(1, (t - 1.9) / 1.2));
          holder.position.y -= sink * 2.4;
          if (sink >= 1) holder.visible = false;
        }
      } else {
        b.deadFor = 0;
        holder.visible = true;
      }

      animateCharacter(handle, {
        state: agent.animState,
        dt,
        speed: agent.speed01 ?? 0,
        aimYaw: (agent.aimYaw ?? 0) - (agent.yaw ?? 0),
        aimPitch: agent.aimPitch ?? 0,
      });
      if (agent.archetype === 'VANE' && agent.maxShield) {
        setShieldState(handle, {
          fraction: agent.shield / agent.maxShield,
          flash01: agent.shieldFlash ?? 0,
        });
      }
    }

    fx.update(dt, camera.getWorldPosition(_tmp));

    if (hud) {
      populateHudState(hudState, player, weapons, ai);
      hud.update(hudState, dt);
      hud.render();
    }

    if (audio.ready) {
      camera.getWorldDirection(_tmp);
      audio.setListener(camera.position, _tmp, camera.up);
      audio.update(dt);
    }

    renderer.render(camera, vmCamera, clock.simTime);
  }

  // ---- loop ---------------------------------------------------------------
  let frames = 0;
  function oneFrame(dtOverride) {
    const dt = dtOverride ?? clock.frameDt ?? 1 / 60;
    // In deterministic capture the HARNESS owns the InputState. Sampling the
    // real keyboard here overwrote every scripted axis with the empty key set
    // (s.fire = keys.has('fire') = false), so the player's trigger never
    // registered and playtest's 919 "shots" were entirely AI weapons — the
    // player fired nothing and no player raycast was ever issued.
    if (!DETERMINISTIC) capture.sample(dt);
    // Scripted gameplay for tools/profile.mjs. Runs AFTER sample() so it wins,
    // for exactly the reason above.
    if (window.__ringfall?._profileTick) window.__ringfall._profileTick(dt);
    clock.tick(step);
    present(clock.frameDt || 1 / 60);
    input.endFrame();
    frames++;
    if (frames === 3 && bootEl && !DETERMINISTIC) bootEl.classList.add('hidden');

    // Tell the player which aim path is live rather than leaving them to guess
    // why the mouse behaves differently from every other shooter.
    if (!DETERMINISTIC && (frames & 15) === 0) {
      const el = document.getElementById('lookmode');
      if (el) el.style.display = capture.usingFallbackLook ? 'block' : 'none';
    }
  }

  syncCamera();
  camera.updateMatrixWorld(true);
  await renderer.prewarm(camera);
  const bootMs = Math.round((clock._now() - bootStart) * 1000);

  window.__ringfall = {
    renderer,
    physics,
    camera,
    vmCamera,
    scene: renderer.scene,
    clock,
    events,
    level,
    player,
    weapons,
    ai,
    vehicles,
    fx,
    hud,
    bodies,
    bootMs,
    ready: false,
    version: '0.3.0',
    // The SAME InputState the controller reads, so a scripted test cannot
    // accidentally exercise a different code path than a human does.
    driveInput: input,
    capture,
    setCamera(pos, yaw, pitch) {
      camOverride = { pos, yaw, pitch };
      syncCamera();
      camera.updateMatrixWorld(true);
      renderer.taa.reset();
    },
    clearCamera() {
      camOverride = null;
    },
    stats: () => ({ ...renderer.stats, ...renderer.clusters.stats() }),
  };

  if (DETERMINISTIC) {
    clock.setDeterministic(true, 1 / 60);
    if (bootEl) bootEl.style.display = 'none';
    window.__ringfall.step = (n = 1) => {
      for (let i = 0; i < n; i++) oneFrame(1 / 60);
      return frames;
    };
    // Readback MUST happen in the same synchronous task as the render: by the
    // time a separate page.evaluate() runs the compositor has presented and
    // cleared the default framebuffer. Measured: 3,686,400 bytes, 0 non-zero.
    window.__ringfall.capture = () => {
      oneFrame(1 / 60);
      const gl = renderer.renderer.getContext();
      const w = glCanvas.width;
      const h = glCanvas.height;
      const buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
      }
      return { data: btoa(bin), width: w, height: h };
    };
    window.__ringfall.ready = true;
  } else {
    if (PROFILE) installProfileDriver(window.__ringfall, input, player);
    const frame = () => {
      oneFrame();
      if (frames >= 3) window.__ringfall.ready = true;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  return window.__ringfall;
}

const RETICLE_KIND = {
  cadence_ar: 'auto',
  vector_br: 'burst',
  longbow: 'precision',
  breaker: 'shotgun',
  ember_repeater: 'plasma',
  vess_sidearm: 'plasma',
};

/** Populate the HUD state object the ui owner declared. No allocation. */
function populateHudState(s, player, weapons, ai) {
  // PlayerController keeps the two-layer pool in `state`, not as flat fields.
  // Reading player.shield gave undefined, which reached the HUD as
  // rgba(120,110,105,NaN) and threw inside a CanvasGradient.
  const st = player.state;
  s.shield = st.shield;
  s.shieldMax = st.maxShield;
  s.health = st.health;
  s.healthMax = st.maxHealth;
  s.shieldRecharging = !!player.shieldRecharging;
  s.dead = !player.alive;

  const slot = weapons.slots[weapons.activeIndex];
  if (slot && s.weapon) {
    s.weapon.id = slot.id;
    s.weapon.name = slot.def.name ?? slot.id.replace(/_/g, ' ').toUpperCase();
    s.weapon.ammo = slot.ammo | 0;
    s.weapon.magSize = slot.def.mag | 0;
    s.weapon.reserve = slot.reserve | 0;
    s.weapon.reloading = !!weapons.reloading;
    s.weapon.reloadProgress = weapons.reloadProgress ?? 0;
    s.weapon.heat = slot.heat ?? 0;
    s.weapon.overheated = !!slot.overheated;
    s.weapon.scoped = !!weapons.scoped;
    s.weapon.magnification = weapons.magnification || 1;
    s.weapon.charge = weapons.charge ?? 0;
  }
  const other = weapons.slots[1 - weapons.activeIndex];
  if (other && s.offhandWeapon) {
    s.offhandWeapon.id = other.id;
    s.offhandWeapon.name = other.def.name ?? other.id.replace(/_/g, ' ').toUpperCase();
    s.offhandWeapon.ammo = other.ammo | 0;
    s.offhandWeapon.reserve = other.reserve | 0;
  }

  const aim = weapons.getAimState();
  if (aim && s.reticle) {
    s.reticle.hot = !!aim.hot;
    s.reticle.spreadDeg = weapons.currentSpreadDeg?.() ?? slot?.def?.spreadDeg ?? 0.6;
    s.reticle.kind = RETICLE_KIND[slot?.id] ?? 'auto';
  }

  if (s.grenades) {
    s.grenades.frag = weapons.grenades.frag | 0;
    s.grenades.plasma = weapons.grenades.plasma | 0;
    s.grenades.selected = weapons.grenadeType;
  }

  // Motion tracker: player-relative metres, hostiles only.
  if (s.tracker) {
    const out = s.tracker.entries;
    out.length = 0;
    const px = player.position.x;
    const py = player.position.y;
    const pz = player.position.z;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const dx = a.position.x - px;
      const dz = a.position.z - pz;
      if (dx * dx + dz * dz > s.tracker.rangeM * s.tracker.rangeM) continue;
      const dy = a.position.y - py;
      out.push({
        x: dx,
        z: dz,
        elevation: dy > 1.5 ? 1 : dy < -1.5 ? -1 : 0,
        hostile: true,
      });
    }
  }
}

/**
 * Scripted gameplay for tools/profile.mjs: the camera must be IN MOTION with AI
 * alive and weapons firing, or the numbers describe a screensaver.
 * ARCHITECTURE.md §8.
 */
function installProfileDriver(rf, input, player) {
  let t = 0;
  rf.beginProfile = () => {
    t = 0;
    rf._profileTick = (dt) => {
      t += dt;
      input.moveZ = Math.sin(t * 0.4) > 0 ? 1 : -1;
      input.moveX = Math.cos(t * 0.31) > 0 ? 1 : -1;
      input.lookYaw = Math.sin(t * 0.7) * 0.02;
      input.lookPitch = Math.sin(t * 0.23) * 0.004;
      input.hasLookInput = true;
      input.fire = Math.sin(t * 1.7) > -0.2;
      input.firePressed = input.fire;
      input.jump = Math.sin(t * 0.9) > 0.93;
      input.jumpPressed = input.jump;
      input.grenadePressed = Math.sin(t * 0.21) > 0.995;
      input.reloadPressed = Math.sin(t * 0.13) > 0.997;
    };
  };
  rf.endProfile = () => {
    rf._profileTick = null;
  };
}
