import * as THREE from 'three';
import { FxSystem } from './src/fx/index.js';
import { setSessionSeed } from './src/core/rng.js';
import { SurfaceId } from './src/shared/enums.js';

setSessionSeed(1337);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60,16/9,0.05,4000);
const globals = { u: { uExposure: { value: 0.88 } } };
const clusters = { lights: [], addPointLight(p,c,i,r){const l={position:p.clone(),color:c.clone(),intensity:i,range:r,type:0,dir:new THREE.Vector3(0,-1,0),cosOuter:-1,cosInner:-1,enabled:true};this.lights.push(l);return l;} };
const fx = new FxSystem({ scene, globals, camera, clusters });
const cp = new THREE.Vector3(0,1.62,0);
const DT = 1/60;
const ev = { point:[0,1,0], normal:[0,1,0], surfaceId:0, energy:40, damageType:0, sourceId:1 };
const fired = { ownerId:1, weaponId:'cadence_ar', muzzle:[0,1.5,0], direction:[0,0,-1] };

function load(n) {
  for (let k=0;k<n;k++) {
    ev.point[0]=(k%13)-6; ev.point[1]=0.5+(k%5)*0.4; ev.point[2]=((k/13)|0)-6;
    ev.surfaceId = k % 17;
    fx.onSurfaceImpact(ev);
    fx.onWeaponFired(fired);
  }
}
// saturate
for (let f=0; f<40; f++) { load(40); fx.update(DT, cp); }
console.log('loaded: add=%d alpha=%d decals=%d', fx.add.count, fx.alpha.count, fx.decals.count);

// steady state: keep it saturated and time update()
const samples = [];
for (let f=0; f<3000; f++) {
  load(30);
  const t0 = process.hrtime.bigint();
  fx.update(DT, cp);
  const t1 = process.hrtime.bigint();
  samples.push(Number(t1-t0)/1e6);
}
samples.sort((a,b)=>a-b);
const q = p => samples[Math.min(samples.length-1, Math.floor(samples.length*p))];
console.log('update() at saturation: p50=%sms p95=%sms p99=%sms max=%sms  (add=%d alpha=%d dec=%d)',
  q(0.5).toFixed(3), q(0.95).toFixed(3), q(0.99).toFixed(3), q(1).toFixed(3),
  fx.add.count, fx.alpha.count, fx.decals.count);

// spawn cost
const s2 = [];
for (let f=0;f<2000;f++){
  const t0 = process.hrtime.bigint();
  load(30);
  const t1 = process.hrtime.bigint();
  s2.push(Number(t1-t0)/1e6);
  fx.update(DT, cp);
}
s2.sort((a,b)=>a-b);
console.log('30 impacts + 30 weapon.fired spawn cost: p50=%sms p99=%sms', s2[1000].toFixed(3), s2[1980].toFixed(3));

// instance byte volume per frame
const bytes = (fx.add.count + fx.alpha.count) * 14 * 4 + fx.decals.count * 14 * 4;
console.log('instance upload at saturation: %d KB/frame (%d MB/s at 60fps)', (bytes/1024)|0, ((bytes*60)/1048576).toFixed(1));
