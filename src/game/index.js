// L6 game — wiring and boot. OWNER: orchestrator.

import * as THREE from 'three';
import { RingfallRenderer, LAYER_WORLD, LAYER_VIEWMODEL, LAYER_TRANSPARENT } from '../render/index.js';
import { bindGlobals, Materials, Family, createMaterial } from '../materials/index.js';
import { clock } from '../core/clock.js';
import { events } from '../core/events.js';
import { setSessionSeed, rng } from '../core/rng.js';
import { InputState, InputCapture } from '../core/input.js';
import { CAMERA, SIM_DT } from '../shared/tuning.js';
import { DEG } from '../shared/math.js';
import { buildLevel } from '../world/index.js';

const params = new URLSearchParams(location.search);
const DETERMINISTIC = params.get('det') === '1';
const SEED = parseInt(params.get('seed') ?? '1337', 10);

export async function boot({ glCanvas, hudCanvas, bootEl }) {
  setSessionSeed(SEED);

  const renderer = new RingfallRenderer(glCanvas, {
    dpr: DETERMINISTIC ? 1 : Math.min(window.devicePixelRatio || 1, 2),
  });
  bindGlobals(renderer.globals);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, CAMERA.near, CAMERA.far);
  const vmCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 12);
  camera.layers.enable(LAYER_WORLD);
  vmCamera.layers.set(LAYER_VIEWMODEL);

  function applyFov() {
    const aspect = renderer._w / renderer._h;
    camera.aspect = aspect;
    vmCamera.aspect = aspect;
    // FEEL.md §2.2 specifies HORIZONTAL fov; three wants vertical.
    camera.fov = 2 * Math.atan(Math.tan((CAMERA.fovHorizontal * DEG) / 2) / aspect) * (180 / Math.PI);
    vmCamera.fov =
      2 * Math.atan(Math.tan((CAMERA.viewModelFovHorizontal * DEG) / 2) / aspect) * (180 / Math.PI);
    camera.updateProjectionMatrix();
    vmCamera.updateProjectionMatrix();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, DETERMINISTIC ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    if (hudCanvas) {
      hudCanvas.width = Math.floor(w * (DETERMINISTIC ? 1 : Math.min(window.devicePixelRatio || 1, 2)));
      hudCanvas.height = Math.floor(h * (DETERMINISTIC ? 1 : Math.min(window.devicePixelRatio || 1, 2)));
      hudCanvas.style.width = `${w}px`;
      hudCanvas.style.height = `${h}px`;
    }
    applyFov();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- content -------------------------------------------------------------
  const world = buildLevel(renderer, null);
  renderer.scene.add(world.root);

  // ---- free camera (placeholder until src/player lands) ---------------------
  const input = new InputState();
  const capture = new InputCapture(glCanvas, input);
  glCanvas.addEventListener('click', () => capture.requestLock());

  const camState = { pos: new THREE.Vector3(0, 1.62, 14), yaw: 0, pitch: -0.05 };
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();

  function stepCamera(dt) {
    camState.yaw += input.lookYaw;
    camState.pitch = Math.max(-1.5, Math.min(1.5, camState.pitch + input.lookPitch));
    input.lookYaw = 0;
    input.lookPitch = 0;

    fwd.set(-Math.sin(camState.yaw), 0, -Math.cos(camState.yaw));
    right.set(Math.cos(camState.yaw), 0, -Math.sin(camState.yaw));
    const speed = (input.crouch ? 12 : 4.4) * dt;
    camState.pos.addScaledVector(fwd, input.moveZ * speed);
    camState.pos.addScaledVector(right, input.moveX * speed);
    if (input.jump) camState.pos.y += speed;
  }

  function syncCamera() {
    camera.position.copy(camState.pos);
    camera.quaternion.setFromEuler(new THREE.Euler(camState.pitch, camState.yaw, 0, 'YXZ'));
    vmCamera.position.copy(camera.position);
    vmCamera.quaternion.copy(camera.quaternion);
  }

  syncCamera();
  camera.updateMatrixWorld(true);
  await renderer.prewarm(camera);

  window.__ringfall = {
    renderer,
    camera,
    vmCamera,
    scene: renderer.scene,
    clock,
    events,
    world,
    ready: false,
    version: '0.1.0-slice',
    setCamera(pos, yaw, pitch) {
      camState.pos.set(pos[0], pos[1], pos[2]);
      camState.yaw = yaw;
      camState.pitch = pitch;
      syncCamera();
      renderer.taa.reset();
    },
    stats: () => ({ ...renderer.stats, ...renderer.clusters.stats() }),
  };

  let frames = 0;
  function oneFrame(dtOverride) {
    capture.sample(dtOverride ?? clock.frameDt ?? 1 / 60);
    clock.tick((dt) => stepCamera(dt));
    syncCamera();
    renderer.render(camera, vmCamera, clock.simTime);
    input.endFrame();
    frames++;
    if (frames === 3 && bootEl) bootEl.classList.add('hidden');
  }

  if (DETERMINISTIC) {
    // ARCHITECTURE.md §7.4: in capture mode the harness drives frames
    // explicitly. requestAnimationFrame is never scheduled, so a headless or
    // backgrounded page still advances exactly the frames it is told to.
    clock.setDeterministic(true, 1 / 60);
    // The overlay's fade is a CSS transition and capture advances no wall time,
    // so it must be removed outright rather than faded.
    if (bootEl) bootEl.style.display = 'none';
    window.__ringfall.step = (n = 1) => {
      for (let i = 0; i < n; i++) oneFrame(1 / 60);
      return frames;
    };

    // Render one frame and read it back in the SAME synchronous task.
    // preserveDrawingBuffer is not enough on its own: by the time a separate
    // page.evaluate() runs, the compositor has already presented and cleared
    // the default framebuffer, and readPixels returns all zeros. Measured: the
    // first capture produced 3,686,400 bytes of which 0 were non-zero.
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
    const frame = () => {
      oneFrame();
      if (frames >= 3) window.__ringfall.ready = true;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  return window.__ringfall;
}
