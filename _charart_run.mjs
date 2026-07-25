import * as THREE from 'three';
import { bindGlobals } from './src/materials/index.js';
import { buildCharacter } from './src/characters/index.js';
import { runCharacterSelfTest, formatSelfTest } from './src/characters/selftest.js';

const res = runCharacterSelfTest({ ascii: true });
console.log(formatSelfTest(res));

if (process.argv.includes('--ascii')) {
  const rows = res.results.map(r => r.ascii.split('\n'));
  const names = res.results.map(r => r.archetype);
  console.log('');
  console.log(names.map(n=>n.padEnd(50)).join(' '));
  for (let i=0;i<rows[0].length;i++) console.log(rows.map(r=>r[i].padEnd(50)).join(' '));
}

if (process.argv.includes('--dims')) {
  bindGlobals({ u: {} });
  const v = new THREE.Vector3();
  for (const name of ['SKIRN','CULL','VANE','WARDEN']) {
    const h = buildCharacter(name);
    h.root.updateMatrixWorld(true);
    let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,minZ=1e9,maxZ=-1e9;
    const per=[];
    h.root.traverse(o=>{ if(!o.isMesh) return;
      const pos=o.geometry.attributes.position; let lo=1e9,hi=-1e9,lox=1e9,hix=-1e9;
      for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
        minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);
        minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);
        lo=Math.min(lo,v.y);hi=Math.max(hi,v.y);lox=Math.min(lox,v.x);hix=Math.max(hix,v.x); }
      per.push({p:o.parent.name||'?',lo:+lo.toFixed(3),hi:+hi.toFixed(3),lox:+lox.toFixed(3),hix:+hix.toFixed(3)}); });
    console.log(`${name}: y[${minY.toFixed(3)},${maxY.toFixed(3)}] h=${(maxY-minY).toFixed(3)} x[${minX.toFixed(3)},${maxX.toFixed(3)}] w=${(maxX-minX).toFixed(3)} z[${minZ.toFixed(3)},${maxZ.toFixed(3)}]`);
    console.log('   low ', JSON.stringify(per.slice().sort((a,b)=>a.lo-b.lo).slice(0,2)));
    console.log('   high', JSON.stringify(per.slice().sort((a,b)=>b.hi-a.hi).slice(0,2)));
    console.log('   wide', JSON.stringify(per.slice().sort((a,b)=>b.hix-a.hix).slice(0,2)));
  }
}
