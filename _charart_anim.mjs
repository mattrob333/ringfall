import * as THREE from 'three';
import { bindGlobals } from './src/materials/index.js';
import { buildCharacter, animateCharacter, setShieldState, barrierBlocks, countTriangles } from './src/characters/index.js';
import { HitRegion } from './src/shared/enums.js';
bindGlobals({ u: {} });
const RN = Object.fromEntries(Object.entries(HitRegion).map(([k,v])=>[v,k]));
const p = new THREE.Vector3();
for (const name of ['SKIRN','CULL','VANE','WARDEN']) {
  const h = buildCharacter(name);
  console.log(`\n${name}: tris=${h.triangles} (mesh ${countTriangles(h.root)}) hitboxes=${h.hitboxes.length} h=${h.height} r=${h.radius}`);
  console.log('  parts:', Object.entries(h.parts).map(([k,v])=>`${k}=${v?'ok':'null'}`).join(' '));
  for (const hb of h.hitboxes) {
    hb.node.getWorldPosition(p);
    console.log(`   ${hb.name.padEnd(11)} ${RN[hb.region].padEnd(9)} ${hb.kind.padEnd(7)} world(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) r=${hb.radius} hh=${hb.halfHeight} he=[${hb.halfExtents}] sfc=${hb.surfaceId}${hb.barrier?' BARRIER':''}${hb.detonates?' DETONATES':''}${hb.frontPlate?' FRONTPLATE x'+hb.damageScale:''}`);
  }
  // animation exercise
  const states = ['idle','walk','walk','stagger','walk','death'];
  let bad = 0;
  for (let si=0; si<states.length; si++) {
    for (let i=0;i<120;i++) {
      animateCharacter(h, { state: states[si], dt: 1/120, speed: states[si]==='walk'?3.0:0, aimYaw: Math.sin(i*0.05)*0.8, aimPitch: Math.cos(i*0.03)*0.4 });
    }
    h.root.updateMatrixWorld(true);
    h.root.traverse(o=>{ if(o.isMesh){ o.getWorldPosition(p); if(!Number.isFinite(p.x+p.y+p.z)) bad++; }});
  }
  console.log(`  animation: ${bad===0?'no NaN across 720 steps of idle/walk/stagger/death':'NaN COUNT '+bad}`);
  if (h.shield) {
    setShieldState(h, { fraction: 1, flash01: 1 });
    const hi = h.shield.material.uniforms.uEmissiveIntensity.value;
    setShieldState(h, { fraction: 0.0 });
    animateCharacter(h, { state:'idle', dt: 1.0 });
    const lo = h.shield.material.uniforms.uEmissiveIntensity.value;
    console.log(`  shield: flash intensity ${hi.toFixed(2)} -> settled ${lo.toFixed(2)}, visible=${h.shield.group.visible}, additive=${h.shield.material.blending===THREE.AdditiveBlending}`);
  }
  if (h.barrier) {
    h.root.rotation.set(0,0,0); animateCharacter(h,{state:'idle',dt:0.016});
    const front = new THREE.Vector3(0,0,-1); // travelling toward -Z i.e. hitting the front
    const side  = new THREE.Vector3(-1,0,0);
    const back  = new THREE.Vector3(0,0,1);
    const off   = new THREE.Vector3(Math.sin(0.5),0,-Math.cos(0.5)); // 28.6 deg off axis
    const off2  = new THREE.Vector3(Math.sin(0.7),0,-Math.cos(0.7)); // 40 deg off axis
    console.log(`  barrier arc ${h.barrier.arcDeg} deg, hp ${h.barrier.health}, kinetic x${h.barrier.kineticMult}, plasma x${h.barrier.plasmaMult}`);
    console.log(`   front=${barrierBlocks(h,front)} 28.6deg=${barrierBlocks(h,off)} 40deg=${barrierBlocks(h,off2)} side=${barrierBlocks(h,side)} back=${barrierBlocks(h,back)}`);
  }
}
