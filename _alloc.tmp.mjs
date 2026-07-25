import * as THREE from 'three';
import { FxSystem } from './src/fx/index.js';
import { setSessionSeed } from './src/core/rng.js';

setSessionSeed(1337);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60,16/9,0.05,4000);
const globals = { u: { uExposure: { value: 0.88 } } };
const clusters = { lights: [], addPointLight(p,c,i,r){const l={position:p.clone(),color:c.clone(),intensity:i,range:r,type:0,dir:new THREE.Vector3(0,-1,0),cosOuter:-1,cosInner:-1,enabled:true};this.lights.push(l);return l;} };
const fx = new FxSystem({ scene, globals, camera, clusters });
const cp = new THREE.Vector3(0,1.62,0);

function probe(label, fn, iters=600) {
  for (let i=0;i<iters;i++) fn();   // warm
  globalThis.gc(); globalThis.gc();
  const b = process.memoryUsage().heapUsed;
  for (let i=0;i<iters;i++) fn();
  const a = process.memoryUsage().heapUsed;
  console.log(label.padEnd(42), ((a-b)/iters).toFixed(1), 'B/iter');
}

probe('noop', () => {});
probe('fx.update idle', () => fx.update(1/60, cp));
probe('add.update only', () => fx.add.update(1/60,0,0,0));
probe('alpha.update only', () => fx.alpha.update(1/60,0,0,0));
probe('decals.update only', () => fx.decals.update(1/60));
probe('emitters.update only', () => fx.emitters.update(1/60, fx.ctx, fx.lights));
probe('lights.update only', () => fx.lights.update(1/60));
probe('lights.active getter', () => fx.lights.active);
probe('emitters.active getter', () => fx.emitters.active);
probe('_refreshBloomFloor', () => fx._refreshBloomFloor());

// now with load
import { events } from './src/core/events.js';
import { Ev } from './src/shared/events.js';
import { wireFxEvents } from './src/fx/index.js';
wireFxEvents(fx);
const impact = { point:[0,1,0], normal:[0,1,0], surfaceId:3, energy:30, damageType:0, sourceId:1 };
probe('fx.update with 4 impacts/frame', () => {
  for (let k=0;k<4;k++){ impact.point[0]=k; events.emit(Ev.SURFACE_IMPACT, impact); }
  fx.update(1/60, cp);
});
