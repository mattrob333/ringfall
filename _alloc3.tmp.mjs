import { rng, setSessionSeed } from './src/core/rng.js';
setSessionSeed(1337);
const r = rng('fx');

const N = 8192;
const tbl = new Float32Array(N);
for (let i=0;i<N;i++) tbl[i] = r.next();
let ci = 0;
function tnext(){ const v = tbl[ci]; ci = (ci + 1) & (N-1); return v; }
function trange(a,b){ return a + (b-a)*tnext(); }

function probe(label, fn, iters=5000) {
  for (let i=0;i<iters;i++) fn();
  globalThis.gc(); globalThis.gc();
  const b = process.memoryUsage().heapUsed;
  for (let i=0;i<iters;i++) fn();
  const a = process.memoryUsage().heapUsed;
  console.log(label.padEnd(40), ((a-b)/iters).toFixed(2), 'B/iter');
}
probe('noop', ()=>{});
probe('rng.next() x20', ()=>{ let s=0; for(let i=0;i<20;i++) s+=r.next(); return s; });
probe('table next() x20', ()=>{ let s=0; for(let i=0;i<20;i++) s+=tnext(); return s; });
probe('table range() x20', ()=>{ let s=0; for(let i=0;i<20;i++) s+=trange(1,5); return s; });
probe('rng.nextUint() x20', ()=>{ let s=0; for(let i=0;i<20;i++) s+=r.nextUint(); return s; });
