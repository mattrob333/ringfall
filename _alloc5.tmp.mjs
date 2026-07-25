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
const DT = 1/60;
for (let f=0; f<70; f++) fx.update(DT, cp);

function probe(label, fn, iters=1000) {
  for (let i=0;i<iters;i++) fn();
  globalThis.gc(); globalThis.gc();
  const b = process.memoryUsage().heapUsed;
  for (let i=0;i<iters;i++) fn();
  const a = process.memoryUsage().heapUsed;
  console.log(label.padEnd(46), ((a-b)/iters).toFixed(1), 'B/iter');
}
probe('noop', ()=>{});
probe('full fx.update', ()=>fx.update(DT, cp));
probe('camera branch', ()=>{ fx._camX=cp.x; fx._camY=cp.y; fx._camZ=cp.z; });
probe('_refreshBloomFloor', ()=>fx._refreshBloomFloor());
probe('emitters.update', ()=>fx.emitters.update(DT, fx.ctx, fx.lights));
probe('lights.update', ()=>fx.lights.update(DT));
probe('add.update', ()=>fx.add.update(DT,0,0,0));
probe('alpha.update', ()=>fx.alpha.update(DT,0,0,0));
probe('decals.update(DT)', ()=>fx.decals.update(DT));
probe('stats block', ()=>{ const s=fx.stats; s.additive=fx.add.count; s.alpha=fx.alpha.count; s.particles=fx.add.count+fx.alpha.count; s.decals=fx.decals.count; s.lights=fx.lights.active; s.emitters=fx.emitters.active; s.droppedParticles=fx.add.dropped+fx.alpha.dropped; s.decalsReplaced=fx.decals.replaced; s.drawCalls=3; });
probe('this.time += dt', ()=>{ fx.time += DT; });
