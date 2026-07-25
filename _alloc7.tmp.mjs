import * as THREE from 'three';
import { FxSystem } from './src/fx/index.js';
import { setSessionSeed } from './src/core/rng.js';
import { surfaceImpact, muzzleFlash, tracer } from './src/fx/effects.js';

setSessionSeed(1337);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60,16/9,0.05,4000);
const globals = { u: { uExposure: { value: 0.88 } } };
const clusters = { lights: [], addPointLight(p,c,i,r){const l={position:p.clone(),color:c.clone(),intensity:i,range:r,type:0,dir:new THREE.Vector3(0,-1,0),cosOuter:-1,cosInner:-1,enabled:true};this.lights.push(l);return l;} };
const fx = new FxSystem({ scene, globals, camera, clusters });
const ctx = fx.ctx;

function probe(label, fn, iters=20000) {
  for (let i=0;i<iters;i++) fn();
  globalThis.gc(); globalThis.gc();
  const b = process.memoryUsage().heapUsed;
  for (let i=0;i<iters;i++) fn();
  const a = process.memoryUsage().heapUsed;
  console.log(label.padEnd(46), ((a-b)/iters).toFixed(2), 'B/iter');
}
// pools kept full so spawn() early-returns -> isolates the non-spawn cost
function fill(pool){ while(!pool.full) pool.spawn(0,0,0,0,0,0,99,1,1,1,1,1,1,1,0,0,0,0,0,0,0.5,1,1); }

probe('noop', ()=>{});
probe('surfaceImpact CONCRETE (pools empty-ish)', ()=>{ fx.add.count=0; fx.alpha.count=0; fx.decals.count=0; surfaceImpact(ctx,0,1,0,0,1,0,3,30,0); });
probe('surfaceImpact METAL', ()=>{ fx.add.count=0; fx.alpha.count=0; fx.decals.count=0; surfaceImpact(ctx,0,1,0,0,1,0,0,30,0); });
probe('muzzleFlash', ()=>{ fx.add.count=0; fx.alpha.count=0; muzzleFlash(ctx,0,1,0,0,0,-1,0); });
probe('tracer', ()=>{ fx.add.count=0; tracer(ctx,0,1,0,0,0,-1,0); });
probe('ctx.lod only', ()=>{ ctx.lod(0,1,0); });
probe('rand.range x60', ()=>{ let s=0; for(let i=0;i<60;i++) s+=ctx.rand.range(1,4); return s; });
probe('decals.add', ()=>{ fx.decals.count=0; fx.decals.add(0,1,0,0,1,0,0.15,0.3,1,26,0.09,0.086,0.078,0.8); });
probe('lights.flash', ()=>{ fx.lights.flash(0,1,0,1,1,1,10,5,0.05); });
