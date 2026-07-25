import * as THREE from 'three';
import { bindGlobals } from './src/materials/index.js';
import { LAYER_TRANSPARENT } from './src/render/index.js';
import { buildCharacter } from './src/characters/index.js';
import { ENEMY } from './src/shared/tuning.js';
bindGlobals({ u: {} });
const v = new THREE.Vector3();
for (const name of ['SKIRN','CULL','VANE','WARDEN']) {
  const h = buildCharacter(name);
  h.root.updateMatrixWorld(true);
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,minZ=1e9,maxZ=-1e9;
  const per = [];
  h.root.traverse(o=>{
    if(!o.isMesh) return;
    const pos=o.geometry.attributes.position;
    let lo=1e9, hi=-1e9, lox=1e9, hix=-1e9;
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
      if(v.x<minX)minX=v.x; if(v.x>maxX)maxX=v.x;
      if(v.y<minY)minY=v.y; if(v.y>maxY)maxY=v.y;
      if(v.z<minZ)minZ=v.z; if(v.z>maxZ)maxZ=v.z;
      if(v.y<lo)lo=v.y; if(v.y>hi)hi=v.y;
      if(v.x<lox)lox=v.x; if(v.x>hix)hix=v.x;
    }
    per.push({p:o.parent.name||'?', lo:+lo.toFixed(3), hi:+hi.toFixed(3), lox:+lox.toFixed(3), hix:+hix.toFixed(3)});
  });
  const spec=ENEMY[name];
  console.log(`${name}: y[${minY.toFixed(3)}, ${maxY.toFixed(3)}] h=${(maxY-minY).toFixed(3)} (spec ${spec.height})  x[${minX.toFixed(3)}, ${maxX.toFixed(3)}] w=${(maxX-minX).toFixed(3)}  z[${minZ.toFixed(3)},${maxZ.toFixed(3)}]`);
  const lowest = per.slice().sort((a,b)=>a.lo-b.lo).slice(0,2);
  const highest = per.slice().sort((a,b)=>b.hi-a.hi).slice(0,3);
  const widest = per.slice().sort((a,b)=>b.hix-a.hix).slice(0,3);
  console.log('   lowest ', JSON.stringify(lowest));
  console.log('   highest', JSON.stringify(highest));
  console.log('   widest ', JSON.stringify(widest));
}
