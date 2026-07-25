import { runCharacterSelfTest } from './src/characters/selftest.js';
const res = runCharacterSelfTest({ ascii: true });
const rows = res.results.map(r => r.ascii.split('\n'));
const names = res.results.map(r => r.archetype);
console.log(names.map(n=>n.padEnd(50)).join(' '));
for (let i=0;i<rows[0].length;i++) console.log(rows.map(r=>r[i].padEnd(50)).join(' '));
