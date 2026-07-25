import * as THREE from 'three';
import { FxSystem } from './src/fx/index.js';
import { setSessionSeed } from './src/core/rng.js';
import { events } from './src/core/events.js';
import { Ev } from './src/shared/events.js';
import { wireFxEvents } from './src/fx/index.js';

setSessionSeed(1337);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60,16/9,0.05,4000);
const globals = { u: { uExposure: { value: 0.88 } } };
const clusters = { lights: [], addPointLight(p,c,i,r){const l={position:p.clone(),color:c.clone(),intensity:i,range:r,type:0,dir:new THREE.Vector3(0,-1,0),cosOuter:-1,cosInner:-1,enabled:true};this.lights.push(l);return l;} };
const fx = new FxSystem({ scene, globals, camera, clusters });
wireFxEvents(fx);
const cp = new THREE.Vector3(0,1.62,0);
const DT = 1/60;

function probe(label, fn, iters=1000) {
  for (let i=0;i<iters;i++) fn();
  globalThis.gc(); globalThis.gc();
  const b = process.memoryUsage().heapUsed;
  for (let i=0;i<iters;i++) fn();
  const a = process.memoryUsage().heapUsed;
  console.log(label.padEnd(46), ((a-b)/iters).toFixed(1), 'B/iter', ' state add=%d alpha=%d dec=%d', fx.add.count, fx.alpha.count, fx.decals.count);
}
probe('noop', ()=>{});
probe('fx.update, empty pools', ()=>fx.update(DT, cp));
probe('fx.update, empty pools (again)', ()=>fx.update(DT, cp));

// Steady-state firefight: keep spawning so the pools stay loaded.
const impact = { point:[0,1,0], normal:[0,1,0], surfaceId:3, energy:30, damageType:0, sourceId:1 };
let c=0;
probe('firefight: 4 impacts + update', ()=>{
  for (let k=0;k<4;k++){ c++; impact.point[0]=(c%40)-20; impact.point[2]=((c/40)|0)%20; impact.surfaceId=(c%17); events.emit(Ev.SURFACE_IMPACT, impact); }
  fx.update(DT, cp);
});
