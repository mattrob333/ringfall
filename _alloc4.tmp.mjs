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
const impact = { point:[0,1,0], normal:[0,1,0], surfaceId:3, energy:30, damageType:0, sourceId:1 };
for (let k=0;k<400;k++){ impact.point[0]=(k%40)-20; impact.point[2]=(k/40)|0; events.emit(Ev.SURFACE_IMPACT, impact); }
for (let f=0; f<70; f++) fx.update(1/60, cp);
console.log('state: add=%d alpha=%d decals=%d', fx.add.count, fx.alpha.count, fx.decals.count);

function probe(label, fn, iters=600) {
  for (let i=0;i<iters;i++) fn();
  globalThis.gc(); globalThis.gc();
  const b = process.memoryUsage().heapUsed;
  for (let i=0;i<iters;i++) fn();
  const a = process.memoryUsage().heapUsed;
  console.log(label.padEnd(46), ((a-b)/iters).toFixed(1), 'B/iter');
}
probe('noop', ()=>{});
probe('decals.update (256 live)', ()=>fx.decals.update(0));
probe('decals._flush x4 only', ()=>{ fx.decals._flush(fx.decals.aPos,0,768); fx.decals._flush(fx.decals.aNormal,1,768); fx.decals._flush(fx.decals.aParams,2,1024); fx.decals._flush(fx.decals.aColor,3,1024); });
probe('add.update (0 live)', ()=>fx.add.update(1/60,0,0,0));
probe('fx.update idle w/ 256 decals', ()=>fx.update(1/60, cp));
