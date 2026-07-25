import * as THREE from 'three';
import { FxSystem } from './src/fx/index.js';
import { setSessionSeed, rng } from './src/core/rng.js';
import { events } from './src/core/events.js';
import { Ev } from './src/shared/events.js';
import { wireFxEvents } from './src/fx/index.js';
import { surfaceImpact } from './src/fx/effects.js';

setSessionSeed(1337);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60,16/9,0.05,4000);
const globals = { u: { uExposure: { value: 0.88 } } };
const clusters = { lights: [], addPointLight(p,c,i,r){const l={position:p.clone(),color:c.clone(),intensity:i,range:r,type:0,dir:new THREE.Vector3(0,-1,0),cosOuter:-1,cosInner:-1,enabled:true};this.lights.push(l);return l;} };
const fx = new FxSystem({ scene, globals, camera, clusters });
wireFxEvents(fx);
const cp = new THREE.Vector3(0,1.62,0);
const impact = { point:[0,1,0], normal:[0,1,0], surfaceId:3, energy:30, damageType:0, sourceId:1 };

function probe(label, fn, iters=2000) {
  for (let i=0;i<iters;i++) fn();
  globalThis.gc(); globalThis.gc();
  const b = process.memoryUsage().heapUsed;
  for (let i=0;i<iters;i++) fn();
  const a = process.memoryUsage().heapUsed;
  console.log(label.padEnd(46), ((a-b)/iters).toFixed(1), 'B/iter');
}

probe('noop', () => {});
probe('bus.emit only (no fx handlers) - dummy evt', () => events.emit(Ev.HUD_OBJECTIVE, impact));
probe('emit SURFACE_IMPACT (full path)', () => { events.emit(Ev.SURFACE_IMPACT, impact); });
probe('direct fx.onSurfaceImpact', () => { fx.onSurfaceImpact(impact); });
probe('direct surfaceImpact() recipe', () => { surfaceImpact(fx.ctx, 0,1,0, 0,1,0, 3, 30, 0); });
probe('decals.add only', () => { fx.decals.add(0,1,0,0,1,0,0.15,0.3,1,26,0.09,0.086,0.078,0.8); });
probe('add.spawn only', () => { fx.add.spawn(0,1,0,1,1,1,0.2,0.01,0.01,1,1,1,5,0.1,1,1,0,0,3,0,0.5,1,1.2); });
probe('rand.next x20', () => { const r = fx.rand; let s=0; for(let i=0;i<20;i++) s+=r.next(); return s; });
